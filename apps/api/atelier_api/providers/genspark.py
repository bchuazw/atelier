"""Genspark provider — grounded web research for design critics.

Genspark is a co-sponsor of the hackathon. They provide a CLI-based agent
toolkit (`@genspark/cli`, binary `gsk`). The flows we use here:

- `web_search(query)`  — returns a list of organic results: {title, url, snippet}
- `crawl(url)`         — fetches a page and returns its markdown content.
- `ground_theme(...)`  — combines the two: search → crawl top N in parallel.

Note: we originally tried `batch_crawl_url_and_answer` (one call, per-URL
Q&A extraction), but on the free plan it returned "No content found" for
every URL we tried, while `crawler` on the same URLs returned full
markdown. So we fan out N parallel `crawler` calls and let Claude extract
the theme-specific details from the markdown in the final critics prompt —
same outcome, fewer moving parts.

Why shell out to the CLI instead of hitting the HTTP API directly?
The public Genspark docs are thin and the tool surface changes; the CLI
is the blessed entry point and handles auth + retries for us. The CLI is
installed globally via `npm i -g @genspark/cli` (binary `gsk` on PATH). If
the binary is missing OR `GENSPARK_API_KEY` isn't set, every function here
returns a graceful degraded value so callers can skip grounding and fall
back to Claude-only.

Auth: `GENSPARK_API_KEY` is passed via `--api-key` per invocation so we
don't have to write to `~/.genspark-tool-cli/config.json` on prod.
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import shutil
import subprocess
from dataclasses import dataclass
from typing import Any

log = logging.getLogger(__name__)

_GSK_BIN = shutil.which("gsk") or shutil.which("gsk.cmd")
_GSK_TIMEOUT_S = 60  # per-call cap; Genspark tool calls typically 3-20s.


def _api_key() -> str | None:
    # Accept both names — GSK_API_KEY is what the CLI itself reads.
    return os.environ.get("GENSPARK_API_KEY") or os.environ.get("GSK_API_KEY") or None


def is_available() -> bool:
    """True only if we can actually run a Genspark tool call right now."""
    return bool(_GSK_BIN) and bool(_api_key())


@dataclass
class SearchResult:
    title: str
    url: str
    snippet: str


@dataclass
class CrawlPage:
    url: str
    markdown: str
    error: str | None = None


def _run_gsk_sync(tool: str, positional: str | None) -> dict[str, Any] | None:
    """Blocking impl of a single gsk invocation. Runs inside a thread via
    `_run_gsk` so the FastAPI event loop stays unblocked. We use
    `subprocess.run` (not `asyncio.create_subprocess_exec`) because on Windows
    the gsk binary resolves to `gsk.CMD` (a batch wrapper), which the async
    version can't execute — it raises WinError 193. `subprocess.run` handles
    .CMD files transparently on Windows.
    """
    if not _GSK_BIN:
        log.info("[genspark] gsk binary not on PATH — skipping %s", tool)
        return None
    key = _api_key()
    if not key:
        log.info("[genspark] GENSPARK_API_KEY not set — skipping %s", tool)
        return None

    # JSON is the default --output mode; pass --api-key explicitly so we
    # don't depend on a persisted config file (prod containers won't have one).
    cmd = [_GSK_BIN, "--api-key", key, "--output", "json", tool]
    if positional is not None:
        cmd.append(positional)

    try:
        proc = subprocess.run(
            cmd,
            capture_output=True,
            timeout=_GSK_TIMEOUT_S,
            text=False,
            check=False,
        )
    except subprocess.TimeoutExpired:
        log.warning("[genspark] %s timed out after %ss", tool, _GSK_TIMEOUT_S)
        return None
    except FileNotFoundError:
        log.info("[genspark] gsk binary vanished mid-call")
        return None
    except OSError as e:
        log.warning("[genspark] %s OSError: %s", tool, e)
        return None

    stdout = proc.stdout.decode("utf-8", errors="replace").strip()
    stderr = proc.stderr.decode("utf-8", errors="replace").strip()
    if proc.returncode != 0:
        log.warning("[genspark] %s exited %s: %s", tool, proc.returncode, stderr[:500])
        return None

    # Try parse whole stdout first; fall back to last {...} block.
    try:
        return json.loads(stdout)
    except json.JSONDecodeError:
        pass
    # Search backwards for the last top-level JSON object.
    last_obj_start = stdout.rfind("{")
    while last_obj_start != -1:
        candidate = stdout[last_obj_start:]
        try:
            return json.loads(candidate)
        except json.JSONDecodeError:
            last_obj_start = stdout.rfind("{", 0, last_obj_start)
    log.warning("[genspark] %s returned non-JSON output: %s", tool, stdout[:300])
    return None


async def _run_gsk(tool: str, positional: str | None = None) -> dict[str, Any] | None:
    """Async wrapper — offloads the blocking subprocess call to a thread."""
    return await asyncio.to_thread(_run_gsk_sync, tool, positional)


async def web_search(query: str, limit: int = 5) -> list[SearchResult]:
    """Search the web and return top organic results."""
    if not query.strip():
        return []
    payload = await _run_gsk("web_search", query.strip())
    if not payload:
        return []
    data = payload.get("data") or {}
    results = data.get("organic_results") or []
    out: list[SearchResult] = []
    for r in results[:limit]:
        url = (r.get("link") or r.get("url") or "").strip()
        if not url:
            continue
        out.append(
            SearchResult(
                title=(r.get("title") or url).strip(),
                url=url,
                snippet=(r.get("snippet") or "").strip(),
            )
        )
    return out


async def crawl(url: str) -> CrawlPage | None:
    """Fetch a page and return its markdown content, or None on failure."""
    if not url.strip():
        return None
    payload = await _run_gsk("crawler", url.strip())
    if not payload:
        return None
    data = payload.get("data") or {}
    md = (data.get("result") or "").strip()
    # Some crawls return the string literal "No content found or crawler failed".
    if not md or md.lower().startswith("no content found"):
        return CrawlPage(url=url, markdown="", error="empty")
    return CrawlPage(url=url, markdown=md)


async def ground_theme(
    theme: str,
    max_sites: int = 3,
    chars_per_site: int = 4000,
) -> dict[str, Any]:
    """One-shot helper: search for theme examples, crawl top N in parallel.

    Returns:
        {
          "theme": theme,
          "sites": [
            {"url", "title", "snippet", "markdown"}  # markdown truncated
          ]
        }
    Empty sites list = Genspark unavailable, no search hits, or every crawl
    returned empty. Caller should quietly fall back to Claude-only critics.
    """
    search_query = f"{theme} landing page design"
    # Oversample so a couple of failed crawls still leave us with enough sites.
    hits = await web_search(search_query, limit=max_sites * 2)
    if not hits:
        return {"theme": theme, "sites": []}

    pages = await asyncio.gather(
        *(crawl(h.url) for h in hits),
        return_exceptions=True,
    )

    sites: list[dict[str, Any]] = []
    for hit, page in zip(hits, pages):
        if len(sites) >= max_sites:
            break
        if isinstance(page, Exception) or page is None or not page.markdown:
            continue
        sites.append(
            {
                "url": hit.url,
                "title": hit.title,
                "snippet": hit.snippet,
                "markdown": page.markdown[:chars_per_site],
            }
        )
    return {"theme": theme, "sites": sites}

from __future__ import annotations

import asyncio
import logging
import re
from pathlib import Path
from urllib.parse import urljoin, urlparse

import httpx
from bs4 import BeautifulSoup

log = logging.getLogger(__name__)

USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Atelier/0.1"
)

TIMEOUT = httpx.Timeout(30.0, connect=10.0)

ANALYTICS_SCRIPT_HINTS = (
    "googletagmanager",
    "google-analytics",
    "analytics",
    "hotjar",
    "segment",
    "mixpanel",
    "intercom",
    "fullstory",
    "amplitude",
)


def _decode_response(r: httpx.Response) -> str:
    """Decode a response body as text, preferring UTF-8 when the server's
    Content-Type doesn't declare a charset (common for object storage proxies
    that serve static HTML as text/plain).
    """
    declared = (r.headers.get("content-type") or "").lower()
    if "charset=" in declared:
        return r.text
    # Try UTF-8 first; fall back to httpx's charset guess, then latin-1.
    try:
        return r.content.decode("utf-8")
    except UnicodeDecodeError:
        try:
            return r.text  # httpx.apparent_encoding heuristic
        except Exception:
            return r.content.decode("latin-1", errors="replace")


async def _fetch_bytes(client: httpx.AsyncClient, url: str) -> bytes | None:
    try:
        r = await client.get(url, follow_redirects=True)
        if r.status_code == 200:
            return r.content
    except Exception as e:  # network / timeout / TLS — skip the asset
        log.debug("asset fetch failed for %s: %s", url, e)
        return None
    return None


async def _fetch_html(client: httpx.AsyncClient, url: str, *, retries: int = 2) -> httpx.Response:
    """Fetch the root document. Retry once on transient 5xx / network error
    before giving up."""
    last_error: Exception | None = None
    for attempt in range(retries + 1):
        try:
            r = await client.get(url, follow_redirects=True)
            if r.status_code < 500:
                r.raise_for_status()
                return r
            last_error = httpx.HTTPStatusError(
                f"server returned {r.status_code}", request=r.request, response=r
            )
        except (httpx.RequestError, httpx.HTTPStatusError) as e:
            last_error = e
        if attempt < retries:
            await asyncio.sleep(0.8 * (attempt + 1))
    assert last_error is not None
    raise last_error


async def fetch_page(url: str, out_dir: Path) -> Path:
    """Fetch an HTML page with inlined/downloaded assets into out_dir.

    Returns the path to the produced index.html. Relative-URL assets are
    downloaded to out_dir/assets/ and the HTML is rewritten to point at them.
    External fonts/scripts that fail to fetch are left as absolute URLs.
    """
    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / "assets").mkdir(exist_ok=True)

    async with httpx.AsyncClient(
        headers={
            "User-Agent": USER_AGENT,
            # Nudge servers toward HTML: some (notably Cloudflare-fronted object
            # stores like Supabase Storage) respond with text/plain when Accept
            # is missing, which then muddles decoding.
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.9",
        },
        timeout=TIMEOUT,
        follow_redirects=True,
    ) as client:
        r = await _fetch_html(client, url)
        html = _decode_response(r)
        base = str(r.url)

        soup = BeautifulSoup(html, "lxml")

        # Drop any <base> tag. In our sandbox model we rewrite all assets to
        # local paths under variants/<id>/, so a <base href="https://..."> would
        # hijack relative URLs (e.g., hero image at `media/hero.jpg` resolves
        # to `https://originalsite.com/media/hero.jpg`) and break rendering.
        for existing_base in soup.find_all("base"):
            existing_base.decompose()

        # Download images + stylesheets; rewrite to local paths.
        tasks: list[tuple[BeautifulSoup, str, str]] = []  # (element, attr, absolute_url)

        for img in soup.find_all("img"):
            src = img.get("src")
            if src:
                tasks.append((img, "src", urljoin(base, src)))
            srcset = img.get("srcset")
            if srcset:
                # drop srcset to keep it simple for the hackathon MVP
                del img["srcset"]

        for link in soup.find_all("link", rel=lambda v: v and "stylesheet" in v):
            href = link.get("href")
            if href:
                tasks.append((link, "href", urljoin(base, href)))

        # Fetch assets in parallel.
        results = await asyncio.gather(*(_fetch_bytes(client, u) for (_, _, u) in tasks))

        for (el, attr, abs_url), data in zip(tasks, results):
            if data is None:
                el[attr] = abs_url  # leave as absolute so browser still fetches it
                continue
            parsed = urlparse(abs_url)
            name = Path(parsed.path).name or "asset"
            safe = re.sub(r"[^a-zA-Z0-9._-]", "_", name)[:80]
            # ensure uniqueness
            target = out_dir / "assets" / safe
            i = 1
            while target.exists():
                target = out_dir / "assets" / f"{i}_{safe}"
                i += 1
            target.write_bytes(data)
            el[attr] = f"assets/{target.name}"

        # Strip analytics / session-recording scripts so seeded pages don't
        # phone home from inside the sandbox iframe.
        for s in soup.find_all("script"):
            src = (s.get("src") or "").lower()
            if any(bad in src for bad in ANALYTICS_SCRIPT_HINTS):
                s.decompose()

        # Force a UTF-8 <meta charset> so the saved document is unambiguous.
        head = soup.head or soup.find("head")
        if head:
            existing_charsets = head.find_all("meta", charset=True)
            for m in existing_charsets:
                m.decompose()
            charset_tag = soup.new_tag("meta", charset="utf-8")
            head.insert(0, charset_tag)

    index = out_dir / "index.html"
    index.write_text(str(soup), encoding="utf-8")
    return index


async def save_html_as_seed(html: str, out_dir: Path) -> Path:
    """Save an already-HTML string as a seed snapshot.

    Used by the "paste HTML" project creation flow so users can skip the
    live-fetch step entirely and bring a polished starting point (e.g., a
    locally-designed landing page). No asset resolution is attempted — the
    caller is responsible for ensuring the HTML is self-contained.
    """
    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / "assets").mkdir(exist_ok=True)

    soup = BeautifulSoup(html, "lxml")
    for existing_base in soup.find_all("base"):
        existing_base.decompose()
    # Same analytics strip + force meta charset as the fetch path.
    for s in soup.find_all("script"):
        src = (s.get("src") or "").lower()
        if any(bad in src for bad in ANALYTICS_SCRIPT_HINTS):
            s.decompose()
    head = soup.head or soup.find("head")
    if head:
        for m in head.find_all("meta", charset=True):
            m.decompose()
        head.insert(0, soup.new_tag("meta", charset="utf-8"))

    index = out_dir / "index.html"
    index.write_text(str(soup), encoding="utf-8")
    return index

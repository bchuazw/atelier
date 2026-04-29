"""Atelier MCP server — exposes the Atelier exploration backend to Claude
Code (or any MCP-aware agent) over stdio.

Tool surface (8 tools, names are load-bearing — Claude Code's builder agent
expects these exact identifiers):

  - atelier_create_project
  - atelier_list_projects
  - atelier_fork
  - atelier_get_project
  - atelier_get_variant_html
  - atelier_compare
  - atelier_publish_variant
  - atelier_get_project_url

All tools return JSON-serializable dicts/lists/strings so the MCP framework
can wrap them as text content blocks for the agent.
"""

from __future__ import annotations

import logging
from typing import Any

import httpx
from mcp.server.fastmcp import FastMCP

from .client import AtelierClient, api_base, default_workspace, web_base
from .diff import compute_style_diff, summarize

log = logging.getLogger(__name__)


# ── Helpers ────────────────────────────────────────────────────────────

def _build_style_pins(
    primary_color: str | None,
    body_font: str | None,
    tone: str | None,
) -> list[dict[str, Any]]:
    """Translate the brand-kit args into Style Pins the API understands.

    The API accepts a typed `StylePin` schema (prop/value/kind/strict) and
    stores them on `project.settings["style_pins"]` — every fork prompt
    then injects them as hard constraints. We map:

      - primary_color -> kind=color, strict=true (so a missing hex triggers
        the API's one-shot color-pin re-prompt)
      - body_font     -> kind=font
      - tone          -> kind=text (free-form description)
    """
    pins: list[dict[str, Any]] = []
    if primary_color:
        pins.append(
            {"prop": "primary color", "value": primary_color.strip(), "kind": "color", "strict": True}
        )
    if body_font:
        pins.append(
            {"prop": "body font", "value": body_font.strip(), "kind": "font", "strict": False}
        )
    if tone:
        pins.append(
            {"prop": "tone", "value": tone.strip(), "kind": "text", "strict": False}
        )
    return pins


def _variant_summary(child: dict[str, Any]) -> dict[str, Any]:
    """Slim a fork-response child down to the fields the agent actually
    surfaces back to its user. Drops token_usage + edge_id (internal)."""
    return {
        "node_id": child.get("node_id"),
        "title": child.get("title"),
        "summary": child.get("summary"),
        "sandbox_url": child.get("sandbox_url"),
        "model_used": child.get("model_used"),
        "build_status": child.get("build_status"),
    }


def _build_project_url(project_id: str, workspace: str | None) -> str:
    """Build the canvas deep-link URL the user should open.

    `?project=<id>` auto-loads the project on first mount (handler in
    apps/web/src/App.tsx). `?ws=<code>` triggers the join-workspace
    confirm so a user opening the URL from another browser/account is
    pulled into the correct workspace and sees the project's recents
    siblings. Both params are independent — including only project=<id>
    works if the recipient is already in the right workspace.
    """
    from urllib.parse import urlencode

    params: dict[str, str] = {"project": project_id}
    if workspace:
        params["ws"] = workspace
    return f"{web_base()}/?{urlencode(params)}"


def _http_error_message(e: httpx.HTTPStatusError) -> str:
    """Render an httpx.HTTPStatusError into a single human-readable line.

    The Atelier API returns FastAPI's `{detail: "..."}` shape on 4xx/5xx, so
    we prefer that string over the raw response body when present.
    """
    status = e.response.status_code
    try:
        body = e.response.json()
        detail = body.get("detail") if isinstance(body, dict) else None
    except Exception:
        detail = None
    if detail:
        return f"Atelier API returned {status}: {detail}"
    return f"Atelier API returned {status}: {e.response.text[:300]}"


# ── Server build + tool definitions ────────────────────────────────────

def build_server() -> FastMCP:
    """Construct the FastMCP server and register every Atelier tool.

    Kept as a standalone function so the smoke-test script can import the
    same definitions without spinning up a stdio loop."""
    mcp = FastMCP("atelier")
    client = AtelierClient()

    # ── Projects ────────────────────────────────────────────────────

    @mcp.tool()
    async def atelier_create_project(
        name: str,
        seed_html: str | None = None,
        seed_url: str | None = None,
        primary_color: str | None = None,
        body_font: str | None = None,
        tone: str | None = None,
        workspace: str | None = None,
    ) -> dict[str, Any]:
        """Create a new Atelier exploration project.

        Use when the agent is starting a fresh design exploration. Either
        `seed_html` (paste a snippet) or `seed_url` (have Atelier crawl a
        live page) seeds the canvas root; both omitted is fine — the seed
        is then a blank node. Brand-kit args (`primary_color`, `body_font`,
        `tone`) are stored as Style Pins and injected as hard constraints
        on every subsequent fork prompt.

        `workspace` is the user's 8-character workspace code (e.g.
        "C2100BCH"). Pass it so the new project shows up in their web
        dashboard's recents list. Falls back to the ATELIER_WORKSPACE env
        var when omitted; if neither is set the project is created untagged
        (reachable only via direct URL — useful for system jobs but not
        what an agent acting on a user's behalf wants).

        Returns:
          {
            "project_id": str,
            "seed_node_id": str,           # parent for the first fork
            "web_url": str,                # canvas deep-link with workspace
            "name": str,
            "workspace": str | null,       # what tag the project was given
          }
        """
        if seed_html and seed_url:
            return {"error": "Provide either seed_html OR seed_url, not both."}
        try:
            style_pins = _build_style_pins(primary_color, body_font, tone)
            proj = await client.create_project(
                name=name,
                seed_html=seed_html,
                seed_url=seed_url,
                style_pins=style_pins or None,
                workspace=workspace,
            )
        except httpx.HTTPStatusError as e:
            return {"error": _http_error_message(e)}
        except httpx.HTTPError as e:
            return {"error": f"HTTP error talking to Atelier API: {e}"}
        # Resolve the effective workspace tag (explicit arg → env var →
        # null) so the response is self-describing — the agent can quote
        # it back to the user when telling them the URL.
        used_ws = workspace if workspace is not None else default_workspace()
        return {
            "project_id": proj["id"],
            "seed_node_id": proj.get("working_node_id"),
            "web_url": _build_project_url(proj["id"], used_ws),
            "name": proj.get("name"),
            "workspace": used_ws,
        }

    @mcp.tool()
    async def atelier_list_projects(workspace: str | None = None) -> list[dict[str, Any]]:
        """List existing (non-archived) Atelier projects.

        Use when the agent needs to find a project the user already
        created — e.g., the user said "go with variant B from yesterday's
        landing page exploration", and the agent needs to look up the
        project id by name.

        `workspace` filters to a specific user's workspace code. Falls back
        to the ATELIER_WORKSPACE env var when omitted; pass the empty string
        ("") to force admin mode (every project across every workspace),
        useful for cross-workspace audits.

        Returns a list of:
          {id, name, node_count, last_activity, seed_url, workspace}
        where `workspace` is the filter that was applied (or null for admin).
        """
        # Empty string is a sentinel for "force admin mode" — explicit
        # opt-out of the env-var fallback that the client would otherwise
        # apply. None means "use env var if set, else admin".
        ws_arg: str | None
        if workspace == "":
            ws_arg = None  # bypass env fallback
            applied = None
        else:
            ws_arg = workspace
            applied = workspace if workspace is not None else default_workspace()
        try:
            # When applied is None we want admin (no filter); when applied
            # is set we filter. The client treats None as "use env" so we
            # have to pass the resolved value explicitly here.
            projects = await client.list_projects(
                include_archived=False, workspace=applied
            )
        except httpx.HTTPStatusError as e:
            return [{"error": _http_error_message(e)}]
        except httpx.HTTPError as e:
            return [{"error": f"HTTP error talking to Atelier API: {e}"}]
        return [
            {
                "id": p["id"],
                "name": p["name"],
                "node_count": p.get("node_count", 0),
                "last_activity": p.get("last_activity"),
                "seed_url": p.get("seed_url"),
                "workspace": applied,
            }
            for p in projects
        ]

    @mcp.tool()
    async def atelier_get_project(project_id: str) -> dict[str, Any]:
        """Fetch a project's full canvas tree (metadata + nodes + edges).

        Use when the agent needs to inspect what variants already exist
        before forking again, or to map a node title back to its node_id.

        Returns the API's `/projects/{id}/tree` response: `{project, nodes,
        edges}`. Each node carries `id`, `parent_id`, `title`, `summary`,
        `model_used`, `sandbox_url`, and `build_status`.
        """
        try:
            tree = await client.get_project_tree(project_id)
        except httpx.HTTPStatusError as e:
            return {"error": _http_error_message(e)}
        except httpx.HTTPError as e:
            return {"error": f"HTTP error talking to Atelier API: {e}"}
        return tree

    # ── Forking ─────────────────────────────────────────────────────

    @mcp.tool()
    async def atelier_fork(
        parent_node_id: str,
        prompt: str,
        model: str = "sonnet",
        n: int = 1,
        shootout: bool = False,
    ) -> list[dict[str, Any]]:
        """Fork an Atelier node — generate one or more design variants from
        a parent.

        Use this whenever the agent wants to brainstorm. `shootout=True` is
        the recommended path for "give me 3 directions": it fans out one
        variant per model (Haiku + Sonnet + Opus in parallel), giving the
        user genuinely different aesthetics to choose between. Otherwise
        `model` (`haiku` / `sonnet` / `opus`) and `n` (1-3) control a
        same-model fan.

        Returns a list of variant summaries:
          [{node_id, title, summary, sandbox_url, model_used, build_status}, ...]

        Slow: a shootout on Render free-tier can take 60-80s. The MCP
        client timeout is 90s.
        """
        try:
            children = await client.fork_node(
                parent_node_id=parent_node_id,
                prompt=prompt,
                model=model,
                n=n,
                shootout=shootout,
            )
        except httpx.HTTPStatusError as e:
            return [{"error": _http_error_message(e)}]
        except httpx.HTTPError as e:
            return [{"error": f"HTTP error talking to Atelier API: {e}"}]
        return [_variant_summary(c) for c in children]

    # ── Variant inspection ─────────────────────────────────────────

    @mcp.tool()
    async def atelier_get_variant_html(node_id: str) -> dict[str, Any]:
        """Fetch the rendered HTML of a variant (and its lineage).

        Use this AFTER the user picks a winner — the agent calls this to
        pull the actual HTML so it can paste/adapt it into the user's
        codebase. The returned `media_assets` list gives public URLs for
        any non-HTML files the variant references.

        Returns:
          {
            html: str,                  # full <!DOCTYPE html>... document
            title: str | null,
            summary: str | null,
            model_used: str | null,
            sandbox_url: str | null,    # live preview URL
            media_assets: [             # non-HTML files in the variant tree
              {relative_path, public_url, size_bytes}, ...
            ],
            lineage: [{id, title, type, model_used}, ...],
          }
        """
        try:
            export = await client.export_node(node_id)
            node = await client.get_node(node_id)
        except httpx.HTTPStatusError as e:
            return {"error": _http_error_message(e)}
        except httpx.HTTPError as e:
            return {"error": f"HTTP error talking to Atelier API: {e}"}
        return {
            "html": export.get("html", ""),
            "title": export.get("title"),
            "summary": export.get("summary"),
            "model_used": node.get("model_used"),
            "sandbox_url": export.get("sandbox_url"),
            "media_assets": export.get("media_assets", []),
            "lineage": export.get("lineage", []),
        }

    @mcp.tool()
    async def atelier_compare(a_node_id: str, b_node_id: str) -> dict[str, Any]:
        """Compute a structured diff between two variants.

        Runs the Atelier `StyleDiff` engine (Python port of the web app's
        diff lens) over both variants' rendered HTML and returns a flat
        list of property-level changes plus per-category counts.

        Categories: copy, tokens, structure, typography, palette,
        spacing, effects, layout.

        Returns:
          {
            a_node_id, b_node_id,
            diff: [                       # flat StyleDiff list
              {selector, property, before, after, category}, ...
            ],
            summary: {copy: N, tokens: N, structure: N, typography: N,
                      palette: N, spacing: N, effects: N, layout: N},
            web_compare_url: str,         # canvas URL — for visual side-by-side
          }

        On fetch failure for either variant, returns
          {error: str, a_node_id, b_node_id}
        instead of raising — agents handle dicts more reliably than
        exceptions.
        """
        # Fetch both variants' rendered HTML. We deliberately catch
        # per-call so the error message can name which side failed.
        try:
            a_export = await client.export_node(a_node_id)
        except httpx.HTTPStatusError as e:
            return {
                "error": f"Could not fetch variant A: {_http_error_message(e)}",
                "a_node_id": a_node_id,
                "b_node_id": b_node_id,
            }
        except httpx.HTTPError as e:
            return {
                "error": f"HTTP error fetching variant A: {e}",
                "a_node_id": a_node_id,
                "b_node_id": b_node_id,
            }
        try:
            b_export = await client.export_node(b_node_id)
        except httpx.HTTPStatusError as e:
            return {
                "error": f"Could not fetch variant B: {_http_error_message(e)}",
                "a_node_id": a_node_id,
                "b_node_id": b_node_id,
            }
        except httpx.HTTPError as e:
            return {
                "error": f"HTTP error fetching variant B: {e}",
                "a_node_id": a_node_id,
                "b_node_id": b_node_id,
            }

        a_html = a_export.get("html", "") or ""
        b_html = b_export.get("html", "") or ""
        if not a_html or not b_html:
            return {
                "error": "One or both variants returned empty HTML; cannot diff.",
                "a_node_id": a_node_id,
                "b_node_id": b_node_id,
            }

        diff = compute_style_diff(a_html, b_html)
        return {
            "a_node_id": a_node_id,
            "b_node_id": b_node_id,
            "a_title": a_export.get("title"),
            "b_title": b_export.get("title"),
            "diff": diff,
            "summary": summarize(diff),
            # Canvas URL for visual side-by-side. We can't include the
            # specific A/B selection in the URL (that's React state, not
            # a route param), but we CAN make the recipient land in the
            # right workspace + project so they only have to click Compare
            # twice. project=<id> picks one of the two variants' parent
            # projects — both variants must belong to the same project for
            # compare to be meaningful, so either works.
            "web_compare_url": _build_project_url(
                a_export.get("project_id") or b_export.get("project_id") or "",
                default_workspace(),
            ),
        }

    # ── Publish + URL helpers ──────────────────────────────────────

    @mcp.tool()
    async def atelier_publish_variant(node_id: str) -> dict[str, Any]:
        """Publish a variant to a public URL the user can share.

        Use when the user wants to send a variant to a stakeholder for
        review without granting Atelier-canvas access. Re-publishing the
        same node overwrites the existing public copy (stable slug).

        Returns: {slug, public_url, published_at}
        """
        try:
            result = await client.publish_node(node_id)
        except httpx.HTTPStatusError as e:
            return {"error": _http_error_message(e)}
        except httpx.HTTPError as e:
            return {"error": f"HTTP error talking to Atelier API: {e}"}
        return {
            "slug": result.get("slug"),
            "public_url": result.get("public_url"),
            "published_at": result.get("published_at"),
        }

    @mcp.tool()
    async def atelier_get_project_url(
        project_id: str, workspace: str | None = None
    ) -> str:
        """Build the canvas deep-link URL the user should open.

        The web app honors `?project=<id>` to auto-load a project AND
        `?ws=<code>` to switch into a specific workspace before loading.
        Pass `workspace` (or set ATELIER_WORKSPACE) so a recipient who
        opens the URL is pulled into the right workspace — without it,
        their browser may already belong to a different workspace and
        the project won't appear in their recents alongside it.

        Returns a single URL string ready to paste into a chat / email:
          "https://atelier-web.onrender.com/?project=<id>&ws=<code>"
        """
        used_ws = workspace if workspace is not None else default_workspace()
        return _build_project_url(project_id, used_ws)

    return mcp


def run_stdio() -> None:
    """Entry point for `python -m mcp_server`. Spins up FastMCP on stdio."""
    # Log to stderr so MCP's stdout transport stays clean (stdout is the
    # JSON-RPC channel; any print() to stdout corrupts the protocol).
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s atelier-mcp — %(message)s",
    )
    log.info("Starting Atelier MCP server (api_base=%s)", api_base())
    mcp = build_server()
    mcp.run()  # FastMCP defaults to stdio transport

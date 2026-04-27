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

from .client import AtelierClient, api_base, web_base

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
    ) -> dict[str, Any]:
        """Create a new Atelier exploration project.

        Use when the agent is starting a fresh design exploration. Either
        `seed_html` (paste a snippet) or `seed_url` (have Atelier crawl a
        live page) seeds the canvas root; both omitted is fine — the seed
        is then a blank node. Brand-kit args (`primary_color`, `body_font`,
        `tone`) are stored as Style Pins and injected as hard constraints
        on every subsequent fork prompt.

        Returns:
          {
            "project_id": str,
            "seed_node_id": str,           # parent for the first fork
            "web_url": str,                # bare canvas URL (no deep link)
            "name": str,
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
            )
        except httpx.HTTPStatusError as e:
            return {"error": _http_error_message(e)}
        except httpx.HTTPError as e:
            return {"error": f"HTTP error talking to Atelier API: {e}"}
        return {
            "project_id": proj["id"],
            "seed_node_id": proj.get("working_node_id"),
            "web_url": web_base(),
            "name": proj.get("name"),
        }

    @mcp.tool()
    async def atelier_list_projects() -> list[dict[str, Any]]:
        """List existing (non-archived) Atelier projects.

        Use when the agent needs to find a project the user already
        created — e.g., the user said "go with variant B from yesterday's
        landing page exploration", and the agent needs to look up the
        project id by name.

        Returns a list of:
          {id, name, node_count, last_activity, seed_url}
        """
        try:
            projects = await client.list_projects(include_archived=False)
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

        DEFERRED: Atelier's `StyleDiff[]` engine (categories: copy,
        structure, tokens, typography, palette, spacing, effects, layout)
        is implemented in TypeScript on the web client and is not exposed
        by the API. Porting it to Python is out of scope for this MCP
        server's MVP, so this tool returns a pointer to the canvas's
        visual Compare view instead of a structured diff.

        Returns:
          {
            message: str,           # "Open the canvas and click Compare"
            web_url: str,           # canvas URL the user should open
            a_node_id, b_node_id,
            a_sandbox_url, b_sandbox_url,
          }
        """
        try:
            a = await client.get_node(a_node_id)
            b = await client.get_node(b_node_id)
        except httpx.HTTPStatusError as e:
            return {"error": _http_error_message(e)}
        except httpx.HTTPError as e:
            return {"error": f"HTTP error talking to Atelier API: {e}"}
        return {
            "message": (
                "Structured StyleDiff is computed client-side in the Atelier web app and is not "
                "yet exposed via the API. Open the canvas, multi-select both variants, and click "
                "Compare to see the visual diff (categories: copy, structure, tokens, typography, "
                "palette, spacing, effects, layout)."
            ),
            "web_url": web_base(),
            "a_node_id": a_node_id,
            "b_node_id": b_node_id,
            "a_title": a.get("title"),
            "b_title": b.get("title"),
            "a_sandbox_url": a.get("sandbox_url"),
            "b_sandbox_url": b.get("sandbox_url"),
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
    async def atelier_get_project_url(project_id: str) -> str:
        """Build the canvas URL the user should open to inspect a project.

        Atelier's React app does NOT currently honor a `?project=<id>`
        query-string deep link — opening it lands you on the recent-
        projects empty state. We return the bare web URL plus the project
        id as a hint string so the agent can phrase its message as
        "open <url> and click into the project named X (id: <id>)".

        Returns a single string of the form:
          "https://atelier-web.onrender.com  (project id: <id>)"
        """
        return f"{web_base()}  (project id: {project_id})"

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

"""Thin async HTTP client around the Atelier REST API.

Wraps the endpoints under `/api/v1/...` exposed by `apps/api/atelier_api`.
The MCP tool layer only ever calls into this module — keeping HTTP details
isolated makes it easy to swap a self-hosted instance via `ATELIER_API_BASE`
and to add auth headers later without touching tool definitions.
"""

from __future__ import annotations

import os
from typing import Any

import httpx

# Render free-tier forks (especially shootouts that fan out to 3 models in
# parallel) routinely take 60-80s end-to-end. 90s is the agreed timeout.
DEFAULT_TIMEOUT_SECONDS = 90.0

DEFAULT_API_BASE = "https://atelier-api-wpx8.onrender.com/api/v1"
DEFAULT_WEB_BASE = "https://atelier-web.onrender.com"


def api_base() -> str:
    """Resolve the Atelier API base URL.

    Reads `ATELIER_API_BASE` so a user with a self-hosted Atelier can swap
    in their own backend without changing tool code. Trailing slashes are
    trimmed so the join logic in callers stays simple.
    """
    raw = (os.environ.get("ATELIER_API_BASE") or DEFAULT_API_BASE).rstrip("/")
    return raw


def web_base() -> str:
    """Resolve the Atelier web (canvas UI) base URL."""
    raw = (os.environ.get("ATELIER_WEB_BASE") or DEFAULT_WEB_BASE).rstrip("/")
    return raw


class AtelierClient:
    """Async HTTP client that mirrors the FastAPI route surface 1:1.

    All methods return parsed JSON (dict or list) and raise httpx.HTTPStatusError
    on 4xx/5xx so the MCP tool wrapper can translate to a friendly message.
    """

    def __init__(self, base_url: str | None = None, timeout: float = DEFAULT_TIMEOUT_SECONDS) -> None:
        self._base = (base_url or api_base()).rstrip("/")
        self._timeout = timeout

    def _client(self) -> httpx.AsyncClient:
        # Per-call client so we don't hold a connection pool open across
        # tool invocations (MCP tool calls are independent + occasional).
        return httpx.AsyncClient(base_url=self._base, timeout=self._timeout)

    # ── Projects ────────────────────────────────────────────────────────

    async def create_project(
        self,
        name: str,
        seed_html: str | None = None,
        seed_url: str | None = None,
        style_pins: list[dict[str, Any]] | None = None,
    ) -> dict[str, Any]:
        payload: dict[str, Any] = {"name": name}
        if seed_url:
            payload["seed_url"] = seed_url
        if seed_html:
            payload["seed_html"] = seed_html
        if style_pins:
            payload["style_pins"] = style_pins
        async with self._client() as c:
            r = await c.post("/projects", json=payload)
            r.raise_for_status()
            return r.json()

    async def list_projects(self, include_archived: bool = False) -> list[dict[str, Any]]:
        async with self._client() as c:
            r = await c.get("/projects", params={"include_archived": str(include_archived).lower()})
            r.raise_for_status()
            return r.json()

    async def get_project_tree(self, project_id: str) -> dict[str, Any]:
        async with self._client() as c:
            r = await c.get(f"/projects/{project_id}/tree")
            r.raise_for_status()
            return r.json()

    # ── Nodes ───────────────────────────────────────────────────────────

    async def get_node(self, node_id: str) -> dict[str, Any]:
        async with self._client() as c:
            r = await c.get(f"/nodes/{node_id}")
            r.raise_for_status()
            return r.json()

    async def export_node(self, node_id: str) -> dict[str, Any]:
        """Returns the rendered HTML + media manifest + lineage for a variant."""
        async with self._client() as c:
            r = await c.get(f"/nodes/{node_id}/export")
            r.raise_for_status()
            return r.json()

    async def fork_node(
        self,
        parent_node_id: str,
        prompt: str,
        model: str = "sonnet",
        n: int = 1,
        shootout: bool = False,
    ) -> list[dict[str, Any]]:
        payload: dict[str, Any] = {"prompt": prompt, "model": model, "n": n, "shootout": shootout}
        async with self._client() as c:
            r = await c.post(f"/nodes/{parent_node_id}/fork", json=payload)
            r.raise_for_status()
            return r.json()

    async def publish_node(self, node_id: str) -> dict[str, Any]:
        async with self._client() as c:
            r = await c.post(f"/nodes/{node_id}/publish")
            r.raise_for_status()
            return r.json()

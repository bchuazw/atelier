"""Smoke tests: app boots, OpenAPI generates, root routes don't 500."""
from __future__ import annotations

import pytest


@pytest.mark.asyncio
async def test_openapi_generates(client):
    r = await client.get("/openapi.json")
    assert r.status_code == 200
    spec = r.json()
    assert spec["info"]["title"] == "Atelier API"
    # Spot-check the routes a paying customer's frontend depends on.
    paths = spec["paths"]
    for required in (
        "/api/v1/projects",
        "/api/v1/projects/{project_id}",
        "/api/v1/projects/{project_id}/tree",
        "/api/v1/projects/extract-design",
        "/api/v1/nodes/{node_id}/publish",
    ):
        assert required in paths, f"missing required route: {required}"


@pytest.mark.asyncio
async def test_unknown_route_404s(client):
    r = await client.get("/api/v1/does-not-exist")
    assert r.status_code == 404

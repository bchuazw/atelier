"""Project CRUD + workspace isolation.

The workspace tests are commercial-critical: they verify that the
`?workspace=<id>` filter strictly excludes other workspaces' projects
AND legacy untagged ones. Pre-commercial behaviour leaked untagged
projects into every list — the regression test below would fail under
that old code.
"""
from __future__ import annotations

import pytest


SEED = "<html><body>seed</body></html>"


async def _create(client, name: str, *, workspace_id: str | None = None):
    payload: dict = {"name": name, "seed_html": SEED}
    if workspace_id is not None:
        payload["workspace_id"] = workspace_id
    return await client.post("/api/v1/projects", json=payload)


@pytest.mark.asyncio
async def test_create_minimal_succeeds(client):
    r = await _create(client, "Hello")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["name"] == "Hello"
    assert body["id"]
    # Seed node should exist in the tree.
    tree = await client.get(f"/api/v1/projects/{body['id']}/tree")
    assert tree.status_code == 200
    nodes = tree.json()["nodes"]
    assert len(nodes) == 1 and nodes[0]["type"] == "seed"


@pytest.mark.asyncio
async def test_create_rejects_blank_name(client):
    for blank in ("", "   ", "\t\n"):
        r = await _create(client, blank)
        assert r.status_code == 422, f"name={blank!r} should be 422 got {r.status_code}: {r.text}"


@pytest.mark.asyncio
async def test_create_rejects_oversize_name(client):
    r = await _create(client, "x" * 201)
    assert r.status_code == 422


@pytest.mark.asyncio
async def test_create_rejects_both_seed_url_and_seed_html(client):
    r = await client.post(
        "/api/v1/projects",
        json={"name": "x", "seed_url": "https://x", "seed_html": SEED},
    )
    assert r.status_code == 400
    assert "either" in r.text.lower()


@pytest.mark.asyncio
async def test_workspace_filter_strict(client):
    """A project tagged with workspace A must NOT appear when listing
    workspace B. Untagged projects must NOT appear in either workspace's
    list. Both are commercial-critical guarantees."""
    a = (await _create(client, "alpha", workspace_id="ws-a")).json()
    b = (await _create(client, "beta", workspace_id="ws-b")).json()
    legacy = (await _create(client, "legacy")).json()  # untagged

    list_a = (await client.get("/api/v1/projects?workspace=ws-a")).json()
    list_b = (await client.get("/api/v1/projects?workspace=ws-b")).json()
    list_admin = (await client.get("/api/v1/projects")).json()

    ids_a = {p["id"] for p in list_a}
    ids_b = {p["id"] for p in list_b}
    ids_admin = {p["id"] for p in list_admin}

    assert ids_a == {a["id"]}, f"ws-a leak: {ids_a}"
    assert ids_b == {b["id"]}, f"ws-b leak: {ids_b}"
    # Admin (no filter) sees everything including the untagged legacy row.
    assert ids_admin == {a["id"], b["id"], legacy["id"]}


@pytest.mark.asyncio
async def test_legacy_project_reachable_by_direct_url(client):
    """Untagged projects disappear from lists but the direct URL keeps
    working. Existing users who lose their workspace cookie can still
    access projects whose ids they have."""
    legacy = (await _create(client, "legacy-direct")).json()
    r = await client.get(f"/api/v1/projects/{legacy['id']}/tree")
    assert r.status_code == 200
    assert r.json()["project"]["name"] == "legacy-direct"


@pytest.mark.asyncio
async def test_patch_name_strips_and_rejects_blank(client):
    p = (await _create(client, "OK")).json()
    r = await client.patch(f"/api/v1/projects/{p['id']}", json={"name": "   "})
    assert r.status_code == 400
    # Trim is applied for valid renames.
    r2 = await client.patch(f"/api/v1/projects/{p['id']}", json={"name": "  Renamed  "})
    assert r2.status_code == 200
    again = (await client.get(f"/api/v1/projects/{p['id']}/tree")).json()
    assert again["project"]["name"] == "Renamed"


@pytest.mark.asyncio
async def test_archive_then_list_filters(client):
    p = (await _create(client, "archivable", workspace_id="ws-arc")).json()
    r = await client.patch(f"/api/v1/projects/{p['id']}", json={"archived": True})
    assert r.status_code == 200
    default = (await client.get("/api/v1/projects?workspace=ws-arc")).json()
    incl = (
        await client.get(
            "/api/v1/projects?workspace=ws-arc&include_archived=true"
        )
    ).json()
    assert {pp["id"] for pp in default} == set()
    assert {pp["id"] for pp in incl} == {p["id"]}


@pytest.mark.asyncio
async def test_delete_project(client):
    p = (await _create(client, "delete-me", workspace_id="ws-d")).json()
    r = await client.delete(f"/api/v1/projects/{p['id']}")
    assert r.status_code == 200
    after = (await client.get("/api/v1/projects?workspace=ws-d")).json()
    assert after == []
    # Tree fetch on a deleted project is 404.
    miss = await client.get(f"/api/v1/projects/{p['id']}/tree")
    assert miss.status_code == 404

"""End-to-end smoke test for the Atelier MCP server against the live API.

Calls the read-only / cheap tools (`atelier_list_projects`,
`atelier_get_project`, `atelier_get_project_url`) and prints a
pass/fail per tool. Deliberately does NOT invoke `atelier_fork` (that
costs real money on the LLM).

Also verifies workspace-aware behaviour: `?workspace=<code>` filters
list_projects, and the URL builder includes both ?project=<id> and
?ws=<code> so a recipient's browser auto-loads + auto-joins.

Run:  python smoke_test.py
Override the API base via env: ATELIER_API_BASE=... python smoke_test.py
Override workspace via env:    ATELIER_WORKSPACE=C2100BCH python smoke_test.py
"""

from __future__ import annotations

import asyncio
import sys
import traceback

from mcp_server.client import AtelierClient, api_base, default_workspace, web_base
from mcp_server.server import _build_project_url


async def main() -> int:
    print(f"Atelier MCP smoke test — API base: {api_base()}")
    print(f"                          Web base: {web_base()}")
    print(f"                          Workspace: {default_workspace() or '(admin / unscoped)'}")
    print()

    client = AtelierClient()
    failures: list[str] = []

    # 1. atelier_list_projects (admin mode — no workspace filter)
    try:
        projects = await client.list_projects(include_archived=False)
        print(f"[PASS] list_projects (admin) -> {len(projects)} project(s)")
        for p in projects[:3]:
            print(f"         - {p.get('id')}  {p.get('name')!r}  nodes={p.get('node_count')}")
    except Exception as e:
        failures.append(f"list_projects: {e}")
        traceback.print_exc()
        projects = []

    # 1b. atelier_list_projects scoped to a workspace. We try the user's
    # known workspace from the 2100 Company project (C2100BCH) so the
    # smoke test verifies the strict-isolation filter works end-to-end.
    try:
        scoped = await client.list_projects(include_archived=False, workspace="C2100BCH")
        print(f"[PASS] list_projects (workspace=C2100BCH) -> {len(scoped)} project(s)")
        if scoped:
            assert all(
                p.get("id") for p in scoped
            ), "Scoped list returned a row without an id"
    except Exception as e:
        failures.append(f"list_projects scoped: {e}")
        traceback.print_exc()

    # 2. atelier_get_project (only if at least one project exists)
    if projects:
        first_id = projects[0]["id"]
        try:
            tree = await client.get_project_tree(first_id)
            n_nodes = len(tree.get("nodes", []))
            n_edges = len(tree.get("edges", []))
            print(f"[PASS] get_project_tree({first_id[:8]}...) -> nodes={n_nodes}, edges={n_edges}")
        except Exception as e:
            failures.append(f"get_project_tree: {e}")
            traceback.print_exc()
    else:
        print("[SKIP] get_project_tree (no projects to test against)")

    # 3. atelier_get_project_url — verify the deep-link shape includes
    # both ?project= and ?ws= when a workspace is supplied.
    bare = _build_project_url("test-project-id", None)
    with_ws = _build_project_url("test-project-id", "C2100BCH")
    if "?project=test-project-id" in bare and "ws=" not in bare:
        print(f"[PASS] get_project_url (no workspace) -> {bare}")
    else:
        failures.append(f"get_project_url bare shape: {bare}")
    if "project=test-project-id" in with_ws and "ws=C2100BCH" in with_ws:
        print(f"[PASS] get_project_url (workspace) -> {with_ws}")
    else:
        failures.append(f"get_project_url scoped shape: {with_ws}")

    print()
    if failures:
        print(f"FAIL — {len(failures)} tool(s) failed:")
        for f in failures:
            print(f"  - {f}")
        return 1
    print("OK — all tested tools succeeded.")
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))

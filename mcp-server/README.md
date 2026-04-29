# Atelier MCP Server

A [Model Context Protocol](https://modelcontextprotocol.io) server that
exposes [Atelier](https://atelier-web.onrender.com) — a canvas-first
frontend-design exploration tool — as a tool surface for Claude Code's
builder agent (or any MCP-aware client).

The server is a thin async wrapper around the deployed Atelier REST API
(`https://atelier-api-wpx8.onrender.com/api/v1`). It runs locally over
stdio; the Atelier backend stays where it is. Point at a self-hosted
Atelier instance via `ATELIER_API_BASE`.

---

## Use case

A user is building a project in Claude Code. Their boss gives them new
info ("we want to display X on the site"), but no concrete design ideas.
The user wants to:

1. Ask Claude Code: "use Atelier to brainstorm 3 directions for a section
   that explains X"
2. Claude builder agent calls Atelier MCP tools: creates a project,
   fires a `shootout` fork (Haiku + Sonnet + Opus in parallel), grabs
   the resulting variants
3. Returns to the user: "Here are 3 directions. Open
   https://atelier-web.onrender.com to view them side-by-side. Variant A
   emphasizes simplicity, B is feature-dense, C is conversion-focused."
4. User picks one in Atelier (visually), tells Claude "go with variant B"
5. Claude pulls variant B's HTML via `atelier_get_variant_html` and
   integrates it into the user's actual codebase.

---

## Installation

Requires Python 3.11+.

```bash
# From the repo root:
pip install -e mcp-server/
# OR
pip install -r mcp-server/requirements.txt
```

That installs `mcp` (the official Python SDK) and `httpx`.

---

## Running manually

```bash
./mcp-server/run.sh
# or
python -m mcp_server
```

The server listens on stdio. To smoke-test it without an MCP client, pipe
a JSON-RPC request:

```bash
echo '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | python -m mcp_server
```

You should see all 8 tools listed in the response.

A live-API smoke test is also included:

```bash
python mcp-server/smoke_test.py
```

It calls the read-only / free tools (`list_projects`, `get_project`,
`get_project_url`) against the deployed backend and prints pass/fail.
It deliberately does **not** call `atelier_fork`, since that costs real
money on the LLM.

---

## Wiring into Claude Code

Add to your Claude Code MCP config (`~/.claude/mcp.json` or the
project-local equivalent):

```json
{
  "mcpServers": {
    "atelier": {
      "command": "python",
      "args": ["-m", "mcp_server"],
      "cwd": "/absolute/path/to/atelier/mcp-server",
      "env": {
        "ATELIER_API_BASE": "https://atelier-api-wpx8.onrender.com/api/v1",
        "ATELIER_WEB_BASE": "https://atelier-web.onrender.com",
        "ATELIER_WORKSPACE": "C2100BCH"
      }
    }
  }
}
```

All three env vars are optional. Defaults point at the public Atelier
deployment. Override `ATELIER_API_BASE` to use a self-hosted backend
(e.g., `http://localhost:8000/api/v1` for local development).

`ATELIER_WORKSPACE` is the user's 8-character workspace code (visible
under TopBar → Workspace on atelier-web). When set, every project this
MCP creates is tagged with it AND every project URL the MCP returns
includes `?ws=<code>` so the user opening the URL is auto-pulled into
the right workspace and sees the project alongside its siblings. Without
it, projects this MCP creates are untagged — reachable via direct URL
only, never appearing in the user's web dashboard recents list.

After saving, restart Claude Code and run `/mcp` to confirm the
`atelier` server is connected and the 8 tools are available.

---

## Tool surface

All tools are namespaced `atelier_*` and return JSON-serializable
dicts/lists/strings.

### `atelier_create_project(name, seed_html?, seed_url?, primary_color?, body_font?, tone?) -> dict`
Creates a new exploration project. Either `seed_html` or `seed_url`
seeds the canvas root (both can be omitted for a blank seed). Brand-kit
args become typed Style Pins on creation, injected as hard constraints
into every fork prompt. Returns `{project_id, seed_node_id, web_url, name}`.
**Use when** the agent is starting a fresh exploration.

### `atelier_list_projects() -> list[dict]`
Lists existing (non-archived) projects with `id`, `name`, `node_count`,
`last_activity`, `seed_url`.
**Use when** the user references a project by name and the agent needs
its id.

### `atelier_get_project(project_id) -> dict`
Returns the full canvas tree (`{project, nodes, edges}`). Each node
includes `title`, `summary`, `parent_id`, `model_used`, `sandbox_url`,
`build_status`.
**Use when** the agent needs to inspect what variants already exist
before forking.

### `atelier_fork(parent_node_id, prompt, model="sonnet", n=1, shootout=False) -> list[dict]`
Forks a node into one or more variants. `shootout=True` is the canonical
"give me 3 directions" call: it fans out one variant per model
(Haiku + Sonnet + Opus in parallel) so the user gets genuinely different
aesthetics. Otherwise `model` (`haiku`/`sonnet`/`opus`) and `n` (1-3)
control a same-model fan. Returns `[{node_id, title, summary,
sandbox_url, model_used, build_status}, ...]`.
**Use when** the agent wants to brainstorm. Slow on Render free tier
(60-80s); the MCP client times out at 90s.

### `atelier_get_variant_html(node_id) -> dict`
Fetches the rendered HTML of a variant plus its lineage and any media
assets it references. Returns
`{html, title, summary, model_used, sandbox_url, media_assets, lineage}`.
**Use when** the user has picked a winner and the agent needs to pull
the actual HTML to integrate into the user's codebase.

### `atelier_compare(a_node_id, b_node_id) -> dict`
**Currently a stub.** The structured `StyleDiff[]` engine (categories:
copy, structure, tokens, typography, palette, spacing, effects, layout)
is implemented client-side in TypeScript and not exposed via the API.
This tool returns a pointer to the canvas's visual Compare view plus
the two sandbox URLs so the agent can suggest the user open them.
See "Deferred" below.

### `atelier_publish_variant(node_id) -> dict`
Publishes a variant to a public URL with a stable slug. Re-publishing
overwrites. Returns `{slug, public_url, published_at}`.
**Use when** the user wants to share a variant with a stakeholder
without granting canvas access.

### `atelier_get_project_url(project_id) -> str`
Returns the canvas URL the user should open. The Atelier web app does
not currently honor a `?project=<id>` deep link — opening lands the user
on the recent-projects empty state — so we return the bare base URL plus
the project id as a hint string the agent can include in its message.

---

## Deferred items / trade-offs

- **`atelier_compare` is a stub.** Atelier's diff engine
  (`apps/web/src/lib/diffStyles.ts`) computes `StyleDiff[]` entries
  client-side in TypeScript, runs DOM parsing on both variants, and
  classifies edits across 8 categories. Porting it to Python is a
  meaningful chunk of work (a few hundred lines plus a DOM library
  like `lxml` or `selectolax`). For the MVP we return a pointer to the
  visual Compare view; the agent can still tell the user "open the
  canvas, multi-select A and B, click Compare." A future revision could
  either (a) port the diff to Python, or (b) add a server-side
  `/compare` endpoint to the Atelier API and call it here.

- **No project deep-linking in the web app.** `atelier_get_project_url`
  returns the bare base URL plus the id as a hint. Adding query-string
  routing to the React app would be a few lines, but it lives outside
  this MCP server's scope.

- **No auth.** The deployed Atelier API is currently single-user / open
  on Render. If you self-host with auth, extend `client.AtelierClient`
  to inject a bearer token from `ATELIER_API_TOKEN`.

- **Cold-start tax.** Render free-tier services sleep after 15 min idle.
  The first call after a cold sleep takes ~30s for the API to wake. The
  90s timeout absorbs this, but the agent should expect occasional slow
  responses and surface that to the user.

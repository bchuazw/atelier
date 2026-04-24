# Atelier

An infinite canvas for iterative frontend craft. Seed a URL, fork a variant via Claude, compare before/after with an interactive sliding iframe viewer.

See [PLAN.md](PLAN.md) for the full design doc.

---

## What's in the box (v0.1)

- **Canvas** (React Flow): every variant is a draggable node with a live thumbnail. Edges labeled with the prompt that spawned each child.
- **Seed from URL**: paste a URL, backend fetches it with httpx + BeautifulSoup, inlines stylesheets and images under `assets/variants/<seed_id>/`.
- **Fork with Claude**: pick a model (Haiku / Sonnet / Opus), type a prompt, get a modified variant with reasoning trace + token usage stamped on the node.
- **Before/After viewer**: sliding divider, desktop/tablet/mobile toggles, overlay mode, hold-Space to flip A fullscreen. Two real interactive iframes (forms, animations, JS all work).
- **Sandbox server**: one tiny Node process serves every variant's static bundle from `/variant/<id>/*`. No dev-server-per-variant.
- **BYOK**: `.env.local` key or POST to `/api/v1/settings/api-key`.

What's **not** here yet (intentionally cut for MVP — on the roadmap in PLAN.md §14):

- AutoReason multi-iteration refinement loop (fork currently does single generation)
- Critic agents (accessibility / performance / brand / conversion)
- Feedback parsing + Playwright live-site inspection
- Voice feedback capture
- Pipeline recipes (Gemini → Kling → component)
- Code mode (tree-sitter, diffs)
- Export formats (PR descriptions, evolution MP4)
- Meeting Mode

---

## Requirements

- **Node** ≥ 20 (tested on Node 25.6)
- **Python** ≥ 3.11 (tested on 3.12)
- **pip** (no `uv` required)
- **Git Bash** or a POSIX shell on Windows, or macOS/Linux bash/zsh

---

## Setup

```bash
# 1. Configure your Anthropic key
cp .env.example .env.local
# then edit .env.local and replace ANTHROPIC_API_KEY=...

# 2. Install
cd apps/api && pip install -e . && cd ../..
cd apps/web && npm install && cd ../..

# (no install needed for sandbox-server — uses Node stdlib)
```

---

## Run it

Three services: FastAPI (8000), sandbox server (4100), Vite (3000).

**Option A — one command** (POSIX shell):

```bash
npm run dev
```

**Option B — three terminals**:

```bash
# Terminal 1 — backend
cd apps/api
python -m uvicorn atelier_api.main:app --reload --port 8000

# Terminal 2 — sandbox server
cd sandbox-server
ATELIER_ASSETS_DIR=../assets node server.js

# Terminal 3 — frontend
cd apps/web
npm run dev
```

Open **http://localhost:3000**.

---

## Demo flow

1. Click **"Create a new project"**, give it a name, paste a URL (try `https://example.com` for a fast smoke test).
2. The **seed node** appears on the canvas with a live thumbnail.
3. Click **"Fork"** on the seed, type a prompt (e.g. *"make the hero warmer and bolder"*), pick Haiku for speed, click **Fork**.
4. Claude generates a variant; it appears as a child node with its own thumbnail.
5. The **Before/After viewer** auto-opens comparing seed vs variant. Drag the divider, toggle viewports, hold **Space** to flip A fullscreen.
6. To compare any two nodes: click one (pins as **A**), click a second (pins as **B**) — viewer opens.

---

## Project layout

```
atelier/
├── apps/
│   ├── api/                # FastAPI + SQLAlchemy + SQLite
│   │   └── atelier_api/
│   │       ├── main.py
│   │       ├── config.py
│   │       ├── db/{models,session}.py
│   │       ├── llm/client.py
│   │       ├── sandbox/{fetcher,mutator}.py
│   │       └── routes/{projects,nodes,fork,settings_route}.py
│   └── web/                # Vite + React + React Flow
│       └── src/
│           ├── App.tsx
│           ├── main.tsx
│           ├── components/
│           │   ├── Canvas.tsx
│           │   ├── VariantNode.tsx
│           │   ├── BeforeAfterViewer.tsx
│           │   ├── ForkDialog.tsx
│           │   ├── NewProjectDialog.tsx
│           │   ├── TopBar.tsx
│           │   └── EmptyState.tsx
│           └── lib/{api,store}.ts
├── sandbox-server/         # 80-line Node static server for /variant/<id>/*
│   └── server.js
├── assets/                 # variant artifacts (gitignored) — created on first run
│   └── variants/<node_id>/index.html + assets/
├── scripts/
│   └── dev.sh
├── PLAN.md                 # full design spec
├── .env.example
└── README.md
```

SQLite file lives at `apps/api/atelier.db`. Delete it to reset all state.

---

## API surface

```
GET  /healthz
GET  /api/v1/settings/status
POST /api/v1/settings/api-key          { api_key }
GET  /api/v1/projects
POST /api/v1/projects                  { name, seed_url? }
GET  /api/v1/projects/:id/tree
DELETE /api/v1/projects/:id
GET  /api/v1/nodes/:id
PATCH /api/v1/nodes/:id                { position_x, position_y, title }
GET  /api/v1/nodes/:id/ancestors
POST /api/v1/nodes/:id/fork            { prompt, model, n }
```

Sandbox server:

```
GET http://localhost:4100/healthz
GET http://localhost:4100/variant/<node_id>/[path]   # serves static files
```

---

## Deviations from the plan

PLAN.md locked in Next.js + tldraw + Postgres. Implementation uses:

| Plan | Reality | Why |
|------|---------|-----|
| Next.js 15 | **Vite + React 18** | Canvas-heavy SPA; SSR is dead weight here. Vite boot is ~2s vs Next's ~8s. |
| tldraw | **React Flow 11** | React Flow is purpose-built for tree/graph UIs with custom interactive nodes. tldraw is a freeform whiteboard — embedding iframes + buttons in custom shapes is fighting the lib. |
| Postgres | **SQLite** (as already updated in PLAN) | Single-user local; zero setup. Model code migrates to Postgres with a URL swap. |
| Redis | Dropped for v1 | No multi-process pubsub needed single-user. |
| pnpm workspaces | Independent packages | `apps/web` uses npm; `apps/api` uses pip. No cross-package TS imports to coordinate yet. |

Everything else (data model, sandbox architecture, Before/After viewer UX) matches the plan.

---

## Troubleshooting

**"No Anthropic API key"** — check `.env.local` has `ANTHROPIC_API_KEY=sk-ant-...` or POST to `/api/v1/settings/api-key` from a tool like Postman.

**"Forking will fail"** banner in the UI — same as above.

**Variant shows up blank** — the seed fetcher may have failed to inline some assets. Check `apps/api/atelier.db` via `sqlite3` to see `build_status`. Retry with a simpler seed URL like `https://example.com`.

**Port already in use** — change `ATELIER_API_PORT`, `ATELIER_SANDBOX_PORT`, or `ATELIER_WEB_PORT` in `.env.local` (for the web port you'll also need to update `apps/web/vite.config.ts` proxy target).

**Reset everything** — delete `apps/api/atelier.db` and `assets/variants/*`.

---

## Security

- `.env.local` is gitignored. Never commit it.
- The Anthropic key lives in process memory + the SQLite-adjacent env. Do not share the repo directory.
- The sandbox server sets `Access-Control-Allow-Origin: *` and `Content-Security-Policy: frame-ancestors *` so the viewer can embed any variant. Fine for local dev; tighten before any public deploy.
- Variant HTML is generated by the LLM and served with scripts enabled inside a sandboxed iframe. Treat variant content as untrusted JS.

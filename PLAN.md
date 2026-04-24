# Atelier

> An infinite canvas for iterative frontend craft — where every design and code decision becomes a fork, every fork gets critiqued, and the best versions float to the top. Bring your laptop to a meeting, hook up the projector, and make live before/after changes your boss can actually *see*.

**Context:** built for a hackathon. Scope is aggressively biased toward **demo-ability** — a working local app with a killer live demo matters more than breadth.

**Name:** **Atelier** (French for artist's workshop). Locked in.

---

## 0. Handoff — read this first

**Status (as of 2026-04-24):** Phases 0–4 shipped end-to-end, hosted and verified. **SSE streaming for hero-media generation shipped (Phase 3 task 4).** Genspark turned out to have no public API, so MiniMax owns media generation; Genspark stays a sponsor name-drop / screen-recording cameo in the demo video. **Repo is now private** (github.com/bchuazw/atelier); Render keeps pulling because the GitHub App install has access to private repos.

**Hosted URLs:**
- Frontend: https://atelier-web.onrender.com
- Backend API: https://atelier-api-wpx8.onrender.com
- Sandbox proxy: https://atelier-sandbox.onrender.com
- Database + assets: Supabase project `wwioczuafjosqceqrqwm` (us-west-1, free tier)

**Key architecture notes (learned the hard way 2026-04-24):**
- Supabase Storage force-sets `Content-Type: text/plain` + `nosniff` on uploaded HTML files (XSS defense). Direct iframe loads from Supabase URLs won't render. **Fix:** the `sandbox-server` gained a PROXY mode that fetches from Supabase Storage and rewrites Content-Type from the file extension. This is the third Render service.
- Render free-tier Python can't reach Supabase's `db.<ref>.supabase.co:5432` (IPv6-only). **Fix:** point `ATELIER_DB_URL` at the Supabase **session pooler** at `aws-1-us-west-1.pooler.supabase.com:5432` (IPv4, username `postgres.<ref>`). The transaction pooler on `:6543` breaks asyncpg prepared statements; session pooler on `:5432` works fine.
- **Render web services have ephemeral disk.** A variant uploaded during one deploy vanishes from the container's local filesystem after the next redeploy. `node.build_path` alone is not a reliable source of truth — the Supabase Storage object is. **Fix:** `StorageBackend.download_variant_tree(variant_id, dest)` rehydrates any variant's files from Supabase on demand; `_ensure_parent_materialized(parent)` in [routes/media.py](apps/api/atelier_api/routes/media.py) runs before every parent-file read in both the media and fork routes and is idempotent.

**Development workflow (enforced from 2026-04-24 onward):**
1. Run locally (all 3 services) and verify via Playwright
2. Commit + push to private GitHub
3. Wait for Render auto-deploy (api + web; sandbox only rebuilds if `sandbox-server/` changed)
4. Test against live URL with Playwright
5. Update PLAN.md
6. Only then start the next big change

**Two sponsors, different roles.** Claude owns the precise HTML edits (generator + critics). **MiniMax** owns media generation (Flux-class image + Hailuo/T2V video) — this replaces what the plan originally had Genspark do (Genspark has no public API, confirmed 2026-04-24). **Genspark stays as a sponsor** via a non-API cameo in the 2-min demo video (e.g., "exported the redesign rationale as a Genspark slide deck for the boss") — the branding is in the artifact, not the code. See §22.

**Revised phase priorities (see §14 for full table):**

1. **Phase 3 — Genspark hero media pipeline** ⭐ — 🟡 partial: provider abstraction shipped, `/nodes/:id/media` route + UI dialog working with mock Genspark; SSE streaming + key-flip-to-real-Genspark still pending. See §25.1
2. **Phase 4 — Hosted deploy on Render + Supabase** — 🟡 code-shipped (storage adapter, Postgres-ready, render.yaml). Manual deploy step pending — runbook in §23.6. See §25.2
3. **Phase 5 — 2-minute Hyperframes demo video** — required submission artifact; Hyperframes chosen over Remotion (Apache 2.0, HTML-native, ~60s renders, agent-authorable)
4. **Phase 6 — AutoReason + SSE** (was Phase 3) — demoable, but now a "stretch" because hero media is the star
5. **Phase 7+ — feedback loop, critics, pipelines, code mode** — post-submission polish

**What works right now:**
- Paste a URL → seed node appears on canvas with a live iframe thumbnail
- Click Fork on any node → prompt + model picker (Haiku/Sonnet/Opus) + 1–3 variants → child nodes appear with AI-generated titles, summaries, reasoning, and token usage stamped on the card
- **Click "Hero" on any variant card → MediaDialog opens (image vs short clip, optional intent, aspect picker) → Claude drafts the prompt → Genspark renders the asset (mock placeholder when no key) → Claude rewrites HTML to use it → new variant lands on canvas, auto-pinned into Before/After viewer**
- Click a second node → Before/After viewer opens (sliding divider, desktop/tablet/mobile toggles, overlay mode, hold-Space to flip A fullscreen)
- SQLite persistence survives restarts; `smoketest` project is in the DB from the initial verification run
- All three services (FastAPI :8000, sandbox :4100, Vite :3000) boot with `npm run dev`
- Provider abstraction in `apps/api/atelier_api/providers/` (`base.py`, `claude.py`, `genspark.py`); legacy `llm/client.py` kept as a re-export shim so the existing `/fork` route is unchanged
- Storage abstraction in `apps/api/atelier_api/storage/` (`base.py`, `local.py`, `supabase.py`). Selected by `ATELIER_STORAGE_MODE` env var; local default unchanged. Hosted: variant trees upload to a Supabase public bucket on creation; iframes serve directly from Supabase Storage URLs (no sandbox-server in prod)
- `render.yaml` at repo root defines both services (FastAPI + Vite static site) — `render blueprint launch` deploys both. Frontend reads `VITE_API_BASE` at build time so the static bundle talks to the hosted backend

**What's cut / queued** (see §14 for the phase each lives in):
Genspark hero media · Render+Supabase hosted deploy · 2-min Hyperframes demo video · AutoReason refinement loop · Critic agents (a11y/perf/brand/conversion) · Feedback parsing + Playwright live-site inspection · Voice input · Pipelines · Code mode · Export formats · Meeting Mode · SSE streaming

**Start here:**
1. Read [README.md](README.md) for setup + run instructions (3 services, one `npm run dev`)
2. Confirm the smoketest project renders: `GET http://localhost:8000/api/v1/projects`
3. For the new sponsor integration, read §22 (Genspark). For the deploy shape, read §23. For the submission video, read §24.
4. For a concrete next-task list under the new priorities, jump to §25 "Revised handoff — next tasks"
5. Before touching the data model, LLM calls, or the fork route, read the gotchas in §21 — several plan details changed during implementation

**Key file pointers:**
- Data model: [apps/api/atelier_api/db/models.py](apps/api/atelier_api/db/models.py)
- LLM wrapper (model IDs, prompt caching): [apps/api/atelier_api/llm/client.py](apps/api/atelier_api/llm/client.py)
- Fork endpoint (system prompt, META parser): [apps/api/atelier_api/routes/fork.py](apps/api/atelier_api/routes/fork.py)
- Seed fetcher (inline assets, strip analytics): [apps/api/atelier_api/sandbox/fetcher.py](apps/api/atelier_api/sandbox/fetcher.py)
- Variant mutator (clone + override): [apps/api/atelier_api/sandbox/mutator.py](apps/api/atelier_api/sandbox/mutator.py)
- Sandbox static server (Node stdlib only): [sandbox-server/server.js](sandbox-server/server.js)
- Canvas + custom node: [apps/web/src/components/Canvas.tsx](apps/web/src/components/Canvas.tsx), [apps/web/src/components/VariantNode.tsx](apps/web/src/components/VariantNode.tsx)
- Before/After viewer: [apps/web/src/components/BeforeAfterViewer.tsx](apps/web/src/components/BeforeAfterViewer.tsx)
- Zustand store (canvas state, compare pins): [apps/web/src/lib/store.ts](apps/web/src/lib/store.ts)

---

## 1. The Core Idea

A Figma-style infinite whiteboard where divergent explorations of a frontend live as a visible tree. The canvas is the source of truth. Every node is a *state* (design mockup, code variant, live-site snapshot). Every edge is a *transformation* (prompt, feedback, auto-refinement). The AutoReason-style refinement loop runs on any node you point it at. Critics run in parallel. Pipelines are drag-and-droppable recipes.

**The killer demo loop (the "meeting room" scenario):**

1. Developer loads the live site (or a codebase) as the seed node
2. Boss says *"the CTA feels weak, make it bigger and warmer"*
3. Developer types that into the feedback box, hits enter
4. **Before/After viewer** opens: current site on left, AI-generated variant on right, live and interactive, slider divider between them
5. In parallel, critic agents stamp annotations (accessibility, conversion-likelihood, brand fit)
6. Boss says *"hmm, warmer but smaller"* — spawns another fork
7. Three variants now live on the canvas as sibling nodes; boss picks the winner, it becomes the new working version
8. Developer exports the diff as a migration patch

This is what we're building a demo of.

---

## 2. What Makes It Different

| Tool | What it does | What's missing |
|------|--------------|----------------|
| Figma | Infinite design canvas | No code, no AI iteration, no critics |
| v0 / Lovable / Bolt | AI site generation | Linear history, one-shot, no branching exploration |
| Cursor / Claude Code | AI code editing | No visual canvas, no design layer |
| Locofy / Builder.io | Design-to-code | Translation, not iteration |

Atelier's wedge:

1. **Visible divergence** — branches spread across a 2D canvas, so you see the *shape* of your exploration, not a linear undo stack
2. **Before/After viewer as a first-class surface** — sliding divider, live iframes, synced scroll; built for the "watch it change in front of you" meeting moment
3. **Refinement as first-class workflow** — every node spawns critique + iteration; watch the tree converge
4. **Consensus-gated quality** — no change is "done" until multiple critic agents agree it improves on the parent
5. **Feedback → Action loop** — paste vague boss feedback, system uses browser MCP to inspect the live site, proposes targeted changes, verifies, iterates until multi-model consensus lands
6. **Bring-Your-Own-Key + Model picker** — user supplies Anthropic key, picks Opus / Sonnet / Haiku per task. Run the same prompt with 3 models as sibling variants to *see* the difference
7. **Pipeline recipes** — curated multi-tool workflows as reusable cards on the canvas

---

## 3. Canvas Model

### Node types

| Type | What it holds |
|------|---------------|
| **Seed** | Root — uploaded codebase, design file, or live URL |
| **Variant** | AI-generated alternative from a prompt |
| **Feedback** | Iteration driven by free-text feedback (boss, user, metrics) |
| **Critic** | Node annotated with critic agent scores + rubric |
| **Pipeline** | Output of a multi-step asset chain (image → animation → component) |
| **Live** | Live browser snapshot fetched via Playwright MCP |
| **Code** | Code artifact (file or multi-file diff) |
| **Compare** | Virtual node representing a Before/After pairing for the viewer |

### Edge types

| Type | Meaning |
|------|---------|
| **Prompt** | Direct user instruction ("make this more playful") |
| **Feedback** | Translated from external stakeholder input |
| **Refine** | Auto-iteration loop output |
| **Fork** | Explicit branch chosen by user |
| **Merge** | User combined properties of 2+ nodes (advanced) |

### Interactions

- **Fork with prompt** — right-click node → "fork" → modal asks for prompt, N variants, model → spawns children
- **Auto-refine** — select node → "refine toward goal" → runs AutoReason loop, streams intermediate nodes onto canvas as they resolve
- **Critic sweep** — one button spawns parallel critic agents against selected node(s), each posts annotations
- **Feedback drop** — dedicated "Feedback" sidebar; paste text, system targets currently-selected branch
- **Before/After view** — select any node → opens live side-by-side with its parent (or any other selected node)
- **Rewind** — clicking a node offers "restore this as working version" — non-destructive (tree persists)
- **Compare N** — shift-click 2+ nodes for multi-way compare view with diff
- **Model shootout** — on any prompt, toggle "run with 3 models" → Opus, Sonnet, Haiku variants spawn as siblings
- **Collapse / pin / favorite** — manage canvas clutter as tree grows

---

## 4. Before/After Viewer (the headline feature)

This is what sells the app in a meeting. Every other feature feeds this surface.

### Layout

- Two live iframes side-by-side inside the viewer panel
- **Slider divider** in the middle — drag left/right to reveal more of one side
- **Synced scroll** — scrolling one scrolls the other
- **Synced hover** — hovering an element in one highlights the same region in the other
- **Synced input** — typing in a form on one side mirrors to the other (boss can test both)
- **Viewport toggle** — desktop / tablet / mobile breakpoints, both sides resize in sync
- **Overlay toggle** — swap from side-by-side to a "swipe" overlay (one iframe absolutely positioned over the other, slider reveals)
- **Diff overlay toggle** — visual pixel-diff highlighting what actually changed (red tint = removed, green = added)
- **Freeze button** — freeze current DOM state of both sides (useful when animations make comparison hard)
- **Space hotkey** — hold Space to flip between A and B fullscreen (photographer-style), release to split-view again
- **Breadcrumb lineage** — top bar shows both sides' branch path back to root: `A: Seed → warmer → bigger-CTA` vs `B: Seed → minimalist → tight-spacing`

### Comparing any two nodes on the canvas

Not just parent/child. You can compare arbitrarily distant nodes (e.g. branch 5 steps deep vs a sibling on another branch):

- **Click a node** → it highlights as "A"
- **Shift-click another** → sets as "B", viewer opens
- **Compare tray** — persistent dock at bottom of canvas with slots for up to 4 pinned nodes (A/B/C/D). Drag nodes into slots, then pick any 2 to view
- **Lineage overlay** on canvas — when comparing, the canvas draws highlighted paths from each compared node back to their common ancestor, so you understand the branch geometry
- **"Compare to parent"** quick action on any node (one click)
- **"Compare to working version"** — the current designated working-version node is always available as an implicit comparison target

Multi-way compare (N > 2): falls through to `MultiCompareGrid` (a responsive grid of synced iframes, same controls, slider disabled).

### Under the hood (see §18 for detail)

- Each variant node compiles to a static bundle on a shared lazy-build worker
- A single Node static file server (not one per variant) serves `/variant/<id>/*` for all iframes
- Animations, JS, and human interaction work natively because the built bundle is a real running app
- Pixel diff via canvas `getImageData` comparison on Playwright screenshots

### Specific meeting-room flows this supports

- **Font size tweak** — "try 18px instead of 16px" → one-click variant, side-by-side, boss eyeballs it
- **Copy change** — paste new headline text, variant renders, compare impact
- **Color palette swap** — apply brand color set, see it live on every element
- **CTA placement** — try hero vs above-the-fold vs sticky-bottom as 3 variants, compare

---

## 5. Auto-Refinement Engine (AutoReason-inspired)

Given a starting node + goal:

1. **Generate** — N variants in parallel, each with a different style/approach prompt (diverge widely)
2. **Critique** — each variant scored against the goal rubric; tradeoffs surfaced in structured form
3. **Refine** — each variant gets an improved version addressing its specific critique
4. **Consensus** — multiple models (Opus 4.7 + Sonnet 4.6 + optionally a third) vote on which refinement best achieves the goal
5. **Loop** until (a) models agree no further improvement, (b) iteration cap, or (c) user interrupts

Every step emits a **reasoning trace** rendered as an expandable panel on the edge. You see *why* v2 beat v1, not just that it did.

Loop config is per-node and user-adjustable: N variants, iteration cap, per-step model choice, rubric weights.

Refs: [NousResearch/autoreason](https://github.com/NousResearch/autoreason)

### Pseudocode

```python
async def refine(seed_node, goal, config):
    variants = await generate_variants(seed_node, goal, n=config.n, model=config.generation_model)
    for iteration in range(config.max_iterations):
        critiques = await gather(*[critique(v, goal, model=config.critique_model) for v in variants])
        refined = await gather(*[refine_variant(v, c, model=config.generation_model) for v, c in zip(variants, critiques)])
        scores = await consensus_vote(refined, goal, models=config.consensus_models)
        emit_to_canvas(refined, scores)  # stream to UI
        if converged(scores) or user_interrupted():
            break
        variants = top_k(refined, scores, k=config.n)
    return variants
```

---

## 6. Feedback Loop (the boss-feedback use case)

**Input:** *"Boss says the hero feels corporate, wants it warmer"*

**Pipeline:**

1. Parse intent → specific design axes (color temperature, typography, copy tone, imagery, spacing)
2. Playwright MCP takes a live snapshot of the current site
3. Generate 3–5 variants targeting those axes (in parallel)
4. Self-critique each against a warmth-oriented rubric
5. Render variants in their sandbox iframes; capture screenshots
6. AutoReason consensus pass — models compare screenshots side-by-side
7. Surface top variant in the **Before/After viewer** automatically
8. User slides, compares, picks, or forks again

---

## 7. Critic Agents (one-click verify)

Parallel agents, each with a specific rubric:

| Critic | What it checks | Tools used |
|--------|----------------|------------|
| **Accessibility** | WCAG, contrast, keyboard nav, ARIA | axe-core on rendered DOM |
| **Performance** | Core Web Vitals, bundle size, render cost | Lighthouse |
| **Brand consistency** | Matches loaded brand guide (colors, type, voice) | Vision model + rule checks |
| **Conversion-likelihood** | CTA prominence, trust signals, clarity | Heuristic rubric + LLM judgment |
| **Research** | How do top sites in this space solve this? | Web search + vision analysis |
| **Copy clarity** | Reading level, specificity, tone | LLM + readability metrics |
| **Mobile parity** | Responsive behavior at 3+ breakpoints | Playwright multi-viewport screenshots |

Each posts structured annotations onto the node. Composite score surfaces on the card. Click to expand reasoning.

---

## 8. BYOK + Model Picker

User flow:

1. First-run settings: paste Anthropic API key (stored in browser `localStorage` for local dev; encrypted DB column in hosted mode)
2. Per-node "model" dropdown: Opus 4.7 / Sonnet 4.6 / Haiku 4.5 (with per-token cost hints)
3. "Run with all 3" toggle — spawns 3 sibling variants, one per model, into a compare view
4. **Spend meter** — running total per project, per session; hard cap setting; warning before expensive loops
5. Model choice per step of the refinement loop — generation vs critique vs consensus can use different models
6. Token usage surfaced on every node (input / output / cache-hit %)

**Why this matters for the hackathon:** lets judges try with their own key, and the model-comparison view is itself a compelling demo ("look, Haiku nails this, no need for Opus").

---

## 9. Resource & Pipeline Library

Two libraries, both draggable onto canvas:

**Templates & inspiration** (curated links + local cache):
- [motionsites.ai](https://motionsites.ai/) — motion-heavy landing page references
- [awesome-design-md](https://github.com/VoltAgent/awesome-design-md) — prompt / rubric catalog
- Mobbin-style pattern galleries (section-level: hero, pricing, testimonial, footer)
- Dribbble / Behance curated saves

**Pipeline recipes** (reusable multi-step workflows):
- *Generate hero background*: Gemini image prompt → Kling animation → MP4 → imported as `<video>` poster
- *Design-to-component*: Figma export → vision-guided React + Tailwind
- *Brand pass*: upload brand guide → run brand-consistency critic across all canvas nodes
- *Landing page kit*: hero + features + pricing + CTA generated as linked children
- *Seedance motion sweep*: static section → 3 motion treatments (subtle / bold / playful)

Users drag a recipe onto the canvas; it becomes a parameterized pipeline node.

---

## 10. Tech Stack (locked in)

> **v0.1 implementation note:** the shipped code deviates from the original "locked in" choices below — Vite instead of Next.js, React Flow instead of tldraw, npm/pip instead of pnpm/uv. See the deviation table in [README.md](README.md#deviations-from-the-plan) for rationale. The rest of this section reflects the *plan-of-record* (hosted target) so the migration path stays clear.

| Layer | Plan (hosted target) | v0.1 reality | Notes |
|-------|----------------------|--------------|-------|
| Canvas | tldraw | **React Flow 11** | React Flow is purpose-built for tree/graph UIs with interactive custom nodes; tldraw fights against embedded iframes + buttons |
| Frontend | Next.js 15 + React 19 | **Vite 6 + React 18** | Canvas-heavy SPA, no SSR value; ~2s boot vs Next's ~8s |
| Styling | Tailwind 4 + shadcn/ui | **Tailwind 3 + hand-rolled** | shadcn not needed at current component count |
| State (client) | Zustand + React Query | **Zustand only** | API surface is small enough that hand-written fetch wrappers beat React Query |
| LLM orchestration (text + code) | Anthropic SDK (Opus 4.7 / Sonnet 4.6 / Haiku 4.5) | same | Aggressive prompt caching, user-supplied key. "The generator." |
| **Media generation** | **MiniMax API** (image-01 + T2V-01-Director) | **shipped — Phase 3** | Genspark replacement. Image: ~18s, 1280×720 JPEG. Video: async, 1–3 min. See §22 |
| **Web search grounding** | deferred — originally planned for Genspark's search API | n/a | Not critical for submission; kept as Phase 7 idea |
| Browser automation | Playwright (pooled) | **not yet wired** | Phase 6 — live-site inspection still on the roadmap |
| Sandbox serving | Single Node static server → `/variant/<id>/*` | **Node stdlib `http` server on :4100 — two modes: `local` (reads disk) + `proxy` (fetches from Supabase Storage, rewrites Content-Type)** | Supabase force-sets text/plain on HTML; the proxy exists to restore correct MIME. Hosted topology deploys this as its own Render web service |
| Code analysis | Tree-sitter + AST | not yet wired | Phase 7+ |
| Backend | FastAPI + asyncio | same | |
| DB (v1 local) | SQLite via SQLAlchemy + aiosqlite | same | |
| **DB (hosted)** | **Supabase Postgres (managed, free tier generous)** | **Phase 4** | URL-swap migration path preserved. Supabase also provides auth + Storage in one, which we'll reuse |
| **Asset storage (hosted)** | **Supabase Storage bucket `variants/`** | **Phase 4** | Replaces local `assets/variants/<id>/`. Public bucket; iframe URLs are Supabase Storage URLs |
| Queue / pubsub | In-process asyncio queues + SSE | **synchronous fork only** | SSE streaming needed for hero-media flow (5–60s latency) — Phase 3 |
| Assets | Local disk `assets/` (dev); Supabase Storage (hosted) | `assets/variants/<node_id>/` | gitignored |
| Realtime | Server-Sent Events | not yet wired | Phase 3 |
| Voice input | Web Speech API | not yet wired | Phase 7+ |
| **Hosting (sponsor-friendly pick)** | **Render (backend web service + static site for frontend) + Supabase (DB + Storage)** | **Phase 4** | `render.yaml` as IaC. Deploy via Render CLI. See §23 |
| **Demo video** | **Hyperframes (HTML-based, Apache 2.0, agent-authored MP4)** | **Phase 5** | Beats Remotion for our use case: Claude can write the composition as HTML, 60s renders, 4MB output, no React build step. See §24 |
| Dev infra | `scripts/dev.sh` — no docker | same (`npm run dev`) | |
| Package manager | pnpm + uv | **npm + pip** | No cross-package TS imports yet, so monorepo tooling is overkill |

**Why SQLite for v1:**
- Hackathon scope = single-user, single-machine. SQLite handles this trivially
- Zero setup — no docker, no postgres install, no `brew services start`. `pnpm dev` just works
- The whole DB is one file — easy to reset, ship, back up, send to a teammate
- SQLAlchemy 2 + aiosqlite gives async support; migration path to Postgres is a URL swap
- SQLite JSON functions (`json_extract`, `jsonb` in 3.45+) are sufficient for our metadata needs

**When to upgrade to Postgres/Supabase:**
- Multi-user (each project owned by an account) — Supabase auth + row-level security is the easy win
- Concurrent writes from multiple processes (we won't have this in v1)
- Full-text search over critic reports or reasoning traces (Postgres `tsvector` is much better)
- Hosted deploy for judges to try — at that point, Supabase (managed Postgres + auth + storage in one) is the right lift

**Prompt caching note:** critics and refinement loops reuse large context (brand guide, codebase summary, goal rubric, canvas history). Aggressive Anthropic cache breakpoints on static prefixes can cut token cost 70%+.

---

## 11. Data Model

SQLite-compatible DDL. Uses `TEXT` UUIDs (SQLite has no native UUID), `JSON` (SQLite JSON1 is built in), and ISO-8601 `TEXT` timestamps. Migration to Postgres is a find/replace (`TEXT` UUID → `uuid`, `JSON` → `JSONB`, etc.) or just swap the SQLAlchemy column types — the models stay identical.

```sql
-- Project: one per hackathon "scenario" or demo
CREATE TABLE project (
  id            TEXT PRIMARY KEY,         -- uuid4 as text
  name          TEXT NOT NULL,
  seed_url      TEXT,                     -- live URL seed (if applicable)
  seed_repo     TEXT,                     -- codebase seed (if applicable)
  owner_id      TEXT,                     -- null for local-only
  settings      JSON NOT NULL,            -- model prefs, spend cap, etc.
  working_node_id TEXT,                   -- current "applied" version
  created_at    TEXT DEFAULT (datetime('now'))
);

CREATE TABLE node (
  id            TEXT PRIMARY KEY,
  project_id    TEXT NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  parent_id     TEXT REFERENCES node(id),
  type          TEXT NOT NULL,            -- seed | variant | feedback | critic | pipeline | live | code | compare
  title         TEXT,                     -- AI-generated short label (see §20)
  summary       TEXT,                     -- one-sentence "what changed" summary
  artifact_path TEXT,                     -- disk path to snapshot/code/design
  build_path    TEXT,                     -- disk path to built static bundle (null = unbuilt)
  build_status  TEXT DEFAULT 'pending',   -- pending | building | ready | error
  thumbnail_path TEXT,                    -- small screenshot for canvas card
  metadata      JSON NOT NULL DEFAULT '{}',
  reasoning     JSON,                     -- why this node exists (LLM trace)
  position_xy   JSON,                     -- {x, y} for canvas layout
  pinned        INTEGER DEFAULT 0,
  created_by    TEXT NOT NULL,            -- user_id | agent_name
  model_used    TEXT,                     -- opus-4-7 | sonnet-4-6 | haiku-4-5
  token_usage   JSON,                     -- {input, output, cache_read, cache_write}
  created_at    TEXT DEFAULT (datetime('now'))
);
CREATE INDEX idx_node_project ON node(project_id);
CREATE INDEX idx_node_parent  ON node(parent_id);

CREATE TABLE edge (
  id            TEXT PRIMARY KEY,
  from_node_id  TEXT NOT NULL REFERENCES node(id) ON DELETE CASCADE,
  to_node_id    TEXT NOT NULL REFERENCES node(id) ON DELETE CASCADE,
  type          TEXT NOT NULL,            -- prompt | feedback | refine | fork | merge
  prompt_text   TEXT,
  reasoning     JSON,
  created_at    TEXT DEFAULT (datetime('now'))
);

CREATE TABLE critic_report (
  id            TEXT PRIMARY KEY,
  node_id       TEXT NOT NULL REFERENCES node(id) ON DELETE CASCADE,
  critic_name   TEXT NOT NULL,
  score         REAL,
  annotations   JSON NOT NULL,            -- structured findings + selectors
  created_at    TEXT DEFAULT (datetime('now'))
);

CREATE TABLE feedback_item (
  id              TEXT PRIMARY KEY,
  project_id      TEXT NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  source          TEXT NOT NULL,          -- boss | user | metric | self
  raw_text        TEXT NOT NULL,
  voice_audio_path TEXT,                  -- for voice-dictated feedback
  parsed_intent   JSON,
  target_node_id  TEXT REFERENCES node(id),
  status          TEXT NOT NULL,          -- pending | processing | applied | rejected
  created_at      TEXT DEFAULT (datetime('now'))
);

CREATE TABLE pipeline (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  steps         JSON NOT NULL,            -- ordered list of step configs
  is_template   INTEGER DEFAULT 0,
  owner_id      TEXT
);

CREATE TABLE refinement_job (
  id            TEXT PRIMARY KEY,
  project_id    TEXT NOT NULL REFERENCES project(id),
  seed_node_id  TEXT NOT NULL REFERENCES node(id),
  goal          TEXT NOT NULL,
  config        JSON NOT NULL,            -- model choices, iteration cap, N
  status        TEXT NOT NULL,            -- pending | running | done | cancelled | error
  progress      JSON,                     -- current iteration, variants resolved
  created_at    TEXT DEFAULT (datetime('now'))
);

-- Canvas-wide pins for the compare tray (up to 4 slots)
CREATE TABLE compare_pin (
  project_id    TEXT NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  slot          TEXT NOT NULL,            -- 'A' | 'B' | 'C' | 'D'
  node_id       TEXT NOT NULL REFERENCES node(id) ON DELETE CASCADE,
  PRIMARY KEY (project_id, slot)
);
```

---

## 12. Repository Structure

> **v0.1 reality:** Shipped tree is leaner than the plan below — no `packages/`, no pnpm workspaces, no Alembic. The as-built layout is documented in [README.md § Project layout](README.md#project-layout). The tree below is the *plan-of-record* for when Phases 3+ land; use it as a target, not a description of what exists.

Plan target (monorepo with pnpm workspaces + a Python package for the backend):

```
atelier/
├── PLAN.md                          # this file
├── README.md                        # setup + run instructions
├── pnpm-workspace.yaml
├── package.json
├── .env.example
│
├── apps/
│   ├── web/                         # Next.js 15 frontend
│   │   ├── app/
│   │   │   ├── layout.tsx
│   │   │   ├── page.tsx             # landing → project picker
│   │   │   ├── (canvas)/
│   │   │   │   └── [projectId]/
│   │   │   │       ├── page.tsx     # main canvas view
│   │   │   │       └── compare/
│   │   │   │           └── page.tsx # full-screen before/after viewer
│   │   │   ├── api/
│   │   │   │   ├── proxy/
│   │   │   │   │   └── [...path]/route.ts  # proxies to FastAPI
│   │   │   │   └── sse/
│   │   │   │       └── [jobId]/route.ts    # refinement stream
│   │   │   └── settings/
│   │   │       └── page.tsx         # BYOK, model prefs, spend cap
│   │   ├── components/
│   │   │   ├── canvas/
│   │   │   │   ├── Canvas.tsx       # tldraw wrapper
│   │   │   │   ├── NodeShape.tsx    # custom tldraw shape for our nodes
│   │   │   │   ├── EdgeShape.tsx
│   │   │   │   └── canvasStore.ts   # zustand
│   │   │   ├── nodes/
│   │   │   │   ├── SeedNode.tsx
│   │   │   │   ├── VariantNode.tsx
│   │   │   │   ├── FeedbackNode.tsx
│   │   │   │   ├── CriticNode.tsx
│   │   │   │   ├── PipelineNode.tsx
│   │   │   │   └── LiveNode.tsx
│   │   │   ├── viewers/
│   │   │   │   ├── BeforeAfterViewer.tsx     # the headline surface
│   │   │   │   ├── SliderDivider.tsx
│   │   │   │   ├── ViewportToggle.tsx
│   │   │   │   ├── SyncedIframes.tsx         # postMessage scroll sync
│   │   │   │   ├── PixelDiffOverlay.tsx
│   │   │   │   └── MultiCompareGrid.tsx      # N-way compare
│   │   │   ├── sidebars/
│   │   │   │   ├── FeedbackSidebar.tsx
│   │   │   │   ├── CriticSidebar.tsx
│   │   │   │   ├── LibrarySidebar.tsx        # templates + pipelines
│   │   │   │   └── ReasoningTracePanel.tsx
│   │   │   ├── critics/
│   │   │   │   ├── CriticBadge.tsx
│   │   │   │   └── AnnotationOverlay.tsx
│   │   │   ├── fork/
│   │   │   │   ├── ForkDialog.tsx            # prompt, N, model picker
│   │   │   │   └── ModelShootoutDialog.tsx
│   │   │   └── ui/                            # shadcn primitives
│   │   ├── lib/
│   │   │   ├── api.ts               # fetch wrapper to FastAPI
│   │   │   ├── sse.ts               # EventSource helper
│   │   │   ├── byok.ts              # localStorage key mgmt
│   │   │   ├── sandbox.ts           # iframe sandbox helpers
│   │   │   └── diff.ts              # pixel diff utilities
│   │   ├── public/
│   │   └── next.config.ts
│   │
│   └── api/                         # FastAPI backend
│       ├── pyproject.toml
│       ├── atelier.db               # SQLite file (gitignored)
│       ├── atelier_api/
│       │   ├── main.py              # FastAPI app + router wiring
│       │   ├── config.py
│       │   ├── db/
│       │   │   ├── models.py        # SQLAlchemy models (SQLite for v1, Postgres-compat)
│       │   │   ├── migrations/      # alembic (works on both)
│       │   │   └── session.py       # aiosqlite driver
│       │   ├── routes/
│       │   │   ├── projects.py
│       │   │   ├── nodes.py
│       │   │   ├── edges.py
│       │   │   ├── refinement.py    # POST /refine, SSE /stream/:jobId
│       │   │   ├── feedback.py
│       │   │   ├── critics.py
│       │   │   ├── pipelines.py
│       │   │   ├── sandbox.py       # iframe/sandbox URL issuance
│       │   │   └── settings.py
│       │   ├── agents/
│       │   │   ├── base.py          # Agent protocol + shared utils
│       │   │   ├── generator.py     # variant generation
│       │   │   ├── critic.py        # critique generation
│       │   │   ├── consensus.py     # multi-model voting
│       │   │   ├── feedback_parser.py
│       │   │   └── critics/
│       │   │       ├── accessibility.py
│       │   │       ├── performance.py
│       │   │       ├── brand.py
│       │   │       ├── conversion.py
│       │   │       ├── research.py
│       │   │       ├── copy_clarity.py
│       │   │       └── mobile_parity.py
│       │   ├── refinement/
│       │   │   ├── engine.py        # the AutoReason loop
│       │   │   ├── scoring.py
│       │   │   └── prompts/         # versioned system prompts
│       │   │       ├── generate.md
│       │   │       ├── critique.md
│       │   │       └── consensus.md
│       │   ├── pipelines/
│       │   │   ├── runner.py
│       │   │   ├── steps/
│       │   │   │   ├── gemini_image.py
│       │   │   │   ├── kling_motion.py
│       │   │   │   ├── seedance_motion.py
│       │   │   │   └── import_component.py
│       │   │   └── templates/       # recipe JSON
│       │   ├── sandbox/
│       │   │   ├── builder.py       # compiles variant source → static bundle
│       │   │   ├── server.py        # single Node static server lifecycle
│       │   │   ├── router.py        # maps /variant/<id> → disk path
│       │   │   ├── playwright_pool.py  # max-4 browser pool for screenshots
│       │   │   ├── snapshot.py      # Playwright thumbnail + screenshot logic
│       │   │   └── mutator.py       # applies variant deltas to seed HTML
│       │   ├── llm/
│       │   │   ├── client.py        # Anthropic SDK wrapper w/ BYOK
│       │   │   ├── cache.py         # prompt cache block management
│       │   │   └── token_accounting.py
│       │   └── storage/
│       │       ├── local.py         # filesystem for local dev
│       │       └── s3.py            # later
│       └── tests/
│
├── packages/
│   ├── shared-schema/               # TS types mirroring backend
│   │   ├── src/
│   │   │   ├── node.ts
│   │   │   ├── edge.ts
│   │   │   ├── job.ts
│   │   │   └── index.ts
│   │   └── package.json
│   └── canvas-layout/               # tree layout helpers (dagre wrapper)
│       └── src/
│           └── treeLayout.ts
│
├── sandbox-server/                  # tiny standalone Node service
│   ├── package.json
│   ├── server.ts                    # serves /variant/<id>/* from disk, nothing else
│   └── README.md
│
└── scripts/
    ├── dev.sh                       # spin up web + api + sandbox-server + playwright install
    ├── seed-demo.sh                 # load a demo project for judges
    └── reset-db.sh                  # delete atelier.db and re-run migrations
```

---

## 13. Key API Endpoints

All under `/api/v1`. REST + SSE; no GraphQL overhead.

```
# Projects
POST   /projects                    create new project (seed: url | repo | blank)
GET    /projects/:id
GET    /projects/:id/tree           full node/edge graph for canvas hydration
DELETE /projects/:id

# Nodes
POST   /projects/:id/nodes          create node (usually via a fork, not manually)
GET    /nodes/:id                   full node detail + artifact URL
PATCH  /nodes/:id                   rename, reposition, pin/favorite
DELETE /nodes/:id                   soft-delete (marks branch hidden)

# Fork / Generate
POST   /nodes/:id/fork              { prompt, n, model, shootout? } → spawns children
                                     returns: { jobId, childNodeIds }

# Refinement (the AutoReason loop)
POST   /nodes/:id/refine            { goal, config } → creates refinement_job
GET    /refinement/:jobId           job status + progress
GET    /refinement/:jobId/stream    SSE — streams node-resolved events as variants land

# Feedback
POST   /projects/:id/feedback       { raw_text, target_node_id } → parses + queues
GET    /feedback/:id

# Critics
POST   /nodes/:id/critique          { critics: [names] } → parallel job, returns jobId
GET    /critic-reports/:id

# Before/After
GET    /compare?left=:nodeId&right=:nodeId      returns sandbox URLs for both

# Sandbox
POST   /nodes/:id/sandbox           ensures a live sandbox exists, returns iframe URL
DELETE /sandbox/:id                 tear down

# Pipelines
GET    /pipelines/templates
POST   /projects/:id/pipelines/run  { pipeline_id | steps, target_node_id }

# Settings (BYOK)
POST   /settings/api-key            store encrypted (hosted) / passes through (local)
GET    /settings/spend              { total, by_model, by_project }

# Health
GET    /healthz
```

---

## 14. Phased Build

Hackathon-first. The **Demoable** column marks whether the end of that phase makes a compelling live demo. Phases 3–5 are the new "submission scope" — everything below 5 is post-submission polish.

| Phase | Status | Goal | Demoable? |
|-------|--------|------|-----------|
| **0 — Foundation** | ✅ shipped | FastAPI + SQLite + React Flow canvas; node/edge CRUD; BYOK settings (Vite+React Flow shipped in place of Next.js+tldraw — see §17) | no |
| **1 — First fork** | ✅ shipped | Seed from URL (httpx + BeautifulSoup, no Playwright yet) → single variant via Claude → child node on canvas, model picker functional (Haiku/Sonnet/Opus) | barely |
| **2 — Before/After viewer** ⭐ | ✅ shipped | Split iframes, slider, viewport toggle, overlay mode, hold-Space fullscreen flip. Pixel-diff overlay NOT wired (see §21) | **YES — current MVP demo** |
| **3 — MiniMax hero media** ⭐⭐ | ✅ shipped | Provider abstraction (`providers/claude.py` + `providers/minimax.py`, genspark removed). "Generate hero media" action on any variant: Claude writes the image prompt → MiniMax renders image (1280×720 JPEG) or short MP4 → mutator swaps hero → new variant on canvas. Verified E2E with Playwright. SSE streaming deferred to Phase 6 | **YES — NEW headline demo. "Customize this site to fit my brand."** |
| **4 — Hosted deploy (Render + Supabase)** | 🟡 in flight | `render.yaml` for 3 services (api + web + sandbox-proxy). SQLAlchemy URL-swap to Supabase Postgres. Asset writes go to Supabase Storage bucket; iframes route through the sandbox proxy (Supabase forces text/plain on HTML, see §23). Deploy via Render API. Judges get a testable URL | **Required** — judges ask for a link |
| **5 — Demo video (Hyperframes)** | 🔲 | 2-minute composition authored as HTML. Screen captures of real app (browser recording or Playwright capture) + overlay captions + AI voice track + generated "after" assets. Rendered to MP4 via Hyperframes CLI. Video artifact is a submission deliverable alongside the live URL. See §24. | **Required** — submission artifact |
| **6 — AutoReason + shootout + feedback** | 🔲 | Full AutoReason refinement loop. Model shootout (3-way siblings). Feedback sidebar → intent parse → targeted variants. Playwright lands here. Was Phase 3/4 in the original plan; demoted because Phase 3 Genspark is now the headline | YES — richer demo if time |
| **7 — Critics** | 🔲 | 3 critics minimum (a11y, performance, conversion-likelihood), annotations overlay, composite scoring. "Research" critic uses Genspark web search | yes |
| **8 — Pipelines + library** | 🔲 | Drag-and-drop recipe cards, template gallery, 2 working pipelines (one Genspark-backed hero recipe, landing-page-kit) | yes |
| **9 — Code mode** | 🔲 | Tree-sitter, code diffs, architecture refactor | post-hackathon |
| **10 — Multi-user SaaS** | 🔲 | Auth via Supabase, row-level security, project sharing | post-hackathon |

**Current state:** end of Phase 2, redirecting into Phase 3 (Genspark). The submission target is end of Phase 5 (hero media + hosted URL + demo video). See §25 for the ordered next-task list.

---

## 15. Demo Script (2 minutes, for the submission video)

Target: **120 seconds** total. Video is authored in Hyperframes (§24) and rendered to MP4. Judges also get the hosted URL (§23) so they can replicate the flow live. Every beat uses at least one sponsor capability.

| Time | Beat | Sponsor shown |
|------|------|---------------|
| **0:00–0:10** | Title card: "Atelier — an infinite canvas for iterative frontend craft." Tagline overlay: "Powered by Claude + Genspark." | both (branding) |
| **0:10–0:25** | Paste a URL (real landing page). Seed node lands on canvas. Hover: card shows live thumbnail, URL, breadcrumb. | — |
| **0:25–0:45** | Click **Fork**. Prompt: *"make the hero warmer and more playful."* Model: Sonnet. 3 variants stream onto canvas (SSE). Right panel streams reasoning traces. | **Claude** (code gen) |
| **0:45–1:10** | Click "Generate Hero Media" on the best variant. Claude writes the image prompt (shown on-screen), Genspark renders a custom hero image (Flux) — 5–10s. New sibling variant appears with the generated imagery swapped into the DOM. | **both** — Claude briefs, Genspark renders |
| **1:10–1:30** | Before/After viewer: original landing page on left, Atelier-customized version with AI-generated hero on right. Drag slider, toggle desktop→mobile. Hero image morphs. "This is the boss-moment." | — (the payoff shot) |
| **1:30–1:45** | Model shootout cameo: same prompt, 3 sibling variants (Haiku / Sonnet / Opus) appear side-by-side. Token costs overlaid on each card. Haiku is "fast and cheap"; Opus is "high-fidelity." | **Claude** |
| **1:45–1:55** | Quick cut: Genspark generates a 3-second hero motion clip (Kling). Swapped in as `<video autoplay loop>`. Hero now *moves*. | **Genspark** (video) |
| **1:55–2:00** | Outro card. "Try it: atelier.onrender.com · built with Claude + Genspark · [GitHub link]." | both (branding) |

**On-stage fallback (if judges want a live walkthrough):** the hosted URL (§23) supports all 7 beats. Keep a pre-seeded project ready to skip the initial seed-fetching wait.

---

## 16. Risks & Open Concerns

1. **Sandbox approach** — solved by the static-bundle-per-variant design (see §18). One Node process serves all variants, no dev server per node, animations/interaction still work because the built JS runs in the iframe.
2. **Refinement latency** — an AutoReason loop with 3 variants × 2 iterations could take 30s+. Streaming is mandatory. Haiku as the default critique model is a good lever.
3. **Token cost in demo** — one full demo could be $0.50–$2 in tokens. Fine for hackathon. Need spend cap UI before any public deploy.
4. **Playwright concurrency** — running many browser instances locally hits RAM fast. Use a pool with max 4 concurrent.
5. **Canvas performance** — tldraw with 200+ custom-shape nodes may lag. Virtualize aggressively; collapse old branches by default.
6. **Feedback parsing ambiguity** — "make it warmer" is hard to ground. Parser must surface its interpretation back to the user as a structured intent they can edit before generation runs.
7. **Build times for variants** — if each variant takes 10s to build (Vite on a real app), a fork of 3 = 30s before they're viewable. Mitigations: lazy build (only on first view), shared node_modules across variants, cached dependency layer, show thumbnail screenshot from Playwright immediately while build warms.

---

## 17. Decisions (locked in)

| # | Decision | Status |
|---|----------|--------|
| 1 | Design mode first. Code mode deferred to post-hackathon | ✅ holds |
| 2 | ~~tldraw for canvas~~ → **React Flow 11** | 🔄 changed — see §10 / README deviation table |
| 3 | Solo / single-user v1. The "meeting room projector" is the target UX | ✅ holds |
| 4 | Local dev first. Hosted SaaS after hackathon so judges can try it (no docker — single `npm run dev` instead of docker-compose) | ✅ holds (dev infra simpler than planned) |
| 5 | BYOK + per-task model picker (Opus/Sonnet/Haiku). Shootout + spend meter NOT yet implemented | 🟡 partial — model picker shipped, shootout + spend meter deferred |
| 6 | Static diffs for code mode v1; sandbox execution later | ✅ holds (code mode still deferred) |
| 7 | Local-only until end of Phase 4; then ship hosted | ✅ holds |
| 8 | **Vite + React 18 instead of Next.js 15 + React 19** (added during build — SPA, no SSR value) | new |
| 9 | **npm + pip instead of pnpm + uv** (no cross-package TS imports yet, so workspace tooling is overkill) | new |
| 10 | **Variants clone the full parent tree to disk** instead of the delta/overlayfs strategy from §18. Simpler, trivial at hackathon scale (20 variants × ~2MB). Revisit if variant count or tree depth explodes | new |
| 11 | **Seeds are static HTML bundles** (httpx + BeautifulSoup inlines assets) — no Playwright for seeding yet. Playwright lands in Phase 6 for live-site inspection. Zero-install dev per §18 | new |
| 12 | **Genspark covers all media generation** (image, short video, web search). Claude stays the text/code generator. One provider abstraction in `providers/` with `claude.py` + `genspark.py`. Design against the OpenAI-compatible shape until sponsor provides official docs | new (Phase 3) |
| 13 | **Hero media is the headline demo, not AutoReason.** Claude writes the image prompt from the current HTML + user intent; Genspark renders; mutator swaps the hero tag. AutoReason demoted to Phase 6 | new |
| 14 | **Render + Supabase for hosted deploy.** Backend = Render Web Service (FastAPI), frontend = Render Static Site (Vite build), DB = Supabase Postgres, assets = Supabase Storage. Sandbox server either redeployed as second Render Web Service OR (preferred) collapsed: variants uploaded to Supabase Storage, iframes point at public Storage URLs | new (Phase 4) |
| 15 | **Hyperframes over Remotion for the 2-min video.** HTML-based (matches Atelier's whole mental model), Apache 2.0 (no licensing risk), ~60s renders, Claude can author the composition directly. Remotion would force a React build we don't need | new (Phase 5) |
| 16 | **Feature flag for Genspark until sponsor key arrives.** Implement the provider and UI path; `GENSPARK_API_KEY` empty ⇒ the "Generate Hero Media" button shows a stubbed mock (fixed local image) so dev isn't blocked. When key arrives, flip one env var | new |

---

## 18. Sandbox Architecture (how the Before/After viewer actually runs)

This is the trickiest piece of the system. We need **two interactive iframes side-by-side, both with live JS/animations/forms/scroll**, and the boss needs to be able to click buttons, hover things, and see real state. Dev server per variant doesn't scale — 10 variants on the canvas = 10 node processes, gigabytes of RAM, slow.

### The approach: build once, serve statically, from a single Node process

1. **Variants are data, not processes.** Each variant node stores its source tree on disk under `assets/variants/<node_id>/src/`.
2. **Builds are lazy and cached.** When a variant is first opened in the Before/After viewer, a build worker (shared across all variants) runs `vite build` (or the project's configured build command). Output goes to `assets/variants/<node_id>/dist/`. Once built, it stays built until the source changes — which in our model rarely happens, since variants are immutable snapshots.
3. **One tiny static file server serves every variant.** `sandbox-server/server.ts` is ~30 lines of Hono/sirv code. It listens on a dedicated port (say `:4100`). Request to `http://localhost:4100/variant/<node_id>/index.html` → streams from `assets/variants/<node_id>/dist/index.html`. No dev server, no HMR, no per-variant process.
4. **Iframes point at that server.** Before/After viewer is two iframes: `src="http://localhost:4100/variant/A/"` and `src="http://localhost:4100/variant/B/"`. Fully interactive. Animations work. JS runs. Human can click, type, submit forms.
5. **Cross-origin strategy.** The sandbox server runs on its own port, so iframes are cross-origin from the Next.js app. That's fine — we communicate via `postMessage` for scroll/hover/input sync. We set `Access-Control-Allow-Origin: http://localhost:3000` in the sandbox server.

### Deltas, not duplicates

A typical fork changes 3–10 files in a project of hundreds. Storing a full copy of `node_modules/` per variant is insane. Two strategies:

- **Layered source:** each variant stores only its *diff* from its parent (file adds/edits/deletes). At build time, we materialize the full source by walking the parent chain and applying deltas into a temp dir (or via overlayfs on Linux, fallback copy on macOS/Windows). Dependencies are the parent's, shared via symlink — one `node_modules/` per project, not per variant.
- **Zero-install dev:** if the seed is a pure HTML/CSS/JS site (no build step), skip the build entirely. Just serve the variant's file tree directly. This is probably what we start with for hackathon demos.

### For live-URL seeds (no codebase)

When the seed is just a URL (`https://somelanding.com`), we don't have source. So:

1. Playwright fetches the page, inlines/downloads CSS + JS + images into `assets/seed/`
2. That becomes a self-contained "pseudo-codebase" for the seed node
3. Variants apply DOM/CSS mutations (via a `mutator.py` that rewrites HTML + adds a stylesheet override) and save the result as their own directory
4. Iframes serve from those directories. Everything works the same way

### Playwright only for screenshots

Playwright is expensive. We only use it for:
- Initial seed capture from a live URL (one-shot per project)
- Thumbnail screenshots for canvas node cards (one-shot per variant)
- Pixel diff source images (on-demand when user toggles diff overlay)
- Critic agent rendering (accessibility, performance, mobile parity)

It is **not** the thing serving the iframes. That's the cheap static server. Keeps the Playwright pool free for the genuinely async work.

### What we give up (and why it's OK)

- **No HMR on variants.** Variants are snapshots, not "the thing you're editing". If you want to tweak a variant, you fork it into a new variant. This is actually *good* — it's the whole point of the canvas.
- **No true isolation between projects** (one shared Node process for all variant serving). For hackathon local dev, fine. For hosted multi-tenant, add a sandbox-server-per-project or move to Cloudflare Workers / e2b.

### Capacity math

- 20 variants on canvas × 2MB built bundle = 40MB disk. Trivial.
- 1 Node static server = ~30MB RAM. One process.
- Playwright pool (4 concurrent) = ~400MB RAM while active.
- Total local footprint: well under 1GB, runs fine on any laptop brought to a meeting.

---

## 19. Additional Features & Polish (high-leverage additions)

These aren't in the core spec above but each is cheap and demo-gold.

### 19.1 Voice feedback capture ⭐

The meeting-room use case begs for this. Boss is talking, you're typing? No. Click the mic button in the Feedback sidebar, boss speaks, Web Speech API transcribes, feedback text populates, hit enter. Zero setup, browser-native, free.

- **Record button** in Feedback sidebar
- Live transcription streams into the text box as they speak
- "Stop + send" ends recording and fires the feedback pipeline
- Transcript saved on the `feedback_item` row for audit

### 19.2 Meeting Mode

A full-screen view that hides the canvas chrome. Just: before/after viewer + feedback input + model picker. Toggled by `M` key. For when you're projecting and don't want the boss distracted by the nested tree of experiments.

### 19.3 Keyboard shortcuts (Figma-style)

| Key | Action |
|-----|--------|
| `Space` (hold) | Flip A/B fullscreen in viewer |
| `M` | Toggle Meeting Mode |
| `F` | Focus Feedback sidebar |
| `/` | Command palette (fork, refine, critique, compare) |
| `Cmd+K` | Quick fork with prompt |
| `Cmd+Enter` | Run refinement loop on selected node |
| `Cmd+D` | Compare selected to working version |
| `1` / `2` / `3` | Cycle viewport: desktop / tablet / mobile |
| `C` | Critic sweep on selected |
| `Shift+Click` | Add to compare selection |

### 19.4 AI branch naming

When a variant is generated, the same LLM call asks for a 3–5 word descriptor. Saves to `node.title`. The canvas becomes scannable instead of "variant_3f2a1c". Examples: "Bolder hero + warm palette", "Sticky CTA, tighter spacing", "Minimalist, single CTA".

### 19.5 Live thumbnails on nodes

Every variant card shows its Playwright thumbnail as the card face (not a generic icon). Canvas = instantly visual. Refreshed on build completion.

### 19.6 "Explain this change" button

On any edge, a button that expands a plain-English summary: *"This variant doubled the hero headline size, shifted the palette toward warm orange (#FF8C42 from #2C5AA0), and simplified the subhead to a single line. The CTA button moved above the fold and changed from ghost to solid."*

For bosses who don't read code / CSS.

### 19.7 Annotation layer on iframes

Toggleable draw-on-top layer (like Loom's comment mode) on each iframe. Boss/user circles something, adds a text note. That annotation becomes a new `feedback_item` targeted at the node — drives the next iteration.

### 19.8 Preset chips for quick iteration

Below the feedback input, 6 one-click chips: `warmer`, `bolder`, `more minimal`, `more playful`, `more corporate`, `higher contrast`. Each expands to a pre-written feedback prompt. Makes demos feel snappy, lets bosses iterate without typing.

### 19.9 Multiple diff modes

Beyond pixel diff:
- **Structural diff** — DOM tree changes (elements added/removed/moved)
- **Style diff** — computed-CSS diff per element (what actually changed visually)
- **Copy diff** — text-content diff like git-diff but for rendered text
- **Metric diff** — side-by-side of critic scores (a11y, perf, bundle size)

Toggle with a dropdown in the viewer top bar.

### 19.10 Time-slider scrub on a branch

A branch's history, turned into a scrubber. Drag the slider → the iframe morphs through each parent state. Useful for seeing how a series of small changes compound. Also: a "Play" button auto-scrubs for demo flair.

### 19.11 Branch lineage breadcrumb

Above each iframe in the viewer: a compact breadcrumb showing the chain back to root, with each step's prompt. Click any step to jump-compare to that state.

### 19.12 Export formats (for Phase 6)

- **Diff patch** (`.patch`) for code variants
- **PR description** — ready-to-paste Markdown with before/after screenshots and the AI's summary
- **Design specs** — Tailwind class list, color tokens, font sizes extracted
- **Evolution video** — 15-second autogen MP4: seed → variants → winner, with captions. Judges love this.
- **Figma-link** — export design tokens to Figma via their REST API (stretch goal)

### 19.13 Spend meter UX detail

Top-right of the canvas: a running total ("$0.37 today") that expands to a panel showing cost per loop, per model. A user can set a hard cap; the system refuses to start a refinement if it'd blow the cap (with an estimate shown first).

### 19.14 "Save this comparison" shareable snapshots

Freeze a before/after pair to a static artifact: HTML page with the two iframes embedded at their current state + the reasoning trace + critic scores. A single URL judges can click (post-hackathon, needs hosted). Even locally, writes a shareable `.html` bundle to disk.

### 19.15 Smart "what to ask next" suggestions

After a variant is generated, show 3 auto-suggested follow-up prompts based on the critic findings. *"Your accessibility critic flagged low contrast on the subhead — want to try a darker variant?"* One-click to fork on that suggestion.

### 19.16 Reset / branch cleanup

- **Prune branch** — delete a variant and all its descendants (with undo)
- **Hide branch** — collapse on canvas, still retrievable
- **Auto-hide** old branches after N hours to keep the canvas focused

---

## 20. References

- [NousResearch/autoreason](https://github.com/NousResearch/autoreason) — refinement loop inspiration
- [VoltAgent/awesome-design-md](https://github.com/VoltAgent/awesome-design-md) — design prompt catalog
- [motionsites.ai](https://motionsites.ai/) — motion reference gallery
- [tldraw](https://tldraw.dev/) — canvas lib
- [Playwright MCP](https://github.com/microsoft/playwright-mcp) — browser automation
- [Anthropic prompt caching docs](https://docs.anthropic.com/en/docs/build-with-claude/prompt-caching)
- [shadcn/ui](https://ui.shadcn.com/) — component primitives
- [Vercel AI SDK](https://sdk.vercel.ai/) — multi-provider generation

---

## 21. Handoff notes (surprising implementation details)

These are the gotchas the next agent cannot derive from reading the code quickly. Skim before editing.

### 21.1 Model ID mapping

Plan uses friendly names; the Anthropic API needs the full ID. Mapping lives in [apps/api/atelier_api/llm/client.py](apps/api/atelier_api/llm/client.py):

```python
MODELS = {
    "opus":   "claude-opus-4-7",
    "sonnet": "claude-sonnet-4-6",
    "haiku":  "claude-haiku-4-5-20251001",
}
```

The fork endpoint accepts either the friendly key (`"haiku"`) or a full model ID — `_resolve_model` is permissive. Default is `sonnet`.

### 21.2 SQLAlchemy `meta` attribute rename

`Node.meta` is a Mapped[dict] column but SQLAlchemy reserves `metadata` as an attribute on the `Base` class. The column is declared with a string override so the DB column is still named `metadata` while Python sees `node.meta`:

```python
meta: Mapped[dict] = mapped_column("metadata", JSON, default=dict)
```

If you grep the DB for `metadata` it exists; if you write `node.metadata` in Python you'll clobber SQLAlchemy's registry. Use `node.meta`.

### 21.3 `position_x` / `position_y` floats (plan deviated)

PLAN §11 specified `position_xy JSON` (one column). Implementation uses two `Float` columns (`position_x`, `position_y`) because React Flow natively wants `{x, y}` numbers and it's cheaper not to JSON-encode/decode every canvas drag. PATCH `/api/v1/nodes/:id` accepts `position_x` and `position_y` independently.

### 21.4 Edge API shape uses `from` / `to`, not `source` / `target`

The DB columns are `from_node_id` / `to_node_id`; the API response keys are `from` / `to` (not React Flow's `source` / `target`). The Canvas component does the rename when hydrating React Flow edges — see [apps/web/src/components/Canvas.tsx](apps/web/src/components/Canvas.tsx). Keep the API stable; rename on the client.

### 21.5 Fork output protocol: `---META---` separator

Fork calls ask Claude to emit a full HTML document followed by a literal `---META---` line and a JSON trailer:

```
<!DOCTYPE html>
... full document ...
</html>
---META---
{"title": "3-5 word descriptor", "summary": "...", "reasoning": "..."}
```

The parser in [fork.py](apps/api/atelier_api/routes/fork.py) `_parse_llm_output` splits on `---META---` (rsplit so `---META---` literals in the HTML don't confuse it), pulls the first `{...}` via regex, and strips markdown fences if the model wraps the HTML. If you change the protocol, update both the system prompt AND the parser — they're coupled.

### 21.6 Prompt caching is on, but minimal

The FORK_SYSTEM is a list with `cache_control: {"type": "ephemeral"}` on the static system block. That's the only cache breakpoint. For Phase 3 (AutoReason loop) and Phase 5 (critics), add more breakpoints on rubrics / brand guides / canvas history per §10 note. `LlmResponse.cache_read_tokens` and `cache_creation_tokens` already surface in `token_usage` on each node — use them to verify hit rates when you add breakpoints.

### 21.7 Vite path alias must be in vite.config.ts, not just tsconfig.json

`@/*` → `./src/*` is configured in BOTH [apps/web/tsconfig.json](apps/web/tsconfig.json) (TS resolution) and [apps/web/vite.config.ts](apps/web/vite.config.ts) (Rollup resolution). If you add to one, add to the other — Rollup does not read `tsconfig.json`. The build will fail with `Rollup failed to resolve import "@/..."` if tsconfig is the only place the alias exists.

### 21.8 Fork is synchronous single-generation (despite `n` param)

`POST /api/v1/nodes/:id/fork` accepts `n: 1..3` and runs parallel `asyncio.gather`, but there's no SSE streaming yet — the request blocks until all N variants are generated and written. For a 3-variant Opus fork this can take 30s+. Before Phase 3 (AutoReason loop), add SSE: stream `node-resolved` events as each variant lands so the canvas can pop nodes in progressively. The endpoint should probably return a `jobId` and move the work into a background task.

### 21.9 Seed fetcher strips analytics scripts

[sandbox/fetcher.py](apps/api/atelier_api/sandbox/fetcher.py) inlines stylesheets + images but deliberately drops scripts matching GA / GTM / analytics-like patterns. This is to keep seeded pages from phoning home inside the sandbox iframe. If a real variant depends on site JS, this strip is lossy — consider a flag on the seed request to preserve scripts (off by default).

### 21.10 Variants are full tree clones, not deltas

§18 designed a layered-delta strategy; the implementation just copies `parent.build_path` to `variants/<node_id>/` and writes the new `index.html`. Fine at hackathon scale. Revisit when variants-per-project or tree depth climbs (copy time + disk both grow linearly). The `clone_tree` helper in [sandbox/mutator.py](apps/api/atelier_api/sandbox/mutator.py) is the one place to change.

### 21.11 Sandbox CSP is open — dev only

The Node sandbox server sets `Access-Control-Allow-Origin: *` and `Content-Security-Policy: frame-ancestors *` so any origin can iframe any variant. Fine for `localhost` dev. Before any public deploy (Phase 8): tighten CORS to the web app origin, lock CSP frame-ancestors to the app domain, and treat every variant's JS as untrusted (it was generated by an LLM and runs with scripts enabled inside an iframe).

### 21.12 `.env.local` holds the API key; `.env.example` is the template

[.env.local](.env.local) is gitignored and contains the real `ANTHROPIC_API_KEY`. The key was pasted in chat during initial setup — the user was warned to rotate it at https://console.anthropic.com/settings/keys if concerned. The settings endpoint `POST /api/v1/settings/api-key` also accepts keys at runtime (stored in process memory only, not DB).

### 21.13 SQLite lives at `apps/api/atelier.db`

One file. Delete it to reset all state. Assets under `assets/variants/<node_id>/` are not auto-cleaned — orphan them or wipe the whole `assets/variants/` dir alongside the DB. There is no migration tooling; the `init_db()` lifespan handler in `main.py` runs `create_all` on boot, so schema changes during Phase 3 need either Alembic (planned) or drop-and-recreate for now.

### 21.14 There's a `smoketest` project in the DB

From the end-to-end verification run. It has a seed node (example.com) and one forked variant ("Large Bold H1 Warm Gradient Background"). If a clean slate is desired: delete `apps/api/atelier.db` and `assets/variants/*`.

### 21.15 Windows dev quirks

The user's machine is Windows with Git Bash. A few specifics:
- Ports bind to `0.0.0.0` not localhost in some tools — `netstat -ano -p tcp` is needed to find PIDs; `kill` from bash fails on native Windows processes, use `taskkill //PID <pid> //F`.
- `scripts/dev.sh` is bash only; it works under Git Bash. PowerShell users need the three-terminal approach from README.
- Path separators: Python `pathlib` handles them; the Node sandbox server uses `path.join` + `path.normalize`. No hard-coded `/` or `\` anywhere except in MIME lookup tables.

### 21.16 Concrete next tasks (Phase 3 onramp)

Ordered by leverage (highest first). The first three unlock the richer demo:

1. **SSE streaming on fork** — `GET /api/v1/refinement/:jobId/stream` per §13. Move `_generate_one` into a background `asyncio.Task`, emit `node-resolved` events as each variant completes. Requires a `refinement_job` table (schema already in §11 DDL, not yet in `models.py`).
2. **AutoReason refinement loop** — new route `POST /nodes/:id/refine { goal, config }`. Engine in `atelier_api/refinement/engine.py` following the pseudocode in §5. Use prompt caching aggressively on the goal rubric and canvas history. Reasoning traces write to `edge.reasoning`.
3. **Model shootout** — extend fork request with `shootout: true` that fans out one variant per model (haiku + sonnet + opus) as siblings. Cheap to build on top of existing fork; big visual payoff.
4. **Pixel-diff overlay in the viewer** — Playwright screenshot both variants at a chosen viewport, canvas `getImageData` comparison, colored diff layer. Requires Playwright pool (§18) which is not yet installed.
5. **Feedback sidebar + intent parser** — §6 pipeline. Preset chips (§19.8) are a 30-minute quick win.
6. **Critic agents** — start with accessibility (axe-core on rendered variant DOM). Each critic writes to `critic_report` table (schema in §11 DDL).
7. **AI branch naming is already done** — confirmed in fork response, titles like "Large Bold H1 Warm Gradient Background". No work needed.
8. **Voice input** (§19.1) — Web Speech API, no backend, afternoon-sized.
9. **Meeting Mode** (§19.2) — CSS-only toggle that hides canvas chrome. Half-day.

Anything downstream of that is a Phase 6+ concern; fix scope before diving in.

> **Note (2026-04-23):** the phase numbers in §21.16 above reference the *original* phase ordering. The revised ordering in §14 promotes Genspark (new Phase 3) and deploy (new Phase 4) ahead of AutoReason (now Phase 6). The authoritative next-task list is **§25** below; §21.16 is kept as historical context for items that are still relevant (SSE, pixel diff, critics).

---

## 22. Genspark integration architecture

Claude stays the generator for HTML/CSS/text. Genspark owns media and web-grounded retrieval. Boundary drawn so neither sponsor is a thin wrapper around the other.

### 22.1 Capabilities we consume

| Capability | Genspark endpoint (OpenAI-compatible) | Atelier use |
|---|---|---|
| Image generation (Flux, DALL-E 3) | `POST /v1/images/generations` | Hero imagery, section imagery, background textures |
| Video generation (Kling, Veo, PixVerse, Sora, Seedance) | `POST /v1/videos/generations` | Short looping hero motion clips (≤3s), exported to `<video autoplay muted loop>` |
| Chat + web search | `POST /v1/chat/completions` with model suffix `-search` | Research critic; competitor-reference grounding before forks |
| Slides (stretch) | Slides agent | Export "this redesign, as a pitch deck" PDF for stakeholders |

Authentication: `Authorization: Bearer $GENSPARK_API_KEY`. Shape assumption until sponsor gives us official docs. If their official shape differs, the provider module is the only file that changes — see §22.3.

### 22.2 The hero-media flow (the headline demo)

This is the user-facing flow judges will see:

1. User selects a variant node, clicks **"Generate Hero Media"** (new action on the variant card)
2. Backend reads the variant's `index.html`, asks **Claude** to:
   - Identify the hero section (`<header>` / first `<section>` / role=banner heuristic)
   - Produce a structured image prompt that matches the site's tone + the user intent (e.g., *"editorial photograph, warm golden-hour lighting, two people laughing at a café, soft depth of field, 16:9, product-marketing-ready"*)
   - Return whether the hero should be a still image or a short motion clip (binary choice, defaults to image for speed)
3. Backend calls **Genspark** — `/v1/images/generations` (N=1..3) or `/v1/videos/generations` (N=1) with that prompt
4. Backend downloads the asset, writes to `assets/variants/<new_node_id>/media/hero.<ext>`, and in hosted mode uploads to Supabase Storage
5. **Claude** is called a second time with the original HTML + the generated asset URL + "rewrite the hero to use this asset." Returns a new full HTML document (same `---META---` protocol as §21.5)
6. Mutator clones the parent tree, writes the new `index.html`, and the media file. New variant node ships to canvas with `meta.media_assets = [{type, url, prompt, model}]`
7. SSE stream (§25 task 1) reports `prompt-drafted`, `media-rendered`, `html-rewritten`, `node-ready` — each event pops UI feedback on the corresponding card

Latency budget (target):
- Prompt drafting (Haiku): ~3s
- Image render (Flux via Genspark): ~5–10s
- HTML rewrite (Sonnet): ~8s
- Total: **under 25s** end-to-end for the still-image path. Video path: +30–60s for Kling render; show a "keep-alive" ghost variant on canvas while it renders.

### 22.3 Code shape

New directory `apps/api/atelier_api/providers/` replaces the current `llm/`:

```
providers/
├── base.py            # LlmResponse dataclass (existing), MediaResponse dataclass (new), Provider protocol
├── claude.py          # existing AsyncAnthropic wrapper, moved from llm/client.py
├── genspark.py        # new: images, videos, chat-with-search via OpenAI-compatible HTTP
└── __init__.py        # re-exports get_text_provider() / get_media_provider() factory
```

`providers/genspark.py` exposes:
- `generate_image(prompt: str, model: str = "flux", n: int = 1, aspect: str = "16:9") -> list[MediaResponse]`
- `generate_video(prompt: str, model: str = "kling", duration: int = 3, aspect: str = "16:9") -> MediaResponse`
- `chat_with_search(system: str, user: str, model: str = "gpt-4o-search") -> LlmResponse`

`MediaResponse` shape:

```python
@dataclass
class MediaResponse:
    url: str                # remote URL we can download; may be signed & time-limited
    local_path: Path | None # filled after download
    model: str
    prompt: str
    cost_cents: int | None  # best-effort, from response if available
    usage: dict             # raw provider usage blob for accounting
```

Feature-flag:
- `GENSPARK_API_KEY` empty or unset ⇒ `providers/genspark.py` uses a **mock** that returns a local placeholder image (`apps/api/atelier_api/providers/mocks/hero-placeholder.png`) so the hero-media button works end-to-end in dev without the key. The mock logs `[genspark-mock]` so it's obvious in the demo video that the real key is needed for prod.

### 22.4 Data model additions

Minimal — ride on existing tables:

- `Node.meta` JSON gets a `media_assets: [{type, url, prompt, model, cost_cents, generated_at}]` array
- `Node.token_usage` JSON extended: add `genspark: {image_credits, video_credits}` alongside existing `{input, output, cache_read, cache_creation}`
- No new table. If we add the `refinement_job` and `critic_report` tables for Phase 6/7 (per §11 DDL), they're independent

### 22.5 Routes

New on top of existing `/api/v1/`:

```
POST /nodes/:id/media          { kind: "image" | "video", user_intent?: str, model?: str }
                               → creates a variant node with generated hero + rewritten HTML
                               → returns { jobId }; SSE stream delivers events

GET  /media/jobs/:jobId/stream SSE: prompt-drafted, media-rendered, html-rewritten, node-ready, error
```

Pipelines endpoint (Phase 8) eventually absorbs this — a "Generate Hero Media" recipe is just a 3-step pipeline.

### 22.6 Risks / open questions

1. **No sponsor key yet** — mock + feature flag (§17 decision 16) unblocks Phases 3–5. Hosted demo (Phase 4) can ship without Genspark lit up if key lands late; hero-media button falls back to mock with a visible "using mock" banner
2. **Genspark API shape is semi-official.** Based on community docs (`genspark2api` proxy) plus their OpenAI integration story. When the sponsor gives us real docs, only `providers/genspark.py` changes
3. **Cost.** Image gen via Genspark is typically $0.02–$0.08 per generation. Judges tapping the demo 10× = under $1. Sponsor key usually bypasses billing for hackathons — confirm
4. **CORS on generated asset URLs.** Genspark's response URLs may be on their CDN. For the iframe to load them reliably, we download server-side and re-host under our own origin (Storage bucket or local assets). Do not hotlink

---

## 23. Hosted deployment architecture (Render + Supabase)

Target: judges click a single URL, paste their own seed URL, and see the full demo loop. No login, no setup. Must survive burst traffic during judging.

### 23.1 Service topology

```
                           ┌────────────────────────┐
                           │   Render Static Site   │
                           │  atelier.onrender.com  │   Vite build of apps/web
                           │  (or custom domain)    │
                           └────────────┬───────────┘
                                        │ HTTPS
                                        ▼
                           ┌────────────────────────┐
                           │  Render Web Service    │
                           │  atelier-api.onrender…  │   FastAPI + uvicorn
                           │                        │   reads GENSPARK_API_KEY,
                           │                        │   ANTHROPIC_API_KEY, SUPABASE_*
                           └───────┬────────────┬───┘
                                   │            │
                       Postgres    │            │  Supabase Storage (bucket: variants/)
                       (Supabase)  │            │  public bucket; object URL = iframe src
                                   ▼            ▼
                            ┌────────────┐  ┌──────────────────┐
                            │  Supabase  │  │  Supabase        │
                            │  Postgres  │  │  Storage         │
                            └────────────┘  └──────────────────┘
```

**Why collapse the sandbox server?** Locally we run `sandbox-server/` on :4100 because the browser needs a real HTTP origin for the iframes. In hosted mode, Supabase Storage *is* that origin — every variant's `index.html` + assets is a public object at `https://<proj>.supabase.co/storage/v1/object/public/variants/<node_id>/index.html`. The FastAPI backend writes objects to Storage at fork time; the React app sets iframe `src` to the Storage URL. **Two services to deploy, not three.** Saves a Render slot and dodges the cold-start penalty of a third service.

### 23.2 Why Render over Vercel/Fly/Railway

- One platform for both the frontend (static) and backend (Python web service), IaC via a single `render.yaml`
- Render CLI (`render` / `render-cli` npm package) supports `render services deploy` + blueprint sync — scripted deploys from the terminal
- Free tier sufficient for judge traffic (backend sleeps after 15 min idle; use a lightweight warmup endpoint pre-demo)
- Python 3.11+ native, no Docker required — matches dev infra philosophy
- FastAPI is a documented first-class use case on Render

Supabase picked over Neon/Fly Postgres because it bundles Postgres + Storage + auth in one project. We use Postgres + Storage now; auth is a Phase 10 lever.

### 23.3 `render.yaml` shape

Single blueprint at repo root. Sketch (do not commit until Phase 4 kicks off):

```yaml
services:
  - type: web
    name: atelier-api
    runtime: python
    plan: free
    rootDir: apps/api
    buildCommand: pip install -r requirements.txt
    startCommand: uvicorn atelier_api.main:app --host 0.0.0.0 --port $PORT
    envVars:
      - key: ATELIER_DB_URL
        sync: false          # set in Render dashboard to Supabase conn string
      - key: ANTHROPIC_API_KEY
        sync: false
      - key: GENSPARK_API_KEY
        sync: false
      - key: SUPABASE_URL
        sync: false
      - key: SUPABASE_SERVICE_KEY
        sync: false
      - key: ATELIER_STORAGE_MODE
        value: supabase      # dev=local, prod=supabase
      - key: ATELIER_WEB_ORIGIN
        value: https://atelier.onrender.com

  - type: web               # static
    name: atelier-web
    runtime: static
    rootDir: apps/web
    buildCommand: npm ci && npm run build
    staticPublishPath: dist
    envVars:
      - key: VITE_API_BASE
        value: https://atelier-api.onrender.com/api/v1
    routes:
      - type: rewrite        # SPA routing
        source: /*
        destination: /index.html
```

### 23.4 Migrations & portability

- SQLAlchemy `atelier_db_url` already swaps via env var (`sqlite+aiosqlite:///./atelier.db` → `postgresql+asyncpg://...`). Add `asyncpg` to `requirements.txt`
- `init_db()` creates all tables on boot (SQLite behavior). For Postgres this is fine for first deploy; switch to **Alembic** (planned in §12) once we start iterating on schema
- `Node.meta` column name collision (§21.2) works identically in Postgres — keep the `"metadata"` string override
- `JSON` → Postgres `JSONB` is a SQLAlchemy column-type flip; value-level code is unchanged

### 23.5 Storage adapter

New `atelier_api/storage/` module abstracts local-disk vs Supabase:

```
storage/
├── base.py        # StorageBackend protocol: put_tree(variant_id, src_dir), get_public_url(variant_id, rel_path)
├── local.py       # writes under assets/variants/<id>/; returns http://localhost:4100/variant/<id>/...
└── supabase.py    # uploads tree to variants/<id>/; returns https://<proj>.supabase.co/storage/v1/object/public/...
```

Env switch: `ATELIER_STORAGE_MODE=local|supabase`. Sandbox server stays in the repo (local dev needs it); hosted deploy just doesn't run it.

### 23.6 Deploy procedure (Phase 4 runbook — ready to execute)

All code + config is shipped. The runbook below is the actual sequence to deploy:

**One-time account setup (you run, ~10 minutes):**

1. **Supabase project**
   - Go to https://supabase.com → New Project. Region near judges. Strong DB password (save it)
   - Project Settings → API → copy `URL` and `service_role` key (NOT anon)
   - Storage → Create new bucket → name: `variants`, **public**, no file size limit (or set 50 MB)
   - Project Settings → Database → Connection String → URI form. It looks like `postgresql://postgres.<ref>:<pwd>@aws-0-<region>.pooler.supabase.com:6543/postgres`. **Replace** `postgresql://` with `postgresql+asyncpg://` for our SQLAlchemy driver. Save this string

2. **Render account**
   - https://render.com → sign in with GitHub (so Render can read the repo)
   - Install Render CLI: `npm i -g @render-oss/cli`
   - `render login` (opens browser)

3. **Push the repo to GitHub** (Render reads from GitHub; it does not deploy from a local folder)
   - If the repo isn't on GitHub yet: `gh repo create atelier --public --source=. --push` (or use the GitHub UI)
   - The repo must contain the [render.yaml](render.yaml) at the root (already committed in this branch)

**First deploy (~5 minutes wall time, mostly Render's build):**

4. From the repo root: `render blueprint launch`
   - Render parses [render.yaml](render.yaml), creates both services (`atelier-api` and `atelier-web`), starts the first build
   - Build will FAIL on first run because secrets aren't set yet — that's expected

5. In the Render dashboard, for `atelier-api`, set the secret env vars:
   - `ANTHROPIC_API_KEY` = your Claude key (or use the BYOK runtime endpoint instead)
   - `GENSPARK_API_KEY` = leave empty until sponsor key arrives (mock mode keeps the demo flow alive)
   - `ATELIER_DB_URL` = the `postgresql+asyncpg://...` string from step 1
   - `SUPABASE_URL` = `https://<project-ref>.supabase.co`
   - `SUPABASE_SERVICE_KEY` = the service_role key
   - `ATELIER_ALLOWED_ORIGINS` = `https://atelier-web.onrender.com` (or your custom domain)
   - Click "Save Changes" → service redeploys

6. For `atelier-web`, set:
   - `VITE_API_BASE` = `https://atelier-api.onrender.com/api/v1` (use the URL Render assigns)
   - Save → static site rebuilds

7. **Verify**:
   - Hit `https://atelier-api.onrender.com/healthz` → expect `{"ok":true,"service":"atelier-api"}`
   - Open `https://atelier-web.onrender.com` → empty-state UI loads
   - Create a project with a real seed URL → seed node should appear with sandbox URL pointing at `https://<project>.supabase.co/storage/v1/object/public/variants/<id>/index.html`
   - Click Hero → MediaDialog opens → mock-mode SVG variant lands
   - Open Before/After viewer → both iframes load from Supabase Storage URLs

**Pre-judging warmup (do this 5 minutes before the demo):**

8. Render free-tier services sleep after 15 min idle. Cold-start is ~30s.
   - Easy: open the hosted URL once, click around. Backend stays warm for 15 min after the last request
   - Better: a free cron at https://cron-job.org pinging `/healthz` every 10 min keeps the backend awake during judging windows
   - Best: upgrade `atelier-api` to the $7/mo "Starter" plan for the day of judging (no sleep, instant cold start). Cancel after

### 23.7 Domain + polish

Optional custom domain: `atelier.design` or similar. Cloudflare in front (free) + Render's custom-domain setup. Strictly cosmetic — the `onrender.com` URL works for submission.

---

## 24. Demo video plan (Hyperframes, 2 minutes)

### 24.1 Why Hyperframes

| | Hyperframes | Remotion |
|---|---|---|
| License | Apache 2.0 (no licensing risk for the submission) | Source-available, commercial license above small-team thresholds |
| Authoring | HTML + CSS + GSAP + data attributes | React components |
| Claude compatibility | Very high — HTML is dense in Claude's training data | Lower — React+Remotion is thin in training data |
| Render time (same prompt, Opus 4.7, per community benchmark) | ~60s | ~162s + 4min initial build |
| Output file size | ~4MB | ~14MB |
| Build step | None | Bundler required |

Atelier's whole mental model is HTML-as-canvas. Using an HTML-based video composition tool is on-brand and lets us potentially meta-demo ("Atelier uses the same primitives it operates on"). **Locked in (§17 decision 15).**

### 24.2 Composition architecture

Separate package at repo root: `demo-video/`. Not deployed — built locally, output committed (or uploaded as a release asset):

```
demo-video/
├── package.json              # hyperframes + ffmpeg-installer
├── composition.html          # the 2-min timeline, hand- (or Claude-) authored HTML
├── assets/
│   ├── screencaps/           # real browser captures of the app (Playwright scripted)
│   │   ├── 00-seed.webm
│   │   ├── 01-fork.webm
│   │   ├── 02-hero-gen.webm
│   │   └── ...
│   ├── voiceover.mp3         # AI-generated narration (ElevenLabs / Genspark TTS)
│   ├── logo-claude.svg
│   ├── logo-genspark.svg
│   └── captions.vtt
├── scripts/
│   ├── capture.mjs           # Playwright script that records each beat from §15 against the hosted URL
│   └── render.mjs            # hyperframes CLI invocation
└── README.md                 # how to regenerate the video
```

### 24.3 Screen capture strategy

Two options for beat-level screencaps:

1. **Playwright scripted captures** (preferred) — a deterministic script (`scripts/capture.mjs`) runs against the hosted URL (§23), pauses at known states, records WebM via `page.video()`. Advantages: reproducible, can re-render for any change. Disadvantages: scripting the cursor is fiddly
2. **Manual OBS recording** (fallback) — record one full live run, cut into beats. Faster initially; redo cost is high if the app changes

Go with Playwright for the submission; keep OBS as a plan B if time slips.

### 24.4 Timeline composition

HTML file maps directly to §15's 2-min timeline. Pseudo-structure:

```html
<!-- composition.html (excerpt) -->
<section data-start="0" data-duration="10" class="title-card">
  <h1>Atelier</h1>
  <p>An infinite canvas for iterative frontend craft.</p>
  <div class="sponsor-row">
    <img src="assets/logo-claude.svg" alt="Claude" />
    <span>+</span>
    <img src="assets/logo-genspark.svg" alt="Genspark" />
  </div>
</section>

<video data-start="10" data-duration="15" src="assets/screencaps/00-seed.webm"
       data-caption="Paste a URL. The seed node lands on the canvas." />

<video data-start="25" data-duration="20" src="assets/screencaps/01-fork.webm"
       data-caption="Claude forks 3 variants. Reasoning traces stream live." />

<video data-start="45" data-duration="25" src="assets/screencaps/02-hero-gen.webm"
       data-caption="Claude writes the prompt. Genspark renders the hero." />

<!-- ... rest of timeline ... -->

<audio data-start="0" data-duration="120" src="assets/voiceover.mp3" data-track-index="10" />
```

### 24.5 Voiceover

AI TTS, script authored alongside the timeline. Candidates in order of preference:

1. **Genspark TTS** (if available via API) — keeps both sponsors in the artifact stack
2. **ElevenLabs** — reliable, cheap, good voices
3. **OpenAI TTS** — quickest

Budget ~45 seconds of total narration; the rest is UI sound design (subtle).

### 24.6 Rendering

```bash
cd demo-video
npm ci
npx hyperframes render composition.html --out atelier-demo.mp4 --resolution 1920x1080 --fps 30
```

Target: ≤60s render time, ≤10MB output. Submit the MP4 plus the `demo-video/` directory (so judges can inspect composition source — an extra "look, it's all open" flourish).

### 24.7 Narration script (draft)

```
[0:00] Atelier is an infinite canvas for iterative frontend craft — built for the meeting-room moment.
[0:10] Paste any URL. We seed a live snapshot as the root of a visible exploration tree.
[0:25] Prompt Claude: "make the hero warmer." Three variants fork in parallel. You watch the reasoning.
[0:45] But Claude doesn't own imagery. So Claude hands off: it writes the brief, Genspark renders the hero.
[1:10] Before/after — drag to compare. Desktop, tablet, mobile, all in sync.
[1:30] Run three Claude models side-by-side. See where Haiku wins on speed, where Opus wins on nuance.
[1:45] Add motion. Genspark generates a 3-second clip. The hero comes alive.
[1:55] Atelier. Claude plus Genspark. Link in description.
```

Voice: calm, confident, product-marketing register. Not a hype pitch.

---

## 25. Revised handoff — next tasks

Replaces §21.16. Ordered strictly by what unlocks the submission (hosted URL + 2-min video), not by independent leverage.

### 25.1 Phase 3 — Genspark hero media (the headline)

1. ✅ **Provider abstraction.** Done. New package [apps/api/atelier_api/providers/](apps/api/atelier_api/providers/) with `base.py` (`LlmResponse`, `MediaResponse`), `claude.py` (lifted from old `llm/client.py`), `genspark.py`. The old [apps/api/atelier_api/llm/client.py](apps/api/atelier_api/llm/client.py) is now a re-export shim so `from atelier_api.llm import client as llm` in fork.py + `from atelier_api.llm.client import MODELS` in settings_route.py keep working
2. ✅ **`providers/genspark.py` with mock fallback.** Done. `generate_image`, `generate_video`, `chat_with_search` all implemented. Mock mode auto-engages when `GENSPARK_API_KEY` is empty — writes a deterministic SVG placeholder with visible `[genspark-mock]` label and the prompt embedded. Real-mode HTTP calls hit `/v1/images/generations`, `/v1/videos/generations`, `/v1/chat/completions` per §22.1; remote URLs are downloaded server-side to dodge CDN-CORS issues per §22.6.4
3. ✅ **New route `POST /api/v1/nodes/:id/media`.** Done. [apps/api/atelier_api/routes/media.py](apps/api/atelier_api/routes/media.py). Synchronous; the full flow Claude(Haiku draft) → Genspark(mock or real) → Claude(Sonnet rewrite) → clone parent tree → drop media in → write `index.html` → commit. Returns `{node_id, edge_id, sandbox_url, image_prompt, media_url, media_is_mock, model_used, token_usage}`. **Implementation note:** stage media in a temp dir OUTSIDE `variant_dir` because `clone_tree()` does `rmtree(dst)` before `copytree`. Got bitten by this on the first run — see git history for the fix
4. ✅ **SSE on `/api/v1/media/jobs/:job_id/stream`.** Shipped 2026-04-24. [apps/api/atelier_api/jobs.py](apps/api/atelier_api/jobs.py) is the in-memory per-process event bus; [routes/media.py](apps/api/atelier_api/routes/media.py) split into a sync endpoint (legacy, kept for curl) and `POST /nodes/{id}/media/jobs` that returns `{job_id, stream_url}` and kicks work into a background `asyncio.Task`. Events emitted: `drafting-prompt`, `prompt-drafted`, `node-allocated`, `rendering-media`, `media-rendered`, `rewriting-html`, `html-rewritten`, `uploading`, `uploaded`, `node-ready`, `error`, `done` — each with `elapsed_ms` where relevant. Keep-alive `: ping\n\n` every 15s for Cloudflare. Frontend dialog stepper consumes the stream via `EventSource`; dialog auto-closes and opens the Before/After viewer on `node-ready`. Fork still sync — back-port pending if needed
5. ✅ **"Generate Hero Media" button + dialog.** Done. New "Hero" button on every `VariantNode` (fuchsia, alongside Fork/Pin/Checkpoint). Opens [apps/web/src/components/MediaDialog.tsx](apps/web/src/components/MediaDialog.tsx) with kind toggle (image/video), aspect picker (16:9 / 4:3 / 1:1 / 9:16), kind-aware intent presets, optional intent textarea. On success: refetches tree, auto-pins parent + new child into the Before/After viewer, opens it. Mock-mode disclosure shown in the dialog footer
6. 🔲 **Media display on the card.** Not yet wired. Today the iframe thumbnail already shows the new hero (since the variant is just a regular variant). A dedicated chip ("hero asset added — flux/mock") on the card would make it more legible. Low priority; the Before/After viewer already tells the story

### 25.1.shipped Implementation notes (verified working 2026-04-23)

- Provider package and shim: `from atelier_api.providers import claude, genspark` works; `from atelier_api.llm import client as llm` still works via re-export
- Mock SVG: written to `<variant_dir>/media/mock-<hash>.svg` (1 KB). HTML uses `<img src="media/mock-XXXX.svg" alt="" class="hero-image"/>` — relative URL works under the existing sandbox server
- End-to-end test (against the smoketest project's seed node `9d21c880-…`) — Claude drafted "Warm sunlit outdoor café with soft golden hour lighting…", mock SVG rendered, Sonnet rewrote the HTML to wrap the image in a fade-overlay hero. Token usage: ~480 in / 112 out (Haiku drafter) + 681 in / 1258 out (Sonnet rewriter) = roughly $0.06 per generation
- Frontend builds clean (`npx tsc --noEmit` and `vite build` both green)
- `.env.local` schema gained `GENSPARK_API_KEY=` and `GENSPARK_BASE_URL=https://api.genspark.ai`. Both empty by default; flip when sponsor key arrives
- The `[genspark-mock]` log line will appear in the API console on every mock-mode call — easy diagnostic to confirm whether real mode is engaged in prod

### 25.2 Phase 4 — Hosted deploy (judge URL)

7. ✅ **Storage adapter.** Done. [apps/api/atelier_api/storage/](apps/api/atelier_api/storage/) with `base.py` (Protocol), `local.py` (sandbox-server URLs), `supabase.py` (REST upload via httpx, public bucket URLs). Backend selected at startup by `ATELIER_STORAGE_MODE` env var; a single module-level `storage` instance is imported from `atelier_api.storage`. Local mode is the default and unchanged
8. ✅ **Variant upload path.** Done. Three call sites updated to call `await storage.upload_variant_tree(node_id, variant_dir)` after writing files locally: [routes/projects.py](apps/api/atelier_api/routes/projects.py) (seed fetch), [routes/fork.py](apps/api/atelier_api/routes/fork.py), [routes/media.py](apps/api/atelier_api/routes/media.py). All `sandbox_url` / `media_url` formatting now goes through `storage.variant_url(node_id, rel_path)` — four sites swapped (projects/tree, nodes/get, fork response, media response). Local mode is a no-op upload; Supabase mode uploads each file as a public object
9. ✅ **Postgres URL swap.** `asyncpg>=0.30.0` added to [pyproject.toml](apps/api/pyproject.toml). The schema in [db/models.py](apps/api/atelier_api/db/models.py) uses portable SQLAlchemy types (`String`, `Text`, `JSON`, `Float`, `Integer`, `ForeignKey`) — no SQLite-specific DDL. `ATELIER_DB_URL=postgresql+asyncpg://...` Just Works. **Caveat:** still no Alembic. First deploy uses `init_db()` → `create_all` (idempotent); schema changes after that need either Alembic or a manual `DROP/CREATE`
10. ✅ **`render.yaml` at repo root.** [render.yaml](render.yaml) defines both services (FastAPI web + Vite static site) with placeholders for secrets. Health check on `/healthz`. SPA rewrite rule for the static site. Region: oregon (change before deploy if judges are EU)
11. 🔲 **First deploy.** Manual — requires Supabase + Render accounts (you have these or will create them). Runbook is now §23.6 with exact step-by-step. Estimated 15 min including account setup
12. 🔲 **Warmup strategy.** Render free-tier sleeps after 15 min idle (~30s cold start). Three options listed in §23.6 step 8: open the URL beforehand, set a cron-job.org ping, or upgrade to $7/mo Starter for the demo day

### 25.2.shipped Implementation notes (verified working 2026-04-23)

- `storage.variant_url('abc', 'media/hero.svg')` returns either `http://localhost:4100/variant/abc/media/hero.svg` (local) or `https://<proj>.supabase.co/storage/v1/object/public/variants/abc/media/hero.svg` (supabase). Path-doubling bug caught + fixed: bucket name `variants` is the namespace, the object path does not also need a `variants/` prefix
- Frontend uses `import.meta.env.VITE_API_BASE` with fallback to `/api/v1`. Vite dev proxy still handles local; hosted build burns the absolute backend URL into the bundle. Added [apps/web/src/vite-env.d.ts](apps/web/src/vite-env.d.ts) for TS type-safety on `import.meta.env`
- Backend CORS gained env-driven `ATELIER_ALLOWED_ORIGINS` (comma-separated) on top of the always-allowed localhost origins
- End-to-end smoke after refactor: tree endpoint returns local URLs, GET /nodes returns local URLs, /media flow generates a variant whose iframe loads from local sandbox-server. Frontend `tsc --noEmit` + `vite build` both clean
- Supabase mode tested with fake creds: backend constructs, URL-building correct after the path-doubling fix. Real upload not yet exercised (needs real Supabase project)

### 25.3 Phase 5 — 2-min demo video

13. **`demo-video/` package scaffold.** Per §24.2
14. **Playwright capture script.** One script that drives the hosted URL through each of §15's 7 beats. Records webm per beat. Re-runnable
15. **`composition.html`.** Hand-author (or let Claude draft given the §15 table and the narration script in §24.7). Timing data-attributes, captions, sponsor logos, voiceover track
16. **Voiceover.** Generate via TTS (Genspark if API, else ElevenLabs). ~45s of narration for 2min of video — pacing allows pauses for visual reveals
17. **Render + review.** `hyperframes render composition.html --out atelier-demo.mp4`. Watch, iterate on pacing, re-render
18. **Submission package.** MP4 + hosted URL + GitHub link + short README pointing at this PLAN.md

### 25.4 Parallelizable / defer to after submission

- AutoReason refinement loop (was Phase 3, now Phase 6)
- Model shootout UI polish (backend is done, UI button needs hookup)
- Pixel-diff overlay
- Critic agents (a11y, perf, conversion)
- Feedback sidebar + intent parser
- Voice input
- Meeting Mode
- Code mode
- Multi-user auth

### 25.5 Dependencies / sequencing

- **Phase 3 blocks Phase 5** — the demo video needs hero-media captures to exist
- **Phase 4 blocks Phase 5** — Playwright capture script runs against the hosted URL (could run against local but hosted is more honest for the judges' URL)
- **Phase 3 does NOT block Phase 4** — we can ship the hosted URL with the hero-media button behind a mock, then flip Genspark on when the sponsor key arrives
- **Sponsor key status** — §17 decision 16 allows all three phases to proceed without it. When it arrives, only `.env` (local) and Render secrets (hosted) change

---

## Status

**Phase 3 shipped, hosted, live-SSE-streamed.** End-to-end from the hosted frontend: paste URL → Hero button → live progress stepper ticks through Claude-draft / MiniMax-render / Claude-rewrite / upload (~45–60s total for real images) → Before/After viewer opens auto-pinned to the new variant. Mock fallback preserved for dev without the MiniMax key.

**Phase 4 shipped, live.** 3 Render services + Supabase (Postgres + public Storage bucket) + private GitHub repo. Render auto-deploys on every push to `main`.

**Workflow from 2026-04-24 on:** local-verify → push → render-deploy → live-verify → PLAN.md update → next step (see §0 handoff).

**Sponsor model:** Claude owns text/code/HTML. MiniMax owns media (image via image-01, video via T2V-01-Director). Genspark has no public API and participates as a sponsor via branded screen-recording cameo in the 2-min demo video.

**Cycle 2 (next):** fidelity pass — upgrade seed fetcher so real product sites (vercel.com / stripe.com / linear.app) seed correctly, add Render keep-warm pinger, spend meter, error boundary. Then Phase 5 (Hyperframes demo video).

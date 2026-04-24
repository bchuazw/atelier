# Devfolio submission content (push-to-prod)

All five required long fields drafted below. Copy-paste into the Devfolio
form OR call `mcp__devfolio__updateHackathonProject` with the UUIDs. No
AI-generated screenshots — gallery uses real Playwright captures.

Hackathon: **Push to Prod with Genspark & Claude**
Slug: `push-to-prod`  ·  Single track: "Hackathon Prizes" (`5e75ce5782bb48e49034bf8ec94033f3`)

---

## Project name + tagline

**Name:** `Atelier`
**Tagline:** `Branch, critique, and keep every round of design feedback.`

(Name ≤50, tagline ≤50 per Devfolio validation — both well within.)

---

## Hashtags (technologies)

```
Claude, Genspark, React, TypeScript, FastAPI, Python, Supabase, Render, React Flow, SSE
```

10/10 — at the cap.

## Platforms

`Web`

## Links

- GitHub: `https://github.com/bchuazw/atelier`
- Hosted: `https://atelier-web.onrender.com` (API pending resume)

---

## Field 1 — "The problem your project solves"
`projectFieldUUID: d3f5e1ee318f426a98fb0ff1105a5688`

```markdown
### The broken internal loop

Every design team has the same workflow problem: **feedback on landing
pages is lost between a screenshot, a paragraph, and a guess.**

- A PM scribbles "make it more premium" on a Figma comment.
- A designer tries three things in parallel, loses two of them.
- A dev implements one, and the stakeholder says "no, more like Aesop."

The iteration loop is serial, lossy, and opinion-driven. Current AI
tools make it worse — one-shot regeneration means every variant
overwrites the last, and the "more premium palette" suggestion comes
back as generic AI slop: *"use a modern color scheme"*, *"refine the
typography"*. Specifically what? Nobody knows.

**Atelier fixes the loop.** Every critique becomes a branch on an
infinite canvas you can see, compare, and keep. Every suggestion is
grounded in real landing pages crawled from the open web — so "make it
premium" lands as *"swap Inter for Cormorant Garamond 700 italic, use
Aesop's #EDE5D8 parchment, ghost outlined CTA."*
```

## Field 2 — "How you are solving it"
`projectFieldUUID: f11c9bfcef62456ea62a96b7a2e6bd78`

```markdown
### Every round of feedback is a branch, not an overwrite

Atelier is an infinite canvas (React Flow) where every variant is a
live node with an iframe thumbnail. Seed from a URL, paste HTML, or
pick one of 6 curated aesthetic templates.

From there, three AI primitives:

1. **Fork with Claude.** Type a prompt ("make the hero warmer"),
   choose Haiku / Sonnet / Opus, get a new child node with its full
   HTML rewritten. The rewrite streams in via SSE so users see
   progress, not a 30-second spinner.
2. **Grounded Critics.** Name a target vibe (e.g., "premium luxury").
   Genspark pulls 3 real landing pages matching that vibe, Claude
   reads them, and returns 4–8 concrete, severity-tagged suggestions
   that **cite the real pages**. Users approve which suggestions to
   apply; one rewrite ships them all.
3. **Drag-to-combine (Opus-powered merge).** Like two variants for
   different reasons? Drag one onto the other — Opus synthesizes them
   into a new branch with dashed edges showing which parent donated
   what.

And a zero-loss viewer: click **Compare** on any two nodes, both full
pages render side-by-side with desktop/tablet/mobile viewports. Nothing
is lost between branches.

**Built in ~8 cycles during the hackathon**: FastAPI + SQLAlchemy
backend, Vite + React + Tailwind frontend, Supabase (Postgres + object
storage) + Render for deploy, all open source at github.com/bchuazw/atelier.
```

## Field 3 — "Use of Genspark"
`projectFieldUUID: f8fbafeb71594d44876bd2892843f142`

```markdown
### Genspark turns Claude's critics from "AI slop" into "cite-your-sources"

**The problem with AI critiques:** ask an LLM "make this more premium"
and it responds with "use a more refined palette, modernize the
typography." Useless.

**Our solution uses the Genspark CLI (`@genspark/cli`)** as a grounded
research layer for the Critics feature:

1. User enables **"Ground with Genspark research"** in the Critics
   dialog and specifies a target theme ("premium luxury").
2. Backend (`apps/api/atelier_api/providers/genspark.py`) shells out to
   `gsk web_search` → pulls 3 real landing pages matching the theme
   (Aesop, Awwwards luxury category winners, Dribbble e-commerce).
3. Parallel `gsk crawler` calls on each URL → returns full page markdown.
4. That markdown is injected into Claude's critique prompt as
   **"REAL-WORLD REFERENCES"** context.
5. Claude now returns suggestions like *"Swap Inter for Cormorant
   Garamond 700 italic in the H1 — every Awwwards luxury winner uses
   editorial serifs"* and *"Replace terracotta #c87050 with burnished
   gold #B89A5A, matching Dribbble's luxury category consensus."*
6. The UI renders the reference URLs as clickable chips so judges /
   users can verify the citations.

**Architecture note:** we initially tried `batch_crawl_url_and_answer`
(one call, per-URL Q&A) but it returned "No content found" on the free
plan. Fanning out N parallel `crawler` calls worked reliably and is
still fast (~10s for 3 sites on top of Claude's ~25s).

**Feature-flagged gracefully:** if `GENSPARK_API_KEY` is missing or
the CLI binary isn't on PATH, grounded critics silently degrades to
Claude-only. Users see a "Genspark returned no references" notice;
nothing breaks.

**Provider module:** [apps/api/atelier_api/providers/genspark.py](https://github.com/bchuazw/atelier/blob/main/apps/api/atelier_api/providers/genspark.py)
**Wired into:** [apps/api/atelier_api/routes/critics.py](https://github.com/bchuazw/atelier/blob/main/apps/api/atelier_api/routes/critics.py)
```

## Field 4 — "Use of Claude"
`projectFieldUUID: d26a382a545f4efeacd497c03d3b4ac8`

```markdown
### Claude is the brain of every generative moment in Atelier

Four distinct Claude integrations, each picking the right model for the job:

1. **Fork rewrites (Haiku 4.5 / Sonnet 4.6 / Opus 4.7).** Every "make
   the hero warmer" prompt calls Claude with the full current HTML +
   the user's instruction + project context. Streams back via SSE. Users
   pick the model from a compact picker — Haiku for 6-second drafts,
   Sonnet for production rewrites, Opus when they want the highest
   fidelity.
2. **Design Critics (Sonnet, default).** Given target theme + optional
   Genspark grounding + current HTML, returns strict-JSON suggestions
   with category / severity / rationale tags. Users approve a subset;
   one composed prompt re-enters Claude to apply them all coherently.
3. **Drag-to-combine (Opus).** Merging two sibling variants needs high
   fidelity reasoning about which stylistic choices to donate vs keep.
   Opus reads both HTMLs + the chosen aspects (typography / palette /
   layout / copy) and synthesizes a new variant that preserves the
   target's structure while importing only the listed aspects from the
   source.
4. **Feedback decomposition (AutoReason-style, Sonnet).** Paste a
   stakeholder's multi-point paragraph; Claude extracts atomic change
   items with individual rationales. Users approve the checklist; one
   fork applies them all.

**Prompt caching** is used on the long system prompts (critic rubric,
merge rubric) via `cache_control: ephemeral` — costs drop ~90% on
follow-up calls within the same 5-minute window.

**BYOK + fallback:** users can POST their own key to `/settings/api-key`
at runtime, or rely on the server-side `ANTHROPIC_API_KEY`. The `/settings/status`
endpoint reports source-of-truth so the UI can warn "no key set."

**Core call site:** [apps/api/atelier_api/providers/claude.py](https://github.com/bchuazw/atelier/blob/main/apps/api/atelier_api/providers/claude.py)
**System prompts:** in [apps/api/atelier_api/routes/](https://github.com/bchuazw/atelier/tree/main/apps/api/atelier_api/routes) (fork, critics, merge, feedback — each has a cached system prompt).
```

## Field 5 — "What is the deployed URL for this project?"
`projectFieldUUID: 58dfff7b0c9b4037b380c0c0e6499f66`

```
https://atelier-web.onrender.com
```

*(Sandbox + web are live; API is currently suspended on the free tier.
Will resume before submission publish.)*

---

## Track application (single track)

Single-track hackathon — no per-track pitch required. The `tracksToApplyTo`
array gets one entry for the `5e75ce5782bb48e49034bf8ec94033f3` UUID.

## Gallery (pictures) — ≤6 real screenshots

In priority order (headline shot first so it's the thumbnail):

1. `grounded-critics-live.png` — Critics dialog with "GROUNDED IN 3
   REFERENCES VIA GENSPARK" banner + citation chips + Claude's
   hex-coded suggestions. **This is the sponsor-showcase shot.**
2. `viewer-side-by-side.png` — Full-page side-by-side comparing the
   warm-minimal "Plume" seed vs the dark-editorial-luxury variant
   produced by the grounded critic run.
3. `canvas-two-nodes.png` — Canvas with both nodes + the Compare button
   clearly visible on the seed card (discoverable Compare flow).
4. `ux-fixes-new-project.png` — Template picker with the 6 curated
   aesthetics, vibe chips (PREMIUM / BRUTALIST / CALM / FUTURISTIC),
   and the disabled-Create helper text.
5. `after-critics-apply.png` — Split-view showing the dramatic
   before-vs-after of grounded-critic apply.

All real Playwright captures, no AI generation.

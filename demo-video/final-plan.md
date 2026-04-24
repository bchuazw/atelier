# Final video plan — refreshed for Cycle 7 (Grounded Critics)

**Status:** scaffolding + narration committed. **Awaiting user green-light to record.**
All features referenced below are verified working on localhost with the
real Genspark key as of 2026-04-24.

## Hard constraints

- **Duration:** exactly 2:00. Overage gets judged poorly.
- **Resolution:** 1920×1080 @ 30fps.
- **File size:** target ≤ 10 MB (Hyperframes usually produces ~4–6 MB).
- **Audio:** single voiceover track, no music. The hackathon organizers
  gave no explicit audio guidelines, so restraint is the safe bet.
- **Sponsors on screen:** Claude + Genspark + MiniMax logos in the outro
  card. Cycle 7 upgraded Genspark from a narration name-drop to an actual
  product integration (grounded critics), so both co-sponsors now have
  real on-screen moments, not just a credit.

## Beats schedule (sums to 2:00 exactly)

| # | Time (mm:ss) | Dur | On-screen action | Narration one-liner |
|---|--------------|-----|------------------|----------------------|
| 1 | 0:00 – 0:08  | 8s  | Title card: "Atelier. Design iteratively. Branch, critique, merge." | opening line |
| 2 | 0:08 – 0:22  | 14s | New project → Templates tab → pick **Warm Minimal** (Plume planner). Seed card lands. | templates line |
| 3 | 0:22 – 0:55  | **33s** | **Grounded Critics** — Critics dialog, theme `premium luxury`, check **Ground with Genspark research**, Spawn. Shows blue "GROUNDED IN 3 REFERENCES VIA GENSPARK" banner with clickable chips (Aesop / Awwwards / Dribbble). Suggestions cite hex codes. Approve high/medium → Apply → dark-editorial luxury variant appears as child. | critics line (sponsor showcase) |
| 4 | 0:55 – 1:18  | 23s | **Compare** — click Compare on seed (label flips to "A — pick B"), click Compare on variant. TopBar "Comparing Seed ↔ Premium Luxury Plume Rewrite" pill appears. Split viewer opens in **Side-by-side** mode, both full pages scaled to fit. Press `3` → Mobile viewport to showcase responsive. Close. | compare line |
| 5 | 1:18 – 1:35  | 17s | PromptBar quick fork: `"swap to a serif heading"` → Sonnet streams the rewrite, new node scale-fades in. | prompt line |
| 6 | 1:35 – 1:50  | 15s | Drag one variant onto another → MergeDialog (Opus) auto-selected → merged node scale-fades in with glow animation. | drag-to-combine line |
| 7 | 1:50 – 2:00  | 10s | Outro card — logos: **Claude · Genspark · MiniMax · ElevenLabs** · atelier-web URL | outro line |

**Why the shape changed:** Cycle 7 added a real Genspark integration, so
beat #3 earns 33s instead of 22s (it's the sponsor showcase AND the most
distinctive feature — suggestions that cite real landing pages). Beat #4
is new (Compare flow was undiscoverable before Cycle 7, now it's a
discrete demo moment with the cyan progress pill). The old Feedback beat
was dropped — AutoReason-style feedback is visible through the Critics
flow's same checklist+apply pattern, so the video no longer needs to
spend 22s rebuilding that understanding.

All times are targets; `capture.mjs` still records a single WebM per
beat, and `composition.html` will trim/stretch each to match. If a beat
comes in short we'll pad the outro; if long we'll trim the PromptBar
beat first.

## Narration script (draft — tightened for new beats)

> **(0:00) opening:** "Most design feedback gets lost between a screenshot, a paragraph, and a guess. Atelier turns every critique into a branch you can see, compare, and keep."
>
> **(0:08) templates:** "Start from a seed — paste your own HTML, point at a URL, or pick one of six curated aesthetics. Here's Warm Minimal."
>
> **(0:22) critics (the showcase):** "Now the move. Pick a target vibe — premium luxury — and ask Atelier to ground the critique in real examples. Genspark pulls three live landing pages. Claude reads them and returns suggestions that cite the actual sites. Not 'use a more premium palette' — specifically the Aesop-style parchment over burnished gold. Approve, apply, and the variant lands as a child on the canvas."
>
> **(0:55) compare:** "Click Compare on one node, click Compare on another, and both pages open side by side, full-size. Swap to mobile with a keystroke."
>
> **(1:18) prompt:** "Every node has a prompt bar. Ask Sonnet for a serif headline — the rewrite streams in place, and the new branch threads in."
>
> **(1:35) merge:** "Like two variants for different reasons? Drag one onto the other. Opus merges them — a new branch, edges showing where each parent contributed."
>
> **(1:50) outro:** "Atelier. Every round of design, branched and kept. Built on Claude, grounded with Genspark, hero media by MiniMax."

Word count: ~190 words. At ~150wpm the script lands at ~76s of actual
speech, leaving ~44s of silent on-screen action across the 2:00 — enough
for the Genspark reference chips to breathe and the side-by-side viewer
to register before we move on.

## Voice choice (ElevenLabs)

Default: **Domi** (`AZnzlk1XvdvUeBnXmlld`) — confident product-marketing
register. Alternatives if Domi doesn't click:

- **Rachel** (`21m00Tcm4TlvDq8ikWAM`) — warm narrator, more inviting
- **Antoni** (`ErXwobaYiN019PkySvjV`) — measured male voice

Swap by setting `ELEVENLABS_VOICE_ID` before `scripts/narrate.mjs`.
Fallback: OpenAI TTS `tts-1-hd` (`alloy`) if the ElevenLabs key is missing.

## Execution order (when user green-lights)

1. **Pre-flight** — ensure localhost stack is up (`bash scripts/dev.sh`), a
   fresh smoketest project is seeded from Warm Minimal, `.env.local` has
   `GENSPARK_API_KEY` set.
2. **Clean the Recent Projects list** — delete everything except the
   planned demo seed so the Empty State list looks curated.
3. **Capture beats** — `node demo-video/scripts/capture.mjs` (updated to
   hit the new Compare pill + Ground-with-Genspark checkbox; see below).
4. **Generate narration** — `node demo-video/scripts/narrate.mjs`. Check
   the output WAV for "sunsetting" pauses at beat boundaries.
5. **Compose** — author `demo-video/composition.html` to stitch per-beat
   WebM + narration WAV + captions. Render: `npx hyperframes render`.
6. **QA pass** — watch through twice, once at 1.0× and once at 0.5× to
   catch jitter / unmatched text.
7. **Submit** — upload MP4, include hosted URL + GitHub invite.

## capture.mjs — updates needed before a recording run

The existing [scripts/capture.mjs](scripts/capture.mjs) still expects the
pre–Cycle 7 button labels and the old Feedback beat. Before recording:

- [ ] Beat 3: open Critics, **type "premium luxury"**, **click the
  "Ground with Genspark research" checkbox**, Spawn, wait ~15s for the
  references banner, approve default selection, Apply.
- [ ] Beat 4 (new): use `document.evaluate` to click the Compare button
  on each node by text (`'Compare'`, then `'Compare ·B'`), wait for the
  TopBar pill, wait for viewer open, press `3` for Mobile.
- [ ] Remove the old Feedback beat — not in the new schedule.
- [ ] Add an extra 2s hold at end of beat 3 on the references banner so
  viewers can read "Aesop / Awwwards / Dribbble" before the apply fires.

I won't touch the script until the user green-lights recording.

## Deliverables at submission

- `atelier-demo.mp4` (MP4, ≤ 10 MB, 1920×1080, 2:00)
- Hosted URL: https://atelier-web.onrender.com (or `localhost:3000` if
  `atelier-api` stays suspended at submission time — the demo was
  recorded locally either way)
- GitHub: https://github.com/bchuazw/atelier (private — invite judges)
- PLAN.md as the written design doc

## Open decisions

- **Record on localhost vs prod?** Localhost is the conservative choice
  (no cold-start pause on the Render free tier during beat 2; API key
  already configured). If user resumes atelier-api before recording, we
  can record against prod instead — cosmetic difference only, same code.
- **Captions on video?** Worth doing for accessibility + sound-off
  viewing. Hyperframes supports caption tracks as `<div data-start=...>`
  elements. ~15 min of extra work; decide at QA time.
- **A/B voice test?** Generate both Domi and Rachel versions, pick the
  one that pairs better with the Genspark-grounded-critics beat (the
  script's longest dwell). Skip if short on time.

# Final video plan — staged until we're submission-ready

**Status:** scaffolding committed (scripts, narration, package.json). Not
rendered. We render the MP4 only once cycle 5+ refinements are locked in
and the live site is judge-ready.

## Hard constraints

- **Duration:** exactly 2:00. Overage gets judged poorly.
- **Resolution:** 1920×1080 @ 30fps.
- **File size:** target ≤ 10 MB (Hyperframes usually produces ~4–6 MB).
- **Audio:** single voiceover track, no music. The hackathon organizers
  gave no explicit audio guidelines, so restraint is the safe bet.
- **Sponsors on screen:** Claude + MiniMax logos in the outro card.
  Genspark sponsor callout lives in the narration ("exported the
  redesign rationale as a Genspark deck for the boss") since they have
  no API to integrate — the mention is the integration.

## The 8 beats (matches `scripts/capture.mjs`)

| # | Time   | Duration | What happens | Narration |
|---|--------|----------|--------------|-----------|
| 1 | 0:00   | 10s      | Title card — "Atelier. An infinite canvas for iterative frontend craft." | opening line |
| 2 | 0:10   | 18s      | Open New Project → Templates tab → pick Editorial Serif → seed card lands | templates line |
| 3 | 0:28   | 22s      | Click Critics → theme "premium luxury" → Sonnet returns 8 suggestions → approve high/medium → apply → new variant | critics line |
| 4 | 0:50   | 24s      | PromptBar × 2 forks, one Playfair one Inter. Open Before/After viewer. Drag slider | fonts line |
| 5 | 1:14   | 20s      | Drag one variant onto another → MergeDialog (Opus) → dashed contribution edge draws → new merged node scale-fades in | drag-to-combine line |
| 6 | 1:34   | 22s      | Click Feedback → paste a 5-point boss message → Sonnet decomposes to 6 items → approve → apply → new variant | feedback line |
| 7 | 1:56   | 4s       | Outro card — atelier-web.onrender.com · Claude · MiniMax · ElevenLabs · Genspark | outro line |

All times are approximate; `capture.mjs` records a single WebM per beat,
and `composition.html` will trim/stretch each to match the schedule above.

## Voice choice (ElevenLabs)

Default voice: **Domi** (`AZnzlk1XvdvUeBnXmlld`) — confident product-marketing
register. Alternatives if Domi doesn't click:

- **Rachel** (`21m00Tcm4TlvDq8ikWAM`) — warm narrator, more inviting
- **Antoni** (`ErXwobaYiN019PkySvjV`) — measured male voice

Swap by setting `ELEVENLABS_VOICE_ID` in env before `scripts/narrate.mjs`.
`scripts/narrate.mjs` falls back to OpenAI TTS (`tts-1-hd`, voice `alloy`)
if the ElevenLabs key is missing.

## What's still to do before we render

1. Wait until cycle 5 refinements are done (export, SSE apply, template
   thumbnails — currently in flight).
2. Clean up the judging Atelier instance — delete junk test projects so
   the "Recent projects" list is curated.
3. Create the demo project fresh in-capture (`capture.mjs` does this).
4. Author `composition.html` after the first run of `capture.mjs` so we
   know each beat's real WebM duration.
5. Generate the voiceover (`narrate.mjs`).
6. Render (`npx hyperframes render composition.html`).
7. Watch it through once; iterate on pacing if a beat feels rushed.
8. Submit.

## Deliverables at submission

- `atelier-demo.mp4` (MP4, ≤ 10 MB, 1920×1080, 2:00)
- Hosted URL: https://atelier-web.onrender.com
- GitHub: https://github.com/bchuazw/atelier (private — invite judges)
- PLAN.md as the written design doc

## Open decisions

- Keep the "Genspark deck for the boss" mention in the narration, or
  replace it with something we actually demo in-product? Leaving it in
  for now — it's honest (we did mention Genspark as a sponsor).
- Add captions on top of the video for accessibility + sound-off
  viewing? Worth doing if time allows — Hyperframes supports caption
  tracks as `<div data-start=...>` elements.
- Pass the video through a second ElevenLabs voice for an A/B comparison
  before locking the final.

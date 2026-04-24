# Atelier — 2-minute demo video

A Hyperframes composition that records the full user story on the live
atelier-web.onrender.com deployment and renders to a 1920×1080 MP4.

## Files

- `scripts/narration.md` — the voiceover script (~45s of spoken content
  over 2 minutes of visuals).
- `scripts/narrate.mjs` — runs the narration through ElevenLabs (or
  OpenAI TTS as fallback) and writes `assets/voiceover.mp3`. Reads
  `ELEVENLABS_API_KEY` / `OPENAI_API_KEY` from the env.
- `scripts/capture.mjs` — Playwright script that drives
  `https://atelier-web.onrender.com` through the user story and records
  a WebM per beat into `assets/screencaps/*.webm`.
- `composition.html` — Hyperframes timeline that assembles the beats
  into the final 2-minute cut (not committed yet — authored after the
  captures exist).
- `package.json` — `hyperframes` + `playwright` + `@elevenlabs/elevenlabs-js`.

## Rendering the video (run in order)

```bash
cd demo-video
npm install
# 1. Generate the voiceover (needs ELEVENLABS_API_KEY in env)
ELEVENLABS_API_KEY=... node scripts/narrate.mjs
# 2. Capture the screencasts from the live site
node scripts/capture.mjs
# 3. Compose + render to MP4
npx hyperframes render composition.html --out atelier-demo.mp4 \
  --resolution 1920x1080 --fps 30
```

Output: `atelier-demo.mp4`, ~2 minutes, ≤ 10 MB.

## Story beats (maps 1:1 to `composition.html` timeline)

| Time | Beat |
|---|---|
| 0:00-0:10 | Title card: Atelier — infinite canvas for iterative frontend craft. |
| 0:10-0:25 | New project → Templates tab → Editorial Serif chosen. Seed renders. |
| 0:25-0:45 | Click Critics, type "premium luxury", spawn suggestions. Review the 8-item checklist, apply the high-severity ones. New variant arrives. |
| 0:45-1:10 | PromptBar: "test two fonts". Fork two variants (Playfair vs Canela-style). Open Before/After. Slide divider. |
| 1:10-1:30 | Drag one variant onto another → MergeDialog opens → Opus synthesizes. Dashed fuchsia contribution edge draws. |
| 1:30-1:55 | Feedback: paste a long multi-change boss message. Analyze → atomic checklist → Apply. New variant with all the boss changes. |
| 1:55-2:00 | Outro card: atelier-web.onrender.com · built with Claude + MiniMax + ElevenLabs. |

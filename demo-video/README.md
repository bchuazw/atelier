# Atelier — 2-minute demo video (staging area)

Scaffolding for the submission video. Not executed yet — we're still
refining the product (cycle 5+). Full plan lives in
[final-plan.md](final-plan.md).

## Files

- `final-plan.md` — beats, timing, tools, open decisions.
- `scripts/narration.md` — voiceover script (~45s over 120s of visuals).
- `scripts/narrate.mjs` — ElevenLabs (primary) / OpenAI TTS (fallback).
- `scripts/capture.mjs` — Playwright walkthrough of the live URL.
- `composition.html` — (pending) Hyperframes timeline.
- `package.json` — playwright + hyperframes.

## Quick reference

```bash
cd demo-video
npm install
ELEVENLABS_API_KEY=... node scripts/narrate.mjs       # → assets/voiceover.mp3
node scripts/capture.mjs                                # → assets/screencaps/
# Then author composition.html with durations from captures
npx hyperframes render composition.html --out atelier-demo.mp4 --resolution 1920x1080 --fps 30
```

#!/usr/bin/env bash
# Stitch the captured WebM into the final MP4:
#   - speed up the "LLM / Genspark loading" segments so the page isn't
#     just spinning on-screen
#   - keep natural speed on UI actions (dialogs opening, clicks, the
#     auto-opened compare viewer, etc.)
#   - overlay the TTS narration track
#   - output 1920x1080 @ 30fps, AAC audio, <10MB target
#
# Beat markers from capture.mjs are relative to beat-01 landing at t=0;
# the WebM has ~2.5s of navigation/init at the start and ~8s of dwell at
# the end, so all trim points below add ~2.5s to the beat offsets.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
FFMPEG="$ROOT/node_modules/ffmpeg-static/ffmpeg.exe"
# Pick the largest captured WebM (the main recording, not any short intermediate).
INPUT_WEBM="$(ls -S "$ROOT/assets/screencaps/"*.webm 2>/dev/null | head -1)"
# Prefer the ElevenLabs MP3 if narrate.mjs produced one; fall back to the
# SAPI WAV from narrate-local.ps1 so compose works without cloud-TTS keys.
if [ -f "$ROOT/assets/voiceover.mp3" ]; then
  NARRATION="$ROOT/assets/voiceover.mp3"
else
  NARRATION="$ROOT/assets/voiceover.wav"
fi
OUT="$ROOT/atelier-demo.mp4"

if [ -z "$INPUT_WEBM" ] || [ ! -f "$INPUT_WEBM" ]; then
  echo "[compose] no WebM found in $ROOT/assets/screencaps/ — run scripts/capture.mjs first" >&2
  exit 1
fi
if [ ! -f "$NARRATION" ]; then
  echo "[compose] missing $NARRATION — run narrate.mjs (or narrate-local.ps1)" >&2
  exit 1
fi
echo "[compose] video: $INPUT_WEBM"
echo "[compose] audio: $NARRATION"

# Segment plan (WebM seconds -> output after setpts). v2: keeps the
# merge-complete reveal visible in the outro + natural-speed dwell on
# the manual Compare flow (click A → click B → split viewer).
# Boundaries calibrated for the bsh11g4wy capture run.
#   1. intro               2.5-15    @ 1x  -> 12.5s  (landing, template, create, critics open)
#   2. grounding wait      15-55     @ 3x  -> 13.3s  (compressed Genspark + Claude load)
#   3. grounded banner     55-65     @ 1x  -> 10.0s  (reference chips dwell so chips are readable)
#   4. apply fork          65-100    @ 4x  ->  8.75s (apply click + Sonnet stream, compressed)
#   5. viewer auto-open    100-108.5 @ 1x  ->  8.5s  (split viewer shows seed vs variant)
#   6. MANUAL COMPARE      108.5-116.9 @ 1x -> 8.4s  (click A → click B → mobile — natural pace)
#   7. prompt fork         116.9-149 @ 3x  -> 10.7s  (type + Sonnet stream, compressed)
#   8. variant lands       149-160   @ 1x  -> 11.0s  (new branch animates in)
#   9. merge wait          160-206.6 @ 4x  -> 11.65s (compressed Opus merge)
#  10. merge-complete+outro 206.6-215.2 @ 1x -> 8.6s (merged node reveal + canvas overview)
#   TOTAL:  ~103.4s
# Audio: adelay=2000|2000 → narration runs 2s-95s, video runs 0-103s,
# ~8s silent outro on the merged canvas (intentional fade).

"$FFMPEG" -y \
  -i "$INPUT_WEBM" \
  -i "$NARRATION" \
  -filter_complex "
    [0:v]trim=start=2.5:end=15,setpts=PTS-STARTPTS[v1];
    [0:v]trim=start=15:end=55,setpts=(PTS-STARTPTS)/3[v2];
    [0:v]trim=start=55:end=65,setpts=PTS-STARTPTS[v3];
    [0:v]trim=start=65:end=100,setpts=(PTS-STARTPTS)/4[v4];
    [0:v]trim=start=100:end=108.5,setpts=PTS-STARTPTS[v5];
    [0:v]trim=start=108.5:end=116.9,setpts=PTS-STARTPTS[v6];
    [0:v]trim=start=116.9:end=149,setpts=(PTS-STARTPTS)/3[v7];
    [0:v]trim=start=149:end=160,setpts=PTS-STARTPTS[v8];
    [0:v]trim=start=160:end=206.6,setpts=(PTS-STARTPTS)/4[v9];
    [0:v]trim=start=206.6:end=215.2,setpts=PTS-STARTPTS[v10];
    [v1][v2][v3][v4][v5][v6][v7][v8][v9][v10]concat=n=10:v=1:a=0[vcat];
    [vcat]fps=30,scale=1920:1080[vout];
    [1:a]adelay=2000|2000,aresample=async=1[aout]
  " \
  -map "[vout]" -map "[aout]" \
  -t 104 \
  -c:v libx264 -preset medium -crf 26 -pix_fmt yuv420p -movflags +faststart \
  -c:a aac -b:a 128k -ac 2 \
  "$OUT"

echo
echo "[compose] output: $OUT"
"$FFMPEG" -i "$OUT" 2>&1 | grep -E "Duration|Stream" | sed 's/^/[compose]  /'
ls -lh "$OUT" | awk '{print "[compose]  size: " $5}'

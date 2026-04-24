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

# Segment plan (WebM seconds -> output after setpts):
#   1. intro              2.5-15     @ 1x   -> 12.5s   (landing, template, create, critics click)
#   2. grounding wait     15-63.5    @ 2.5x -> 19.4s   (compressed Genspark + Claude load)
#   3. grounded banner    63.5-68    @ 1x   ->  4.5s   (reference chips appear, approve)
#   4. apply fork         68-106     @ 2.5x -> 15.2s   (compressed rewrite stream)
#   5. viewer auto-open   106-120    @ 1x   -> 14.0s   (BIG moment — let it breathe)
#   6. prompt setup       120-127    @ 1x   ->  7.0s   (close viewer, type in PromptBar)
#   7. prompt fork        127-150    @ 2.5x ->  9.2s   (compressed Sonnet stream)
#   8. variant lands      150-160    @ 1x   -> 10.0s   (new node animation)
#   9. merge wait         160-210    @ 3x   -> 16.7s   (compressed Opus merge)
#  10. merge+outro        210-217.8  @ 1x   ->  7.8s   (merged node + canvas overview)
#   TOTAL:  ~116.3s  (narration = 109s, so ~7s silent outro)

"$FFMPEG" -y \
  -i "$INPUT_WEBM" \
  -i "$NARRATION" \
  -filter_complex "
    [0:v]trim=start=2.5:end=15,setpts=PTS-STARTPTS[v1];
    [0:v]trim=start=15:end=63.5,setpts=(PTS-STARTPTS)/2.5[v2];
    [0:v]trim=start=63.5:end=68,setpts=PTS-STARTPTS[v3];
    [0:v]trim=start=68:end=106,setpts=(PTS-STARTPTS)/2.5[v4];
    [0:v]trim=start=106:end=120,setpts=PTS-STARTPTS[v5];
    [0:v]trim=start=120:end=127,setpts=PTS-STARTPTS[v6];
    [0:v]trim=start=127:end=150,setpts=(PTS-STARTPTS)/2.5[v7];
    [0:v]trim=start=150:end=160,setpts=PTS-STARTPTS[v8];
    [0:v]trim=start=160:end=210,setpts=(PTS-STARTPTS)/3[v9];
    [0:v]trim=start=210:end=217.8,setpts=PTS-STARTPTS[v10];
    [v1][v2][v3][v4][v5][v6][v7][v8][v9][v10]concat=n=10:v=1:a=0[vcat];
    [vcat]fps=30,scale=1920:1080[vout];
    [1:a]aresample=async=1[aout]
  " \
  -map "[vout]" -map "[aout]" \
  -t 120 \
  -c:v libx264 -preset medium -crf 26 -pix_fmt yuv420p -movflags +faststart \
  -c:a aac -b:a 128k -ac 2 \
  "$OUT"

echo
echo "[compose] output: $OUT"
"$FFMPEG" -i "$OUT" 2>&1 | grep -E "Duration|Stream" | sed 's/^/[compose]  /'
ls -lh "$OUT" | awk '{print "[compose]  size: " $5}'

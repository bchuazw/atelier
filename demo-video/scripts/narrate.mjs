// Generate the voiceover MP3 from scripts/narration.md.
// Tries ElevenLabs first (better voices), falls back to OpenAI TTS.
// Reads the script, strips [timestamp] markers + markdown, sends the
// speakable text to the TTS API, writes the result to assets/voiceover.mp3.
import { writeFile, readFile, mkdir } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const ASSETS = resolve(ROOT, "assets");
const OUT = resolve(ASSETS, "voiceover.mp3");

// ElevenLabs voice IDs (free-tier safe):
//   "21m00Tcm4TlvDq8ikWAM" — Rachel (warm, clear narrator)
//   "AZnzlk1XvdvUeBnXmlld" — Domi (confident, product marketing tone)
//   "ErXwobaYiN019PkySvjV" — Antoni (measured male narrator)
const ELEVENLABS_VOICE_ID = process.env.ELEVENLABS_VOICE_ID || "AZnzlk1XvdvUeBnXmlld";
const OPENAI_TTS_VOICE = process.env.OPENAI_TTS_VOICE || "alloy";

function extractSpeakableText(md) {
  return md
    .split("\n")
    .filter((l) => !l.startsWith("#") && !l.startsWith("---") && l.trim())
    .map((l) => l.replace(/^\*\*\[\d+:\d+\][^*]*\*\*/g, "").trim())
    .filter((l) => l.length > 0)
    .join("\n\n");
}

async function tryElevenLabs(text) {
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) return null;
  console.log(`[narrate] ElevenLabs voice=${ELEVENLABS_VOICE_ID}…`);
  const resp = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${ELEVENLABS_VOICE_ID}`,
    {
      method: "POST",
      headers: {
        "xi-api-key": key,
        "Content-Type": "application/json",
        Accept: "audio/mpeg",
      },
      body: JSON.stringify({
        text,
        model_id: "eleven_multilingual_v2",
        voice_settings: { stability: 0.5, similarity_boost: 0.75, style: 0.2, use_speaker_boost: true },
      }),
    }
  );
  if (!resp.ok) {
    console.error(`ElevenLabs failed ${resp.status}: ${(await resp.text()).slice(0, 400)}`);
    return null;
  }
  return Buffer.from(await resp.arrayBuffer());
}

async function tryOpenAI(text) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return null;
  console.log(`[narrate] OpenAI TTS voice=${OPENAI_TTS_VOICE}…`);
  const resp = await fetch("https://api.openai.com/v1/audio/speech", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "tts-1-hd",
      voice: OPENAI_TTS_VOICE,
      input: text,
      response_format: "mp3",
    }),
  });
  if (!resp.ok) {
    console.error(`OpenAI failed ${resp.status}: ${(await resp.text()).slice(0, 400)}`);
    return null;
  }
  return Buffer.from(await resp.arrayBuffer());
}

async function main() {
  const md = await readFile(resolve(__dirname, "narration.md"), "utf8");
  const text = extractSpeakableText(md);
  console.log(`[narrate] script chars: ${text.length}`);

  await mkdir(ASSETS, { recursive: true });

  let mp3 = await tryElevenLabs(text);
  if (!mp3) mp3 = await tryOpenAI(text);
  if (!mp3) {
    console.error(
      "[narrate] No API key produced audio. Set ELEVENLABS_API_KEY or OPENAI_API_KEY."
    );
    process.exit(1);
  }
  await writeFile(OUT, mp3);
  console.log(`[narrate] wrote ${OUT} (${mp3.length} bytes)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

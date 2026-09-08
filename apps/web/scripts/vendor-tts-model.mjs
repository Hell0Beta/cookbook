// Vendor the local TTS model at BUILD time — development.md §14.1: the spoken
// replies use Kokoro-82M (q8) via kokoro-js, fully local. All model artifacts
// live under apps/web/public/models/ and are served from the app's own origin;
// transformers.js is configured with remote fetching disabled, so nothing is
// downloaded at RUNTIME (§0 offline-first).
//
// Downloads (build-time network, same category as a lockfile install):
//   Kokoro-82M-v1.0-ONNX — q8 ONNX weights + config + tokenizer from the HF repo
//   voice embeddings     — copied from node_modules/kokoro-js/voices (they ship
//                          in the npm package; no download needed). NOTE:
//                          kokoro-js loads voices by URL from the HF repo —
//                          tts-worker.ts intercepts that via the Cache API,
//                          so the .bin files MUST be served from /models/.
//
// Usage: pnpm --filter @cookbook/web vendor:tts   (idempotent — skips present files)
import { cp, mkdir, stat, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const webRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const modelsDir = path.join(webRoot, "public", "models");

// Directory layout must match what transformers.js expects for a local model
// with this id: public/models/Kokoro-82M-v1.0-ONNX/{...}. The repo uses the
// older split naming with `_quantized` as the q8 suffix — exactly what
// transformers.js v3's `dtype: "q8"` requests.
const MODEL_REPO = "onnx-community/Kokoro-82M-v1.0-ONNX";
const MODEL_DIR = path.join(modelsDir, "Kokoro-82M-v1.0-ONNX");
const MODEL_FILES = [
  "config.json",
  "tokenizer.json",
  "tokenizer_config.json", // transformers.js requests this when building the tokenizer
  "onnx/model_quantized.onnx", // q8 weights (~92 MB)
];

// Voice embeddings to serve (each ~0.5 MB). af_heart is the default; the
// others are the highest-graded alternates (kokoro-js README voice table).
const VOICES_DIR = path.join(MODEL_DIR, "voices");
const VOICES = ["af_heart", "af_bella", "af_nicole", "am_michael", "am_puck"];
// Voices ship inside the npm package — copy rather than download.
const VOICES_SRC = path.join(webRoot, "node_modules", "kokoro-js", "voices");

async function download(repo, file) {
  const url = `https://huggingface.co/${repo}/resolve/main/${file}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

async function vendorFile(repo, dir, file) {
  const dest = path.join(dir, file);
  if (existsSync(dest)) {
    const size = (await stat(dest)).size;
    console.log(`[vendor:tts] ${file} present (${(size / 1e6).toFixed(1)} MB) — skipping`);
    return;
  }
  console.log(`[vendor:tts] downloading ${repo}/${file}…`);
  const buf = await download(repo, file);
  await mkdir(path.dirname(dest), { recursive: true });
  await writeFile(dest, buf);
  console.log(`[vendor:tts] wrote ${file} (${(buf.length / 1e6).toFixed(1)} MB)`);
}

async function main() {
  for (const file of MODEL_FILES) {
    await vendorFile(MODEL_REPO, MODEL_DIR, file);
  }

  if (existsSync(VOICES_SRC)) {
    let copied = 0;
    for (const voice of VOICES) {
      const src = path.join(VOICES_SRC, `${voice}.bin`);
      const dest = path.join(VOICES_DIR, `${voice}.bin`);
      if (!existsSync(src)) {
        throw new Error(`Voice "${voice}.bin" missing from ${VOICES_SRC} — reinstall kokoro-js`);
      }
      if (!existsSync(dest)) {
        await mkdir(VOICES_DIR, { recursive: true });
        await cp(src, dest);
        copied++;
      }
    }
    console.log(`[vendor:tts] voices vendored (${copied} new, ${VOICES.length} total) → public/models/Kokoro-82M-v1.0-ONNX/voices/`);
  } else {
    console.warn(
      "[vendor:tts] node_modules/kokoro-js not installed — run pnpm install first (voices not vendored)",
    );
  }

  console.log("[vendor:tts] done — model + voices are served from the app's own origin at /models/");
}

main().catch((err) => {
  console.error("[vendor:tts] failed:", err.message);
  process.exit(1);
});

// Vendor the local STT model at BUILD time — development.md §14.1: all model
// + runtime artifacts live under apps/web/public/models/ and are served from
// the app's own origin; transformers.js is configured with remote fetching
// disabled, so nothing is downloaded at RUNTIME (§0 offline-first).
//
// Downloads (build-time network, same category as a lockfile install):
//   whisper-tiny.en  — ONNX q8 weights + config + tokenizer from the HF repo
//   ort wasm binaries — copied from node_modules/@huggingface/transformers/dist
//
// Usage: pnpm --filter @cookbook/web vendor:stt   (idempotent — skips present files)
import { cp, mkdir, readdir, stat, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const webRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const modelsDir = path.join(webRoot, "public", "models");

// The model directory layout must match what transformers.js expects for a
// local model named "whisper-tiny.en": public/models/whisper-tiny.en/{...}.
// NOTE: this repo uses the older split-model layout with `_quantized` as the
// q8 suffix — exactly what transformers.js v3's `dtype: "q8"` requests. There
// is no single model_q8.onnx here.
const MODEL_REPO = "onnx-community/whisper-tiny.en";
const MODEL_DIR = path.join(modelsDir, "whisper-tiny.en");
const MODEL_FILES = [
  "config.json",
  "generation_config.json",
  "tokenizer.json",
  "tokenizer_config.json", // transformers.js requests this when building the tokenizer
  "preprocessor_config.json",
  "onnx/encoder_model_quantized.onnx", // q8 encoder
  "onnx/decoder_model_merged_quantized.onnx", // q8 merged decoder (with past)
];

// ORT wasm binaries ship inside the npm package's dist — copy rather than
// download so the versions always match the installed library.
const TRANSFORMERS_DIST = path.join(webRoot, "node_modules", "@huggingface", "transformers", "dist");
const ORT_DIR = path.join(modelsDir, "ort");

async function download(repo, file) {
  const url = `https://huggingface.co/${repo}/resolve/main/${file}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

async function main() {
  await mkdir(path.join(MODEL_DIR, "onnx"), { recursive: true });
  await mkdir(ORT_DIR, { recursive: true });

  for (const file of MODEL_FILES) {
    const dest = path.join(MODEL_DIR, file);
    if (existsSync(dest)) {
      const size = (await stat(dest)).size;
      console.log(`[vendor:stt] ${file} present (${(size / 1e6).toFixed(1)} MB) — skipping`);
      continue;
    }
    console.log(`[vendor:stt] downloading ${MODEL_REPO}/${file}…`);
    const buf = await download(MODEL_REPO, file);
    await mkdir(path.dirname(dest), { recursive: true });
    await writeFile(dest, buf);
    console.log(`[vendor:stt] wrote ${file} (${(buf.length / 1e6).toFixed(1)} MB)`);
  }

  if (existsSync(TRANSFORMERS_DIST)) {
    // The dist folder carries ort-wasm*.wasm (+ .jsep variants). Copy them all;
    // the worker points env.backends.onnx.wasm.wasmPaths at /models/ort/.
    let copied = 0;
    for (const entry of await readdir(TRANSFORMERS_DIST)) {
      if (entry.startsWith("ort-wasm") && (entry.endsWith(".wasm") || entry.endsWith(".mjs"))) {
        await cp(path.join(TRANSFORMERS_DIST, entry), path.join(ORT_DIR, entry));
        copied++;
      }
    }
    console.log(`[vendor:stt] copied ${copied} ORT wasm/mjs files → public/models/ort/`);
  } else {
    console.warn(
      "[vendor:stt] node_modules/@huggingface/transformers not installed — run pnpm install first (ORT wasm files not vendored)",
    );
  }

  console.log("[vendor:stt] done — models are served from the app's own origin at /models/");
}

main().catch((err) => {
  console.error("[vendor:stt] failed:", err.message);
  process.exit(1);
});

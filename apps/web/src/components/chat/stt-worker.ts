// STT Web Worker — development.md §14.1: local whisper (tiny.en, q8) via
// transformers.js, in a dedicated worker so model load + inference never block
// the UI thread. All model/runtime artifacts are vendored under /models/ and
// served from this origin — env.allowRemoteModels=false means the worker can
// NEVER fall back to the HuggingFace hub at runtime (§0 offline-first).
//
// Message protocol:
//   → { type: "load" }                     (lazy: first use arms the pipeline)
//   ← { type: "status", stage: "loading" | "ready" | "error", message? }
//   → { type: "transcribe", audio: Float32Array }   (16 kHz mono PCM)
//   ← { type: "status", stage: "transcribing" }
//   ← { type: "result", text }  |  { type: "status", stage: "error", message }
import { env, pipeline } from "@huggingface/transformers";

// Local-only models: /models/whisper-tiny.en/... — vendored by
// `pnpm vendor:stt` (apps/web/scripts/vendor-stt-model.mjs).
env.allowRemoteModels = false;
env.allowLocalModels = true;
if (typeof self.location !== "undefined") {
  env.localModelPath = new URL("/models/", self.location.origin).href;
}
// ORT wasm binaries also vendored locally (copied from the npm package's dist).
if (env.backends.onnx.wasm) {
  env.backends.onnx.wasm.wasmPaths = "/models/ort/";
}

// The ASR pipeline's public typing is awkward to name (generic factory); type
// it by what we actually call it with.
type Transcriber = (
  audio: Float32Array,
  opts: { language?: string; task?: string },
) => Promise<{ text?: string } | { text?: string }[]>;

let transcriber: Transcriber | null = null;
let loading: Promise<void> | null = null;

async function ensureLoaded() {
  if (transcriber) return;
  if (!loading) {
    loading = (async () => {
      postMessage({ type: "status", stage: "loading", message: "Loading speech model…" });
      try {
        transcriber = (await pipeline("automatic-speech-recognition", "whisper-tiny.en", {
          dtype: "q8", // quantized per development.md §14.1
          // (device stays default: WASM, WebGPU where the browser exposes it)
        })) as unknown as Transcriber;
        postMessage({ type: "status", stage: "ready" });
      } catch (err) {
        loading = null; // allow retry
        postMessage({
          type: "status",
          stage: "error",
          message: err instanceof Error ? err.message : "Could not load the speech model",
        });
        throw err;
      }
    })();
  }
  await loading;
}

self.onmessage = async (e: MessageEvent) => {
  const msg = e.data as { type: string; audio?: Float32Array };
  try {
    if (msg.type === "load") {
      await ensureLoaded();
      return;
    }
    if (msg.type === "transcribe") {
      await ensureLoaded();
      postMessage({ type: "status", stage: "transcribing" });
      const audio = msg.audio!;
      const output = await transcriber!(audio, {
        // English-only model: skip language detection; keep outputs terse.
        language: "en",
        task: "transcribe",
      });
      const text = (Array.isArray(output) ? output[0]?.text : output?.text) ?? "";
      postMessage({ type: "result", text: text.trim() });
      return;
    }
  } catch (err) {
    postMessage({
      type: "status",
      stage: "error",
      message: err instanceof Error ? err.message : "Transcription failed",
    });
  }
};

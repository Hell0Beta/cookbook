// TTS Web Worker — development.md §14.1: local Kokoro-82M (q8) via kokoro-js,
// in a dedicated worker so model load + synthesis never block the UI thread.
// All model artifacts are vendored under /models/ and served from this origin
// — env.allowRemoteModels=false means the worker can NEVER fall back to the
// HuggingFace hub at runtime (§0 offline-first). Browser speechSynthesis on
// the main thread (lib/tts.ts) is the fallback while this loads / if it fails.
//
// Voice embeddings: kokoro-js fetches voices/*.bin from a HARDCODED HF hub
// URL, checking the "kokoro-voices" Cache API cache first. We pre-populate
// that cache from our own /models/ origin, so the remote fetch is never
// reached — a §0 requirement, not an optimization.
//
// Message protocol:
//   → { type: "load" }                          (lazy: first use loads the model)
//   ← { type: "status", stage: "loading" | "ready" | "error", message? }
//   → { type: "speak", text, voice? }
//   ← { type: "audio", samples: Float32Array, sample_rate: 24000 }
//   |  { type: "status", stage: "error", message }
import { env } from "@huggingface/transformers";
import { KokoroTTS } from "kokoro-js";

// Local-only models: /models/Kokoro-82M-v1.0-ONNX/... — vendored by
// `pnpm vendor:tts` (apps/web/scripts/vendor-tts-model.mjs). Must match the
// transformers instance kokoro-js resolves to (pnpm dedupes to one copy —
// see docs/agents/frontend.md decisions).
env.allowRemoteModels = false;
env.allowLocalModels = true;
if (typeof self.location !== "undefined") {
  env.localModelPath = new URL("/models/", self.location.origin).href;
}
// ORT wasm binaries also vendored locally (copied from the npm package's dist).
if (env.backends.onnx.wasm) {
  env.backends.onnx.wasm.wasmPaths = "/models/ort/";
}

const MODEL_ID = "onnx-community/Kokoro-82M-v1.0-ONNX";
// The voice loader's hardcoded remote base (kokoro-js dist) — cache keys MUST
// use exactly this URL for the interception to hit.
const VOICE_REMOTE_BASE = `https://huggingface.co/${MODEL_ID}/resolve/main/voices/`;
const VENDORED_VOICES = ["af_heart", "af_bella", "af_nicole", "am_michael", "am_puck"];

/** Pre-populate the "kokoro-voices" cache from our own origin so the voice
 *  loader's remote fetch never fires. Returns false when the Cache API or the
 *  local files are unavailable — the caller must treat Kokoro as unusable
 *  (falling back would mean an outbound call, which §0 forbids). */
async function primeVoiceCache(): Promise<boolean> {
  try {
    if (typeof caches === "undefined") return false;
    const cache = await caches.open("kokoro-voices");
    await Promise.all(
      VENDORED_VOICES.map(async (voice) => {
        const remote = `${VOICE_REMOTE_BASE}${voice}.bin`;
        if (await cache.match(remote)) return;
        const res = await fetch(`/models/Kokoro-82M-v1.0-ONNX/voices/${voice}.bin`);
        if (!res.ok) throw new Error(`voice ${voice}: HTTP ${res.status}`);
        await cache.put(remote, new Response(await res.arrayBuffer()));
      }),
    );
    return true;
  } catch {
    return false;
  }
}

let tts: KokoroTTS | null = null;
let loading: Promise<void> | null = null;

async function ensureLoaded() {
  if (tts) return;
  if (!loading) {
    loading = (async () => {
      postMessage({ type: "status", stage: "loading", message: "Loading voice model…" });
      try {
        // Voice cache first — without it, generate() would fetch from the hub.
        if (!(await primeVoiceCache())) {
          throw new Error("Voice files unavailable — check the vendored /models/ directory");
        }
        tts = await KokoroTTS.from_pretrained(MODEL_ID, {
          dtype: "q8", // quantized per development.md §14.1 (92 MB, q8 suffix naming)
          // device stays default: WASM — WebGPU needs fp32, a 325 MB download
        });
        postMessage({ type: "status", stage: "ready" });
      } catch (err) {
        loading = null; // allow retry
        tts = null;
        postMessage({
          type: "status",
          stage: "error",
          message: err instanceof Error ? err.message : "Could not load the voice model",
        });
        throw err;
      }
    })();
  }
  await loading;
}

self.onmessage = async (e: MessageEvent) => {
  const msg = e.data as { type: string; text?: string; voice?: keyof KokoroTTS["voices"] };
  try {
    if (msg.type === "load") {
      await ensureLoaded();
      return;
    }
    if (msg.type === "speak") {
      await ensureLoaded();
      const audio = await tts!.generate(msg.text!, { voice: msg.voice ?? "af_heart" });
      postMessage({
        type: "audio",
        samples: audio.audio, // Float32Array PCM @ 24 kHz (RawAudio)
        sample_rate: audio.sampling_rate,
      });
      return;
    }
  } catch (err) {
    postMessage({
      type: "status",
      stage: "error",
      message: err instanceof Error ? err.message : "Speech synthesis failed",
    });
  }
};

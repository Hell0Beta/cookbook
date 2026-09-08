"use client";

// On-device TTS — development.md §14.1: primary engine is the vendored
// Kokoro-82M model (tts-worker.ts, served from /models/ — natural speech,
// consistent across devices); browser SpeechSynthesis is the FALLBACK while
// the model loads or if it fails to load. Speech is a progressive
// enhancement: a failed speak() is silent, the transcript still carries the
// reply. All browser-API branches are try/catch (unsupported browsers /
// autoplay policies must not crash, same stance as the timer alert).

let enabled = true;
let worker: Worker | null = null;
let kokoroReady = false;
let kokoroFailed = false;
let currentSource: AudioBufferSourceNode | null = null;
let audioCtx: AudioContext | null = null;

/** Kick off model loading — call when the chat panel opens so the model is
 *  warm by the first reply. Safe to call repeatedly; never throws. */
export function preloadTts() {
  ensureWorker();
}

function ensureWorker(): Worker | null {
  if (worker || kokoroFailed) return worker;
  try {
    const w = new Worker(new URL("../components/chat/tts-worker.ts", import.meta.url));
    w.onmessage = (e: MessageEvent) => {
      const msg = e.data as { type: string; stage?: string; samples?: Float32Array; sample_rate?: number };
      if (msg.type === "status") {
        if (msg.stage === "ready") kokoroReady = true;
        else if (msg.stage === "error") {
          kokoroReady = false;
          kokoroFailed = true; // permanently fall back — the model is one-time setup
          w.terminate();
          worker = null;
        }
      } else if (msg.type === "audio" && msg.samples && msg.sample_rate) {
        playPcm(msg.samples, msg.sample_rate);
      }
    };
    w.onerror = () => {
      // Worker script/module failed to start (old browser, CSP) — fall back.
      kokoroFailed = true;
      worker = null;
    };
    w.postMessage({ type: "load" });
    worker = w;
    return w;
  } catch {
    kokoroFailed = true;
    return null;
  }
}

/** Play worker-produced PCM. Resampling to the context rate is the Web Audio
 *  API's job (AudioBufferSourceNode plays at the buffer's own rate). */
function playPcm(samples: Float32Array, sampleRate: number) {
  try {
    audioCtx ??= new AudioContext();
    if (audioCtx.state === "suspended") void audioCtx.resume(); // autoplay policy
    stopPlayback();
    const buffer = audioCtx.createBuffer(1, samples.length, sampleRate);
    buffer.copyToChannel(new Float32Array(samples), 0); // copy: worker transfer may detach
    const source = audioCtx.createBufferSource();
    source.buffer = buffer;
    source.connect(audioCtx.destination);
    source.onended = () => {
      if (currentSource === source) currentSource = null;
    };
    currentSource = source;
    source.start();
  } catch {
    // Playback failed — the transcript still carries the reply
  }
}

function stopPlayback() {
  try {
    if (currentSource) {
      currentSource.onended = null;
      currentSource.stop();
      currentSource = null;
    }
  } catch {
    // already stopped
  }
}

/** Spoken-output toggle (the panel header's speaker affordance). */
export function setSpeechEnabled(on: boolean) {
  enabled = on;
  if (!on) cancelSpeech();
}

export function speechEnabled(): boolean {
  return enabled;
}

/** Stop any in-flight speech — design.md §3.3.4 interruption v1 (tap mic). */
export function cancelSpeech() {
  stopPlayback();
  try {
    window.speechSynthesis?.cancel();
  } catch {
    // speechSynthesis unavailable — nothing to cancel
  }
}

export function isSpeaking(): boolean {
  if (currentSource) return true;
  try {
    return window.speechSynthesis?.speaking ?? false;
  } catch {
    return false;
  }
}

// ── Fallback: browser SpeechSynthesis ───────────────────────────────────────
// Kokoro needs a one-time model load (a few seconds); until it's ready — and
// permanently if it failed — replies are spoken by the platform's engine.

// Prefer the neural/online voices (marked "Natural"/"Neural"/"Google"; the
// platform default on Windows is often a legacy SAPI voice), else the first
// English voice, else whatever exists. Voice selection is a nice-to-have,
// never a failure.
const NATURAL = /natural|neural|google/i;
let cachedVoice: SpeechSynthesisVoice | null | undefined;

function defaultVoice(): SpeechSynthesisVoice | null {
  if (cachedVoice !== undefined) return cachedVoice;
  try {
    const voices = window.speechSynthesis?.getVoices() ?? [];
    cachedVoice =
      voices.find((v) => NATURAL.test(v.name) && v.lang.startsWith("en")) ??
      voices.find((v) => v.default && v.lang.startsWith("en")) ??
      voices.find((v) => v.lang.startsWith("en")) ??
      voices[0] ??
      null;
  } catch {
    cachedVoice = null;
  }
  return cachedVoice;
}

// getVoices() is async-populated in some browsers — prime the cache on the
// voiceschanged event so the first speak() isn't stuck with an empty list.
try {
  if (typeof window !== "undefined" && window.speechSynthesis) {
    window.speechSynthesis.addEventListener("voiceschanged", () => {
      cachedVoice = undefined;
      defaultVoice();
    });
  }
} catch {
  // events unsupported — the per-speak fallback still picks a voice
}

function speakFallback(text: string) {
  try {
    const synth = window.speechSynthesis;
    if (!synth) return;
    const utter = new SpeechSynthesisUtterance(text);
    const voice = defaultVoice();
    if (voice) utter.voice = voice;
    synth.speak(utter);
  } catch {
    // TTS unavailable — the transcript carries the reply
  }
}

/** Speak a reply aloud. Fire-and-forget; never throws. */
export function speak(text: string) {
  if (!enabled || !text.trim()) return;
  cancelSpeech(); // one reply at a time — a new reply interrupts the old
  const w = ensureWorker();
  if (kokoroReady && w) {
    w.postMessage({ type: "speak", text });
  } else {
    // Model still loading (or failed) — don't hold the reply hostage.
    speakFallback(text);
  }
}

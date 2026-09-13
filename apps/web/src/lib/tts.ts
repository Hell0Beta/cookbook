"use client";

// On-device TTS — development.md §14.1: the Kokoro-82M model (tts-worker.ts,
// served from /models/) is the ONLY engine (owner request 2026-09-12: always
// the Kokoro female voice, never the browser's platform speech — no voice
// overrides). While the model loads, utterances queue and flush when it's
// ready; if it fails to load, replies are silent and the transcript carries
// them. Speech is a progressive enhancement: a failed speak() never throws.
// All browser-API branches are try/catch (autoplay policies must not crash,
// same stance as the timer alert).

let enabled = true;
let worker: Worker | null = null;
let kokoroReady = false;
let kokoroFailed = false;
let currentSource: AudioBufferSourceNode | null = null;
let audioCtx: AudioContext | null = null;
// Completion callback for the current utterance (always-on mic sequencing —
// development.md §14: the mic re-arms when the reply finishes speaking).
// Fire-once: every path nulls it before calling.
let currentOnEnd: (() => void) | null = null;
// Utterance waiting for the model to finish loading — flushed on "ready".
// One slot: a newer reply replaces an older queued one (one reply at a
// time). The replaced reply's onEnd is dropped deliberately — the newer
// utterance's own onEnd resumes the mic, so the loop can't stall.
let pending: { text: string; onEnd?: () => void } | null = null;

function fireOnEnd() {
  const cb = currentOnEnd;
  currentOnEnd = null;
  cb?.();
}

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
        if (msg.stage === "ready") {
          kokoroReady = true;
          flushPending();
        } else if (msg.stage === "error") {
          kokoroReady = false;
          kokoroFailed = true; // permanently silent — the model is one-time setup
          w.terminate();
          worker = null;
          // Queued/waiting utterances will never be spoken — release their
          // waiters so the always-on mic isn't stalled forever.
          const queued = pending;
          pending = null;
          fireOnEnd();
          queued?.onEnd?.();
        }
      } else if (msg.type === "audio" && msg.samples && msg.sample_rate) {
        playPcm(msg.samples, msg.sample_rate);
      }
    };
    w.onerror = () => {
      // Worker script/module failed to start (old browser, CSP) — silent mode.
      kokoroFailed = true;
      worker = null;
      const queued = pending;
      pending = null;
      fireOnEnd();
      queued?.onEnd?.();
    };
    w.postMessage({ type: "load" });
    worker = w;
    return w;
  } catch {
    kokoroFailed = true;
    return null;
  }
}

function flushPending() {
  if (!pending || !worker) return;
  const { text, onEnd } = pending;
  pending = null;
  if (!enabled) {
    onEnd?.(); // muted while queued — drop it, release the waiter
    return;
  }
  currentOnEnd = onEnd ?? null;
  worker.postMessage({ type: "speak", text });
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
      fireOnEnd();
    };
    currentSource = source;
    source.start();
  } catch {
    // Playback failed — the transcript still carries the reply, but the
    // always-on mic must not wait forever.
    fireOnEnd();
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

/** Stop any in-flight speech — design.md §3.3.4 interruption v1 (tap mic). */
export function cancelSpeech() {
  stopPlayback();
  // An interrupted reply still counts as "done speaking" — the always-on mic
  // resumes instead of waiting on playback that will never end.
  fireOnEnd();
}

export function isSpeaking(): boolean {
  return currentSource !== null;
}

/** Speak a reply aloud — Kokoro only, never the browser's platform voice.
 *  Queues while the model loads; if it failed, the reply is silent.
 *  Fire-and-forget; never throws. `onEnd` fires once when playback finishes
 *  OR is interrupted/cancelled/dropped — the always-on mic mode uses it to
 *  know when to resume listening (development.md §14). */
export function speak(text: string, onEnd?: () => void) {
  if (!enabled || !text.trim()) {
    onEnd?.(); // muted/empty reply — still counts as spoken for sequencing
    return;
  }
  if (kokoroFailed) {
    onEnd?.(); // model unusable — the transcript carries the reply
    return;
  }
  cancelSpeech(); // one reply at a time — a new reply interrupts the old
  if (!kokoroReady) {
    pending = { text, onEnd }; // wait for Kokoro — no browser voice fallback
    ensureWorker();
    return;
  }
  const w = ensureWorker();
  if (!w) {
    onEnd?.();
    return;
  }
  currentOnEnd = onEnd ?? null;
  w.postMessage({ type: "speak", text });
}

"use client";

// On-device TTS — development.md §14.1: browser SpeechSynthesis, local and
// free, available even at LLM quota exhaustion. All browser-API branches are
// try/catch (unsupported browsers / autoplay policies must not crash, same
// stance as the timer alert). Speech is a progressive enhancement: a failed
// speak() is silent, the transcript still carries the reply.

let enabled = true;

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
  try {
    window.speechSynthesis?.cancel();
  } catch {
    // speechSynthesis unavailable — nothing to cancel
  }
}

export function isSpeaking(): boolean {
  try {
    return window.speechSynthesis?.speaking ?? false;
  } catch {
    return false;
  }
}

// Pick a stable default voice once per session: prefer an English voice the
// platform marks as "default"/natural, else the first English voice, else
// whatever exists. Voice selection is a nice-to-have, never a failure.
let cachedVoice: SpeechSynthesisVoice | null | undefined;

function defaultVoice(): SpeechSynthesisVoice | null {
  if (cachedVoice !== undefined) return cachedVoice;
  try {
    const voices = window.speechSynthesis?.getVoices() ?? [];
    cachedVoice =
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

/** Speak a reply aloud. Fire-and-forget; never throws. */
export function speak(text: string) {
  if (!enabled || !text.trim()) return;
  try {
    const synth = window.speechSynthesis;
    if (!synth) return;
    synth.cancel(); // one reply at a time — a new reply interrupts the old
    const utter = new SpeechSynthesisUtterance(text);
    const voice = defaultVoice();
    if (voice) utter.voice = voice;
    utter.rate = 1.05; // kitchen pace — slightly brisk
    synth.speak(utter);
  } catch {
    // TTS unavailable — the transcript carries the reply
  }
}

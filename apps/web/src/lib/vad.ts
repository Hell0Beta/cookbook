// Voice-activity segmentation for the always-on mic mode (development.md §14).
// Pure logic, unit-tested: the capture layer (use-stt.ts) samples the mic's
// RMS once per frame and feeds it to TurnSegmenter, which decides when a
// spoken turn has ended (trailing silence / max-turn cutoff) or was just
// noise (too little speech). Headless by design — no browser APIs here.

export interface VadOptions {
  /** RMS at/above this counts as speech. */
  speechThreshold: number;
  /** A turn needs at least this much accumulated speech to be real. */
  minSpeechMs: number;
  /** This much trailing silence after speech ends the turn. */
  endSilenceMs: number;
  /** Safety cutoff — the longest a single turn may run. */
  maxTurnMs: number;
  /** Cadence the caller samples RMS at. */
  frameMs: number;
}

export const VAD_DEFAULTS: VadOptions = {
  speechThreshold: 0.02,
  minSpeechMs: 300,
  endSilenceMs: 1200,
  maxTurnMs: 30_000,
  frameMs: 250,
};

export type TurnEvent =
  | "listening" // nothing conclusive yet — keep capturing
  | "turn-ended" // real speech followed by enough silence — stop & transcribe
  | "noise"; // blip shorter than minSpeechMs — discard, keep listening

/** Stateful segmenter: push one RMS sample per frame, get the turn's fate. */
export class TurnSegmenter {
  private opts: VadOptions;
  private speechMs = 0;
  private silenceMs = 0;
  private totalMs = 0;

  constructor(opts: Partial<VadOptions> = {}) {
    this.opts = { ...VAD_DEFAULTS, ...opts };
  }

  reset() {
    this.speechMs = 0;
    this.silenceMs = 0;
    this.totalMs = 0;
  }

  push(rms: number): TurnEvent {
    const o = this.opts;
    if (rms >= o.speechThreshold) {
      // The turn clock starts at the first speech, not at capture start —
      // leading silence (before anyone talks) must not eat the max-turn budget.
      if (this.speechMs === 0) this.totalMs = 0;
      this.speechMs += o.frameMs;
      this.silenceMs = 0;
      this.totalMs += o.frameMs;
    } else if (this.speechMs > 0) {
      this.silenceMs += o.frameMs;
      this.totalMs += o.frameMs;
    }
    if (this.speechMs === 0) return "listening"; // nobody has said anything yet

    if (this.silenceMs >= o.endSilenceMs || this.totalMs >= o.maxTurnMs) {
      const real = this.speechMs >= o.minSpeechMs;
      this.reset();
      return real ? "turn-ended" : "noise";
    }
    return "listening";
  }
}

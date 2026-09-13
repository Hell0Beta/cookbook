// Turn segmentation for the always-on mic mode (development.md §14). The
// browser-side sampling loop in use-stt.ts is covered by the manual
// verification in the feature's todo; the decision logic is pure, so it's
// tested headless here.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { TurnSegmenter, VAD_DEFAULTS } from "../src/lib/vad";

const SPEECH = VAD_DEFAULTS.speechThreshold * 5; // clearly above threshold
const QUIET = VAD_DEFAULTS.speechThreshold * 0.1; // clearly below

/** Feed `ms` of one level, returning the last event seen. */
function feed(seg: TurnSegmenter, level: number, ms: number) {
  const frames = Math.round(ms / VAD_DEFAULTS.frameMs);
  let event: ReturnType<TurnSegmenter["push"]> = "listening";
  for (let i = 0; i < frames; i++) event = seg.push(level);
  return event;
}

describe("TurnSegmenter (always-on capture)", () => {
  it("stays quiet through indefinite leading silence", () => {
    const seg = new TurnSegmenter();
    assert.equal(feed(seg, QUIET, 120_000), "listening");
  });

  it("ends a turn after trailing silence follows real speech", () => {
    const seg = new TurnSegmenter();
    assert.equal(feed(seg, SPEECH, 1000), "listening");
    assert.equal(feed(seg, QUIET, VAD_DEFAULTS.endSilenceMs), "turn-ended");
  });

  it("keeps listening while silence is under the hangover", () => {
    const seg = new TurnSegmenter();
    feed(seg, SPEECH, 1000);
    assert.equal(feed(seg, QUIET, VAD_DEFAULTS.endSilenceMs - VAD_DEFAULTS.frameMs), "listening");
    // speech resumes — the pause was just a breath
    assert.equal(feed(seg, SPEECH, 500), "listening");
  });

  it("discards a blip shorter than minSpeechMs as noise", () => {
    const seg = new TurnSegmenter();
    seg.push(SPEECH); // one 250ms frame — under the 300ms minimum
    assert.equal(feed(seg, QUIET, VAD_DEFAULTS.endSilenceMs), "noise");
  });

  it("cuts off a turn at the max-turn safety limit without silence", () => {
    const seg = new TurnSegmenter({ maxTurnMs: 5000 });
    assert.equal(feed(seg, SPEECH, 5000), "turn-ended");
  });

  it("resets between turns — a second turn segments independently", () => {
    const seg = new TurnSegmenter();
    feed(seg, SPEECH, 1000);
    feed(seg, QUIET, VAD_DEFAULTS.endSilenceMs);
    assert.equal(feed(seg, QUIET, 60_000), "listening"); // long gap: nothing yet
    assert.equal(feed(seg, SPEECH, 800), "listening");
    assert.equal(feed(seg, QUIET, VAD_DEFAULTS.endSilenceMs), "turn-ended");
  });

  it("leading silence does not consume the max-turn budget", () => {
    const seg = new TurnSegmenter({ maxTurnMs: 5000 });
    feed(seg, QUIET, 60_000); // an hour of kitchen quiet, then someone talks
    assert.equal(feed(seg, SPEECH, 4000), "listening");
    assert.equal(feed(seg, SPEECH, 1000), "turn-ended"); // hit the cap mid-speech
  });
});

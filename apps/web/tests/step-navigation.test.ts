// Step-navigation swipe classification — design.md §3.3.4 Steps tab. The
// pure part (resolveSwipe) is headless; the DOM helpers (currentReaderStep,
// revealStep) are covered by the manual verification in the feature's todo.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolveSwipe } from "../src/lib/step-navigation";

describe("resolveSwipe (chat panel steps tab)", () => {
  it("classifies a leftward swipe as next", () => {
    assert.equal(resolveSwipe(-120, 5, 320), "next");
  });

  it("classifies a rightward swipe as previous", () => {
    assert.equal(resolveSwipe(120, -5, 320), "previous");
  });

  it("meets the floor even on a narrow container", () => {
    // width*0.25 = 25px < 48px floor — the 48px floor wins.
    assert.equal(resolveSwipe(-50, 0, 100), "next");
    assert.equal(resolveSwipe(50, 0, 100), "previous");
  });

  it("scales with container width on wide screens", () => {
    // width*0.25 = 250px — a 100px swipe is under threshold.
    assert.equal(resolveSwipe(-100, 0, 1000), null);
    assert.equal(resolveSwipe(-250, 0, 1000), "next");
  });

  it("ignores short taps and drags", () => {
    assert.equal(resolveSwipe(-20, 0, 320), null);
    assert.equal(resolveSwipe(20, 10, 320), null);
    assert.equal(resolveSwipe(0, 0, 320), null);
  });

  it("ignores predominantly vertical motion (page scroll)", () => {
    // |dx| must exceed |dy| * 1.5.
    assert.equal(resolveSwipe(-100, 100, 320), null);
    assert.equal(resolveSwipe(-100, 80, 320), null);
    assert.equal(resolveSwipe(-100, 60, 320), "next");
  });

  it("still requires horizontal dominance on narrow containers", () => {
    // 50px horizontal vs 40px vertical: 50 > 60 is false → scroll, not swipe.
    assert.equal(resolveSwipe(50, 40, 100), null);
    assert.equal(resolveSwipe(50, 30, 100), "previous");
  });
});

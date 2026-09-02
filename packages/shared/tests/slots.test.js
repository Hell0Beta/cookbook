import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolveNextSlot } from "../dist/index.js";

describe("resolveNextSlot (development.md §7.2)", () => {
  it("resolves to today when the slot hasn't passed", () => {
    const now = new Date(2026, 7, 29, 7, 0); // 7am
    const r = resolveNextSlot("breakfast", now);
    assert.equal(r.label, "Today's Breakfast");
    assert.equal(r.date, "2026-08-29");
  });

  it("resolves to tomorrow when the slot has passed", () => {
    const now = new Date(2026, 7, 29, 20, 0); // 8pm, dinner was 18:30
    const r = resolveNextSlot("dinner", now);
    assert.equal(r.label, "Tomorrow's Dinner");
    assert.equal(r.date, "2026-08-30");
  });
});

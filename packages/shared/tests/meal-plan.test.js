import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  MealPlanEntryUpdate,
  QuickAddInput,
  resolveQuickAddTarget,
  weekRange,
} from "../dist/index.js";

describe("resolveQuickAddTarget (development.md §7.2)", () => {
  const now = new Date(2026, 7, 29, 7, 0); // 7am — no slot has passed

  it('mode "now" pins the entry for the Dashboard Upcoming cell', () => {
    const t = resolveQuickAddTarget("now", {}, now);
    assert.equal(t.is_upcoming_pin, true);
    assert.equal(t.date, "2026-08-29");
    assert.equal(t.meal_slot, null);
    assert.equal(t.scheduled_at, null);
    assert.match(t.label, /Right now/);
  });

  it('mode "slot" resolves to today when the slot has not passed', () => {
    const t = resolveQuickAddTarget("slot", { slot: "dinner" }, now);
    assert.equal(t.date, "2026-08-29");
    assert.equal(t.meal_slot, "dinner");
    assert.equal(t.is_upcoming_pin, false);
    assert.equal(t.label, "Today's Dinner");
  });

  it('mode "slot" resolves to tomorrow when the slot has passed', () => {
    const late = new Date(2026, 7, 29, 20, 0); // 8pm, dinner was 18:30
    const t = resolveQuickAddTarget("slot", { slot: "dinner" }, late);
    assert.equal(t.date, "2026-08-30");
    assert.equal(t.label, "Tomorrow's Dinner");
  });

  it('mode "slot" honors an explicit date over next-occurrence', () => {
    const t = resolveQuickAddTarget("slot", { slot: "lunch", date: "2026-09-02" }, now);
    assert.equal(t.date, "2026-09-02");
    assert.equal(t.meal_slot, "lunch");
    assert.equal(t.label, "2026-09-02's Lunch");
  });

  it('mode "custom_minutes" schedules a custom time with no slot', () => {
    const t = resolveQuickAddTarget("custom_minutes", { minutes: 30 }, now);
    assert.equal(t.meal_slot, null);
    assert.equal(t.is_upcoming_pin, false);
    assert.equal(t.date, "2026-08-29"); // 7:30 same day
    assert.equal(t.scheduled_at, new Date(2026, 7, 29, 7, 30).toISOString());
    assert.equal(t.label, "in 30 min");
  });

  it('mode "custom_minutes" rolls to the next day across midnight', () => {
    const late = new Date(2026, 7, 29, 23, 50);
    const t = resolveQuickAddTarget("custom_minutes", { minutes: 20 }, late);
    assert.equal(t.date, "2026-08-30");
    assert.equal(t.scheduled_at, new Date(2026, 7, 30, 0, 10).toISOString());
  });
});

describe("QuickAddInput validation", () => {
  it("accepts each mode's valid body", () => {
    assert.equal(QuickAddInput.safeParse({ recipe_id: "r1", mode: "now" }).success, true);
    assert.equal(
      QuickAddInput.safeParse({ recipe_id: "r1", mode: "slot", slot: "dinner" }).success,
      true,
    );
    assert.equal(
      QuickAddInput.safeParse({ recipe_id: "r1", mode: "custom_minutes", minutes: 45 }).success,
      true,
    );
  });

  it("rejects slot mode without a slot and custom_minutes without minutes", () => {
    assert.equal(QuickAddInput.safeParse({ recipe_id: "r1", mode: "slot" }).success, false);
    assert.equal(
      QuickAddInput.safeParse({ recipe_id: "r1", mode: "custom_minutes" }).success,
      false,
    );
  });

  it("rejects malformed dates and non-positive minutes", () => {
    assert.equal(
      QuickAddInput.safeParse({ recipe_id: "r1", mode: "now", date: "20260829" }).success,
      false,
    );
    assert.equal(
      QuickAddInput.safeParse({ recipe_id: "r1", mode: "custom_minutes", minutes: 0 }).success,
      false,
    );
  });
});

describe("weekRange (GET /meal-plans?week=, development.md §11)", () => {
  it("resolves Monday..Sunday of the containing week", () => {
    assert.deepEqual(weekRange("2026-08-26"), { from: "2026-08-24", to: "2026-08-30" });
  });

  it("keeps a Monday input as the range start", () => {
    assert.deepEqual(weekRange("2026-08-24"), { from: "2026-08-24", to: "2026-08-30" });
  });

  it("handles year boundaries", () => {
    assert.deepEqual(weekRange("2027-01-01"), { from: "2026-12-28", to: "2027-01-03" });
  });
});

describe("MealPlanEntryUpdate validation (PATCH /meal-plans/:id)", () => {
  it("accepts partial updates and a null meal_slot (unschedule)", () => {
    assert.equal(MealPlanEntryUpdate.safeParse({ date: "2026-09-01" }).success, true);
    assert.equal(MealPlanEntryUpdate.safeParse({ meal_slot: null }).success, true);
    assert.equal(MealPlanEntryUpdate.safeParse({ servings_planned: 4 }).success, true);
  });

  it("rejects empty bodies, invalid slots, and out-of-range servings", () => {
    assert.equal(MealPlanEntryUpdate.safeParse({}).success, false);
    assert.equal(MealPlanEntryUpdate.safeParse({ meal_slot: "brunch" }).success, false);
    assert.equal(MealPlanEntryUpdate.safeParse({ servings_planned: 0 }).success, false);
  });
});

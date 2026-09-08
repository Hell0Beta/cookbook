import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { routeCookingIntent, buildCookingChatMessages, CHAT_HISTORY_TURNS } from "../dist/index.js";

// A small but realistic context: 3 steps, flour + garlic + salt-to-taste.
function baseCtx() {
  return {
    recipe_title: "Simple Pasta",
    base_servings: 4,
    servings: 4,
    steps: [
      { id: "s1", step_number: 1, instruction_text: "Boil the pasta", duration_minutes: 10 },
      { id: "s2", step_number: 2, instruction_text: "Simmer the garlic in oil", duration_minutes: 12 },
      { id: "s3", step_number: 3, instruction_text: "Toss and serve", duration_minutes: null },
    ],
    ingredients: [
      { raw_text: "2 cups flour", quantity: 2, unit: "cup" },
      { raw_text: "3 cloves garlic, minced", quantity: 3, unit: "piece" },
      { raw_text: "salt to taste", quantity: null, unit: "to_taste" },
    ],
    current_step_number: 2,
    active_timers: [],
  };
}

describe("routeCookingIntent (development.md §14.2)", () => {
  // ── step control ──────────────────────────────────────────────────────────

  it("'next' advances to the following step and reads it aloud", () => {
    const r = routeCookingIntent("next", baseCtx());
    assert.equal(r.intent, "step_control");
    assert.equal(r.action, "next");
    assert.equal(r.step_number, 3);
    assert.match(r.reply, /Step 3: Toss and serve/);
  });

  it("'next' on the last step says so instead of scrolling", () => {
    const ctx = { ...baseCtx(), current_step_number: 3 };
    const r = routeCookingIntent("next", ctx);
    assert.equal(r.intent, "step_control");
    assert.equal(r.step_number, null);
    assert.match(r.reply, /last step/);
  });

  it("'what's next' (apostrophe) matches the bare command", () => {
    const r = routeCookingIntent("what's next?", baseCtx());
    assert.equal(r.intent, "step_control");
    assert.equal(r.action, "next");
  });

  it("'repeat that' re-reads the current step", () => {
    const r = routeCookingIntent("repeat that", baseCtx());
    assert.equal(r.intent, "step_control");
    assert.equal(r.action, "repeat");
    assert.match(r.reply, /Step 2: Simmer the garlic/);
  });

  it("'go back' returns the previous step", () => {
    const r = routeCookingIntent("go back", baseCtx());
    assert.equal(r.intent, "step_control");
    assert.equal(r.action, "previous");
    assert.equal(r.step_number, 1);
  });

  it("'step 3' jumps to an explicit step", () => {
    const r = routeCookingIntent("step 3", baseCtx());
    assert.equal(r.intent, "step_control");
    assert.equal(r.action, "goto");
    assert.equal(r.step_number, 3);
  });

  it("'step 99' reports the step count instead of jumping", () => {
    const r = routeCookingIntent("go to step 99", baseCtx());
    assert.equal(r.intent, "step_control");
    assert.equal(r.step_number, null);
    assert.match(r.reply, /only 3 steps/);
  });

  it("a long 'next'-containing question falls through to the LLM (fail-soft)", () => {
    const r = routeCookingIntent("what should I make next time I have guests over?", baseCtx());
    assert.equal(r.intent, "llm");
  });

  // ── timer control ─────────────────────────────────────────────────────────

  it("'set a timer for 5 minutes' starts a 300s timer", () => {
    const r = routeCookingIntent("set a timer for 5 minutes", baseCtx());
    assert.equal(r.intent, "timer");
    assert.equal(r.action, "start");
    assert.equal(r.duration_seconds, 300);
  });

  it("'timer for 90 seconds' parses seconds; '1 hour' parses hours", () => {
    assert.equal(routeCookingIntent("timer for 90 seconds", baseCtx()).duration_seconds, 90);
    assert.equal(routeCookingIntent("set a timer for 1 hour", baseCtx()).duration_seconds, 3600);
  });

  it("'start the timer' uses the current step's duration when it has one", () => {
    const r = routeCookingIntent("start the timer", baseCtx()); // step 2 = 12 min
    assert.equal(r.intent, "timer");
    assert.equal(r.action, "start");
    assert.equal(r.duration_seconds, 720);
  });

  it("'start the timer' on an untimed step falls through to the LLM", () => {
    const ctx = { ...baseCtx(), current_step_number: 3 };
    assert.equal(routeCookingIntent("start the timer", ctx).intent, "llm");
  });

  it("time-left queries report running timers", () => {
    const ctx = {
      ...baseCtx(),
      active_timers: [{ step_id: "s2", label: "Simmer the garlic in oil", remaining_seconds: 300 }],
    };
    const r = routeCookingIntent("how much time is left?", ctx);
    assert.equal(r.intent, "timer");
    assert.equal(r.action, "status");
    assert.match(r.reply, /5 minutes on Simmer/);
  });

  it("'how long do I cook the pasta' is a general question, not timer status", () => {
    assert.equal(routeCookingIntent("how long do I cook the pasta?", baseCtx()).intent, "llm");
  });

  // ── ingredient lookup ─────────────────────────────────────────────────────

  it("'how much flour' answers with the scaled quantity", () => {
    const r = routeCookingIntent("how much flour do I need?", baseCtx());
    assert.equal(r.intent, "ingredient_lookup");
    assert.match(r.reply, /flour/);
    assert.match(r.reply, /4 servings/);
  });

  it("'how many cloves of garlic' scales when the servings changed", () => {
    const ctx = { ...baseCtx(), servings: 8 };
    const r = routeCookingIntent("how many cloves of garlic?", ctx);
    assert.equal(r.intent, "ingredient_lookup");
    assert.match(r.reply, /6/); // 3 cloves × 8/4
    assert.match(r.reply, /8 servings/);
  });

  it("a to-taste ingredient says so", () => {
    const r = routeCookingIntent("how much salt?", baseCtx());
    assert.equal(r.intent, "ingredient_lookup");
    assert.match(r.reply, /to taste/);
  });

  it("an unknown ingredient falls through to the LLM (fail-soft)", () => {
    assert.equal(routeCookingIntent("how much saffron?", baseCtx()).intent, "llm");
  });

  // ── everything else ───────────────────────────────────────────────────────

  it("substitutions and general cooking questions are LLM turns", () => {
    assert.equal(routeCookingIntent("can I use butter instead of oil?", baseCtx()).intent, "llm");
    assert.equal(routeCookingIntent("what temperature should the oven be?", baseCtx()).intent, "llm");
  });

  it("empty input falls through", () => {
    assert.equal(routeCookingIntent("   ", baseCtx()).intent, "llm");
  });
});

describe("buildCookingChatMessages (development.md §14.3)", () => {
  const context = {
    title: "Simple Pasta",
    base_servings: 4,
    servings: 4,
    ingredients: ["2 cups flour → 2 cup (for 4 servings)"],
    steps: [
      { step_number: 1, instruction_text: "Boil the pasta", duration_minutes: 10 },
      { step_number: 2, instruction_text: "Simmer the garlic in oil", duration_minutes: 12 },
      { step_number: 3, instruction_text: "Toss and serve", duration_minutes: null },
    ],
    current_step_number: 2,
    active_timers: [{ step_id: "s2", label: "Simmer", remaining_seconds: 300 }],
  };

  it("builds system + history + user, marks the current step, includes timers", () => {
    const history = [{ role: "user", content: "hi" }, { role: "assistant", content: "hello" }];
    const msgs = buildCookingChatMessages(context, history, "what next?");
    assert.equal(msgs[0].role, "system");
    assert.equal(msgs.at(-1).role, "user");
    assert.equal(msgs.at(-1).content, "what next?");
    assert.equal(msgs.length, 4);
    // Current step ± neighbors only (prompt budget)…
    assert.match(msgs[0].content, /Step 1 \[10 min\]: Boil/);
    assert.match(msgs[0].content, /Step 2 \[12 min\]: Simmer/);
    assert.match(msgs[0].content, /Step 3: Toss/);
    // …persona + recipe + current marker + timer summary
    assert.match(msgs[0].content, /Simple Pasta/);
    assert.match(msgs[0].content, /currently on step 2/);
    assert.match(msgs[0].content, /Simmer.*5m 0s left/);
  });

  it("trims history to the budgeted turn count", () => {
    const history = Array.from({ length: 20 }, (_, i) => ({
      role: i % 2 === 0 ? "user" : "assistant",
      content: `msg ${i}`,
    }));
    const msgs = buildCookingChatMessages(context, history, "hello");
    assert.equal(msgs.length, CHAT_HISTORY_TURNS + 2); // system + user + 8 history
    assert.match(msgs[1].content, /msg 12/); // oldest kept = last 8
  });
});

"use client";

// Voice Assistant Panel — design.md §3.3.4, development.md §14. Collapsed =
// floating MIC button docked bottom-right (sibling elevation to the timer
// pill, which docks bottom-left). Expanded = bottom sheet over the reader:
// session header (recipe, current step, timer chips), multiturn transcript,
// push-to-talk mic + always-available text input. Transcribed speech lands in
// the editable input for correction before sending; replies are spoken via
// on-device TTS. Rule-based intents resolve client-side (§14.2) — only free
// questions cost an LLM turn.
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  ChefHat,
  ChevronDown,
  LoaderCircle,
  Mic,
  RotateCcw,
  Send,
  Sparkles,
  Square,
  Volume2,
  VolumeX,
  Zap,
} from "lucide-react";
import {
  CHAT_QUOTA_NOTICE,
  routeCookingIntent,
  type ChatMessage,
  type ChatSessionResponse,
  type ChatTurnContext,
  type CookingIntent,
  type IngredientBlock,
  type RouterContext,
  type StepBlock,
} from "@cookbook/shared";
import { api, ApiRequestError } from "@/lib/api";
import { cancelSpeech, preloadTts, setSpeechEnabled, speak } from "@/lib/tts";
import { setActiveChatSession } from "@/components/chat/chat-session-registry";
import { useStt } from "@/components/chat/use-stt";
import { formatClock, useTimerStore } from "@/components/timer/timer-store";
import { flagLlmQuota, useLlmQuotaExceeded } from "@/components/llm-quota";
import { cn } from "@/lib/utils";

// Local message shape: server rows + an optimistic pending user bubble.
interface PendingMessage {
  pending: true;
  id: string;
  role: "user";
  content: string;
}
type TranscriptMessage = ChatMessage | PendingMessage;

let pendingCounter = 0;

export function ChatPanel({
  recipeId,
  recipeTitle,
  steps,
  ingredients,
  baseServings,
  servings,
  occasionKey,
}: {
  recipeId: string;
  recipeTitle: string;
  steps: StepBlock[];
  ingredients: IngredientBlock[];
  baseServings: number;
  servings: number;
  occasionKey: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [session, setSession] = useState<ChatSessionResponse | null>(null);
  const [messages, setMessages] = useState<TranscriptMessage[]>([]);
  const [creating, setCreating] = useState(false);
  const [thinking, setThinking] = useState(false);
  const [speechOn, setSpeechOn] = useState(true);
  const [input, setInput] = useState("");
  const quotaExceeded = useLlmQuotaExceeded();
  const transcriptRef = useRef<HTMLDivElement>(null);

  // Keep the newest turn visible as the thread grows.
  useEffect(() => {
    transcriptRef.current?.scrollTo({ top: transcriptRef.current.scrollHeight });
  }, [messages, thinking]);

  // Select the stable store array, then filter in useMemo — a .filter inside
  // the selector returns a fresh reference per snapshot and React flags that
  // as an uncached getSnapshot (infinite re-render).
  const allTimers = useTimerStore((s) => s.timers);
  const timers = useMemo(
    () => allTimers.filter((t) => t.recipeId === recipeId && !t.completed),
    [allTimers, recipeId],
  );

  // ── session lifecycle ──────────────────────────────────────────────────────

  const openSession = async (fresh = false) => {
    setCreating(true);
    try {
      const res = await api.createChatSession({
        recipe_id: recipeId,
        occasion_key: occasionKey,
        fresh,
      });
      setSession(res);
      setMessages(res.messages);
    } catch (err) {
      toast.error(
        err instanceof ApiRequestError && err.status === 401
          ? "Sign in to use the cooking assistant"
          : "Couldn't open the cooking assistant — try again",
      );
    } finally {
      setCreating(false);
    }
  };

  // Opening the panel resolves today's session (resume-today-or-create, §14.4)
  // and warms the TTS model so the first spoken reply uses Kokoro, not the
  // fallback (development.md §14.1).
  useEffect(() => {
    if (open && !session && !creating) void openSession();
    if (open) preloadTts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, session]);

  // Register the session for the app-root proactive timer-speech watcher
  // (proactive-timer-speech.tsx) — spoken timer alerts keep working after the
  // reader/panel unmount (design.md §3.3.4).
  useEffect(() => {
    if (session) {
      setActiveChatSession({
        id: session.session.id,
        recipeId: session.session.recipe_id,
        recipeTitle,
      });
    }
  }, [session, recipeTitle]);

  // Closing interrupts in-flight speech (the sheet is the TTS surface).
  const collapse = () => {
    setOpen(false);
    cancelSpeech();
  };

  // ── cooking context (development.md §14.3) ────────────────────────────────
  // Step position and timer state are client-side, so the client reports them.
  // "Current" step uses the reader's scroll-position convention (the same
  // midpoint rule as shake-to-advance).

  const currentStepId = (): string | null => {
    const mid = window.innerHeight / 2;
    let current: StepBlock | null = null;
    for (const s of steps) {
      const el = document.getElementById(`step-${s.id}`);
      if (el && el.getBoundingClientRect().top <= mid) current = s;
    }
    return current?.id ?? null;
  };

  const buildContext = (): ChatTurnContext => ({
    current_step_id: currentStepId(),
    active_timers: timers.map((t) => ({
      step_id: t.stepId,
      label: t.snippet || `Step ${t.stepNumber}`,
      remaining_seconds: t.remainingSeconds,
    })),
    servings,
  });

  // ── sending ────────────────────────────────────────────────────────────────
  // development.md §14.2: the router runs client-side BEFORE anything is sent.
  // Recipe-bound intents resolve locally (zero quota, instant), execute against
  // the reader/timer stores, and persist via the fire-and-forget log route;
  // only `llm` intents reach POST /messages.

  const stepsForRouter = (): RouterContext => ({
    recipe_title: recipeTitle,
    base_servings: baseServings,
    servings,
    steps: steps.map((s) => ({
      id: s.id,
      step_number: s.step_number,
      instruction_text: s.instruction_text,
      duration_minutes: s.duration_minutes,
    })),
    ingredients: ingredients.map((i) => ({
      raw_text: i.raw_text,
      quantity: i.quantity,
      unit: i.unit,
    })),
    current_step_number: currentStepNumber || null,
    active_timers: timers.map((t) => ({
      step_id: t.stepId,
      label: t.snippet || `Step ${t.stepNumber}`,
      remaining_seconds: t.remainingSeconds,
    })),
  });

  // Execute a router action against the reader + timer stores (§14.2: timer
  // state is client-side — there is no server timer to command).
  const executeAction = (r: CookingIntent) => {
    if (r.intent === "step_control" && r.step_number !== null) {
      const target = steps.find((s) => s.step_number === r.step_number);
      if (target) {
        document
          .getElementById(`step-${target.id}`)
          ?.scrollIntoView({ behavior: "smooth", block: "center" });
        // Auto-start the step's timer, shake-to-advance semantics (§3.3.3).
        if (target.duration_minutes && target.duration_minutes > 0 && !useTimerStore.getState().get(target.id)) {
          useTimerStore.getState().start({
            stepId: target.id,
            recipeId,
            recipeTitle,
            stepNumber: target.step_number,
            snippet: target.instruction_text.slice(0, 60),
            totalSeconds: target.duration_minutes * 60,
          });
        }
      }
    } else if (r.intent === "timer" && r.action === "start" && r.duration_seconds) {
      // A free-floating voice timer: synthetic step key — docks in the
      // floating pill like any timer, not tied to a step block.
      useTimerStore.getState().start({
        stepId: `voice-${Date.now()}`,
        recipeId,
        recipeTitle,
        stepNumber: currentStepNumber || 0,
        snippet: "Voice timer",
        totalSeconds: r.duration_seconds,
      });
    }
  };

  const send = async (raw: string) => {
    const content = raw.trim();
    if (!content || thinking) return;
    setInput("");

    // 1. Rule-based intents resolve locally (instant, quota-free).
    const routed = routeCookingIntent(content, stepsForRouter());
    if (routed.intent !== "llm") {
      executeAction(routed);
      const now = new Date().toISOString();
      setMessages((m) => [
        ...m,
        session
          ? {
              id: `local-user-${Date.now()}`,
              cooking_session_id: session.session.id,
              role: "user" as const,
              content,
              intent: routed.intent as ChatMessage["intent"],
              created_at: now,
            }
          : { pending: true, id: `local-${Date.now()}`, role: "user" as const, content },
        {
          id: `local-reply-${Date.now()}`,
          cooking_session_id: session?.session.id ?? "",
          role: "assistant" as const,
          content: routed.reply,
          intent: routed.intent as ChatMessage["intent"],
          created_at: now,
        },
      ]);
      speak(routed.reply);
      if (session) {
        // Fire-and-forget persistence of both sides of the turn (§14.2).
        void api
          .logChatTurn(session.session.id, { role: "user", content, intent: routed.intent })
          .catch(() => undefined);
        void api
          .logChatTurn(session.session.id, { role: "assistant", content: routed.reply, intent: routed.intent })
          .catch(() => undefined);
      }
      return;
    }

    // 2. LLM turn.
    if (!session) {
      setInput(content); // session still opening — don't eat the text
      return;
    }
    const optimistic: PendingMessage = {
      pending: true,
      id: `pending-${Date.now()}-${pendingCounter++}`,
      role: "user",
      content,
    };
    setMessages((m) => [...m, optimistic]);
    setThinking(true);
    try {
      const res = await api.sendChatMessage(session.session.id, {
        content,
        recipe_id: recipeId,
        context: buildContext(),
      });
      // Swap the optimistic bubble for the persisted pair.
      setMessages((m) => [
        ...m.filter((x) => x.id !== optimistic.id),
        res.user_message,
        res.reply,
      ]);
      speak(res.reply.content);
    } catch (err) {
      if (err instanceof ApiRequestError && err.code === "llm_quota_exceeded") {
        // The server persisted the user message + the spoken fallback notice
        // (§14.3) — mirror it locally so what's shown is what was said.
        flagLlmQuota();
        setMessages((m) => [
          ...m.filter((x) => x.id !== optimistic.id),
          {
            id: `quota-${optimistic.id}`,
            cooking_session_id: session.session.id,
            role: "assistant",
            content: CHAT_QUOTA_NOTICE,
            intent: "llm_fallback",
            created_at: new Date().toISOString(),
          },
        ]);
        speak(CHAT_QUOTA_NOTICE);
      } else {
        // Keep the user's text (retry by resending), just surface the failure.
        toast.error("The assistant couldn't answer — check your connection and retry");
        setMessages((m) => m.filter((x) => x.id !== optimistic.id));
        setInput(content);
      }
    } finally {
      setThinking(false);
    }
  };

  const currentStepNumber = steps.findIndex((s) => s.id === currentStepId()) + 1;

  // ── push-to-talk STT (development.md §14.1, design.md §3.3.4) ─────────────
  // The transcript lands in the editable input — the pre-send affordance that
  // lets a mis-transcription be corrected before sending.
  const inputRef = useRef<HTMLInputElement>(null);
  const stt = useStt((text) => {
    setInput((prev) => (prev ? `${prev} ${text}` : text));
    inputRef.current?.focus();
  });

  useEffect(() => {
    if (stt.error) toast.error(stt.error);
  }, [stt.error]);

  const toggleMic = () => {
    // Interruption v1 (design.md §3.3.4): tapping the mic cancels in-flight
    // speech, then arms.
    cancelSpeech();
    if (stt.status === "listening") stt.stop();
    else if (stt.status === "idle" || stt.status === "error") void stt.arm();
  };

  const micBusy = stt.status === "loading-model" || stt.status === "transcribing";
  const listening = stt.status === "listening";

  return (
    <>
      {/* Collapsed — the floating MIC button (design.md §3.3.4), bottom-right,
          sibling of the timer pill (bottom-left, same elevation). One tap
          opens the panel and arms push-to-talk: talk, tap the mic again (or
          the send button) to finish. */}
      {!open && (
        <button
          type="button"
          aria-label="Open cooking assistant and start talking"
          onClick={() => {
            setOpen(true);
            cancelSpeech();
            if (stt.status === "idle") void stt.arm();
          }}
          className={cn(
            "fixed bottom-24 right-4 z-30 flex size-12 items-center justify-center rounded-full border transition-colors",
            listening
              ? "border-(--color-accent) bg-(--color-accent) text-white"
              : "border-(--color-border) bg-(--color-surface) text-(--color-accent) hover:bg-(--color-surface-container)",
          )}
        >
          <Mic className="size-5" strokeWidth={1.5} />
        </button>
      )}

      {/* Expanded — bottom sheet over the reader (design.md §3.3.4). */}
      {open && (
        <section
          aria-label="Cooking assistant"
          className="fixed inset-x-(--spacing-margin) bottom-24 z-40 mx-auto flex max-w-2xl flex-col rounded-(--radius-bento) border border-(--color-border) bg-(--color-surface)"
          style={{ height: "55vh" }}
        >
          {/* Session header */}
          <header className="flex items-center gap-2 border-b border-(--color-border) px-(--spacing-cell) py-2.5">
            <ChefHat className="size-4 shrink-0 text-(--color-accent)" strokeWidth={1.5} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-[length:var(--text-body)] font-medium">{recipeTitle}</p>
              <p className="truncate font-mono text-mono text-(--color-text-secondary)">
                {steps.length > 0
                  ? currentStepNumber > 0
                    ? `step ${currentStepNumber} of ${steps.length}`
                    : `step 1 of ${steps.length}`
                  : "no steps"}
                {timers.length > 0 && ` · ${timers.map((t) => formatClock(t.remainingSeconds)).join(" · ")}`}
              </p>
            </div>
            {quotaExceeded && (
              <span className="shrink-0 rounded-(--radius-sm) border border-(--color-error)/40 px-1.5 py-0.5 text-[length:var(--text-meta)] text-(--color-error)">
                AI off
              </span>
            )}
            <button
              type="button"
              aria-label={speechOn ? "Mute spoken replies" : "Unmute spoken replies"}
              onClick={() => {
                const next = !speechOn;
                setSpeechOn(next);
                setSpeechEnabled(next);
              }}
              className="shrink-0 text-(--color-text-secondary) hover:text-(--color-text-primary)"
            >
              {speechOn ? <Volume2 className="size-4" strokeWidth={1.5} /> : <VolumeX className="size-4" strokeWidth={1.5} />}
            </button>
            <button
              type="button"
              aria-label="Collapse cooking assistant"
              onClick={collapse}
              className="shrink-0 text-(--color-text-secondary) hover:text-(--color-text-primary)"
            >
              <ChevronDown className="size-4" strokeWidth={1.5} />
            </button>
          </header>

          {/* Transcript */}
          <div ref={transcriptRef} className="min-h-0 flex-1 overflow-y-auto px-(--spacing-cell) py-3">
            {creating && <p className="text-(--color-text-secondary)">Opening…</p>}
            {!creating && session && messages.length === 0 && (
              <p className="text-(--color-text-secondary)">
                Ask anything about this recipe — or general cooking questions.
              </p>
            )}
            {session && session.resumed && messages.length > 0 && (
              <div className="mb-3 flex items-center justify-between gap-2 rounded-(--radius-sm) border border-(--color-border) bg-(--color-page) px-2.5 py-1.5">
                <span className="text-[length:var(--text-meta)] text-(--color-text-secondary)">
                  Continued from earlier today
                </span>
                <button
                  type="button"
                  onClick={() => void openSession(true)}
                  className="flex shrink-0 items-center gap-1 text-[length:var(--text-meta)] font-medium text-(--color-text-secondary) hover:text-(--color-text-primary)"
                >
                  <RotateCcw className="size-3" strokeWidth={1.5} />
                  Start fresh
                </button>
              </div>
            )}
            <ol className="flex flex-col gap-2.5">
              {messages.map((m) => (
                <li
                  key={m.id}
                  className={cn(
                    "max-w-[85%] rounded-(--radius-sm) border px-3 py-2 text-[length:var(--text-body)]",
                    m.role === "user"
                      ? "self-end border-(--color-accent)/40 bg-(--color-accent)/10"
                      : "self-start border-(--color-border) bg-(--color-page)",
                  )}
                >
                  {m.role === "assistant" && "intent" in m && m.intent && m.intent !== "llm" && m.intent !== "llm_fallback" && (
                    <Zap className="mb-1 size-3 text-(--color-turmeric)" strokeWidth={1.5} aria-label="Instant answer — no AI used" />
                  )}
                  {m.role === "assistant" && "intent" in m && m.intent === "llm" && (
                    <Sparkles className="mb-1 size-3 text-(--color-accent)" strokeWidth={1.5} aria-label="AI answer" />
                  )}
                  <p className="whitespace-pre-wrap">{m.content}</p>
                </li>
              ))}
            </ol>
          </div>

          {/* Status line (design.md §3.3.4: listening / transcribing / thinking)
              + text input — voice is primary, typing the always-available equal
              path. Transcribed speech lands in the input for correction before
              sending. */}
          <footer className="border-t border-(--color-border) px-(--spacing-cell) py-2.5">
            <div className="flex h-4 items-center">
              {listening && (
                <span className="flex items-center gap-1.5 text-[length:var(--text-meta)] text-(--color-accent)">
                  <span className="flex items-end gap-0.5" aria-hidden>
                    <span className="w-0.5 animate-pulse bg-(--color-accent)" style={{ height: "6px" }} />
                    <span className="w-0.5 animate-pulse bg-(--color-accent)" style={{ height: "10px", animationDelay: "0.15s" }} />
                    <span className="w-0.5 animate-pulse bg-(--color-accent)" style={{ height: "8px", animationDelay: "0.3s" }} />
                  </span>
                  Listening — tap the mic to stop
                </span>
              )}
              {stt.status === "loading-model" && (
                <span className="flex items-center gap-1.5 text-[length:var(--text-meta)] text-(--color-text-secondary)">
                  <LoaderCircle className="size-3 animate-spin" strokeWidth={1.5} />
                  Loading the speech model (first use only)…
                </span>
              )}
              {stt.status === "transcribing" && (
                <span className="flex items-center gap-1.5 text-[length:var(--text-meta)] text-(--color-text-secondary)">
                  <LoaderCircle className="size-3 animate-spin" strokeWidth={1.5} />
                  Transcribing…
                </span>
              )}
              {thinking && (
                <span className="flex items-center gap-1.5 text-[length:var(--text-meta)] text-(--color-text-secondary)">
                  <LoaderCircle className="size-3 animate-spin" strokeWidth={1.5} />
                  Thinking… the free AI tier can take a moment
                </span>
              )}
            </div>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void send(input);
              }}
              className="flex items-center gap-2"
            >
              {/* Push-to-talk mic (§3.3.4): tap to arm, tap to stop; cancels
                  in-flight speech first (interruption v1). */}
              <button
                type="button"
                aria-label={listening ? "Stop recording" : "Start talking"}
                onClick={toggleMic}
                disabled={micBusy}
                className={cn(
                  "flex size-9 shrink-0 items-center justify-center rounded-(--radius-sm) border disabled:opacity-50",
                  listening
                    ? "border-(--color-accent) bg-(--color-accent) text-white"
                    : "border-(--color-border) bg-(--color-page) text-(--color-text-primary) hover:border-(--color-accent)",
                )}
              >
                {listening ? (
                  <Square className="size-3.5" strokeWidth={1.5} />
                ) : (
                  <Mic className="size-4" strokeWidth={1.5} />
                )}
              </button>
              <input
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder={listening ? "Listening…" : "Ask about this recipe…"}
                disabled={!session || thinking}
                className="min-w-0 flex-1 rounded-(--radius-sm) border border-(--color-border) bg-(--color-page) px-3 py-2 text-[length:var(--text-body)] outline-none placeholder:text-(--color-text-secondary) focus:border-(--color-accent) disabled:opacity-50"
              />
              <button
                type="submit"
                aria-label="Send"
                disabled={!input.trim() || !session || thinking}
                className="flex size-9 shrink-0 items-center justify-center rounded-(--radius-sm) bg-(--color-accent) text-white disabled:opacity-40"
              >
                <Send className="size-4" strokeWidth={1.5} />
              </button>
            </form>
          </footer>
        </section>
      )}
    </>
  );
}

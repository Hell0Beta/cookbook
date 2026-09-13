"use client";

// Voice Assistant Panel — design.md §3.3.4, development.md §14. Collapsed =
// the assistant BAR docked bottom-right (sibling elevation to the timer
// pill, which docks bottom-left): expand/resize control, live status or
// latest-reply snippet, record button, settings gear — recording works
// without expanding. Expanded = resizable bottom sheet over the reader
// (drag the top edge / the bar's control to size it, tap to cycle
// bar → half → tall): session header (recipe, current step, timer chips),
// multiturn transcript, push-to-talk mic + always-available text input.
// Recordings are sent straight to the assistant ("instant") or land in the
// editable input for correction ("review") per the voice settings; replies
// are spoken via on-device TTS. Rule-based intents resolve client-side
// (§14.2) — only free questions cost an LLM turn. Mic modes: Standard
// (sleeps after each reply) and Always-on (keeps listening; silence ends a
// turn — development.md §14).
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  ChefHat,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ListOrdered,
  LoaderCircle,
  MessageCircle,
  Mic,
  RotateCcw,
  Send,
  Sparkles,
  Square,
  Timer,
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
import { currentReaderStep, revealStep, resolveSwipe } from "@/lib/step-navigation";
import { setActiveChatSession } from "@/components/chat/chat-session-registry";
import { ChatBar } from "@/components/chat/chat-bar";
import { ChatSettingsButton, useChatSettings } from "@/components/chat/chat-settings";
import { ResizeHandle, SHEET_HEIGHT_MAX_VH, SHEET_HEIGHT_MIN_VH } from "@/components/chat/resize-handle";
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

const PANEL_HEIGHT_KEY = "cookbook:chatPanelHeight";

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
  // Form: collapsed bar or expanded sheet. The component stays mounted
  // across switches, so transcript/session/tab state survives (§3.3.4).
  const [form, setForm] = useState<"bar" | "sheet">("bar");
  const [heightVh, setHeightVh] = useState(() => {
    try {
      const v = Number(localStorage.getItem(PANEL_HEIGHT_KEY));
      if (Number.isFinite(v) && v >= SHEET_HEIGHT_MIN_VH && v <= SHEET_HEIGHT_MAX_VH) return v;
    } catch {
      // private mode — default size
    }
    return 55;
  });
  const [session, setSession] = useState<ChatSessionResponse | null>(null);
  const [messages, setMessages] = useState<TranscriptMessage[]>([]);
  const [creating, setCreating] = useState(false);
  const [thinking, setThinking] = useState(false);
  const [speechOn, setSpeechOn] = useState(true);
  const [input, setInput] = useState("");
  // Chat ↔ Steps tab (design.md §3.3.4). Survives collapse — the component
  // stays mounted, so switching back restores whichever view was active.
  const [tab, setTab] = useState<"chat" | "steps">("chat");
  // Transient bar notice ("Didn't catch that") — cleared on a timer.
  const [notice, setNotice] = useState<string | null>(null);
  const quotaExceeded = useLlmQuotaExceeded();
  const transcriptRef = useRef<HTMLDivElement>(null);
  const stepsCardRef = useRef<HTMLDivElement>(null);

  // sessionRef mirrors `session` for the async paths (STT results, queued
  // sends) that must not read a stale closure.
  const sessionRef = useRef<ChatSessionResponse | null>(null);
  // An instant voice turn that arrived before the session was ready.
  const queuedVoiceRef = useRef<string | null>(null);
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flashNotice = (text: string) => {
    setNotice(text);
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
    noticeTimer.current = setTimeout(() => setNotice(null), 4000);
  };

  // ── voice settings (design.md §3.3.4 "Voice modes & settings") ────────────
  const { settings } = useChatSettings();
  const instantSend = settings.sendOnStop === "instant" || settings.micMode === "always-on";
  const instantSendRef = useRef(instantSend);
  instantSendRef.current = instantSend;

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

  // Latest assistant reply — the collapsed bar's idle snippet.
  const lastReply = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i]!.role === "assistant") return messages[i]!.content;
    }
    return null;
  }, [messages]);

  // ── session lifecycle ──────────────────────────────────────────────────────

  const openSession = async (fresh = false) => {
    setCreating(true);
    try {
      const res = await api.createChatSession({
        recipe_id: recipeId,
        occasion_key: occasionKey,
        fresh,
      });
      sessionRef.current = res;
      setSession(res);
      setMessages(res.messages);
      // An instant voice turn recorded before the session resolved — send it
      // now that persistence is ready.
      if (queuedVoiceRef.current) {
        const queued = queuedVoiceRef.current;
        queuedVoiceRef.current = null;
        void send(queued, "voice");
      }
    } catch (err) {
      toast.error(
        err instanceof ApiRequestError && err.status === 401
          ? "Sign in to use the cooking assistant"
          : "Couldn't open the cooking assistant — try again",
      );
      queuedVoiceRef.current = null;
    } finally {
      setCreating(false);
    }
  };

  // Bootstrapping the session + TTS model: when the sheet opens, or when a
  // recording starts from the bar with the sheet never opened. Warms Kokoro
  // so the first spoken reply isn't the fallback voice (§14.1).
  const ensureSession = () => {
    preloadTts();
    if (!sessionRef.current && !creating) void openSession();
  };

  // Opening the sheet resolves today's session (resume-today-or-create,
  // §14.4).
  useEffect(() => {
    if (form === "sheet") ensureSession();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form, session]);

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
    setForm("bar");
    cancelSpeech();
  };

  // Leave nothing speaking when the reader unmounts.
  useEffect(
    () => () => {
      cancelSpeech();
      if (noticeTimer.current) clearTimeout(noticeTimer.current);
    },
    [],
  );

  // ── cooking context (development.md §14.3) ────────────────────────────────
  // Step position and timer state are client-side, so the client reports them.
  // "Current" step uses the reader's scroll-position convention (the same
  // midpoint rule as shake-to-advance).

  const currentStepId = (): string | null => currentReaderStep(steps)?.id ?? null;

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
  // only `llm` intents reach POST /messages. Voice turns marked `via: "voice"`
  // may auto-send (settings §3.3.4); typed turns always take the input path.

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
      // Shake-to-advance semantics (§3.3.3): navigating to the step also
      // starts its timer unless one already lives for it.
      if (target) revealStep(target, { recipeId, recipeTitle, startTimer: true });
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

  const send = async (raw: string, via: "text" | "voice" = "text") => {
    const content = raw.trim();
    if (!content) return;
    if (thinking) {
      // Typed input is disabled while thinking, but an auto-sent voice turn
      // can land mid-reply — never eat the user's words.
      if (via === "voice") setInput(content);
      return;
    }
    setInput("");

    // 1. Rule-based intents resolve locally (instant, quota-free).
    const sess = sessionRef.current;
    const routed = routeCookingIntent(content, stepsForRouter());
    if (routed.intent !== "llm") {
      executeAction(routed);
      const now = new Date().toISOString();
      setMessages((m) => [
        ...m,
        sess
          ? {
              id: `local-user-${Date.now()}`,
              cooking_session_id: sess.session.id,
              role: "user" as const,
              content,
              intent: routed.intent as ChatMessage["intent"],
              created_at: now,
            }
          : { pending: true, id: `local-${Date.now()}`, role: "user" as const, content },
        {
          id: `local-reply-${Date.now()}`,
          cooking_session_id: sess?.session.id ?? "",
          role: "assistant" as const,
          content: routed.reply,
          intent: routed.intent as ChatMessage["intent"],
          created_at: now,
        },
      ]);
      speakReply(routed.reply);
      if (sess) {
        // Fire-and-forget persistence of both sides of the turn (§14.2).
        void api
          .logChatTurn(sess.session.id, { role: "user", content, intent: routed.intent })
          .catch(() => undefined);
        void api
          .logChatTurn(sess.session.id, { role: "assistant", content: routed.reply, intent: routed.intent })
          .catch(() => undefined);
      }
      return;
    }

    // 2. LLM turn.
    if (!sess) {
      if (via === "voice") {
        // Instant voice with the session still opening — hold the turn and
        // flush it when the session resolves (an already-creating open will
        // flush the queue too, so never stack a second request).
        queuedVoiceRef.current = content;
        if (!creating) void openSession();
      } else {
        setInput(content); // session still opening — don't eat the text
      }
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
      const res = await api.sendChatMessage(sess.session.id, {
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
      speakReply(res.reply.content);
    } catch (err) {
      if (err instanceof ApiRequestError && err.code === "llm_quota_exceeded") {
        // The server persisted the user message + the spoken fallback notice
        // (§14.3) — mirror it locally so what's shown is what was said.
        flagLlmQuota();
        setMessages((m) => [
          ...m.filter((x) => x.id !== optimistic.id),
          {
            id: `quota-${optimistic.id}`,
            cooking_session_id: sess.session.id,
            role: "assistant",
            content: CHAT_QUOTA_NOTICE,
            intent: "llm_fallback",
            created_at: new Date().toISOString(),
          },
        ]);
        speakReply(CHAT_QUOTA_NOTICE);
      } else {
        // Keep the user's text (retry by resending), just surface the failure.
        toast.error("The assistant couldn't answer — check your connection and retry");
        setMessages((m) => m.filter((x) => x.id !== optimistic.id));
        setInput(content);
        // No reply will be spoken — the always-on mic must not wait forever.
        void stt.resume();
      }
    } finally {
      setThinking(false);
    }
  };

  const currentStepNumber = steps.findIndex((s) => s.id === currentStepId()) + 1;

  // ── steps tab (design.md §3.3.4) ───────────────────────────────────────────
  // The shown step follows the reader's scroll position (single source of
  // truth — same convention as currentStepId/buildContext), so shake (§3.3.3),
  // voice step_control, and timer-pill hash navigation all update the card;
  // swiping scrolls the reader via revealStep and the listener follows.

  // Index into `steps` of the shown card; -1 while the reader sits above
  // the first step (the card then shows step 1).
  const [stepIdx, setStepIdx] = useState(-1);
  // suppresses scroll-sync while a programmatic revealStep scroll settles,
  // so the smooth scroll can't snap the card back to an intermediate step.
  const revealSettlingUntil = useRef(0);

  // Open the tab on whatever the reader currently shows.
  const openStepsTab = () => {
    setStepIdx(steps.findIndex((s) => s.id === currentStepId()));
    setTab("steps");
  };

  const goToStep = (idx: number) => {
    if (idx < 0 || idx >= steps.length) return;
    revealSettlingUntil.current = Date.now() + 700;
    setStepIdx(idx);
    // Swipe never auto-starts timers (docs/agents/frontend.md Decisions) —
    // tap the card's timer chip to start one.
    revealStep(steps[idx]!, { recipeId, recipeTitle, startTimer: false });
  };

  // Follow the reader: any scroll (user drag behind the sheet, shake, hash
  // navigation, voice step_control) re-resolves the current step. rAF-
  // throttled; inert while a swipe-initiated smooth scroll settles.
  useEffect(() => {
    if (form !== "sheet" || tab !== "steps") return;
    let raf = 0;
    const sync = () => {
      raf = 0;
      if (Date.now() < revealSettlingUntil.current) return;
      const current = currentReaderStep(steps);
      setStepIdx(current ? steps.indexOf(current) : -1);
    };
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(sync);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form, tab, steps]);

  // Swipe classification lives in resolveSwipe (unit-tested); the handlers
  // only capture the touch start/end coordinates.
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  const onTouchStart = (e: React.TouchEvent) => {
    const t = e.touches[0];
    if (t) touchStart.current = { x: t.clientX, y: t.clientY };
  };
  const onTouchEnd = (e: React.TouchEvent) => {
    const start = touchStart.current;
    touchStart.current = null;
    const t = e.changedTouches[0];
    if (!start || !t || steps.length === 0) return;
    const width = stepsCardRef.current?.clientWidth ?? window.innerWidth;
    const swipe = resolveSwipe(t.clientX - start.x, t.clientY - start.y, width);
    if (!swipe) return;
    if (swipe === "next") {
      // Last card → same notice shake-to-advance gives at the end.
      if (stepIdx >= steps.length - 1) {
        toast.info("That's the last step");
        return;
      }
      goToStep(stepIdx < 0 ? 0 : stepIdx + 1);
    } else {
      if (stepIdx <= 0) return; // before step 1 — quiet no-op
      goToStep(stepIdx - 1);
    }
  };

  // ── voice input (development.md §14.1, design.md §3.3.4) ──────────────────
  // A finished recording either sends straight away ("instant" — or any
  // always-on turn) or lands in the editable input for correction ("review"
  // — the §3.3.4 editing affordance).
  const inputRef = useRef<HTMLInputElement>(null);
  const stt = useStt(
    (text) => {
      if (instantSendRef.current) void send(text, "voice");
      else {
        setInput((prev) => (prev ? `${prev} ${text}` : text));
        inputRef.current?.focus();
      }
    },
    () => flashNotice("Didn't catch that — try again"),
  );

  useEffect(() => {
    if (stt.error) toast.error(stt.error);
  }, [stt.error]);

  // Always-on mode: open the mic and keep it open across turns; Standard
  // sleeps after each reply. resume() re-arms when a spoken reply ends —
  // no-op in Standard, so the sequencing lives in speakReply below.
  useEffect(() => {
    if (settings.micMode === "always-on") void stt.startContinuous();
    else stt.stopContinuous();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.micMode]);

  // Speak a reply; when it finishes (or is interrupted), the always-on mic
  // picks back up (development.md §14).
  const speakReply = (text: string) => {
    speak(text, () => void stt.resume());
  };

  const toggleMic = () => {
    // Interruption v1 (design.md §3.3.4): tapping the mic cancels in-flight
    // speech, then arms.
    cancelSpeech();
    if (stt.status === "listening") stt.stop();
    else if (stt.status === "idle" || stt.status === "error") {
      // Recording from the collapsed bar must still have a session + warm
      // TTS by the time the reply arrives.
      ensureSession();
      if (settings.micMode === "always-on") void stt.startContinuous();
      else void stt.arm();
    }
  };

  const micBusy = stt.status === "loading-model" || stt.status === "transcribing";
  const listening = stt.status === "listening";

  // ── form + resizing (design.md §3.3.4) ─────────────────────────────────────
  // Tap cycles bar → sheet (remembered height) → tall sheet → bar; a drag
  // sets a continuous height that becomes the remembered sheet height.

  const resizeTo = (vh: number) => {
    setHeightVh(vh);
    try {
      localStorage.setItem(PANEL_HEIGHT_KEY, String(vh));
    } catch {
      // persistence is best-effort
    }
  };

  const cycleSize = () => {
    if (form === "bar") setForm("sheet");
    else if (heightVh < 70) resizeTo(85);
    else setForm("bar");
  };

  // Dragging from the bar grows the sheet live under the pointer.
  const dragResize = (vh: number) => {
    setForm("sheet");
    resizeTo(vh);
  };

  return (
    <>
      {/* Collapsed — the assistant bar (design.md §3.3.4), bottom-right,
          sibling of the timer pill (bottom-left, same elevation). Recording
          and settings work right here; tap the middle to open the sheet. */}
      {form === "bar" && (
        <ChatBar
          listening={listening}
          micBusy={micBusy}
          transcribing={stt.status === "transcribing"}
          thinking={thinking}
          continuous={stt.continuous}
          notice={notice}
          lastReply={lastReply}
          onExpandTap={cycleSize}
          onResize={dragResize}
          onOpenSheet={() => setForm("sheet")}
          onRecordToggle={toggleMic}
        />
      )}

      {/* Expanded — resizable bottom sheet over the reader (design.md
          §3.3.4). Drag the top edge (or the bar's control) to size it. */}
      {form === "sheet" && (
        <section
          aria-label="Cooking assistant"
          className="fixed inset-x-(--spacing-margin) bottom-24 z-40 mx-auto flex max-w-2xl flex-col rounded-(--radius-bento) border border-(--color-border) bg-(--color-surface)"
          style={{ height: `${heightVh}vh` }}
        >
          {/* Top-edge drag strip (desktop mouse) — tap cycles sizes. */}
          <ResizeHandle
            onTap={cycleSize}
            onResize={resizeTo}
            ariaLabel="Resize the cooking assistant"
            className="absolute inset-x-0 top-0 h-2"
          />

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
            {/* Chat ↔ Steps tab (design.md §3.3.4) — one view at a time. */}
            <div
              role="tablist"
              aria-label="Assistant views"
              className="flex shrink-0 items-center gap-1 rounded-(--radius-sm) border border-(--color-border) p-0.5"
            >
              <button
                type="button"
                role="tab"
                aria-selected={tab === "chat"}
                aria-label="Chat"
                title="Chat with the cooking assistant"
                onClick={() => setTab("chat")}
                className={cn(
                  "flex size-7 items-center justify-center rounded-(--radius-sm) transition-colors",
                  tab === "chat"
                    ? "bg-(--color-accent)/15 text-(--color-accent)"
                    : "text-(--color-text-secondary) hover:text-(--color-text-primary)",
                )}
              >
                <MessageCircle className="size-4" strokeWidth={1.5} />
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={tab === "steps"}
                aria-label="Recipe steps"
                title="Recipe steps — swipe to navigate"
                onClick={openStepsTab}
                className={cn(
                  "flex size-7 items-center justify-center rounded-(--radius-sm) transition-colors",
                  tab === "steps"
                    ? "bg-(--color-turmeric)/20 text-(--color-turmeric)"
                    : "text-(--color-text-secondary) hover:text-(--color-text-primary)",
                )}
              >
                <ListOrdered className="size-4" strokeWidth={1.5} />
              </button>
            </div>
            {quotaExceeded && (
              <span className="shrink-0 rounded-(--radius-sm) border border-(--color-error)/40 px-1.5 py-0.5 text-[length:var(--text-meta)] text-(--color-error)">
                AI off
              </span>
            )}
            <ChatSettingsButton className="flex size-7 items-center justify-center" />
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
          {tab === "chat" && (
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
          )}

          {/* Steps tab (design.md §3.3.4) — the hands-messy step card: swipe
              left/right or tap the chevrons to move between steps; shake
              (§3.3.3) advances it too by scrolling the reader behind the
              sheet. The shown step always follows the reader's position. */}
          {tab === "steps" && (
            <div
              ref={stepsCardRef}
              onTouchStart={onTouchStart}
              onTouchEnd={onTouchEnd}
              className="flex min-h-0 flex-1 touch-pan-y select-none flex-col px-(--spacing-cell) py-3"
            >
              {steps.length === 0 ? (
                <p className="text-(--color-text-secondary)">This recipe has no steps yet.</p>
              ) : (
                <>
                  <StepCard
                    step={steps[Math.max(stepIdx, 0)]!}
                    recipeId={recipeId}
                    recipeTitle={recipeTitle}
                  />
                  <div className="mt-auto flex items-center justify-between gap-2 pt-3">
                    <button
                      type="button"
                      aria-label="Previous step"
                      disabled={stepIdx <= 0}
                      onClick={() => goToStep(stepIdx - 1)}
                      className="flex size-11 items-center justify-center rounded-(--radius-sm) border border-(--color-border) bg-(--color-page) text-(--color-text-primary) transition-colors hover:border-(--color-secondary) disabled:opacity-40"
                    >
                      <ChevronLeft className="size-5" strokeWidth={1.5} />
                    </button>
                    <p className="font-mono text-mono text-(--color-text-secondary)">
                      {stepIdx < 0 ? `step 1 of ${steps.length}` : `step ${stepIdx + 1} of ${steps.length}`}
                    </p>
                    <button
                      type="button"
                      aria-label="Next step"
                      disabled={stepIdx >= steps.length - 1}
                      onClick={() => {
                        if (stepIdx >= steps.length - 1) return;
                        goToStep(stepIdx < 0 ? 0 : stepIdx + 1);
                      }}
                      className="flex size-11 items-center justify-center rounded-(--radius-sm) border border-(--color-border) bg-(--color-page) text-(--color-text-primary) transition-colors hover:border-(--color-secondary) disabled:opacity-40"
                    >
                      <ChevronRight className="size-5" strokeWidth={1.5} />
                    </button>
                  </div>
                </>
              )}
            </div>
          )}

          {/* Status line (design.md §3.3.4: listening / transcribing / thinking)
              + text input — voice is primary, typing the always-available equal
              path. Voice sends per the settings; in review mode transcribed
              speech lands in the input for correction before sending. Chat tab
              only: the steps card owns the full sheet. */}
          {tab === "chat" && (
          <footer className="border-t border-(--color-border) px-(--spacing-cell) py-2.5">
            <div className="flex h-4 items-center">
              {listening && (
                <span className="flex items-center gap-1.5 text-[length:var(--text-meta)] text-(--color-accent)">
                  <span className="flex items-end gap-0.5" aria-hidden>
                    <span className="w-0.5 animate-pulse bg-(--color-accent)" style={{ height: "6px" }} />
                    <span className="w-0.5 animate-pulse bg-(--color-accent)" style={{ height: "10px", animationDelay: "0.15s" }} />
                    <span className="w-0.5 animate-pulse bg-(--color-accent)" style={{ height: "8px", animationDelay: "0.3s" }} />
                  </span>
                  {stt.continuous
                    ? "Always-on — a pause sends your turn"
                    : "Listening — tap the mic to stop"}
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
          )}
        </section>
      )}
    </>
  );
}

// ── steps tab card (design.md §3.3.4) ─────────────────────────────────────
// One step, large type for hands-messy cooking. Timer chip follows the
// read-mode StepBlockView states (§3.3.2): idle → tap to start, running →
// live countdown, paused → resume. Never auto-started by navigation.

function StepCard({
  step,
  recipeId,
  recipeTitle,
}: {
  step: StepBlock;
  recipeId: string;
  recipeTitle: string;
}) {
  const start = useTimerStore((s) => s.start);
  const toggle = useTimerStore((s) => s.toggle);
  // Selector scoped to THIS step's timer — other timers ticking don't
  // re-render the card.
  const active = useTimerStore((s) => s.timers.find((t) => t.stepId === step.id));

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      {step.image_url && (
        // eslint-disable-next-line @next/next/no-img-element -- local file
        // storage served by the API (development.md §0), no CDN
        <img
          src={step.image_url}
          alt={`Step ${step.step_number}`}
          className="mb-3 max-h-40 w-full rounded-(--radius-sm) border border-(--color-border) object-cover"
        />
      )}
      <p className="whitespace-pre-wrap text-[length:var(--text-body)] leading-relaxed">
        {step.instruction_text}
      </p>
      {step.duration_minutes !== null && step.duration_minutes > 0 && (
        active ? (
          <button
            type="button"
            onClick={() => toggle(step.id)}
            aria-label={active.running ? "Pause timer" : "Resume timer"}
            className={cn(
              "mt-3 inline-flex items-center gap-1.5 rounded-(--radius-sm) border px-2.5 py-1 font-[family-name:var(--font-mono)] text-[length:var(--text-meta)]",
              active.completed
                ? "animate-pulse border-(--color-turmeric) bg-(--color-turmeric) text-(--color-text-primary)"
                : active.running
                  ? "border-(--color-turmeric) bg-(--color-turmeric)/20 text-(--color-text-primary)"
                  : "border-(--color-border) bg-(--color-surface-container) text-(--color-text-secondary)",
            )}
          >
            {active.completed
              ? "done"
              : active.running
                ? `${formatClock(active.remainingSeconds)} left`
                : `paused ${formatClock(active.remainingSeconds)}`}
          </button>
        ) : (
          <button
            type="button"
            onClick={() =>
              start({
                stepId: step.id,
                recipeId,
                recipeTitle,
                stepNumber: step.step_number,
                snippet: step.instruction_text.slice(0, 60),
                totalSeconds: step.duration_minutes! * 60,
              })
            }
            aria-label={`Start ${step.duration_minutes} minute timer for step ${step.step_number}`}
            className="mt-3 inline-flex items-center gap-1.5 rounded-(--radius-sm) bg-(--color-surface-container) px-2.5 py-1 font-[family-name:var(--font-mono)] text-[length:var(--text-meta)] text-(--color-text-secondary) transition-colors hover:bg-(--color-surface-container-high)"
          >
            <Timer className="size-3.5 text-(--color-turmeric)" strokeWidth={1.5} />
            {step.duration_minutes} min
          </button>
        )
      )}
    </div>
  );
}

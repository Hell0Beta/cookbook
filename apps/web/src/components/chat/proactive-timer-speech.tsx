"use client";

// Proactive spoken timer completions — design.md §3.3.4 + development.md
// §14.4: when a step timer finishes and the cooking assistant has been used
// this session, the completion is SPOKEN ("Your 12-minute timer is done…")
// alongside the §3.3.2 pulse/vibration/sound, and logged to the session so
// the transcript matches what was said aloud. Mounted once at the app root
// (providers, next to the floating timer pill) — it outlives the reader and
// the chat panel. Muting the panel's speaker disables this too (lib/tts).
import { useEffect, useRef } from "react";
import type { ActiveTimer } from "@/components/timer/timer-store";
import { useTimerStore } from "@/components/timer/timer-store";
import { getActiveChatSession } from "./chat-session-registry";
import { api } from "@/lib/api";
import { speak } from "@/lib/tts";

function completionSentence(t: ActiveTimer): string {
  const mins = Math.round(t.totalSeconds / 60);
  const duration = mins >= 1 ? `${mins}-minute` : `${t.totalSeconds}-second`;
  return `Your ${duration} timer is done — step ${t.stepNumber}${
    t.snippet ? `, ${t.snippet}` : ""
  }.`;
}

export function ProactiveTimerSpeech() {
  // Step ids that were already announced — a completed timer stays completed,
  // so without this every store update would re-announce it.
  const announced = useRef<Set<string>>(new Set());

  useEffect(() => {
    const unsubscribe = useTimerStore.subscribe((state) => {
      for (const t of state.timers) {
        if (!t.completed || announced.current.has(t.stepId)) continue;
        announced.current.add(t.stepId);
        const session = getActiveChatSession();
        const sentence = completionSentence(t);
        // Spoken always (TTS is local, free, never quota-bound); the
        // transcript only gets it when a chat session is active.
        speak(sentence);
        if (session) {
          void api
            .logChatTurn(session.id, { role: "assistant", content: sentence, intent: "timer" })
            .catch(() => undefined); // fire-and-forget per §14.2
        }
      }
    });
    return unsubscribe;
  }, []);

  return null;
}

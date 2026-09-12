"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "sonner";
import { useState } from "react";
import { FloatingTimerPill } from "@/components/timer/floating-timer-pill";
import { ProactiveTimerSpeech } from "@/components/chat/proactive-timer-speech";
import { LlmQuotaBanner } from "@/components/llm-quota";

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { staleTime: 30_000, retry: 1, refetchOnWindowFocus: false },
        },
      }),
  );

  return (
    <QueryClientProvider client={queryClient}>
      {children}
      <LlmQuotaBanner />
      {/* Timer store is a Zustand module — no provider needed; the pill just
          needs to be mounted once so timers survive navigation (§3.3.2). */}
      <FloatingTimerPill />
      {/* Spoken timer completions (development.md §14.4) — app-root watcher so
          they keep firing while navigating away from the reader. */}
      <ProactiveTimerSpeech />
      <Toaster position="top-center" richColors />
    </QueryClientProvider>
  );
}

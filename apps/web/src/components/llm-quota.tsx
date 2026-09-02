"use client";

// LLM daily-quota alert — design.md §5 + development.md §0: the free OpenRouter
// tier runs out daily; when any request surfaces `llm_quota_exceeded`, the
// banner appears and AI entry points should disable themselves. Core flows
// (manual entry, rule-based tagging, imports) are never blocked.
import { useSyncExternalStore } from "react";
import { AlertTriangle, X } from "lucide-react";
import { ApiRequestError } from "@/lib/api";

let exceeded = false;
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

/** Flag the quota-exhausted state (idempotent). */
export function flagLlmQuota() {
  if (exceeded) return;
  exceeded = true;
  emit();
}

function clearLlmQuota() {
  exceeded = false;
  emit();
}

/**
 * Drop-in `onError` helper for mutations that call AI-backed endpoints —
 * detects the 429 and raises the banner alongside whatever toast shows.
 */
export function quotaAwareOnError(err: unknown) {
  if (err instanceof ApiRequestError && err.code === "llm_quota_exceeded") flagLlmQuota();
}

export function useLlmQuotaExceeded() {
  return useSyncExternalStore(
    (onChange) => {
      listeners.add(onChange);
      return () => listeners.delete(onChange);
    },
    () => exceeded,
    () => false,
  );
}

export function LlmQuotaBanner() {
  const shown = useLlmQuotaExceeded();
  if (!shown) return null;
  return (
    <div
      role="alert"
      className="fixed inset-x-(--spacing-margin) top-20 z-40 flex items-start gap-2 rounded-(--radius-bento) border border-(--color-error)/40 bg-(--color-surface) p-3 text-(--color-text-primary) sm:left-1/2 sm:right-auto sm:w-96 sm:-translate-x-1/2"
    >
      <AlertTriangle className="mt-0.5 size-4 shrink-0 text-(--color-error)" strokeWidth={1.5} />
      <div className="min-w-0 flex-1">
        <p className="font-medium">Daily AI requests used up</p>
        <p className="mt-0.5 text-[length:var(--text-meta)] text-(--color-text-secondary)">
          Smart suggestions are off until tomorrow. Everything else keeps working.
        </p>
      </div>
      <button
        type="button"
        aria-label="Dismiss"
        onClick={clearLlmQuota}
        className="shrink-0 text-(--color-text-secondary)"
      >
        <X className="size-4" />
      </button>
    </div>
  );
}

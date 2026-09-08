"use client";

// Module-level registry of the cooking chat session the user is currently in
// (same singleton pattern as llm-quota.tsx). The panel registers its session;
// the proactive timer-speech watcher lives at the app root and outlives the
// panel — spoken timer alerts keep working while navigating elsewhere in the
// app, as long as the assistant was used this session (design.md §3.3.4).

export interface ActiveChatSession {
  id: string;
  recipeId: string;
  recipeTitle: string;
}

let active: ActiveChatSession | null = null;

export function setActiveChatSession(session: ActiveChatSession | null) {
  active = session;
}

export function getActiveChatSession(): ActiveChatSession | null {
  return active;
}

# Voice Cooking Assistant — Proposal (graduated)

**This feature is now fully specified.** Source of truth:

- **UX:** design.md §3.3.4 "Voice Assistant Panel", §5 (voice behavior at quota exhaustion)
- **Architecture:** development.md §14 "Voice Cooking Assistant" (STT/TTS, intent router, LLM turns, session persistence), §3 (`CookingSession`/`ChatMessage`), §11 (`/chat/*` routes), §12 Phase 11
- **Build checklist:** `docs/todos/phase-11-voice-assistant.md`
- **Agent boundaries:** each `docs/agents/*.md` carries its voice-assistant scope lines

This file remains as the record of the owner decisions that shaped the spec — nothing below overrides the specs above.

## Owner decisions (2026-09-02 brainstorm)

| # | Decision | Where it landed |
|---|---|---|
| D1 | **STT fully local**, latency/quality cost accepted. No cloud speech endpoint; Chrome's Web Speech API rejected (phones home to Google — §0 violation). | development.md §14.1 (transformers.js, vendored whisper `tiny.en` q8), §2 "Voice assistant" |
| D2 | **Push-to-talk**, no wake word / always-listening (post-v1 optional hands-free window). | design.md §3.3.4 |
| D3 | **General cooking questions in scope**, not just recipe-bound. Rule-based router still covers recipe-bound intents quota-free. | development.md §14.2/§14.3 |
| D4 | **Brainstorm + progression persist across sessions.** | This file, then the specs. |
| D5 | **Cooking-session transcripts persist server-side** (resume a conversation). | development.md §3/§14.4, design.md §3.3.4 |
| Q1 | Whisper runs **client-side** (WASM/WebGPU), not on the homeserver CPU. | development.md §14.1 |
| Q3 | **No §0 amendment needed** — zero new outbound calls (models vendored, TTS local, LLM via the existing OpenRouter path). | development.md §13 Resolved |
| Q4 | Interruption v1 = tap mic cancels TTS. | design.md §3.3.4 |
| Q6 | Model: `tiny.en` q8 default, `base.en` q8 the documented upgrade — **chosen from measurement on target devices, not published benchmarks** (search results used during brainstorming were partly synthesized; verify live). | development.md §14.1, phase-11 todo measurement item |

## Architecture notes carried into the spec

- LLM chat turns are **plain request/response — no SSE/token streaming** (§0 bans streaming-heavy LLM usage patterns; nemotron free-tier calls run seconds — the "thinking" UI state covers the wait).
- The intent router is a **pure shared function run client-side**; router actions execute against the frontend Zustand timer store (timers are client state — there is no server timer to command). Only LLM-bound intents hit `POST /chat/sessions/:id/messages`.
- Build order (§14.5): chat route + persistence → text-only panel → TTS + proactive timer speech → intent router → STT. Voice is an input modality layered onto a working chat surface.

## Session log

- 2026-09-02 — brainstorm, decisions D1–D5; spec-writing began (design.md + Data Model landed).
- 2026-09-03 — spec-writing completed: development.md §14/§11/§12/§13 + §2 library entry, phase-11 todo, agent-guide scope updates. This doc shrunk to a pointer.

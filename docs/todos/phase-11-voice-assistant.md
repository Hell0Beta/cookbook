
# Phase 11 — Voice Cooking Assistant

From development.md §12, Build Phase 11. Implements the cooking-session voice assistant (development.md §14; design.md §3.3.4, §5 voice-quota state). Build order per §14.5: chat persistence + route first, text-only panel, TTS, intent router, STT last — each stage lands on a usable surface.

## Chat sessions + LLM chat route (development.md §14.3/§14.4, §11)
- [ ] Prisma schema: `CookingSession` + `ChatMessage` entities, field names identical to development.md §3 (incl. `intent` enum values) *(backend)*
- [ ] `POST /chat/sessions` — resume-today-or-create by `(user, occasion_key)`, `recipe_id` *(backend)*
- [ ] `GET /chat/sessions/:id` — message history for resume *(backend)*
- [ ] `POST /chat/sessions/:id/messages` — LLM turn: persist user message → OpenRouter call → persist reply; `429 llm_quota_exceeded` *after* persisting the user message; `maxTokens` ≈ 200, `reasoning` off *(backend route, ai-pipeline prompt)*
- [ ] `POST /chat/sessions/:id/log` — fire-and-forget persistence of client-resolved turns; never calls the LLM *(backend)*
- [ ] Shared types + Zod: `CookingSession`, `ChatMessage`, chat request/response shapes, intent enum *(packages/shared)*
- [ ] LLM context assembly (§14.3 budget): title + servings, current step ± neighbors, ingredients at current scale, timer summary, last ~8 session turns; system prompt = terse kitchen persona, ≤ 2 sentence replies *(ai-pipeline)*

## Text-only chat panel (design.md §3.3.4)
- [ ] Collapsed state: floating mic-less button (Phase 11a: opens panel; becomes mic in the STT stage) docked above the floating timer pill, read mode only *(frontend)*
- [ ] Expanded state: bottom sheet (~40–60% vh) — session header (recipe title, "Step N of M", live timer chips), transcript, text input, collapse control *(frontend)*
- [ ] Transcript: multiturn thread, user right / assistant left; rule-based replies carry the distinguishing icon *(frontend)*
- [ ] "Thinking" state during LLM turns (covers the free-tier wait) *(frontend)*
- [ ] TanStack Query wiring for all `/chat/*` endpoints *(frontend)*
- [ ] Quota state: 429 → spoken/shown §5 fallback notice + `flagLlmQuota()` banner; session continues rule-based *(frontend)*
- [ ] Session resume UI: "Continue conversation" / "Start fresh" on reopen *(frontend)*

## TTS + proactive speech (development.md §14.1 TTS)
- [ ] SpeechSynthesis wrapper: speak replies, sensible default voice, tap-to-cancel (design.md §3.3.4 interruption v1) *(frontend)*
- [ ] Spoken timer completions when the assistant is active this session ("Your 12-minute simmer is done — next step is …"), in addition to §3.3.2 pulse/vibration *(frontend)*
- [ ] Proactive notices logged as `ChatMessage` rows (intent `timer`) so transcript matches what was spoken *(frontend → `/chat/sessions/:id/log`)*
- [ ] Every browser-API branch try/catch (autoplay policies / unsupported browsers must not crash — same stance as the timer alert) *(frontend)*

## Intent router (development.md §14.2)
- [ ] `routeCookingIntent(text, context)` — pure function in `packages/shared`, unit-tested *(packages/shared)*
- [ ] Step control intents → reader actions mirroring shake-to-advance (scroll into focus, auto-start timers) *(frontend)*
- [ ] Ingredient lookup intents → shared scaling helpers at current servings *(frontend, integrations' helpers)*
- [ ] Timer control intents → Zustand timer store actions *(frontend)*
- [ ] Fail-soft: unrecognized queries fall through to the LLM turn *(packages/shared)*
- [ ] Client-side router runs before send; resolved turns persist via `/chat/sessions/:id/log` *(frontend)*

## STT — local whisper (development.md §14.1)
- [ ] Vendor whisper `tiny.en` q8 (+ onnxruntime-web wasm binaries) at build time under `apps/web/public/models/`; transformers.js configured for local-only model paths (remote fetching disabled — its HF-hub default is a §0 violation) *(frontend)*
- [ ] Web Worker isolation: model load + inference off the main thread; worker owns the transformers.js pipeline *(frontend)*
- [ ] Push-to-talk capture: MediaRecorder/AudioContext → 16 kHz mono PCM → worker; arm/stop states per design.md §3.3.4 *(frontend)*
- [ ] Transcript pre-send affordance: correct a mis-transcription before sending (design.md §3.3.4) *(frontend)*
- [ ] Status line states: listening / transcribing / thinking / speaking *(frontend)*
- [ ] COOP/COEP: verify recipe-cover `<img>` loads from the API origin still render under any cross-origin isolation setup (prefer `credentialless`); single-threaded WASM is the fallback *(frontend)*
- [ ] **On-device latency measurement** (dev.md §14.1: benchmark figures are anecdotal): measure tiny.en q8 on the actual target phone(s); switch to `base.en` q8 only if quality demands, back off to it if latency is unbearable *(frontend)*

## Definition of done (per CLAUDE.md)
- [ ] Zero new outbound calls beyond §0's allowlist (models vendored, SpeechSynthesis local) — §0 unchanged
- [ ] Rule-based path works with the LLM disabled/quota-exhausted; voice quota degradation speaks, never silences
- [ ] Audio never persisted — transcript text only
- [ ] Corresponding items checked off; interfaces recorded in `docs/agents/*.md`

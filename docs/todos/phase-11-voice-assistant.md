
# Phase 11 — Voice Cooking Assistant

From development.md §12, Build Phase 11. Implements the cooking-session voice assistant (development.md §14; design.md §3.3.4, §5 voice-quota state). Build order per §14.5: chat persistence + route first, text-only panel, TTS, intent router, STT last — each stage lands on a usable surface.

## Chat sessions + LLM chat route (development.md §14.3/§14.4, §11)
- [x] Prisma schema: `CookingSession` + `ChatMessage` entities, field names identical to development.md §3 (incl. `intent` enum values) *(backend)*
- [x] `POST /chat/sessions` — resume-today-or-create by occasion (one session per occasion — tab switches keep the transcript; plain recipe views key on recipe), `recipe_id`, `fresh` flag ends today's session first *(backend)*
- [x] `GET /chat/sessions/:id` — message history for resume *(backend)*
- [x] `POST /chat/sessions/:id/messages` — LLM turn: persist user message → OpenRouter call → persist reply; `429 llm_quota_exceeded` *after* persisting the user message (fallback notice persisted as `llm_fallback`); `maxTokens` 220, `reasoning` off; `recipe_id` override follows the active tab *(backend route, ai-pipeline prompt)*
- [x] `POST /chat/sessions/:id/log` — fire-and-forget persistence of client-resolved turns; never calls the LLM *(backend)*
- [x] Shared types + Zod: `CookingSession`, `ChatMessage`, chat request/response shapes, intent enum *(packages/shared)*
- [x] LLM context assembly (§14.3 budget): title + servings, current step ± neighbors, ingredients at current scale, timer summary, last ~8 session turns; system prompt = terse kitchen persona, ≤ 2 sentence replies *(ai-pipeline — `buildCookingChatMessages` in shared/chat.ts, tested)*

## Text-only chat panel (design.md §3.3.4)
- [x] Collapsed state: floating button docked above/beside the floating timer pill (bottom-right; pill docks bottom-left), read mode only; became the MIC button in the STT stage *(frontend)*
- [x] Expanded state: bottom sheet (~55vh) — session header (recipe title, "step N of M", live timer chips), transcript, text input, collapse control *(frontend)*
- [x] Transcript: multiturn thread, user right / assistant left; rule-based replies carry the distinguishing Zap icon, LLM answers Sparkles *(frontend)*
- [x] "Thinking" state during LLM turns (covers the free-tier wait) *(frontend)*
- [x] TanStack Query-less direct fetch wiring for all `/chat/*` endpoints (session state is panel-local — a chat transcript is not cache-shared data) *(frontend)*
- [x] Quota state: 429 → spoken/shown §5 fallback notice (exact `CHAT_QUOTA_NOTICE` text) + `flagLlmQuota()` banner; session continues rule-based *(frontend)*
- [x] Session resume UI: "Continued from earlier today" strip + "Start fresh" (`fresh` flag) *(frontend)*
- [x] **Steps tab (owner request, 2026-09-09)** — Chat/Steps tab toggle in the sheet header; steps card (image + instruction + §3.3.2-states timer chip) with swipe left/right navigation + prev/next chevrons; card follows the reader's scroll position and vice versa (reader = single source of truth; shake §3.3.3 drives it unchanged, no re-routing); swipe never auto-starts timers — shared logic in `lib/step-navigation.ts`, `resolveSwipe` unit-tested *(frontend)*

## TTS + proactive speech (development.md §14.1 TTS)
- [x] SpeechSynthesis wrapper (`lib/tts.ts`): speak replies, default-voice selection, cancel-on-new, speaker mute toggle; every browser-API branch try/catch *(frontend)*
- [x] **TTS engine upgrade: Kokoro-82M primary (owner request, 2026-09-08)** — `tts-worker.ts` runs kokoro-js (q8 ONNX ~92 MB, `af_heart` default, 5 voices) in a worker; `vendor:tts` + `postinstall` vendor model + voices into `public/models/Kokoro-82M-v1.0-ONNX/` (kokoro-js's hardcoded HF voice URL intercepted via the `"kokoro-voices"` Cache API priming — §0 stays clean); SpeechSynthesis is the fallback while loading / on failure *(frontend)*
- [x] Spoken timer completions when the assistant is active this session ("Your 12-minute timer is done — step N…"), in addition to §3.3.2 pulse/vibration *(frontend — `ProactiveTimerSpeech` at app root)*
- [x] Proactive notices logged as `ChatMessage` rows (intent `timer`) so transcript matches what was spoken *(frontend → `/chat/sessions/:id/log`)*
- [x] App-root watcher (`providers.tsx`) — spoken alerts keep firing while navigating away from the reader; the panel registers its session in a module-level registry *(frontend)*

## Intent router (development.md §14.2)
- [x] `routeCookingIntent(text, context)` — pure function in `packages/shared` (chat-router.ts), unit-tested (tests/chat.test.js, 21 tests) *(packages/shared)*
- [x] Step control intents → reader actions mirroring shake-to-advance (scroll into focus, auto-start timers) *(frontend)*
- [x] Ingredient lookup intents → shared scaling helpers at current servings *(frontend, integrations' helpers)*
- [x] Timer control intents → Zustand timer store actions; free-floating voice timers use synthetic step keys *(frontend)*
- [x] Fail-soft: unrecognized queries fall through to the LLM turn *(packages/shared)*
- [x] Client-side router runs before send; resolved turns persist via `/chat/sessions/:id/log` (user message + reply, fire-and-forget) *(frontend)*

## STT — local whisper (development.md §14.1)
- [x] Vendor script `apps/web/scripts/vendor-stt-model.mjs` (`pnpm vendor:stt`) — whisper `tiny.en` q8 ONNX + tokenizer from `onnx-community/whisper-tiny.en`, ORT wasm binaries copied from node_modules, into `apps/web/public/models/`; idempotent *(frontend)*
- [x] Web Worker isolation (`chat/stt-worker.ts`): model load + inference off the main thread; `env.allowRemoteModels = false` + local paths — the worker can never fall back to the HF hub at runtime *(frontend)*
- [x] Push-to-talk capture (`chat/use-stt.ts`): MediaRecorder → decodeAudioData → OfflineAudioContext 16 kHz mono PCM → worker; arm/stop states per design.md §3.3.4 *(frontend)*
- [x] Transcript pre-send affordance: transcribed text lands in the editable input, focused for correction before sending (design.md §3.3.4) *(frontend)*
- [x] Status line states: listening (animated bars) / transcribing / thinking / model loading *(frontend)*
- [ ] COOP/COEP: verify recipe-cover `<img>` loads from the API origin still render under any cross-origin isolation setup (prefer `credentialless`); single-threaded WASM is the fallback — **not enabled in v1; single-threaded WASM is running** *(frontend — revisit only if latency forces threads)*
- [ ] **On-device latency measurement** (dev.md §14.1: benchmark figures are anecdotal): measure tiny.en q8 on the actual target phone(s); switch to `base.en` q8 only if quality demands *(frontend — needs the vendored model + a real device)*

## Definition of done (per CLAUDE.md)
- [x] Zero new outbound calls beyond §0's allowlist (models vendored, SpeechSynthesis local) — §0 unchanged — *verified 2026-09-03: models served from own origin (`/models/`), worker has `allowRemoteModels = false`; server-side outbound paths unchanged (OpenRouter only)*
- [x] Rule-based path works with the LLM disabled/quota-exhausted; voice quota degradation speaks, never silences — *verified 2026-09-03 (API smoke: 503 `llm_unavailable` with the user message persisted + router suite green; 429 path shares the same contract)*
- [x] Audio never persisted — transcript text only
- [x] Corresponding items checked off; interfaces recorded in `docs/agents/*.md`

## Verification log
- 2026-09-03: shared 85/85 tests (incl. 22 chat tests); api + web typecheck clean; web production build compiles + emits the STT worker chunk (standalone-output symlink failures on Windows are pre-existing — real packaging happens in the Linux Docker build); whisper tiny.en q8 vendored (10 MB encoder + 31 MB merged decoder from `onnx-community/whisper-tiny.en`, `_quantized` naming); live API smoke: session create / rule-turn log / graceful LLM-unavailable with persisted user message / same-occasion resume.
- 2026-09-08: Kokoro TTS integrated — model + 5 voices vendored (~93 MB, `Kokoro-82M-v1.0-ONNX`, q8 `_quantized` naming like whisper), typecheck clean, production build compiles + emits the ~1.3 MB TTS worker chunk (kokoro-js + embedded espeak-ng asm.js phonemizer), `postinstall` hook verified idempotent, Dockerfile deps stage carries `scripts/` so the hook can run and the build stage vendors all models (`vendor:models`). **Still open: browser smoke of Kokoro playback + first-load latency on the target phone.**
- **Still open:** on-device latency + transcription quality measurement (needs a real phone + mic); a live LLM turn (needs OPENROUTER_API_KEY in `apps/api/.env`); browser smoke of the panel/mic/TTS.

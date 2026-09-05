# Implementation Plan — Lingua Tutor Production-Readiness Audit & Remediation

## Overview

Harden **Lingua Tutor** — a fully-local, Dockerized AI language tutor (Node/Express 20 app + vanilla-JS SPA; faster-whisper STT microservice; Piper/Kokoro/edge-tts TTS microservice; Ollama LLM) — into a dependable product for daily local German/8-language learning today, on a credible path to production later.

This plan contains (a) a **full audit** across the four requested axes — performance, reliability, readability, security — and (b) a **phased remediation program**. Per the chosen scope, **Phase 1** implements the critical reliability, security, and performance fixes while keeping the current architecture, language, and frameworks. **Phase 2** (documented and scoped, NOT implemented now) covers production-grade modernization: TypeScript, full CI/CD, full test suite, authentication, observability, and LLM streaming.

The implementation preserves the existing stack and conventions (ES modules, Express, FastAPI, vanilla JS) so the fix set can be landed incrementally and validated locally with `docker compose up` and `npm run dev`. Wherever a fix has a performance/reliability/security trade-off, the plan favors **local-first robustness** (e.g., disk caches, timeouts, bounded resources, no new cloud dependencies).

---

## Audit Findings

### 1. Reliability

| ID | Sev. | Finding | Phase |
|----|------|---------|-------|
| R1 | Critical | All session state lives in a process-local `Map` in `backend/services/sessionManager.js`. Any restart (crash, `docker compose restart`, `npm run dev` reload) wipes history and learning context. No persistence layer. | 1 |
| R2 | Critical | No timeouts on any upstream `fetch()` (whisper `sttService.js`, ollama `llmService.js`, TTS `ttsService.js`, and all cloud paths). Node's undici default (~300s) means a hung Ollama/Whisper leaves users staring at an indefinite spinner. | 1 |
| R3 | High | `addTurn()` is not serialized. Two overlapping requests (e.g. `/speak` + `/text`) append `user` turns before either LLM reply lands, so history can be written in the order `[userA, userB, assistantB, assistantA]` — corrupted context fed to the LLM. | 1 |
| R4 | High | `docker-compose.yml` `app` uses `depends_on: condition: service_started` for whisper/tts/ollama. Whisper returns `503` until the model is loaded, so first real requests after boot fail even though healthchecks exist. | 1 |
| R5 | High | `ollama-pull` runs once with `restart: "no"`; nothing verifies the model exists or that the pull succeeded. If the pull fails on first run, the whole stack "works" but every LLM call errors. | 1 |
| R6 | High | `backend/server.js` registers no `unhandledRejection`/`unhandledException` handlers and no graceful shutdown — a single rejected promise can crash the process, dropping all sessions. | 1 |
| R7 | High | No `package-lock.json` and `^`-versioned deps → non-reproducible installs between machines and over time. (Docker layer caching masks this until a rebuild.) | 1 |
| R8 | Medium | Piper voices are downloaded at runtime **into the ephemeral container filesystem** (`services/tts/main.py` `_download_voice`). Container recreation re-downloads them; if huggingface.co is unreachable, TTS fails outright despite Kokoro/edge fallbacks being available. | 1 |
| R9 | Medium | History trimming in `addTurn` is count-based (`MAX_HISTORY * 2 = 40` messages) with no token estimation. On 4k-context models (e.g. `llama3.2`) 40 turns of tutor+learner text can overflow the context window mid-conversation. | 1 |
| R10 | Medium | No error taxonomy or structured logging. `err.message` is forwarded to the client and leaks internal topology (`Ollama unreachable at http://ollama:11434`, port numbers). Ad-hoc `console.log` only. | 1 |
| R11 | Medium | Unbounded resources: unlimited `/session` creation (memory DoS), whisper `audio.read()` unbounded, no concurrency caps in either microservice. | 1 |
| R12 | Low | Cloud fallback paths (Deepgram, OpenAI, ElevenLabs, Anthropic) have no retry/backoff (only `edge-tts` in `main.py` retries). | 2 |

### 2. Performance

| ID | Sev. | Finding | Phase |
|----|------|---------|-------|
| P1 | High | The `/speak` pipeline is a strictly serial waterfall STT → LLM (`stream:false`, `num_predict:600`) → TTS (spawns a Piper subprocess per request). Time-to-first-sound can exceed 15–30s on CPU; no partial feedback reaches the user. | 1 (cache+timeouts), 2 (streaming) |
| P2 | Medium | Audio is returned as **base64 inside JSON** (`res.json({ audioBase64 })`) and decoded client-side with `atob`+`Uint8Array` per turn → ~33% wire inflation, large blob decode GC churn, `URL.createObjectURL` per play with no reuse. | 1 |
| P3 | Medium | No gzip/compression middleware on Express; all JSON/base64 payloads uncompressed. | 1 |
| P4 | Medium | Whisper `beam_size=5` hardcoded (CPU-heavy). Weak local machines have no dial to trade accuracy for speed. | 1 |
| P5 | Low | No cache headers for `/css/*` and `/js/*`. Google Fonts are a 3rd-party network dependency that also contradicts the README's "100% local" claim. | 1 |
| P6 | Low | Chat log DOM grows unboundedly — a long session accumulates hundreds of nodes; no pruning. | 1 |
### 3. Readability & Maintainability

| ID | Sev. | Finding | Phase |
|----|------|---------|-------|
| Rd1 | High | **Zero automated tests** in the entire repository (back or front). Nothing guards the non-trivial LLM response parsing, history trimming, or API contract. | 1 (critical units), 2 (full) |
| Rd2 | High | No linting/formatting/editor tooling (no eslint, prettier, editorconfig, tsconfig). No shared conventions; mixed quoting already visible. | 1 |
| Rd3 | Medium | Dead code and dead deps: `ws`, `node-fetch`, `form-data`, `nodemon` declared but never imported; `session.errorPatterns` and `stats.errorsFound/vocabTips` are never written; `parseTutorResponse` computes `parsed.correction` as **always `null`** (dead UI branch); `services/tts/preload_model.py` (Coqui XTTS) and `scripts/pull-model.sh` are unreferenced by any build/compose step. | 1 |
| Rd4 | Medium | Magic numbers hardcoded: temperature 0.75, top_p 0.9, num_predict 600, `MAX_HISTORY 20`, session TTL 2h, cleanup interval 30min, "keep first 2 turns", 25MB multer cap. | 1 |
| Rd5 | Medium | Monoliths: `routes/api.js` mixes routing, pipeline orchestration, and audio handling; `frontend/public/js/app.js` is a 500-line single file mixing state/UI/audio. | 1 (route split), 2 (services) |
| Rd6 | Medium | Documentation drift: README says default TTS is `edge` while `.env` uses `kokoro`; README claims "100% local / no cloud" while edge-tts (cloud) and Google Fonts (cloud) are in the default path. | 1 |
| Rd7 | Low | The project is **not a git repository** (`.gitignore` exists but no `.git`) → no history, no rollback, no CI hook-in point. | 1 |

### 4. Security

| ID | Sev. | Finding | Phase |
|----|------|---------|-------|
| S1 | Critical | **XSS in tutor message rendering.** `frontend/public/js/app.js` `appendMessage('tutor', …)` inserts LLM output via `innerHTML` after a regex "markdown" transform with **no HTML escaping** (the user-message path escapes; the tutor path does not). A glitchy or jailbroken local model emitting `<img onerror=…>` executes scripts in the browser. | 1 |
| S2 | High | `app.use(cors())` allows **any origin** with default reflected headers. | 1 |
| S3 | High | All four services publish ports to `0.0.0.0`: `11434`, `8001`, `8002`, `3000`. Any LAN host can consume the Ollama API and drive the stack (the app itself only needs `3000`). | 1 |
| S4 | High | No authentication of any kind. Combined with S3, LAN users can spawn unlimited sessions, upload 25MB audio repeatedly, and burn CPU/RAM of the host machine. | 1 (optional token), 2 (full auth) |
| S5 | Medium | No security headers: no CSP, no `X-Content-Type-Options`, no `Referrer-Policy`, no frame protections. | 1 |
| S6 | Medium | LLM output is unfiltered — the tutor prompt is user-adjacent content and the learner can attempt jailbreaks (prompt injection). No output policy layer or basic content guard. | 2 |
| S7 | Low | SPA catch-all `app.get('*')` returns `200` + `index.html` for unknown paths including `/api/…` typos — hides 404s from clients/tooling. | 1 |
| S8 | Low | `package.json` lacks `private: true`, `engines`, and a `license` — accidental `npm publish` is possible. | 1 |

---

## Types

Phase 1 keeps JavaScript; types are expressed as JSDoc typedefs enforced at runtime by validation. Phase 2 may convert these to TypeScript interfaces verbatim.

```js
/** SessionConfig — validated subset of a create request. */
// { targetLanguage, conversationType, subtype, level, tutorStyle, nativeLanguage }
//   targetLanguage:   one of Object.keys(LANGUAGES); default 'de'
//   conversationType: one of Object.keys(CONVERSATION_TYPES); default 'job_interview'
//   subtype:          key within conversationTypes[conversationType].subtypes; default 'general'
//   level:            one of Object.keys(LEVELS); default 'b1'
//   tutorStyle:       one of Object.keys(TUTOR_STYLES); default 'encouraging'
//   nativeLanguage:   free text; default 'English'

/** Session — in-memory + optionally persisted record (sessionManager.js). */
// { id, createdAt, lastActivity, config: SessionConfig,
//   history: Array<{ role:'user'|'assistant', content:string }>,
//   turnCount, stats: { totalTurns, errorsFound, vocabTips }, systemPrompt }

/** LLMResult — return shape of every provider in llmService.js. */
// { text: string, provider: 'ollama'|'anthropic'|'openai', model: string }

/** STTResult — return shape of transcribeAudio(). */
// { transcript: string, language: string, confidence: number, provider: 'whisper'|'deepgram' }

/** TTSResult — return shape of synthesizeSpeech(); audio served via GET /audio/:id when cached. */
// { audioId: string|null, audioBuffer: Buffer, mimeType: string, provider: string }

/** AppError — error taxonomy carried through middleware/errorHandler.js. */
// class AppError extends Error { code: 'SESSION_NOT_FOUND'|'VALIDATION'|'UPSTREAM_TIMEOUT'
//   |'UPSTREAM_ERROR'|'AUDIO_TOO_SHORT'|'RATE_LIMITED'|'INTERNAL', status: number, expose: boolean }

/** EnvConfig — validated, typed process.env surface (backend/config/env.js). */
// See the EnvConfig key list in the Files section below.
```

Runtime validation helpers follow these shapes: `validateSessionConfig(input) → { config, errors }`, `estimateTokens(text) → number`, `trimHistory(messages, maxTokens) → messages[]`, `hashAudio(text, lang, voice, speed) → sha1-hex`.
---

## Files

### New files (Phase 1)

| Path | Purpose |
|------|---------|
| `backend/config/env.js` | Central `loadEnv()` → frozen `EnvConfig`: `PORT, HOST_BIND, NODE_ENV, STT_PROVIDER, TTS_PROVIDER, LLM_PROVIDER, OLLAMA_BASE_URL, OLLAMA_MODEL`, LLM sampling (`LLM_TEMPERATURE, LLM_TOP_P, LLM_REPEAT_PENALTY, LLM_NUM_PREDICT, LLM_MAX_TOKENS, LLM_TIMEOUT_MS, LLM_MAX_HISTORY_TOKENS`), `STT_TIMEOUT_MS, TTS_TIMEOUT_MS, WHISPER_SERVICE_URL, TTS_SERVICE_URL, TTS_SPEED`, session (`SESSION_MAX_HISTORY, SESSION_TTL_MS, SESSION_CLEANUP_MS, MAX_SESSIONS, SESSION_PERSIST_DIR`), caches (`AUDIO_CACHE_DIR, AUDIO_CACHE_MAX_BYTES`), network (`CORS_ORIGINS, AUTH_TOKEN, WHISPER_MAX_AUDIO_BYTES, WHISPER_CONCURRENCY, WHISPER_BEAM_SIZE, TTS_CONCURRENCY, ENABLE_COMPRESSION`). Throws at boot on invalid values. |
| `backend/services/logger.js` | Leveled structured logger (`info/warn/error/debug`): pretty single-line in dev, JSON lines in production; redacts `Authorization` / `x-api-key` / `*_API_KEY` values; replaces all ad-hoc backend `console.*`. |
| `backend/services/AppError.js` | `AppError` class + error-code table (see Types). |
| `backend/middleware/security.js` | `securityHeaders()` — CSP `default-src 'self'` + self-hosted fonts (`style-src 'self' 'unsafe-inline'` for any existing inline styles), `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, `X-Frame-Options: DENY`; `corsAllowList()` — same-origin default, `CORS_ORIGINS` override; optional `authRequired()` — Bearer token check when `AUTH_TOKEN` is set. |
| `backend/middleware/errorHandler.js` | Central error handler: maps `AppError` codes → HTTP status; hides stack + internal URLs in responses (stack only in `development`); logs via `logger`; adds `X-Request-Id`. |
| `backend/services/audioCache.js` | Disk-persisted TTS cache under `AUDIO_CACHE_DIR`: key = `sha1(text\|lang\|voice\|speed)`; stores `{key}.bin` + sidecar `{key}.json` (mime, provider, createdAt); `lookupAudio(key)`, `storeAudio(key, buffer, mime, provider)`, `pruneAudioCache()` (LRU by mtime, max bytes). Cache dir is a mounted Docker volume. |
| `backend/routes/audio.js` | `GET /audio/:id` — serves cached audio with `Cache-Control: public, max-age=31536000, immutable` and correct `Content-Type`; 404 on miss. |
| `backend/utils/tokens.js` | `estimateTokens(text)` (chars/4 heuristic with CJK multiplier), `trimHistory(messages, systemPrompt, maxTokens)` — keeps system prompt + oldest 2 turns + newest turns within budget (R9). |
| `backend/utils/validate.js` | `validateSessionConfig(input)` — whitelists every `SessionConfig` field against `LANGUAGES/CONVERSATION_TYPES/LEVELS/TUTOR_STYLES`; returns canonical config or `VALIDATION` AppError; `assertSessionId(id)`. |
| `backend/test/…` | `node:test` + `supertest` suites (see Testing): `sessionManager.test.js`, `llmService.test.js`, `tutorPrompt.test.js`, `validate.test.js`, `routes.test.js`, `audioCache.test.js`. |
| `frontend/public/js/render.js` | DOM-based safe renderer `renderMarkdown(text) → DocumentFragment`: escapes all text via `textContent`, then applies `**bold**` / `*em*` / line breaks / correction / vocab extraction. **No `innerHTML` with untrusted data** (S1). |
| `eslint.config.js`, `.prettierrc.json`, `.editorconfig` | Baseline lint/format config (eslint flat config + prettier; PDF/ruff for Python in Phase 2). |
| `package-lock.json` | Generated by `npm install`; commits exact resolved versions (R7). |
| `data/audio-cache/`, `data/sessions/` + `.gitkeep` | Default cache + persistence targets (Docker volumes, not git). |
| `.env.example` refresh | All new env keys documented with existing comment style. |

### Modified files (Phase 1)

| Path | Changes |
|------|---------|
| `backend/server.js` | Wire `env.js`, `logger.js`, `security.js`, `errorHandler.js`, compression (when enabled); `/health` probes downstream services with short-timeout `fetch`; export `startServer()`; `SIGTERM/SIGINT` graceful shutdown; `unhandledRejection`/`unhandledException` handlers (R6); replace `app.get('*')` with non-`/api` GET SPA fallback + JSON 404 for `/api/*` (S7). |
| `backend/routes/api.js` | Use `validate.js` for config; enforce `MAX_SESSIONS` (R11); `AbortSignal.timeout(env)` on every pipeline step (R2); route errors via `next(new AppError(…))`; return `audioId`+`audioUrl` when cached with inline-base64 fallback; request logging via `logger`; keep response shapes backward-compatible. |
| `backend/services/sessionManager.js` | Per-session promise-chain **lock** so `addTurn` + LLM round-trips append atomically (R3); token-aware trimming via `tokens.js` (R9); **opt-in** JSON-file persistence under `SESSION_PERSIST_DIR` — load on boot, save on mutation, TTL file cleanup (R1); configurable `SESSION_TTL_MS`/`SESSION_CLEANUP_MS`; write real stats so dead fields (`errorPatterns`, `stats.errorsFound/vocabTips`) become live or get removed (Rd3); `MAX_SESSIONS` guard. |
| `backend/services/llmService.js` | Timeouts via `AbortSignal` for ollama/anthropic/openai (R2); swap raw-response `console.log` for `logger.debug` with truncated preview, no full raw dumps (R10); read model/sampling/speed constants from `env.js`; keep JSON + NDJSON parse strategies; export `parseOllamaResponse(raw)` for testability. |
| `backend/services/sttService.js` | `AbortSignal.timeout(STT_TIMEOUT_MS)`; logger instead of console. |
| `backend/services/ttsService.js` | `AbortSignal.timeout(TTS_TIMEOUT_MS)`; check `audioCache` before synthesizing; store on miss; return `{ audioId, mimeType, provider, audioBase64? }` (P2 partial, P1 via cache). |
| `services/whisper/main.py` | Bound `audio.read()` to `WHISPER_MAX_AUDIO_BYTES` (default 25MB → 413 beyond) (R11); `asyncio.Semaphore(WHISPER_CONCURRENCY)` around `model.transcribe` (R11); `beam_size` configurable via env (P4); `/health` gains `model_loaded` flag; keep temp-file cleanup in `finally`. |
| `services/tts/main.py` | `asyncio.Semaphore(TTS_CONCURRENCY)` around synthesis so concurrent requests don't fork-bomb Piper (P1); keep engine fallback chain; `logging` only. |
| `services/tts/Dockerfile` | No functional change; compose now mounts `tts-voices` volume (R8). |
| `docker-compose.yml` | Bind **all** ports to `127.0.0.1` (S3); `app` → `depends_on: condition: service_healthy` for whisper/tts/ollama (R4); `ollama-pull` → `restart: on-failure` + invoke `scripts/pull-model.sh` (mounted) (R5); add `tts-voices` and `audio-cache` volumes; pass new env keys incl. optional `AUTH_TOKEN`. |
| `frontend/public/js/app.js` | Use `render.js` for tutor messages (S1); play audio from `audioUrl`; prune chat DOM past 300 messages (P6); keep `escapeHtml` for user messages. |
| `frontend/public/index.html` | Self-host fonts (woff2 into `frontend/public/fonts/`) so there is zero external network dependency (P5/Rd6). |
| `frontend/public/css/app.css` | `@font-face` blocks for self-hosted fonts, `font-display: swap`. |
| `package.json` | Remove unused deps `ws`/`node-fetch`/`form-data`/`nodemon` (Rd3); add `compression`; devDeps `supertest`/`eslint`/`prettier`; add `private: true`, `engines: { node: ">=20" }`, `license: "MIT"` (S8); scripts `test`/`lint`/`format`. |
| `README.md`, `.env.example` | Correct TTS default + document true local-vs-cloud matrix (edge-tts is cloud-backed), phased roadmap, new env table, local dev workflow (`docker compose up --build`, `npm test`). |

### Files to delete

| Path | Reason |
|------|--------|
| `services/tts/preload_model.py` | Dead — Coqui XTTS preload, unreferenced by any Dockerfile/code (Rd3). |

> `scripts/pull-model.sh` is **kept** but wired into compose (Phase 1 rewires compose to invoke it instead of the inline shell). Delete only if it remains unused after rewiring.

### Phase 2 (documented, not executed now)

- `tsconfig.json` + TypeScript conversion of `backend/` and `frontend/` (typings derive from the JSDoc typedefs).
- Streaming LLM endpoint (`/api/session/:id/stream`, SSE) for token-by-token tutor text + parallel TTS (P1).
- Observability: `backend/services/observability.js` → `/metrics` (Prometheus counters for pipeline step durations, error codes, cache hit rates).
- Full auth replacing the Phase 1 `AUTH_TOKEN` flag (S4) — API-key management, per-session identity.
- CI/CD: `.github/workflows/ci.yml` (lint, test, `docker compose build`), Dependabot, coverage gate, release tagging (Phase 1 initializes the repo).
- LLM output safety layer (heuristic jailbreak/content guard before rendering, S6).
---

## Functions

### New functions (Phase 1)

| Function | File | Purpose |
|----------|------|---------|
| `loadEnv() → EnvConfig` | `backend/config/env.js` | Parse/validate/type-check process.env once at boot. |
| `log.info/warn/error/debug(msg, meta?)` | `backend/services/logger.js` | Structured logging with secret redaction. |
| `AppError(code, message, cause?)` | `backend/services/AppError.js` | Typed errors with HTTP status mapping. |
| `securityHeaders()`, `corsAllowList()`, `authRequired()` | `backend/middleware/security.js` | CSP/headers, restricted CORS, optional Bearer auth. |
| `errorHandler(err,req,res,next)`, `apiNotFound(req,res)` | `backend/middleware/errorHandler.js` | Central error + 404 responses. |
| `lookupAudio(key)`, `storeAudio(key,buffer,mime,provider)`, `pruneAudioCache()` | `backend/services/audioCache.js` | Disk TTS cache (LRU, max bytes). |
| `hashAudio(text,lang,voice,speed) → hex` | `backend/services/audioCache.js` | Deterministic cache key. |
| `estimateTokens(text)`, `trimHistory(messages, systemPrompt, maxTokens)` | `backend/utils/tokens.js` | Token-aware context management. |
| `validateSessionConfig(input)`, `assertSessionId(id)` | `backend/utils/validate.js` | Whitelist validation of session input. |
| `getAudio(req,res,next)` | `backend/routes/audio.js` | Serve cached audio with immutable cache headers. |
| `renderMarkdown(text) → DocumentFragment` | `frontend/public/js/render.js` | Safe, injection-proof chat rendering. |

### Modified functions (Phase 1)

| Function | File | Required changes |
|----------|------|------------------|
| `createSession(config)` | `sessionManager.js` | Validate via `validateSessionConfig`; enforce `MAX_SESSIONS`; optional initial disk write. |
| `addTurn(sessionId, role, content)` | `sessionManager.js` | Serialize through per-session lock (R3); update real stats; optional persistence (R1). |
| `getMessagesForLLM(sessionId)` | `sessionManager.js` | Apply token-aware `trimHistory` (R9). |
| `updateSession`/`deleteSession` + internal `cleanupOldSessions` | `sessionManager.js` | Configurable TTL/interval from env; delete file on `deleteSession`. |
| `getLLMResponse(systemPrompt, messages)` | `llmService.js` | Route through env config; pass `AbortSignal`; structured logging. |
| `callOllama` / `callAnthropic` / `callOpenAI` | `llmService.js` | Accept `AbortSignal`; use env model/sampling; no full-raw logging. |
| `parseOllamaResponse(raw) → LLMResult` (extracted) | `llmService.js` | Extract parse logic for unit testing; keep single-JSON + NDJSON strategies. |
| `transcribeAudio(buffer, language)` | `sttService.js` | Timeout; logger; clean provider switch. |
| `synthesizeSpeech(text, language, voice)` | `ttsService.js` | Cache lookup/write; timeout; return `audioId` alongside buffer. |
| `transcribe(...)` (FastAPI) | `services/whisper/main.py` | Bounded read (413), semaphore, configurable beam size. |
| `synthesize(...)` (FastAPI) | `services/tts/main.py` | Semaphore-guarded synthesis across the engine chain. |
| Server bootstrap | `backend/server.js` | Extract to `startServer()`; graceful shutdown; process error handlers. |
| `appendMessage(role, text, transcript)` | `frontend/js/app.js` | Render tutor content via `renderMarkdown`; play from `audioUrl`. |
| `playAudio(url)` | `frontend/js/app.js` | Take URL path instead of base64 decode. |
| `parseTutorResponse(text)` | `frontend/js/app.js` | Move into `render.js`; real correction/vocab extraction or drop dead branch (Rd3). |

### Removed functions

| Function | File | Migration |
|----------|------|-----------|
| Cloud provider funcs (`callAnthropic`, `callOpenAI`, `transcribeWithDeepgram`, `synthesizeWithElevenLabs/OpenAI`) | various | **Kept** (upgrade path) but shared timeout/logging helpers. No removals in Phase 1 beyond dead code. |
| `preload_model.py` (script) | `services/tts/` | Delete — unused. |
| Backend ad-hoc `console.log/error` | throughout | Replaced by `logger` — no API surface change. |
---

## Classes

| Class | File | Key methods | Notes |
|-------|------|-------------|-------|
| `AppError extends Error` | `backend/services/AppError.js` | `constructor(code, message, cause)`; statics `AppError.validation/notFound/upstream()` | New. Carries `status`, `code`, `expose`; consumed by `errorHandler.js`. |
| `SessionLock` (internal) | `backend/services/sessionManager.js` | `runExclusive(fn)` — promise-chain mutex keyed by session id | New. Fixes R3 ordering race; absorbed into a `SessionStore` class in Phase 2. |
| `AudioCache` (internal) | `backend/services/audioCache.js` | `lookup` / `store` / `prune` | New. Module functions suffice; wrap in a class if the in-memory LRU index grows. |

No existing classes are removed. Phase 2 may introduce `SessionStore`, `LLMClient`, `STTClient`, `TTSClient` interfaces.

---

## Dependencies

### Phase 1 — Node (root `package.json`)

- **Remove:** `ws`, `node-fetch` (Node ≥18 global fetch), `form-data` (global `FormData`), `nodemon` (uses `node --watch`). Verified dead via codebase search (Rd3).
- **Add (runtime):** `compression` (P3).
- **Add (dev):** `supertest` (route/API tests), `eslint@^9` + minimal flat config, `prettier` (Rd2).
- **Meta:** `"private": true`, `"engines": { "node": ">=20" }`, `"license": "MIT"` (S8).
- **Lockfile:** commit `package-lock.json`; use `npm ci` in Docker/CI (R7).
- **No new runtime framework** — current stack stays for Phase 1 (local-first decision); TypeScript deferred to Phase 2.

### Phase 1 — Python (microservices)

- **No new packages** for Phase 1 hardening (stdlib `asyncio.Semaphore`, bounded reads). Existing `requirements.txt` pins are already exact `==`.
- Optional Phase 2: `ruff` for linting; `pytest` for Python suites.

### Version-change risks

- Express 4.x is aging → **keep for Phase 1** (stable, zero-migration); Express 5 evaluated in Phase 2.
- Do **not** bump `kokoro` / `faster-whisper` / `uvicorn` pins blindly — CPU/Windows compatibility and model compatibility matter more than freshness here.

---

## Testing

### Phase 1 — Backend unit/integration (Node built-in `node:test` + `supertest`, no new test framework)

| Suite | File | Coverage |
|-------|------|----------|
| Session manager | `backend/test/sessionManager.test.js` | create/get/delete; config defaults; **addTurn ordering under concurrent/overlapping calls (R3 regression test)**; history trim respects token budget (R9) and keeps first-2-turn invariant; TTL expiry; persistence round-trip (save→load→trim). |
| LLM service | `backend/test/llmService.test.js` | `parseOllamaResponse`: single JSON, `response` fallback shape, NDJSON stream, empty/`null` content, malformed lines; provider defaulting; timeout propagation (fake `fetch` with `AbortController`). |
| Prompt builder | `backend/test/tutorPrompt.test.js` | `buildSystemPrompt` succeeds for every language × conversationType × subtype × level × tutorStyle combination in `languages.js` (2,160 combos) without throwing and includes a scenario line. |
| Validation | `backend/test/validate.test.js` | Accepts valid input; rejects unknown language/type/subtype/level/style with `VALIDATION`; defaults applied. |
| Audio cache | `backend/test/audioCache.test.js` | deterministic key; store→lookup round-trip; pruning enforces max bytes (LRU). |
| API routes | `backend/test/routes.test.js` | `POST /api/session` (valid/invalid), `GET /api/session/:id`, `POST /:id/start`, `/text`, `/speak` with mocked service modules (fast, no real AI); asserts error status codes (400/404/500) via `AppError` mapping; `GET /audio/:id` cache-hit headers; SPA fallback vs `/api` 404 behavior. |

### Phase 1 — Python smoke tests

- `services/whisper` and `services/tts`: manual `curl /health` after build; `pytest` deferred to Phase 2. At minimum add `assert` guards reachable via the unit-testable pure functions (`clean_text`, `_list_voices`).

### Phase 1 — Manual / E2E validation

1. `npm ci && npm test` on host (Node 20+).
2. `npm run lint` clean.
3. `docker compose config` validates the compose file after port/health/pull changes.
4. `docker compose up --build` on a clean machine → all 4 service healthchecks green; open `http://localhost:3000`, start a German session, speak + text + TTS playback; verify `/health` shows all providers OK.
5. XSS regression: send a text message that echoes `<img src=x onerror=alert(1)>` and confirm no script executes in the chat.
6. Local-network check: confirm `11434/8001/8002` are **not** reachable from another LAN device when `AUTH_TOKEN`/port bindings applied.

### Phase 2 (documented)

- Jest/Vitest parity after TS migration; coverage gate (e.g. ≥80%); browser E2E (Playwright) for the chat flow; `pytest` for both microservices; load test of `/speak` with mocked services to measure P95 under 5 concurrent sessions.
---

## Implementation Order

Numbered steps — each step keeps the app runnable; small, mergeable increments. **Phase 0–2a land now; Phase 2b is documented later work.**

### Phase 0 — Foundation (no behavior change)

1. **Initialize version control.** `git init`, baseline `.gitignore` already present, initial commit (Rd7). Add `AUTHORS`/license note if desired.
2. **Freeze dependencies.** Run `npm install` to generate `package-lock.json`; commit it (R7). Remove the four dead deps from `package.json` in the same change (Rd3) and verify nothing imports them.
3. **Add lint/format baseline.** `eslint.config.js`, `.prettierrc.json`, `.editorconfig`; `npm run lint` + `npm run format` scripts; format the repo once (Rd2).
4. **Env + logger + errors + security middleware skeleton.** Create `backend/config/env.js`, `backend/services/logger.js`, `backend/services/AppError.js`, `backend/middleware/security.js`, `backend/middleware/errorHandler.js`; wire into `server.js` **without** changing route behavior yet. Verify via `npm run dev` smoke.

### Phase 1 — Critical fixes (architecture-preserving)

5. **Session hardening** (R1, R3, R9, R11): rewrite `sessionManager.js` internals — per-session `SessionLock`, token-aware trimming, optional persistence, `MAX_SESSIONS`, configurable TTL — with its unit suite before integration.
6. **Validation layer** (R10, Rd3): create `backend/utils/validate.js` + wire into `createSession` and routes.
7. **Upstream timeouts** (R2, R10): add `AbortSignal.timeout` to all services; extract `parseOllamaResponse`; replace backend console logging with `logger`; add error-mapping to routes (`next(new AppError(...))`) with the `errorHandler`.
8. **TTS audio cache + `/audio` route** (P1, P2): implement `audioCache.js`, `routes/audio.js`, modify `ttsService.js`; update frontend `playAudio` to use `audioUrl`.
9. **Frontend XSS + DOM hardening** (S1, P6): add `render.js`; rewire `appendMessage`; prune chat DOM; self-host fonts (P5); verify S1 regression manually.
10. **Compose/network hardening** (S3, R4, R5, R8): bind ports to `127.0.0.1`; `condition: service_healthy`; `ollama-pull` restart + `pull-model.sh`; `tts-voices` + audio-cache volumes; new env passthrough incl. optional `AUTH_TOKEN`.
11. **Microservice hardening** (R11, P4): `services/whisper/main.py` bounded read + semaphore + beam-size env; `services/tts/main.py` semaphore. Rebuild images.
12. **API route/logic cleanup** (S7, Rd5): 404 for unknown `/api/*`, SPA fallback only for non-API GET; optional compression middleware.
13. **Docs** (Rd6): update `README.md`, `.env.example`, architecture diagram, local-vs-cloud matrix, roadmap.
14. **Integration tests + full validation** (Rd1): complete `routes.test.js`; run `npm ci && npm test`, `npm run lint`, `docker compose config`, then the Phase-1 manual E2E script from Testing.

### Phase 2 — Production-grade (documented, deferred)

15. TypeScript migration (backend, then frontend) from the JSDoc typedefs.
16. Streaming LLM responses (SSE) + parallelism across the STT→LLM→TTS pipeline (P1).
17. Observability: `/metrics`, structured trace ids, pipeline timing.
18. Full authentication & multi-user sessions (replaces `AUTH_TOKEN` flag).
19. CI/CD: GitHub Actions (lint → test → docker build), Dependabot, coverage gate, release tagging.
20. LLM output safety filter (S6) + Playwright E2E suite.

### Sequencing rationale

- Phase 0 lands inert infrastructure so every later step is testable and diff-visible.
- Phase 1 order is **data-integrity → safety → performance → ops**:
  session correctness (5–6) first because every pipeline depends on ordered history; security/frontend (9) next because it is user-facing and exploitable; then resource/performance/ops (7–12); docs last.
- Each step leaves `npm run dev` and `docker compose up` functional, so the plan can be interrupted and resumed safely.
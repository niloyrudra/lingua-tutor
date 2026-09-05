# 🌍 Lingua Tutor

> AI-powered speech-to-speech language coach. Fully local, fully Dockerized — no API keys, no cloud, no cost.
> Select a language, pick a real-world scenario, and have natural conversations with a tutor that corrects you like a native speaker.

---

## ✨ Features

- **8 languages** — German, French, Spanish, Italian, Portuguese, Dutch, Japanese, Mandarin
- **6 scenario types** — Job interviews, daily life, travel, business, academic, free talk
- **Subtypes** — e.g. "German developer interview", "French café ordering", "Spanish hotel check-in"
- **CEFR levels A1–C2** — corrections adapt to your level
- **4 tutor personalities** — Encouraging Coach, Strict Teacher, Native Friend, Socratic Guide
- **Press-and-hold mic** — natural voice input via Web Audio API
- **100% local** — your voice never leaves your machine (with local providers)

---

## 🏗️ Architecture

```
Browser
  │  audio (WebM/Opus)
  ▼
┌─────────────────────────────────────────────────────┐
│  Docker Compose Network: lingua-net                 │
│                                                     │
│  ┌──────────────┐   HTTP    ┌──────────────────┐   │
│  │  Node.js App │──────────▶│  Whisper STT     │   │
│  │  :3000       │           │  faster-whisper  │   │
│  │              │           │  :8001           │   │
│  │              │   HTTP    ├──────────────────┤   │
│  │              │──────────▶│  TTS Service     │   │
│  │              │           │  Piper/Kokoro/   │   │
│  │              │           │  edge-tts :8002  │   │
│  │              │   HTTP    ├──────────────────┤   │
│  │              │──────────▶│  Ollama LLM      │   │
│  └──────────────┘           │  mistral/llama3  │   │
│                             │  :11434          │   │
│                             └──────────────────┘   │
└─────────────────────────────────────────────────────┘
```

---

## 🚀 Quick Start (Local Development)

**Prerequisites:**
- **Node.js 20+** (`node --version`)
- **Docker Desktop** (Mac/Windows) or **Docker Engine + Compose** (Linux)
- **Ollama** installed locally (`ollama --version`)
- ~6–8 GB disk, 8 GB RAM

### First-Time Setup

```bash
# 1. Enter the project
cd lingua-tutor

# 2. Install Node dependencies
npm ci

# 3. Start Ollama (keep this running in a terminal)
ollama serve

# 4. Pull an LLM model (one-time, ~2-4 GB)
ollama pull llama3.2    # or mistral, qwen2.5, etc.

# 5. Build & start Python services (Whisper STT + TTS) in Docker
docker compose up -d whisper tts

# 6. Start the Node app
npm run dev
```

### Daily Development

```bash
# Terminal 1: Start Ollama (if not running)
ollama serve

# Terminal 2: Start Python services
docker compose up -d whisper tts

# Terminal 3: Start Node app (hot-reload enabled)
npm run dev
```

### Open the App

→ http://localhost:3000

---

## 🐳 Full Docker Stack (Alternative)

Run everything in containers (no local Node/Ollama needed):

```bash
docker compose up --build
```

This builds the Node app image and runs all 4 services. First run takes 5-10 minutes.

---

## 🧠 Model Options

### LLM (`OLLAMA_MODEL` in `.env`)

| Model | Size | Best for |
|-------|------|---------|
| `llama3.2` | 2 GB | Quick start |
| `mistral` | 4 GB | European languages (DE/FR/ES) ← **default** |
| `qwen2.5` | 4 GB | Asian languages (JA/ZH) |
| `llama3.1:8b` | 5 GB | Best quality (needs 16 GB RAM) |

### STT (`WHISPER_MODEL` in `.env`)

| Model | Size | Notes |
|-------|------|-------|
| `base` | 145 MB | Fast but flat accuracy |
| `small` | 460 MB | **Default** — solid accuracy, still CPU-friendly |
| `medium` | 1.5 GB | Recommended for Japanese/Chinese |

### TTS (`TTS_PROVIDER` in `.env`)

| Provider | Quality | Start time | Notes |
|----------|---------|-----------|-------|
| `local` (Piper) | Best | ~10s | Truly local, native-speaker models |
| `kokoro` | Better | ~60s | Downloads PyTorch on first run |
| `edge` | Good | Instant | **Cloud** — requires internet |

---

## 🐳 Useful Commands

```bash
# Python services (Whisper + TTS)
docker compose up -d whisper tts    # start in background
docker compose logs -f whisper      # watch Whisper logs
docker compose logs -f tts          # watch TTS logs
docker compose down                 # stop Python services
docker compose down -v              # stop + delete model volumes

# Full stack
docker compose up --build           # build + run everything
docker compose up -d                # run full stack in background
docker compose down                 # stop everything

# Pull a different LLM model (when using full Docker stack)
docker compose exec ollama ollama pull qwen2.5

# Health checks
curl http://localhost:3000/health   # Node app
curl http://localhost:8001/health   # Whisper
curl http://localhost:8002/health   # TTS
```

---

## 📁 Project Structure

```
lingua-tutor/
├── docker-compose.yml
├── Dockerfile                  ← Node.js app
├── .env                        ← edit this for local config
├── .env.example                ← all config options documented
├── services/
│   ├── whisper/                ← FastAPI STT service
│   │   ├── Dockerfile
│   │   ├── main.py
│   │   └── requirements.txt
│   └── tts/                    ← FastAPI TTS service
│       ├── Dockerfile
│       ├── main.py
│       ├── download_voices.py
│       └── requirements.txt
├── backend/
│   ├── server.js
│   ├── config/
│   │   ├── env.js              ← validated, typed environment config
│   │   └── languages.js        ← languages, scenarios, levels
│   ├── middleware/
│   │   ├── security.js         ← CSP, CORS, optional auth
│   │   └── errorHandler.js     ← central error handling
│   ├── prompts/tutorPrompt.js  ← the tutor brain
│   ├── routes/
│   │   ├── api.js              ← session + pipeline routes
│   │   └── audio.js            ← cached audio delivery
│   ├── services/
│   │   ├── sessionManager.js   ← sessions + locking + persistence
│   │   ├── sttService.js       ← → whisper:8001
│   │   ├── llmService.js       ← → ollama:11434
│   │   ├── ttsService.js       ← → tts:8002
│   │   ├── audioCache.js       ← disk TTS cache
│   │   ├── logger.js           ← structured logging
│   │   └── AppError.js         ← typed error taxonomy
│   ├── utils/
│   │   ├── tokens.js           ← token estimation + trimming
│   │   └── validate.js         ← input validation
│   └── test/                   ← node:test + supertest suites
└── frontend/public/
    ├── index.html
    ├── css/
    │   ├── app.css
    │   └── fonts.css           ← self-hosted fonts
    ├── fonts/                  ← woff2 font files
    └── js/
        ├── app.js              ← SPA logic
        └── render.js           ← safe markdown renderer (no XSS)
```

---

## ⚙️ Configuration (`.env`)

**For local development**, copy `.env.example` to `.env` and ensure these are set:

```env
# Service URLs (localhost for local dev)
OLLAMA_BASE_URL=http://localhost:11434
WHISPER_SERVICE_URL=http://localhost:8001
TTS_SERVICE_URL=http://localhost:8002

# Providers
STT_PROVIDER=whisper
TTS_PROVIDER=local
LLM_PROVIDER=ollama
OLLAMA_MODEL=llama3.2
```

All options are documented in `.env.example`. Key categories:

| Category | Variables |
|----------|-----------|
| **Providers** | `STT_PROVIDER`, `TTS_PROVIDER`, `LLM_PROVIDER` |
| **Ollama** | `OLLAMA_BASE_URL`, `OLLAMA_MODEL`, `LLM_TEMPERATURE`, `LLM_TOP_P`, `LLM_REPEAT_PENALTY`, `LLM_NUM_PREDICT`, `LLM_MAX_TOKENS`, `LLM_MAX_HISTORY_TOKENS` |
| **Whisper** | `WHISPER_MODEL`, `WHISPER_DEVICE`, `WHISPER_COMPUTE`, `WHISPER_BEAM_SIZE`, `WHISPER_CONCURRENCY`, `WHISPER_MAX_AUDIO_BYTES` |
| **TTS** | `TTS_ENGINE`, `TTS_SPEED`, `TTS_CONCURRENCY` |
| **Timeouts** | `LLM_TIMEOUT_MS`, `STT_TIMEOUT_MS`, `TTS_TIMEOUT_MS` |
| **Sessions** | `SESSION_MAX_HISTORY`, `SESSION_TTL_MS`, `SESSION_CLEANUP_MS`, `MAX_SESSIONS`, `SESSION_PERSIST_DIR` |
| **Audio Cache** | `AUDIO_CACHE_DIR`, `AUDIO_CACHE_MAX_BYTES` |
| **Network/Security** | `HOST_BIND`, `CORS_ORIGINS`, `AUTH_TOKEN`, `ENABLE_COMPRESSION` |
| **Cloud** | `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `DEEPGRAM_API_KEY`, `ELEVENLABS_API_KEY` |

---

## ☁️ Optional: Switch to Cloud Providers

Add keys to `.env` — no code changes needed:

```env
LLM_PROVIDER=anthropic
ANTHROPIC_API_KEY=sk-ant-...

STT_PROVIDER=deepgram
DEEPGRAM_API_KEY=...

TTS_PROVIDER=elevenlabs
ELEVENLABS_API_KEY=...
```

---

## 🧪 Development

```bash
# Install deps + run tests
npm ci
npm test        # 40 unit/integration tests (node:test + supertest)
npm run lint    # ESLint (flat config)
npm run format  # Prettier

# Run without Docker (requires Ollama, Whisper, TTS services running locally)
npm run dev
```

---

## 🔧 Troubleshooting

**TTS service takes forever to start** — Normal for Kokoro (imports PyTorch ~60s). Use `TTS_PROVIDER=local` (Piper) or `TTS_PROVIDER=edge` for faster starts.

**Out of memory** — Use `OLLAMA_MODEL=llama3.2` + `WHISPER_MODEL=tiny`. Lower `MAX_SESSIONS`.

**Mic not working from another device** — Browsers require HTTPS for mic access. On `localhost` it works fine. For LAN access, set up a reverse proxy with TLS.

**Poor accuracy for Japanese/Chinese** — Set `WHISPER_MODEL=medium` and `OLLAMA_MODEL=qwen2.5`.

**GPU acceleration** — Uncomment the `deploy.resources` section in `docker-compose.yml` under the `ollama` service. Requires `nvidia-container-toolkit`.

**Services not reachable from LAN** — All ports bind to `127.0.0.1` by default for security. Change `HOST_BIND=0.0.0.0` in `.env` only if you understand the risks.

**Ollama connection refused** — Make sure `ollama serve` is running. Check with `curl http://localhost:11434/api/tags`.

**Whisper/TTS container unhealthy** — Run `docker compose logs whisper` or `docker compose logs tts` to see errors. Usually a model download issue on first run.

---

## 🔒 Security Notes

- **XSS fixed**: Tutor messages rendered via safe DOM builder (`render.js`), never `innerHTML`.
- **CORS**: Same-origin by default. Set `CORS_ORIGINS` to allow specific origins.
- **Ports**: All services bind to `127.0.0.1` (loopback only) by default.
- **Auth**: Optional `AUTH_TOKEN` enables Bearer token auth on all `/api/*` routes.
- **Headers**: CSP, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, `X-Frame-Options: DENY`.
- **Rate limits**: `MAX_SESSIONS` caps concurrent sessions; audio uploads capped at 25MB.
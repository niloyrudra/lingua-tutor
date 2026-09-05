/**
 * Central environment configuration.
 *
 * All process.env reads happen here (once, at boot) and are exposed as a
 * frozen, validated object. Every other backend module should import `env`
 * instead of reading process.env directly — this makes misconfiguration fail
 * fast and keeps the configuration surface reviewable in one place.
 */
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "..", "..", "data");

function str(value, fallback) {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function int(value, fallback) {
  const n = parseInt(value, 10);
  return Number.isFinite(n) ? n : fallback;
}

function float(value, fallback) {
  const n = parseFloat(value);
  return Number.isFinite(n) ? n : fallback;
}

function bool(value, fallback) {
  if (value == null || value === "") return fallback;
  return /^(true|1|yes|on)$/i.test(String(value));
}

export const env = Object.freeze({
  // ── Server ────────────────────────────────────────────────────────────────
  NODE_ENV: str(process.env.NODE_ENV, "development"),
  PORT: int(process.env.PORT, 3000),
  HOST_BIND: str(process.env.HOST_BIND, "0.0.0.0"),
  ENABLE_COMPRESSION: bool(process.env.ENABLE_COMPRESSION, true),

  // ── Providers ─────────────────────────────────────────────────────────────
  STT_PROVIDER: str(process.env.STT_PROVIDER, "whisper"), // whisper | deepgram
  TTS_PROVIDER: str(process.env.TTS_PROVIDER, "local"), // local | kokoro | edge | elevenlabs | openai
  LLM_PROVIDER: str(process.env.LLM_PROVIDER, "ollama"), // ollama | anthropic | openai

  // ── Ollama (local LLM) ────────────────────────────────────────────────────
  OLLAMA_BASE_URL: str(process.env.OLLAMA_BASE_URL, "http://ollama:11434"),
  OLLAMA_MODEL: str(process.env.OLLAMA_MODEL, "mistral"),
  LLM_TEMPERATURE: float(process.env.LLM_TEMPERATURE, 0.75),
  LLM_TOP_P: float(process.env.LLM_TOP_P, 0.9),
  LLM_REPEAT_PENALTY: float(process.env.LLM_REPEAT_PENALTY, 1.1),
  LLM_NUM_PREDICT: int(process.env.LLM_NUM_PREDICT, 600),
  // Max tokens per LLM response for cloud providers.
  LLM_MAX_TOKENS: int(process.env.LLM_MAX_TOKENS, 1024),
  // Hard cap on how much conversation history is sent to the model. Kept safely
  // under the 4k-context window of small local models to avoid overflow - the
  // system prompt and prompt-examples must still fit alongside.
  LLM_MAX_HISTORY_TOKENS: int(process.env.LLM_MAX_HISTORY_TOKENS, 2400),

  // ── Upstream timeouts (ms) ────────────────────────────────────────────────
  LLM_TIMEOUT_MS: int(process.env.LLM_TIMEOUT_MS, 120000),
  STT_TIMEOUT_MS: int(process.env.STT_TIMEOUT_MS, 60000),
  TTS_TIMEOUT_MS: int(process.env.TTS_TIMEOUT_MS, 60000),

  // ── Service URLs ──────────────────────────────────────────────────────────
  WHISPER_SERVICE_URL: str(process.env.WHISPER_SERVICE_URL, "http://whisper:8001"),
  TTS_SERVICE_URL: str(process.env.TTS_SERVICE_URL, "http://tts:8002"),
  TTS_SPEED: float(process.env.TTS_SPEED, 1.0),

  // ── Sessions ──────────────────────────────────────────────────────────────
  SESSION_MAX_HISTORY: int(process.env.SESSION_MAX_HISTORY, 20),
  SESSION_TTL_MS: int(process.env.SESSION_TTL_MS, 2 * 60 * 60 * 1000),
  SESSION_CLEANUP_MS: int(process.env.SESSION_CLEANUP_MS, 30 * 60 * 1000),
  MAX_SESSIONS: int(process.env.MAX_SESSIONS, 25),
  // Set to a directory to persist sessions across restarts ('' = disabled).
  SESSION_PERSIST_DIR: str(process.env.SESSION_PERSIST_DIR, ""),

  // ── Audio cache ───────────────────────────────────────────────────────────
  AUDIO_CACHE_DIR: str(process.env.AUDIO_CACHE_DIR, path.join(DATA_DIR, "audio-cache")),
  AUDIO_CACHE_MAX_BYTES: int(process.env.AUDIO_CACHE_MAX_BYTES, 500 * 1024 * 1024),

  // ── Network / security ────────────────────────────────────────────────────
  // Comma-separated list of allowed cross-origin origins; empty = same-origin only.
  CORS_ORIGINS: str(process.env.CORS_ORIGINS, ""),
  // Optional Bearer token for all /api requests; empty = disabled.
  AUTH_TOKEN: str(process.env.AUTH_TOKEN, ""),

  // ── Cloud API keys (optional upgrade path) ────────────────────────────────
  ANTHROPIC_API_KEY: str(process.env.ANTHROPIC_API_KEY, ""),
  ANTHROPIC_MODEL: str(process.env.ANTHROPIC_MODEL, "claude-sonnet-4-20250514"),
  OPENAI_API_KEY: str(process.env.OPENAI_API_KEY, ""),
  OPENAI_MODEL: str(process.env.OPENAI_MODEL, "gpt-4o"),
  DEEPGRAM_API_KEY: str(process.env.DEEPGRAM_API_KEY, ""),
  ELEVENLABS_API_KEY: str(process.env.ELEVENLABS_API_KEY, ""),
  ELEVENLABS_VOICE_ID: str(process.env.ELEVENLABS_VOICE_ID, "EXAVITQu4vr4xnSDxMaL"),
});

export { DATA_DIR };

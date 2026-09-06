/**
 * Text-to-speech service. Routes to the configured provider (local Piper/
 * Kokoro/edge-tts microservice by default, ElevenLabs/OpenAI as optional
 * cloud paths). Responses are stored in a disk cache keyed by input hash so
 * repeated sentences are served instantly without re-synthesis.
 */
import { env } from "../config/env.js";
import { AppError } from "./AppError.js";
import { log } from "./logger.js";
import { hashAudio, lookupAudio, storeAudio } from "./audioCache.js";

export async function synthesizeSpeech(text, language = "de", voiceOverride = null, speedOverride = null) {
  const provider = env.TTS_PROVIDER;
  const speed = speedOverride ?? env.TTS_SPEED;

  // Cache lookup — deterministic engines produce identical audio for identical input.
  const key = hashAudio(text, language, voiceOverride, speed);
  const cached = await lookupAudio(key);
  if (cached) {
    log.debug("TTS cache hit", { key });
    return {
      audioId: key,
      audioBuffer: cached.buffer,
      mimeType: cached.mimeType,
      provider: `cached:${cached.provider}`,
    };
  }

  let result;
  switch (provider) {
    case "local":
    case "kokoro":
    case "edge":
      result = await synthesizeWithTTSService(text, language, voiceOverride, speed);
      break;
    case "elevenlabs":
      result = await synthesizeWithElevenLabs(text, language, voiceOverride);
      break;
    case "openai":
      result = await synthesizeWithOpenAITTS(text, language, voiceOverride);
      break;
    default:
      throw AppError.validation(`Unknown TTS_PROVIDER: "${provider}"`);
  }

  await storeAudio(key, result.audioBuffer, result.mimeType, result.provider);
  log.debug("TTS synthesised + cached", { key, provider: result.provider });
  return { audioId: key, ...result };
}

// ─── Local TTS microservice ──────────────────────────────────────────────────
async function synthesizeWithTTSService(text, language, voice, speed) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), env.TTS_TIMEOUT_MS);
  try {
    const res = await fetch(`${env.TTS_SERVICE_URL}/synthesize`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({ text, language, voice: voice || null, speed: speed ?? env.TTS_SPEED }),
    });

    if (!res.ok) throw AppError.upstream(`TTS service error ${res.status}`);

    const mimeType = res.headers.get("content-type") || "audio/wav";
    const audioBuffer = Buffer.from(await res.arrayBuffer());
    return { audioBuffer, mimeType, provider: "local" };
  } catch (err) {
    if (err.name === "AbortError") throw AppError.upstreamTimeout("TTS timed out");
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

// ─── Cloud: ElevenLabs ───────────────────────────────────────────────────────
async function synthesizeWithElevenLabs(text, language, voiceOverride) {
  const apiKey = env.ELEVENLABS_API_KEY;
  if (!apiKey) throw AppError.validation("ELEVENLABS_API_KEY not set");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), env.TTS_TIMEOUT_MS);
  try {
    const voiceId = voiceOverride || env.ELEVENLABS_VOICE_ID;
    const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
      method: "POST",
      headers: { "xi-api-key": apiKey, "Content-Type": "application/json", Accept: "audio/mpeg" },
      signal: controller.signal,
      body: JSON.stringify({
        text,
        model_id: "eleven_multilingual_v2",
        voice_settings: { stability: 0.5, similarity_boost: 0.8 },
      }),
    });
    if (!res.ok) throw AppError.upstream(`ElevenLabs error ${res.status}`);
    const audioBuffer = Buffer.from(await res.arrayBuffer());
    return { audioBuffer, mimeType: "audio/mpeg", provider: "elevenlabs" };
  } catch (err) {
    if (err.name === "AbortError") throw AppError.upstreamTimeout("ElevenLabs timed out");
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

// ─── Cloud: OpenAI TTS ───────────────────────────────────────────────────────
async function synthesizeWithOpenAITTS(text, language, voiceOverride) {
  const apiKey = env.OPENAI_API_KEY;
  if (!apiKey) throw AppError.validation("OPENAI_API_KEY not set");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), env.TTS_TIMEOUT_MS);
  try {
    const res = await fetch("https://api.openai.com/v1/audio/speech", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({ model: "tts-1", voice: voiceOverride || "nova", input: text }),
    });
    if (!res.ok) throw AppError.upstream(`OpenAI TTS error ${res.status}`);
    const audioBuffer = Buffer.from(await res.arrayBuffer());
    return { audioBuffer, mimeType: "audio/mpeg", provider: "openai-tts" };
  } catch (err) {
    if (err.name === "AbortError") throw AppError.upstreamTimeout("OpenAI TTS timed out");
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

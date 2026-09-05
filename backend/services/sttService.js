/**
 * Speech-to-text service. Routes to the configured provider (local Whisper
 * microservice by default, Deepgram as the optional cloud path). Both paths
 * run under a hard timeout (STT_TIMEOUT_MS).
 */
import { env } from "../config/env.js";
import { AppError } from "./AppError.js";
import { log } from "./logger.js";

export async function transcribeAudio(audioBuffer, language = "auto") {
  switch (env.STT_PROVIDER) {
    case "whisper":
      return transcribeWithWhisperService(audioBuffer, language);
    case "deepgram":
      return transcribeWithDeepgram(audioBuffer, language);
    default:
      throw AppError.validation(`Unknown STT_PROVIDER: "${env.STT_PROVIDER}"`);
  }
}

async function transcribeWithWhisperService(audioBuffer, language) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), env.STT_TIMEOUT_MS);
  try {
    const formData = new FormData();
    const blob = new Blob([audioBuffer], { type: "audio/webm" });
    formData.append("audio", blob, "audio.webm");
    formData.append("language", language || "auto");

    const res = await fetch(`${env.WHISPER_SERVICE_URL}/transcribe`, {
      method: "POST",
      body: formData,
      signal: controller.signal,
    });
    if (!res.ok) throw AppError.upstream(`Whisper service error ${res.status}`);

    const data = await res.json();
    log.debug("STT result", {
      language: data.language,
      confidence: data.confidence,
      transcriptLength: data.transcript?.length,
    });
    return {
      transcript: data.transcript || "",
      language: data.language,
      confidence: data.confidence,
      provider: "whisper",
    };
  } catch (err) {
    if (err.name === "AbortError") throw AppError.upstreamTimeout("Whisper timed out");
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

async function transcribeWithDeepgram(audioBuffer, language) {
  const apiKey = env.DEEPGRAM_API_KEY;
  if (!apiKey) throw AppError.validation("DEEPGRAM_API_KEY not set");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), env.STT_TIMEOUT_MS);
  try {
    const langParam = language !== "auto" ? `&language=${language}` : "";
    const res = await fetch(`https://api.deepgram.com/v1/listen?model=nova-2&smart_format=true${langParam}`, {
      method: "POST",
      headers: { Authorization: `Token ${apiKey}`, "Content-Type": "audio/webm" },
      body: audioBuffer,
      signal: controller.signal,
    });
    if (!res.ok) throw AppError.upstream(`Deepgram error: ${res.status}`);

    const data = await res.json();
    const alt = data.results?.channels?.[0]?.alternatives?.[0];
    return { transcript: alt?.transcript || "", confidence: alt?.confidence || 0, provider: "deepgram" };
  } catch (err) {
    if (err.name === "AbortError") throw AppError.upstreamTimeout("Deepgram timed out");
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

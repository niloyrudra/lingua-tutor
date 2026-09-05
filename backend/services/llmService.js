/**
 * LLM service. Routes to the configured provider (local Ollama by default,
 * with optional Anthropic/OpenAI upgrade path).
 *
 * Every provider call runs under a hard timeout (LLM_TIMEOUT_MS) so a hung
 * model can never stall the request pipeline indefinitely.
 */
import { env } from "../config/env.js";
import { AppError } from "./AppError.js";
import { log } from "./logger.js";

export async function getLLMResponse(systemPrompt, messages) {
  const provider = env.LLM_PROVIDER;
  const model =
    provider === "ollama" ? env.OLLAMA_MODEL : provider === "anthropic" ? env.ANTHROPIC_MODEL : env.OPENAI_MODEL;
  log.debug("LLM request", { provider, model, messageCount: messages.length });

  switch (provider) {
    case "ollama":
      return callOllama(systemPrompt, messages);
    case "anthropic":
      return callAnthropic(systemPrompt, messages);
    case "openai":
      return callOpenAI(systemPrompt, messages);
    default:
      throw AppError.validation(`Unknown LLM_PROVIDER: "${provider}"`);
  }
}

function withTimeout(fn, timeoutMs, errorFactory) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fn(controller.signal)
    .catch(err => {
      if (err.name === "AbortError") throw errorFactory();
      throw err;
    })
    .finally(() => clearTimeout(timer));
}

// ─── LOCAL: Ollama ────────────────────────────────────────────────────────────
async function callOllama(systemPrompt, messages) {
  return withTimeout(
    async signal => {
      let response;
      try {
        response = await fetch(`${env.OLLAMA_BASE_URL}/api/chat`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal,
          body: JSON.stringify({
            model: env.OLLAMA_MODEL,
            stream: false,
            options: {
              temperature: env.LLM_TEMPERATURE,
              top_p: env.LLM_TOP_P,
              repeat_penalty: env.LLM_REPEAT_PENALTY,
              num_predict: env.LLM_NUM_PREDICT,
            },
            messages: [{ role: "system", content: systemPrompt }, ...messages],
          }),
        });
      } catch {
        throw AppError.upstream(`Ollama unreachable at ${env.OLLAMA_BASE_URL}`);
      }

      if (!response.ok) throw AppError.upstream(`Ollama HTTP ${response.status}`);
      const parsed = parseOllamaResponse(await response.text());
      if (!parsed) throw AppError.upstream("Ollama returned an empty response");
      return parsed;
    },
    env.LLM_TIMEOUT_MS,
    () => AppError.upstreamTimeout("Ollama timed out")
  );
}

/**
 * Parses an Ollama `/api/chat` response which may arrive either as a single
 * JSON object or as an NDJSON stream (one JSON object per line).
 * Extracted for unit testing.
 *
 * @param {string} raw
 * @returns {{ text: string, provider: 'ollama', model: string }|null}
 */
export function parseOllamaResponse(raw) {
  let text = "";

  if (raw) {
    try {
      const data = JSON.parse(raw);
      // /api/chat shape: {message:{content}}  |  /api/generate shape: {response}
      text = data?.message?.content ?? data?.response ?? "";
    } catch {
      // Not valid single JSON — fall through to NDJSON parsing
    }

    if (!text) {
      for (const line of raw.split("\n")) {
        if (!line.trim()) continue;
        try {
          const chunk = JSON.parse(line);
          text += chunk?.message?.content ?? chunk?.response ?? "";
        } catch {
          // skip malformed lines
        }
      }
    }
  }

  const trimmed = text.trim();
  if (!trimmed) return null;
  return { text: trimmed, provider: "ollama", model: env.OLLAMA_MODEL };
}

// ─── CLOUD: Anthropic ─────────────────────────────────────────────────────────
async function callAnthropic(systemPrompt, messages) {
  const apiKey = env.ANTHROPIC_API_KEY;
  if (!apiKey) throw AppError.validation("ANTHROPIC_API_KEY not set");

  return withTimeout(
    async signal => {
      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
        },
        signal,
        body: JSON.stringify({
          model: env.ANTHROPIC_MODEL,
          max_tokens: env.LLM_MAX_TOKENS,
          system: systemPrompt,
          messages,
        }),
      });

      if (!response.ok) throw AppError.upstream(`Anthropic HTTP ${response.status}`);
      const data = await response.json();
      const text = data.content?.[0]?.text || "";
      if (!text.trim()) throw AppError.upstream("Anthropic returned an empty response");
      return { text: text.trim(), provider: "anthropic", model: env.ANTHROPIC_MODEL };
    },
    env.LLM_TIMEOUT_MS,
    () => AppError.upstreamTimeout("Anthropic timed out")
  );
}

// ─── CLOUD: OpenAI ────────────────────────────────────────────────────────────
async function callOpenAI(systemPrompt, messages) {
  const apiKey = env.OPENAI_API_KEY;
  if (!apiKey) throw AppError.validation("OPENAI_API_KEY not set");

  return withTimeout(
    async signal => {
      const response = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        signal,
        body: JSON.stringify({
          model: env.OPENAI_MODEL,
          max_tokens: env.LLM_MAX_TOKENS,
          temperature: env.LLM_TEMPERATURE,
          messages: [{ role: "system", content: systemPrompt }, ...messages],
        }),
      });

      if (!response.ok) throw AppError.upstream(`OpenAI HTTP ${response.status}`);
      const data = await response.json();
      const text = data.choices?.[0]?.message?.content || "";
      if (!text.trim()) throw AppError.upstream("OpenAI returned an empty response");
      return { text: text.trim(), provider: "openai", model: env.OPENAI_MODEL };
    },
    env.LLM_TIMEOUT_MS,
    () => AppError.upstreamTimeout("OpenAI timed out")
  );
}

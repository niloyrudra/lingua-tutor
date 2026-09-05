/**
 * Structured, leveled logger.
 *
 * - Development: pretty single-line output with colors.
 * - Production:  JSON lines (parseable by any log collector).
 *
 * Secrets (API keys, Authorization headers, tokens) are redacted from the
 * metadata object before logging.
 */
import { env } from "../config/env.js";

const PRODUCTION = env.NODE_ENV === "production";
const REDACT_PATTERN = /(authorization|x-api-key|api[_-]?key|token|password|secret)/i;

function redact(value, key = "") {
  if (value && typeof value === "object") {
    if (value instanceof Error) return { message: value.message, stack: value.stack };
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = REDACT_PATTERN.test(k) && typeof v === "string" ? "[REDACTED]" : redact(v, k);
    }
    return out;
  }
  if (REDACT_PATTERN.test(key) && typeof value === "string") return "[REDACTED]";
  return value;
}

function write(level, msg, meta) {
  const safe = redact(meta);
  if (PRODUCTION) {
    const line = JSON.stringify({ ts: new Date().toISOString(), level, msg, ...safe });
    (level === "error" ? console.error : console.log)(line);
    return;
  }
  const label = level.toUpperCase().padEnd(5);
  const metaStr = Object.keys(safe || {}).length ? ` ${JSON.stringify(safe)}` : "";
  const out = `${label} ${msg}${metaStr}`;
  (level === "error" ? console.error : console.log)(out);
}

export const log = {
  debug: (msg, meta) => write("debug", msg, meta),
  info: (msg, meta) => write("info", msg, meta),
  warn: (msg, meta) => write("warn", msg, meta),
  error: (msg, meta) => write("error", msg, meta),
};

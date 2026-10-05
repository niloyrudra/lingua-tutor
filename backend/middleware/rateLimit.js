/**
 * Rate limiting middleware using a sliding window.
 * Lightweight, no external deps — suitable for low-traffic APIs.
 */
import { AppError } from "../services/AppError.js";

const windows = new Map(); // key -> { count, resetAt }

function getKey(req, prefix) {
  const ip = req.ip || req.socket.remoteAddress || "unknown";
  return `${prefix}:${ip}`;
}

function checkWindow(key, limit, windowMs) {
  const now = Date.now();
  const entry = windows.get(key);
  if (!entry || entry.resetAt <= now) {
    windows.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, remaining: limit - 1, resetAt: now + windowMs };
  }
  if (entry.count >= limit) {
    return { allowed: false, remaining: 0, resetAt: entry.resetAt };
  }
  entry.count++;
  return { allowed: true, remaining: limit - entry.count, resetAt: entry.resetAt };
}

export function rateLimit({ prefix = "api", limit = 60, windowMs = 60_000 } = {}) {
  return (req, res, next) => {
    const key = getKey(req, prefix);
    const { allowed, remaining, resetAt } = checkWindow(key, limit, windowMs);

    res.set({
      "X-RateLimit-Limit": String(limit),
      "X-RateLimit-Remaining": String(remaining),
      "X-RateLimit-Reset": String(Math.ceil(resetAt / 1000)),
    });

    if (!allowed) {
      const retryAfter = Math.ceil((resetAt - Date.now()) / 1000);
      res.set("Retry-After", String(retryAfter));
      throw AppError.rateLimited(`Rate limit exceeded. Try again in ${retryAfter}s.`);
    }
    next();
  };
}

export function strictRateLimit({ prefix = "strict", limit = 5, windowMs = 60_000 } = {}) {
  return rateLimit({ prefix, limit, windowMs });
}

setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of windows) {
    if (entry.resetAt <= now) windows.delete(key);
  }
}, 5 * 60 * 1000).unref();
/**
 * Security-focused Express middleware:
 *  - securityHeaders(): CSP + hardening headers
 *  - corsAllowList():   same-origin by default, or a CORS_ORIGINS allow-list
 *  - authRequired():    optional Bearer-token gate (enabled via AUTH_TOKEN)
 */
import crypto from "crypto";
import cors from "cors";
import { env } from "../config/env.js";

export function securityHeaders(req, res, next) {
  res.set({
    "Content-Security-Policy": [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data:",
      "media-src 'self' blob:",
      "font-src 'self'",
      "connect-src 'self'",
      "object-src 'none'",
      "base-uri 'self'",
      "frame-ancestors 'none'",
    ].join("; "),
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "X-Frame-Options": "DENY",
    "X-DNS-Prefetch-Control": "off",
  });
  next();
}

export function corsAllowList() {
  const allowed = env.CORS_ORIGINS.split(",")
    .map(o => o.trim())
    .filter(Boolean);

  if (allowed.length === 0) {
    // Empty allow-list: deny all cross-origin requests (no CORS headers sent).
    return cors({ origin: false });
  }

  return cors({
    origin(origin, cb) {
      // Allow requests without an Origin header (curl, same-origin, healthchecks).
      if (!origin || allowed.includes(origin)) return cb(null, true);
      return cb(null, false);
    },
  });
}

function safeEqual(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

export function authRequired(req, res, next) {
  if (!env.AUTH_TOKEN) return next();
  const header = req.get("authorization") || "";
  const supplied = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!supplied || !safeEqual(supplied, env.AUTH_TOKEN)) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  return next();
}

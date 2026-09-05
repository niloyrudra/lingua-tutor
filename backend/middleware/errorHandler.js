/**
 * Central error handling:
 *  - apiNotFound():   JSON 404 for unknown /api/* routes
 *  - errorHandler():  maps AppError → HTTP status; hides internal details
 */
import { AppError } from "../services/AppError.js";
import { log } from "../services/logger.js";
import { env } from "../config/env.js";

export function apiNotFound(req, res) {
  res.status(404).json({ error: `Route not found: ${req.method} ${req.path}` });
}

export function errorHandler(err, req, res, next) {
  if (res.headersSent) return next(err);

  // body-parser / multer validation errors already carry a 4xx status.
  if (!(err instanceof AppError)) {
    if (Number.isInteger(err?.statusCode) && err.statusCode >= 400 && err.statusCode < 500) {
      return res.status(err.statusCode).json({ error: err.message || "Bad request" });
    }
    log.error("Unhandled error", { message: err.message, stack: err.stack, path: req.path });
    const body = { error: "Internal server error" };
    if (env.NODE_ENV === "development" && err.stack) body.stack = err.stack;
    return res.status(500).json(body);
  }

  log.error(`[${err.code}] ${err.message}`, { code: err.code, path: req.path, cause: err.cause?.message });

  const message = err.expose ? err.message : "Upstream service error";
  const body = { error: message };
  if (env.NODE_ENV === "development" && err.stack) body.stack = err.stack;
  return res.status(err.status).json(body);
}

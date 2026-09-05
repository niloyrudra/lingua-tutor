/**
 * Typed application errors with an HTTP status mapping.
 *
 * `expose` controls whether the message may be sent to the client. Internal
 * implementation details (service URLs, upstream responses) must never be
 * surfaced, so UPSTREAM_* and INTERNAL errors are not exposed.
 */
export const ERROR_STATUS = {
  SESSION_NOT_FOUND: 404,
  VALIDATION: 400,
  UPSTREAM_TIMEOUT: 504,
  UPSTREAM_ERROR: 502,
  RATE_LIMITED: 429,
  INTERNAL: 500,
};

const EXPOSED_CODES = new Set(["SESSION_NOT_FOUND", "VALIDATION", "RATE_LIMITED"]);

export class AppError extends Error {
  constructor(code, message, cause) {
    super(message, cause ? { cause } : undefined);
    this.name = "AppError";
    this.code = code;
    this.status = ERROR_STATUS[code] ?? 500;
    this.expose = EXPOSED_CODES.has(code);
  }

  static validation(message) {
    return new AppError("VALIDATION", message);
  }

  static notFound(message = "Session not found") {
    return new AppError("SESSION_NOT_FOUND", message);
  }

  static upstream(message) {
    return new AppError("UPSTREAM_ERROR", message);
  }

  static upstreamTimeout(message = "Upstream service timed out") {
    return new AppError("UPSTREAM_TIMEOUT", message);
  }

  static rateLimited(message = "Too many requests") {
    return new AppError("RATE_LIMITED", message);
  }

  static internal(message = "Internal server error", cause) {
    return new AppError("INTERNAL", message, cause);
  }
}

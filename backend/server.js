import "dotenv/config";
import express from "express";
import compression from "compression";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import { env } from "./config/env.js";
import apiRoutes from "./routes/api.js";
import audioRoutes from "./routes/audio.js";
import { securityHeaders, corsAllowList } from "./middleware/security.js";
import { errorHandler, apiNotFound } from "./middleware/errorHandler.js";
import { log } from "./services/logger.js";
import { loadPersistedSessions } from "./services/sessionManager.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FRONTEND_DIR = path.join(__dirname, "..", "frontend", "public");

const app = express();

// ─── Security & middleware ───────────────────────────────────────────────────
app.set("trust proxy", 1);
app.disable("x-powered-by");
app.use(securityHeaders);
app.use(corsAllowList());
if (env.ENABLE_COMPRESSION) app.use(compression());
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true, limit: "1mb" }));

// ─── Static files (frontend), no implicit index — SPA fallback handles routes.
app.use(
  express.static(FRONTEND_DIR, {
    maxAge: "7d",
    etag: true,
    index: false,
  })
);

// ─── API routes ──────────────────────────────────────────────────────────────
app.use("/api", apiRoutes);
app.use("/api/audio", audioRoutes);
app.use("/api", apiNotFound); // JSON 404 for unknown /api/* routes

// ─── Health check ─────────────────────────────────────────────────────────────
async function probe(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 3500);
  try {
    const res = await fetch(url, { signal: controller.signal });
    return res.ok ? "ok" : `down(${res.status})`;
  } catch {
    return "down";
  } finally {
    clearTimeout(timer);
  }
}

app.get("/health", async (req, res) => {
  const [stt, tts, llm] = await Promise.all([
    env.STT_PROVIDER === "whisper" ? probe(`${env.WHISPER_SERVICE_URL}/health`) : "cloud",
    probe(`${env.TTS_SERVICE_URL}/health`),
    probe(`${env.OLLAMA_BASE_URL}/api/tags`),
  ]);
  res.json({
    status: "ok",
    providers: {
      stt: env.STT_PROVIDER,
      llm: env.LLM_PROVIDER,
      tts: env.TTS_PROVIDER,
    },
    model: env.OLLAMA_MODEL,
    services: { whisper: stt, tts, ollama: llm },
    activeSessions: undefined, // filled by /api/sessions; kept for shape stability
  });
});

// ─── SPA fallback (non-API GET routes only) ───────────────────────────────────
app.get("*", (req, res) => {
  if (req.path.startsWith("/api/")) return apiNotFound(req, res);
  const indexPath = path.join(FRONTEND_DIR, "index.html");
  if (fs.existsSync(indexPath)) return res.sendFile(indexPath);
  return res.status(404).json({ error: "Frontend not built" });
});

// ─── Central error handler (always last) ─────────────────────────────────────
app.use(errorHandler);

// ─── Start (only when executed directly — tests import `app`) ────────────────
export function startServer() {
  return new Promise((resolve, reject) => {
    const server = app.listen(env.PORT, env.HOST_BIND, () => {
      log.info(
        `Server listening on http://${env.HOST_BIND}:${env.PORT} [${env.NODE_ENV}] providers: ${env.STT_PROVIDER}/${env.LLM_PROVIDER}/${env.TTS_PROVIDER}`
      );
      resolve(server);
    });
    server.on("error", reject);
  });
}

const invokedDirectly = process.argv[1] && path.basename(process.argv[1]) === "server.js";

if (invokedDirectly) {
  const server = await startServer();

  const shutdown = signal => {
    log.info(`Received ${signal} — shutting down gracefully`);
    server.close(() => {
      log.info("Server closed");
      process.exit(0);
    });
    // Force-exit if connections refuse to close.
    setTimeout(() => process.exit(1), 10_000).unref();
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("unhandledRejection", reason => {
    log.error("Unhandled promise rejection", { reason: reason?.stack || String(reason) });
  });
  process.on("uncaughtException", err => {
    log.error("Uncaught exception — exiting", { stack: err?.stack, message: err?.message });
    process.exit(1);
  });

  // Restore any persisted sessions so a container restart preserves context.
  await loadPersistedSessions();
}

export default app;

/**
 * API routes for session lifecycle and the speech ↔ text pipeline.
 *
 * Each pipeline turn is wrapped in a per-session lock so overlapping requests
 * cannot interleave turns and corrupt the LLM context (see sessionManager).
 */
import express from "express";
import multer from "multer";
import { env } from "../config/env.js";
import { AppError } from "../services/AppError.js";
import { log } from "../services/logger.js";
import {
  createSession,
  getSession,
  addTurn,
  getMessagesForLLM,
  deleteSession,
  withSessionLock,
  sessionCount,
} from "../services/sessionManager.js";
import { transcribeAudio } from "../services/sttService.js";
import { getLLMResponse } from "../services/llmService.js";
import { synthesizeSpeech } from "../services/ttsService.js";
import { LANGUAGES, CONVERSATION_TYPES, LEVELS, TUTOR_STYLES } from "../config/languages.js";
import { assertSessionId } from "../utils/validate.js";

const router = express.Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 },
});

// Wraps async handlers so rejections reach the central error handler.
const asyncRoute = fn => (req, res, next) => fn(req, res, next).catch(next);

function requireSession(req) {
  assertSessionId(req.params.id);
  const session = getSession(req.params.id);
  if (!session) throw AppError.notFound("Session not found");
  return session;
}

// ─── Config endpoint (for the UI dropdowns) ──────────────────────────────────
router.get("/config", (req, res) => {
  res.json({ languages: LANGUAGES, conversationTypes: CONVERSATION_TYPES, levels: LEVELS, tutorStyles: TUTOR_STYLES });
});

// ─── Active session count ─────────────────────────────────────────────────────
router.get("/sessions", (req, res) => {
  res.json({ activeSessions: sessionCount(), maxSessions: env.MAX_SESSIONS });
});

// ─── Create a new session ────────────────────────────────────────────────────
router.post(
  "/session",
  asyncRoute(async (req, res) => {
    const session = createSession(req.body);
    res.json({ sessionId: session.id, config: session.config });
  })
);

// ─── Get session info ────────────────────────────────────────────────────────
router.get(
  "/session/:id",
  asyncRoute(async (req, res) => {
    const session = requireSession(req);
    res.json({
      sessionId: session.id,
      config: session.config,
      stats: session.stats,
      turnCount: session.turnCount,
      createdAt: session.createdAt,
      lastActivity: session.lastActivity,
    });
  })
);

// ─── Start session (get opening message from tutor) ──────────────────────────
router.post(
  "/session/:id/start",
  asyncRoute(async (req, res) => {
    const session = requireSession(req);
    const llmResult = await withSessionLock(session.id, async () => {
      await addTurn(session.id, "user", "START_SESSION");
      const { systemPrompt, messages } = getMessagesForLLM(session.id);
      const result = await getLLMResponse(systemPrompt, messages);
      await addTurn(session.id, "assistant", result.text);
      return result;
    });

    const ttsResult = await synthesizeSpeech(llmResult.text, session.config.targetLanguage);
    res.json({
      text: llmResult.text,
      audioUrl: `/api/audio/${ttsResult.audioId}`,
      mimeType: ttsResult.mimeType,
      provider: { llm: llmResult.provider, tts: ttsResult.provider },
    });
  })
);

// ─── Main pipeline: audio in → text → LLM → audio out ───────────────────────
router.post(
  "/session/:id/speak",
  upload.single("audio"),
  asyncRoute(async (req, res) => {
    const started = Date.now();
    const session = requireSession(req);
    if (!req.file) throw AppError.validation("No audio file uploaded");

    // Step 1: Speech-to-Text (no session mutation, safe outside the lock)
    const langInfo = LANGUAGES[session.config.targetLanguage];
    const whisperCode = session.config.targetLanguage === "auto" ? "auto" : langInfo?.whisperCode || "auto";
    const sttResult = await transcribeAudio(req.file.buffer, whisperCode);
    log.info("Pipeline step 1/3 done", { sessionId: session.id, ms: Date.now() - started });

    if (!sttResult.transcript || sttResult.transcript.trim().length < 2) {
      return res.json({
        transcript: "",
        text: "I didn't catch that — could you try again?",
        audioUrl: null,
        empty: true,
      });
    }

    // Step 2: LLM response (serialized per session so turns stay ordered)
    const llmResult = await withSessionLock(session.id, async () => {
      await addTurn(session.id, "user", sttResult.transcript);
      const { systemPrompt, messages } = getMessagesForLLM(session.id);
      const result = await getLLMResponse(systemPrompt, messages);
      await addTurn(session.id, "assistant", result.text);
      return result;
    });
    log.info("Pipeline step 2/3 done", { sessionId: session.id, ms: Date.now() - started });

    // Step 3: Text-to-Speech (disk cached per unique sentence)
    const ttsResult = await synthesizeSpeech(llmResult.text, session.config.targetLanguage);
    log.info("Pipeline done", { sessionId: session.id, ms: Date.now() - started });

    res.json({
      transcript: sttResult.transcript,
      text: llmResult.text,
      audioUrl: `/api/audio/${ttsResult.audioId}`,
      mimeType: ttsResult.mimeType,
      timing: { total: Date.now() - started },
      providers: { stt: sttResult.provider, llm: llmResult.provider, tts: ttsResult.provider },
    });
  })
);

// ─── Text input (fallback for testing without mic) ───────────────────────────
router.post(
  "/session/:id/text",
  asyncRoute(async (req, res) => {
    const session = requireSession(req);
    const { message } = req.body;
    if (!message || typeof message !== "string" || !message.trim()) {
      throw AppError.validation("No message provided");
    }

    const llmResult = await withSessionLock(session.id, async () => {
      await addTurn(session.id, "user", message);
      const { systemPrompt, messages } = getMessagesForLLM(session.id);
      const result = await getLLMResponse(systemPrompt, messages);
      await addTurn(session.id, "assistant", result.text);
      return result;
    });

    const ttsResult = await synthesizeSpeech(llmResult.text, session.config.targetLanguage);

    res.json({
      transcript: message,
      text: llmResult.text,
      audioUrl: `/api/audio/${ttsResult.audioId}`,
      mimeType: ttsResult.mimeType,
      provider: { llm: llmResult.provider, tts: ttsResult.provider },
    });
  })
);

// ─── Delete session ───────────────────────────────────────────────────────────
router.delete(
  "/session/:id",
  asyncRoute(async (req, res) => {
    requireSession(req);
    await deleteSession(req.params.id);
    res.json({ ok: true });
  })
);

export default router;

import { v4 as uuidv4 } from "uuid";
import { AsyncLocalStorage } from "async_hooks";
import fsp from "fs/promises";
import path from "path";
import { env } from "../config/env.js";
import { buildSystemPrompt } from "../prompts/tutorPrompt.js";
import { validateSessionConfig } from "../utils/validate.js";
import { trimHistory } from "../utils/tokens.js";
import { AppError } from "./AppError.js";
import { log } from "./logger.js";

const sessions = new Map();
const locks = new Map(); // sessionId -> tail promise (per-session mutex)
const lockContext = new AsyncLocalStorage();

const PERSIST_DIR = env.SESSION_PERSIST_DIR || null;

function persistPath(id) {
  return path.join(PERSIST_DIR, `${id}.json`);
}

async function persistSession(session) {
  if (!PERSIST_DIR) return;
  try {
    await fsp.mkdir(PERSIST_DIR, { recursive: true });
    await fsp.writeFile(persistPath(session.id), JSON.stringify(session));
  } catch (err) {
    log.warn("Session persist failed", { id: session.id, message: err.message });
  }
}

async function removePersistedSession(id) {
  if (!PERSIST_DIR) return;
  try {
    await fsp.unlink(persistPath(id));
  } catch {
    // file may not exist
  }
}

export function getSession(id) {
  return sessions.get(id) || null;
}

export function updateSession(id, updates) {
  const session = sessions.get(id);
  if (!session) return null;
  Object.assign(session, updates);
  session.lastActivity = Date.now();
  return session;
}

/**
 * Runs `fn` exclusively for a session: overlapping calls for the same session
 * execute in order. Mutations performed inside the lock do not re-acquire it.
 */
export function withSessionLock(sessionId, fn) {
  const prev = locks.get(sessionId) || Promise.resolve();
  const run = prev.then(
    () => lockContext.run({ sessionId }, fn),
    () => lockContext.run({ sessionId }, fn)
  );
  const tail = run.catch(() => {});
  locks.set(sessionId, tail);
  tail.finally(() => {
    if (locks.get(sessionId) === tail) locks.delete(sessionId);
  });
  return run;
}

function mutateTurn(session, role, content) {
  session.history.push({ role, content: String(content) });
  session.lastActivity = Date.now();
  session.turnCount++;
  if (role === "user") session.stats.totalTurns++;

  // Bounded history for memory; token-level trimming happens in getMessagesForLLM.
  const maxEntries = Math.max(env.SESSION_MAX_HISTORY * 2, 4);
  if (session.history.length > maxEntries) {
    const firstTwo = session.history.slice(0, 2);
    const recent = session.history.slice(-(maxEntries - 2));
    session.history = [...firstTwo, ...recent];
  }
}

export async function createSession(inputConfig) {
  if (sessions.size >= env.MAX_SESSIONS) {
    throw AppError.rateLimited("Too many active sessions. End an existing session first.");
  }

  const config = validateSessionConfig(inputConfig);
  const session = {
    id: uuidv4(),
    createdAt: Date.now(),
    lastActivity: Date.now(),
    config,
    history: [],
    turnCount: 0,
    stats: {
      totalTurns: 0,
      errorsFound: 0,
      vocabTips: 0,
    },
    systemPrompt: buildSystemPrompt(config),
  };

  sessions.set(session.id, session);
  await persistSession(session);
  log.info("Session created", {
    sessionId: session.id,
    targetLanguage: config.targetLanguage,
    conversationType: config.conversationType,
    level: config.level,
  });
  return session;
}

/**
 * Appends a turn. Serialized per session — safe to call concurrently.
 */
export async function addTurn(sessionId, role, content) {
  const session = sessions.get(sessionId);
  if (!session) throw AppError.notFound("Session not found");

  const store = lockContext.getStore();
  if (store && store.sessionId === sessionId) {
    mutateTurn(session, role, content);
    await persistSession(session);
    return session;
  }

  return withSessionLock(sessionId, async () => {
    const s = sessions.get(sessionId);
    if (!s) throw AppError.notFound("Session not found");
    mutateTurn(s, role, content);
    await persistSession(s);
    return s;
  });
}

export function getMessagesForLLM(sessionId) {
  const session = sessions.get(sessionId);
  if (!session) return { systemPrompt: "", messages: [] };
  const trimmed = trimHistory(session.history, session.systemPrompt, env.LLM_MAX_HISTORY_TOKENS);
  return {
    systemPrompt: session.systemPrompt,
    messages: trimmed.messages,
    config: session.config,
  };
}

export async function deleteSession(id) {
  sessions.delete(id);
  locks.delete(id);
  await removePersistedSession(id);
}

export function sessionCount() {
  return sessions.size;
}

export async function loadPersistedSessions() {
  if (!PERSIST_DIR) return 0;
  let files;
  try {
    files = await fsp.readdir(PERSIST_DIR);
  } catch {
    return 0;
  }

  const cutoff = Date.now() - env.SESSION_TTL_MS;
  let loaded = 0;
  for (const f of files) {
    if (!f.endsWith(".json")) continue;
    const filePath = path.join(PERSIST_DIR, f);
    try {
      const raw = JSON.parse(await fsp.readFile(filePath, "utf8"));
      if (!raw?.id || !Array.isArray(raw.history)) throw new Error("malformed session file");
      if (Date.parse(raw.lastActivity) < cutoff) {
        await fsp.unlink(filePath).catch(() => {});
        continue;
      }
      sessions.set(raw.id, raw);
      loaded++;
    } catch (err) {
      log.warn("Skipping corrupt session file", { file: f, message: err.message });
      await fsp.unlink(filePath).catch(() => {});
    }
  }
  if (loaded > 0) log.info(`Loaded ${loaded} persisted session(s)`);
  return loaded;
}

// ─── Cleanup ────────────────────────────────────────────────────────────────
const cleanupTimer = setInterval(() => {
  const cutoff = Date.now() - env.SESSION_TTL_MS;
  for (const [id, session] of sessions) {
    if (Date.parse(session.lastActivity) < cutoff) {
      sessions.delete(id);
      locks.delete(id);
      removePersistedSession(id);
    }
  }
}, env.SESSION_CLEANUP_MS);
cleanupTimer.unref();

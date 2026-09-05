import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fsp from "fs/promises";
import os from "os";
import path from "path";

// Isolated env for the session store BEFORE importing it.
const TMP = path.join(os.tmpdir(), `lingua-sessions-${Date.now()}`);
process.env.SESSION_PERSIST_DIR = TMP;
process.env.MAX_SESSIONS = "3";
process.env.SESSION_MAX_HISTORY = "12"; // large enough to not interfere with turn tests
process.env.LLM_MAX_HISTORY_TOKENS = "900";

const sm = await import("../services/sessionManager.js");

const created = [];
function make(config) {
  const session = sm.createSession(config);
  created.push(session.id);
  return session;
}

beforeEach(async () => {
  await fsp.mkdir(TMP, { recursive: true });
});

afterEach(async () => {
  // Clear all sessions created during this test so MAX_SESSIONS starts at 0.
  for (const id of created) await sm.deleteSession(id);
  created.length = 0;
  await fsp.rm(TMP, { recursive: true, force: true });
});

test("createSession applies defaults and normalizes config", () => {
  const session = make({});
  assert.ok(session.id);
  assert.equal(session.turnCount, 0);
  assert.equal(session.config.targetLanguage, "de");
  assert.equal(session.config.subtype, "general");
  assert.ok(session.systemPrompt.includes("LINGUA"));
});

test("createSession rejects wrong config via VALIDATION error", () => {
  assert.throws(
    () => sm.createSession({ targetLanguage: "xx" }),
    err => err.code === "VALIDATION"
  );
});

test("createSession enforces MAX_SESSIONS", () => {
  make({});
  make({});
  make({});
  assert.throws(
    () => sm.createSession({}),
    err => err.code === "RATE_LIMITED"
  );
});

test("addTurn serializes turns: history follows call order", async () => {
  const session = make({});
  const tasks = [];
  for (let i = 0; i < 10; i++) {
    tasks.push(sm.addTurn(session.id, i % 2 === 0 ? "user" : "assistant", `message ${i}`));
  }
  await Promise.all(tasks);
  const info = sm.getSession(session.id);
  assert.equal(info.history.length, 10);
  assert.deepEqual(
    info.history.map(m => m.content),
    Array.from({ length: 10 }, (_, i) => `message ${i}`)
  );
});

test("withSessionLock serializes a full LLM round trip", async () => {
  const session = make({});
  const order = [];
  await Promise.all(
    Array.from({ length: 5 }, (_, i) =>
      sm.withSessionLock(session.id, async () => {
        order.push(`start${i}`);
        await new Promise(r => setTimeout(r, Math.random() * 10));
        order.push(`end${i}`);
      })
    )
  );
  // Each startX must be immediately followed by endX (no interleaving).
  for (let i = 0; i < 5; i++) {
    assert.equal(order[i * 2].startsWith("start"), true);
    assert.ok(order[i * 2 + 1].startsWith("end"));
  }
});

test("token-aware trimming keeps history within LLM_MAX_HISTORY_TOKENS", async () => {
  const session = make({});
  // 10 long messages — only a subset should survive into LLM context.
  for (let i = 0; i < 10; i++) {
    await sm.addTurn(session.id, i % 2 === 0 ? "user" : "assistant", "Wort ".repeat(80));
  }
  const { messages, systemPrompt } = sm.getMessagesForLLM(session.id);
  assert.ok(messages.length < 10);
  assert.ok(messages.length >= 1);
  assert.ok(systemPrompt.length > 0);
});

test("deleteSession removes the session (and persisted file)", async () => {
  const session = make({});
  await sm.deleteSession(session.id);
  assert.equal(sm.getSession(session.id), null);
});

test("addTurn throws SESSION_NOT_FOUND for unknown id", async () => {
  await assert.rejects(
    () => sm.addTurn("00000000-0000-0000-0000-000000000000", "user", "x"),
    err => {
      assert.equal(err.code, "SESSION_NOT_FOUND");
      return true;
    }
  );
});

test("loadPersistedSessions restores persisted sessions", async () => {
  make({ targetLanguage: "fr", conversationType: "daily_life" });
  // give the async persist a beat to flush
  await new Promise(r => setTimeout(r, 50));
  const loaded = await sm.loadPersistedSessions();
  assert.ok(loaded >= 1);
});

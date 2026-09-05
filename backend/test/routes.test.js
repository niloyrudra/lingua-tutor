import { test, after } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import os from "os";
import path from "path";

// Isolated env BEFORE importing the app.
process.env.NODE_ENV = "test";
const TMP = path.join(os.tmpdir(), `lingua-routes-${Date.now()}`);
process.env.AUDIO_CACHE_DIR = TMP;
process.env.LLM_TIMEOUT_MS = "5000";
process.env.STT_TIMEOUT_MS = "5000";
process.env.TTS_TIMEOUT_MS = "5000";

const SAMPLE_AUDIO = Buffer.from("RIFF----WAVEfmt ");
const STUB_LLM_TEXT = "Hallo! Wie geht es dir?";

// Stub out all outbound fetch calls (Ollama, Whisper, TTS):
globalThis.fetch = async url => {
  const u = String(url);
  if (u.includes("/api/chat")) {
    return new Response(JSON.stringify({ message: { content: STUB_LLM_TEXT } }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }
  if (u.includes("/synthesize")) {
    return new Response(SAMPLE_AUDIO, { status: 200, headers: { "Content-Type": "audio/wav" } });
  }
  if (u.includes("/health") || u.includes("/api/tags")) {
    return new Response(JSON.stringify({ status: "ok" }), { status: 200 });
  }
  throw new Error(`Unexpected fetch: ${u}`);
};

const { default: app } = await import("../server.js");

let createdSessionId;

test("GET /health reports okay", async () => {
  const res = await request(app).get("/health");
  assert.equal(res.status, 200);
  assert.equal(res.body.status, "ok");
});

test("GET /api/config exposes catalogs", async () => {
  const res = await request(app).get("/api/config");
  assert.equal(res.status, 200);
  assert.ok(res.body.languages.de);
  assert.ok(res.body.conversationTypes.job_interview);
  assert.ok(res.body.levels.b1);
  assert.ok(res.body.tutorStyles.encouraging);
});

test("POST /api/session creates a session", async () => {
  const res = await request(app).post("/api/session").send({ targetLanguage: "de" });
  assert.equal(res.status, 200);
  assert.ok(res.body.sessionId);
  createdSessionId = res.body.sessionId;
});

test("POST /api/session rejects invalid config with 400", async () => {
  const res = await request(app).post("/api/session").send({ targetLanguage: "xx" });
  assert.equal(res.status, 400);
  assert.ok(res.body.error);
});

test("GET /api/session/:id returns session info", async () => {
  const res = await request(app).get(`/api/session/${createdSessionId}`);
  assert.equal(res.status, 200);
  assert.equal(res.body.sessionId, createdSessionId);
  assert.equal(res.body.config.targetLanguage, "de");
});

test("GET /api/session/unknown returns 404 JSON", async () => {
  const res = await request(app).get("/api/session/00000000-0000-0000-0000-000000000000");
  assert.equal(res.status, 404);
  assert.equal(res.body.error, "Session not found");
});

test("POST /api/session/:id/start returns text + audioUrl", async () => {
  const res = await request(app).post(`/api/session/${createdSessionId}/start`);
  assert.equal(res.status, 200);
  assert.equal(res.body.text, STUB_LLM_TEXT);
  assert.match(res.body.audioUrl, /^\/api\/audio\/[0-9a-f]{40}$/);

  // Audio is now served from the cache.
  const audio = await request(app).get(res.body.audioUrl);
  assert.equal(audio.status, 200);
  assert.equal(audio.headers["content-type"], "audio/wav");
});

test("POST /api/session/:id/text appends a turn", async () => {
  const res = await request(app).post(`/api/session/${createdSessionId}/text`).send({ message: "Mir geht es gut" });
  assert.equal(res.status, 200);
  assert.equal(res.body.text, STUB_LLM_TEXT);
  assert.match(res.body.audioUrl, /^\/api\/audio\/[0-9a-f]{40}$/);
});

test("POST /api/session/:id/text rejects empty message", async () => {
  const res = await request(app).post(`/api/session/${createdSessionId}/text`).send({ message: "  " });
  assert.equal(res.status, 400);
});

test("GET /api/audio/bad-id returns 404", async () => {
  const res = await request(app).get("/api/audio/bad-id");
  assert.equal(res.status, 404);
});

test("unknown /api route returns JSON 404 (not HTML)", async () => {
  const res = await request(app).get("/api/nope");
  assert.equal(res.status, 404);
  assert.ok(res.body.error);
});

test("SPA fallback serves index.html for non-API routes", async () => {
  const res = await request(app).get("/something/page");
  assert.equal(res.status, 200);
  assert.match(res.text, /Lingua Tutor/);
});

test("security headers are present", async () => {
  const res = await request(app).get("/api/config");
  assert.ok(res.headers["x-content-type-options"] === "nosniff");
  assert.ok(res.headers["content-security-policy"]);
});

after(async () => {
  // afte removes; ensure temp cleanup
  const { rm } = await import("fs/promises");
  await rm(TMP, { recursive: true, force: true });
});

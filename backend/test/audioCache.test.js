import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fsp from "fs/promises";
import os from "os";
import path from "path";

// Point the cache at a temp directory BEFORE importing the module.
const TMP = path.join(os.tmpdir(), `lingua-audio-cache-${Date.now()}`);
process.env.AUDIO_CACHE_DIR = TMP;
process.env.AUDIO_CACHE_MAX_BYTES = (8 * 1024).toString();

const { hashAudio, lookupAudio, storeAudio } = await import("../services/audioCache.js");

beforeEach(async () => {
  await fsp.mkdir(TMP, { recursive: true });
});
afterEach(async () => {
  await fsp.rm(TMP, { recursive: true, force: true });
});

test("hashAudio is deterministic and input-sensitive", () => {
  const a = hashAudio("Hallo", "de", null, 1.0);
  const b = hashAudio("Hallo", "de", null, 1.0);
  const c = hashAudio("Hallo!", "de", null, 1.0);
  assert.equal(a, b);
  assert.notEqual(a, c);
  assert.match(a, /^[0-9a-f]{40}$/);
});

test("store then lookup round-trips audio", async () => {
  const key = hashAudio("Guten Morgen", "de", null, 1.0);
  await storeAudio(key, Buffer.from("RIFF...."), "audio/wav", "local");
  const hit = await lookupAudio(key);
  assert.ok(hit);
  assert.equal(hit.mimeType, "audio/wav");
  assert.equal(hit.provider, "local");
  assert.equal(hit.buffer.toString(), "RIFF....");
});

test("lookup misses for unknown key", async () => {
  assert.equal(await lookupAudio("a".repeat(40)), null);
});

test("pruneAudioCache removes oldest files past the byte budget", async () => {
  for (let i = 0; i < 12; i++) {
    await storeAudio(hashAudio(`sentence number ${i}`, "de", null, 1.0), Buffer.alloc(1024, i), "audio/wav", "local");
  }
  // 12 pairs (24 files ≈ 13KB) would be stored, but the 8KB budget forces
  // eviction — only the most recent pairs should survive.
  const files = await fsp.readdir(TMP);
  assert.ok(files.length >= 2, "at least one pair should remain");
  assert.ok(files.length < 24, "oldest files should have been pruned");
});

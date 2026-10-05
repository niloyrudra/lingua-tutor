/**
 * Disk-persisted TTS audio cache.
 *
 * Synthesizing the same tutor sentence twice is pure waste (both for compute
 * time and for the user's patience): the TTS engines are deterministic for a
 * fixed (text, language, voice, speed) input. We key on a SHA-1 of those
 * inputs and store the audio + metadata as files on disk so cold pipeline
 * turns become cache hits.
 */
import crypto from "crypto";
import fsp from "fs/promises";
import path from "path";
import { env, DATA_DIR } from "../config/env.js";
import { log } from "./logger.js";

const CACHE_DIR = env.AUDIO_CACHE_DIR || path.join(DATA_DIR, "audio-cache");
const MAX_BYTES = env.AUDIO_CACHE_MAX_BYTES;

export function hashAudio(text, language, voice, speed) {
  return crypto
    .createHash("sha1")
    .update(`${text}|${language || ""}|${voice || ""}|${speed ?? 1}`)
    .digest("hex");
}

export function cacheFileFor(key) {
  return path.join(CACHE_DIR, `${key}.bin`);
}

function metaFileFor(key) {
  return path.join(CACHE_DIR, `${key}.json`);
}

async function ensureCacheDir() {
  await fsp.mkdir(CACHE_DIR, { recursive: true });
}

/**
 * @param {string} key sha1 hex
 * @returns {Promise<{buffer: Buffer, mimeType: string, provider: string}|null>}
 */
export async function lookupAudio(key) {
  try {
    const [buffer, metaRaw] = await Promise.all([
      fsp.readFile(cacheFileFor(key)),
      fsp.readFile(metaFileFor(key), "utf8"),
    ]);
    const meta = JSON.parse(metaRaw);
    return { buffer, mimeType: meta.mimeType || "audio/wav", provider: meta.provider || "local" };
  } catch {
    return null;
  }
}

export async function storeAudio(key, buffer, mimeType, provider) {
  try {
    await ensureCacheDir();
    await Promise.all([
      fsp.writeFile(cacheFileFor(key), buffer),
      fsp.writeFile(metaFileFor(key), JSON.stringify({ mimeType, provider, createdAt: Date.now() })),
    ]);
  } catch (err) {
    log.warn("Audio cache write failed", { message: err.message });
  }
}

/**
 * LRU eviction by mtime until the cache directory is within MAX_BYTES.
 */
async function pruneAudioCache() {
  let files;
  try {
    files = await fsp.readdir(CACHE_DIR);
  } catch {
    return;
  }

  const infos = (
    await Promise.all(
      files.map(async f => {
        try {
          const st = await fsp.stat(path.join(CACHE_DIR, f));
          return { f, size: st.size, mtime: st.mtimeMs };
        } catch {
          return null;
        }
      })
    )
  ).filter(Boolean);

  let total = infos.reduce((s, i) => s + i.size, 0);
  if (total <= MAX_BYTES) return;

  infos.sort((a, b) => a.mtime - b.mtime);
  for (const item of infos) {
    if (total <= MAX_BYTES) break;
    try {
      await fsp.unlink(path.join(CACHE_DIR, item.f));
      total -= item.size;
    } catch {
      // ignore concurrent deletion
    }
  }
}

// Run pruning periodically (every 5 minutes) instead of on every write
const PRUNE_INTERVAL_MS = 5 * 60 * 1000;
const pruneTimer = setInterval(() => {
  pruneAudioCache().catch(err => log.warn("Audio cache prune failed", { message: err.message }));
}, PRUNE_INTERVAL_MS);
pruneTimer.unref();

export { pruneAudioCache };

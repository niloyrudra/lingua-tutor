/**
 * GET /api/audio/:id — serves previously cached TTS audio with immutable
 * cache headers. The client fetches this URL instead of decoding base64 in JS.
 */
import { Router } from "express";
import { lookupAudio } from "../services/audioCache.js";

const router = Router();

router.get("/:id", async (req, res, next) => {
  try {
    const { id } = req.params;
    if (!/^[0-9a-f]{40}$/i.test(id)) return res.status(404).json({ error: "Audio not found" });

    const audio = await lookupAudio(id);
    if (!audio) return res.status(404).json({ error: "Audio not found" });

    res.set("Content-Type", audio.mimeType);
    res.set("Cache-Control", "public, max-age=31536000, immutable");
    res.send(audio.buffer);
  } catch (err) {
    next(err);
  }
});

export default router;

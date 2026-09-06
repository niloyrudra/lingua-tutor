"""
TTS Microservice

Engine routing:
  - Piper binary (piper-bin): primary for ALL languages — real native-speaker models
  - Kokoro: fallback for ES/FR/IT/PT/JA/ZH
  - edge-tts: last resort
"""

import os
os.environ.setdefault("COQUI_TOS_AGREED", "1")

import io, asyncio, logging, re, random, subprocess, tempfile
from contextlib import asynccontextmanager
from fastapi import FastAPI, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel

logging.basicConfig(level=logging.INFO)
log = logging.getLogger("tts-service")

VOICES_DIR = os.getenv("PIPER_VOICES_DIR", "/app/voices")
PIPER_BIN  = os.getenv("PIPER_BIN", "/usr/local/bin/piper-bin")
DEFAULT_SPEED = float(os.getenv("TTS_SPEED", "1.0"))
TTS_CONCURRENCY = int(os.getenv("TTS_CONCURRENCY", "1"))
_tts_semaphore = asyncio.Semaphore(TTS_CONCURRENCY)

# ── Piper voice map ───────────────────────────────────────────────────────────
PIPER_VOICES = {
    "de": ["de_DE-thorsten-high",   "de_DE-thorsten-medium"],
    "fr": ["fr_FR-siwis-medium",    "fr_FR-siwis-low"],
    "es": ["es_ES-sharvard-medium"],
    "it": ["it_IT-riccardo-x_low"],
    "pt": ["pt_PT-tugao-medium"],
    "nl": ["nl_NL-mls-medium"],
    "ja": ["ja_JP-kokoro-medium"],
    "zh": ["zh_CN-huayan-medium"],
    "en": ["en_US-lessac-high",     "en_US-amy-medium"],
}

# HuggingFace path map for on-demand download
PIPER_HF_PATHS = {
    "de_DE-thorsten-high":   "de/de_DE/thorsten/high",
    "de_DE-thorsten-medium": "de/de_DE/thorsten/medium",
    "fr_FR-siwis-medium":    "fr/fr_FR/siwis/medium",
    "fr_FR-siwis-low":       "fr/fr_FR/siwis/low",
    "es_ES-sharvard-medium": "es/es_ES/sharvard/medium",
    "it_IT-riccardo-x_low":  "it/it_IT/riccardo/x_low",
    "pt_PT-tugao-medium":    "pt/pt_PT/tugao/medium",
    "nl_NL-mls-medium":      "nl/nl_NL/mls/medium",
    "ja_JP-kokoro-medium":   "ja/ja_JP/kokoro/medium",
    "zh_CN-huayan-medium":   "zh/zh_CN/huayan/medium",
    "en_US-lessac-high":     "en/en_US/lessac/high",
    "en_US-amy-medium":      "en/en_US/amy/medium",
}

# ── Kokoro ────────────────────────────────────────────────────────────────────
try:
    from kokoro import KPipeline
    import numpy as np
    import soundfile as sf
    KOKORO_AVAILABLE = True
    log.info("Kokoro available ✓")
except ImportError:
    KOKORO_AVAILABLE = False

KOKORO_CONFIG = {
    "fr": ("f", "ff_siwis"),
    "es": ("e", "ef_dora"),
    "it": ("i", "if_sara"),
    "pt": ("p", "pf_dora"),
    "ja": ("j", "jf_alpha"),
    "zh": ("z", "zf_xiaobei"),
    "en": ("a", "af_heart"),
}

_kokoro_pipelines = {}
def get_kokoro_pipeline(lc):
    if lc not in _kokoro_pipelines:
        _kokoro_pipelines[lc] = KPipeline(lang_code=lc)
    return _kokoro_pipelines[lc]

# ── edge-tts ──────────────────────────────────────────────────────────────────
try:
    import edge_tts
    EDGE_TTS_AVAILABLE = True
    log.info("edge-tts available ✓")
except ImportError:
    EDGE_TTS_AVAILABLE = False

EDGE_VOICES = {
    "de": "de-DE-KatjaNeural", "fr": "fr-FR-DeniseNeural",
    "es": "es-ES-ElviraNeural","it": "it-IT-ElsaNeural",
    "pt": "pt-PT-RaquelNeural","nl": "nl-NL-ColetteNeural",
    "ja": "ja-JP-NanamiNeural","zh": "zh-CN-XiaoxiaoNeural",
    "en": "en-US-AriaNeural",
}

# Voice metadata with gender info for UI
VOICE_METADATA = {
    "de_DE-thorsten-high":   {"language": "de", "gender": "male",   "engine": "piper", "quality": "high"},
    "de_DE-thorsten-medium": {"language": "de", "gender": "male",   "engine": "piper", "quality": "medium"},
    "fr_FR-siwis-medium":    {"language": "fr", "gender": "female", "engine": "piper", "quality": "medium"},
    "fr_FR-siwis-low":       {"language": "fr", "gender": "female", "engine": "piper", "quality": "low"},
    "es_ES-sharvard-medium": {"language": "es", "gender": "male",   "engine": "piper", "quality": "medium"},
    "it_IT-riccardo-x_low":  {"language": "it", "gender": "male",   "engine": "piper", "quality": "x_low"},
    "pt_PT-tugao-medium":    {"language": "pt", "gender": "male",   "engine": "piper", "quality": "medium"},
    "nl_NL-mls-medium":      {"language": "nl", "gender": "unknown","engine": "piper", "quality": "medium"},
    "ja_JP-kokoro-medium":   {"language": "ja", "gender": "female", "engine": "piper", "quality": "medium"},
    "zh_CN-huayan-medium":   {"language": "zh", "gender": "female", "engine": "piper", "quality": "medium"},
    "en_US-lessac-high":     {"language": "en", "gender": "male",   "engine": "piper", "quality": "high"},
    "en_US-amy-medium":      {"language": "en", "gender": "female", "engine": "piper", "quality": "medium"},
    "de-DE-KatjaNeural":     {"language": "de", "gender": "female", "engine": "edge-tts", "quality": "neural"},
    "fr-FR-DeniseNeural":    {"language": "fr", "gender": "female", "engine": "edge-tts", "quality": "neural"},
    "es-ES-ElviraNeural":    {"language": "es", "gender": "female", "engine": "edge-tts", "quality": "neural"},
    "it-IT-ElsaNeural":      {"language": "it", "gender": "female", "engine": "edge-tts", "quality": "neural"},
    "pt-PT-RaquelNeural":    {"language": "pt", "gender": "female", "engine": "edge-tts", "quality": "neural"},
    "nl-NL-ColetteNeural":   {"language": "nl", "gender": "female", "engine": "edge-tts", "quality": "neural"},
    "ja-JP-NanamiNeural":    {"language": "ja", "gender": "female", "engine": "edge-tts", "quality": "neural"},
    "zh-CN-XiaoxiaoNeural":  {"language": "zh", "gender": "female", "engine": "edge-tts", "quality": "neural"},
    "en-US-AriaNeural":      {"language": "en", "gender": "female", "engine": "edge-tts", "quality": "neural"},
}

def get_available_voices(language: str | None = None) -> list[dict]:
    """Return available voices, optionally filtered by language."""
    voices = []
    
    # Piper voices (cached locally)
    for voice_stem in _list_voices():
        meta = VOICE_METADATA.get(voice_stem, {})
        if language and meta.get("language") != language:
            continue
        voices.append({
            "id": voice_stem,
            "name": voice_stem.replace("_", " ").replace("-", " ").title(),
            "language": meta.get("language", language or "unknown"),
            "gender": meta.get("gender", "unknown"),
            "engine": "piper",
            "quality": meta.get("quality", "unknown"),
            "available": True,
        })
    
    # edge-tts voices (always available if engine loaded)
    if EDGE_TTS_AVAILABLE:
        for voice_id, meta in VOICE_METADATA.items():
            if meta.get("engine") != "edge-tts":
                continue
            if language and meta.get("language") != language:
                continue
            # Avoid duplicates if already listed from Piper
            if any(v["id"] == voice_id for v in voices):
                continue
            voices.append({
                "id": voice_id,
                "name": voice_id.replace("-", " ").replace("Neural", "").title(),
                "language": meta.get("language"),
                "gender": meta.get("gender"),
                "engine": "edge-tts",
                "quality": "neural",
                "available": True,
            })
    
    return voices

# ── Startup ───────────────────────────────────────────────────────────────────
@asynccontextmanager
async def lifespan(app: FastAPI):
    # Verify piper binary exists
    if os.path.exists(PIPER_BIN):
        log.info(f"Piper binary found: {PIPER_BIN} ✓")
    else:
        log.warning(f"Piper binary NOT found at {PIPER_BIN}")

    # List available voices
    voices = _list_voices()
    log.info(f"Piper voices cached: {voices}")

    if KOKORO_AVAILABLE:
        for lang, (lc, voice) in list(KOKORO_CONFIG.items())[:2]:
            try:
                pipe = get_kokoro_pipeline(lc)
                for _ in pipe("Hi.", voice=voice, speed=1.0): break
                log.info(f"Kokoro warm ✓ {lang}")
            except Exception as e:
                log.warning(f"Kokoro warm failed {lang}: {e}")
    yield

app = FastAPI(title="Lingua TTS", lifespan=lifespan)

class TTSRequest(BaseModel):
    text: str
    language: str = "de"
    voice: str | None = None
    speed: float = 1.0

# ── Helpers ───────────────────────────────────────────────────────────────────
def clean_text(text: str) -> str:
    text = re.sub(r'\*\*(.*?)\*\*', r'\1', text)
    text = re.sub(r'\*(.*?)\*',     r'\1', text)
    text = re.sub(r'`(.*?)`',       r'\1', text)
    text = re.sub(r'💡.*$', '', text, flags=re.MULTILINE)
    text = re.sub(r'━+', '', text)
    text = re.sub(r'\[(CORRECTION|RESPONSE|CONTINUE|VOCAB TIP)\]', '', text, flags=re.IGNORECASE)
    text = re.sub(r'\n+', ' ', text).strip()
    return text

def _list_voices():
    if not os.path.isdir(VOICES_DIR):
        return []
    return [f.replace(".onnx","") for f in os.listdir(VOICES_DIR) if f.endswith(".onnx")]

def _ensure_voice(voice_stem: str) -> bool:
    onnx = os.path.join(VOICES_DIR, f"{voice_stem}.onnx")
    json = os.path.join(VOICES_DIR, f"{voice_stem}.onnx.json")
    if os.path.exists(onnx) and os.path.exists(json):
        return True
    return _download_voice(voice_stem)

def _download_voice(voice_stem: str) -> bool:
    import urllib.request
    path = PIPER_HF_PATHS.get(voice_stem)
    if not path:
        log.warning(f"No HF path known for voice: {voice_stem}")
        return False
    BASE = "https://huggingface.co/rhasspy/piper-voices/resolve/main"
    os.makedirs(VOICES_DIR, exist_ok=True)
    onnx_out = os.path.join(VOICES_DIR, f"{voice_stem}.onnx")
    json_out = os.path.join(VOICES_DIR, f"{voice_stem}.onnx.json")
    try:
        log.info(f"Downloading Piper voice: {voice_stem}")
        urllib.request.urlretrieve(f"{BASE}/{path}/{voice_stem}.onnx",      onnx_out)
        urllib.request.urlretrieve(f"{BASE}/{path}/{voice_stem}.onnx.json", json_out)
        log.info(f"Downloaded: {voice_stem} ✓")
        return True
    except Exception as e:
        log.warning(f"Failed to download {voice_stem}: {e}")
        for f in [onnx_out, json_out]:
            if os.path.exists(f): os.unlink(f)
        return False

# ── Piper synthesis via binary ────────────────────────────────────────────────
def synth_piper(text: str, language: str, speed: float) -> tuple[bytes, str]:
    if not os.path.exists(PIPER_BIN):
        raise RuntimeError(f"Piper binary not found at {PIPER_BIN}")

    candidates = PIPER_VOICES.get(language, PIPER_VOICES["en"])

    for voice_stem in candidates:
        if not _ensure_voice(voice_stem):
            log.warning(f"Could not get voice {voice_stem}, trying next")
            continue

        onnx = os.path.join(VOICES_DIR, f"{voice_stem}.onnx")
        json = os.path.join(VOICES_DIR, f"{voice_stem}.onnx.json")
        length_scale = str(round(1.0 / speed, 2))

        try:
            # Piper reads text from stdin and outputs raw WAV to stdout
            result = subprocess.run(
                [
                    PIPER_BIN,
                    "--model",        onnx,
                    "--config",       json,
                    "--output-raw",            # raw PCM to stdout
                    "--length-scale",  length_scale,
                    "--sentence-silence", "0.3",
                ],
                input=text.encode("utf-8"),
                capture_output=True,
                timeout=60,
            )

            if result.returncode != 0:
                err = result.stderr.decode("utf-8", errors="replace")
                raise RuntimeError(f"Piper exited {result.returncode}: {err[:300]}")

            raw_pcm = result.stdout
            if len(raw_pcm) < 1000:
                raise RuntimeError(f"Piper output too small: {len(raw_pcm)} bytes")

            # Wrap raw PCM (16-bit, 22050Hz mono) in a WAV container
            wav_buf = io.BytesIO()
            import wave as wave_mod
            with wave_mod.open(wav_buf, 'wb') as wf:
                wf.setnchannels(1)
                wf.setsampwidth(2)       # 16-bit
                wf.setframerate(22050)   # piper default sample rate
                wf.writeframes(raw_pcm)

            wav_bytes = wav_buf.getvalue()
            log.info(f"Piper OK voice={voice_stem} pcm={len(raw_pcm)} wav={len(wav_bytes)}")
            return wav_bytes, "audio/wav"

        except Exception as e:
            log.warning(f"Piper voice={voice_stem} failed: {e}")
            continue

    raise RuntimeError(f"All Piper voices failed for language={language}")

# ── Kokoro synthesis ──────────────────────────────────────────────────────────
def synth_kokoro(text: str, language: str, speed: float) -> tuple[bytes, str]:
    if language not in KOKORO_CONFIG:
        raise RuntimeError(f"Kokoro has no native voice for {language}")
    lc, voice = KOKORO_CONFIG[language]
    pipeline  = get_kokoro_pipeline(lc)
    samples   = [a for _, _, a in pipeline(text, voice=voice, speed=speed, split_pattern=r'[.!?]+')]
    if not samples:
        raise RuntimeError("Kokoro produced no audio")
    audio_np = np.concatenate(samples)
    buf = io.BytesIO()
    sf.write(buf, audio_np, 24000, format="WAV")
    buf.seek(0)
    log.info(f"Kokoro OK lang={lc} voice={voice}")
    return buf.read(), "audio/wav"

# ── edge-tts synthesis ────────────────────────────────────────────────────────
async def synth_edge(text: str, language: str, speed: float) -> tuple[bytes, str]:
    voice_id = EDGE_VOICES.get(language, "en-US-AriaNeural")
    rate_str = f"+{int((speed-1)*100)}%"
    last_err = None
    for attempt in range(3):
        try:
            communicate = edge_tts.Communicate(text, voice_id, rate=rate_str)
            chunks = [c["data"] async for c in communicate.stream() if c["type"] == "audio"]
            if chunks:
                return b"".join(chunks), "audio/mpeg"
            raise RuntimeError("Empty audio")
        except Exception as e:
            last_err = e
            await asyncio.sleep(2 ** attempt + random.random())
    raise RuntimeError(f"edge-tts failed: {last_err}")

# ── Endpoints ─────────────────────────────────────────────────────────────────
@app.get("/health")
def health():
    return {
        "status": "ok",
        "piper_bin": os.path.exists(PIPER_BIN),
        "piper_voices": _list_voices(),
        "kokoro": KOKORO_AVAILABLE,
        "edge_tts": EDGE_TTS_AVAILABLE,
    }

@app.get("/voices")
def voices(language: str | None = None):
    """Return available TTS voices, optionally filtered by language."""
    return {"voices": get_available_voices(language)}

@app.post("/synthesize")
async def synthesize(req: TTSRequest):
    text = clean_text(req.text)
    if not text:
        raise HTTPException(400, "Empty text after cleaning")

    speed  = req.speed or DEFAULT_SPEED
    errors = []
    log.info(f"Synthesizing [{req.language}] {len(text)} chars")

    async with _tts_semaphore:
        # 1. Piper binary — best quality, truly native per-language
        try:
            loop  = asyncio.get_event_loop()
            audio, mime = await loop.run_in_executor(None, synth_piper, text, req.language, speed)
            return Response(content=audio, media_type=mime)
        except Exception as e:
            log.warning(f"Piper failed: {e}")
            errors.append(f"Piper: {e}")

        # 2. Kokoro — good native support for ES/FR/IT/PT/JA/ZH
        if KOKORO_AVAILABLE and req.language in KOKORO_CONFIG:
            try:
                audio, mime = synth_kokoro(text, req.language, speed)
                return Response(content=audio, media_type=mime)
            except Exception as e:
                log.warning(f"Kokoro failed: {e}")
                errors.append(f"Kokoro: {e}")

        # 3. edge-tts — last resort
        if EDGE_TTS_AVAILABLE:
            try:
                audio, mime = await synth_edge(text, req.language, speed)
                return Response(content=audio, media_type=mime)
            except Exception as e:
                errors.append(f"edge-tts: {e}")

        raise HTTPException(500, f"All TTS engines failed: {' | '.join(errors)}")

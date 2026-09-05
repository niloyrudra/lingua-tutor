"""
Whisper STT Microservice
Wraps faster-whisper in a FastAPI HTTP server.
Accepts audio uploads, returns transcriptions.
"""

import os
import tempfile
import asyncio
import logging
from contextlib import asynccontextmanager
from fastapi import FastAPI, File, UploadFile, HTTPException, Form
from fastapi.responses import JSONResponse
from faster_whisper import WhisperModel

logging.basicConfig(level=logging.INFO)
log = logging.getLogger("whisper-service")

# ── Model config ──────────────────────────────────────────────────────────────
MODEL_SIZE = os.getenv("WHISPER_MODEL", "base")   # tiny|base|small|medium|large-v3
DEVICE = os.getenv("WHISPER_DEVICE", "cpu")       # cpu | cuda
COMPUTE_TYPE = os.getenv("WHISPER_COMPUTE", "int8")  # int8 (cpu) | float16 (gpu)
BEAM_SIZE = int(os.getenv("WHISPER_BEAM_SIZE", "5"))
CONCURRENCY = int(os.getenv("WHISPER_CONCURRENCY", "1"))
MAX_AUDIO_BYTES = int(os.getenv("WHISPER_MAX_AUDIO_BYTES", "26214400"))  # 25MB default

model: WhisperModel = None
model_loaded = False
_semaphore = asyncio.Semaphore(CONCURRENCY)

@asynccontextmanager
async def lifespan(app: FastAPI):
    global model, model_loaded
    log.info(f"Loading Whisper model: {MODEL_SIZE} on {DEVICE} ({COMPUTE_TYPE})")
    model = WhisperModel(MODEL_SIZE, device=DEVICE, compute_type=COMPUTE_TYPE)
    model_loaded = True
    log.info("Whisper model ready ✓")
    yield
    log.info("Shutting down Whisper service")

app = FastAPI(title="Lingua Whisper STT", lifespan=lifespan)

# ── Health ────────────────────────────────────────────────────────────────────
@app.get("/health")
def health():
    return {"status": "ok", "model": MODEL_SIZE, "device": DEVICE, "model_loaded": model_loaded}

# ── Transcribe ────────────────────────────────────────────────────────────────
@app.post("/transcribe")
async def transcribe(
    audio: UploadFile = File(...),
    language: str = Form(default="auto"),
):
    if model is None or not model_loaded:
        raise HTTPException(503, "Model not loaded yet")

    # Bounded read to prevent memory exhaustion
    audio_bytes = await audio.read()
    if len(audio_bytes) > MAX_AUDIO_BYTES:
        raise HTTPException(413, f"Audio too large (max {MAX_AUDIO_BYTES} bytes)")
    if len(audio_bytes) < 500:
        return JSONResponse({"transcript": "", "language": language, "confidence": 0.0})

    # Write to a temp file (faster-whisper needs a file path)
    suffix = os.path.splitext(audio.filename or "audio.webm")[1] or ".webm"
    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
        tmp.write(audio_bytes)
        tmp_path = tmp.name

    async with _semaphore:
        try:
            lang_arg = None if language == "auto" else language
            segments, info = model.transcribe(
                tmp_path,
                language=lang_arg,
                beam_size=BEAM_SIZE,
                vad_filter=True,               # skip silent parts
                vad_parameters={"min_silence_duration_ms": 500},
            )

            transcript = " ".join(seg.text.strip() for seg in segments).strip()
            detected = info.language
            confidence = float(info.language_probability)

            log.info(f"Transcribed [{detected}] ({confidence:.2f}): {transcript[:80]}")
            return {
                "transcript": transcript,
                "language": detected,
                "confidence": confidence,
            }

        except Exception as e:
            log.error(f"Transcription error: {e}")
            raise HTTPException(500, f"Transcription failed: {e}")
        finally:
            try:
                os.unlink(tmp_path)
            except OSError:
                pass
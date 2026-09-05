FROM python:3.11-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    libsndfile1 \
    espeak-ng \
    curl \
    wget \
    ffmpeg \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# ── Install piper binary (the proper way — not via python -m piper) ───────────
RUN wget -q https://github.com/rhasspy/piper/releases/download/2023.11.14-2/piper_linux_x86_64.tar.gz \
    && tar -xzf piper_linux_x86_64.tar.gz \
    && mv piper /usr/local/bin/piper-bin \
    && rm piper_linux_x86_64.tar.gz \
    && chmod +x /usr/local/bin/piper-bin/piper \
    && echo "Piper binary installed: $(/usr/local/bin/piper-bin/piper --version 2>&1 || echo 'ok')"

# ── Kokoro (natively good for ES, FR, IT, PT, JA, ZH) ────────────────────────
# Disabled by default for faster/smaller builds; enable if needed:
# RUN pip install --no-cache-dir kokoro==0.9.4 soundfile==0.12.1 numpy \
#     || echo "Kokoro install failed"

# ── edge-tts fallback ─────────────────────────────────────────────────────────
RUN pip install --no-cache-dir edge-tts==6.1.9

# ── FastAPI ───────────────────────────────────────────────────────────────────
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# ── Pre-download Piper voice models ───────────────────────────────────────────
COPY download_voices.py .
RUN python download_voices.py || echo "Voice pre-download failed — will download at runtime"

COPY main.py .

ENV TTS_SPEED=1.0
ENV PIPER_VOICES_DIR=/app/voices
ENV PIPER_BIN=/usr/local/bin/piper-bin/piper

EXPOSE 8002

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8002"]

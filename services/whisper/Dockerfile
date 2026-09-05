FROM python:3.11-slim

# System deps for audio processing
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY main.py .

# ARG must be declared AFTER pip install to avoid cache-busting the layer
ARG WHISPER_MODEL=small
ENV WHISPER_MODEL=${WHISPER_MODEL}
ENV WHISPER_DEVICE=cpu
ENV WHISPER_COMPUTE=int8

# Pre-download the model at build time so container starts instantly.
# Using a shell variable (not ${}) so it expands correctly inside RUN.
RUN python - << PYEOF
import os
from faster_whisper import WhisperModel
model_name = os.environ.get("WHISPER_MODEL", "small")
print(f"Pre-caching Whisper model: {model_name}")
WhisperModel(model_name, device="cpu", compute_type="int8")
print("Model cached ✓")
PYEOF

EXPOSE 8001

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8001"]

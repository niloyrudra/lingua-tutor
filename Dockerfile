FROM node:22-slim

WORKDIR /app

# Install deps first (layer cache) — npm ci uses the committed lockfile
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Copy source
COPY backend/ ./backend/
COPY frontend/ ./frontend/

ENV NODE_ENV=production
ENV PORT=3000
ENV HOST_BIND=0.0.0.0

# Point to sibling microservices (docker compose DNS)
ENV STT_PROVIDER=whisper
ENV WHISPER_SERVICE_URL=http://whisper:8001

ENV TTS_PROVIDER=local
ENV TTS_SERVICE_URL=http://tts:8002

ENV LLM_PROVIDER=ollama
ENV OLLAMA_BASE_URL=http://ollama:11434
ENV OLLAMA_MODEL=llama3.2

# Runtime data lives on a volume-mounted directory (/app/data)
ENV SESSION_PERSIST_DIR=/app/data/sessions
ENV AUDIO_CACHE_DIR=/app/data/audio-cache

# Run as a non-root user
RUN useradd --create-home --uid 10001 appuser
RUN mkdir -p /app/data/sessions /app/data/audio-cache && chown -R appuser:appuser /app/data
USER appuser

EXPOSE 3000

CMD ["node", "backend/server.js"]

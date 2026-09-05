#!/bin/sh
# Called by ollama-pull container.
# Waits for Ollama to be ready, then pulls the desired model.

MODEL="${OLLAMA_MODEL:-llama3.2}"
HOST="${OLLAMA_HOST:-http://ollama:11434}"

echo "⏳ Waiting for Ollama at $HOST..."
until curl -sf "$HOST/api/tags" > /dev/null 2>&1; do
  sleep 2
done

echo "✓ Ollama is up. Checking for model: $MODEL"

# Check if model is already present
if curl -sf "$HOST/api/tags" | grep -q "\"$MODEL\""; then
  echo "✓ Model '$MODEL' already downloaded — skipping pull"
else
  echo "📥 Pulling '$MODEL' (this may take a while on first run)..."
  curl -X POST "$HOST/api/pull" \
    -H "Content-Type: application/json" \
    -d "{\"name\": \"$MODEL\", \"stream\": false}" \
    --max-time 600
  echo ""
  echo "✓ Model '$MODEL' ready"
fi

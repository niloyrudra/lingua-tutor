"""
Pre-downloads Piper TTS voice models at Docker build time.
Piper voices are small (~60-130MB each) and language-specific.
Each voice is a real neural TTS model trained on native speakers.
"""
import os
import urllib.request
import json

VOICES_DIR = "/app/voices"
os.makedirs(VOICES_DIR, exist_ok=True)

# Piper voice registry base URL
BASE = "https://huggingface.co/rhasspy/piper-voices/resolve/main"

# Voices to pre-download: (language_code, voice_name, quality)
# These are all trained on NATIVE speakers of each language
VOICES = [
    # German — Thorsten is the gold standard German Piper voice
    ("de/de_DE/thorsten/high",       "de_DE-thorsten-high"),
    # French — native French speaker
    ("fr/fr_FR/siwis/medium",        "fr_FR-siwis-medium"),
    # Spanish — native Spanish speaker
    ("es/es_ES/sharvard/medium",     "es_ES-sharvard-medium"),
    # Italian
    ("it/it_IT/riccardo/x_low",      "it_IT-riccardo-x_low"),
    # Portuguese (not available on HF)
    # ("pt/pt_PT/tugao/medium",        "pt_PT-tugao-medium"),
    # Dutch
    ("nl/nl_NL/mls/medium",          "nl_NL-mls-medium"),
    # English fallback
    ("en/en_US/lessac/high",         "en_US-lessac-high"),
]

def download_voice(path, name):
    onnx_url  = f"{BASE}/{path}/{name}.onnx"
    json_url  = f"{BASE}/{path}/{name}.onnx.json"
    onnx_out  = f"{VOICES_DIR}/{name}.onnx"
    json_out  = f"{VOICES_DIR}/{name}.onnx.json"

    if os.path.exists(onnx_out) and os.path.exists(json_out):
        print(f"  Already cached: {name}")
        return True

    try:
        print(f"  Downloading {name}.onnx ...")
        urllib.request.urlretrieve(onnx_url, onnx_out)
        print(f"  Downloading {name}.onnx.json ...")
        urllib.request.urlretrieve(json_url, json_out)
        size_mb = os.path.getsize(onnx_out) / 1024 / 1024
        print(f"  ✓ {name} ({size_mb:.1f} MB)")
        return True
    except Exception as e:
        print(f"  ✗ Failed to download {name}: {e}")
        # Clean up partial downloads
        for f in [onnx_out, json_out]:
            if os.path.exists(f):
                os.unlink(f)
        return False

print(f"Downloading Piper voice models to {VOICES_DIR}...")
success = 0
for path, name in VOICES:
    if download_voice(path, name):
        success += 1

print(f"\n✓ Downloaded {success}/{len(VOICES)} voices")

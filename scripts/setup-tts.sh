#!/bin/sh
# Installs Turkish text to speech: Antalia-2 Mini (Apache-2.0) with CPU-only PyTorch, plus its weights.
# Needs: uv, curl, python3 (3.10 or newer).
set -eu
DIR="${XDG_DATA_HOME:-$HOME/.local/share}/clawdeck/tts"
REPO=cloud0day3/antalia-mini
REV=8a79528770af2ed5cb6d3b9ac1248d370429f272 # the reviewed commit (2026-10-20)
mkdir -p "$DIR/model"
uv venv --quiet --allow-existing --python python3 "$DIR/venv"
uv pip install --quiet --python "$DIR/venv/bin/python" --index-url https://download.pytorch.org/whl/cpu torch==2.14.1+cpu
uv pip install --quiet --python "$DIR/venv/bin/python" antalia-mini==1.0.1
for f in config.json acoustic.safetensors vocoder.safetensors; do
  [ -f "$DIR/model/$f" ] || curl -sSL --fail -o "$DIR/model/$f" "https://huggingface.co/$REPO/resolve/$REV/$f"
done
echo "Read aloud is ready."

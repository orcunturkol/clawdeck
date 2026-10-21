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
while read -r f sha; do
  [ -f "$DIR/model/$f" ] && continue
  curl -sSL --fail -o "$DIR/model/$f.part" "https://huggingface.co/$REPO/resolve/$REV/$f"
  echo "$sha  $DIR/model/$f.part" | sha256sum -c --quiet
  mv "$DIR/model/$f.part" "$DIR/model/$f"
done <<'FILES'
config.json e22ec7fcbe635dced92070f81e6f1ee83b0d25a23877b0c9ab7fc86e7abe4cd7
acoustic.safetensors 72c36a6855ce95dc1d35960a7b61515136813313406e5b9ae1c2ebe6cd2ad428
vocoder.safetensors 89ca374cc55864b38a36f9ea87c41e1b17376e5d6d68e3a0458332861509bbf6
FILES
echo "Read aloud is ready."

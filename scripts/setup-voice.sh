#!/bin/sh
# Installs local speech to text: whisper.cpp with Vulkan (GPU) and the Whisper turbo model. No root needed.
# Needs: git, gcc, glslc (shaderc), libvulkan, uv, curl, ffmpeg.
set -eu
DIR="${XDG_DATA_HOME:-$HOME/.local/share}/clawdeck/voice"
SRC="$DIR/src"
CMAKE="uvx --quiet --from cmake cmake"
mkdir -p "$DIR/models" "$DIR/bin" "$SRC"
cd "$SRC"

# Header tags match the Vulkan loader on this PC (1.4.363); change them with a big loader update.
git -c advice.detachedHead=false clone --quiet --depth 1 --branch v1.4.363 https://github.com/KhronosGroup/Vulkan-Headers.git vulkan-headers
git -c advice.detachedHead=false clone --quiet --depth 1 --branch vulkan-sdk-1.4.363.0 https://github.com/KhronosGroup/SPIRV-Headers.git spirv-src
$CMAKE -S spirv-src -B spirv-src/build -DSPIRV_HEADERS_ENABLE_TESTS=OFF >/dev/null
$CMAKE --install spirv-src/build --prefix "$SRC/spirv" >/dev/null
git -c advice.detachedHead=false clone --quiet --depth 1 --branch v1.9.5 https://github.com/ggml-org/whisper.cpp.git whisper.cpp

echo "Building whisper.cpp with Vulkan"
$CMAKE -S whisper.cpp -B whisper.cpp/build -Wno-author -DCMAKE_BUILD_TYPE=Release -DGGML_VULKAN=ON -DBUILD_SHARED_LIBS=OFF -DWHISPER_BUILD_TESTS=OFF \
  -DCMAKE_PREFIX_PATH="$SRC/spirv" -DCMAKE_C_FLAGS="-I$SRC/spirv/include" -DCMAKE_CXX_FLAGS="-I$SRC/spirv/include" \
  -DVulkan_INCLUDE_DIR="$SRC/vulkan-headers/include" -DVulkan_GLSLC_EXECUTABLE="$(command -v glslc)" >/dev/null
if ! $CMAKE --build whisper.cpp/build --config Release -j "$(nproc)" --target whisper-cli >"$SRC/build.log" 2>&1; then
  tail -40 "$SRC/build.log"
  exit 1
fi
cp whisper.cpp/build/bin/whisper-cli "$DIR/bin/whisper-cli"

# Only the program and the model are needed at run time.
cd "$DIR"
rm -rf "$SRC"

MODEL=models/ggml-large-v3-turbo-q5_0.bin
if [ ! -f "$MODEL" ]; then
  echo "Downloading the Whisper turbo model (about 550 MB)"
  curl -sSL --fail -o "$MODEL.part" https://huggingface.co/ggerganov/whisper.cpp/resolve/5359861c739e955e79d9a303bcbc70fb988958b1/ggml-large-v3-turbo-q5_0.bin
  echo "394221709cd5ad1f40c46e6031ca61bce88931e6e088c188294c6d5a55ffa7e2  $MODEL.part" | sha256sum -c --quiet
  mv "$MODEL.part" "$MODEL"
fi
echo "Voice input is ready."

#!/bin/sh
# Adds Clawdeck to the GNOME app grid and puts `clawdeck` on the PATH.
set -e
APP="$(cd "$(dirname "$0")/.." && pwd)"
DATA="${XDG_DATA_HOME:-$HOME/.local/share}"

mkdir -p "$DATA/applications" "$DATA/icons/hicolor/scalable/apps" "$HOME/.local/bin"
cp "$APP/assets/icon.svg" "$DATA/icons/hicolor/scalable/apps/clawdeck.svg"
# Pixel art: 16 has its own drawing; bigger sizes are whole-number scales of the 32 master.
for size in 16 32 64 128 256; do
  mkdir -p "$DATA/icons/hicolor/${size}x${size}/apps"
  if [ "$size" = 16 ]; then src="$APP/assets/app-icon/clawdeck-16.png"; else src="$APP/assets/app-icon/clawdeck-32.png"; fi
  magick "$src" -filter point -resize "${size}x${size}" "$DATA/icons/hicolor/${size}x${size}/apps/clawdeck.png"
done
ln -sf "$APP/bin/clawdeck" "$HOME/.local/bin/clawdeck"

cat > "$DATA/applications/clawdeck.desktop" <<DESKTOP
[Desktop Entry]
Type=Application
Name=Clawdeck
Comment=Desktop app for Claude Code
Exec=$APP/bin/clawdeck %f
Icon=clawdeck
Terminal=false
Categories=Development;
StartupWMClass=clawdeck
StartupNotify=true
DESKTOP

update-desktop-database "$DATA/applications" 2>/dev/null || true
# -t: the user icon folder has no index.theme; without a fresh cache GNOME keeps showing a gear.
gtk-update-icon-cache -q -f -t "$DATA/icons/hicolor" 2>/dev/null || true
echo "Installed. Open Clawdeck from the app grid, or run: clawdeck [folder]"

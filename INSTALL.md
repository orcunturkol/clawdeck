# Install Clawdeck

Clawdeck runs on Linux. It is tested on CachyOS with GNOME 50 on Wayland.

## Requirements

- Claude Code, installed and logged in. Run `claude` once in a terminal to log in.
- Node.js 22 or newer, with npm.
- git and ImageMagick (`magick`).
- For voice input (optional): gcc, glslc (shaderc), the Vulkan loader, uv, curl and ffmpeg.
- For Turkish read aloud (optional): uv and Python 3.10 or newer.

## Install

```sh
git clone https://github.com/orcunturkol/clawdeck.git
cd clawdeck
npm run setup            # packages, Electron, build
npm run install-desktop  # app grid entry, icons, `clawdeck` command in ~/.local/bin
```

Open Clawdeck from the app grid, or run `clawdeck ~/some/project`.

npm 12 does not run install scripts, so `npm run setup` downloads Electron itself.

## Optional features

```sh
npm run setup-voice  # speech to text: builds whisper.cpp with Vulkan, Whisper turbo model (550 MB), no root
npm run setup-tts    # Turkish read aloud: CPU PyTorch and Antalia-2 Mini (about 860 MB)
```

Both install into `~/.local/share/clawdeck`. Without them, the app works; only the Voice and Read aloud buttons show an error.

## Update

```sh
git pull
npm run setup
```

Close and open Clawdeck again after an update.

## Uninstall

```sh
rm ~/.local/share/applications/clawdeck.desktop ~/.local/bin/clawdeck
rm ~/.local/share/icons/hicolor/*/apps/clawdeck.*
gtk-update-icon-cache -f -t ~/.local/share/icons/hicolor
rm -rf ~/.local/share/clawdeck ~/.config/Clawdeck
```

Your Claude Code sessions and settings in `~/.claude` stay.

## Problems

- **The app grid shows a gear instead of the icon:** run `gtk-update-icon-cache -f -t ~/.local/share/icons/hicolor`, or log out and in.
- **MCP servers fail only when started from the app grid:** Clawdeck reads `PATH` from your login shell. Make sure your shell's login profile adds the folders of `claude`, `npx` and your MCP commands.

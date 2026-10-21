# Install Clawdeck

Clawdeck runs on Linux and Windows. Linux is tested on CachyOS with GNOME 50 on Wayland. Windows is a preview.

## Windows (preview)

1. Install Claude Code for Windows, then run `claude` once in PowerShell to log in. Claude Code on Windows needs Git for Windows.
2. Download from [Releases](https://github.com/orcunturkol/clawdeck/releases): `Clawdeck-<version>-win-x64.exe` (installer) or `Clawdeck-<version>-win-x64.zip` (portable, no install).
3. The app is not signed. Windows SmartScreen shows "Windows protected your PC": click **More info**, then **Run anyway**.
4. Voice input and Read aloud download the first time you use them; the app asks before it downloads. On Windows, voice runs on the CPU, so a clip takes several seconds.

Uninstall: **Settings > Apps > Clawdeck**, then delete `%LOCALAPPDATA%\clawdeck` (voice and read aloud) and `%APPDATA%\Clawdeck` (app settings).

To build the Windows packages yourself: `npm run dist:win` (on Windows, or on Linux with wine).

## Linux requirements

- Claude Code, installed and logged in. Run `claude` once in a terminal to log in.
- Node.js 22 or newer, with npm.
- git and ImageMagick (`magick`).
- For voice input (optional): gcc, glslc (shaderc), the Vulkan loader, uv and curl.
- For Turkish read aloud (optional): uv and Python 3.10 or newer.

## Linux install

```sh
git clone https://github.com/orcunturkol/clawdeck.git
cd clawdeck
npm run setup            # packages, Electron, build
npm run install-desktop  # app grid entry, icons, `clawdeck` command in ~/.local/bin
```

Open Clawdeck from the app grid, or run `clawdeck ~/some/project`.

npm 12 does not run install scripts, so `npm run setup` downloads Electron itself.

## Optional features

The app offers these downloads the first time you press Voice or turn on Read aloud. You can also run them yourself:

```sh
npm run setup-voice  # speech to text: builds whisper.cpp with Vulkan, Whisper turbo model (550 MB), no root
npm run setup-tts    # Turkish read aloud: CPU PyTorch and Antalia-2 Mini (about 860 MB)
```

Both install into `~/.local/share/clawdeck`. Every download is pinned to a version and checked against its SHA-256.

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

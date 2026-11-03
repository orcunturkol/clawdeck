# Install Clawdeck

Clawdeck runs on Linux and Windows. Linux is tested on CachyOS with GNOME 50 on Wayland, Windows on Windows 11.

## Windows

1. Install Claude Code for Windows (it needs Git for Windows). Clawdeck also finds the Claude Code that comes with the Claude desktop app. If Claude Code is not logged in, Clawdeck shows a Log in bar in the chat.
2. Download from [Releases](https://github.com/orcunturkol/clawdeck/releases): `Clawdeck-<version>-win-x64.exe` (installer) or `Clawdeck-<version>-win-x64.zip` (portable, no install).
3. The app is not signed. Windows SmartScreen shows "Windows protected your PC": click **More info**, then **Run anyway**.

Uninstall: **Settings > Apps > Clawdeck**, then delete `%APPDATA%\Clawdeck` (app settings).

To build the Windows packages yourself: `npm run dist:win` (on Windows, or on Linux with wine).

The Claude Code that comes with the Claude desktop app updates with that app, not with `claude update`.

To add another Claude account, click **Add account** in the Accounts section and sign in in the window that opens. No token is needed. Clawdeck runs `claude setup-token` in a hidden terminal and keeps the token encrypted.

## Linux requirements

- Claude Code, installed and logged in. Run `claude` once in a terminal to log in.
- Node.js 22 or newer, with npm.
- git and ImageMagick (`magick`).

## Linux install

```sh
git clone https://github.com/orcunturkol/clawdeck.git
cd clawdeck
npm run setup            # packages, Electron, build
npm run install-desktop  # app grid entry, icons, `clawdeck` command in ~/.local/bin
```

Open Clawdeck from the app grid, or run `clawdeck ~/some/project`.

npm 12 does not run install scripts, so `npm run setup` downloads Electron itself.

## Update

Clawdeck looks for a new release at start and every 6 hours. When there is one, the top bar shows a button.

- **Windows (installer):** Clawdeck downloads the update in the background. Click **Restart to update**. The update installs without an installer window, and Clawdeck opens again. If you close Clawdeck instead, the update installs when it closes.
- **Linux (git clone):** click **Update to x.y.z**. Clawdeck runs `git pull --ff-only` and `npm run setup`, then opens again. If a step fails (for example, local changes block `git pull`), Clawdeck shows the error and does not close.
- **Windows (portable zip):** the button opens the release page. Download the new zip.

To update by hand on Linux, run `git pull` and `npm run setup`, then open Clawdeck again.

## Release a new version

1. Change `version` in `package.json` (for example to `0.3.0`). Commit and push to `main`.
2. Tag the commit and push the tag: `git tag v0.3.0 && git push origin v0.3.0`.
3. The Release workflow (`.github/workflows/release.yml`) builds the Windows files and publishes the release. It stops if the tag is not `v` plus the `package.json` version.

The release must have `latest.yml` and the `.exe.blockmap` next to the installer, because the Windows updater reads them. To publish by hand, run `npm run dist:win`, then:

```sh
gh release create v0.3.0 release/Clawdeck-0.3.0-win-x64.exe release/Clawdeck-0.3.0-win-x64.exe.blockmap release/Clawdeck-0.3.0-win-x64.zip release/latest.yml
```

## Uninstall

```sh
rm ~/.local/share/applications/clawdeck.desktop ~/.local/bin/clawdeck
rm ~/.local/share/icons/hicolor/*/apps/clawdeck.*
gtk-update-icon-cache -f -t ~/.local/share/icons/hicolor
rm -rf ~/.config/Clawdeck
```

Your Claude Code sessions and settings in `~/.claude` stay.

## Problems

- **The app grid shows a gear instead of the icon:** run `gtk-update-icon-cache -f -t ~/.local/share/icons/hicolor`, or log out and in.
- **MCP servers fail only when started from the app grid:** Clawdeck reads `PATH` from your login shell. Make sure your shell's login profile adds the folders of `claude`, `npx` and your MCP commands.

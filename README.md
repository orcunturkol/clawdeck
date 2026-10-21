# Clawdeck

A Linux desktop app for Claude Code. It runs real Claude Code sessions with your
login, settings, plugins, skills and MCP servers, and shows them in one window.

![Chat with tool rows, and the control panel with session settings, usage limits and MCP servers](docs/screenshots/chat.png)

| | |
|---|---|
| ![Edit approval with a diff](docs/screenshots/approval.png) | ![Claude drives the browser pane](docs/screenshots/browser.png) |
| Approve or deny each edit, with the diff. | Claude opens and clicks pages in a live browser pane. |
| ![Running tab with a shell and its port](docs/screenshots/running.png) | ![Light theme](docs/screenshots/light.png) |
| Every running chat and shell on this PC, with a Stop button. | Light and dark follow the desktop theme. |

To install, see [INSTALL.md](INSTALL.md).

```
┌──────────────┬───────────────────────────────┬────────────────────────┐
│ Folder       │ Chat                          │ Control panel or       │
│              │                               │ Browser pane           │
│ New session  │  prompts, answers, tool rows, │  Session: model,       │
│ Sessions in  │  permission prompts,          │   effort, permissions  │
│ this folder  │  questions, web sources       │  Usage: 5-hour, weekly,│
│              │                               │   tokens per day       │
│              │ ┌───────────────────────────┐ │  MCP servers (on/off)  │
│              │ │ message box               │ │  Plugins (on/off)      │
│              │ │ mode · Web search · Send  │ │  Skills, Commands      │
│              │ └───────────────────────────┘ │  Agents, Hooks         │
│              │                               │  CLAUDE.md and memory  │
└──────────────┴───────────────────────────────┴────────────────────────┘
```

## How it works

```
 Renderer (React, sandboxed)         Main process (Node)              Claude Code CLI
 ┌──────────────────────┐  IPC  ┌──────────────────────────┐ stdio ┌─────────────────┐
 │ App, Transcript,     │──────>│ electron/main.mjs        │──────>│ ~/.local/bin/   │
 │ Composer, Panel      │<──────│ Session (Agent SDK query)│<──────│ claude          │
 └──────────────────────┘ events│ config.mjs, usage.mjs    │ JSON  │ (your login,    │
                                └──────────────────────────┘       │ plugins, MCPs)  │
                                  reads ~/.claude files            └─────────────────┘
```

- The main process uses `@anthropic-ai/claude-agent-sdk` and points it at the
  installed `claude` binary. `claude update` also updates the app.
- The renderer has no Node access. It talks to the main process through a
  small channel list in `electron/preload.cjs`. No network port is open.
- Permission prompts, `AskUserQuestion` and plan approval come through the
  SDK `canUseTool` callback and show in the chat.
- The Web search switch uses a `PreToolUse` hook. When it is off, the hook
  denies `WebSearch` and `WebFetch`. The switch works in a running session.
- The Browser pane is a real Chromium view in the window. Claude drives it
  through an in-process MCP server (`electron/browserTools.mjs`) with tools to
  open, read, click, type, press keys, scroll, go back and take a screenshot.
  Clicks are real mouse events, and the element flashes amber. Sign-ins stay
  in the `persist:clawdeck-browser` partition. "Take over" blocks Claude's
  browser tools until you click "Give back".
- Voice input is local Whisper: whisper.cpp v1.9.5 built with Vulkan, so it
  runs on the Intel Arc GPU (it falls back to the CPU if Vulkan fails). Model:
  `ggml-large-v3-turbo-q5_0`, language found per clip, fully offline. Each
  clip runs one `whisper-cli` process; the model loads in about 0.2 s.
  `~/.local/share/clawdeck/voice` holds only `bin/whisper-cli` and `models/`;
  the setup script deletes its sources and build files.
  Measured on a Core Ultra 7 155H: about 3.7 s after you stop talking, for any
  clip up to 30 s. The app window may use the microphone and no other device.
- Read aloud (switch in the message bar) speaks each Turkish answer when the
  turn ends, with Antalia-2 Mini (`cloud0day3/antalia-mini` 1.0.1, Apache-2.0,
  one synthetic voice, CPU). A Python worker in `~/.local/share/clawdeck/tts`
  loads the model once (about 1.3 s) and makes speech about 16 times faster
  than real time. Code blocks and tables are not read. The mic stops the voice.
- Every chat has its own Claude Code process, so switching chats or folders
  never stops a chat that is working. Up to 10 chats stay live (about 1 GB each
  with the MCP servers, set by `MAX_LIVE` in `electron/main.mjs`); above that the
  idle chat used longest ago closes, and clicking it opens it again from its
  history. A working chat, or one that waits for you, never closes.
- "Running now" in the left rail lists every live Claude Code process on this
  PC (terminal tabs, this window, other apps) from `~/.claude/sessions/*.json`,
  with a live status and the Bash shells each one runs (command, time, ports,
  Stop). Stop ends the shell's process group. Click a session to read it; a
  session that runs elsewhere opens read only and follows new messages.
- Icons are 16×16 one-bit pixel drawings in `assets/icons` (made with the
  pixellab-artist agent). `npm run icons` turns them into SVG paths in
  `src/icons.js`; they take the text color, and one icon pixel always covers a
  whole number of screen pixels, so they stay sharp at any display scale.
- The app icon is pixel art: `assets/app-icon/clawdeck-32.png` (master) and
  `clawdeck-16.png` (small sizes). `npm run app-icon` builds `assets/icon.svg`
  (one rectangle per pixel run), `assets/icon.png` (256 px) and the top-bar
  logo; `npm run install-desktop` installs every GNOME size.
- MCP server configs can hold tokens. The panel shows only the command or URL.
- The memory editor can only open the CLAUDE.md files and the memory files of
  the current folder.

## Setup

```sh
npm run setup            # install packages, download Electron, build
npm run install-desktop  # app grid entry, icon, `clawdeck` command
clawdeck ~/some/project  # open a folder
```

Requirements, optional voice features, update and uninstall: [INSTALL.md](INSTALL.md).

## Development

```sh
npm start                                   # build and run
node scripts/shot.mjs <folder> [prompt]     # screenshots into shots/
CLAWDECK_PROFILE=<dir> npm run app          # separate profile, safe next to an open window
```

## Keys

- Enter sends. Shift+Enter adds a line.
- `/` opens the skill and command list. Arrow keys and Tab pick an item.
- Shift+Tab cycles the permission mode.
- Hold Space in the empty message box to talk (a short press does nothing), or
  hold Ctrl+Space anywhere, or click Voice. Escape cancels.
- When Claude Code suggests a next prompt, it shows in the empty box; Tab or
  Right arrow takes it, Enter sends.
- Escape stops a running turn.
- Paste or drop an image to attach it. Drop a file to add its path.

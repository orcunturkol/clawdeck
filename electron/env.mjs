import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const HOME = os.homedir();
export const CLAUDE_DIR = path.join(HOME, '.claude');
export const IS_WIN = process.platform === 'win32';

// Downloaded tools (voice, read aloud): ~/.local/share/clawdeck, or %LOCALAPPDATA%\clawdeck on Windows.
export const DATA_DIR = IS_WIN
  ? path.join(process.env.LOCALAPPDATA || path.join(HOME, 'AppData', 'Local'), 'clawdeck')
  : path.join(process.env.XDG_DATA_HOME || path.join(HOME, '.local/share'), 'clawdeck');

// Files a child process must read cannot stay inside app.asar.
export function unpacked(p) {
  return p.replace(`app.asar${path.sep}`, `app.asar.unpacked${path.sep}`);
}

// A GNOME launcher does not get the login shell PATH, so MCP servers (npx, unity) fail without this.
export function loadLoginPath() {
  if (IS_WIN) return; // Windows apps get the user PATH from the system.
  const shell = process.env.SHELL || os.userInfo().shell || '/bin/bash';
  const r = spawnSync(shell, ['-l', '-c', 'printenv PATH'], { encoding: 'utf8', timeout: 5000 });
  const loginPath = r.status === 0 ? r.stdout.trim().split('\n').pop() : '';
  const parts = [...(loginPath ? loginPath.split(':') : []), ...(process.env.PATH || '').split(':'), path.join(HOME, '.local/bin')];
  process.env.PATH = [...new Set(parts.filter(Boolean))].join(':');
}

export function findClaude() {
  const exts = IS_WIN ? ['.exe', '.cmd'] : [''];
  const dirs = [...(process.env.PATH || '').split(path.delimiter), path.join(HOME, '.local', 'bin')];
  for (const dir of dirs) {
    for (const ext of exts) {
      const p = path.join(dir, `claude${ext}`);
      if (!existsSync(p)) continue;
      // An npm install puts a .cmd wrapper next to the real script; Node cannot start a .cmd directly.
      if (ext === '.cmd') {
        const cli = path.join(dir, 'node_modules', '@anthropic-ai', 'claude-code', 'cli.js');
        if (existsSync(cli)) return cli;
      }
      return p;
    }
  }
  return path.join(HOME, '.local', 'bin', IS_WIN ? 'claude.exe' : 'claude');
}

// How to run the Claude CLI as a child process: a .js file runs through node.
export function claudeCommand(claudePath, args) {
  return claudePath.endsWith('.js') ? ['node', [claudePath, ...args]] : [claudePath, args];
}

// Same folder name Claude Code uses under ~/.claude/projects.
export function projectSlug(cwd) {
  return cwd.replace(/[^a-zA-Z0-9]/g, '-');
}

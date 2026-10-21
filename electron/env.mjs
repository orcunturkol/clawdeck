import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const HOME = os.homedir();
export const CLAUDE_DIR = path.join(HOME, '.claude');

// A GNOME launcher does not get the login shell PATH, so MCP servers (npx, unity) fail without this.
export function loadLoginPath() {
  const shell = process.env.SHELL || os.userInfo().shell || '/bin/bash';
  const r = spawnSync(shell, ['-l', '-c', 'printenv PATH'], { encoding: 'utf8', timeout: 5000 });
  const loginPath = r.status === 0 ? r.stdout.trim().split('\n').pop() : '';
  const parts = [...(loginPath ? loginPath.split(':') : []), ...(process.env.PATH || '').split(':'), path.join(HOME, '.local/bin')];
  process.env.PATH = [...new Set(parts.filter(Boolean))].join(':');
}

export function findClaude() {
  for (const dir of (process.env.PATH || '').split(':')) {
    const p = path.join(dir, 'claude');
    if (existsSync(p)) return p;
  }
  return path.join(HOME, '.local/bin/claude');
}

// Same folder name Claude Code uses under ~/.claude/projects.
export function projectSlug(cwd) {
  return cwd.replace(/[^a-zA-Z0-9]/g, '-');
}

import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const HOME = os.homedir();
export const CLAUDE_DIR = path.join(HOME, '.claude');
export const IS_WIN = process.platform === 'win32';

// A GNOME launcher does not get the login shell PATH, so MCP servers (npx, unity) fail without this.
export function loadLoginPath() {
  if (IS_WIN) { loadWindowsPath(); return; }
  const shell = process.env.SHELL || os.userInfo().shell || '/bin/bash';
  const r = spawnSync(shell, ['-l', '-c', 'printenv PATH'], { encoding: 'utf8', timeout: 5000 });
  const loginPath = r.status === 0 ? r.stdout.trim().split('\n').pop() : '';
  const parts = [...(loginPath ? loginPath.split(':') : []), ...(process.env.PATH || '').split(':'), path.join(HOME, '.local/bin')];
  process.env.PATH = [...new Set(parts.filter(Boolean))].join(':');
}

// One value from the registry, with %VARS% expanded; '' when it is not there.
function regValue(key, name) {
  const r = spawnSync('reg.exe', ['query', key, '/v', name], { encoding: 'utf8', timeout: 5000, windowsHide: true });
  const m = r.status === 0 && r.stdout.match(new RegExp(`^\\s*${name}\\s+REG_(?:EXPAND_)?SZ\\s+(.*)$`, 'mi'));
  return m ? m[1].trim().replace(/%([^%]+)%/g, (all, v) => process.env[v] ?? all) : '';
}

// A Start menu launch keeps the PATH Explorer had when it started, so a tool installed later
// (claude, npx, an MCP server) is missing. The registry has the current one.
function loadWindowsPath() {
  const machine = regValue('HKLM\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment', 'Path');
  const user = regValue('HKCU\\Environment', 'Path');
  const parts = [...machine.split(';'), ...user.split(';'), ...(process.env.PATH || '').split(';'), path.join(HOME, '.local', 'bin')];
  const seen = new Set();
  process.env.PATH = parts.map((p) => p.trim()).filter((p) => {
    const k = p.replace(/[\\/]+$/, '').toLowerCase();
    if (!p || seen.has(k)) return false;
    seen.add(k);
    return true;
  }).join(';');
}

const newestFirst = (a, b) => {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pb[i] || 0) - (pa[i] || 0);
  return 0;
};

// The Claude desktop app keeps its own Claude Code in %APPDATA%\Claude\claude-code\<version>\<build>\claude.exe.
function desktopAppClaude() {
  const root = path.join(process.env.APPDATA || path.join(HOME, 'AppData', 'Roaming'), 'Claude', 'claude-code');
  let versions = [];
  try { versions = readdirSync(root).filter((v) => /^\d+(\.\d+)*$/.test(v)).sort(newestFirst); } catch { return null; }
  for (const v of versions) {
    let builds = [];
    try { builds = readdirSync(path.join(root, v)); } catch { continue; }
    for (const b of builds) {
      const p = path.join(root, v, b, 'claude.exe');
      if (existsSync(p)) return p;
    }
  }
  return null;
}

// The installed Claude Code, or null. Never a .cmd: Node cannot start one without a shell.
export function findClaude() {
  const dirs = [...(process.env.PATH || '').split(path.delimiter), path.join(HOME, '.local', 'bin')].filter(Boolean);
  for (const dir of dirs) {
    if (!IS_WIN) {
      const p = path.join(dir, 'claude');
      if (existsSync(p)) return p;
      continue;
    }
    const exe = path.join(dir, 'claude.exe');
    if (existsSync(exe)) return exe;
    // An npm install puts a claude.cmd wrapper here; start the package it points to instead.
    if (existsSync(path.join(dir, 'claude.cmd'))) {
      const pkg = path.join(dir, 'node_modules', '@anthropic-ai', 'claude-code');
      for (const p of [path.join(pkg, 'bin', 'claude.exe'), path.join(pkg, 'cli.js')]) if (existsSync(p)) return p;
    }
  }
  return IS_WIN ? desktopAppClaude() : null;
}

// How to run the Claude CLI as a child process: a .js file runs through Electron's own Node.
export function claudeCommand(claudePath, args) {
  if (claudePath.endsWith('.js')) {
    return [process.execPath, [claudePath, ...args], { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, windowsHide: true }];
  }
  return [claudePath, args, { windowsHide: true }];
}

// Same folder name Claude Code uses under ~/.claude/projects.
export function projectSlug(cwd) {
  return cwd.replace(/[^a-zA-Z0-9]/g, '-');
}

// Open a project or a file in VS Code. Falls back to the system default when `code` is not found.
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { repoTop, insideRepo } from './git.mjs';

const WIN = process.platform === 'win32';

// The `code` launcher: PATH first, then the usual Windows install folder. '' when it is not found.
export function findCode(env = process.env) {
  const names = WIN ? ['code.cmd', 'code.exe', 'code'] : ['code'];
  for (const dir of (env.PATH || env.Path || '').split(path.delimiter).filter(Boolean)) {
    for (const n of names) {
      const p = path.join(dir, n);
      if (existsSync(p)) return p;
    }
  }
  if (WIN && env.LOCALAPPDATA) {
    const p = path.join(env.LOCALAPPDATA, 'Programs', 'Microsoft VS Code', 'bin', 'code.cmd');
    if (existsSync(p)) return p;
  }
  return '';
}

// Windows cannot start a .cmd file without a shell. Code.exe sits one level above bin\ and takes the same arguments.
function launcher(p) {
  if (WIN && /\.cmd$/i.test(p)) {
    const exe = path.join(path.dirname(path.dirname(p)), 'Code.exe');
    return existsSync(exe) ? exe : '';
  }
  return p;
}

function start(bin, args, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { detached: true, stdio: 'ignore', env, windowsHide: true });
    child.once('error', reject);
    child.once('spawn', () => { child.unref(); resolve(); });
  });
}

// dir must be a known project folder (the caller checks that). file is relative to the repo, or empty for the folder.
export async function openInEditor({ dir, file, line }, { env = process.env, openPath } = {}) {
  let abs = dir;
  let top = dir;
  if (file) {
    top = await repoTop(dir);
    if (!top) throw new Error('Not a git repository');
    abs = await insideRepo(top, file);
  }
  const n = Number.isInteger(line) && line > 0 ? line : 1;
  const args = file ? ['--reuse-window', top, '--goto', `${abs}:${n}`] : ['--reuse-window', dir];
  const bin = launcher(findCode(env));
  if (bin) {
    try { await start(bin, args, env); return { via: 'code' }; } catch { /* fall through */ }
  }
  if (!openPath) throw new Error('VS Code was not found');
  const err = await openPath(abs);
  if (err) throw new Error(err);
  return { via: 'system' };
}

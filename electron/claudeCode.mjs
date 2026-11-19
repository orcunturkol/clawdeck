import { execFile } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { findClaude, claudeCommand } from './env.mjs';

const REGISTRY = 'https://registry.npmjs.org/@anthropic-ai/claude-code/latest';

// "2.1.327 (Claude Code)" -> "2.1.327"; null when there is no version in the text.
export function parseVersion(text) {
  const m = String(text || '').match(/\d+\.\d+\.\d+(?:-[0-9A-Za-z.]+)?/);
  return m ? m[0] : null;
}

// 1 when a is newer than b, -1 when older, 0 when equal.
export function compareVersions(a, b) {
  const pa = String(a).split('-')[0].split('.').map(Number);
  const pb = String(b).split('-')[0].split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d > 0 ? 1 : -1;
  }
  return 0;
}

// npm (a node_modules path), native (the installer's own folder), or unknown.
export function installType(claudePath) {
  let real = claudePath;
  try { real = realpathSync(claudePath); } catch { /* keep the given path */ }
  const p = real.replace(/\\/g, '/');
  if (/\/node_modules\//.test(p)) return 'npm';
  if (/\/claude\/versions\/|\/\.local\/bin\/|\/\.claude\/local\//.test(p) || /claude-code\/[\d.]+\/[^/]+\/claude\.exe$/.test(p)) return 'native';
  return 'unknown';
}

function run(claudePath, args, timeout) {
  const [cmd, argv, opts] = claudeCommand(claudePath, args);
  return new Promise((resolve) => {
    execFile(cmd, argv, { ...opts, timeout, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 }, (err, stdout, stderr) => {
      resolve({ ok: !err, output: `${stdout || ''}${stderr || ''}`.trim(), error: err ? (err.killed ? 'It took too long and stopped.' : err.message) : '' });
    });
  });
}

async function latestVersion() {
  try {
    const r = await fetch(REGISTRY, { signal: AbortSignal.timeout(8000) });
    if (!r.ok) return null;
    return parseVersion((await r.json()).version);
  } catch { return null; }
}

// Installed version, latest version, install type, and whether an update is due.
export async function info() {
  const claudePath = findClaude();
  if (!claudePath) return { found: false };
  const [r, latest] = await Promise.all([run(claudePath, ['--version'], 15000), latestVersion()]);
  const version = r.ok ? parseVersion(r.output) : null;
  return {
    found: true, path: claudePath, type: installType(claudePath), version, latest,
    upToDate: version && latest ? compareVersions(version, latest) >= 0 : null,
    error: version ? '' : r.output || r.error || 'Could not read the version.',
  };
}

// Runs `claude update`; never throws. The caller reads info() again after it.
export async function update() {
  const claudePath = findClaude();
  if (!claudePath) return { ok: false, output: '', error: 'Claude Code is not installed.' };
  return run(claudePath, ['update'], 5 * 60 * 1000);
}

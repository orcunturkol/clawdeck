// Read-only git views: status of each known project as a folder tree, and small diffs.
// Only `status`, `diff` and `rev-parse` run here. No command changes a repo.
import { execFile } from 'node:child_process';
import os from 'node:os';
import { promisify } from 'node:util';
import { realpath } from 'node:fs/promises';
import path from 'node:path';

const run = promisify(execFile);
const MAX_FILES = 500;
const MAX_DIFF_LINES = 400;

// A repo can set core.fsmonitor to a command. Turn it off, and never take the optional index lock.
const BASE = ['--no-optional-locks', '-c', 'core.fsmonitor=false', '-c', 'core.quotepath=off'];
const ENV = { ...process.env, GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0', LC_ALL: 'C' };

async function git(cwd, args, { ok = [0], max = 8 * 1024 * 1024 } = {}) {
  try {
    const r = await run('git', [...BASE, ...args], { cwd, env: ENV, maxBuffer: max, windowsHide: true, timeout: 20000 });
    return r.stdout;
  } catch (e) {
    if (typeof e.code === 'number' && ok.includes(e.code) && typeof e.stdout === 'string') return e.stdout;
    throw e;
  }
}

// One letter for a file: M modified, A added, D deleted, R renamed, U conflict, ?? untracked.
function letter(kind, xy) {
  if (kind === '?') return '??';
  if (kind === 'u') return 'U';
  if (xy.includes('D')) return 'D';
  if (xy.includes('R') || kind === '2') return 'R';
  if (xy.includes('A')) return 'A';
  return 'M';
}

// Parse the output of `git status --porcelain=v2 -z --branch`.
export function parseStatus(out) {
  const r = { branch: '', oid: '', upstream: '', ahead: 0, behind: 0, files: [] };
  const rec = out.split('\0');
  for (let i = 0; i < rec.length; i++) {
    const line = rec[i];
    if (!line) continue;
    if (line.startsWith('# ')) {
      const [, key, ...rest] = line.split(' ');
      const val = rest.join(' ');
      if (key === 'branch.head') r.branch = val;
      else if (key === 'branch.oid') r.oid = val;
      else if (key === 'branch.upstream') r.upstream = val;
      else if (key === 'branch.ab') {
        const m = val.match(/\+(\d+) -(\d+)/);
        if (m) { r.ahead = Number(m[1]); r.behind = Number(m[2]); }
      }
      continue;
    }
    const kind = line[0];
    if (kind === '1') {
      const f = line.split(' ');
      r.files.push({ path: f.slice(8).join(' '), status: letter(kind, f[1]), xy: f[1] });
    } else if (kind === '2') {
      const f = line.split(' ');
      r.files.push({ path: f.slice(9).join(' '), from: rec[++i] || '', status: letter(kind, f[1]), xy: f[1] });
    } else if (kind === 'u') {
      const f = line.split(' ');
      r.files.push({ path: f.slice(10).join(' '), status: 'U', xy: f[1] });
    } else if (kind === '?') {
      r.files.push({ path: line.slice(2), status: '??', xy: '??' });
    }
  }
  return r;
}

// Parse `git diff --numstat -z`. Returns Map path -> { add, del }. Binary files count as 0.
export function parseNumstat(out) {
  const map = new Map();
  const rec = out.split('\0');
  for (let i = 0; i < rec.length; i++) {
    const m = rec[i].match(/^(\d+|-)\t(\d+|-)\t(.*)$/s);
    if (!m) continue;
    let p = m[3];
    if (p === '') { i += 2; p = rec[i] || ''; } // a rename has the old and the new path in the next records
    const cur = map.get(p) || { add: 0, del: 0 };
    cur.add += m[1] === '-' ? 0 : Number(m[1]);
    cur.del += m[2] === '-' ? 0 : Number(m[2]);
    map.set(p, cur);
  }
  return map;
}

// Folders first, then files, each in name order. A node is a folder (children) or a file (file).
export function buildTree(files) {
  const root = { name: '', path: '', children: [] };
  for (const f of files) {
    const parts = f.path.split('/');
    let node = root;
    parts.forEach((name, i) => {
      const p = parts.slice(0, i + 1).join('/');
      if (i === parts.length - 1) { node.children.push({ name, path: p, file: f }); return; }
      let dir = node.children.find((c) => c.children && c.name === name);
      if (!dir) { dir = { name, path: p, children: [] }; node.children.push(dir); }
      node = dir;
    });
  }
  const sort = (n) => {
    n.children.sort((a, b) => (!!b.children - !!a.children) || a.name.localeCompare(b.name));
    n.add = 0; n.del = 0;
    for (const c of n.children) {
      if (c.children) { sort(c); n.add += c.add; n.del += c.del; } else { n.add += c.file.add || 0; n.del += c.file.del || 0; }
    }
  };
  sort(root);
  return root.children;
}

// The top folder of the repo that holds dir, or '' when dir is not in a repo.
export async function repoTop(dir) {
  try {
    const out = await git(dir, ['rev-parse', '--show-toplevel']);
    return out.trim() ? path.resolve(out.trim()) : '';
  } catch { return ''; }
}

// Status of one folder, or null when it is not a git repo.
export async function projectStatus(dir) {
  const top = await repoTop(dir);
  if (!top) return null;
  const st = parseStatus(await git(top, ['status', '--porcelain=v2', '-z', '--branch', '--untracked-files=normal']));
  const stat = await git(top, ['diff', '--numstat', '-z', '--no-ext-diff', 'HEAD'])
    .catch(() => git(top, ['diff', '--numstat', '-z', '--no-ext-diff']).catch(() => ''));
  const nums = parseNumstat(stat);
  const total = st.files.length;
  const files = st.files.slice(0, MAX_FILES).map((f) => ({ ...f, ...(nums.get(f.path) || { add: 0, del: 0 }) }));
  return {
    dir, top, name: path.basename(dir), branch: st.branch, detached: st.branch === '(detached)',
    upstream: st.upstream, ahead: st.ahead, behind: st.behind,
    count: total, truncated: total > files.length, tree: buildTree(files),
  };
}

// Status of every folder. Folders that are not repos, and repeats of the same repo, are left out.
let inFlight = null;
export function projects(dirs) {
  // A slow scan must not stack up with the next poll: share the running one.
  if (inFlight) return inFlight;
  inFlight = scan(dirs).finally(() => { inFlight = null; });
  return inFlight;
}

const SKIP = new Set([path.parse(process.cwd()).root, os.homedir(), os.tmpdir()].map((d) => path.resolve(d)));

async function scan(dirs) {
  const todo = dirs.filter((d) => !SKIP.has(path.resolve(d)));
  const out = [];
  // Three repos at a time: a big repo must not start many git processes together.
  let next = 0;
  await Promise.all([0, 1, 2].map(async () => {
    while (next < todo.length) out.push(await projectStatus(todo[next++]).catch(() => null));
  }));
  const seen = new Set();
  return out.filter((p) => p && !seen.has(p.top) && seen.add(p.top));
}

// Turn a file given by the page into an absolute path that stays inside the repo (links included).
// Throws when the file leaves the repo.
export async function insideRepo(top, file) {
  if (typeof file !== 'string' || !file || file.includes('\0')) throw new Error('Bad file path');
  const realTop = await realpath(top);
  const abs = path.resolve(top, file);
  // A deleted file has no real path, so check its nearest folder that exists.
  let probe = abs;
  let rest = '';
  for (;;) {
    try { probe = await realpath(probe); break; } catch {
      const up = path.dirname(probe);
      if (up === probe) throw new Error('File is outside the project');
      rest = path.join(path.basename(probe), rest);
      probe = up;
    }
  }
  const rel = path.relative(realTop, path.join(probe, rest));
  if (rel.startsWith('..') || path.isAbsolute(rel)) throw new Error('File is outside the project');
  return abs;
}

// A small unified diff of one file against HEAD (an untracked file shows as all added).
export async function fileDiff(dir, file) {
  const top = await repoTop(dir);
  if (!top) throw new Error('Not a git repository');
  await insideRepo(top, file);
  const opts = ['--no-color', '--no-ext-diff', '--no-textconv', '-U3'];
  const max = 2 * 1024 * 1024;
  let out = await git(top, ['diff', ...opts, 'HEAD', '--', file], { max }).catch(() => '');
  if (!out) out = await git(top, ['diff', ...opts, '--', file], { max }).catch(() => '');
  if (!out) {
    const nul = process.platform === 'win32' ? 'NUL' : '/dev/null';
    out = await git(top, ['diff', '--no-index', ...opts, '--', nul, file], { ok: [0, 1], max }).catch(() => '');
  }
  const lines = out.split('\n');
  const cut = lines.length > MAX_DIFF_LINES;
  return { diff: (cut ? lines.slice(0, MAX_DIFF_LINES) : lines).join('\n'), truncated: cut };
}

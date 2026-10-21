import { readdir, readFile, readlink } from 'node:fs/promises';
import path from 'node:path';
import { CLAUDE_DIR } from './env.mjs';

const SESSIONS = path.join(CLAUDE_DIR, 'sessions');
const SHELLS = new Set(['bash', 'zsh', 'sh', 'fish', 'dash']);
const TICKS = 100; // clock ticks per second on Linux
let bootTime = null;

async function procStat(pid) {
  try {
    const s = await readFile(`/proc/${pid}/stat`, 'utf8');
    const f = s.slice(s.lastIndexOf(')') + 2).split(' ');
    return { comm: s.slice(s.indexOf('(') + 1, s.lastIndexOf(')')), pgid: Number(f[2]), start: f[19] };
  } catch {
    return null;
  }
}

async function children(pid) {
  const tasks = await readdir(`/proc/${pid}/task`).catch(() => []);
  const out = [];
  for (const t of tasks) {
    const text = await readFile(`/proc/${pid}/task/${t}/children`, 'utf8').catch(() => '');
    out.push(...text.split(' ').filter(Boolean).map(Number));
  }
  return out;
}

async function tree(pid) {
  const all = [pid];
  for (let i = 0; i < all.length; i++) all.push(...(await children(all[i])));
  return all;
}

async function startedAt(start) {
  if (bootTime == null) {
    const stat = await readFile('/proc/stat', 'utf8');
    bootTime = Number(stat.match(/^btime (\d+)/m)[1]);
  }
  return Math.round((bootTime + Number(start) / TICKS) * 1000);
}

// Claude Code's Bash tool runs: zsh -c "source <snapshot> && ... eval '<command>' && pwd -P >| <file>"
function shellCommand(args) {
  const script = args[args.length - 1] || '';
  if (!script.includes('/shell-snapshots/')) return null;
  const m = script.match(/eval '([\s\S]*)'(?: < \/dev\/null)? && pwd -P >\| \S+$/) || script.match(/eval '([\s\S]*)'/);
  // The shell quotes a ' inside the command as '"'"' or '\''.
  return m ? m[1].replace(/'"'"'|'\\''/g, "'") : script;
}

async function listeningSockets() {
  const map = new Map(); // socket inode -> port
  for (const file of ['/proc/net/tcp', '/proc/net/tcp6']) {
    const text = await readFile(file, 'utf8').catch(() => '');
    for (const line of text.split('\n').slice(1)) {
      const p = line.trim().split(/\s+/);
      if (p[3] === '0A') map.set(p[9], parseInt(p[1].split(':')[1], 16));
    }
  }
  return map;
}

async function ports(pids, sockets) {
  const found = new Set();
  for (const pid of pids) {
    for (const fd of await readdir(`/proc/${pid}/fd`).catch(() => [])) {
      const m = (await readlink(`/proc/${pid}/fd/${fd}`).catch(() => '')).match(/^socket:\[(\d+)\]$/);
      if (m && sockets.has(m[1])) found.add(sockets.get(m[1]));
    }
  }
  return [...found].sort((a, b) => a - b);
}

async function shellsOf(pid, sockets) {
  const out = [];
  for (const c of await children(pid)) {
    const st = await procStat(c);
    if (!st || !SHELLS.has(st.comm)) continue;
    const args = (await readFile(`/proc/${c}/cmdline`, 'utf8').catch(() => '')).split('\0').filter(Boolean);
    const command = shellCommand(args);
    if (!command) continue;
    out.push({ pid: c, start: st.start, command, startedAt: await startedAt(st.start), ports: await ports(await tree(c), sockets) });
  }
  return out;
}

// Every live Claude Code process on this PC, from its registry file in ~/.claude/sessions.
export async function listRunning() {
  const files = (await readdir(SESSIONS).catch(() => [])).filter((f) => /^\d+\.json$/.test(f));
  const sockets = await listeningSockets();
  const out = [];
  for (const f of files) {
    let reg;
    try { reg = JSON.parse(await readFile(path.join(SESSIONS, f), 'utf8')); } catch { continue; }
    const st = await procStat(reg.pid);
    // Old files stay behind when a process ends; the start time also guards against a reused pid.
    if (!st || st.start !== String(reg.procStart)) continue;
    out.push({
      pid: reg.pid, sessionId: reg.sessionId, cwd: reg.cwd, name: reg.name, entrypoint: reg.entrypoint, kind: reg.kind,
      status: reg.status || 'idle', startedAt: reg.startedAt, shells: await shellsOf(reg.pid, sockets),
    });
  }
  return out.sort((a, b) => a.startedAt - b.startedAt);
}

// Stops a Bash shell of a live session, with everything it started (its process group).
export async function stopShell(pid, start) {
  const live = await listRunning();
  const shell = live.flatMap((s) => s.shells).find((sh) => sh.pid === pid && sh.start === start);
  if (!shell) throw new Error('This shell is not running any more.');
  const { pgid } = await procStat(pid);
  // Never signal a group the shell does not lead: it could be the Claude process's own group.
  const targets = pgid === pid ? [-pgid] : (await tree(pid)).reverse();
  const send = (sig) => { for (const t of targets) { try { process.kill(t, sig); } catch {} } };
  send('SIGTERM');
  setTimeout(() => send('SIGKILL'), 3000);
}

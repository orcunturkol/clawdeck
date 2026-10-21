import { app, BrowserWindow, ipcMain, dialog, shell, nativeTheme } from 'electron';
import { listSessions, getSessionMessages, getSessionInfo } from '@anthropic-ai/claude-agent-sdk';
import { readFile, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadLoginPath, findClaude, HOME, IS_WIN, unpacked } from './env.mjs';
import { Session } from './session.mjs';
import * as config from './config.mjs';
import { dailyTokens } from './usage.mjs';
import { BrowserPane } from './browser.mjs';
import { browserServer } from './browserTools.mjs';
import { Stt } from './stt.mjs';
import { Tts } from './tts.mjs';
import { listRunning, stopShell } from './running.mjs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
// Tests run with their own profile so they do not touch an open Clawdeck window.
if (process.env.CLAWDECK_PROFILE) app.setPath('userData', process.env.CLAWDECK_PROFILE);
const STATE_FILE = path.join(app.getPath('userData'), 'state.json');

app.setName('Clawdeck');
if (IS_WIN) app.setAppUserModelId('com.orcunturkol.clawdeck'); // taskbar grouping and the Start menu shortcut
else app.setDesktopName('clawdeck.desktop');
loadLoginPath();
const claudePath = findClaude();

let win = null;
let pane = null;
// Every chat keeps its own Claude Code process, so a chat goes on while you look at another one.
const MAX_LIVE = 10; // each live chat holds about 1 GB (Claude Code + its MCP servers)
const sessions = new Map(); // sessionId -> Session
let activeId = null;
const stt = new Stt();
const tts = new Tts();
const titles = new Map(); // sessionId -> { title, at }

// Session titles come from the transcript; read each one at most every 30 s.
async function sessionTitle(id, cwd) {
  const c = titles.get(id);
  if (c && Date.now() - c.at < 30000) return c.title;
  const info = await getSessionInfo(id, { dir: cwd }).catch(() => null);
  const title = info ? info.customTitle || info.summary || '' : '';
  // A new session has no title yet; ask again after 5 s.
  titles.set(id, { title, at: title ? Date.now() : Date.now() - 25000 });
  return title;
}
let state = { cwd: HOME, recent: [], webSearch: true, readAloud: false };

async function loadState() {
  try { state = { ...state, ...JSON.parse(await readFile(STATE_FILE, 'utf8')) }; } catch {}
  // A folder on the command line opens there: clawdeck ~/project
  const arg = process.argv.slice(1).filter((a) => !a.startsWith('-') && isDir(a) && path.resolve(a) !== app.getAppPath()).pop();
  if (arg) state.cwd = path.resolve(arg);
}
function isDir(p) {
  try { return statSync(p).isDirectory(); } catch { return false; }
}
function saveState() {
  writeFile(STATE_FILE, JSON.stringify(state, null, 2)).catch(() => {});
}

function emit(event) {
  if (win && !win.isDestroyed()) win.webContents.send('deck:event', event);
}

// Voice input and read aloud install from inside the app; installer users have no repo or npm.
let installing = null;
function install(what) {
  if (installing) throw new Error('Another install is still running.');
  const script = unpacked(path.join(ROOT, 'scripts', `setup-${what}.${IS_WIN ? 'ps1' : 'sh'}`));
  const [cmd, args] = IS_WIN
    ? ['powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script]]
    : ['sh', [script]];
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { env: process.env, windowsHide: true });
    installing = p;
    let last = '';
    const onData = (d) => {
      for (const line of String(d).split(/\r?\n/)) {
        if (!line.trim()) continue;
        last = line.trim();
        emit({ type: 'install', what, line: last });
      }
    };
    p.stdout.on('data', onData);
    p.stderr.on('data', onData);
    p.on('error', (e) => { installing = null; reject(e); });
    p.on('close', (code) => {
      installing = null;
      if (code === 0) resolve(); else reject(new Error(`The install stopped: ${last || `exit ${code}`}`));
    });
  });
}

function need(id) {
  const s = sessions.get(id || activeId);
  if (!s) throw new Error('This chat is not running. Open it again from the list.');
  return s;
}

// A process that ends on its own leaves the list.
function sessionEmit(event) {
  if (event.type === 'session-ended') sessions.delete(event.sessionId);
  emit(event);
  if (event.type === 'running' && !event.running) trim();
}

// Above the limit, close idle chats used longest ago. A working chat or one that waits for you stays.
function trim() {
  const idle = [...sessions.values()]
    .filter((s) => s.id !== activeId && !s.running && s.pending.size === 0)
    .sort((a, b) => a.lastUsed - b.lastUsed);
  while (sessions.size > MAX_LIVE && idle.length) {
    const s = idle.shift();
    s.close();
    sessions.delete(s.id);
    emit({ type: 'session-closed', sessionId: s.id });
  }
}

function startSession({ cwd, resume, model, effort, permissionMode }) {
  const live = resume && sessions.get(resume);
  const dir = live ? live.cwd : cwd;
  state.cwd = dir;
  state.recent = [dir, ...state.recent.filter((d) => d !== dir)].slice(0, 8);
  saveState();
  if (live) {
    activeId = live.id;
    live.lastUsed = Date.now();
    return { sessionId: live.id, cwd: dir, live: true };
  }
  const s = new Session({
    cwd, resume, model, effort, permissionMode, webSearch: state.webSearch, claudePath, emit: sessionEmit,
    mcpServers: { clawdeck: browserServer(pane) },
  });
  s.lastUsed = Date.now();
  sessions.set(s.id, s);
  activeId = s.id;
  trim();
  return { sessionId: s.id, cwd: dir, live: false };
}

function createWindow() {
  win = new BrowserWindow({
    width: 1480, height: 920, minWidth: 980, minHeight: 600,
    frame: false,
    title: 'Clawdeck',
    icon: path.join(ROOT, 'assets/icon.png'),
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#1e2124' : '#ecedee',
    webPreferences: {
      preload: path.join(ROOT, 'electron/preload.cjs'),
      contextIsolation: true, sandbox: true, nodeIntegration: false, spellcheck: true,
    },
  });
  pane = new BrowserPane(win, emit);
  // The app window may use the microphone and nothing else.
  const ses = win.webContents.session;
  ses.setPermissionRequestHandler((wc, perm, cb, details) => cb(wc === win.webContents && perm === 'media' && (details.mediaTypes || []).every((t) => t === 'audio')));
  ses.setPermissionCheckHandler((wc, perm) => wc === win?.webContents && perm === 'media');
  win.loadFile(path.join(ROOT, 'dist/index.html'));
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.on('maximize', () => emit({ type: 'window', maximized: true }));
  win.on('unmaximize', () => emit({ type: 'window', maximized: false }));
}

const handlers = {
  'win:minimize': () => win.minimize(),
  'win:maximize': () => (win.isMaximized() ? win.unmaximize() : win.maximize()),
  'win:close': () => win.close(),

  'app:state': () => ({ ...state, home: HOME, claudePath }),
  'dir:pick': async () => {
    const r = await dialog.showOpenDialog(win, { properties: ['openDirectory'], defaultPath: state.cwd });
    return r.canceled ? null : r.filePaths[0];
  },

  'session:start': (opts) => startSession(opts),
  'session:send': ({ sessionId, text, images }) => {
    const s = need(sessionId);
    s.lastUsed = Date.now();
    s.send(text, images);
  },
  'session:interrupt': ({ sessionId }) => need(sessionId).interrupt(),
  // Ends a chat's process; its history stays, so it can open again from the list.
  'session:close': ({ sessionId }) => {
    const s = sessions.get(sessionId);
    if (!s) return;
    if (sessionId === activeId) throw new Error('Open another chat before you close this one.');
    s.close();
    sessions.delete(sessionId);
    emit({ type: 'session-closed', sessionId });
  },
  'session:answer': ({ sessionId, id, ...answer }) => need(sessionId).answerPermission(id, answer),
  'session:init': async ({ sessionId }) => {
    const s = need(sessionId);
    const init = await s.q.initializationResult();
    return { ...init, sysinit: s.init || null, sessionId: s.id, cwd: s.cwd };
  },
  'session:setModel': ({ sessionId, model }) => need(sessionId).q.setModel(model || undefined),
  'session:setMode': ({ sessionId, mode }) => need(sessionId).q.setPermissionMode(mode),
  'session:setEffort': ({ sessionId, effort }) => need(sessionId).q.applyFlagSettings({ effortLevel: effort || null }),
  'session:setWebSearch': ({ on }) => {
    state.webSearch = Boolean(on);
    saveState();
    for (const s of sessions.values()) s.webSearch = state.webSearch;
  },
  'browser:bounds': (b) => pane.setBounds(b),
  'browser:hide': () => pane.hide(),
  'browser:state': () => pane.state(),
  'browser:navigate': ({ url }) => pane.navigate(url),
  'browser:back': () => pane.back(),
  'browser:forward': () => pane.forward(),
  'browser:reload': () => pane.reload(),
  'browser:control': ({ who }) => pane.setControl(who === 'user' ? 'user' : 'claude'),
  'running:list': async ({ detail }) => {
    const list = await listRunning({ detail });
    // Without a registry entry (an unknown Claude Code layout), this window still lists its own chats.
    for (const s of sessions.values()) {
      if (!list.some((r) => r.sessionId === s.id)) {
        list.push({ pid: 0, sessionId: s.id, cwd: s.cwd, name: '', entrypoint: 'sdk-ts', status: s.running ? 'busy' : 'idle', startedAt: s.lastUsed, shells: [] });
      }
    }
    for (const r of list) {
      r.title = await sessionTitle(r.sessionId, r.cwd);
      r.mine = sessions.has(r.sessionId);
      r.active = r.sessionId === activeId;
    }
    return list;
  },
  'running:stop': ({ pid, start }) => stopShell(pid, start),
  'tts:setEnabled': ({ on }) => {
    state.readAloud = Boolean(on);
    saveState();
    if (on) tts.start().catch(() => {}); // load the model before the first answer
  },
  'tts:say': ({ text }) => tts.say(text),
  'voice:status': () => ({ installed: stt.installed() }),
  'voice:install': () => install('voice'),
  'tts:status': () => ({ installed: tts.installed() }),
  'tts:install': () => install('tts'),
  'voice:transcribe': ({ bytes, ext }) => stt.transcribe(bytes, ext),
  'session:context': ({ sessionId }) => need(sessionId).q.getContextUsage({ detail: 'summary' }),

  'sessions:list': ({ cwd }) => listSessions({ dir: cwd, limit: 60 }),
  'sessions:messages': ({ id, cwd }) => getSessionMessages(id, { dir: cwd }),

  'mcp:status': async () => config.redactMcp(await need().q.mcpServerStatus()),
  'mcp:toggle': ({ name, enabled }) => need().q.toggleMcpServer(name, enabled),
  'mcp:reconnect': ({ name }) => need().q.reconnectMcpServer(name),

  'plugins:list': () => config.listPlugins(claudePath),
  'plugins:toggle': async ({ id, enabled }) => {
    await config.setPluginEnabled(claudePath, id, enabled);
    let fresh = null;
    for (const s of sessions.values()) {
      const r = await s.q.reloadPlugins().catch(() => null);
      if (r && s.id === activeId) fresh = { commands: r.commands, agents: r.agents };
    }
    return fresh;
  },

  'usage:limits': async () => {
    try {
      const u = await need().q.usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET({ skipBehaviors: true });
      return { live: true, limits: u.rate_limits, plan: u.subscription_type, session: u.session };
    } catch {
      return { live: false, limits: await config.cachedLimits() };
    }
  },
  'usage:daily': () => dailyTokens(),

  'hooks:list': async ({ cwd }) => config.listHooks(cwd, await config.listPlugins(claudePath).catch(() => [])),
  'memory:list': ({ cwd }) => config.memoryFiles(cwd),
  'memory:read': ({ cwd, file }) => config.readMemory(cwd, file),
  'memory:write': ({ cwd, file, content }) => config.writeMemory(cwd, file, content),
  'settings:defaults': () => config.readDefaults(),
  'settings:saveDefaults': (d) => config.saveDefaults(d),
};

for (const [channel, fn] of Object.entries(handlers)) {
  ipcMain.handle(channel, async (_e, arg) => fn(arg || {}));
}

app.whenReady().then(async () => {
  await loadState();
  createWindow();
});

app.on('window-all-closed', () => {
  for (const s of sessions.values()) s.close();
  tts.stop();
  app.quit();
});

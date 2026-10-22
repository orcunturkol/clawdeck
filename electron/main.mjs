import { app, BrowserWindow, ipcMain, dialog, shell, nativeTheme, safeStorage } from 'electron';
import { listSessions, getSessionMessages, getSessionInfo, query } from '@anthropic-ai/claude-agent-sdk';
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
import { Accounts, LOGIN } from './accounts.mjs';
import { signIn } from './login.mjs';

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
let accounts = null; // made when the app is ready, because the keyring needs that

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
let state = { cwd: HOME, recent: [], webSearch: true, readAloud: false, chatSettings: {} };

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

// Each chat keeps its model, effort and mode, also after its process closes. The newest 200 stay.
function rememberSettings(id, settings) {
  const all = state.chatSettings;
  delete all[id];
  all[id] = settings;
  for (const old of Object.keys(all).slice(0, -200)) delete all[old];
  saveState();
}

// A process that ends on its own leaves the list.
function sessionEmit(event) {
  if (event.type === 'session-ended') sessions.delete(event.sessionId);
  if (event.type === 'settings') rememberSettings(event.sessionId, event.settings);
  if (event.type === 'sdk') watchLimits(sessions.get(event.sessionId), event.msg);
  emit(event);
  if (event.type === 'running' && !event.running) trim();
}

// Above the limit, close idle chats used longest ago. A working chat, one that waits for you or one with remote control on stays.
function trim() {
  const idle = [...sessions.values()]
    .filter((s) => s.id !== activeId && !s.running && s.pending.size === 0 && !s.remote)
    .sort((a, b) => a.lastUsed - b.lastUsed);
  while (sessions.size > MAX_LIVE && idle.length) {
    const s = idle.shift();
    s.close();
    sessions.delete(s.id);
    emit({ type: 'session-closed', sessionId: s.id });
  }
}

// Usage per account, and the switch when an account reaches its limit.
function watchLimits(s, m) {
  if (!s) return;
  if (m.type === 'rate_limit_event') {
    s.lastLimit = m.rate_limit_info;
    accounts.note(s.account, m.rate_limit_info);
  }
  if (m.type === 'assistant' && m.error === 'rate_limit' && !m.parent_tool_use_id) s.limitHit = true;
  if (m.type !== 'result' || !s.limitHit) return;
  s.limitHit = false;
  const resetsAt = s.lastLimit?.status === 'rejected' ? s.lastLimit.resetsAt : null;
  accounts.limitReached(s.account, resetsAt);
  if (!accounts.data.auto) return;
  const next = accounts.pick(s.settings.account, s.account);
  if (next === s.account || accounts.blocked(accounts.find(next))) {
    const first = accounts.firstReset();
    if (first) emit({ type: 'error', sessionId: s.id, message: `All your accounts reached their limits. The first one is free again at ${new Date(first).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}.` });
    return;
  }
  // Only this chat moves. The prompt is in the history already, so it goes on from there on the new account.
  setImmediate(() => {
    if (sessions.get(s.id) !== s || s.running || s.pending.size) return;
    restartSession(s, { continued: true }).send('Continue where you stopped.');
  });
}

// The process options for a chat whose own account is own.
function accountOptions(own, current = null) {
  const account = accounts.pick(own, current);
  return { own, account, env: accounts.env(account) };
}

// A chat moves to another account: its process starts again on the same history.
function restartSession(s, { continued = false } = {}) {
  s.close();
  const next = new Session({
    cwd: s.cwd, resume: s.fresh ? undefined : s.id, id: s.id, model: s.settings.model, effort: s.settings.effort, permissionMode: s.settings.mode,
    webSearch: state.webSearch, claudePath, emit: sessionEmit, mcpServers: { clawdeck: browserServer(pane) },
    ...accountOptions(s.settings.account, s.account),
  });
  next.lastUsed = s.lastUsed;
  sessions.set(next.id, next);
  emit({ type: 'session-restarted', sessionId: next.id, account: next.account, name: accounts.name(next.account), continued, fresh: next.fresh });
  return next;
}

async function startSession({ cwd, resume }) {
  const d = await config.readDefaults(); // read first, so no other start runs between the checks below
  const live = resume && sessions.get(resume);
  const dir = live ? live.cwd : cwd;
  state.cwd = dir;
  state.recent = [dir, ...state.recent.filter((d) => d !== dir)].slice(0, 8);
  saveState();
  if (live) {
    activeId = live.id;
    live.lastUsed = Date.now();
    return { sessionId: live.id, cwd: dir, live: true, settings: live.settings, account: live.account };
  }
  // A chat opened again keeps its own values; a new one starts with the saved defaults and the folder's account.
  const { model, effort, mode, account } = (resume && state.chatSettings[resume]) || { model: d.model, effort: d.effortLevel, mode: d.defaultMode };
  const s = new Session({
    cwd, resume, model, effort, permissionMode: mode || 'default', webSearch: state.webSearch, claudePath, emit: sessionEmit,
    mcpServers: { clawdeck: browserServer(pane) }, ...accountOptions(account || accounts.forFolder(dir)),
  });
  s.lastUsed = Date.now();
  sessions.set(s.id, s);
  activeId = s.id;
  trim();
  return { sessionId: s.id, cwd: dir, live: false, settings: s.settings, account: s.account };
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
    let s = need(sessionId);
    // An idle chat whose account should change (a limit ended, or you picked another one) moves before it sends.
    if (s.account !== accounts.pick(s.settings.account, s.account) && !s.running && s.pending.size === 0) s = restartSession(s);
    s.lastUsed = Date.now();
    s.send(text, images);
  },
  'session:interrupt': ({ sessionId }) => need(sessionId).interrupt(),
  // This chat and new chats in its folder use the account.
  'session:setAccount': ({ sessionId, account }) => {
    let s = need(sessionId);
    accounts.setFolder(s.cwd, account);
    s.set({ account });
    if (s.account !== accounts.pick(account, s.account) && !s.running && s.pending.size === 0) s = restartSession(s);
    return { account: s.account };
  },
  'session:setRemote': ({ sessionId, on }) => need(sessionId).setRemote(on),
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
    if (s.account === LOGIN && init.account?.email) accounts.label(LOGIN, init.account.email);
    return { ...init, sysinit: s.init || null, sessionId: s.id, cwd: s.cwd };
  },
  'session:setModel': async ({ sessionId, model }) => {
    const s = need(sessionId);
    await s.q.setModel(model || undefined);
    s.set({ model: model || '' });
  },
  'session:setMode': async ({ sessionId, mode }) => {
    const s = need(sessionId);
    await s.q.setPermissionMode(mode);
    s.set({ mode });
  },
  'session:setEffort': async ({ sessionId, effort }) => {
    const s = need(sessionId);
    await s.q.applyFlagSettings({ effortLevel: effort || null });
    s.set({ effort: effort || '' });
  },
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
    // A chat with no message yet holds nothing to show.
    const shown = list.filter((r) => !sessions.get(r.sessionId)?.fresh);
    for (const r of shown) {
      r.title = await sessionTitle(r.sessionId, r.cwd);
      r.mine = sessions.has(r.sessionId);
      r.active = r.sessionId === activeId;
    }
    return shown;
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
    // A token account cannot read the usage API, and Claude Code's cache belongs to the login; show what its chats saw last.
    const s = sessions.get(activeId);
    if (s && s.account !== LOGIN) return { live: false, limits: accounts.find(s.account)?.usage || null };
    try {
      const u = await need().q.usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET({ skipBehaviors: true });
      return { live: true, limits: u.rate_limits, plan: u.subscription_type, session: u.session };
    } catch {
      return { live: false, limits: await config.cachedLimits() };
    }
  },
  'usage:daily': () => dailyTokens(),

  'accounts:list': () => accounts.view(),
  'accounts:add': ({ name, token }) => addAccount(String(name || '').trim(), String(token || '').trim()),
  'accounts:signIn': () => signInAccount(),
  'accounts:remove': ({ id }) => accounts.remove(id),
  'accounts:move': ({ id, delta }) => accounts.move(id, delta),
  'accounts:setAuto': ({ on }) => accounts.setAuto(on),
  'accounts:setGoBack': ({ on }) => accounts.setGoBack(on),

  'hooks:list': async ({ cwd }) => config.listHooks(cwd, await config.listPlugins(claudePath).catch(() => [])),
  'memory:list': ({ cwd }) => config.memoryFiles(cwd),
  'memory:read': ({ cwd, file }) => config.readMemory(cwd, file),
  'memory:write': ({ cwd, file, content }) => config.writeMemory(cwd, file, content),
  'settings:saveDefaults': (d) => config.saveDefaults(d),
};

for (const [channel, fn] of Object.entries(handlers)) {
  ipcMain.handle(channel, async (_e, arg) => fn(arg || {}));
}

// Tokens stay encrypted by the system keyring. Linux without a keyring has only a fixed key, so no tokens there.
function keyringReady() {
  if (!safeStorage.isEncryptionAvailable()) return false;
  return process.platform !== 'linux' || safeStorage.getSelectedStorageBackend() !== 'basic_text';
}

// Sign in inside Clawdeck: Claude Code makes the token, Clawdeck keeps it.
let signingIn = false;
async function signInAccount() {
  if (process.platform !== 'linux') throw new Error('Sign-in inside Clawdeck works on Linux only. Paste a token instead.');
  if (!keyringReady()) throw new Error('No system keyring is available, so Clawdeck cannot store the token safely.');
  if (signingIn) throw new Error('A sign-in window is open already.');
  signingIn = true;
  try {
    const { token, email } = await signIn({ claudePath, parent: win, dataDir: app.getPath('userData') });
    if (email && email === accounts.find(LOGIN).email) throw new Error(`${email} is your Claude Code login already. Sign in with another account.`);
    const name = email || `Account ${accounts.data.list.length + 1}`;
    // The token comes straight from Claude Code, so no check message is necessary.
    return await addAccount(name, token, { check: false });
  } finally {
    signingIn = false;
  }
}

// One short message on the new account: Claude Code says at once when a token is wrong.
async function addAccount(name, token, { check = true } = {}) {
  if (!name) throw new Error('Give the account a name.');
  if (!/^sk-ant-oat\d+-\S+$/.test(token)) throw new Error('This is not a Claude Code token. It starts with sk-ant-oat.');
  if (!keyringReady()) throw new Error('No system keyring is available, so Clawdeck cannot store the token safely.');
  if (!check) {
    accounts.add(name, token);
    return accounts.view();
  }
  const env = { ...process.env, CLAUDE_CODE_OAUTH_TOKEN: token };
  const q = query({
    prompt: 'Reply with OK.',
    options: { pathToClaudeCodeExecutable: claudePath, cwd: app.getPath('userData'), env, model: 'haiku', maxTurns: 1, persistSession: false, tools: [] },
  });
  let error = null;
  let limit = null;
  try {
    for await (const m of q) {
      if (m.type === 'rate_limit_event') limit = m.rate_limit_info;
      if (m.type === 'assistant' && m.error) error = m.error;
      if (m.type === 'result') break;
    }
  } finally {
    q.close();
  }
  if (error === 'authentication_failed') throw new Error('Claude did not accept this token. Make a new one with `claude setup-token`.');
  if (error && error !== 'rate_limit') throw new Error(`The token check failed: ${error}.`);
  const id = accounts.add(name, token);
  if (limit) accounts.note(id, limit);
  if (error === 'rate_limit') accounts.limitReached(id, limit?.status === 'rejected' ? limit.resetsAt : null);
  return accounts.view();
}

app.whenReady().then(async () => {
  await loadState();
  accounts = new Accounts({
    file: path.join(app.getPath('userData'), 'accounts.json'),
    encrypt: (t) => safeStorage.encryptString(t).toString('base64'),
    decrypt: (t) => safeStorage.decryptString(Buffer.from(t, 'base64')),
    onChange: (view) => emit({ type: 'accounts', view }),
  });
  // Limit marks clear when the limits reset, also while nobody writes.
  setInterval(() => emit({ type: 'accounts', view: accounts.view() }), 60000);
  createWindow();
});

app.on('window-all-closed', () => {
  for (const s of sessions.values()) s.close();
  tts.stop();
  app.quit();
});

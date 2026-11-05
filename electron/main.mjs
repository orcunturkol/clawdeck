import { app, BrowserWindow, ipcMain, dialog, shell, nativeTheme, safeStorage } from 'electron';
import { listSessions, getSessionMessages, getSessionInfo, renameSession, query } from '@anthropic-ai/claude-agent-sdk';
import { readFile, writeFile } from 'node:fs/promises';
import { statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadLoginPath, findClaude, HOME, IS_WIN } from './env.mjs';
import { Session } from './session.mjs';
import * as config from './config.mjs';
import { dailyTokens, lastAnswer } from './usage.mjs';
import { BrowserPane } from './browser.mjs';
import { browserServer } from './browserTools.mjs';
import { listRunning, stopShell } from './running.mjs';
import { Accounts, LOGIN } from './accounts.mjs';
import { signIn, CliLogin } from './login.mjs';
import { Updater } from './update.mjs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
// Tests run with their own profile so they do not touch an open Clawdeck window.
if (process.env.CLAWDECK_PROFILE) app.setPath('userData', process.env.CLAWDECK_PROFILE);
const STATE_FILE = path.join(app.getPath('userData'), 'state.json');

app.setName('Clawdeck');
if (IS_WIN) app.setAppUserModelId('com.orcunturkol.clawdeck'); // taskbar grouping and the Start menu shortcut
else app.setDesktopName('clawdeck.desktop');
loadLoginPath();
let claudePath = findClaude();

let win = null;
let pane = null;
// Every chat keeps its own Claude Code process, so a chat goes on while you look at another one.
const MAX_LIVE = 10; // each live chat holds about 1 GB (Claude Code + its MCP servers)
const sessions = new Map(); // sessionId -> Session
let activeId = null;
const titles = new Map(); // sessionId -> { title, at }
let accounts = null; // made when the app is ready, because the keyring needs that
let updater = null;

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

// The session Claude answered in last comes first. Without an answer in the transcript, `since` counts.
async function byLastAnswer(list, cwdOf, since) {
  for (const r of list) r.lastAnswer = (await lastAnswer(r.sessionId, cwdOf(r))) || since(r) || 0;
  return list.sort((a, b) => b.lastAnswer - a.lastAnswer);
}
let state = { cwd: HOME, recent: [], webSearch: true, chatSettings: {}, layout: {} };

// A folder on the command line opens there: clawdeck ~/project
function folderArg(argv, cwd = process.cwd()) {
  const arg = argv.slice(1).filter((a) => !a.startsWith('-') && isDir(path.resolve(cwd, a)) && path.resolve(cwd, a) !== app.getAppPath()).pop();
  return arg ? path.resolve(cwd, arg) : null;
}

async function loadState() {
  try { state = { ...state, ...JSON.parse(await readFile(STATE_FILE, 'utf8')) }; } catch {}
  const arg = folderArg(process.argv);
  if (arg) state.cwd = arg;
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

// The login's usage: live through one of its chats, else Claude Code's own cache. Neither sends a prompt.
async function loginLimits() {
  const s = [...sessions.values()].find((x) => x.account === LOGIN);
  try {
    const u = s && await s.q.usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET({ skipBehaviors: true });
    if (u?.rate_limits?.five_hour) return { live: true, limits: u.rate_limits, plan: u.subscription_type, session: u.session, at: Date.now() };
  } catch {}
  const c = await config.cachedLimits();
  return { live: false, limits: c?.limits || null, at: c?.at || Date.now() };
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
function restartSession(s, { continued = false, quiet = false } = {}) {
  s.close();
  const next = new Session({
    cwd: s.cwd, resume: s.fresh ? undefined : s.id, id: s.id, model: s.settings.model, effort: s.settings.effort, ultracode: s.settings.ultracode, permissionMode: s.settings.mode,
    webSearch: state.webSearch, claudePath, emit: sessionEmit, mcpServers: { clawdeck: browserServer(pane) },
    ...accountOptions(s.settings.account, s.account),
  });
  next.lastUsed = s.lastUsed;
  sessions.set(next.id, next);
  emit({ type: 'session-restarted', sessionId: next.id, account: next.account, name: accounts.name(next.account), continued, fresh: next.fresh, quiet });
  return next;
}

// Claude Code may be installed while the app is open, so look again before a chat starts.
function needClaude() {
  claudePath = claudePath || findClaude();
  if (!claudePath) {
    throw new Error(IS_WIN
      ? 'Claude Code was not found. Install it (https://claude.com/claude-code), run `claude` once to log in, then open Clawdeck again.'
      : 'Claude Code was not found in PATH or ~/.local/bin. Install it, run `claude` once to log in, then open Clawdeck again.');
  }
  return claudePath;
}

async function startSession({ cwd, resume }) {
  needClaude();
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
  const { model, effort, ultracode, mode, account } = (resume && state.chatSettings[resume]) || { model: d.model, effort: d.effortLevel, mode: d.defaultMode };
  const s = new Session({
    cwd, resume, model, effort, ultracode, permissionMode: mode || 'default', webSearch: state.webSearch, claudePath, emit: sessionEmit,
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
  // The app window needs no device or browser permission.
  const ses = win.webContents.session;
  ses.setPermissionRequestHandler((_wc, _perm, cb) => cb(false));
  ses.setPermissionCheckHandler(() => false);
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
  'app:updateState': () => updater.view(),
  'app:update': () => updater.install(),
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
    // A new effort level alone turns ultracode off, so send it along to keep it on.
    await s.q.applyFlagSettings({ effortLevel: effort || null, ...(s.settings.ultracode && { ultracode: true }) });
    s.set({ effort: effort || '' });
  },
  'session:setUltracode': async ({ sessionId, on }) => {
    const s = need(sessionId);
    await s.q.applyFlagSettings({ ultracode: Boolean(on) });
    s.set({ ultracode: Boolean(on) });
  },
  'session:setWebSearch': ({ on }) => {
    state.webSearch = Boolean(on);
    saveState();
    for (const s of sessions.values()) s.webSearch = state.webSearch;
  },
  // Pane widths in px, from the drag handles: { rail, side, browser }. Each drag saves one of them.
  'app:setLayout': (l) => {
    state.layout = { ...state.layout, ...l };
    saveState();
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
    return byLastAnswer(shown, (r) => r.cwd, (r) => r.startedAt);
  },
  'running:stop': ({ pid, start }) => stopShell(pid, start),
  'session:context': ({ sessionId }) => need(sessionId).q.getContextUsage({ detail: 'summary' }),

  'sessions:list': async ({ cwd }) => byLastAnswer(await listSessions({ dir: cwd, limit: 60 }), (s) => s.cwd || cwd, (s) => s.lastModified),
  'sessions:messages': ({ id, cwd }) => getSessionMessages(id, { dir: cwd }),
  'sessions:rename': async ({ id, cwd, title }) => {
    const name = String(title || '').trim();
    if (!name) throw new Error('Give the session a name.');
    const s = sessions.get(id);
    const dir = s?.cwd || cwd;
    // A live chat must take the name itself, or its process writes the old one back. Not in the SDK types yet.
    if (s && typeof s.q.renameSession === 'function') await s.q.renameSession(name, id);
    // Any other session, or one whose process did not write the name: it goes into the transcript directly.
    if ((await getSessionInfo(id, { dir }).catch(() => null))?.customTitle !== name) await renameSession(id, name, { dir });
    titles.delete(id);
  },

  'mcp:status': async () => config.redactMcp(await need().q.mcpServerStatus()),
  'mcp:toggle': ({ name, enabled }) => need().q.toggleMcpServer(name, enabled),
  'mcp:reconnect': ({ name }) => need().q.reconnectMcpServer(name),

  'plugins:list': () => config.listPlugins(needClaude()),
  'plugins:toggle': async ({ id, enabled }) => {
    await config.setPluginEnabled(needClaude(), id, enabled);
    let fresh = null;
    for (const s of sessions.values()) {
      const r = await s.q.reloadPlugins().catch(() => null);
      if (r && s.id === activeId) fresh = { commands: r.commands, agents: r.agents };
    }
    return fresh;
  },

  'usage:limits': async () => {
    const login = await loginLimits();
    if (login.limits) accounts.noteLimits(LOGIN, login.limits, login.at);
    // A token account has no usage API; show what its chats saw last.
    const s = sessions.get(activeId);
    if (s && s.account !== LOGIN) return { live: false, limits: accounts.find(s.account)?.usage || null };
    return login;
  },
  'usage:daily': () => dailyTokens(),

  'accounts:list': () => accounts.view(),
  'accounts:add': ({ name, token }) => addAccount(String(name || '').trim(), String(token || '').trim()),
  'accounts:signIn': () => signInAccount(),
  'accounts:login': () => startLogin(),
  'accounts:loginCode': ({ code }) => finishLogin(code),
  'accounts:loginCancel': () => { cliLogin?.cancel(); cliLogin = null; },
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
  if (process.platform !== 'linux' && !IS_WIN) throw new Error('Sign-in inside Clawdeck works on Linux and Windows only. Paste a token instead.');
  if (!keyringReady()) throw new Error('No system keyring is available, so Clawdeck cannot store the token safely.');
  if (signingIn) throw new Error('A sign-in window is open already.');
  signingIn = true;
  try {
    const { token, email } = await signIn({ claudePath: needClaude(), parent: win, dataDir: app.getPath('userData') });
    if (email && email === accounts.find(LOGIN).email) throw new Error(`${email} is your Claude Code login already. Sign in with another account.`);
    const name = email || `Account ${accounts.data.list.length + 1}`;
    // The token comes straight from Claude Code, so no check message is necessary.
    return await addAccount(name, token, { check: false });
  } finally {
    signingIn = false;
  }
}

// Claude Code's own login, for a computer where it never logged in.
let cliLogin = null;
async function startLogin() {
  cliLogin?.cancel();
  const login = new CliLogin({ claudePath: needClaude(), onUrl: () => {} });
  cliLogin = login;
  // Claude Code opens the browser itself; the link is for when it did not.
  const end = Date.now() + 20000;
  while (!login.url && Date.now() < end) {
    await Promise.race([login.done.catch(() => {}), new Promise((r) => setTimeout(r, 200))]);
    if (login.p.exitCode != null) break;
  }
  if (login.p.exitCode === 0) return { url: '', done: true }; // logged in already
  if (!login.url) { login.cancel(); throw new Error(`Claude Code did not start the login. ${login.out.trim().split('\n').pop() || ''}`); }
  return { url: login.url };
}

async function finishLogin(code) {
  const login = cliLogin;
  if (!login) throw new Error('Start the login again.');
  if (!String(code || '').trim()) throw new Error('Paste the code from the sign-in page.');
  login.code(code);
  try {
    await login.done;
  } finally {
    if (cliLogin === login) cliLogin = null;
  }
  // Chats on the login start again, so they read the new login.
  for (const s of [...sessions.values()]) {
    if (s.account === LOGIN && !s.running && s.pending.size === 0) restartSession(s, { quiet: true });
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
    options: { pathToClaudeCodeExecutable: needClaude(), cwd: app.getPath('userData'), env, model: 'haiku', maxTurns: 1, persistSession: false, tools: [] },
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

// One window per profile: starting Clawdeck again (Start menu, taskbar, `clawdeck dir`) shows the open one.
const primary = app.requestSingleInstanceLock();
if (!primary) app.quit();
app.on('second-instance', (_e, argv, cwd) => {
  if (!win || win.isDestroyed()) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
  const dir = folderArg(argv, cwd);
  if (dir) emit({ type: 'open-folder', cwd: dir });
});

app.whenReady().then(async () => {
  if (!primary) return;
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
  // Looks for a new release at start and every 6 hours.
  updater = new Updater({ root: ROOT, emit, beforeQuit: () => { for (const s of sessions.values()) s.close(); } });
  setTimeout(() => updater.check(), 10000);
  setInterval(() => updater.check(), 6 * 3600 * 1000);
});

app.on('window-all-closed', () => {
  for (const s of sessions.values()) s.close();
  app.quit();
});

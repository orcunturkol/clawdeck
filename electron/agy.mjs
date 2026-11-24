import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import readline from 'node:readline';
import path from 'node:path';
import { HOME, IS_WIN } from './env.mjs';
import { AcpTranslator, MODE_TO_AGY, MODE_FROM_AGY, fixPath, toolView } from './acpTranslate.mjs';

export const AGY = 'antigravity'; // the provider name, also the account id of every Antigravity chat

// The Antigravity CLI: CLAWDECK_AGY, PATH, then the folders its installer uses.
export function findAgy() {
  if (process.env.CLAWDECK_AGY) return existsSync(process.env.CLAWDECK_AGY) ? process.env.CLAWDECK_AGY : null;
  const exe = IS_WIN ? 'agy.exe' : 'agy';
  const dirs = [
    ...(process.env.PATH || '').split(path.delimiter),
    IS_WIN ? path.join(process.env.LOCALAPPDATA || path.join(HOME, 'AppData', 'Local'), 'agy', 'bin') : path.join(HOME, '.local', 'bin'),
  ].filter(Boolean);
  for (const dir of dirs) if (existsSync(path.join(dir, exe))) return path.join(dir, exe);
  return null;
}

// agy says this when it has no Google login on this computer.
export class AgyLoginError extends Error {}
const isAuthError = (e) => e?.code === -32000 || /auth|sign in|log in|logged in|login|credential/i.test(e?.message || '');

// One `agy acp` process serves all Antigravity chats over JSON-RPC on stdio.
class AcpClient {
  constructor(agyPath, cwd) {
    this.p = spawn(agyPath, ['acp'], { cwd, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    this.next = 0;
    this.waits = new Map();
    this.chats = new Map(); // ACP sessionId -> AgySession
    this.early = new Map(); // ACP sessionId -> updates that came before the chat was known
    this.stderr = [];
    this.dead = false;
    readline.createInterface({ input: this.p.stdout }).on('line', (line) => this.onLine(line));
    this.p.stderr.on('data', (d) => { this.stderr.push(String(d)); if (this.stderr.length > 30) this.stderr.shift(); });
    this.p.on('error', (e) => this.die(e.message));
    this.p.on('exit', (code) => this.die(`Antigravity stopped (exit code ${code}).`));
    this.ready = this.request('initialize', { protocolVersion: 1, clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false } });
  }

  die(message) {
    if (this.dead) return;
    this.dead = true;
    for (const w of this.waits.values()) w.reject(new Error(message));
    this.waits.clear();
    for (const s of this.chats.values()) s.onExit(message, this.stderr.slice(-5).join(''));
  }

  send(msg) {
    if (!this.dead) this.p.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', ...msg })}\n`);
  }

  request(method, params) {
    if (this.dead) return Promise.reject(new Error('Antigravity is not running.'));
    const id = ++this.next;
    return new Promise((resolve, reject) => {
      this.waits.set(id, { resolve, reject });
      this.send({ id, method, params });
    });
  }

  notify(method, params) { this.send({ method, params }); }

  async onLine(line) {
    let m;
    try { m = JSON.parse(line); } catch { return; }
    if (m.method === undefined) {
      const w = this.waits.get(m.id);
      if (!w) return;
      this.waits.delete(m.id);
      if (m.error) w.reject(Object.assign(new Error(m.error.message), { code: m.error.code, data: m.error.data }));
      else w.resolve(m.result);
      return;
    }
    const chat = this.chats.get(m.params?.sessionId);
    if (m.method === 'session/update') {
      if (chat) chat.onUpdate(m.params.update);
      else if (m.params?.sessionId) this.early.set(m.params.sessionId, [...(this.early.get(m.params.sessionId) || []), m.params.update].slice(-50));
      return;
    }
    if (m.id === undefined) return;
    if (m.method === 'session/request_permission' && chat) {
      const result = await chat.askPermission(m.params);
      this.send({ id: m.id, result });
      return;
    }
    this.send({ id: m.id, error: { code: -32601, message: `Clawdeck does not support ${m.method}.` } });
  }

  // A new chat: updates that came before session/new answered go to it now.
  register(id, chat) {
    this.chats.set(id, chat);
    const early = this.early.get(id) || [];
    this.early.delete(id);
    for (const u of early) chat.onUpdate(u);
  }

  close() {
    this.dead = true;
    try { this.p.stdin.end(); } catch {}
    setTimeout(() => { try { this.p.kill(); } catch {} }, 2000).unref?.();
  }
}

let client = null;
// The shared process starts on first use, and again after it stopped.
export async function acp(agyPath, cwd) {
  if (!client || client.dead) client = new AcpClient(agyPath, cwd);
  const c = client;
  try {
    c.info = await c.ready;
  } catch (e) {
    throw new Error(`Antigravity did not start: ${e.message}${c.stderr.length ? `\n${c.stderr.slice(-3).join('')}` : ''}`);
  }
  return c;
}
export function closeAcp() { client?.close(); client = null; }

const samePath = (a, b) => {
  const n = (p) => path.resolve(fixPath(p) || '').replace(/[\\/]+$/, '');
  return IS_WIN ? n(a).toLowerCase() === n(b).toLowerCase() : n(a) === n(b);
};

// The Antigravity conversations of a folder, in the shape of the Agent SDK session list.
export async function listAgySessions(agyPath, cwd, titles = {}) {
  const c = await acp(agyPath, cwd);
  const out = [];
  let cursor;
  for (let page = 0; page < 5; page++) {
    const r = await c.request('session/list', { cwd, ...(cursor && { cursor }) });
    for (const s of r.sessions || []) {
      if (!samePath(s.cwd, cwd) || !s.title) continue;
      out.push({ sessionId: s.sessionId, summary: s.title || '', customTitle: titles[s.sessionId] || '', cwd, lastModified: Date.parse(s.updatedAt) || 0, provider: AGY });
    }
    cursor = r.nextCursor;
    if (!cursor) break;
  }
  return out;
}

const option = (opts, id) => opts?.find((o) => o.id === id);

// One Antigravity chat, with the same face as Session for main.mjs and the renderer.
export class AgySession {
  // resume: an Antigravity conversation id. Its history replays into this.history.
  static async open({ agyPath, cwd, resume, model, effort, permissionMode, emit, mcpServers = [] }) {
    const c = await acp(agyPath, cwd);
    const s = new AgySession({ c, cwd, emit, resume });
    let r;
    try {
      if (resume) {
        s.id = resume;
        c.chats.set(resume, s);
        r = await c.request('session/load', { sessionId: resume, cwd, mcpServers });
        s.history.push(...s.tr.finish());
        s.loading = false;
        s.tr = new AcpTranslator({ sessionId: resume, live: true });
      } else {
        r = await c.request('session/new', { cwd, mcpServers });
        s.id = r.sessionId;
        s.tr = new AcpTranslator({ sessionId: s.id, live: true });
        s.loading = false;
        c.register(s.id, s);
      }
    } catch (e) {
      if (s.id) c.chats.delete(s.id);
      if (isAuthError(e)) throw new AgyLoginError('Antigravity is not signed in on this computer.');
      throw new Error(`Antigravity did not open the chat: ${e.message}`);
    }
    s.loading = false;
    s.config(r);
    s.tier = r._meta?.antigravity?.tier || null;
    // A chat keeps its own model, thinking level and mode; a new one starts with Antigravity's.
    if (model && model !== s.settings.model) await s.setModel(model).catch(() => {});
    if (effort && effort !== s.settings.effort) await s.setEffort(effort).catch(() => {});
    if (permissionMode && permissionMode !== s.settings.mode) await s.setMode(permissionMode).catch(() => {});
    return s;
  }

  constructor({ c, cwd, emit, resume }) {
    this.provider = AGY;
    this.account = AGY;
    this.c = c;
    this.cwd = cwd;
    this.emit = emit;
    this.fresh = !resume;
    this.loading = Boolean(resume);
    this.history = [];
    this.tr = new AcpTranslator({ sessionId: resume || '', live: false });
    this.pending = new Map();
    this.queue = [];
    this.running = false;
    this.closed = false;
    this.remote = false;
    this.webSearch = true;
    this.turns = 0;
    this.title = '';
    this.plan = null; // the plan agy wrote in this turn, in Plan mode
    this.commands = [];
    this.context = null;
    this.modes = [];
    this.options = [];
    this.settings = { model: '', effort: '', ultracode: false, mode: 'default', account: AGY, provider: AGY };
  }

  // Model, thinking level and mode come from the session's config options.
  config(r) {
    if (r.modes) this.modes = r.modes.availableModes || [];
    if (r.configOptions) this.options = r.configOptions;
    const model = option(this.options, 'model')?.currentValue;
    const effort = option(this.options, 'thought_level')?.currentValue;
    const modeId = option(this.options, 'mode')?.currentValue || r.modes?.currentModeId;
    this.set({
      ...(model && { model }),
      ...(effort && { effort }),
      ...(modeId && MODE_FROM_AGY[modeId] && { mode: MODE_FROM_AGY[modeId] }),
    });
  }

  initInfo() {
    const efforts = (option(this.options, 'thought_level')?.options || []).map((o) => o.value);
    return {
      provider: AGY,
      models: (option(this.options, 'model')?.options || []).map((o) => ({ value: o.value, displayName: o.name, supportedEffortLevels: efforts })),
      modes: this.modes.map((m) => MODE_FROM_AGY[m.id]).filter(Boolean),
      commands: this.commands,
      agents: [],
      account: { email: 'Google login', subscriptionType: this.tier?.name },
      agy_version: this.c.info?.agentInfo?.version,
      current_permission_mode: this.settings.mode,
    };
  }

  emitSdk(msgs) {
    for (const msg of msgs) this.emit({ type: 'sdk', sessionId: this.id, account: AGY, msg });
  }

  onUpdate(u) {
    switch (u.sessionUpdate) {
      case 'usage_update':
        if (u.size) this.context = { percentage: (u.used / u.size) * 100, totalTokens: u.used, maxTokens: u.size };
        return;
      case 'session_info_update':
        if (u.title) this.title = u.title;
        return;
      case 'available_commands_update':
        this.commands = (u.availableCommands || []).map((x) => ({ name: x.name, description: x.description || '', argumentHint: x.input?.hint || '' }));
        if (!this.loading) this.emit({ type: 'init', sessionId: this.id, init: this.initInfo() });
        return;
      case 'current_mode_update':
        if (MODE_FROM_AGY[u.currentModeId]) this.set({ mode: MODE_FROM_AGY[u.currentModeId] });
        return;
      case 'config_option_update':
        this.config({ configOptions: u.configOptions });
        return;
      case 'tool_call': {
        // In Plan mode agy writes its plan as a file that asks for feedback. It shows as a plan to approve.
        const a = u.rawInput || u.args || {};
        if (!this.loading && a.ArtifactMetadata?.RequestFeedback && typeof a.Content === 'string') this.plan = a.Content;
        break;
      }
      default:
        break;
    }
    const msgs = this.tr.update(u);
    if (this.loading) this.history.push(...msgs);
    else this.emitSdk(msgs);
  }

  set(change) {
    const next = { ...this.settings, ...change };
    if (Object.keys(next).every((k) => next[k] === this.settings[k])) return;
    this.settings = next;
    if (this.id) this.emit({ type: 'settings', sessionId: this.id, settings: this.settings });
  }

  setRunning(running) {
    if (this.running === running) return;
    this.running = running;
    this.emit({ type: 'running', sessionId: this.id, running });
  }

  send(text, images = []) {
    // A new message answers an open plan prompt.
    for (const [id, p] of this.pending) {
      if (!p.plan) continue;
      this.pending.delete(id);
      this.emit({ type: 'permission-cancel', sessionId: this.id, id });
    }
    const prompt = [
      ...images.map((img) => ({ type: 'image', mimeType: img.mediaType, data: img.data })),
      ...(text ? [{ type: 'text', text }] : []),
    ];
    this.fresh = false;
    this.queue.push(prompt);
    this.setRunning(true);
    if (!this.turn) this.drain();
  }

  // Antigravity runs one prompt at a time; more prompts wait for their turn.
  async drain() {
    while (this.queue.length && !this.closed) {
      const prompt = this.queue.shift();
      const t0 = Date.now();
      this.turn = this.c.request('session/prompt', { sessionId: this.id, prompt });
      let r = null;
      let error = null;
      try { r = await this.turn; } catch (e) { error = e.message; }
      if (this.closed) break;
      this.turns += 1;
      this.emitSdk(this.tr.end({ stopReason: r?.stopReason, usage: r?.usage, error, ms: Date.now() - t0, turns: this.turns }));
      if (this.plan && !this.queue.length && r?.stopReason === 'end_turn') this.askPlan(this.plan);
      this.plan = null;
    }
    this.turn = null;
    this.setRunning(false);
  }

  askPermission(params) {
    const call = params.toolCall || {};
    const view = toolView(call);
    const options = params.options || [];
    return new Promise((resolve) => {
      const id = randomUUID();
      this.pending.set(id, { resolve, options });
      this.emit({
        type: 'permission', sessionId: this.id, id, toolName: view.name, input: view.input, agent: 'Antigravity',
        canAlwaysAllow: options.some((o) => o.kind === 'allow_always'), toolUseId: call.toolCallId,
      });
    });
  }

  // The same prompt as Claude Code's plan approval. Approve: agy leaves Plan mode and starts the work.
  askPlan(plan) {
    const id = randomUUID();
    this.pending.set(id, { plan: true, resolve: () => {} });
    this.emit({ type: 'permission', sessionId: this.id, id, toolName: 'ExitPlanMode', input: { plan }, agent: 'Antigravity' });
  }

  answerPermission(id, { allow, always }) {
    const p = this.pending.get(id);
    if (!p) return;
    this.pending.delete(id);
    if (p.plan) {
      // Keep planning: the user writes what to change in the next message.
      if (allow) this.setMode('default').catch(() => {}).then(() => this.send('The plan is approved. Implement it now.'));
      return;
    }
    const kinds = allow ? (always ? ['allow_always', 'allow_once'] : ['allow_once', 'allow_always']) : ['reject_once', 'reject_always'];
    const pick = kinds.map((k) => p.options.find((o) => o.kind === k)).find(Boolean);
    p.resolve(pick ? { outcome: { outcome: 'selected', optionId: pick.optionId } } : { outcome: { outcome: 'cancelled' } });
  }

  cancelPending() {
    for (const [id, p] of this.pending) {
      p.resolve({ outcome: { outcome: 'cancelled' } });
      this.emit({ type: 'permission-cancel', sessionId: this.id, id });
    }
    this.pending.clear();
  }

  async interrupt() {
    this.queue = [];
    this.cancelPending();
    this.c.notify('session/cancel', { sessionId: this.id });
  }

  async setModel(model) {
    const r = await this.c.request('session/set_config_option', { sessionId: this.id, configId: 'model', value: model });
    this.config(r || {});
  }

  async setEffort(effort) {
    const r = await this.c.request('session/set_config_option', { sessionId: this.id, configId: 'thought_level', value: effort });
    this.config(r || {});
  }

  async setMode(mode) {
    const modeId = MODE_TO_AGY[mode];
    if (!modeId) throw new Error('Antigravity has no such permission mode.');
    await this.c.request('session/set_mode', { sessionId: this.id, modeId });
    this.set({ mode });
  }

  async setRemote() { throw new Error('Remote control is not available for Antigravity chats.'); }

  onExit(message, detail) {
    if (this.closed) return;
    this.closed = true;
    this.cancelPending();
    this.setRunning(false);
    this.emit({ type: 'error', sessionId: this.id, message, detail });
    this.emit({ type: 'session-ended', sessionId: this.id });
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    this.cancelPending();
    if (this.running) this.c.notify('session/cancel', { sessionId: this.id });
    this.c.request('session/close', { sessionId: this.id }).catch(() => {});
    this.c.chats.delete(this.id);
  }
}

import { readFileSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

// Claude accounts in priority order: the first one is the main account.
// The Claude Code login needs no token; other accounts use a token from `claude setup-token`.
// Each chat has its own account; a folder remembers the account last picked in it.
// A local account is a model on an Ollama server: no token, no limits, never picked automatically.
export const LOGIN = 'login';
const HOUR = 3600 * 1000;
export const LOCAL_URL = 'http://localhost:11434';
export const LOCAL_CONTEXT = 32768;

export class Accounts {
  constructor({ file, encrypt, decrypt, onChange = () => {} }) {
    this.file = file;
    this.encrypt = encrypt;
    this.decrypt = decrypt;
    this.onChange = onChange;
    let saved = {};
    try { saved = JSON.parse(readFileSync(file, 'utf8')); } catch {}
    const { active, returnToMain, ...rest } = saved; // older files had one active account for all chats
    this.data = { list: [], folders: {}, auto: false, goBack: returnToMain ?? true, ...rest };
    if (!this.find(LOGIN)) this.data.list.unshift({ id: LOGIN, name: 'Claude Code login' });
  }

  get main() { return this.data.list[0].id; }
  find(id) { return this.data.list.find((a) => a.id === id); }
  name(id) { return this.find(id)?.name || 'Unknown account'; }
  blocked(a, now = Date.now()) { return (a.blockedUntil || 0) > now; }
  isLocal(id) { return this.find(id)?.kind === 'local'; }

  save() {
    writeFileSync(this.file, JSON.stringify(this.data, null, 2), { mode: 0o600 });
    this.onChange(this.view());
  }

  // What the window may see: never a token.
  view() {
    const now = Date.now();
    const { list, auto, goBack } = this.data;
    return {
      auto, goBack,
      list: list.map(({ token, ...a }, i) => ({ ...a, main: i === 0, blocked: this.blocked(a, now) })),
    };
  }

  // The environment for a Claude Code process on this account. env replaces the whole environment.
  env(id) {
    const env = { ...process.env };
    delete env.CLAUDE_CODE_OAUTH_TOKEN;
    const a = this.find(id);
    if (a?.token) env.CLAUDE_CODE_OAUTH_TOKEN = this.decrypt(a.token);
    if (a?.kind === 'local') Object.assign(env, localEnv(a));
    return env;
  }

  // The same server and model again only gets the new context size.
  addLocal({ url, model, context }) {
    const old = this.data.list.find((a) => a.kind === 'local' && a.url === url && a.model === model);
    if (old) {
      old.context = context;
      this.save();
      return old.id;
    }
    const a = { id: randomUUID(), kind: 'local', name: `${model} (local)`, url, model, context, addedAt: Date.now() };
    this.data.list.push(a);
    this.save();
    return a.id;
  }

  // The same name again gets the new token; a sign-in renews an account this way.
  add(name, token) {
    const old = this.data.list.find((a) => a.id !== LOGIN && a.name === name);
    if (old) {
      old.token = this.encrypt(token);
      delete old.blockedUntil;
      this.save();
      return old.id;
    }
    const a = { id: randomUUID(), name, token: this.encrypt(token), addedAt: Date.now() };
    this.data.list.push(a);
    this.save();
    return a.id;
  }

  remove(id) {
    if (id === LOGIN) throw new Error('The Claude Code login stays. Log out with `claude auth logout` instead.');
    this.data.list = this.data.list.filter((a) => a.id !== id);
    for (const [dir, a] of Object.entries(this.data.folders)) if (a === id) delete this.data.folders[dir];
    this.save();
  }

  // The account new chats in this folder start on.
  forFolder(dir) { return this.find(this.data.folders[dir]) ? this.data.folders[dir] : this.main; }
  setFolder(dir, id) {
    if (!this.find(id)) throw new Error('This account is not in the list.');
    if (this.data.folders[dir] === id) return;
    this.data.folders[dir] = id;
    this.save();
  }

  // Up or down one place; the first place is the main account.
  move(id, delta) {
    const list = this.data.list;
    const i = list.findIndex((a) => a.id === id);
    const j = i + delta;
    if (i < 0 || j < 0 || j >= list.length) return;
    // The main account is the default for every folder, so it stays a Claude account.
    if (j === 0 && list[i].kind === 'local') return;
    if (i === 0 && list[j].kind === 'local') return;
    [list[i], list[j]] = [list[j], list[i]];
    this.save();
  }

  setAuto(on) { this.data.auto = Boolean(on); this.save(); }
  setGoBack(on) { this.data.goBack = Boolean(on); this.save(); }

  label(id, email) {
    const a = this.find(id);
    if (!a || a.email === email) return;
    a.email = email;
    this.save();
  }

  // Usage from the usage API or Claude Code's cache: percents and reset times.
  noteLimits(id, limits, at = Date.now()) {
    const a = this.find(id);
    if (!a || !limits) return;
    a.usage = {};
    for (const k of ['five_hour', 'seven_day', 'seven_day_opus', 'seven_day_sonnet']) {
      if (limits[k]?.utilization != null) a.usage[k] = { utilization: limits[k].utilization, resets_at: limits[k].resets_at };
    }
    a.usageAt = at;
    this.save();
  }

  // Usage as last seen in a rate limit event from a chat on this account.
  // An event can lack a window, so each window keeps its last value.
  note(id, info) {
    const a = this.find(id);
    if (!a || !info?.unifiedWindows) return;
    a.usage = { ...(a.usage || {}) };
    for (const [k, w] of Object.entries(info.unifiedWindows)) a.usage[k] = { utilization: w.utilization * 100, resets_at: w.resetsAt };
    a.usageAt = Date.now();
    this.save();
  }

  limitReached(id, resetsAt, now = Date.now()) {
    const a = this.find(id);
    if (!a || a.kind === 'local') return;
    a.blockedUntil = resetsAt ? resetsAt * 1000 : now + HOUR;
    this.save();
  }

  // The account a chat runs on: its own one, or with automatic switching on, a free one while its own is at the limit.
  // Automatic switching uses Claude accounts only; you pick a local model yourself.
  pick(own, current = null, now = Date.now()) {
    if (!this.find(own)) own = this.main;
    if (!this.data.auto || this.isLocal(own)) return own;
    const claude = (a) => a.kind !== 'local';
    const free = (id) => Boolean(this.find(id)) && claude(this.find(id)) && !this.blocked(this.find(id), now);
    if (free(own) && (current === own || this.data.goBack || !free(current))) return own;
    if (current !== own && free(current)) return current;
    if (free(own)) return own;
    return this.data.list.find((a) => claude(a) && !this.blocked(a, now))?.id || own;
  }

  // The earliest time a Claude account becomes free again, when all of them are at their limit.
  firstReset(now = Date.now()) {
    const times = this.data.list.filter((a) => a.kind !== 'local').map((a) => a.blockedUntil || 0);
    return times.every((t) => t > now) ? Math.min(...times) : null;
  }
}

// Claude Code against an Ollama server, with the same values as a manual setup:
// the model for every role, the server's real context size, thinking off, and no traffic to Anthropic.
function localEnv(a) {
  return {
    ANTHROPIC_BASE_URL: a.url,
    ANTHROPIC_AUTH_TOKEN: 'ollama',
    ANTHROPIC_API_KEY: '',
    ANTHROPIC_DEFAULT_HAIKU_MODEL: a.model,
    ANTHROPIC_DEFAULT_SONNET_MODEL: a.model,
    ANTHROPIC_DEFAULT_OPUS_MODEL: a.model,
    ANTHROPIC_DEFAULT_FABLE_MODEL: a.model,
    CLAUDE_CODE_SUBAGENT_MODEL: a.model,
    CLAUDE_CODE_MAX_CONTEXT_TOKENS: String(a.context || LOCAL_CONTEXT),
    MAX_THINKING_TOKENS: '0',
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
    DISABLE_TELEMETRY: '1',
    DISABLE_ERROR_REPORTING: '1',
    CLAUDE_CODE_DISABLE_TERMINAL_TITLE: '1',
  };
}

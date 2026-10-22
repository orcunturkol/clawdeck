import { readFileSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

// Claude accounts in priority order: the first one is the main account.
// The Claude Code login needs no token; other accounts use a token from `claude setup-token`.
// Each chat has its own account; a folder remembers the account last picked in it.
export const LOGIN = 'login';
const HOUR = 3600 * 1000;

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
    return env;
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

  // Usage as last seen in a rate limit event from a chat on this account.
  note(id, info) {
    const a = this.find(id);
    if (!a || !info?.unifiedWindows) return;
    a.usage = {};
    for (const [k, w] of Object.entries(info.unifiedWindows)) a.usage[k] = { utilization: w.utilization * 100, resets_at: w.resetsAt };
    a.usageAt = Date.now();
    this.save();
  }

  limitReached(id, resetsAt, now = Date.now()) {
    const a = this.find(id);
    if (!a) return;
    a.blockedUntil = resetsAt ? resetsAt * 1000 : now + HOUR;
    this.save();
  }

  // The account a chat runs on: its own one, or with automatic switching on, a free one while its own is at the limit.
  pick(own, current = null, now = Date.now()) {
    if (!this.find(own)) own = this.main;
    if (!this.data.auto) return own;
    const free = (id) => Boolean(this.find(id)) && !this.blocked(this.find(id), now);
    if (free(own) && (current === own || this.data.goBack || !free(current))) return own;
    if (current !== own && free(current)) return current;
    if (free(own)) return own;
    return this.data.list.find((a) => !this.blocked(a, now))?.id || own;
  }

  // The earliest time an account becomes free again, when all of them are at their limit.
  firstReset(now = Date.now()) {
    const times = this.data.list.map((a) => a.blockedUntil || 0);
    return times.every((t) => t > now) ? Math.min(...times) : null;
  }
}

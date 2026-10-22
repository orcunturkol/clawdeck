import { query } from '@anthropic-ai/claude-agent-sdk';
import { randomUUID } from 'node:crypto';

// One live Claude Code process. Prompts go in through an open input stream.
export class Session {
  constructor({ cwd, resume, model, effort, permissionMode, webSearch = true, mcpServers, claudePath, emit }) {
    this.cwd = cwd;
    this.id = resume || randomUUID();
    this.emit = emit;
    this.pending = new Map();
    this.queue = [];
    this.wake = null;
    this.closed = false;
    this.running = false;
    this.stderr = [];
    this.webSearch = webSearch;
    this.settings = { model: model || '', effort: effort || '', mode: permissionMode || 'default' };
    this.remote = false;
    this.sent = new Set(); // uuids of prompts this app sent

    const options = {
      pathToClaudeCodeExecutable: claudePath,
      cwd,
      systemPrompt: { type: 'preset', preset: 'claude_code' },
      includePartialMessages: true,
      promptSuggestions: true,
      allowDangerouslySkipPermissions: true,
      canUseTool: (name, input, opts) => this.askPermission(name, input, opts),
      // The web search switch can change mid-session, so a hook checks it on every call.
      hooks: { PreToolUse: [{ matcher: 'WebSearch|WebFetch', hooks: [async () => this.webHook()] }] },
      stderr: (line) => { this.stderr.push(line); if (this.stderr.length > 50) this.stderr.shift(); },
    };
    if (resume) options.resume = resume; else options.sessionId = this.id;
    if (model) options.model = model;
    if (effort) options.effort = effort;
    if (permissionMode) options.permissionMode = permissionMode;
    if (mcpServers) options.mcpServers = mcpServers;

    this.q = query({ prompt: this.input(), options });
    this.pump();
  }

  webHook() {
    if (this.webSearch) return { continue: true };
    return {
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: 'Web search is off in Clawdeck. Answer without web access, and tell the user that they can turn web search on below the message box.',
      },
    };
  }

  async *input() {
    while (!this.closed) {
      while (this.queue.length) yield this.queue.shift();
      await new Promise((r) => (this.wake = r));
    }
  }

  async pump() {
    try {
      for await (const msg of this.q) {
        if (msg.type === 'system' && msg.subtype === 'init') this.init = msg;
        // Claude Code changes the mode itself too, for example when you accept a plan.
        if (msg.type === 'system' && msg.permissionMode && msg.permissionMode !== this.settings.mode) this.set({ mode: msg.permissionMode });
        if (msg.type === 'result') this.setRunning(false);
        if (msg.type === 'system' && msg.subtype === 'bridge_state') {
          if (msg.state === 'connected') this.remote = true;
          if (msg.state === 'failed' || msg.state === 'policy_disabled') this.remote = false;
        }
        if (this.isRemotePrompt(msg)) {
          this.setRunning(true);
          this.emit({ type: 'sdk', sessionId: this.id, msg: { ...msg, remotePrompt: true } });
          continue;
        }
        this.emit({ type: 'sdk', sessionId: this.id, msg });
      }
    } catch (err) {
      if (!this.closed) this.emit({ type: 'error', sessionId: this.id, message: err.message, detail: this.stderr.slice(-8).join('\n') });
    }
    this.setRunning(false);
    if (!this.closed) this.emit({ type: 'session-ended', sessionId: this.id });
  }

  // With remote control on, a prompt typed on claude.ai or the phone comes in as a user message this app did not send.
  isRemotePrompt(msg) {
    if (!this.remote || msg.type !== 'user' || msg.parent_tool_use_id || msg.isMeta || msg.isSynthetic) return false;
    if (this.sent.has(msg.uuid)) return false;
    const c = msg.message?.content;
    if (typeof c === 'string') return Boolean(c.trim());
    return Array.isArray(c) && !c.some((b) => b.type === 'tool_result') && c.some((b) => b.type === 'text' || b.type === 'image');
  }

  // Remote control: the same chat on claude.ai/code and in the Claude app. Not in the SDK types yet.
  async setRemote(on) {
    if (typeof this.q.enableRemoteControl !== 'function') throw new Error('This Agent SDK version has no remote control.');
    const r = await this.q.enableRemoteControl(on);
    this.remote = on;
    return { url: r?.session_url || '' };
  }

  set(change) {
    this.settings = { ...this.settings, ...change };
    this.emit({ type: 'settings', sessionId: this.id, settings: this.settings });
  }

  setRunning(running) {
    if (this.running === running) return;
    this.running = running;
    this.emit({ type: 'running', sessionId: this.id, running });
  }

  send(text, images = []) {
    const content = [
      ...images.map((img) => ({ type: 'image', source: { type: 'base64', media_type: img.mediaType, data: img.data } })),
      ...(text ? [{ type: 'text', text }] : []),
    ];
    const uuid = randomUUID();
    this.sent.add(uuid);
    this.queue.push({ type: 'user', message: { role: 'user', content }, parent_tool_use_id: null, session_id: this.id, uuid });
    this.setRunning(true);
    this.wake?.();
  }

  askPermission(toolName, input, opts) {
    return new Promise((resolve) => {
      const id = randomUUID();
      this.pending.set(id, { resolve, input, suggestions: opts.suggestions });
      opts.signal?.addEventListener('abort', () => {
        if (!this.pending.delete(id)) return;
        this.emit({ type: 'permission-cancel', sessionId: this.id, id });
        resolve({ behavior: 'deny', message: 'Cancelled.' });
      });
      this.emit({
        type: 'permission', sessionId: this.id, id, toolName, input,
        title: opts.title, displayName: opts.displayName, decisionReason: opts.decisionReason,
        blockedPath: opts.blockedPath, canAlwaysAllow: Boolean(opts.suggestions?.length),
        toolUseId: opts.toolUseID,
      });
    });
  }

  answerPermission(id, { allow, always, updatedInput, message }) {
    const p = this.pending.get(id);
    if (!p) return;
    this.pending.delete(id);
    if (allow) {
      p.resolve({
        behavior: 'allow',
        updatedInput: updatedInput ?? p.input,
        ...(always && p.suggestions ? { updatedPermissions: p.suggestions } : {}),
      });
    } else {
      p.resolve({ behavior: 'deny', message: message || 'The user denied this action.' });
    }
  }

  async interrupt() {
    for (const id of [...this.pending.keys()]) this.answerPermission(id, { allow: false, message: 'Stopped by the user.' });
    await this.q.interrupt().catch(() => {});
  }

  close() {
    this.closed = true;
    for (const id of [...this.pending.keys()]) this.answerPermission(id, { allow: false });
    this.wake?.();
    try { this.q.close(); } catch {}
  }
}

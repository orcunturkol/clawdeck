// Turns Antigravity ACP session updates into the Agent SDK message shapes that the chat already shows.

// Clawdeck's permission modes and the Antigravity ones. Antigravity has no "don't ask" or "bypass" mode.
export const MODE_TO_AGY = { default: 'default', acceptEdits: 'accept-edits', auto: 'auto', plan: 'plan' };
export const MODE_FROM_AGY = Object.fromEntries(Object.entries(MODE_TO_AGY).map(([k, v]) => [v, k]));

// agy writes some paths as /C:/x; Windows needs C:/x.
export const fixPath = (p) => (typeof p === 'string' ? p.replace(/^\/([A-Za-z]:[\\/])/, '$1') : p);

// Antigravity tools in the names and inputs that the tool rows know.
export function toolView(call) {
  const a = call.rawInput || call.args || {};
  const path = fixPath(a.Path || a.AbsolutePath || a.TargetFile || call.locations?.[0]?.path);
  const diff = (call.content || []).find((c) => c.type === 'diff');
  const mcp = /^mcp_(clawdeck)_(.+)$/.exec(call.name || '');
  if (mcp) return { name: `mcp__${mcp[1]}__${mcp[2]}`, input: a };
  switch (call.name) {
    case 'run_command': return { name: 'Bash', input: { command: a.CommandLine, description: a.toolSummary } };
    case 'write_file': case 'write_to_file': return { name: 'Write', input: { file_path: path, content: a.Content ?? a.CodeContent ?? diff?.newText ?? '' } };
    case 'edit_file': case 'replace_file_content': case 'multi_replace_file_content':
      return { name: 'Edit', input: { file_path: path, old_string: diff?.oldText ?? a.Target ?? '', new_string: diff?.newText ?? a.Replacement ?? '' } };
    case 'view_file': case 'read_file': return { name: 'Read', input: { file_path: path } };
    case 'grep_search': return { name: 'Grep', input: { pattern: a.Query, path: fixPath(a.SearchPath) } };
    case 'find_by_name': return { name: 'Glob', input: { pattern: a.Pattern, path: fixPath(a.SearchDirectory) } };
    case 'list_dir': return { name: 'Glob', input: { pattern: '*', path: fixPath(a.DirectoryPath) } };
    case 'read_url_content': return { name: 'WebFetch', input: { url: a.Url } };
    case 'search_web': return { name: 'WebSearch', input: { query: a.query || a.Query } };
  }
  if (call.kind === 'edit' && diff) return { name: 'Edit', input: { file_path: fixPath(diff.path), old_string: diff.oldText || '', new_string: diff.newText || '' } };
  if (call.kind === 'execute') return { name: 'Bash', input: { command: call.title || a.CommandLine || '' } };
  return { name: call.name || call.title || 'Tool', input: a };
}

function outputOf(call) {
  const parts = (call.content || []).flatMap((c) => (c.type === 'content' && c.content?.type === 'text' ? [c.content.text] : []));
  if (parts.length) return parts.join('\n');
  return typeof call.rawOutput?.output === 'string' ? call.rawOutput.output : '';
}

// One translator per chat. live: stream text as it comes (a running chat), or not (history).
export class AcpTranslator {
  constructor({ sessionId, live = true }) {
    this.sessionId = sessionId;
    this.live = live;
    this.block = null; // { type: 'text' | 'thinking', text }
    this.tools = new Map(); // toolCallId -> { done }
    this.user = null; // user message parts while history replays
    this.plan = 0;
  }

  base(extra) { return { session_id: this.sessionId, parent_tool_use_id: null, ...extra }; }

  // The text or thinking that streamed so far becomes one full block.
  flushBlock(out) {
    if (!this.block) return;
    const b = this.block;
    this.block = null;
    if (!b.text) return;
    const content = b.type === 'text' ? [{ type: 'text', text: b.text }] : [{ type: 'thinking', thinking: b.text }];
    out.push(this.base({ type: 'assistant', message: { role: 'assistant', content } }));
  }

  flushUser(out) {
    if (!this.user) return;
    out.push(this.base({ type: 'user', message: { role: 'user', content: this.user } }));
    this.user = null;
  }

  chunk(out, type, text) {
    this.flushUser(out);
    if (this.block?.type !== type) {
      this.flushBlock(out);
      this.block = { type, text: '' };
      if (this.live) {
        out.push(this.base({ type: 'stream_event', event: { type: 'message_start' } }));
        out.push(this.base({ type: 'stream_event', event: { type: 'content_block_start', index: 0, content_block: { type } } }));
      }
    }
    this.block.text += text;
    if (this.live) {
      const delta = type === 'text' ? { type: 'text_delta', text } : { type: 'thinking_delta', thinking: text };
      out.push(this.base({ type: 'stream_event', event: { type: 'content_block_delta', index: 0, delta } }));
    }
  }

  toolStart(out, call) {
    const view = toolView(call);
    this.tools.set(call.toolCallId, { done: false, name: view.name });
    out.push(this.base({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id: call.toolCallId, name: view.name, input: view.input }] } }));
  }

  toolEnd(out, call) {
    const t = this.tools.get(call.toolCallId);
    if (!t || t.done) return;
    t.done = true;
    const failed = call.status === 'failed';
    const text = outputOf(call) || (failed ? 'The tool failed.' : '');
    out.push(this.base({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: call.toolCallId, content: text, is_error: failed }] } }));
  }

  // One ACP session/update in, a list of SDK-shaped messages out.
  update(u) {
    const out = [];
    switch (u.sessionUpdate) {
      case 'agent_message_chunk':
        if (u.content?.type === 'text') this.chunk(out, 'text', u.content.text);
        break;
      case 'agent_thought_chunk':
        if (u.content?.type === 'text') this.chunk(out, 'thinking', u.content.text);
        break;
      case 'user_message_chunk': {
        this.flushBlock(out);
        const c = u.content || {};
        const part = c.type === 'image' ? { type: 'image', source: { type: 'base64', media_type: c.mimeType, data: c.data } } : c.type === 'text' ? { type: 'text', text: c.text } : null;
        if (part) this.user = [...(this.user || []), part];
        break;
      }
      case 'tool_call': {
        this.flushBlock(out);
        this.flushUser(out);
        if (!this.tools.has(u.toolCallId)) this.toolStart(out, u);
        if (u.status === 'completed' || u.status === 'failed') this.toolEnd(out, u);
        break;
      }
      case 'tool_call_update': {
        if (!this.tools.has(u.toolCallId)) { this.flushBlock(out); this.toolStart(out, u); }
        if (u.status === 'completed' || u.status === 'failed') this.toolEnd(out, u);
        break;
      }
      case 'plan': {
        this.flushBlock(out);
        const id = `plan-${this.sessionId}-${++this.plan}`;
        const todos = (u.entries || []).map((e) => ({ content: e.content, status: e.status, activeForm: e.content }));
        out.push(this.base({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id, name: 'TodoWrite', input: { todos } }] } }));
        out.push(this.base({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: '' }] } }));
        break;
      }
      default: break;
    }
    return out;
  }

  // The end of a turn: the answer of session/prompt, or its error.
  end({ stopReason, usage, error, ms, turns }) {
    const out = [];
    this.flushBlock(out);
    this.flushUser(out);
    // A tool that never reported its end (for example after Stop) is over now.
    for (const [id, t] of this.tools) {
      if (t.done) continue;
      t.done = true;
      out.push(this.base({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: 'Stopped.', is_error: true }] } }));
    }
    // A stop that is not end_turn (cancelled, max_tokens, refusal) shows as "Stopped: <reason>".
    const subtype = error ? 'error_during_execution' : stopReason === 'end_turn' ? 'success' : stopReason;
    out.push(this.base({
      type: 'result', subtype, is_error: subtype !== 'success', duration_ms: ms, num_turns: turns,
      result: error || '', errors: error ? [error] : undefined,
      usage: usage && { input_tokens: usage.inputTokens, output_tokens: usage.outputTokens, cache_read_input_tokens: usage.cachedReadTokens },
    }));
    return out;
  }

  // History ends with no prompt answer.
  finish() {
    const out = [];
    this.flushBlock(out);
    this.flushUser(out);
    return out;
  }
}

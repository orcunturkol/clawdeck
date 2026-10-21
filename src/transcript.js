// Turns SDK messages into display items for the chat.

let seq = 0;
const nid = () => `i${++seq}`;

export const emptyTranscript = () => ({ items: [], tools: {}, live: null, permissions: [], running: false, status: null });

function textOf(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.filter((b) => b.type === 'text').map((b) => b.text).join('\n');
}

// Session files hold CLI wrappers around commands and reminders; show what the user typed.
function cleanUserText(text) {
  const cmd = text.match(/<command-name>(.*?)<\/command-name>[\s\S]*?(?:<command-args>([\s\S]*?)<\/command-args>)?/);
  if (cmd) return { text: `${cmd[1]} ${cmd[2] || ''}`.trim() };
  const out = text.match(/<local-command-stdout>([\s\S]*?)<\/local-command-stdout>/);
  if (out) return { notice: out[1].trim() };
  if (/^<(local-command-caveat|system-reminder|task-notification)/.test(text.trim())) return {};
  return { text: text.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '').trim() };
}

function addTool(s, block, parent) {
  const tool = { id: block.id, name: block.name, input: block.input || {}, status: 'running', parent, children: [] };
  s.tools = { ...s.tools, [block.id]: tool };
  // ToolSearch "select:" only loads a tool before its first use; the user does not need to see it.
  const loadOnly = block.name === 'ToolSearch' && String(block.input?.query || '').startsWith('select:');
  if (loadOnly) return;
  if (parent && s.tools[parent]) {
    const p = s.tools[parent];
    s.tools[parent] = { ...p, children: [...p.children, block.id] };
  } else {
    s.items = [...s.items, { kind: 'tool', id: block.id }];
  }
}

function setResult(s, block, structured) {
  const t = s.tools[block.tool_use_id];
  if (!t) return;
  s.tools = { ...s.tools, [t.id]: { ...t, status: block.is_error ? 'error' : 'done', result: block.content, structured } };
}

// The full block replaces its streamed copy.
function dropLive(s, type) {
  if (!s.live) return;
  const keys = Object.keys(s.live.blocks).map(Number).filter((k) => s.live.blocks[k].type === type).sort((a, b) => a - b);
  if (!keys.length) return;
  const blocks = { ...s.live.blocks };
  delete blocks[keys[0]];
  s.live = { blocks };
}

function onAssistant(s, msg) {
  const parent = msg.parent_tool_use_id;
  for (const b of msg.message?.content || []) {
    if (!parent) dropLive(s, b.type);
    if (b.type === 'tool_use' || b.type === 'server_tool_use') addTool(s, b, parent);
    else if (parent) continue;
    else if (b.type === 'text' && b.text.trim()) s.items = [...s.items, { kind: 'text', id: nid(), text: b.text }];
    else if (b.type === 'thinking' && b.thinking?.trim()) s.items = [...s.items, { kind: 'thinking', id: nid(), text: b.thinking }];
  }
}

function onUser(s, msg, fromHistory) {
  const content = msg.message?.content;
  if (Array.isArray(content)) {
    const results = content.filter((b) => b.type === 'tool_result');
    // tool_use_result is the structured output, sent for single results.
    for (const b of results) setResult(s, b, results.length === 1 ? msg.tool_use_result : undefined);
  }
  if (!fromHistory || msg.parent_tool_use_id || msg.isMeta) return;
  if (Array.isArray(content) && content.some((b) => b.type === 'tool_result')) return;
  const c = cleanUserText(textOf(content));
  const images = Array.isArray(content) ? content.filter((b) => b.type === 'image').length : 0;
  if (c.text || images) s.items = [...s.items, { kind: 'user', id: nid(), text: c.text || '', images }];
  else if (c.notice) s.items = [...s.items, { kind: 'notice', id: nid(), text: c.notice }];
}

function onStream(s, msg) {
  if (msg.parent_tool_use_id) return;
  const e = msg.event;
  if (e.type === 'message_start') s.live = { blocks: {} };
  else if (e.type === 'content_block_start' && s.live) {
    const t = e.content_block.type;
    if (t === 'text' || t === 'thinking') s.live = { blocks: { ...s.live.blocks, [e.index]: { type: t, text: '' } } };
  } else if (e.type === 'content_block_delta' && s.live?.blocks[e.index]) {
    const add = e.delta.text ?? e.delta.thinking ?? '';
    const b = s.live.blocks[e.index];
    s.live = { blocks: { ...s.live.blocks, [e.index]: { ...b, text: b.text + add } } };
  } else if (e.type === 'message_stop') s.live = null;
}

const NOTICES = {
  compact_boundary: () => 'Conversation compacted to free context.',
  api_retry: (m) => `API error, retry ${m.attempt ?? ''} of ${m.max_retries ?? ''}.`,
  local_command_output: (m) => m.content,
  informational: (m) => m.content || m.message,
  task_notification: (m) => m.summary || `Background task ${m.status}.`,
};

export function applyMessage(state, msg, fromHistory = false) {
  const s = { ...state };
  switch (msg.type) {
    case 'assistant': onAssistant(s, msg); break;
    case 'user': onUser(s, msg, fromHistory); break;
    case 'stream_event': onStream(s, msg); break;
    case 'result': {
      s.running = false;
      s.live = null;
      s.status = null;
      const tools = { ...s.tools };
      for (const [k, t] of Object.entries(tools)) if (t.status === 'running') tools[k] = { ...t, status: 'done' };
      s.tools = tools;
      s.items = [...s.items, {
        kind: 'result', id: nid(), ok: !msg.is_error, subtype: msg.subtype,
        cost: msg.total_cost_usd, ms: msg.duration_ms, turns: msg.num_turns,
        error: msg.is_error ? (msg.errors?.join('\n') || msg.result) : null,
      }];
      break;
    }
    case 'system': {
      if (msg.subtype === 'status') { s.status = msg.status || null; break; }
      const make = NOTICES[msg.subtype];
      const text = make && make(msg);
      if (text) s.items = [...s.items, { kind: 'notice', id: nid(), text }];
      break;
    }
    default: break;
  }
  return s;
}

export function addUserPrompt(state, text, images) {
  return { ...state, running: true, items: [...state.items, { kind: 'user', id: nid(), text, images: images.length }] };
}

export function fromHistory(messages) {
  let s = emptyTranscript();
  for (const m of messages) s = applyMessage(s, m, true);
  return s;
}

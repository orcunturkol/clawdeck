// Run: npm test. The fixtures are real agy 1.5.15 ACP output (paths replaced).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { AcpTranslator, toolView, fixPath } from '../electron/acpTranslate.mjs';
import { applyMessage, fromHistory, emptyTranscript } from '../src/transcript.js';

const lines = (name) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8').trim().split('\n').map((l) => JSON.parse(l));

// Replays a live turn: updates in, SDK messages out, then the chat state of the renderer.
function liveTurn() {
  const tr = new AcpTranslator({ sessionId: 's1', live: true });
  const msgs = [];
  let stop = null;
  for (const m of lines('agy-turn.ndjson')) {
    if (m.method === 'session/update') msgs.push(...tr.update(m.params.update));
    if (m.result?.stopReason) stop = m.result;
  }
  msgs.push(...tr.end({ stopReason: stop.stopReason, usage: stop.usage, ms: 1000, turns: 1 }));
  let t = { ...emptyTranscript(), running: true };
  for (const m of msgs) t = applyMessage(t, m);
  return { msgs, t };
}

test('a live turn shows thinking, three tools with results, the answer and a success result', () => {
  const { msgs, t } = liveTurn();
  const tools = Object.values(t.tools);
  assert.deepEqual(tools.map((x) => x.name), ['Write', 'Edit', 'Bash']);
  assert.ok(tools.every((x) => x.status === 'done'));
  assert.equal(tools[0].input.content, 'banana');
  assert.equal(tools[1].input.old_string, 'banana');
  assert.equal(tools[1].input.new_string, 'apple');
  assert.equal(tools[2].input.command, 'dir');
  assert.match(String(tools[2].result), /Command exited with code 0/);
  const kinds = t.items.map((i) => i.kind);
  assert.ok(kinds.includes('thinking'));
  assert.equal(kinds.at(-1), 'result');
  assert.ok(t.items.at(-1).ok);
  assert.ok(t.items.some((i) => i.kind === 'text' && i.text.trim()));
  assert.equal(t.live, null, 'the streamed copy is gone after the full blocks came');
  assert.equal(t.running, false);
  assert.ok(msgs.some((m) => m.type === 'stream_event'), 'a live turn streams');
});

test('streamed text and the full block are the same text', () => {
  const { msgs } = liveTurn();
  const streamed = msgs.filter((m) => m.type === 'stream_event' && m.event.delta?.type === 'text_delta').map((m) => m.event.delta.text).join('');
  const full = msgs.filter((m) => m.type === 'assistant' && m.message.content[0].type === 'text').map((m) => m.message.content[0].text).join('');
  assert.equal(streamed, full);
});

test('a history replay gives the user prompt, the tools and the answer, with no stream events', () => {
  const tr = new AcpTranslator({ sessionId: 's1', live: false });
  const msgs = lines('agy-load.ndjson').flatMap((m) => tr.update(m.params.update));
  msgs.push(...tr.finish());
  assert.ok(!msgs.some((m) => m.type === 'stream_event'));
  const t = fromHistory(msgs);
  assert.equal(t.items[0].kind, 'user');
  assert.match(t.items[0].text, /hello\.txt/);
  assert.deepEqual(Object.values(t.tools).map((x) => [x.name, x.status]), [['Write', 'done'], ['Edit', 'done'], ['Bash', 'done']]);
  assert.equal(t.items.at(-1).kind, 'text');
});

test('the permission request of an edit shows as an Edit with its diff', () => {
  const req = lines('agy-turn.ndjson').filter((m) => m.method === 'session/request_permission');
  assert.equal(req.length, 3);
  assert.deepEqual(toolView(req[1].params.toolCall), {
    name: 'Edit', input: { file_path: 'C:\\work\\hello.txt', old_string: 'banana', new_string: 'apple' },
  });
});

test('a cancelled turn ends running tools and shows as stopped', () => {
  const tr = new AcpTranslator({ sessionId: 's1', live: true });
  let t = { ...emptyTranscript(), running: true };
  const msgs = [
    ...tr.update({ sessionUpdate: 'tool_call', toolCallId: 'c1', name: 'run_command', kind: 'execute', status: 'in_progress', rawInput: { CommandLine: 'sleep 100' } }),
    ...tr.end({ stopReason: 'cancelled', ms: 10, turns: 1 }),
  ];
  for (const m of msgs) t = applyMessage(t, m);
  assert.equal(t.tools.c1.status, 'error');
  const r = t.items.at(-1);
  assert.equal(r.kind, 'result');
  assert.equal(r.ok, false);
  assert.equal(r.subtype, 'cancelled');
});

test('an error of session/prompt shows its text', () => {
  const tr = new AcpTranslator({ sessionId: 's1', live: true });
  const [r] = tr.end({ error: 'Quota exceeded', ms: 1, turns: 1 });
  assert.equal(r.is_error, true);
  assert.deepEqual(r.errors, ['Quota exceeded']);
});

test('browser pane tools keep the Clawdeck MCP name', () => {
  assert.equal(toolView({ name: 'mcp_clawdeck_browser_navigate', rawInput: { url: 'https://example.com' } }).name, 'mcp__clawdeck__browser_navigate');
});

test('paths like /C:/x lose the first slash', () => {
  assert.equal(fixPath('/C:/work/a.txt'), 'C:/work/a.txt');
  assert.equal(fixPath('/home/u/a.txt'), '/home/u/a.txt');
});

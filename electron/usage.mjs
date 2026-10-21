import { createReadStream } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import path from 'node:path';
import { CLAUDE_DIR } from './env.mjs';

const DAYS = 7;
const cache = new Map(); // file -> { mtimeMs, size, entries: Map(messageId -> { day, usage }) }

async function* walk(dir) {
  let items = [];
  try { items = await readdir(dir, { withFileTypes: true }); } catch { return; }
  for (const it of items) {
    const p = path.join(dir, it.name);
    if (it.isDirectory()) yield* walk(p);
    else if (it.name.endsWith('.jsonl')) yield p;
  }
}

function localDay(ts) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

async function scanFile(file) {
  const entries = new Map();
  const rl = createInterface({ input: createReadStream(file, 'utf8'), crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line.includes('"usage"') || !line.includes('"assistant"')) continue;
    try {
      const e = JSON.parse(line);
      const u = e.type === 'assistant' && e.message?.usage;
      if (!u || !e.message.id || !e.timestamp) continue;
      entries.set(e.message.id, { day: localDay(e.timestamp), model: e.message.model, usage: u });
    } catch {}
  }
  return entries;
}

// Tokens per local day for the last 7 days, read from Claude Code transcripts.
export async function dailyTokens() {
  const since = Date.now() - DAYS * 86400000;
  const seen = new Set();
  const days = new Map();
  for (let i = DAYS - 1; i >= 0; i--) {
    const day = localDay(Date.now() - i * 86400000);
    days.set(day, { day, input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });
  }
  for await (const file of walk(path.join(CLAUDE_DIR, 'projects'))) {
    const s = await stat(file).catch(() => null);
    if (!s || s.mtimeMs < since) continue;
    let c = cache.get(file);
    if (!c || c.mtimeMs !== s.mtimeMs || c.size !== s.size) {
      c = { mtimeMs: s.mtimeMs, size: s.size, entries: await scanFile(file) };
      cache.set(file, c);
    }
    // Forked and resumed sessions copy old messages, so count each message id once.
    for (const [id, { day, usage }] of c.entries) {
      if (seen.has(id)) continue;
      seen.add(id);
      const d = days.get(day);
      if (!d) continue;
      d.input += usage.input_tokens || 0;
      d.output += usage.output_tokens || 0;
      d.cacheRead += usage.cache_read_input_tokens || 0;
      d.cacheWrite += usage.cache_creation_input_tokens || 0;
    }
  }
  return [...days.values()];
}

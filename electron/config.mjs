import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, writeFile, readdir, mkdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { HOME, CLAUDE_DIR, projectSlug } from './env.mjs';

const run = promisify(execFile);
const USER_SETTINGS = path.join(CLAUDE_DIR, 'settings.json');

async function readJson(file) {
  try { return JSON.parse(await readFile(file, 'utf8')); } catch { return null; }
}

export async function listPlugins(claudePath) {
  const { stdout } = await run(claudePath, ['plugin', 'list', '--json'], { timeout: 30000 });
  return JSON.parse(stdout).map((p) => ({
    id: p.id, version: p.version, scope: p.scope, enabled: p.enabled,
    mcpServers: Object.keys(p.mcpServers || {}), installPath: p.installPath, lastUpdated: p.lastUpdated,
  }));
}

export async function setPluginEnabled(claudePath, id, enabled) {
  await run(claudePath, ['plugin', enabled ? 'enable' : 'disable', id], { timeout: 30000 });
}

// Server config can carry tokens (headers, env). Only show where it points.
export function redactMcp(servers) {
  return servers.map((s) => ({
    name: s.name, status: s.status, error: s.error, scope: s.scope, source: s.source,
    serverInfo: s.serverInfo,
    target: s.config ? s.config.url || [s.config.command, ...(s.config.args || [])].filter(Boolean).join(' ') : '',
    transport: s.config?.type || 'stdio',
    tools: (s.tools || []).map((t) => ({ name: t.name, description: t.description, readOnly: t.annotations?.readOnly, destructive: t.annotations?.destructive })),
  }));
}

export async function listHooks(cwd, plugins) {
  const sources = [
    { label: 'User settings', file: USER_SETTINGS },
    { label: 'Project settings', file: path.join(cwd, '.claude/settings.json') },
    { label: 'Local settings', file: path.join(cwd, '.claude/settings.local.json') },
    ...plugins.filter((p) => p.enabled && p.installPath).map((p) => ({ label: p.id.split('@')[0], file: path.join(p.installPath, 'hooks/hooks.json') })),
  ];
  const rows = [];
  for (const src of sources) {
    const json = await readJson(src.file);
    for (const [event, groups] of Object.entries(json?.hooks || {})) {
      for (const g of groups || []) {
        for (const h of g.hooks || []) {
          rows.push({ source: src.label, event, matcher: g.matcher || '', command: h.command || h.url || h.prompt || h.type });
        }
      }
    }
  }
  return rows;
}

// The only files the editor may read or write.
export async function memoryFiles(cwd) {
  const files = [
    { group: 'Instructions', label: 'User CLAUDE.md', path: path.join(CLAUDE_DIR, 'CLAUDE.md') },
    { group: 'Instructions', label: 'Project CLAUDE.md', path: path.join(cwd, 'CLAUDE.md') },
    { group: 'Instructions', label: 'Project .claude/CLAUDE.md', path: path.join(cwd, '.claude/CLAUDE.md') },
    { group: 'Instructions', label: 'Local CLAUDE.local.md', path: path.join(cwd, 'CLAUDE.local.md') },
  ];
  const memDir = path.join(CLAUDE_DIR, 'projects', projectSlug(cwd), 'memory');
  try {
    const names = (await readdir(memDir)).filter((n) => n.endsWith('.md')).sort((a, b) => (a === 'MEMORY.md' ? -1 : b === 'MEMORY.md' ? 1 : a.localeCompare(b)));
    for (const n of names) files.push({ group: 'Memory', label: n, path: path.join(memDir, n) });
  } catch {}
  for (const f of files) {
    try { const s = await stat(f.path); f.exists = true; f.size = s.size; f.mtime = s.mtimeMs; } catch { f.exists = false; }
    f.short = f.path.replace(HOME, '~');
  }
  return files;
}

async function assertAllowed(cwd, file) {
  const allowed = await memoryFiles(cwd);
  if (!allowed.some((f) => f.path === file)) throw new Error(`Not an editable file: ${file}`);
}

export async function readMemory(cwd, file) {
  await assertAllowed(cwd, file);
  try { return await readFile(file, 'utf8'); } catch { return ''; }
}

export async function writeMemory(cwd, file, content) {
  await assertAllowed(cwd, file);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, content, 'utf8');
}

export async function readDefaults() {
  const s = (await readJson(USER_SETTINGS)) || {};
  return { model: s.model || '', effortLevel: s.effortLevel || '', defaultMode: s.permissions?.defaultMode || '' };
}

// Merge into ~/.claude/settings.json and keep every other key.
export async function saveDefaults({ model, effortLevel, defaultMode }) {
  const s = (await readJson(USER_SETTINGS)) || {};
  if (model !== undefined) { if (model) s.model = model; else delete s.model; }
  // Claude Code never stores 'max' in settings files.
  if (effortLevel && effortLevel !== 'max') s.effortLevel = effortLevel;
  if (defaultMode) s.permissions = { ...(s.permissions || {}), defaultMode };
  await writeFile(USER_SETTINGS, JSON.stringify(s, null, 2) + '\n', 'utf8');
}

// Last known plan limits, used before a session answers.
export async function cachedLimits() {
  const j = await readJson(path.join(HOME, '.claude.json'));
  return j?.cachedUsageUtilization?.utilization || null;
}

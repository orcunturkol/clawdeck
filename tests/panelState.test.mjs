import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, readdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { readPanelState, savePanelState } from '../electron/config.mjs';

const tmp = async () => path.join(await mkdtemp(path.join(os.tmpdir(), 'panel-')), 'sub', 'panel.json');

test('missing file gives defaults', async () => {
  assert.deepEqual(await readPanelState(await tmp()), { open: {} });
});

test('saves and merges patches, leaves no temp file', async () => {
  const f = await tmp();
  await Promise.all([savePanelState(f, { git: false }), savePanelState(f, { usage: true })]);
  await savePanelState(f, { git: true, bad: 'x' });
  assert.deepEqual(await readPanelState(f), { open: { git: true, usage: true } });
  assert.deepEqual(await readdir(path.dirname(f)), ['panel.json']);
});

test('corrupt file falls back to defaults and is replaced', async () => {
  const f = await tmp();
  await savePanelState(f, { a: true });
  await writeFile(f, '{not json');
  assert.deepEqual(await readPanelState(f), { open: {} });
  await savePanelState(f, { b: false });
  assert.deepEqual(JSON.parse(await readFile(f, 'utf8')), { open: { b: false } });
});

test('wrong shapes are ignored', async () => {
  const f = await tmp();
  await savePanelState(f, {});
  await writeFile(f, JSON.stringify({ open: { a: 1, b: false, c: null } }));
  assert.deepEqual(await readPanelState(f), { open: { b: false } });
});

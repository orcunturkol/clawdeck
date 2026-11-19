import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdtempSync, chmodSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseVersion, compareVersions, installType, update, info } from '../electron/claudeCode.mjs';

test('parseVersion reads the version from CLI output', () => {
  assert.equal(parseVersion('2.1.327 (Claude Code)\n'), '2.1.327');
  assert.equal(parseVersion('2.2.0-beta.1 (Claude Code)'), '2.2.0-beta.1');
  assert.equal(parseVersion('command not found'), null);
  assert.equal(parseVersion(''), null);
  assert.equal(parseVersion(undefined), null);
});

test('compareVersions orders numerically', () => {
  assert.equal(compareVersions('2.1.327', '2.1.328'), -1);
  assert.equal(compareVersions('2.1.10', '2.1.9'), 1);
  assert.equal(compareVersions('2.1.0', '2.1'), 0);
});

test('installType detects npm and native paths', () => {
  assert.equal(installType('/usr/lib/node_modules/@anthropic-ai/claude-code/cli.js'), 'npm');
  assert.equal(installType('/nonexistent/.local/share/claude/versions/2.1.327'), 'native');
  assert.equal(installType('/opt/foo/claude'), 'unknown');
});

test('info and update work against a fake claude on PATH', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'fakeclaude-'));
  const fake = path.join(dir, 'claude');
  writeFileSync(fake, '#!/bin/sh\nif [ "$1" = "--version" ]; then echo "1.0.0 (Claude Code)"; exit 0; fi\nif [ "$1" = "update" ]; then echo "boom" >&2; exit 3; fi\n');
  chmodSync(fake, 0o755);
  const old = process.env.PATH;
  process.env.PATH = dir;
  try {
    const i = await info();
    assert.equal(i.version, '1.0.0');
    assert.equal(i.found, true);
    const u = await update();
    assert.equal(u.ok, false);
    assert.match(u.output, /boom/);
  } finally { process.env.PATH = old; }
});

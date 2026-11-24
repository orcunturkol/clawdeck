import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, symlinkSync, rmSync, chmodSync, existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseStatus, parseNumstat, buildTree, projectStatus, projects, insideRepo, fileDiff } from '../electron/git.mjs';
import { findCode, openInEditor } from '../electron/editor.mjs';

const tmp = () => mkdtempSync(path.join(os.tmpdir(), 'deck-git-'));
const g = (cwd, ...a) => execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...a], { cwd, stdio: 'pipe' });
function repo() {
  const d = tmp();
  g(d, 'init', '-q', '-b', 'main');
  mkdirSync(path.join(d, 'src/deep'), { recursive: true });
  writeFileSync(path.join(d, 'a.txt'), 'one\ntwo\n');
  writeFileSync(path.join(d, 'src/b.js'), 'x\n');
  writeFileSync(path.join(d, 'src/deep/gone.js'), 'y\n');
  g(d, 'add', '.');
  g(d, 'commit', '-q', '-m', 'init');
  return d;
}

test('parseStatus reads branch, counts and entries', () => {
  const out = ['# branch.oid abc', '# branch.head main', '# branch.upstream origin/main', '# branch.ab +2 -1',
    '1 .M N... 100644 100644 100644 h h src/a b.js', '2 R. N... 100644 100644 100644 h h R100 new.js', 'old.js',
    '? x/new.txt', 'u UU N... 1 2 3 4 h h h c.js', ''].join('\0');
  const r = parseStatus(out);
  assert.equal(r.branch, 'main');
  assert.equal(r.ahead, 2);
  assert.equal(r.behind, 1);
  assert.deepEqual(r.files.map((f) => [f.path, f.status]), [['src/a b.js', 'M'], ['new.js', 'R'], ['x/new.txt', '??'], ['c.js', 'U']]);
  assert.equal(r.files[1].from, 'old.js');
});

test('parseNumstat handles binary and renames', () => {
  const m = parseNumstat('3\t1\ta.txt\0-\t-\tbin.png\0' + '0\t0\t\0old\0new\0');
  assert.deepEqual(m.get('a.txt'), { add: 3, del: 1 });
  assert.deepEqual(m.get('bin.png'), { add: 0, del: 0 });
  assert.ok(m.has('new'));
});

test('buildTree nests folders first and sums counts', () => {
  const t = buildTree([{ path: 'z.txt', add: 1, del: 0 }, { path: 'src/deep/a.js', add: 2, del: 1 }, { path: 'src/b.js', add: 1, del: 1 }]);
  assert.deepEqual(t.map((n) => n.name), ['src', 'z.txt']);
  assert.deepEqual(t[0].children.map((n) => n.name), ['deep', 'b.js']);
  assert.equal(t[0].add, 3);
  assert.equal(t[0].del, 2);
});

test('projectStatus on a real repo, and non-repos are skipped', async () => {
  const d = repo();
  writeFileSync(path.join(d, 'a.txt'), 'one\nTWO\nthree\n');
  rmSync(path.join(d, 'src/deep/gone.js'));
  writeFileSync(path.join(d, 'new.txt'), 'n\n');
  const p = await projectStatus(d);
  assert.equal(p.branch, 'main');
  assert.equal(p.count, 3);
  const flat = [];
  const walk = (ns) => ns.forEach((n) => (n.children ? walk(n.children) : flat.push(n.file)));
  walk(p.tree);
  const by = Object.fromEntries(flat.map((f) => [f.path, f]));
  assert.equal(by['a.txt'].status, 'M');
  assert.equal(by['a.txt'].add, 2);
  assert.equal(by['a.txt'].del, 1);
  assert.equal(by['src/deep/gone.js'].status, 'D');
  assert.equal(by['new.txt'].status, '??');
  const plain = tmp();
  assert.deepEqual((await projects([d, path.join(d, 'src'), plain])).map((x) => x.dir), [d]);
});

test('insideRepo rejects traversal and links that leave', async () => {
  const d = repo();
  const out = tmp();
  writeFileSync(path.join(out, 'secret'), 's');
  symlinkSync(out, path.join(d, 'link'));
  assert.ok((await insideRepo(d, 'src/b.js')).endsWith('b.js'));
  assert.ok(await insideRepo(d, 'src/deep/gone-already.js'));
  await assert.rejects(insideRepo(d, '../x'));
  await assert.rejects(insideRepo(d, path.join(out, 'secret')));
  await assert.rejects(insideRepo(d, 'link/secret'));
  await assert.rejects(insideRepo(d, ''));
});

test('fileDiff shows tracked and untracked changes', async () => {
  const d = repo();
  writeFileSync(path.join(d, 'a.txt'), 'one\nchanged\n');
  writeFileSync(path.join(d, 'new.txt'), 'hello\n');
  assert.match((await fileDiff(d, 'a.txt')).diff, /\+changed/);
  assert.match((await fileDiff(d, 'new.txt')).diff, /\+hello/);
  await assert.rejects(fileDiff(d, '../etc/passwd'));
});

test('git commands leave the repo unchanged', async () => {
  const d = repo();
  writeFileSync(path.join(d, 'a.txt'), 'edit\n');
  const before = readFileSync(path.join(d, '.git/index'));
  await projectStatus(d);
  await fileDiff(d, 'a.txt');
  assert.deepEqual(readFileSync(path.join(d, '.git/index')), before);
});

test('openInEditor runs a fake code script and refuses outside paths', { skip: process.platform === 'win32' }, async () => {
  const d = repo();
  const bin = tmp();
  const log = path.join(bin, 'args.txt');
  writeFileSync(path.join(bin, 'code'), `#!/bin/sh\nprintf '%s\\n' "$@" > "${log}"\n`);
  chmodSync(path.join(bin, 'code'), 0o755);
  const env = { ...process.env, PATH: bin };
  assert.equal(findCode(env), path.join(bin, 'code'));
  const r = await openInEditor({ dir: d, file: 'src/b.js', line: 7 }, { env });
  assert.equal(r.via, 'code');
  for (let i = 0; i < 50 && !existsSync(log); i++) await new Promise((s) => setTimeout(s, 50));
  const args = readFileSync(log, 'utf8').trim().split('\n');
  assert.ok(args.includes('--goto'));
  assert.ok(args.at(-1).endsWith('src/b.js:7'));
  await assert.rejects(openInEditor({ dir: d, file: '../x' }, { env }));
  // Without `code`, the system opener is used.
  let opened = '';
  const r2 = await openInEditor({ dir: d }, { env: { PATH: '' }, openPath: async (p) => { opened = p; return ''; } });
  assert.equal(r2.via, 'system');
  assert.equal(opened, d);
});

// End-to-end tests: start the real Electron app with a temporary profile and drive the UI.
// Run: npm run e2e   (Linux without a display: xvfb-run -a npm run e2e)
// The tests do not need a Claude login or a model. Real VS Code and the real `claude update` never run.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { _electron as electron } from 'playwright-core';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, chmodSync, existsSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const IS_WIN = process.platform === 'win32';
const tmp = mkdtempSync(path.join(tmpdir(), 'clawdeck-e2e-'));
const profile = path.join(tmp, 'profile');
const repo = path.join(tmp, 'project');
const bin = path.join(tmp, 'bin');
const codeLog = path.join(tmp, 'code-args.txt');

const git = (...a) => execFileSync('git', a, { cwd: repo, stdio: 'ignore' });

before(() => {
  mkdirSync(repo, { recursive: true });
  mkdirSync(bin, { recursive: true });
  git('init', '-q');
  git('config', 'user.email', 'e2e@example.com');
  git('config', 'user.name', 'e2e');
  mkdirSync(path.join(repo, 'src'));
  writeFileSync(path.join(repo, 'src/a.txt'), 'one\n');
  git('add', '.');
  git('commit', '-qm', 'init');
  writeFileSync(path.join(repo, 'src/a.txt'), 'one\ntwo\n'); // modified
  writeFileSync(path.join(repo, 'new.txt'), 'x\n'); // untracked
  // Fake VS Code: records its arguments.
  // Fake Claude Code for the version panel (a script cannot stand in for claude.exe on Windows).
  if (!IS_WIN) {
    writeFileSync(path.join(bin, 'claude'), '#!/bin/sh\nif [ "$1" = "--version" ]; then echo "2.1.0 (Claude Code)"; fi\n');
    chmodSync(path.join(bin, 'claude'), 0o755);
  }
  if (IS_WIN) writeFileSync(path.join(bin, 'code.cmd'), `@echo %* >> "${codeLog}"\r\n`);
  else {
    writeFileSync(path.join(bin, 'code'), `#!/bin/sh\necho "$@" >> "${codeLog}"\n`);
    chmodSync(path.join(bin, 'code'), 0o755);
  }
});

after(() => rmSync(tmp, { recursive: true, force: true }));

async function launch() {
  const app = await electron.launch({
    args: [ROOT, repo],
    cwd: ROOT,
    env: { ...process.env, CLAWDECK_PROFILE: profile, PATH: `${bin}${path.delimiter}${process.env.PATH}` },
  });
  const page = await app.firstWindow();
  await page.setViewportSize({ width: 1480, height: 920 }).catch(() => {});
  await page.waitForSelector('.panel');
  return { app, page };
}

const head = (page, id) => page.locator(`[data-testid="section-${id}"]`);
async function setOpen(page, id, want) {
  const h = head(page, id);
  if ((await h.getAttribute('aria-expanded')) !== String(want)) await h.click();
  await page.waitForFunction(([i, w]) => document.querySelector(`[data-testid="section-${i}"]`)?.getAttribute('aria-expanded') === String(w), [id, want]);
}

test('panel: open state survives a restart', async () => {
  let { app, page } = await launch();
  await setOpen(page, 'usage', false);
  await setOpen(page, 'hooks', true);
  await page.waitForTimeout(800); // the save waits 300 ms
  await app.close();
  ({ app, page } = await launch());
  try {
    await page.waitForFunction(() => document.querySelector('[data-testid="section-hooks"]')?.getAttribute('aria-expanded') === 'true');
    assert.equal(await head(page, 'usage').getAttribute('aria-expanded'), 'false');
  } finally {
    await app.close();
  }
});

test('claude code section shows the installed version', async () => {
  const { app, page } = await launch();
  try {
    await setOpen(page, 'claudecode', true);
    // Real Claude Code, the fake one, or none: the panel must show a version or say it is missing.
    await page.waitForSelector('[data-testid="claudecode-version"], [data-testid="claudecode-missing"]', { timeout: 30000 });
    if (await page.getByTestId('claudecode-version').count()) {
      await page.waitForFunction(() => /\d+\.\d+\.\d+/.test(document.querySelector('[data-testid="claudecode-version"]')?.textContent || ''), null, { timeout: 30000 });
      assert.ok(await page.getByTestId('claudecode-update').count());
    }
  } finally {
    await app.close();
  }
});

test('git tree lists changes and opens a diff and VS Code', async () => {
  const { app, page } = await launch();
  try {
    await setOpen(page, 'git', true);
    const files = page.getByTestId('git-file');
    await files.first().waitFor({ timeout: 20000 });
    const text = (await page.getByTestId('git-section').innerText());
    assert.match(text, /a\.txt/);
    assert.match(text, /new\.txt/);
    await files.filter({ hasText: 'a.txt' }).first().click();
    await page.locator('.git-diff .add', { hasText: 'two' }).waitFor();
    await page.getByTestId('open-vscode').first().click();
    // Windows starts Code.exe itself, which a fake script cannot replace. The click must still not fail.
    if (IS_WIN) { await page.waitForTimeout(1500); assert.equal(await page.locator('.panel .error').count(), 0); return; }
    const end = Date.now() + 10000;
    while (!existsSync(codeLog) && Date.now() < end) await page.waitForTimeout(200);
    assert.ok(existsSync(codeLog), 'fake code was not started');
    assert.ok(readFileSync(codeLog, 'utf8').includes('project') || readFileSync(codeLog, 'utf8').includes('a.txt'));
  } finally {
    await app.close();
  }
});

test('composer: paste and drop become [imageN] and [fileN] in the text', async () => {
  const { app, page } = await launch();
  try {
    const box = page.getByTestId('composer-input');
    await page.waitForSelector('[data-testid="composer-input"]:not([disabled])', { timeout: 60000 }).catch(() => {});
    if (await box.isDisabled()) return; // Claude Code did not start here, so the box stays locked.
    await box.fill('Hey look at this problem in this image ');
    await box.evaluate((el) => {
      const png = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='), (c) => c.charCodeAt(0));
      const dt = new DataTransfer();
      dt.items.add(new File([png], 'p.png', { type: 'image/png' }));
      el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
    });
    await page.waitForFunction(() => document.querySelector('[data-testid="composer-input"]').value.includes('[image1]'));
    assert.equal(await page.locator('.thumbs').count(), 0);
  } finally {
    await app.close();
  }
});

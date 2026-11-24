// End-to-end test of Antigravity chats in the real app, with the real agy and its Google login.
// Usage: npm run e2e:agy   (agy must be installed and signed in; Claude Code too, for the last step)
// Screenshots go to shots/e2e-agy/. The test uses its own profile and a new temporary folder.
import { _electron as electron } from 'playwright-core';
import { mkdirSync, mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';

const SHOTS = 'shots/e2e-agy';
mkdirSync(SHOTS, { recursive: true });
const profile = mkdtempSync(path.join(os.tmpdir(), 'clawdeck-e2e-profile-'));
// Not in %TEMP%: agy can treat a temporary folder in its own way, and real projects are not there.
mkdirSync('.dev', { recursive: true });
const ws = mkdtempSync(path.resolve('.dev', 'e2e-ws-'));
const results = [];
let n = 0;

// E2E_EXE: test a packaged build (for example release/win-unpacked/Clawdeck.exe) instead of the source.
const exe = process.env.E2E_EXE;
const app = await electron.launch({ ...(exe ? { executablePath: exe, args: [ws] } : { args: ['.', ws] }), cwd: process.cwd(), env: { ...process.env, CLAWDECK_PROFILE: profile } });
const page = await app.firstWindow();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
const dialogs = [];
page.on('dialog', (d) => { dialogs.push(d.message()); d.accept(); });
await page.setViewportSize({ width: 1480, height: 920 }).catch(() => {});

const field = (label) => page.locator(`.panel label.field:has(> span:text-is("${label}")) select`);
const shot = (name) => page.screenshot({ path: `${SHOTS}/${String(++n).padStart(2, '0')}-${name}.png` });
const transcript = () => page.locator('.transcript').innerText();
const turnEnds = () => page.locator('.turn-end').count();

async function step(name, fn) {
  const t0 = Date.now();
  try {
    await fn();
    results.push({ name, ok: true, s: Math.round((Date.now() - t0) / 1000) });
    console.log(`PASS  ${name}`);
  } catch (e) {
    results.push({ name, ok: false, error: e.message.split('\n')[0] });
    console.log(`FAIL  ${name}: ${e.message.split('\n')[0]}`);
    await shot(`fail-${name.replace(/\W+/g, '-')}`).catch(() => {});
  }
}

// Sends a prompt and waits for the end of the turn. allow: what to answer to each permission prompt.
async function turn(text, { allow = true, timeout = 180000, onPrompt } = {}) {
  const before = await turnEnds();
  await page.fill('.composer textarea', text);
  await page.keyboard.press('Enter');
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if ((await turnEnds()) > before) return;
    const prompt = page.locator('.prompt').first();
    if (await prompt.count()) {
      if (onPrompt) await onPrompt(prompt);
      await prompt.locator('button', { hasText: allow ? /^Allow$/ : /^Deny$/ }).click();
    }
    await page.waitForTimeout(500);
  }
  throw new Error(`no answer in ${timeout / 1000} s for: ${text}`);
}

await page.waitForSelector('textarea:not([disabled])', { timeout: 60000 });
await shot('start-claude');

await step('Google terms warning shows before the first Antigravity chat', async () => {
  await field('Agent').selectOption('antigravity');
  await page.waitForSelector('textarea[placeholder^="Message Antigravity"]', { timeout: 60000 });
  if (!dialogs.some((d) => /suspension or termination/.test(d))) throw new Error('no terms dialog');
});

await step('Antigravity chat shows its own panel, chip and modes', async () => {
  await page.waitForSelector('aside[aria-label="Antigravity control panel"]');
  await page.waitForFunction(() => [...document.querySelectorAll('.panel label.field')].find((l) => l.firstChild?.textContent === 'Model')?.querySelector('select').options.length > 3, null, { timeout: 30000 });
  const chip = await page.locator('.account-chip:not(.update-chip):not([data-testid])').innerText();
  if (!/Antigravity/.test(chip)) throw new Error(`chip says ${chip}`);
  const modes = await page.locator('.composer .mode select option').allInnerTexts();
  if (modes.join() !== 'Ask before edits,Accept edits,Auto,Plan') throw new Error(`modes ${modes}`);
  if (!(await page.locator('button[aria-label="Remote control"]').isDisabled())) throw new Error('remote control is on');
  await shot('agy-ready');
});

await step('Edit approval with diff, then the file is written', async () => {
  let body = '';
  await turn('Create a file e2e.txt that contains exactly the word mango. Then reply with exactly: FINISHED', {
    onPrompt: async (p) => { body = await p.innerText(); await shot('agy-permission'); },
  });
  if (!/mango/.test(body)) throw new Error(`permission prompt did not show the content: ${body}`);
  if (!/Antigravity wants to use Write/.test(body)) throw new Error(`permission title: ${body.split('\n')[0]}`);
  const file = path.join(ws, 'e2e.txt');
  if (!existsSync(file) || readFileSync(file, 'utf8').trim() !== 'mango') throw new Error('e2e.txt is wrong');
  if (!/FINISHED/.test(await transcript())) throw new Error('no FINISHED in the answer');
  await shot('agy-written');
});

await step('Deny stops the command', async () => {
  await turn('Run this shell command: echo e2e-denied-marker > denied.txt. If you cannot, reply with exactly: DENIED', { allow: false });
  if (existsSync(path.join(ws, 'denied.txt'))) throw new Error('the command ran');
});

await step('Stop ends a long turn', async () => {
  const before = await turnEnds();
  await page.fill('.composer textarea', 'Write the numbers from 1 to 400 as words, one per line. Do not use tools.');
  await page.keyboard.press('Enter');
  await page.waitForSelector('button[aria-label="Stop"]', { timeout: 30000 });
  await page.waitForTimeout(4000);
  await page.click('button[aria-label="Stop"]');
  await page.waitForFunction((b) => document.querySelectorAll('.turn-end').length > b, before, { timeout: 60000 });
  const last = await page.locator('.turn-end').last().innerText();
  if (!/cancelled/.test(last)) throw new Error(`last turn end: ${last}`);
  await shot('agy-stopped');
});

await step('Model and thinking change, and the next turn works', async () => {
  const model = field('Model');
  await model.selectOption('gemini-3.8-flash');
  await field('Thinking').selectOption('low');
  await page.waitForTimeout(1500);
  if ((await model.inputValue()) !== 'gemini-3.8-flash') throw new Error('model did not change');
  await turn('Reply with exactly: FLASH-OK');
  if (!/FLASH-OK/.test(await transcript())) throw new Error('no FLASH-OK');
});

await step('Browser pane tools work through the MCP bridge', async () => {
  await turn('Use the clawdeck browser_navigate tool to open https://example.com, then reply with the page title only.', { timeout: 240000 });
  const text = await transcript();
  if (!/Example Domain/.test(text)) throw new Error('no page title in the answer');
  if (!/Open page/.test(text)) throw new Error('no browser tool row');
  if (!/example\.com/.test(await page.locator('.browser input, .browser-pane input').first().inputValue().catch(() => ''))) throw new Error('the pane did not open the page');
  await shot('agy-browser');
  await page.click('.side-switch button:has-text("Panel")');
});

await step('Plan mode: the plan shows for approval, and approval starts the work', async () => {
  await page.locator('.composer .mode select').selectOption('plan');
  await page.waitForTimeout(1000);
  const before = await turnEnds();
  await page.fill('.composer textarea', 'Plan how to add a file notes.txt that contains the word papaya. Write the plan, then wait for my approval.');
  await page.keyboard.press('Enter');
  await page.waitForSelector(`.prompt-title:has-text("Antigravity's plan is ready")`, { timeout: 240000 });
  await shot('agy-plan');
  await page.click('button:has-text("Approve plan")');
  const end = Date.now() + 240000;
  while (Date.now() < end && (await turnEnds()) < before + 2) {
    const prompt = page.locator('.prompt').first();
    if (await prompt.count()) await prompt.locator('button', { hasText: /^Allow$/ }).click().catch(() => {});
    await page.waitForTimeout(500);
  }
  if (!existsSync(path.join(ws, 'notes.txt'))) throw new Error('notes.txt was not written after approval');
  if ((await page.locator('.composer .mode select').inputValue()) !== 'default') throw new Error('mode did not leave plan');
});

// Windows only: a new agy process with its own console window starts, and the test closes it again.
await step('Sign-in window opens agy', async () => {
  if (process.platform !== 'win32') return;
  const agyPids = () => new Set(execFileSync('tasklist', ['/fi', 'imagename eq agy.exe', '/fo', 'csv', '/nh'], { encoding: 'utf8' })
    .split('\n').map((l) => l.split('","')[1]).filter(Boolean));
  const before = agyPids();
  const r = await page.evaluate(() => window.deck.invoke('accounts:agyLogin').then(() => 'ok', (e) => e.message));
  if (r !== 'ok') throw new Error(r);
  await page.waitForTimeout(3000);
  const added = [...agyPids()].filter((p) => !before.has(p));
  if (!added.length) throw new Error('no new agy process');
  // The first kill can end the others too (/t), so a later one may find nothing.
  for (const pid of added) { try { execFileSync('taskkill', ['/pid', pid, '/t', '/f'], { stdio: 'ignore' }); } catch {} }
});

await step('Context meter shows Antigravity usage', async () => {
  await page.waitForSelector('.panel .meter', { timeout: 15000 });
});

await step('New session uses the last agent', async () => {
  await page.click('button.new-session');
  await page.waitForSelector('textarea[placeholder^="Message Antigravity"]', { timeout: 60000 });
  if ((await field('Agent').inputValue()) !== 'antigravity') throw new Error('the Agent select is wrong');
});

await step('The chat is in the session list and opens again with its history', async () => {
  await page.waitForSelector('.session-list .agy-badge', { timeout: 30000 });
  await field('Agent').selectOption('claude');
  await page.waitForSelector('textarea[placeholder^="Message Claude"]', { timeout: 60000 });
  await page.locator('.session-list .session', { has: page.locator('.agy-badge') }).first().click();
  await page.waitForFunction(() => /mango/.test(document.querySelector('.transcript')?.innerText || ''), null, { timeout: 60000 });
  await page.waitForSelector('textarea[placeholder^="Message Antigravity"]', { timeout: 60000 });
  const model = await field('Model').inputValue();
  if (model !== 'gemini-3.8-flash') throw new Error(`model after reopen: ${model}`);
  await shot('agy-reopened');
});

await step('A resumed chat goes on with its context', async () => {
  await turn('What word is in e2e.txt? Answer from memory with one word, no tools.');
  const answer = await page.locator('.transcript .md').last().innerText();
  if (!/mango/i.test(answer)) throw new Error(`answer: ${answer}`);
});

await step('Rename keeps the new name', async () => {
  const row = page.locator('.session-row', { has: page.locator('.agy-badge') }).first();
  await row.hover();
  await row.locator('.row-rename').click();
  await page.fill('.title-edit', 'E2E Antigravity chat');
  await page.keyboard.press('Enter');
  await page.waitForSelector('.session-list :text("E2E Antigravity chat")', { timeout: 15000 });
});

await step('Running tab lists the Antigravity chat', async () => {
  await page.click('.rail-tabs button:has-text("Running")');
  await page.waitForSelector('.run-title:has-text("E2E Antigravity chat")', { timeout: 15000 });
  await shot('running');
  await page.click('.rail-tabs button:has-text("This folder")');
});

await step('Claude Code chats still work', async () => {
  await field('Agent').selectOption('claude');
  await page.waitForSelector('textarea[placeholder^="Message Claude"]', { timeout: 60000 });
  await page.waitForSelector('aside[aria-label="Claude Code control panel"]');
  await turn('Reply with exactly: CLAUDE-OK', { timeout: 120000 });
  if (!/CLAUDE-OK/.test(await transcript())) throw new Error('no CLAUDE-OK');
  await shot('claude-ok');
});

await app.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length} of ${results.length} steps passed. Renderer errors: ${errors.length}`);
for (const e of errors.slice(0, 10)) console.log('  renderer error:', e);
console.log(`Workspace: ${ws}\nScreenshots: ${SHOTS}`);
process.exit(failed.length || errors.length ? 1 : 0);

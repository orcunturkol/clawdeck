// Opens the app, optionally sends a prompt, and saves screenshots to shots/.
// Usage: node scripts/shot.mjs <folder> [prompt] [waitSeconds]
import { _electron as electron } from 'playwright-core';
import { mkdirSync } from 'node:fs';

const [dir = process.cwd(), prompt, wait = '40'] = process.argv.slice(2);
mkdirSync('shots', { recursive: true });
const app = await electron.launch({ args: ['.', dir], cwd: process.cwd() });
const page = await app.firstWindow();
page.on('console', (m) => m.type() === 'error' && console.log('console:', m.text()));
page.on('pageerror', (e) => console.log('pageerror:', e.message));
await page.setViewportSize({ width: 1480, height: 920 }).catch(() => {});
await page.emulateMedia({ colorScheme: process.env.THEME || 'dark' });
await page.waitForSelector('textarea:not([disabled])', { timeout: 30000 });
await page.waitForFunction(() => document.querySelector('.section-sum')?.textContent, null, { timeout: 30000 }).catch(() => {});
await page.waitForTimeout(4000);
await page.screenshot({ path: 'shots/1-start.png' });
if (prompt) {
  if (process.env.MODE) await page.selectOption('.mode select', process.env.MODE);
  await page.fill('.composer textarea', prompt);
  await page.keyboard.press('Enter');
  const end = Date.now() + Number(wait) * 1000;
  let n = 2;
  while (Date.now() < end) {
    await page.waitForTimeout(5000);
    if (await page.$('.prompt')) { await page.screenshot({ path: `shots/${n++}-prompt.png` }); break; }
    if (await page.$('.turn-end')) break;
  }
  await page.screenshot({ path: `shots/${n}-after.png` });
}
await app.close();

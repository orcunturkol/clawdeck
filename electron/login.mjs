import { BrowserWindow } from 'electron';
import { spawn } from 'node:child_process';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { claudeCommand } from './env.mjs';

const quote = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;
const plain = (s) => s.replace(/\x1b\][^\x07]*\x07/g, '').replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, '');

// Sign in to another Claude account inside Clawdeck and get its long-lived token.
// `claude setup-token` prints only to a terminal, so it runs in one (util-linux `script`).
// It opens its sign-in link through $BROWSER: a small script hands the link to Clawdeck,
// which shows it in a private window. claude.ai then answers Claude Code on localhost.
export function signIn({ claudePath, parent, dataDir }) {
  const id = randomUUID();
  const urlFile = path.join(os.tmpdir(), `clawdeck-login-${id}`);
  const opener = path.join(dataDir, 'login-browser.sh');
  writeFileSync(opener, '#!/bin/sh\nprintf "%s\\n" "$1" > "$CLAWDECK_LOGIN_URL"\n', { mode: 0o700 });
  const [cmd, args] = claudeCommand(claudePath, ['setup-token']);
  const line = `stty cols 1000 rows 50; exec ${[cmd, ...args].map(quote).join(' ')}`;
  const env = { ...process.env, SHELL: '/bin/sh', BROWSER: opener, CLAWDECK_LOGIN_URL: urlFile };
  delete env.CLAUDE_CODE_OAUTH_TOKEN;

  return new Promise((resolve, reject) => {
    const p = spawn('script', ['-qfec', line, '/dev/null'], { env, stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '';
    let win = null;
    let email = '';
    let done = false;
    const finish = (err, token) => {
      if (done) return;
      done = true;
      clearInterval(poll);
      clearTimeout(timer);
      p.kill();
      rmSync(urlFile, { force: true });
      if (win && !win.isDestroyed()) win.close();
      if (err) reject(err); else resolve({ token, email });
    };
    const onData = (d) => {
      out += plain(String(d));
      const token = out.match(/sk-ant-oat\d+-[A-Za-z0-9_-]{20,}/);
      if (token) finish(null, token[0]);
      // Terminal output has no spaces, so match loosely.
      if (/OAuth\s*error/.test(out)) {
        const code = out.match(/status\s*code\s*(\d+)/);
        finish(new Error(`The sign-in failed${code ? ` (error ${code[1]})` : ''}. Try again.`));
      }
    };
    p.stdout.on('data', onData);
    p.stderr.on('data', onData);
    p.on('error', (e) => finish(e.code === 'ENOENT' ? new Error('Sign-in needs the `script` command (util-linux).') : e));
    p.on('close', () => finish(new Error('Claude Code stopped before the sign-in ended.')));
    const timer = setTimeout(() => finish(new Error('The sign-in took more than 10 minutes, so Clawdeck stopped it.')), 10 * 60 * 1000);

    // The link arrives through the opener script; then the sign-in window opens.
    const poll = setInterval(() => {
      if (win || !existsSync(urlFile)) return;
      const url = readFileSync(urlFile, 'utf8').trim();
      if (!url.startsWith('https://')) return;
      win = new BrowserWindow({
        parent, width: 520, height: 760, title: 'Sign in to Claude', autoHideMenuBar: true,
        // A new in-memory partition: no cookies from earlier sign-ins, nothing kept after.
        webPreferences: { partition: `login-${id}`, sandbox: true, contextIsolation: true },
      });
      const wc = win.webContents;
      wc.setUserAgent(wc.getUserAgent().replace(/ (Electron|Clawdeck|clawdeck)\/\S+/g, ''));
      // The approval page names the account; use its email as the account's name.
      const readEmail = () => setTimeout(() => {
        if (win.isDestroyed() || !/\/oauth\/authorize/.test(wc.getURL())) return;
        wc.executeJavaScript('document.body ? document.body.innerText : ""').then((text) => {
          const m = text.match(/[\w.+-]+@[\w-]+(\.[\w-]+)+/);
          if (m) email = m[0];
        }).catch(() => {});
      }, 1500);
      wc.on('did-finish-load', readEmail);
      wc.on('did-navigate-in-page', readEmail);
      win.on('closed', () => finish(new Error('The sign-in window closed before the sign-in ended.')));
      win.loadURL(url);
    }, 300);
  });
}

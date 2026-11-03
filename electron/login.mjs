import { BrowserWindow } from 'electron';
import { spawn } from 'node:child_process';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { claudeCommand, IS_WIN } from './env.mjs';

const quote = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;
const plain = (s) => s.replace(/\x1b\][^\x07]*\x07/g, '').replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, '');

// A program that hands the sign-in link to Clawdeck: Claude Code starts $BROWSER with the link.
// The Windows one gets the link in quotes, which keep its & characters away from cmd.
function writeOpener(dataDir) {
  if (IS_WIN) {
    const file = path.join(dataDir, 'login-browser.cmd');
    writeFileSync(file, '@echo off\r\necho %*> "%CLAWDECK_LOGIN_URL%"\r\n');
    return file;
  }
  const file = path.join(dataDir, 'login-browser.sh');
  writeFileSync(file, '#!/bin/sh\nprintf "%s\\n" "$1" > "$CLAWDECK_LOGIN_URL"\n', { mode: 0o700 });
  return file;
}

// A terminal 1000 columns wide, so that the link and the token stay on one line.
// Linux uses util-linux `script`; Windows uses a ConPTY from node-pty, which installs only there.
async function terminal(cmd, args, env) {
  if (IS_WIN) {
    const pty = await import('node-pty').catch(() => null);
    if (!pty) throw new Error('Sign-in needs the node-pty package. Run `npm install` again, or paste a token instead.');
    const p = (pty.default || pty).spawn(cmd, args, { name: 'xterm-256color', cols: 1000, rows: 50, cwd: os.homedir(), env });
    return {
      onData: (fn) => p.onData(fn),
      onClose: (fn) => p.onExit(() => fn()),
      onError: () => {},
      kill: () => p.kill(),
    };
  }
  const line = `stty cols 1000 rows 50; exec ${[cmd, ...args].map(quote).join(' ')}`;
  const p = spawn('script', ['-qfec', line, '/dev/null'], { env: { ...env, SHELL: '/bin/sh' }, stdio: ['pipe', 'pipe', 'pipe'] });
  return {
    onData: (fn) => { p.stdout.on('data', fn); p.stderr.on('data', fn); },
    onClose: (fn) => p.on('close', fn),
    onError: (fn) => p.on('error', (e) => fn(e.code === 'ENOENT' ? new Error('Sign-in needs the `script` command (util-linux).') : e)),
    kill: () => p.kill(),
  };
}

// Sign in to another Claude account inside Clawdeck and get its long-lived token.
// `claude setup-token` prints only to a terminal, so it runs in one.
// It opens its sign-in link through $BROWSER: a small script hands the link to Clawdeck,
// which shows it in a private window. claude.ai then answers Claude Code on localhost.
export async function signIn({ claudePath, parent, dataDir }) {
  const id = randomUUID();
  const urlFile = path.join(os.tmpdir(), `clawdeck-login-${id}`);
  const [cmd, args, opts] = claudeCommand(claudePath, ['setup-token']);
  const env = { ...(opts.env || process.env), BROWSER: writeOpener(dataDir), CLAWDECK_LOGIN_URL: urlFile };
  delete env.CLAUDE_CODE_OAUTH_TOKEN;
  const p = await terminal(cmd, args, env);

  return new Promise((resolve, reject) => {
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
    p.onData(onData);
    p.onError((e) => finish(e));
    p.onClose(() => finish(new Error('Claude Code stopped before the sign-in ended.')));
    const timer = setTimeout(() => finish(new Error('The sign-in took more than 10 minutes, so Clawdeck stopped it.')), 10 * 60 * 1000);

    // The link arrives through the opener script; then the sign-in window opens.
    const poll = setInterval(() => {
      if (win || !existsSync(urlFile)) return;
      const url = readFileSync(urlFile, 'utf8').trim().replace(/^"(.*)"$/, '$1');
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

// Log Claude Code itself in (`claude auth login`). It needs no terminal: it prints the sign-in link and
// reads the code that the sign-in page shows. On Windows this is often the only way, because Claude Code
// from the desktop app has no `claude` command in the terminal.
export class CliLogin {
  constructor({ claudePath, onUrl }) {
    this.out = '';
    const [cmd, args, opts] = claudeCommand(claudePath, ['auth', 'login']);
    const env = { ...(opts.env || process.env) };
    delete env.CLAUDE_CODE_OAUTH_TOKEN;
    this.p = spawn(cmd, args, { ...opts, env, stdio: ['pipe', 'pipe', 'pipe'] });
    const onData = (d) => {
      this.out = (this.out + plain(String(d))).slice(-8000);
      const m = this.out.match(/https:\/\/\S+oauth\/authorize\S+/);
      if (m && !this.url) { this.url = m[0]; onUrl(this.url); }
    };
    this.p.stdout.on('data', onData);
    this.p.stderr.on('data', onData);
    this.done = new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.p.kill(); reject(new Error('The login took more than 10 minutes, so Clawdeck stopped it.')); }, 10 * 60 * 1000);
      this.p.on('error', (e) => { clearTimeout(timer); reject(e); });
      this.p.on('close', (code) => {
        clearTimeout(timer);
        if (code === 0) resolve();
        else reject(new Error(`The login did not finish. ${this.out.trim().split('\n').pop() || `Exit ${code}.`}`));
      });
    });
    this.done.catch(() => {});
  }

  code(text) { this.p.stdin.write(`${String(text).trim()}\n`); }
  cancel() { this.p.kill(); }
}

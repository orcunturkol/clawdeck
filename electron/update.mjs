import { app, net, shell } from 'electron';
import { exec, execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import updater from 'electron-updater';
import { IS_WIN } from './env.mjs';

const run = promisify(execFile);
const runShell = promisify(exec);
const REPO = 'orcunturkol/clawdeck';
const PAGE = `https://github.com/${REPO}/releases/latest`;

// How this copy updates: 'app' (the Windows install: electron-updater, no installer window),
// 'git' (a clone: git pull and npm run setup), 'page' (the portable zip: the release page) or null.
function howToUpdate(root) {
  if (!app.isPackaged) return existsSync(path.join(root, '.git')) ? 'git' : null;
  // The installer leaves its uninstaller next to the app; the portable zip has none.
  if (IS_WIN && existsSync(path.join(path.dirname(process.execPath), 'Uninstall Clawdeck.exe'))) return 'app';
  return 'page';
}

const parts = (v) => String(v).replace(/^v/, '').split('-')[0].split('.').map((n) => Number(n) || 0);
function newer(a, b) {
  const [x, y] = [parts(a), parts(b)];
  for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0);
  return false;
}

// The newest release on GitHub, or null when it cannot be read (offline, no release yet).
async function latestRelease() {
  try {
    const r = await net.fetch(`https://api.github.com/repos/${REPO}/releases/latest`, { headers: { Accept: 'application/vnd.github+json' } });
    if (!r.ok) return null;
    return String((await r.json()).tag_name || '').replace(/^v/, '') || null;
  } catch {
    return null;
  }
}

// A command's last lines of output, for the error bar.
function failed(cmd, e) {
  const out = `${e.stderr || ''}${e.stdout || ''}`.trim().split('\n').slice(-8).join('\n');
  return new Error(`The update stopped: \`${cmd}\` failed.\n${out || e.message}`);
}

// One update at a time: available -> downloading -> ready (Windows) or available -> installing (git).
export class Updater {
  constructor({ root, emit, beforeQuit }) {
    this.root = root;
    this.emit = emit;
    this.beforeQuit = beforeQuit;
    this.how = howToUpdate(root);
    this.state = null; // { version, step, percent }
    if (this.how !== 'app') return;
    const u = updater.autoUpdater;
    u.autoDownload = true; // downloads in the background; the restart installs it
    u.on('update-available', (info) => this.set({ version: info.version, step: 'downloading', percent: 0 }));
    u.on('download-progress', (p) => this.set({ step: 'downloading', percent: Math.round(p.percent) }));
    u.on('update-downloaded', (info) => this.set({ version: info.version, step: 'ready' }));
    // A failed download tries again at the next check.
    u.on('error', () => { if (this.state?.step === 'downloading') this.set(null); });
  }

  set(change) {
    this.state = change && { ...this.state, ...change };
    this.emit({ type: 'update', update: this.view() });
  }

  view() {
    return this.state && { ...this.state, how: this.how };
  }

  async check() {
    if (!this.how || this.state?.step === 'installing') return this.view();
    if (this.how === 'app') {
      if (!this.state) await updater.autoUpdater.checkForUpdates().catch(() => null);
      return this.view();
    }
    const version = await latestRelease();
    if (version && newer(version, app.getVersion())) this.set({ version, step: 'available' });
    return this.view();
  }

  async install() {
    const step = this.state?.step;
    if (this.how === 'page') { await shell.openExternal(PAGE); return; }
    if (this.how === 'app' && step === 'ready') {
      this.beforeQuit();
      updater.autoUpdater.quitAndInstall(true, true); // no installer window; Clawdeck opens again after it
      return;
    }
    if (this.how !== 'git' || step !== 'available') return;
    this.set({ step: 'installing' });
    try {
      await run('git', ['pull', '--ff-only'], { cwd: this.root, windowsHide: true }).catch((e) => { throw failed('git pull --ff-only', e); });
      // npm is a .cmd file on Windows, and Node starts one only through a shell.
      await runShell('npm run setup', { cwd: this.root, windowsHide: true, maxBuffer: 64 * 1024 * 1024 })
        .catch((e) => { throw failed('npm run setup', e); });
    } catch (e) {
      this.set({ step: 'available' });
      throw e;
    }
    this.beforeQuit();
    app.relaunch();
    app.quit();
  }
}

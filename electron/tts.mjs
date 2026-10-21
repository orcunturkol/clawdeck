import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile, rm } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { HOME } from './env.mjs';

const DIR = path.join(process.env.XDG_DATA_HOME || path.join(HOME, '.local/share'), 'clawdeck/tts');
const PYTHON = path.join(DIR, 'venv/bin/python');
const MODEL = path.join(DIR, 'model');
const WORKER = path.join(path.dirname(fileURLToPath(import.meta.url)), 'tts_worker.py');

// Turkish text to speech (Antalia-2 Mini) in a Python worker; the model loads once, in about 1.3 s.
export class Tts {
  constructor() {
    this.proc = null;
    this.ready = null;
    this.pending = new Map();
  }

  installed() { return existsSync(PYTHON) && existsSync(path.join(MODEL, 'config.json')); }

  start() {
    if (this.ready) return this.ready;
    if (!this.installed()) return Promise.reject(new Error('Read aloud is not installed. Run npm run setup-tts in the Clawdeck folder.'));
    this.proc = spawn(PYTHON, ['-I', WORKER, MODEL], { env: { ...process.env, HF_HUB_OFFLINE: '1' } });
    let stderr = '';
    this.proc.stderr.on('data', (d) => { stderr = (stderr + d).slice(-2000); });
    this.ready = new Promise((resolve, reject) => {
      createInterface({ input: this.proc.stdout }).on('line', (line) => {
        let msg;
        try { msg = JSON.parse(line); } catch { return; }
        if (msg.ready) { resolve(); return; }
        const p = this.pending.get(msg.id);
        if (!p) return;
        this.pending.delete(msg.id);
        if (msg.error) p.reject(new Error(msg.error)); else p.resolve(msg);
      });
      this.proc.on('exit', (code) => {
        const err = new Error(`The speech worker stopped (exit ${code}). ${stderr.trim().split('\n').pop() || ''}`);
        reject(err);
        for (const p of this.pending.values()) p.reject(err);
        this.pending.clear();
        this.proc = null;
        this.ready = null;
      });
    });
    this.ready.catch(() => {});
    return this.ready;
  }

  async say(text) {
    await this.start();
    const id = randomUUID();
    const res = await new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.proc.stdin.write(JSON.stringify({ id, text }) + '\n');
    });
    try {
      return { bytes: await readFile(res.path), duration: res.duration };
    } finally {
      rm(res.path, { force: true }).catch(() => {});
    }
  }

  stop() { this.proc?.kill(); }
}

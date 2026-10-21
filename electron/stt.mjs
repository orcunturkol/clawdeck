import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { writeFile, rm } from 'node:fs/promises';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { DATA_DIR, IS_WIN } from './env.mjs';

const run = promisify(execFile);
const DIR = path.join(DATA_DIR, 'voice');
const CLI = path.join(DIR, 'bin', IS_WIN ? 'whisper-cli.exe' : 'whisper-cli');
const MODEL = path.join(DIR, 'models', 'ggml-large-v3-turbo-q5_0.bin');

// Local Whisper (whisper.cpp: Vulkan on Linux, CPU on Windows). One process per clip; the model loads in about 0.2 s.
export class Stt {
  installed() { return existsSync(CLI) && existsSync(MODEL); }

  async transcribe(bytes) {
    if (!this.installed()) throw new Error('Voice input is not installed.');
    // The app records 16 kHz mono WAV, the format whisper.cpp reads.
    const wav = path.join(os.tmpdir(), `clawdeck-voice-${randomUUID()}.wav`);
    await writeFile(wav, Buffer.from(bytes));
    try {
      const { stdout } = await run(CLI, ['-m', MODEL, '-f', wav, '-l', 'auto', '-nt', '-np', '-bs', '1', '-bo', '1'], { timeout: 180000 });
      return { text: stdout.replace(/\s+/g, ' ').trim() };
    } finally {
      rm(wav, { force: true }).catch(() => {});
    }
  }
}

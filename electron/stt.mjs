import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { writeFile, rm } from 'node:fs/promises';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { HOME } from './env.mjs';

const run = promisify(execFile);
const DIR = path.join(process.env.XDG_DATA_HOME || path.join(HOME, '.local/share'), 'clawdeck/voice');
const CLI = path.join(DIR, 'bin/whisper-cli');
const MODEL = path.join(DIR, 'models/ggml-large-v3-turbo-q5_0.bin');

// Local Whisper (whisper.cpp on the GPU through Vulkan). One process per clip; the model loads in about 0.2 s.
export class Stt {
  installed() { return existsSync(CLI) && existsSync(MODEL); }

  async transcribe(bytes, ext = 'webm') {
    if (!this.installed()) throw new Error('Voice input is not installed. Run npm run setup-voice in the Clawdeck folder.');
    const base = path.join(os.tmpdir(), `clawdeck-voice-${randomUUID()}`);
    const clip = `${base}.${ext.replace(/\W/g, '')}`;
    const wav = `${base}.wav`;
    await writeFile(clip, Buffer.from(bytes));
    try {
      // whisper.cpp reads 16 kHz WAV; ffmpeg converts the browser's webm/opus.
      await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', clip, '-ar', '16000', '-ac', '1', '-c:a', 'pcm_s16le', wav]);
      const { stdout } = await run(CLI, ['-m', MODEL, '-f', wav, '-l', 'auto', '-nt', '-np', '-bs', '1', '-bo', '1'], { timeout: 120000 });
      return { text: stdout.replace(/\s+/g, ' ').trim() };
    } finally {
      rm(clip, { force: true }).catch(() => {});
      rm(wav, { force: true }).catch(() => {});
    }
  }
}

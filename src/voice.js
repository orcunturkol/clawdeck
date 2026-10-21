import { useRef, useState } from 'react';
import { call } from './api.js';
import { stopSpeaking } from './speech.js';

const RATE = 16000; // whisper.cpp reads 16 kHz mono WAV, so no converter is needed

// 16-bit PCM WAV from float samples.
function wav(chunks) {
  const n = chunks.reduce((a, c) => a + c.length, 0);
  const v = new DataView(new ArrayBuffer(44 + n * 2));
  const text = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  text(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); text(8, 'WAVE'); text(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, RATE, true); v.setUint32(28, RATE * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  text(36, 'data'); v.setUint32(40, n * 2, true);
  let o = 44;
  for (const c of chunks) for (let i = 0; i < c.length; i++, o += 2) v.setInt16(o, Math.max(-1, Math.min(1, c[i])) * 0x7fff, true);
  return new Uint8Array(v.buffer);
}

// Records the mic and sends the clip to local Whisper in the main process.
export function useVoice({ onText, onError, ensure }) {
  const [state, setState] = useState('idle'); // idle, recording, writing
  const [level, setLevel] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const rec = useRef(null);

  const finish = async (r) => {
    cancelAnimationFrame(r.raf);
    r.stream.getTracks().forEach((t) => t.stop());
    r.proc.disconnect();
    r.ctx.close();
    setLevel(0);
    if (r.cancelled || Date.now() - r.t0 < 400) { setState('idle'); return; }
    setState('writing');
    try {
      const res = await call('voice:transcribe', { bytes: wav(r.chunks), ext: 'wav' });
      if (res.text) onText(res.text);
    } catch (e) {
      onError(e.message);
    }
    setState('idle');
  };

  const start = async () => {
    if (rec.current || state === 'writing') return;
    stopSpeaking(); // the mic must not hear the voice
    const r = { chunks: [], cancelled: false, stopped: false, raf: 0 };
    rec.current = r;
    // Not installed yet: the app offers the download instead of recording.
    if (ensure && !(await ensure())) { rec.current = null; return; }
    try {
      r.stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } });
    } catch (e) {
      rec.current = null;
      onError(`The microphone did not start: ${e.message}`);
      return;
    }
    // Released before the mic was ready.
    if (r.stopped) { r.stream.getTracks().forEach((t) => t.stop()); return; }

    // The audio context resamples the mic to 16 kHz for us.
    r.ctx = new AudioContext({ sampleRate: RATE });
    const source = r.ctx.createMediaStreamSource(r.stream);
    const analyser = r.ctx.createAnalyser();
    analyser.fftSize = 1024;
    source.connect(analyser);
    r.proc = r.ctx.createScriptProcessor(4096, 1, 1);
    r.proc.onaudioprocess = (e) => { if (!r.stopped) r.chunks.push(new Float32Array(e.inputBuffer.getChannelData(0))); };
    source.connect(r.proc);
    r.proc.connect(r.ctx.destination); // silent, but the node only runs when connected

    const samples = new Float32Array(analyser.fftSize);
    r.t0 = Date.now();
    const tick = () => {
      analyser.getFloatTimeDomainData(samples);
      let peak = 0;
      for (const v of samples) peak = Math.max(peak, Math.abs(v));
      setLevel(Math.min(1, peak * 1.8));
      setElapsed(Date.now() - r.t0);
      r.raf = requestAnimationFrame(tick);
    };
    setState('recording');
    tick();
  };

  const stop = (cancel = false) => {
    const r = rec.current;
    if (!r) return;
    rec.current = null;
    r.cancelled = cancel;
    r.stopped = true;
    if (r.proc) finish(r);
  };

  return { state, level, elapsed, start, stop };
}

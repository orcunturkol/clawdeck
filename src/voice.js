import { useRef, useState } from 'react';
import { call } from './api.js';
import { stopSpeaking } from './speech.js';

// Records the mic and sends the clip to local Whisper in the main process.
export function useVoice({ onText, onError }) {
  const [state, setState] = useState('idle'); // idle, recording, writing
  const [level, setLevel] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const rec = useRef(null);

  const finish = async (r) => {
    cancelAnimationFrame(r.raf);
    r.stream.getTracks().forEach((t) => t.stop());
    r.ctx.close();
    setLevel(0);
    if (r.cancelled || Date.now() - r.t0 < 400) { setState('idle'); return; }
    setState('writing');
    try {
      const bytes = new Uint8Array(await new Blob(r.chunks, { type: 'audio/webm' }).arrayBuffer());
      const res = await call('voice:transcribe', { bytes, ext: 'webm' });
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
    try {
      r.stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } });
    } catch (e) {
      rec.current = null;
      onError(`The microphone did not start: ${e.message}`);
      return;
    }
    // Released before the mic was ready.
    if (r.stopped) { r.stream.getTracks().forEach((t) => t.stop()); return; }

    r.ctx = new AudioContext();
    const analyser = r.ctx.createAnalyser();
    analyser.fftSize = 1024;
    r.ctx.createMediaStreamSource(r.stream).connect(analyser);
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

    r.mr = new MediaRecorder(r.stream, { mimeType: 'audio/webm;codecs=opus' });
    r.mr.ondataavailable = (e) => e.data.size && r.chunks.push(e.data);
    r.mr.onstop = () => finish(r);
    r.mr.start(250);
    setState('recording');
    tick();
  };

  const stop = (cancel = false) => {
    const r = rec.current;
    if (!r) return;
    rec.current = null;
    r.cancelled = cancel;
    r.stopped = true;
    if (r.mr && r.mr.state !== 'inactive') r.mr.stop();
  };

  return { state, level, elapsed, start, stop };
}

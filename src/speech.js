import { call } from './api.js';

const TR_WORDS = new Set(('ve bir bu için ile da de mi mı ne çok daha olarak var yok ama gibi kadar sonra şimdi her şey bunu '
  + 'şu o ben sen biz siz değil evet hayır nasıl neden çünkü veya ya en ise olan oldu olur bunun önce artık sadece').split(' '));

// Turkish if common Turkish words or Turkish letters are frequent enough.
export function isTurkish(text) {
  const words = text.toLocaleLowerCase('tr').match(/[a-zçğıöşü]+/g) || [];
  if (words.length < 2 || /[äßÄ]/.test(text)) return false;
  const hits = words.filter((w) => TR_WORDS.has(w)).length / words.length;
  const letters = (text.match(/\p{L}/gu) || []).length || 1;
  const special = (text.match(/[çğıöşüÇĞİÖŞÜ]/g) || []).length / letters;
  return hits > 0.1 || (hits > 0.03 && special > 0.02) || special > 0.05;
}

// Markdown to plain sentences. Code and tables are not read.
export function speechChunks(md) {
  const text = md
    .replace(/```[\s\S]*?```/g, '\n')
    .replace(/^\s*\|.*\|\s*$/gm, '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^\s*(?:[-*+]|\d+\.)\s+/gm, '')
    .replace(/^\s*>\s?/gm, '')
    .replace(/(\*\*|__|\*|_|~~)(\S[^*_~]*?)\1/g, '$2');
  const paragraphs = text.split(/\n\s*\n/).map((p) => p.split('\n').map((l) => l.trim()).filter(Boolean)
    .map((l) => (/[.!?:;]$/.test(l) ? l : `${l}.`)).join(' ')).filter(Boolean);
  // Join short paragraphs so each request has some length.
  const chunks = [];
  for (const p of paragraphs) {
    if (chunks.length && chunks[chunks.length - 1].length + p.length < 400) chunks[chunks.length - 1] += ` ${p}`;
    else chunks.push(p);
  }
  return chunks;
}

let audio = null;
let run = 0;
const listeners = new Set();
const notify = (on) => listeners.forEach((fn) => fn(on));

export function onSpeaking(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function play(bytes) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(new Blob([bytes], { type: 'audio/wav' }));
    audio = new Audio(url);
    audio.onended = audio.onerror = () => { URL.revokeObjectURL(url); resolve(); };
    audio.play().catch(resolve);
  });
}

// Plays the chunks in order; the next one is made while the current one plays.
export async function speak(chunks, onError) {
  stopSpeaking();
  const mine = ++run;
  if (!chunks.length) return;
  notify(true);
  const ask = (text) => { const p = call('tts:say', { text }); p.catch(() => {}); return p; };
  let next = ask(chunks[0]);
  try {
    for (let i = 0; i < chunks.length; i++) {
      const res = await next;
      if (mine !== run) return;
      next = i + 1 < chunks.length ? ask(chunks[i + 1]) : null;
      await play(res.bytes);
      if (mine !== run) return;
    }
  } catch (e) {
    if (mine === run) onError?.(e.message);
  }
  if (mine === run) notify(false);
}

export function stopSpeaking() {
  run++;
  if (audio) { audio.pause(); audio = null; }
  notify(false);
}

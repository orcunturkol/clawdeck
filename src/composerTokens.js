// Pure helpers for inline attachment tokens such as [image1] and [file2] in the prompt text.

const TOKEN = /\[(?:image|file)\d+\]/g;

// Insert `token` at `caret`, with a space on each side where the neighbour is not whitespace.
export function insertToken(text, caret, token) {
  const at = Math.max(0, Math.min(caret ?? text.length, text.length));
  const before = text.slice(0, at);
  const after = text.slice(at);
  const lead = before && !/\s$/.test(before) ? ' ' : '';
  const trail = after && /^\s/.test(after) ? '' : ' ';
  const inserted = lead + token + trail;
  // The caret lands after the token and one space.
  return { text: before + inserted + after, caret: before.length + inserted.length + (trail ? 0 : 1) };
}

// Keep only the attachments whose token is still in the text.
export function reconcile(attachments, text) {
  const out = {};
  for (const k of Object.keys(attachments)) if (text.includes(k)) out[k] = attachments[k];
  return out;
}

// A path with spaces (common on Windows) needs quotes, or Claude Code reads only its first word.
export const mention = (p) => (/\s/.test(p) ? `@"${p}"` : `@${p}`);

// attachments: { '[image1]': {kind:'image', mediaType, data}, '[file1]': {kind:'file', path} }
// Images keep their token and go out in text order. File tokens become real @path mentions.
export function buildSend(text, attachments) {
  const images = [];
  const seen = new Set();
  const out = text.replace(TOKEN, (t) => {
    const a = attachments[t];
    if (!a) return t;
    if (a.kind === 'file') return mention(a.path);
    if (!seen.has(t)) { seen.add(t); images.push({ mediaType: a.mediaType, data: a.data }); }
    return t;
  });
  return { text: out.trim(), images };
}

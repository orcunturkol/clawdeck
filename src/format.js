export const home = { dir: '', cwd: '' };

export function shortPath(p) {
  if (!p) return '';
  if (home.cwd && p.startsWith(home.cwd + '/')) return p.slice(home.cwd.length + 1);
  return home.dir && p.startsWith(home.dir) ? '~' + p.slice(home.dir.length) : p;
}

// Commands shown in a row: the home folder becomes ~ (the exact command stays in the detail view).
export function tidyPaths(text) {
  if (!home.dir || !text) return text;
  return text.replace(new RegExp(`${home.dir.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=/|\\b|$)`, 'g'), '~');
}

// Folder paths stay absolute (home shown as ~).
export function folderPath(p) {
  return home.dir && p?.startsWith(home.dir) ? '~' + p.slice(home.dir.length) : p || '';
}

export function baseName(p) {
  return (p || '').split('/').filter(Boolean).pop() || '/';
}

export function tokens(n) {
  if (n >= 1e9) return (n / 1e9).toFixed(1) + 'B';
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(n >= 1e4 ? 0 : 1) + 'k';
  return String(n);
}

export function ago(ms) {
  const s = Math.round((Date.now() - ms) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  if (s < 7 * 86400) return `${Math.floor(s / 86400)} d ago`;
  return new Date(ms).toLocaleDateString();
}

export function resetTime(iso) {
  if (!iso) return '';
  const d = typeof iso === 'number' ? new Date(iso * 1000) : new Date(iso);
  const sameDay = d.toDateString() === new Date().toDateString();
  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return sameDay ? time : `${d.toLocaleDateString([], { weekday: 'short' })} ${time}`;
}

export function duration(ms) {
  if (ms == null) return '';
  if (ms < 1000) return `${ms} ms`;
  const s = ms / 1000;
  return s < 60 ? `${s.toFixed(1)} s` : `${Math.floor(s / 60)} min ${Math.round(s % 60)} s`;
}

export function since(ms) {
  const m = Math.floor((Date.now() - ms) / 60000);
  if (m < 1) return 'under 1 min';
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)} h ${m % 60} min`;
}

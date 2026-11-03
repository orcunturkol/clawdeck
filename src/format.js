export const home = { dir: '', cwd: '' };

// Windows paths use either slash and ignore case: C:\Users\me and c:/users/me are one folder.
const WIN = /^[a-zA-Z]:[\\/]/;
const SEP = /[\\/]/;

// The rest of p after dir ('' for dir itself), or null when p is not inside dir.
function under(p, dir) {
  if (!p || !dir) return null;
  const win = WIN.test(dir);
  const a = win ? p.replace(/\\/g, '/').toLowerCase() : p;
  const b = (win ? dir.replace(/\\/g, '/').toLowerCase() : dir).replace(/\/+$/, '');
  if (a === b) return '';
  return a.startsWith(b + '/') ? p.slice(b.length) : null;
}

export function shortPath(p) {
  if (!p) return '';
  const inCwd = under(p, home.cwd);
  if (inCwd) return inCwd.slice(1);
  return folderPath(p);
}

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Commands shown in a row: the home folder becomes ~ (the exact command stays in the detail view).
export function tidyPaths(text) {
  if (!home.dir || !text) return text;
  // On Windows a command can name home as C:\Users\me, C:/Users/me or /c/Users/me (Git Bash).
  const forms = WIN.test(home.dir)
    ? [home.dir, home.dir.replace(/\\/g, '/'), `/${home.dir[0].toLowerCase()}${home.dir.slice(2).replace(/\\/g, '/')}`]
    : [home.dir];
  const flags = WIN.test(home.dir) ? 'gi' : 'g';
  return text.replace(new RegExp(`(?:${forms.map(escape).join('|')})(?=[\\\\/]|\\b|$)`, flags), '~');
}

// Folder paths stay absolute (home shown as ~).
export function folderPath(p) {
  const rest = under(p, home.dir);
  return rest == null ? p || '' : '~' + rest;
}

export function baseName(p) {
  return (p || '').split(SEP).filter(Boolean).pop() || p || '/';
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

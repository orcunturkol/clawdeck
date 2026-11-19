import { useCallback, useEffect, useState } from 'react';
import { call } from '../api.js';
import Section from './Section.jsx';

const REFRESH_MS = 15000;

function DiffView({ dir, file }) {
  const [d, setD] = useState(null);
  useEffect(() => {
    let live = true;
    call('git:diff', { dir, file }).then((r) => live && setD(r)).catch((e) => live && setD({ diff: e.message }));
    return () => { live = false; };
  }, [dir, file]);
  if (!d) return <div className="git-diff muted">Loading</div>;
  if (!d.diff.trim()) return <div className="git-diff muted">No text changes.</div>;
  return (
    <pre className="diff git-diff">
      {d.diff.split('\n').map((l, i) => (
        <div key={i} className={l.startsWith('+') && !l.startsWith('+++') ? 'add' : l.startsWith('-') && !l.startsWith('---') ? 'del' : ''}>{l || ' '}</div>
      ))}
      {d.truncated && <div className="muted">Diff cut here. Open the file in VS Code to see the rest.</div>}
    </pre>
  );
}

function Counts({ add, del }) {
  return (
    <span className="git-counts">
      {add > 0 && <span className="git-add">+{add}</span>}
      {del > 0 && <span className="git-del">-{del}</span>}
    </span>
  );
}

function Node({ n, dir, depth, open, onOpen, onCode }) {
  const [folded, setFolded] = useState(false);
  const pad = { paddingLeft: 8 + depth * 14 };
  if (n.children) {
    return (
      <>
        <button className="git-row git-folder" style={pad} onClick={() => setFolded(!folded)} aria-expanded={!folded}>
          <span className="chev" aria-hidden />
          <span className="git-name">{n.name}</span>
          <Counts add={n.add} del={n.del} />
        </button>
        {!folded && n.children.map((c) => <Node key={c.path} n={c} dir={dir} depth={depth + 1} open={open} onOpen={onOpen} onCode={onCode} />)}
      </>
    );
  }
  const f = n.file;
  return (
    <>
      <div className="git-row-wrap" data-testid="git-file">
        <button className="git-row" style={pad} onClick={() => onOpen(open === f.path ? '' : f.path)} title={f.from ? `${f.from} -> ${f.path}` : f.path}>
          <span className={`git-st st-${f.status === '??' ? 'u' : f.status}`}>{f.status}</span>
          <span className="git-name">{n.name}</span>
          <Counts add={f.add} del={f.del} />
        </button>
        <button className="ghost git-code" onClick={() => onCode(f.path)} aria-label={`Open ${f.path} in VS Code`} title="Open in VS Code">Code</button>
      </div>
      {open === f.path && <DiffView dir={dir} file={f.path} />}
    </>
  );
}

function Project({ p, onCode }) {
  const [folded, setFolded] = useState(false);
  const [open, setOpen] = useState('');
  return (
    <div className="git-project" data-testid="git-project">
      <div className="git-head">
        <button className="git-title" onClick={() => setFolded(!folded)} aria-expanded={!folded} title={p.top}>
          <span className="chev" aria-hidden />
          <span className="git-name">{p.name}</span>
          <span className="git-branch">{p.detached ? 'detached' : p.branch}</span>
          {(p.ahead > 0 || p.behind > 0) && <span className="git-ab">{p.ahead > 0 && `↑${p.ahead}`}{p.behind > 0 && `↓${p.behind}`}</span>}
          <span className="git-n">{p.count}</span>
        </button>
        <button className="ghost git-code" data-testid="open-vscode" onClick={() => onCode(p.dir, '')} aria-label={`Open ${p.name} in VS Code`} title="Open the folder in VS Code">Code</button>
      </div>
      {!folded && (p.count === 0
        ? <div className="muted git-clean">No changes.</div>
        : p.tree.map((n) => <Node key={n.path} n={n} dir={p.dir} depth={0} open={open} onOpen={setOpen} onCode={(file) => onCode(p.dir, file)} />))}
      {!folded && p.truncated && <div className="muted git-clean">Only the first files show.</div>}
    </div>
  );
}

// The body mounts only while the section is open, so a closed section never polls git.
function GitBody() {
  const [list, setList] = useState(null);
  const [err, setErr] = useState('');
  const refresh = useCallback(() => call('git:projects').then((r) => { setList(r); setErr(''); }).catch((e) => setErr(e.message)), []);

  useEffect(() => {
    refresh();
    const t = setInterval(() => document.visibilityState === 'visible' && refresh(), REFRESH_MS);
    return () => clearInterval(t);
  }, [refresh]);

  const code = (dir, file) => call('editor:open', { dir, file }).catch((e) => setErr(e.message));
  return (
    <>
      <div className="git-bar">
        <button className="ghost" onClick={refresh}>Refresh</button>
        {list && <span className="muted">{list.reduce((n, p) => n + p.count, 0)} changes in {list.length} projects</span>}
      </div>
      {err && <div className="error">{err}</div>}
      {list && list.length === 0 && <div className="muted">No git projects found.</div>}
      {list && list.map((p) => <Project key={p.top} p={p} onCode={code} />)}
    </>
  );
}

export default function GitSection() {
  return (
    <div data-testid="git-section">
      <Section id="git" title="Git changes" icon="folder"><GitBody /></Section>
    </div>
  );
}

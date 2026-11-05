import { useRef, useState } from 'react';
import { ago, baseName, folderPath, since, tidyPaths } from '../format.js';
import Icon from './Icon.jsx';

const STATUS = {
  busy: ['Working', 'busy'],
  shell: ['Running a command', 'busy'],
  waiting: ['Waiting for you', 'wait'],
  needs_input: ['Waiting for you', 'wait'],
  idle: ['Idle', 'idle'],
};

const PLACE_ICON = { 'this window': 'window', terminal: 'terminal' };

export function where(r) {
  if (r.mine) return 'this window';
  if (r.entrypoint === 'cli') return 'terminal';
  if (r.entrypoint?.startsWith('sdk')) return 'app';
  return r.entrypoint || 'unknown';
}

// The title as a text box: Enter or a click elsewhere keeps the new name, Escape keeps the old one.
function TitleEdit({ value, className, onDone }) {
  const [text, setText] = useState(value);
  const ended = useRef(false);
  const done = (save) => {
    if (ended.current) return;
    ended.current = true;
    const name = text.trim();
    onDone(save && name && name !== value ? name : null);
  };
  return (
    <input
      className={`title-edit ${className}`} value={text} aria-label="Session name" autoFocus onFocus={(e) => e.target.select()}
      onChange={(e) => setText(e.target.value)} onBlur={() => done(true)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') done(true);
        if (e.key === 'Escape') done(false);
      }}
    />
  );
}

// While a name is typed, rows keep their places: a moved row takes the focus from the text box.
function useSteady(list, editing) {
  const order = useRef(null);
  if (!editing) { order.current = null; return list; }
  if (!order.current) order.current = list.map((r) => r.sessionId);
  const at = new Map(order.current.map((id, i) => [id, i]));
  const place = (r) => at.get(r.sessionId) ?? order.current.length;
  return [...list].sort((a, b) => place(a) - place(b));
}

function RenameButton({ onClick }) {
  return (
    <button className="run-close row-rename" aria-label="Rename this session" title="Rename this session" onClick={onClick}>
      <svg viewBox="0 0 12 12" aria-hidden="true"><path d="M2 10l.6-2.4L8 2.2 9.8 4 4.4 9.4zM7 3.2L8.8 5" /></svg>
    </button>
  );
}

function Shell({ sh, onStop }) {
  return (
    <li className="shell">
      <span className="shell-line">
        <Icon name="shell" />
        <code className="shell-cmd" title={sh.command}>{tidyPaths(sh.command.split('\n')[0])}</code>
      </span>
      <span className="shell-meta">
        {sh.ports.length > 0 && <span className="shell-ports">{sh.ports.map((p) => `:${p}`).join(' ')}</span>}
        <span>{since(sh.startedAt)}</span>
        <button className="small" onClick={() => onStop(sh)}>Stop</button>
      </span>
    </li>
  );
}

function Running({ running, activeId, onView, onStop, onClose, onRename }) {
  const [editing, setEditing] = useState(null);
  const rows = useSteady(running, editing);
  return (
    <section className="running" aria-label="Running Claude Code sessions">
      {running.length === 0 && <p className="muted pad">No Claude Code session is running.</p>}
      <ul className="run-list">
        {rows.map((r) => {
          const [label, tone] = STATUS[r.status] || [r.status, 'busy'];
          const open = r.sessionId === activeId; // known at once; the list itself refreshes every 2 s
          return (
            <li key={r.pid || r.sessionId} className={`run ${tone} ${open ? 'active' : ''}`}>
              <div className="run-row">
                {editing === r.sessionId ? (
                  <div className="run-main">
                    <span className="led" />
                    <Icon name={PLACE_ICON[where(r)] || 'app'} className="run-icon" />
                    <TitleEdit value={r.title || r.name} className="run-title" onDone={(name) => { setEditing(null); if (name) onRename(r.sessionId, r.cwd, name); }} />
                    <span className="run-meta">{baseName(r.cwd)}, {where(r)}, {label.toLowerCase()}</span>
                  </div>
                ) : (
                  <button className="run-main" onClick={() => onView(r)} title={`${r.title || r.name}\n${folderPath(r.cwd)}\nProcess ${r.pid}`}>
                    <span className="led" />
                    <Icon name={PLACE_ICON[where(r)] || 'app'} className="run-icon" />
                    <span className="run-title">{r.title || r.name}</span>
                    <span className="run-meta">{baseName(r.cwd)}, {where(r)}, {label.toLowerCase()}</span>
                  </button>
                )}
                {editing !== r.sessionId && <RenameButton onClick={() => setEditing(r.sessionId)} />}
                {r.mine && !open && (
                  <button className="run-close" aria-label="Close this chat" title="Close this chat (its history stays)" onClick={() => onClose(r)}>
                    <svg viewBox="0 0 12 12" aria-hidden="true"><path d="M3 3l6 6M9 3l-6 6" /></svg>
                  </button>
                )}
              </div>
              {r.shells.length > 0 && (
                <ul className="run-shells">
                  {r.shells.map((sh) => <Shell key={sh.pid} sh={sh} onStop={onStop} />)}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export default function Sessions({ cwd, recent, sessions, activeId, running, onNew, onOpen, onView, onStopShell, onCloseChat, onRename, onPickDir, onDir, tab, setTab, version }) {
  const live = new Map((running || []).map((r) => [r.sessionId, r]));
  const [editing, setEditing] = useState(null);
  const rows = useSteady(sessions || [], editing);
  const tabProps = (id) => ({ role: 'tab', 'aria-selected': tab === id, onClick: () => setTab(id) });
  return (
    <aside className="sessions">
      <div className="rail-tabs" role="tablist" aria-label="Sessions">
        <button {...tabProps('folder')}>This folder</button>
        <button {...tabProps('running')}>Running <span className="tab-count">{running?.length || 0}</span></button>
      </div>
      {tab === 'running' ? <Running running={running || []} activeId={activeId} onView={onView} onStop={onStopShell} onClose={onCloseChat} onRename={onRename} /> : <>
        <div className="folder">
          <button className="folder-name" onClick={onPickDir} title={`${folderPath(cwd)}\nClick to choose another folder`}>
            <span className="folder-base"><Icon name="folder" />{baseName(cwd)}</span>
            <span className="folder-path">{folderPath(cwd)}</span>
          </button>
          {recent.filter((d) => d !== cwd).length > 0 && (
            <select className="recent" value="" onChange={(e) => e.target.value && onDir(e.target.value)} aria-label="Recent folders">
              <option value="">Recent folders</option>
              {recent.filter((d) => d !== cwd).map((d) => <option key={d} value={d}>{folderPath(d)}</option>)}
            </select>
          )}
        </div>
        <button className="new-session" onClick={onNew}><Icon name="plus" />New session</button>
        <nav className="session-list" aria-label="Sessions in this folder">
          {sessions === null && <p className="muted pad">Loading sessions</p>}
          {sessions?.length === 0 && <p className="muted pad">No sessions in this folder yet.</p>}
          {rows.map((s) => {
            const r = live.get(s.sessionId);
            const [, tone] = r ? STATUS[r.status] || [r.status, 'busy'] : [];
            const cls = `session ${s.sessionId === activeId ? 'on' : ''} ${r ? `live ${tone}` : ''}`;
            const title = s.customTitle || s.summary || 'Untitled session';
            const meta = <span className="session-meta">{r ? `running in ${where(r)}` : ago(s.lastAnswer || s.lastModified)}{s.gitBranch ? `, ${s.gitBranch}` : ''}</span>;
            return (
              <div key={s.sessionId} className="session-row">
                {editing === s.sessionId ? (
                  <div className={cls}>
                    <TitleEdit value={title} className="session-title" onDone={(name) => { setEditing(null); if (name) onRename(s.sessionId, s.cwd || cwd, name); }} />
                    {meta}
                  </div>
                ) : (
                  <button className={cls} onClick={() => (r && !r.mine ? onView(r) : onOpen(s.sessionId))}>
                    <span className="session-title">{r && <span className="led" />}{title}</span>
                    {meta}
                  </button>
                )}
                {editing !== s.sessionId && <RenameButton onClick={() => setEditing(s.sessionId)} />}
              </div>
            );
          })}
        </nav>
      </>}
      {version && <div className="rail-foot">Clawdeck {version}</div>}
    </aside>
  );
}

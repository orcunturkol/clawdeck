import { useState } from 'react';
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

function Running({ running, onView, onStop, onClose }) {
  return (
    <section className="running" aria-label="Running Claude Code sessions">
      {running.length === 0 && <p className="muted pad">No Claude Code session is running.</p>}
      <ul className="run-list">
        {running.map((r) => {
          const [label, tone] = STATUS[r.status] || [r.status, 'busy'];
          return (
            <li key={r.pid} className={`run ${tone} ${r.active ? 'active' : ''}`}>
              <div className="run-row">
                <button className="run-main" onClick={() => onView(r)} title={`${r.title || r.name}\n${folderPath(r.cwd)}\nProcess ${r.pid}`}>
                  <span className="led" />
                  <Icon name={PLACE_ICON[where(r)] || 'app'} className="run-icon" />
                  <span className="run-title">{r.title || r.name}</span>
                  <span className="run-meta">{baseName(r.cwd)}, {where(r)}, {label.toLowerCase()}</span>
                </button>
                {r.mine && !r.active && (
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

export default function Sessions({ cwd, recent, sessions, activeId, running, onNew, onOpen, onView, onStopShell, onCloseChat, onPickDir, onDir }) {
  const [tab, setTab] = useState('folder');
  const live = new Map((running || []).map((r) => [r.sessionId, r]));
  const tabProps = (id) => ({ role: 'tab', 'aria-selected': tab === id, onClick: () => setTab(id) });
  return (
    <aside className="sessions">
      <div className="rail-tabs" role="tablist" aria-label="Sessions">
        <button {...tabProps('folder')}>This folder</button>
        <button {...tabProps('running')}>Running <span className="tab-count">{running?.length || 0}</span></button>
      </div>
      {tab === 'running' ? <Running running={running || []} onView={onView} onStop={onStopShell} onClose={onCloseChat} /> : <>
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
          {sessions?.map((s) => {
            const r = live.get(s.sessionId);
            const [, tone] = r ? STATUS[r.status] || [r.status, 'busy'] : [];
            return (
              <button
                key={s.sessionId} className={`session ${s.sessionId === activeId ? 'on' : ''} ${r ? `live ${tone}` : ''}`}
                onClick={() => (r && !r.mine ? onView(r) : onOpen(s.sessionId))}
              >
                <span className="session-title">{r && <span className="led" />}{s.customTitle || s.summary || 'Untitled session'}</span>
                <span className="session-meta">{r ? `running in ${where(r)}` : ago(s.lastModified)}{s.gitBranch ? `, ${s.gitBranch}` : ''}</span>
              </button>
            );
          })}
        </nav>
      </>}
    </aside>
  );
}

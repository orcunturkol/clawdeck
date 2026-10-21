import { useEffect, useState } from 'react';
import { call } from '../api.js';
import Section from './Section.jsx';
import Switch from './Switch.jsx';

const STATUS = {
  connected: 'Connected',
  pending: 'Connecting',
  failed: 'Failed',
  'needs-auth': 'Needs sign-in',
  disabled: 'Off',
};

const SOURCE = { claudeai: 'claude.ai', plugin: 'Plugin', user: 'User', project: 'Project', local: 'Local', dynamic: 'Plugin' };

function Server({ s, onToggle, onReconnect, busy }) {
  const [open, setOpen] = useState(false);
  return (
    <li className={`item mcp ${s.status}`}>
      <div className="item-row">
        <button className="item-main" onClick={() => setOpen(!open)} aria-expanded={open}>
          <span className="led" title={STATUS[s.status]} />
          <span className="item-name">{s.name.replace(/^plugin:[^:]+:/, '')}</span>
          <span className="item-meta">{STATUS[s.status] || s.status}{s.tools.length ? `, ${s.tools.length} tools` : ''}</span>
        </button>
        <Switch on={s.status !== 'disabled'} busy={busy} label={`Turn ${s.name} on or off`} onChange={(on) => onToggle(s.name, on)} />
      </div>
      {open && (
        <div className="item-detail">
          <dl className="facts">
            <dt>Source</dt><dd>{SOURCE[s.source] || s.source || s.scope}</dd>
            <dt>Runs</dt><dd className="mono">{s.transport}: {s.target}</dd>
            {s.serverInfo && <><dt>Server</dt><dd>{s.serverInfo.name} {s.serverInfo.version}</dd></>}
          </dl>
          {s.error && <p className="err">{s.error}</p>}
          {s.status === 'needs-auth' && <p className="muted">Sign in with /mcp in the terminal, then reconnect here.</p>}
          {s.status !== 'disabled' && <button className="small" disabled={busy} onClick={() => onReconnect(s.name)}>Reconnect</button>}
          {s.tools.length > 0 && (
            <ul className="tool-list">
              {s.tools.map((t) => <li key={t.name} title={t.description}>{t.name}</li>)}
            </ul>
          )}
        </div>
      )}
    </li>
  );
}

export default function McpSection({ ready, rev }) {
  const [servers, setServers] = useState(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

  const load = () => call('mcp:status').then(setServers).catch((e) => setError(e.message));

  useEffect(() => { if (ready) load(); }, [ready, rev]);
  // Servers that are still connecting change state on their own.
  useEffect(() => {
    if (!servers?.some((s) => s.status === 'pending')) return;
    const t = setTimeout(load, 3000);
    return () => clearTimeout(t);
  }, [servers]);

  const act = async (name, fn) => {
    setBusy(name); setError('');
    try { await fn(); } catch (e) { setError(e.message); }
    await load();
    setBusy('');
  };

  const on = servers?.filter((s) => s.status === 'connected').length ?? 0;
  return (
    <Section title="MCP servers" icon="plug" summary={servers ? `${on} of ${servers.length} connected` : ''} defaultOpen>
      {!servers && <p className="muted">{ready ? 'Checking servers' : 'Waiting for Claude Code'}</p>}
      {error && <p className="err">{error}</p>}
      <ul className="items">
        {servers?.map((s) => (
          <Server key={s.name} s={s} busy={busy === s.name}
            onToggle={(name, enabled) => act(name, () => call('mcp:toggle', { name, enabled }))}
            onReconnect={(name) => act(name, () => call('mcp:reconnect', { name }))} />
        ))}
      </ul>
    </Section>
  );
}

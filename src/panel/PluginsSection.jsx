import { useEffect, useState } from 'react';
import { call } from '../api.js';
import Section from './Section.jsx';
import Switch from './Switch.jsx';

export default function PluginsSection({ errors = [], onChanged }) {
  const [plugins, setPlugins] = useState(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

  const load = () => call('plugins:list').then(setPlugins).catch((e) => setError(e.message));
  useEffect(() => { load(); }, []);

  const toggle = async (id, enabled) => {
    setBusy(id); setError('');
    try {
      onChanged(await call('plugins:toggle', { id, enabled }));
    } catch (e) { setError(e.message); }
    await load();
    setBusy('');
  };

  const on = plugins?.filter((p) => p.enabled).length ?? 0;
  return (
    <Section title="Plugins" icon="cartridge" summary={plugins ? `${on} of ${plugins.length} on` : ''}>
      {!plugins && !error && <p className="muted">Reading installed plugins</p>}
      {error && <p className="err">{error}</p>}
      <ul className="items">
        {plugins?.map((p) => {
          const [name, market] = p.id.split('@');
          const err = errors.find((e) => e.plugin === p.id);
          return (
            <li key={p.id} className="item">
              <div className="item-row">
                <div className="item-main static">
                  <span className="item-name">{name}</span>
                  <span className="item-meta">{market}{p.version && !/^[0-9a-f]{12}$/.test(p.version) ? `, ${p.version}` : ''}{p.mcpServers.length ? `, MCP: ${p.mcpServers.join(', ')}` : ''}</span>
                </div>
                <Switch on={p.enabled} busy={busy === p.id} label={`Turn ${name} on or off`} onChange={(v) => toggle(p.id, v)} />
              </div>
              {err && <p className="err">{err.message}</p>}
            </li>
          );
        })}
      </ul>
    </Section>
  );
}

import { useEffect, useMemo, useState } from 'react';
import { call } from '../api.js';
import Section from './Section.jsx';

function splitSource(c) {
  const m = c.description.match(/^([\s\S]*?)\s*\(([\w .-]+)\)$/);
  const desc = (m ? m[1] : c.description).replace(/^\([\w .-]+\)\s*/, '');
  const source = c.name.includes(':') ? c.name.split(':')[0] : m ? m[2] : '';
  return { desc, source };
}

function CommandList({ commands, onInsert, empty }) {
  const [q, setQ] = useState('');
  const list = useMemo(() => {
    const s = q.toLowerCase();
    return commands.filter((c) => !s || c.name.toLowerCase().includes(s) || c.description.toLowerCase().includes(s));
  }, [q, commands]);
  return (
    <>
      <input className="search" placeholder="Filter" value={q} onChange={(e) => setQ(e.target.value)} />
      {list.length === 0 && <p className="muted">{empty}</p>}
      <ul className="items">
        {list.map((c) => {
          const { desc, source } = splitSource(c);
          return (
            <li key={c.name} className="item">
              <button className="item-main stack" onClick={() => onInsert(`/${c.name} `)} title="Put this command in the message box">
                <span className="item-name">/{c.name}{c.argumentHint ? <span className="arg"> {c.argumentHint}</span> : null}</span>
                <span className="item-desc">{desc}</span>
                {source && <span className="item-meta">{source}</span>}
              </button>
            </li>
          );
        })}
      </ul>
    </>
  );
}

export function SkillsSection({ commands, onInsert }) {
  const skills = commands.filter((c) => !c.builtin);
  return (
    <Section title="Skills" icon="spark" summary={skills.length ? String(skills.length) : ''}>
      <CommandList commands={skills} onInsert={onInsert} empty="No skills match." />
    </Section>
  );
}

export function CommandsSection({ commands, onInsert }) {
  const builtin = commands.filter((c) => c.builtin);
  return (
    <Section title="Commands" icon="slash" summary={builtin.length ? String(builtin.length) : ''}>
      <CommandList commands={builtin} onInsert={onInsert} empty="No commands match." />
    </Section>
  );
}

export function AgentsSection({ agents = [] }) {
  return (
    <Section title="Agents" icon="robot" summary={agents.length ? String(agents.length) : ''}>
      <ul className="items">
        {agents.map((a) => (
          <li key={a.name} className="item">
            <div className="item-main stack static">
              <span className="item-name">{a.name}</span>
              <span className="item-desc">{a.description}</span>
              {a.model && <span className="item-meta">Model: {a.model}</span>}
            </div>
          </li>
        ))}
      </ul>
    </Section>
  );
}

export function HooksSection({ cwd, rev }) {
  const [hooks, setHooks] = useState(null);
  useEffect(() => { call('hooks:list', { cwd }).then(setHooks).catch(() => setHooks([])); }, [cwd, rev]);
  return (
    <Section title="Hooks" icon="hook" summary={hooks ? String(hooks.length) : ''}>
      {hooks?.length === 0 && <p className="muted">No hooks in user, project or plugin settings.</p>}
      <ul className="items">
        {hooks?.map((h, i) => (
          <li key={i} className="item">
            <div className="item-main stack static">
              <span className="item-name">{h.event}{h.matcher ? <span className="arg"> {h.matcher}</span> : null}</span>
              <span className="item-desc mono">{h.command}</span>
              <span className="item-meta">{h.source}</span>
            </div>
          </li>
        ))}
      </ul>
    </Section>
  );
}

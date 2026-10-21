import { useEffect, useState } from 'react';
import { call } from '../api.js';
import Section from './Section.jsx';

function Editor({ cwd, file, onClose }) {
  const [text, setText] = useState(null);
  const [orig, setOrig] = useState('');
  const [msg, setMsg] = useState('');

  useEffect(() => {
    call('memory:read', { cwd, file: file.path }).then((t) => { setText(t); setOrig(t); });
  }, [file.path]);

  const dirty = text !== null && text !== orig;
  const save = async () => {
    try {
      await call('memory:write', { cwd, file: file.path, content: text });
      setOrig(text);
      setMsg('Saved');
    } catch (e) { setMsg(e.message); }
  };
  const close = () => {
    if (dirty && !window.confirm('Close without saving your changes?')) return;
    onClose();
  };
  const onKey = (e) => {
    if (e.key === 's' && e.ctrlKey) { e.preventDefault(); save(); }
    if (e.key === 'Escape') close();
  };

  return (
    <div className="editor" role="dialog" aria-label={`Edit ${file.label}`} onKeyDown={onKey}>
      <div className="editor-head">
        <div>
          <div className="editor-title">{file.label}</div>
          <div className="editor-path">{file.short}</div>
        </div>
        <button className="ghost" onClick={close}>Close</button>
      </div>
      <textarea className="mono" value={text ?? ''} disabled={text === null} spellCheck={false} onChange={(e) => { setText(e.target.value); setMsg(''); }} autoFocus />
      <div className="editor-foot">
        <span className="muted">{msg || (dirty ? 'Unsaved changes' : file.exists ? '' : 'New file, saved on first save')}</span>
        <button onClick={() => { setText(orig); setMsg(''); }} disabled={!dirty}>Revert</button>
        <button className="primary" onClick={save} disabled={!dirty}>Save</button>
      </div>
    </div>
  );
}

export default function MemorySection({ cwd, rev }) {
  const [files, setFiles] = useState(null);
  const [editing, setEditing] = useState(null);
  const load = () => call('memory:list', { cwd }).then(setFiles).catch(() => setFiles([]));
  useEffect(() => { load(); }, [cwd, rev]);

  const groups = ['Instructions', 'Memory'];
  const count = files?.filter((f) => f.exists).length ?? 0;
  return (
    <Section title="CLAUDE.md and memory" icon="notebook" summary={files ? `${count} file${count === 1 ? '' : 's'}` : ''}>
      {groups.map((g) => {
        const list = files?.filter((f) => f.group === g) || [];
        return (
          <div key={g}>
            <h4 className="sub-head">{g === 'Memory' ? 'Memory for this folder' : 'Instructions'}</h4>
            {g === 'Memory' && list.length === 0 && <p className="muted">No memory files for this folder yet.</p>}
            <ul className="items">
              {list.map((f) => (
                <li key={f.path} className={`item ${f.exists ? '' : 'missing'}`}>
                  <button className="item-main stack" onClick={() => setEditing(f)}>
                    <span className="item-name">{f.label}</span>
                    <span className="item-meta">{f.exists ? f.short : `Not created: ${f.short}`}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
      {editing && <Editor cwd={cwd} file={editing} onClose={() => { setEditing(null); load(); }} />}
    </Section>
  );
}

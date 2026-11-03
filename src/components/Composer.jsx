import { useEffect, useMemo, useRef, useState } from 'react';
import Icon from './Icon.jsx';

export const MODES = [
  { value: 'default', label: 'Ask before edits' },
  { value: 'acceptEdits', label: 'Accept edits' },
  { value: 'auto', label: 'Auto' },
  { value: 'plan', label: 'Plan' },
  { value: 'dontAsk', label: "Don't ask" },
  { value: 'bypassPermissions', label: 'Bypass permissions' },
];
const CYCLE = ['default', 'acceptEdits', 'auto', 'plan'];

function readImage(file) {
  return new Promise((resolve) => {
    const r = new FileReader();
    r.onload = () => resolve({ mediaType: file.type, data: r.result.split(',')[1], url: r.result });
    r.readAsDataURL(file);
  });
}

// A path with spaces (common on Windows) needs quotes, or Claude Code reads only its first word.
const mention = (p) => (/\s/.test(p) ? `@"${p}"` : `@${p}`);

export default function Composer({ running, disabled, commands, mode, setMode, webSearch, setWebSearch, onSend, onStop, draft, setDraft, lockedText, suggestion, remote, setRemote }) {
  const [images, setImages] = useState([]);
  const [pick, setPick] = useState(0);
  const ref = useRef(null);

  const slash = /^\/\S*$/.test(draft) ? draft.slice(1).toLowerCase() : null;
  const matches = useMemo(() => {
    if (slash == null) return [];
    return commands.filter((c) => c.name.toLowerCase().includes(slash)).sort((a, b) => a.name.toLowerCase().indexOf(slash) - b.name.toLowerCase().indexOf(slash)).slice(0, 8);
  }, [slash, commands]);

  useEffect(() => setPick(0), [slash]);
  useEffect(() => {
    const el = ref.current;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 320) + 'px';
  }, [draft]);
  useEffect(() => { if (!disabled) ref.current.focus(); }, [disabled]);

  const send = () => {
    if (!draft.trim() && !images.length) return;
    onSend(draft.trim(), images.map(({ mediaType, data }) => ({ mediaType, data })));
    setDraft('');
    setImages([]);
  };

  const choose = (c) => { setDraft(`/${c.name} `); ref.current.focus(); };

  const onKey = (e) => {
    if (matches.length) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setPick((pick + 1) % matches.length); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); setPick((pick - 1 + matches.length) % matches.length); return; }
      if (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey)) { e.preventDefault(); choose(matches[pick]); return; }
      if (e.key === 'Escape') { setDraft(draft + ' '); return; }
    }
    // Tab or Right arrow takes Claude's suggested next prompt into the empty box.
    if (suggestion && !draft && ((e.key === 'Tab' && !e.shiftKey) || e.key === 'ArrowRight')) {
      e.preventDefault();
      setDraft(suggestion);
      return;
    }
    if (e.key === 'Tab' && e.shiftKey) {
      e.preventDefault();
      const i = CYCLE.indexOf(mode);
      setMode(CYCLE[(i + 1) % CYCLE.length]);
      return;
    }
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send(); }
    if (e.key === 'Escape' && running) onStop();
  };

  const onPaste = async (e) => {
    const files = [...e.clipboardData.files].filter((f) => f.type.startsWith('image/'));
    if (!files.length) return;
    e.preventDefault();
    const read = await Promise.all(files.map(readImage));
    setImages((prev) => [...prev, ...read]);
  };

  const onDrop = async (e) => {
    const files = [...e.dataTransfer.files];
    if (!files.length) return;
    e.preventDefault();
    const imgs = files.filter((f) => f.type.startsWith('image/'));
    const others = files.filter((f) => !f.type.startsWith('image/'));
    if (imgs.length) setImages([...images, ...(await Promise.all(imgs.map(readImage)))]);
    if (others.length) setDraft(`${draft}${draft && !draft.endsWith(' ') ? ' ' : ''}${others.map((f) => mention(window.deck.pathForFile(f))).join(' ')} `);
  };

  return (
    <div className="composer" onDrop={onDrop} onDragOver={(e) => e.preventDefault()}>
      {matches.length > 0 && (
        <ul className="slash-menu" role="listbox">
          {matches.map((c, i) => (
            <li key={c.name} role="option" aria-selected={i === pick} className={i === pick ? 'on' : ''} onMouseDown={(e) => { e.preventDefault(); choose(c); }}>
              <span className="slash-name">/{c.name}</span>
              <span className="slash-desc">{c.description}</span>
            </li>
          ))}
        </ul>
      )}
      {images.length > 0 && (
        <div className="thumbs">
          {images.map((img, i) => (
            <button key={i} className="thumb" title="Remove image" onClick={() => setImages(images.filter((_, j) => j !== i))}>
              <img src={img.url} alt="" />
            </button>
          ))}
        </div>
      )}
      <textarea
        ref={ref} rows={1} value={draft} disabled={disabled}
        placeholder={lockedText || (disabled ? 'Starting Claude Code' : suggestion || 'Message Claude, or type / for skills and commands')}
        className={suggestion && !draft ? 'suggesting' : ''}
        onChange={(e) => setDraft(e.target.value)} onKeyDown={onKey} onPaste={onPaste}
      />
      <div className="composer-bar">
        <label className="mode">
          <span className="sr-only">Permission mode</span>
          <select value={mode} onChange={(e) => setMode(e.target.value)} title="Shift+Tab cycles modes">
            {MODES.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
          </select>
        </label>
        <button className={`web-toggle ${webSearch ? 'on' : ''}`} aria-pressed={webSearch} aria-label="Web search" onClick={() => setWebSearch(!webSearch)}
          title={webSearch ? 'Claude can search the web and open pages' : 'Claude cannot use the web'}>
          <Icon name="globe" /><span className="label">Web search</span>
        </button>
        <button
          className={`web-toggle ${remote !== 'off' ? 'on' : ''} ${remote === 'connecting' ? 'connecting' : ''}`} aria-pressed={remote !== 'off'} aria-label="Remote control"
          disabled={disabled} onClick={() => setRemote(remote === 'off')}
          title={{ off: 'Continue this chat in the Claude app or on claude.ai/code', connecting: 'Remote control is connecting', on: 'Remote control is on. Click to turn it off.' }[remote]}
        >
          <Icon name="phone" /><span className="label">Remote control</span>
        </button>
        <span className="hint">{suggestion && !draft ? 'Tab or → takes the suggestion, Enter sends' : 'Enter to send, Shift+Enter for a new line'}</span>
        {running
          ? <button className="stop" aria-label="Stop" onClick={onStop}><Icon name="stop" /><span className="label">Stop</span></button>
          : <button className="primary" aria-label="Send" onClick={send} disabled={disabled || (!draft.trim() && !images.length)}><Icon name="send" /><span className="label">Send</span></button>}
      </div>
    </div>
  );
}

import { useEffect, useMemo, useRef, useState } from 'react';
import { useVoice } from '../voice.js';
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

const clock = (ms) => `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}`;

export default function Composer({ running, disabled, commands, mode, setMode, webSearch, setWebSearch, onSend, onStop, onError, draft, setDraft, lockedText, readAloud, setReadAloud, speaking, suggestion }) {
  const [images, setImages] = useState([]);
  const [pick, setPick] = useState(0);
  const ref = useRef(null);
  const voice = useVoice({
    onText: (t) => { setDraft((d) => (d ? `${d}${/\s$/.test(d) ? '' : ' '}${t}` : t)); ref.current?.focus(); },
    onError,
  });
  const voiceRef = useRef(voice);
  voiceRef.current = voice;
  const draftRef = useRef(draft);
  draftRef.current = draft;

  // Push to talk: hold Space while the message box is empty, or hold Ctrl+Space anywhere. Escape cancels.
  useEffect(() => {
    let holding = false;
    let spaceTimer = null;
    let spaceTalk = false;
    // Space talks only in the empty message box; other fields and buttons keep their Space.
    const spaceFree = (target) => (target === ref.current || target === document.body) && !draftRef.current && !ref.current?.disabled;
    const plainSpace = (e) => e.code === 'Space' && !e.ctrlKey && !e.altKey && !e.metaKey && !e.shiftKey;
    const down = (e) => {
      if (e.code === 'Space' && e.ctrlKey && !e.repeat) {
        e.preventDefault();
        if (!holding) { holding = true; voiceRef.current.start(); }
      } else if (plainSpace(e) && (spaceTimer || spaceTalk || spaceFree(e.target))) {
        e.preventDefault();
        // A short press does nothing; holding a moment starts the mic.
        if (!e.repeat && !spaceTimer && !spaceTalk) {
          spaceTimer = setTimeout(() => { spaceTimer = null; spaceTalk = true; voiceRef.current.start(); }, 250);
        }
      } else if (e.key === 'Escape' && voiceRef.current.state === 'recording') {
        voiceRef.current.stop(true);
      }
    };
    const up = (e) => {
      if (holding && (e.code === 'Space' || e.key === 'Control')) { holding = false; voiceRef.current.stop(); }
      if (e.code === 'Space') {
        if (spaceTimer) { clearTimeout(spaceTimer); spaceTimer = null; }
        if (spaceTalk) { spaceTalk = false; voiceRef.current.stop(); }
      }
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); };
  }, []);

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
    if (e.key === 'Escape' && running && voice.state !== 'recording') onStop();
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
    if (others.length) setDraft(`${draft}${draft && !draft.endsWith(' ') ? ' ' : ''}${others.map((f) => '@' + window.deck.pathForFile(f)).join(' ')} `);
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
          className={`voice ${voice.state}`} disabled={voice.state === 'writing'} aria-label="Voice"
          onClick={() => (voice.state === 'recording' ? voice.stop() : voice.start())}
          title="Talk to type: hold Space in the empty message box, hold Ctrl+Space anywhere, or click to start and stop. Escape cancels."
        >
          {voice.state === 'idle' && (
            <><Icon name="mic" /><span className="label">Voice</span></>
          )}
          {voice.state === 'recording' && (
            <>
              <span className="led rec" />{clock(voice.elapsed)}
              <span className="vu" aria-hidden>
                {Array.from({ length: 8 }, (_, i) => <span key={i} className={i < Math.round(voice.level * 8) ? 'lit' : ''} />)}
              </span>
              Stop
            </>
          )}
          {voice.state === 'writing' && <><span className="led busy" /><span className="label">Writing</span></>}
        </button>
        <button
          className={`web-toggle ${readAloud ? 'on' : ''} ${speaking ? 'speaking' : ''}`} aria-pressed={readAloud} aria-label="Read aloud"
          onClick={() => setReadAloud(!readAloud)} title={readAloud ? 'Turkish answers are read aloud' : 'Turkish answers are not read aloud'}
        >
          <Icon name="speaker" /><span className="label">Read aloud</span>
        </button>
        <span className="hint">{suggestion && !draft ? 'Tab or → takes the suggestion, Enter sends' : 'Enter to send, Shift+Enter for a new line, hold Space to talk'}</span>
        {running
          ? <button className="stop" aria-label="Stop" onClick={onStop}><Icon name="stop" /><span className="label">Stop</span></button>
          : <button className="primary" aria-label="Send" onClick={send} disabled={disabled || (!draft.trim() && !images.length)}><Icon name="send" /><span className="label">Send</span></button>}
      </div>
    </div>
  );
}

import { useEffect, useRef, useState } from 'react';
import { call } from '../api.js';

function toUrl(input) {
  const t = input.trim();
  if (/^[a-z]+:\/\//i.test(t)) return t;
  if (/^[^\s]+\.[a-z]{2,}(\/\S*)?$/i.test(t)) return `https://${t}`;
  return `https://duckduckgo.com/?q=${encodeURIComponent(t)}`;
}

export default function BrowserPane({ state }) {
  const holder = useRef(null);
  const [address, setAddress] = useState('');
  const [editing, setEditing] = useState(false);

  // The page is a native view; keep it on top of this placeholder.
  useEffect(() => {
    const el = holder.current;
    const send = () => {
      const r = el.getBoundingClientRect();
      call('browser:bounds', { x: Math.round(r.left), y: Math.round(r.top), width: Math.round(r.width), height: Math.round(r.height) });
    };
    const ro = new ResizeObserver(send);
    ro.observe(el);
    window.addEventListener('resize', send);
    return () => { ro.disconnect(); window.removeEventListener('resize', send); call('browser:hide'); };
  }, []);

  useEffect(() => { if (!editing) setAddress(state.url || ''); }, [state.url, editing]);

  const go = (e) => {
    e.preventDefault();
    if (address.trim()) call('browser:navigate', { url: toUrl(address) });
    setEditing(false);
    e.target.querySelector('input').blur();
  };

  const userHasIt = state.control === 'user';
  return (
    <aside className="browser" aria-label="Browser">
      <div className="browser-bar">
        <button className="ghost icon" aria-label="Back" disabled={!state.canGoBack} onClick={() => call('browser:back')}>
          <svg viewBox="0 0 12 12"><path d="M7.5 2.5L4 6l3.5 3.5" /></svg>
        </button>
        <button className="ghost icon" aria-label="Forward" disabled={!state.canGoForward} onClick={() => call('browser:forward')}>
          <svg viewBox="0 0 12 12"><path d="M4.5 2.5L8 6l-3.5 3.5" /></svg>
        </button>
        <button className="ghost icon" aria-label={state.loading ? 'Stop' : 'Reload'} onClick={() => call('browser:reload')}>
          <svg viewBox="0 0 12 12">{state.loading ? <path d="M3 3l6 6M9 3l-6 6" /> : <path d="M9.5 6a3.5 3.5 0 1 1-1-2.5M9.5 2v2.2H7.3" />}</svg>
        </button>
        <form className="address" onSubmit={go}>
          <input
            value={address} placeholder="Search or enter address" spellCheck={false}
            onFocus={(e) => { setEditing(true); e.target.select(); }} onBlur={() => setEditing(false)}
            onChange={(e) => setAddress(e.target.value)}
          />
        </form>
      </div>
      <div className="browser-status">
        <span className={`led ${state.busy ? 'busy' : userHasIt ? 'user' : ''}`} />
        <span className="browser-who">
          {userHasIt ? 'You have control. Claude waits.' : state.busy ? 'Claude is using the browser' : 'Claude can use this browser'}
        </span>
        <button className="small" onClick={() => call('browser:control', { who: userHasIt ? 'claude' : 'user' })}>
          {userHasIt ? 'Give back' : 'Take over'}
        </button>
      </div>
      <div className="browser-view" ref={holder}>
        {!state.url && <p className="muted pad">Ask Claude to open a website, or type an address above.</p>}
      </div>
    </aside>
  );
}

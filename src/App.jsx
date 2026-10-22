import { useCallback, useEffect, useRef, useState } from 'react';
import { call, onEvent } from './api.js';
import { applyMessage, addUserPrompt, addNotice, emptyTranscript, fromHistory } from './transcript.js';
import { home, baseName, folderPath } from './format.js';
import TopBar from './components/TopBar.jsx';
import Sessions, { where } from './components/Sessions.jsx';
import Transcript from './components/Transcript.jsx';
import Composer from './components/Composer.jsx';
import Panel from './panel/Panel.jsx';
import BrowserPane from './components/BrowserPane.jsx';
import { isTurkish, speechChunks, speak, stopSpeaking, onSpeaking } from './speech.js';

// The final answer of the last turn: the text after the turn's last tool or thought.
function lastAnswer(items) {
  const turn = items.slice(items.map((i) => i.kind).lastIndexOf('user') + 1).filter((i) => i.kind !== 'result');
  let from = turn.length;
  while (from > 0 && turn[from - 1].kind === 'text') from--;
  return turn.slice(from).map((i) => i.text).join('\n\n');
}

// Plan limit events carry fractions; the usage API carries percents.
function limitsFromEvent(info) {
  const out = {};
  for (const [k, w] of Object.entries(info?.unifiedWindows || {})) out[k] = { utilization: w.utilization * 100, resets_at: w.resetsAt };
  return out;
}

// Remote control link states from Claude Code; a switched-off chat ignores late ones.
function bridgeState(c, m) {
  if (m.state === 'connected') return { remote: 'on' };
  if (c.remote === 'off') return {};
  if (m.state === 'failed' || m.state === 'policy_disabled') {
    return { remote: 'off', error: `Remote control stopped${m.detail ? `: ${m.detail}` : '.'}` };
  }
  return { remote: 'connecting' };
}

// Everything one chat needs on screen. Each open chat keeps its own copy.
const blankChat = () => ({ t: emptyTranscript(), init: null, cost: 0, turns: 0, cwd: '', error: '', suggestion: '', ended: false, remote: 'off', settings: null });
const NO_SETTINGS = { model: '', effort: '', mode: 'default' };

export default function App() {
  const [cwd, setCwd] = useState('');
  const [recent, setRecent] = useState([]);
  const [sessionId, setSessionId] = useState(null);
  const [chats, setChats] = useState({});
  const [sessions, setSessions] = useState(null);
  const [liveLimits, setLiveLimits] = useState(null);
  const [rev, setRev] = useState(0);
  const [draft, setDraft] = useState('');
  const [side, setSide] = useState('panel');
  const [browser, setBrowser] = useState({});
  const [maximized, setMaximized] = useState(false);
  const [error, setError] = useState('');
  const [webSearch, setWebSearchState] = useState(true);
  const [running, setRunning] = useState([]);
  const [railTab, setRailTab] = useState('folder');
  const railTabRef = useRef(railTab);
  railTabRef.current = railTab;
  const [readAloud, setReadAloudState] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [install, setInstall] = useState(null); // { what, line, done }
  const [viewing, setViewing] = useState(null); // a session that runs in another process, read only
  const [viewT, setViewT] = useState(null);
  const runningRef = useRef(running);
  runningRef.current = running;
  const chatsRef = useRef(chats);
  chatsRef.current = chats;
  const current = useRef(null);
  const cwdRef = useRef(cwd);
  cwdRef.current = cwd;
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const drafts = useRef({});
  const spoken = useRef({});
  const lastShown = useRef(null);
  home.cwd = cwd;

  const patch = useCallback((id, fn) => {
    setChats((all) => {
      const c = all[id] || blankChat();
      return { ...all, [id]: { ...c, ...fn(c) } };
    });
  }, []);

  const loadSessions = useCallback((dir) => {
    call('sessions:list', { cwd: dir }).then(setSessions).catch(() => setSessions([]));
  }, []);

  const loadInit = useCallback(async (id) => {
    try {
      const info = await call('session:init', { sessionId: id });
      patch(id, (c) => ({ init: info, ...(info.current_permission_mode && c.settings && { settings: { ...c.settings, mode: info.current_permission_mode } }) }));
    } catch (e) {
      patch(id, () => ({ error: `Claude Code did not start: ${e.message}` }));
    }
  }, [patch]);

  const start = useCallback(async (dir, resume) => {
    const known = resume && chatsRef.current[resume];
    // The open chat is already live: nothing to do.
    if (resume && resume === current.current && known && !known.ended) return;
    const prev = current.current;
    const pc = prev && chatsRef.current[prev];
    // A chat you leave with no message, no draft and no work holds nothing: close its process.
    const emptyPrev = pc && !pc.ended && !pc.t.running && !pc.t.permissions.length && !draftRef.current.trim()
      && !pc.t.items.some((i) => i.kind === 'user');
    drafts.current[prev] = draftRef.current;
    setError('');
    // The main process picks the chat's model, effort and mode: its own ones, or the saved defaults.
    const r = await call('session:start', { cwd: dir, resume });
    current.current = r.sessionId;
    setSessionId(r.sessionId);
    setDraft(drafts.current[r.sessionId] || '');
    if (emptyPrev && prev !== r.sessionId) {
      call('session:close', { sessionId: prev }).catch(() => {});
      patch(prev, () => ({ ended: true }));
    }
    setCwd(r.cwd);
    setRecent((rc) => [r.cwd, ...rc.filter((d) => d !== r.cwd)].slice(0, 8));
    loadSessions(r.cwd);
    // Still running in this window: show it as it is.
    if (r.live && known) {
      patch(r.sessionId, () => ({ settings: r.settings }));
      return;
    }
    patch(r.sessionId, () => ({ ...blankChat(), cwd: r.cwd, settings: r.settings, t: resume ? { ...emptyTranscript(), loading: true } : emptyTranscript() }));
    if (resume) {
      const msgs = await call('sessions:messages', { id: resume, cwd: r.cwd }).catch(() => []);
      patch(r.sessionId, () => ({ t: fromHistory(msgs) }));
    }
    loadInit(r.sessionId);
  }, [loadInit, loadSessions, patch]);

  useEffect(() => {
    (async () => {
      const st = await call('app:state');
      home.dir = st.home;
      setRecent(st.recent || []);
      setWebSearchState(st.webSearch !== false);
      setReadAloudState(Boolean(st.readAloud));
      if (st.readAloud) call('tts:setEnabled', { on: true }).catch(() => {});
      setCwd(st.cwd);
      start(st.cwd);
    })();
  }, []);

  // Every event belongs to one chat; chats in the background keep updating.
  useEffect(() => onEvent((e) => {
    if (e.type === 'window') { setMaximized(e.maximized); return; }
    if (e.type === 'browser-open') { setSide('browser'); return; }
    if (e.type === 'browser-state') { setBrowser(e.state); return; }
    if (e.type === 'install') { setInstall({ what: e.what, line: e.line }); return; }
    const id = e.sessionId;
    if (!id) return;
    switch (e.type) {
      case 'sdk': {
        const m = e.msg;
        if (m.type === 'rate_limit_event') setLiveLimits((l) => ({ ...(l || {}), ...limitsFromEvent(m.rate_limit_info) }));
        if (m.type === 'prompt_suggestion') { patch(id, () => ({ suggestion: m.suggestion })); break; }
        if (m.type === 'system' && m.subtype === 'bridge_state') { patch(id, (c) => bridgeState(c, m)); break; }
        patch(id, (c) => {
          const out = { t: applyMessage(c.t, m) };
          if (m.type === 'system' && m.subtype === 'init' && c.init) out.init = { ...c.init, sysinit: m };
          if (m.type === 'result') {
            out.turns = c.turns + 1;
            if (m.total_cost_usd) out.cost = m.total_cost_usd;
          }
          return out;
        });
        if (m.type === 'result') loadSessions(cwdRef.current);
        break;
      }
      case 'running': patch(id, (c) => ({ t: { ...c.t, running: e.running } })); break;
      case 'settings': patch(id, () => ({ settings: e.settings })); break;
      case 'permission': patch(id, (c) => ({ t: { ...c.t, permissions: [...c.t.permissions, e] } })); break;
      case 'permission-cancel': patch(id, (c) => ({ t: { ...c.t, permissions: c.t.permissions.filter((p) => p.id !== e.id) } })); break;
      case 'error': patch(id, () => ({ error: `${e.message}${e.detail ? `\n${e.detail}` : ''}` })); break;
      case 'session-ended':
        patch(id, (c) => ({ ended: true, error: 'Claude Code stopped in this chat. Click it in the list to open it again.', t: { ...c.t, running: false } }));
        break;
      // Closed to save memory while idle; clicking it opens it again from its history.
      case 'session-closed': patch(id, () => ({ ended: true })); break;
      default: break;
    }
  }), [loadSessions, patch]);

  useEffect(() => onSpeaking(setSpeaking), []);

  const cur = (sessionId && chats[sessionId]) || blankChat();
  const t = cur.t;
  const init = cur.init;
  const settings = cur.settings || NO_SETTINGS;

  // Read Turkish answers aloud when a turn of the open chat ends; switching chats reads nothing.
  useEffect(() => {
    if (!sessionId) return;
    const prev = spoken.current[sessionId];
    const switched = lastShown.current !== sessionId;
    lastShown.current = sessionId;
    spoken.current[sessionId] = cur.turns;
    if (!readAloud || switched || prev === undefined || cur.turns <= prev) return;
    const text = lastAnswer(t.items);
    if (text && isTurkish(text)) speak(speechChunks(text), setError);
  }, [cur.turns, sessionId]);

  // Every Claude Code process on this PC; cheap to read, so poll it.
  useEffect(() => {
    const load = () => call('running:list', { detail: railTabRef.current === 'running' }).then(setRunning).catch(() => {});
    load();
    const id = setInterval(load, 2000);
    return () => clearInterval(id);
  }, []);

  // While you read another session, follow it as it writes.
  useEffect(() => {
    if (!viewing) return;
    let stop = false;
    const load = async () => {
      const msgs = await call('sessions:messages', { id: viewing.sessionId, cwd: viewing.cwd }).catch(() => null);
      if (!stop && msgs) setViewT(fromHistory(msgs));
    };
    load();
    const id = setInterval(() => {
      const r = runningRef.current.find((x) => x.sessionId === viewing.sessionId);
      if (r && r.status !== 'idle') load();
    }, 3000);
    return () => { stop = true; clearInterval(id); };
  }, [viewing]);

  // A chat of this window opens as a live chat; one that runs elsewhere opens read only.
  const view = (r) => {
    setViewing(null);
    if (r.mine) { start(r.cwd, r.sessionId); return; }
    setViewT({ ...emptyTranscript(), loading: true });
    setViewing({ sessionId: r.sessionId, cwd: r.cwd, title: r.title || r.name, where: where(r) });
  };

  const closeChat = async (r) => {
    if (r.status !== 'idle' && !window.confirm(`This chat is still working. Stop it and close it?\n\n${r.title || r.name}`)) return;
    try {
      await call('session:close', { sessionId: r.sessionId });
    } catch (e) { setError(e.message); }
    setTimeout(() => call('running:list').then(setRunning).catch(() => {}), 600);
  };

  const stopShell = async (sh) => {
    if (!window.confirm(`Stop this shell and the programs it started?\n\n${sh.command.split('\n')[0]}`)) return;
    try {
      await call('running:stop', { pid: sh.pid, start: sh.start });
    } catch (e) { setError(e.message); }
    setTimeout(() => call('running:list').then(setRunning).catch(() => {}), 600);
  };

  const send = (text, images) => {
    const id = current.current;
    stopSpeaking();
    patch(id, (c) => ({ t: addUserPrompt(c.t, text, images), suggestion: '' }));
    call('session:send', { sessionId: id, text, images }).catch((e) => patch(id, () => ({ error: e.message })));
  };

  const answer = (pid, ans) => {
    const id = current.current;
    patch(id, (c) => ({ t: { ...c.t, permissions: c.t.permissions.filter((p) => p.id !== pid) } }));
    call('session:answer', { sessionId: id, id: pid, ...ans });
  };

  // Model, effort and mode belong to the open chat only.
  const change = (key, value, channel, arg) => {
    const id = current.current;
    patch(id, (c) => ({ settings: { ...(c.settings || NO_SETTINGS), [key]: value } }));
    call(channel, { sessionId: id, ...arg }).catch((e) => setError(e.message));
  };
  const setMode = (mode) => change('mode', mode, 'session:setMode', { mode });
  const setModel = (model) => change('model', model, 'session:setModel', { model: model === 'default' ? '' : model });
  const setEffort = (effort) => change('effort', effort, 'session:setEffort', { effort });

  // Voice input and read aloud download once, after the user says yes.
  const FEATURES = {
    voice: { name: 'Voice input', size: 'about 570 MB (Whisper speech to text)' },
    tts: { name: 'Read aloud', size: 'about 900 MB (Python, PyTorch and the Turkish voice)' },
  };
  const ensure = async (what) => {
    const st = await call(`${what}:status`).catch(() => ({ installed: false }));
    if (st.installed) return true;
    if (install && !install.done) { setError('An install is already running.'); return false; }
    const f = FEATURES[what];
    if (!window.confirm(`${f.name} needs a one-time download of ${f.size}. Install it now?`)) return false;
    setInstall({ what, line: 'Starting' });
    try {
      await call(`${what}:install`);
      setInstall({ what, line: `${f.name} is ready.`, done: true });
      setTimeout(() => setInstall((i) => (i?.done ? null : i)), 5000);
      return what === 'tts'; // the voice button needs a fresh press; read aloud turns on now
    } catch (e) {
      setInstall(null);
      setError(`${f.name} did not install. ${e.message}`);
      return false;
    }
  };

  const setReadAloud = async (on) => {
    if (on && !(await ensure('tts'))) return;
    setReadAloudState(on);
    if (!on) stopSpeaking();
    call('tts:setEnabled', { on }).catch((e) => setError(e.message));
  };

  const setRemote = async (on) => {
    const id = current.current;
    patch(id, () => ({ remote: on ? 'connecting' : 'off' }));
    try {
      const r = await call('session:setRemote', { sessionId: id, on });
      patch(id, (c) => {
        if (on && c.remote === 'off') return {}; // turned off while it connected
        return {
          remote: on ? 'on' : 'off',
          t: on ? addNotice(c.t, 'Remote control is on. Continue this chat in the Claude app or at', r.url) : addNotice(c.t, 'Remote control is off.'),
        };
      });
    } catch (e) {
      patch(id, () => ({ remote: 'off', error: `Remote control did not start. ${e.message}` }));
    }
  };

  const setWebSearch = (on) => {
    setWebSearchState(on);
    call('session:setWebSearch', { on }).catch((e) => setError(e.message));
  };

  // Going to a folder opens its live chat when there is one; only New session makes another process.
  const openFolder = (dir) => {
    setViewing(null);
    const live = Object.entries(chatsRef.current).find(([, c]) => c.cwd === dir && !c.ended);
    start(dir, live?.[0]);
  };

  const pickDir = async () => {
    const dir = await call('dir:pick');
    if (dir) openFolder(dir);
  };

  // reloadPlugins answers with the new skills, commands and agents.
  const onPluginsChanged = (fresh) => {
    if (fresh) patch(current.current, (c) => ({ init: c.init ? { ...c.init, commands: fresh.commands, agents: fresh.agents } : c.init }));
    setRev((r) => r + 1);
  };

  const active = sessions?.find((s) => s.sessionId === sessionId);
  const title = viewing ? viewing.title
    : active ? (active.customTitle || active.summary) : t.items.find((i) => i.kind === 'user')?.text || 'New session';
  const shown = viewing ? viewT : t;
  const shownError = viewing ? error : cur.error || error;

  const empty = (
    <div className="empty">
      <h1>{baseName(cwd)}</h1>
      <p className="muted">{folderPath(cwd)}</p>
      <p>{init ? 'Claude Code is ready in this folder, with your login, settings, plugins and MCP servers.' : 'Starting Claude Code in this folder.'}</p>
    </div>
  );

  return (
    <div className={`app side-${side}`}>
      <TopBar title={title} side={side} setSide={(v) => setSide(side === v ? 'none' : v)} maximized={maximized} browserBusy={browser.busy} />
      <Sessions
        cwd={cwd} recent={recent} sessions={sessions} activeId={viewing ? viewing.sessionId : sessionId} running={running}
        onNew={() => { setViewing(null); start(cwd); }} onOpen={(id) => { setViewing(null); start(cwd, id); }}
        onView={view} onStopShell={stopShell} onCloseChat={closeChat} onPickDir={pickDir} onDir={openFolder}
        tab={railTab} setTab={setRailTab}
      />
      <main className="chat">
        {viewing && (
          <div className="viewing-bar">
            <span>You are reading a session that runs in {viewing.where === 'terminal' ? 'a terminal tab' : 'another app'} in {baseName(viewing.cwd)}. Reply to it there.</span>
            <button className="small" onClick={() => setViewing(null)}>Back to my session</button>
          </div>
        )}
        {shown?.loading
          ? <div className="transcript"><p className="muted pad">Loading session</p></div>
          : <Transcript t={shown} answer={answer} empty={empty} />}
        {install && (
          <div className="install-bar" role="status">
            <span className={`led ${install.done ? '' : 'busy'}`} />
            <span>{install.done ? install.line : `Installing ${FEATURES[install.what].name.toLowerCase()}: ${install.line}`}</span>
          </div>
        )}
        {shownError && (
          <div className="error-bar" role="alert">
            <pre>{shownError}</pre>
            <button className="ghost" onClick={() => { setError(''); patch(current.current, () => ({ error: '' })); }}>Dismiss</button>
          </div>
        )}
        <Composer
          running={t.running} disabled={!sessionId || Boolean(viewing)} commands={init?.commands || []}
          mode={settings.mode} setMode={setMode} draft={draft} setDraft={setDraft}
          webSearch={webSearch} setWebSearch={setWebSearch} onError={setError}
          readAloud={readAloud} setReadAloud={setReadAloud} speaking={speaking} ensureVoice={() => ensure('voice')}
          remote={cur.remote} setRemote={setRemote}
          suggestion={viewing || t.running ? '' : cur.suggestion}
          lockedText={viewing ? 'Go back to your session to write a message' : ''}
          onSend={send} onStop={() => call('session:interrupt', { sessionId: current.current })}
        />
      </main>
      {side === 'browser' && <BrowserPane state={browser} />}
      {side === 'panel' && (
        <Panel
          init={init} cwd={cwd} rev={rev} turns={cur.turns} liveLimits={liveLimits} sessionCost={cur.cost}
          settings={settings} setModel={setModel} setEffort={setEffort} setMode={setMode}
          onInsert={(text) => setDraft(text)} onPluginsChanged={onPluginsChanged}
        />
      )}
    </div>
  );
}

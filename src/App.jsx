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
import LoginBar from './components/LoginBar.jsx';
import Resizer from './components/Resizer.jsx';

// Claude Code answers this way when it has no login on this computer.
const loggedOut = (m) => (m.type === 'assistant' && m.error === 'authentication_failed')
  || (m.type === 'result' && m.is_error && /not logged in/i.test(String(m.result || '')));

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
const NO_SETTINGS = { model: '', effort: '', ultracode: false, mode: 'default' };

export default function App() {
  const [cwd, setCwd] = useState('');
  const [recent, setRecent] = useState([]);
  const [sessionId, setSessionId] = useState(null);
  const [chats, setChats] = useState({});
  const [sessions, setSessions] = useState(null);
  const [accounts, setAccounts] = useState(null);
  const [rev, setRev] = useState(0);
  const [draft, setDraft] = useState('');
  const [side, setSide] = useState('panel');
  const [layout, setLayout] = useState({}); // pane widths in px; styles.css has the defaults
  const [browser, setBrowser] = useState({});
  const [maximized, setMaximized] = useState(false);
  const [error, setError] = useState('');
  const [webSearch, setWebSearchState] = useState(true);
  const [running, setRunning] = useState([]);
  const [update, setUpdate] = useState(null);
  const [version, setVersion] = useState('');
  const [railTab, setRailTab] = useState('folder');
  const railTabRef = useRef(railTab);
  railTabRef.current = railTab;
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
    let r;
    try {
      r = await call('session:start', { cwd: dir, resume });
    } catch (e) {
      setError(e.message);
      return;
    }
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
      patch(r.sessionId, () => ({ settings: r.settings, account: r.account }));
      return;
    }
    patch(r.sessionId, () => ({ ...blankChat(), cwd: r.cwd, settings: r.settings, account: r.account, t: resume ? { ...emptyTranscript(), loading: true } : emptyTranscript() }));
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
      setLayout(st.layout || {});
      setVersion(st.version || '');
      call('accounts:list').then(setAccounts).catch(() => {});
      call('app:updateState').then(setUpdate).catch(() => {});
      setCwd(st.cwd);
      start(st.cwd);
    })();
  }, []);

  // Every event belongs to one chat; chats in the background keep updating.
  useEffect(() => onEvent((e) => {
    if (e.type === 'window') { setMaximized(e.maximized); return; }
    if (e.type === 'browser-open') { setSide('browser'); return; }
    if (e.type === 'browser-state') { setBrowser(e.state); return; }
    if (e.type === 'accounts') { setAccounts(e.view); return; }
    if (e.type === 'update') { setUpdate(e.update); return; }
    if (e.type === 'open-folder') { openFolderRef.current(e.cwd); return; }
    const id = e.sessionId;
    if (!id) return;
    switch (e.type) {
      case 'sdk': {
        const m = e.msg;
        if (m.type === 'prompt_suggestion') { patch(id, () => ({ suggestion: m.suggestion })); break; }
        if (m.type === 'system' && m.subtype === 'bridge_state') { patch(id, (c) => bridgeState(c, m)); break; }
        patch(id, (c) => {
          const out = { t: applyMessage(c.t, m) };
          if (loggedOut(m) && (c.account || 'login') === 'login') out.loginNeeded = true;
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
      // The chat's process moved to another account; the chat and its history stay.
      case 'session-restarted':
        patch(id, (c) => ({
          account: e.account,
          remote: 'off',
          // An empty chat needs no note: the top bar and the Account menu show the change.
          t: e.fresh || e.quiet ? c.t : addNotice(c.t, `${e.continued ? 'The account reached its usage limit. ' : ''}This chat now uses ${e.name}.${e.continued ? ' Clawdeck asked Claude to continue.' : ''}${c.remote !== 'off' ? ' Remote control is off.' : ''}`),
        }));
        break;
      default: break;
    }
  }), [loadSessions, patch]);

  const cur = (sessionId && chats[sessionId]) || blankChat();
  const t = cur.t;
  const init = cur.init;
  const settings = cur.settings || NO_SETTINGS;

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

  const rename = async (id, dir, title) => {
    try {
      await call('sessions:rename', { id, cwd: dir, title });
    } catch (e) { setError(e.message); }
    loadSessions(cwdRef.current);
    call('running:list', { detail: railTabRef.current === 'running' }).then(setRunning).catch(() => {});
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
  const setUltracode = (on) => change('ultracode', on, 'session:setUltracode', { on });
  const setAccount = (account) => change('account', account, 'session:setAccount', { account });
  const chatAccount = accounts?.list.find((a) => a.id === cur.account);

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

  // Clawdeck closes and opens again on the new version, so working chats stop.
  const runUpdate = () => {
    if (update.how !== 'page') {
      const working = runningRef.current.filter((r) => r.mine && r.status !== 'idle').length;
      const note = !working ? '' : working === 1 ? '\n\nA chat is working. It will stop.' : `\n\n${working} chats are working. They will stop.`;
      if (!window.confirm(`Update Clawdeck to ${update.version}? Clawdeck closes and opens again.${note}`)) return;
    }
    call('app:update').catch((e) => setError(e.message));
  };

  const savePane = (key, w) => {
    setLayout((l) => ({ ...l, [key]: w }));
    call('app:setLayout', { [key]: w }).catch(() => {});
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

  const openFolderRef = useRef(openFolder);
  openFolderRef.current = openFolder;

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
    <div className={`app side-${side}`} style={{ '--rail-w': layout.rail && `${layout.rail}px`, '--side-w': layout.side && `${layout.side}px`, '--browser-w': layout.browser && `${layout.browser}px` }}>
      <TopBar
        title={title} side={side} setSide={(v) => setSide(side === v ? 'none' : v)} maximized={maximized} browserBusy={browser.busy}
        account={chatAccount} onAccount={() => setSide('panel')} update={update} onUpdate={runUpdate}
      />
      <Sessions
        cwd={cwd} recent={recent} sessions={sessions} activeId={viewing ? viewing.sessionId : sessionId} running={running}
        onNew={() => { setViewing(null); start(cwd); }} onOpen={(id) => { setViewing(null); start(cwd, id); }}
        onView={view} onStopShell={stopShell} onCloseChat={closeChat} onRename={rename} onPickDir={pickDir} onDir={openFolder}
        tab={railTab} setTab={setRailTab} version={version}
      />
      <main className="chat">
        <Resizer edge="left" prop="--rail-w" min={180} onDone={(w) => savePane('rail', w)} />
        {side === 'panel' && <Resizer edge="right" prop="--side-w" min={300} onDone={(w) => savePane('side', w)} />}
        {side === 'browser' && <Resizer edge="right" prop="--browser-w" min={480} onDone={(w) => savePane('browser', w)} />}
        {viewing && (
          <div className="viewing-bar">
            <span>You are reading a session that runs in {viewing.where === 'terminal' ? 'a terminal tab' : 'another app'} in {baseName(viewing.cwd)}. Reply to it there.</span>
            <button className="small" onClick={() => setViewing(null)}>Back to my session</button>
          </div>
        )}
        {shown?.loading
          ? <div className="transcript"><p className="muted pad">Loading session</p></div>
          : <Transcript t={shown} answer={answer} empty={empty} />}
        {!viewing && cur.loginNeeded && (
          <LoginBar
            onDismiss={() => patch(current.current, () => ({ loginNeeded: false }))}
            onDone={() => patch(current.current, (c) => ({ loginNeeded: false, t: addNotice(c.t, 'Claude Code is logged in. Send your message again.') }))}
          />
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
          webSearch={webSearch} setWebSearch={setWebSearch}
          remote={cur.remote} setRemote={setRemote}
          suggestion={viewing || t.running ? '' : cur.suggestion}
          lockedText={viewing ? 'Go back to your session to write a message' : ''}
          onSend={send} onStop={() => call('session:interrupt', { sessionId: current.current })}
        />
      </main>
      {side === 'browser' && <BrowserPane state={browser} />}
      {side === 'panel' && (
        <Panel
          init={init} cwd={cwd} rev={rev} turns={cur.turns} sessionCost={cur.cost} accounts={accounts}
          liveLimits={chatAccount?.usage} chatAccount={chatAccount}
          settings={settings} setModel={setModel} setEffort={setEffort} setUltracode={setUltracode} setMode={setMode} setAccount={setAccount}
          onInsert={(text) => setDraft(text)} onPluginsChanged={onPluginsChanged}
        />
      )}
    </div>
  );
}

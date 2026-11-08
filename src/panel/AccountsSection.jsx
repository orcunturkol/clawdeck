import { useState } from 'react';
import { call } from '../api.js';
import Section from './Section.jsx';
import Switch from './Switch.jsx';
import Meter from './Meter.jsx';
import { ago, resetTime } from '../format.js';
import { fiveHour } from './UsageSection.jsx';

const TERMS = 'Automatic switching moves a chat to the next free Claude account when its account reaches its usage limit.\n\n'
  + 'Anthropic\'s Consumer Terms (section 3, effective 8 October 2025) say that you must not bypass "any of our systems or protective measures". '
  + 'Anthropic can treat account rotation as a way around its usage limits and can suspend the accounts.\n\nTurn on automatic switching?';

const WINDOWS = [['five_hour', '5-hour window'], ['seven_day', 'Weekly, all models']];

function status(a) {
  if (a.kind === 'local') return 'Local, no limits';
  if (a.blocked) return `Limit reached, free at ${resetTime(a.blockedUntil / 1000)}`;
  const five = fiveHour(a).value;
  return five != null ? `${Math.round(five)}% of 5-hour window` : 'No usage seen yet';
}

function Account({ a, i, count, act, here }) {
  const [open, setOpen] = useState(false);
  const five = fiveHour(a).value;
  const marks = [a.main && 'Main', here && 'This chat', a.blocked ? 'at its limit' : five != null && `${Math.round(five)}%`].filter(Boolean).join(', ');
  const local = a.kind === 'local';
  const remove = () => window.confirm(local ? `Remove ${a.name} from Clawdeck? The model stays in Ollama.` : `Remove ${a.name} from Clawdeck? Its token is deleted here.`) && act('remove', { id: a.id });
  return (
    <li className={`item account ${here ? 'active' : ''} ${a.blocked ? 'blocked' : ''}`}>
      <div className="item-row">
        <button className="item-main" onClick={() => setOpen(!open)} aria-expanded={open}>
          <span className="led" />
          <span className="item-name">{a.email || a.name}</span>
          <span className="item-meta">{marks || status(a)}</span>
        </button>
      </div>
      {open && (
        <div className="item-detail">
          <dl className="facts">
            {local ? <>
              <dt>Server</dt><dd>{a.url}</dd>
              <dt>Model</dt><dd>{a.model}</dd>
              <dt>Context</dt><dd>{a.context} tokens</dd>
            </> : <>
              <dt>Login</dt><dd>{a.id === 'login' ? 'Claude Code login' : 'Token from claude setup-token'}</dd>
            </>}
            <dt>Status</dt><dd>{status(a)}</dd>
            {a.usageAt && <><dt>Usage</dt><dd>Last seen {ago(a.usageAt)}</dd></>}
          </dl>
          {WINDOWS.filter(([k]) => a.usage?.[k]).map(([k, label]) => (
            <Meter key={k} label={label} value={a.usage[k].utilization} sub={a.usage[k].resets_at ? `Resets ${resetTime(a.usage[k].resets_at)}` : ''} />
          ))}
          <div className="row-actions">
            {i > (local ? 1 : 0) && <button className="small" onClick={() => act('move', { id: a.id, delta: -1 })}>{i === 1 ? 'Make main' : 'Move up'}</button>}
            {i < count - 1 && <button className="small" onClick={() => act('move', { id: a.id, delta: 1 })}>Move down</button>}
            {a.id !== 'login' && <button className="small" onClick={remove}>Remove</button>}
          </div>
        </div>
      )}
    </li>
  );
}

function AddAccount({ onDone }) {
  const [name, setName] = useState('');
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await call('accounts:add', { name, token });
      onDone();
    } catch (err) {
      setError(err.message);
    }
    setBusy(false);
  };
  return (
    <form className="add-account" onSubmit={submit}>
      <ol className="steps">
        <li>In a terminal, run <code>claude setup-token</code>.</li>
        <li>Sign in with the other account. If the browser opens your main account, copy the sign-in link into a private window.</li>
        <li>Copy the token that starts with <code>sk-ant-oat</code> and paste it below.</li>
      </ol>
      <label className="field"><span>Name</span><input value={name} onChange={(e) => setName(e.target.value)} placeholder="For example: Work" /></label>
      <label className="field"><span>Token</span><input type="password" value={token} onChange={(e) => setToken(e.target.value)} autoComplete="off" /></label>
      <p className="muted">
        You add each account one time. The token is valid for one year, and Clawdeck keeps it encrypted in your system keyring.
        Clawdeck checks the token with one short message, which uses a little of that account's usage.
        Clawdeck cannot read the account's email, so give it a name.
      </p>
      {error && <p className="err">{error}</p>}
      <div className="row-actions">
        <button className="small" type="submit" disabled={busy || !name.trim() || !token.trim()}>{busy ? 'Checking the token' : 'Check and add'}</button>
        <button className="small" type="button" onClick={onDone} disabled={busy}>Cancel</button>
      </div>
    </form>
  );
}

function AddLocal({ onDone }) {
  const [url, setUrl] = useState('http://localhost:11434');
  const [models, setModels] = useState(null);
  const [model, setModel] = useState('');
  const [context, setContext] = useState('32768');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const run = async (fn) => {
    setBusy(true);
    setError('');
    try { await fn(); } catch (err) { setError(err.message); }
    setBusy(false);
  };
  const load = () => run(async () => {
    const list = await call('accounts:localModels', { url });
    setModels(list);
    setModel(list[0]?.name || '');
    if (!list.length) throw new Error('The server has no models. Pull one first, for example `ollama pull qwen3.5`.');
  });
  const submit = (e) => {
    e.preventDefault();
    run(async () => { await call('accounts:addLocal', { url, model, context }); onDone(); });
  };
  return (
    <form className="add-account" onSubmit={submit}>
      <label className="field"><span>Server</span><input value={url} onChange={(e) => { setUrl(e.target.value); setModels(null); }} placeholder="http://localhost:11434" /></label>
      {models?.length > 0 && <>
        <label className="field"><span>Model</span>
          <select value={model} onChange={(e) => setModel(e.target.value)}>
            {models.map((m) => <option key={m.name} value={m.name}>{m.name}{m.params ? `, ${m.params}` : ''}{m.quant ? ` ${m.quant}` : ''}</option>)}
          </select>
        </label>
        <label className="field"><span>Context</span><input type="number" min="4096" step="1024" value={context} onChange={(e) => setContext(e.target.value)} /></label>
      </>}
      <p className="muted">
        Chats on a local model send nothing to Anthropic. Set Context to the same value as OLLAMA_CONTEXT_LENGTH on the server.
        Claude Code needs at least 32768. Local models make more mistakes with tools than Claude.
      </p>
      {error && <p className="err">{error}</p>}
      <div className="row-actions">
        {models?.length > 0
          ? <button className="small" type="submit" disabled={busy || !model}>{busy ? 'Checking' : 'Add'}</button>
          : <button className="small" type="button" onClick={load} disabled={busy || !url.trim()}>{busy ? 'Connecting' : 'Load models'}</button>}
        <button className="small" type="button" onClick={onDone} disabled={busy}>Cancel</button>
      </div>
    </form>
  );
}

// Linux and Windows sign in inside Clawdeck; elsewhere the user pastes a token.
const SIGN_IN = ['linux', 'win32'].includes(window.deck.platform);

export default function AccountsSection({ accounts, chatAccount }) {
  const [adding, setAdding] = useState(false);
  const [addingLocal, setAddingLocal] = useState(false);
  const [signing, setSigning] = useState(false);
  const [error, setError] = useState('');
  if (!accounts) return null;
  const act = (what, arg) => call(`accounts:${what}`, arg).then(() => setError('')).catch((e) => setError(e.message));
  const setAuto = (on) => {
    if (on && !window.confirm(TERMS)) return;
    act('setAuto', { on });
  };
  const signIn = async () => {
    setSigning(true);
    setError('');
    try {
      await call('accounts:signIn');
    } catch (e) {
      setError(e.message);
    }
    setSigning(false);
  };
  return (
    <Section title="Accounts" icon="person" summary={`${accounts.list.length} account${accounts.list.length === 1 ? '' : 's'}`} defaultOpen>
      <ul className="items">
        {accounts.list.map((a, i) => <Account key={a.id} a={a} i={i} count={accounts.list.length} act={act} here={a.id === chatAccount?.id} />)}
      </ul>
      {accounts.list.length > 1 && <p className="muted">Pick a chat's account in the Session section. New chats in that folder start on it too.</p>}
      {error && <p className="err">{error}</p>}
      {signing && <p className="muted">Sign in to the other account in the new window. Use "Continue with email" if Google does not let you in.</p>}
      {adding && <AddAccount onDone={() => setAdding(false)} />}
      {addingLocal && <AddLocal onDone={() => setAddingLocal(false)} />}
      {!adding && !addingLocal && !signing && (
        <div className="row-actions">
          <button className="small" onClick={SIGN_IN ? signIn : () => setAdding(true)}>Add account</button>
          <button className="small" onClick={() => setAddingLocal(true)}>Add local model</button>
          {SIGN_IN && <button className="link" onClick={() => setAdding(true)}>Paste a token instead</button>}
        </div>
      )}
      <div className="switch-line">
        <span>Move a chat to a free account when its account reaches its limit</span>
        <Switch on={accounts.auto} onChange={setAuto} label="Switch accounts automatically" />
      </div>
      <p className="muted">Local models are never picked automatically. Anthropic can treat this as a way around its usage limits. Read the warning before you turn it on.</p>
      <div className={`switch-line ${accounts.auto ? '' : 'off'}`}>
        <span>Move the chat back to its own account when the limit resets</span>
        <Switch on={accounts.goBack} onChange={(on) => act('setGoBack', { on })} label="Go back to the chat's own account" busy={!accounts.auto} />
      </div>
    </Section>
  );
}

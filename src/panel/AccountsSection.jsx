import { useState } from 'react';
import { call } from '../api.js';
import Section from './Section.jsx';
import Switch from './Switch.jsx';
import Meter from './Meter.jsx';
import { ago, resetTime } from '../format.js';

const TERMS = 'Automatic switching moves a chat to the next free Claude account when its account reaches its usage limit.\n\n'
  + 'Anthropic\'s Consumer Terms (section 3, effective 8 October 2025) say that you must not bypass "any of our systems or protective measures". '
  + 'Anthropic can treat account rotation as a way around its usage limits and can suspend the accounts.\n\nTurn on automatic switching?';

const WINDOWS = [['five_hour', '5-hour window'], ['seven_day', 'Weekly, all models']];

function status(a) {
  if (a.blocked) return `Limit reached, free at ${resetTime(a.blockedUntil / 1000)}`;
  const five = a.usage?.five_hour?.utilization;
  return five != null ? `${Math.round(five)}% of 5-hour window` : 'No usage seen yet';
}

function Account({ a, i, count, act, here }) {
  const [open, setOpen] = useState(false);
  const marks = [a.main && 'Main', here && 'This chat'].filter(Boolean).join(', ');
  const remove = () => window.confirm(`Remove ${a.name} from Clawdeck? Its token is deleted here.`) && act('remove', { id: a.id });
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
            <dt>Login</dt><dd>{a.id === 'login' ? 'Claude Code login' : 'Token from claude setup-token'}</dd>
            <dt>Status</dt><dd>{status(a)}</dd>
            {a.usageAt && <><dt>Usage</dt><dd>Last seen {ago(a.usageAt)}</dd></>}
          </dl>
          {WINDOWS.filter(([k]) => a.usage?.[k]).map(([k, label]) => (
            <Meter key={k} label={label} value={a.usage[k].utilization} sub={a.usage[k].resets_at ? `Resets ${resetTime(a.usage[k].resets_at)}` : ''} />
          ))}
          <div className="row-actions">
            {i > 0 && <button className="small" onClick={() => act('move', { id: a.id, delta: -1 })}>{i === 1 ? 'Make main' : 'Move up'}</button>}
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

// Linux signs in inside Clawdeck; elsewhere the user pastes a token.
const SIGN_IN = window.deck.platform === 'linux';

export default function AccountsSection({ accounts, chatAccount }) {
  const [adding, setAdding] = useState(false);
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
      {!adding && !signing && (
        <div className="row-actions">
          <button className="small" onClick={SIGN_IN ? signIn : () => setAdding(true)}>Add account</button>
          {SIGN_IN && <button className="link" onClick={() => setAdding(true)}>Paste a token instead</button>}
        </div>
      )}
      <div className="switch-line">
        <span>Move a chat to a free account when its account reaches its limit</span>
        <Switch on={accounts.auto} onChange={setAuto} label="Switch accounts automatically" />
      </div>
      <p className="muted">Anthropic can treat this as a way around its usage limits. Read the warning before you turn it on.</p>
      <div className={`switch-line ${accounts.auto ? '' : 'off'}`}>
        <span>Move the chat back to its own account when the limit resets</span>
        <Switch on={accounts.goBack} onChange={(on) => act('setGoBack', { on })} label="Go back to the chat's own account" busy={!accounts.auto} />
      </div>
    </Section>
  );
}

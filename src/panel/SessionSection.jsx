import { useEffect, useState } from 'react';
import { call } from '../api.js';
import Section from './Section.jsx';
import Meter from './Meter.jsx';
import { MODES } from '../components/Composer.jsx';
import { tokens, folderPath } from '../format.js';

export default function SessionSection({ init, settings, setModel, setEffort, setMode, setAccount, cwd, turns, sessionCost, chatAccount, accounts }) {
  const [context, setContext] = useState(null);
  const [saved, setSaved] = useState('');
  const models = init?.models || [];
  const current = models.find((m) => m.value === (settings.model || 'default')) || models[0];
  const efforts = current?.supportedEffortLevels || [];

  useEffect(() => {
    if (!init) return;
    call('session:context').then(setContext).catch(() => setContext(null));
  }, [init, turns]);

  const saveDefaults = async () => {
    await call('settings:saveDefaults', { model: settings.model === 'default' ? '' : settings.model, effortLevel: settings.effort, defaultMode: settings.mode });
    setSaved('Saved to ~/.claude/settings.json');
    setTimeout(() => setSaved(''), 3000);
  };

  // Claude Code reports the login's account even when a token runs the chat.
  const account = chatAccount && chatAccount.id !== 'login' ? { email: chatAccount.name } : init?.account;
  const choices = accounts?.list || [];
  const own = choices.find((a) => a.id === settings.account);
  return (
    <Section title="Session" icon="sliders" summary={current?.displayName || ''} defaultOpen>
      <dl className="facts">
        <dt>Folder</dt><dd title={cwd}>{folderPath(cwd)}</dd>
        {choices.length < 2 && account?.email && <><dt>Account</dt><dd>{account.email}{account.subscriptionType ? `, ${account.subscriptionType}` : ''}</dd></>}
        {init?.claude_code_version && <><dt>Claude Code</dt><dd>{init.claude_code_version}</dd></>}
        {sessionCost > 0 && <><dt>Cost</dt><dd>${sessionCost.toFixed(2)} at API prices</dd></>}
      </dl>
      {choices.length > 1 && (
        <label className="field" title="This chat uses the account. New chats in this folder start on it too.">
          <span>Account</span>
          <select value={settings.account || ''} disabled={!settings.account} onChange={(e) => setAccount(e.target.value)}>
            {choices.map((a) => <option key={a.id} value={a.id}>{a.email || a.name}{a.blocked ? ' (at its limit)' : ''}</option>)}
          </select>
        </label>
      )}
      {own && chatAccount && chatAccount.id !== own.id && (
        <p className="muted">{own.blocked
          ? `Runs on ${chatAccount.email || chatAccount.name} while ${own.email || own.name} is at its limit.`
          : `Moves to ${own.email || own.name} with your next message.`}</p>
      )}
      <label className="field">
        <span>Model</span>
        <select value={settings.model || 'default'} disabled={!init} onChange={(e) => setModel(e.target.value)}>
          {models.map((m) => <option key={m.value} value={m.value}>{m.displayName}</option>)}
        </select>
      </label>
      <label className="field">
        <span>Effort</span>
        <select value={settings.effort} disabled={!init || !efforts.length} onChange={(e) => setEffort(e.target.value)}>
          <option value="">Model default</option>
          {efforts.map((l) => <option key={l} value={l}>{l}</option>)}
        </select>
      </label>
      <label className="field">
        <span>Permissions</span>
        <select value={settings.mode} disabled={!init} onChange={(e) => setMode(e.target.value)}>
          {MODES.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
        </select>
      </label>
      <div className="row-actions">
        <button className="small" onClick={saveDefaults} disabled={!init}>Save as defaults</button>
        {saved && <span className="muted">{saved}</span>}
      </div>
      {context && (
        <Meter label="Context" value={context.percentage} sub={`${tokens(context.totalTokens)} of ${tokens(context.maxTokens)} tokens`} />
      )}
    </Section>
  );
}

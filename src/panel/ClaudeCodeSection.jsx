import { useEffect, useState } from 'react';
import { call } from '../api.js';
import Section from './Section.jsx';

const TYPES = { npm: 'npm', native: 'native installer', unknown: 'unknown install' };

export default function ClaudeCodeSection() {
  const [info, setInfo] = useState(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [checking, setChecking] = useState(false);
  const [checked, setChecked] = useState('');

  const load = () => call('claudecode:info').then(setInfo).catch((e) => setError(e.message));
  useEffect(() => { load(); }, []);

  // Asks the npm registry for the newest version again and says what it found.
  const check = async () => {
    setChecking(true); setChecked(''); setError('');
    try {
      const i = await call('claudecode:info');
      setInfo(i);
      setChecked(!i.latest ? 'Could not reach the update server. Check your connection.'
        : i.upToDate === false ? `Version ${i.latest} is available.`
        : i.upToDate ? `You have the newest version (${i.version}).` : 'Could not compare the versions.');
    } catch (e) { setError(e.message); }
    setChecking(false);
  };

  const update = async () => {
    setBusy(true); setResult(null); setError('');
    try { setResult(await call('claudecode:update')); } catch (e) { setError(e.message); }
    await load();
    setBusy(false);
  };

  return (
    <Section id="claudecode" title="Claude Code" icon="cartridge" summary={info?.version || ''}>
      {!info && !error && <p className="muted">Reading the installed version</p>}
      {error && <p className="err">{error}</p>}
      {info && !info.found && <p className="muted" data-testid="claudecode-missing">Claude Code is not installed.</p>}
      {info?.found && (
        <div className="cc">
          <div className="cc-row"><span className="muted">Installed</span><span className="mono" data-testid="claudecode-version">{info.version || 'unknown'}</span></div>
          <div className="cc-row"><span className="muted">Latest</span><span className="mono" data-testid="claudecode-latest">{info.latest || 'unknown'}</span></div>
          <div className="cc-row"><span className="muted">Install</span><span className="mono" title={info.path}>{TYPES[info.type]}</span></div>
          {info.error && <p className="err">{info.error}</p>}
          {info.upToDate === true && !busy && <p className="muted">Claude Code is up to date. No update is needed.</p>}
          {info.upToDate === false && !busy && <p className="muted">A new version is available.</p>}
          <button className="ghost" onClick={check} disabled={busy || checking} data-testid="claudecode-check">{checking ? 'Checking' : 'Check for updates'}</button>
          {checked && <p className="muted" data-testid="claudecode-checked">{checked}</p>}
          <button onClick={update} disabled={busy || info.upToDate === true} data-testid="claudecode-update">{busy ? 'Updating, please wait' : 'Update'}</button>
          {busy && <div className="cc-progress" role="progressbar" aria-label="Updating Claude Code"><span /></div>}
          {result && (
            <>
              <p className={result.ok ? 'muted' : 'err'}>{result.ok ? 'Update finished.' : `Update failed. ${result.error}`}</p>
              {result.output && <pre className="cc-out mono">{result.output}</pre>}
            </>
          )}
          <p className="muted">A running chat keeps the old version until you start a new chat.</p>
        </div>
      )}
    </Section>
  );
}

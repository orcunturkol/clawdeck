import { useState } from 'react';
import { call } from '../api.js';

// Claude Code is not logged in on this computer: log it in from here, no terminal needed.
export default function LoginBar({ onDone, onDismiss }) {
  const [step, setStep] = useState('start'); // start, code, busy
  const [url, setUrl] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState('');

  const begin = async () => {
    setError('');
    setStep('busy');
    try {
      const r = await call('accounts:login');
      if (r.done) { onDone(); return; }
      setUrl(r.url);
      setStep('code');
    } catch (e) {
      setError(e.message);
      setStep('start');
    }
  };

  const send = async () => {
    setError('');
    setStep('busy');
    try {
      await call('accounts:loginCode', { code });
      onDone();
    } catch (e) {
      // A wrong code ends Claude Code's login; it has to start again.
      setError(e.message);
      setCode('');
      setStep('start');
    }
  };

  const cancel = () => {
    call('accounts:loginCancel').catch(() => {});
    onDismiss();
  };

  return (
    <div className="login-bar" role="alert">
      {step === 'code' ? (
        <>
          <p>
            Sign in to Claude in the browser window that opened. When the page shows a code, paste it here.
            {url && <> The browser did not open? <a href={url} target="_blank" rel="noreferrer">Open the sign-in page</a>.</>}
          </p>
          <div className="login-row">
            <input
              autoFocus value={code} onChange={(e) => setCode(e.target.value)} placeholder="Code from the sign-in page"
              onKeyDown={(e) => { if (e.key === 'Enter' && code.trim()) send(); }} spellCheck={false}
            />
            <button className="primary" disabled={!code.trim()} onClick={send}>Log in</button>
            <button className="ghost" onClick={cancel}>Cancel</button>
          </div>
        </>
      ) : (
        <div className="login-row">
          <p>Claude Code is not logged in on this computer.</p>
          <button className="primary" disabled={step === 'busy'} onClick={begin}>{step === 'busy' ? 'Logging in' : 'Log in'}</button>
          <button className="ghost" onClick={cancel}>Dismiss</button>
        </div>
      )}
      {error && <pre>{error}</pre>}
    </div>
  );
}

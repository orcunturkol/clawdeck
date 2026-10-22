import { call } from '../api.js';
import Icon from './Icon.jsx';

export default function TopBar({ title, side, setSide, maximized, browserBusy, account, onAccount }) {
  return (
    <header className="topbar">
      <div className="brand"><img src="./icon-16.png" srcSet="./icon-16.png 1x, ./icon-32.png 2x" alt="" className="brand-icon" />Clawdeck</div>
      <div className="topbar-title">{title}</div>
      <div className="topbar-actions">
        {account && (
          <button className={`account-chip ${account.blocked ? 'blocked' : ''}`} onClick={onAccount} title="The active Claude account. New prompts use it. Click to see all accounts.">
            <Icon name="person" /><span>{account.email || account.name}</span>
          </button>
        )}
        <div className="side-switch" role="group" aria-label="Right side">
          <button aria-pressed={side === 'panel'} onClick={() => setSide('panel')}><Icon name="panel" />Panel</button>
          <button aria-pressed={side === 'browser'} onClick={() => setSide('browser')}>
            {browserBusy ? <span className="led busy" /> : <Icon name="browser" />}Browser
          </button>
        </div>
        <div className="win-buttons">
          <button aria-label="Minimize" onClick={() => call('win:minimize')}><svg viewBox="0 0 12 12"><path d="M2 6.5h8" /></svg></button>
          <button aria-label={maximized ? 'Restore' : 'Maximize'} onClick={() => call('win:maximize')}>
            <svg viewBox="0 0 12 12">{maximized ? <path d="M3.5 4.5h4v4h-4zM4.5 3.5h4v4" /> : <path d="M2.5 2.5h7v7h-7z" />}</svg>
          </button>
          <button aria-label="Close" className="close" onClick={() => call('win:close')}><svg viewBox="0 0 12 12"><path d="M3 3l6 6M9 3l-6 6" /></svg></button>
        </div>
      </div>
    </header>
  );
}

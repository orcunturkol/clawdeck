import { useEffect, useState } from 'react';
import { call } from '../api.js';
import Section from './Section.jsx';
import Meter from './Meter.jsx';
import { ago, resetTime, tokens } from '../format.js';

const WINDOWS = [
  ['five_hour', '5-hour window'],
  ['seven_day', 'Weekly, all models'],
  ['seven_day_opus', 'Weekly, Opus'],
  ['seven_day_sonnet', 'Weekly, Sonnet'],
];

const resetMs = (r) => (typeof r === 'number' ? r * 1000 : Date.parse(r));

// One usage window of an account. Past its reset time, the window started again and holds only newer use.
export function windowOf(a, key, now = Date.now()) {
  const w = a.usage?.[key];
  if (!w) return { value: null, sub: a.id === 'login' || key === 'five_hour' ? 'No usage seen yet' : 'Claude did not send this value for the account yet' };
  if (w.resets_at && resetMs(w.resets_at) <= now) return { value: 0, sub: `Window started again at ${resetTime(w.resets_at)}` };
  const seen = a.id === 'login' || !a.usageAt ? '' : `, seen ${ago(a.usageAt)}`;
  return { value: w.utilization, sub: `${w.resets_at ? `Resets ${resetTime(w.resets_at)}` : ''}${seen}` };
}
export const fiveHour = (a) => windowOf(a, 'five_hour');

function dayName(day) {
  const d = new Date(`${day}T12:00:00`);
  return d.toDateString() === new Date().toDateString() ? 'Today' : d.toLocaleDateString([], { weekday: 'short', day: 'numeric' });
}

export default function UsageSection({ ready, turns, live, accounts, chatAccount }) {
  const [limits, setLimits] = useState(null);
  const [daily, setDaily] = useState(null);

  // Reading usage sends no prompt, so a refresh every 2 minutes costs nothing.
  useEffect(() => {
    if (!ready) return;
    const load = () => call('usage:limits').then((r) => setLimits(r.limits)).catch(() => {});
    load();
    const id = setInterval(load, 120000);
    return () => clearInterval(id);
  }, [ready, turns, chatAccount?.id]);

  useEffect(() => {
    call('usage:daily').then(setDaily).catch(() => setDaily([]));
  }, [turns]);

  // Rate limit events from the running session are newer than the last fetch.
  const merged = { ...(limits || {}) };
  for (const [k, w] of Object.entries(live || {})) merged[k] = { ...(merged[k] || {}), ...w };

  const shown = WINDOWS.filter(([k]) => merged[k]);
  const max = Math.max(1, ...(daily || []).map((d) => d.input + d.output + d.cacheRead + d.cacheWrite));
  const five = merged.five_hour?.utilization;

  return (
    <Section title="Usage" icon="gauge" summary={five != null ? `${Math.round(five)}% of 5-hour window` : ''} defaultOpen>
      {accounts?.list.length > 1 && chatAccount && <h4 className="sub-head">{chatAccount.email || chatAccount.name} (this chat)</h4>}
      {shown.length === 0 && <p className="muted">Plan limits show after Claude Code starts.</p>}
      {shown.map(([k, label]) => (
        <Meter key={k} label={label} value={merged[k].utilization} sub={merged[k].resets_at ? `Resets ${resetTime(merged[k].resets_at)}` : ''} />
      ))}
      {accounts?.list.length > 1 && accounts.list.filter((a) => a.id !== chatAccount?.id).map((a) => (
        <div key={a.id} className="account-usage">
          <h4 className="sub-head">{a.email || a.name}</h4>
          {[['five_hour', '5-hour window'], ['seven_day', 'Weekly']].map(([k, label]) => {
            const w = windowOf(a, k);
            return <Meter key={k} label={label} value={w.value} sub={w.sub} />;
          })}
        </div>
      ))}
      <h4 className="sub-head">Tokens per day, this computer</h4>
      {!daily && <p className="muted">Reading session files</p>}
      {daily && (
        <ol className="days">
          {daily.map((d) => {
            const total = d.input + d.output + d.cacheRead + d.cacheWrite;
            return (
              <li key={d.day} title={`Output ${tokens(d.output)}, input ${tokens(d.input)}, cache write ${tokens(d.cacheWrite)}, cache read ${tokens(d.cacheRead)}`}>
                <span className="day">{dayName(d.day)}</span>
                <span className="bar"><span style={{ width: `${(total / max) * 100}%` }} /></span>
                <span className="num">{total ? tokens(total) : '0'}</span>
              </li>
            );
          })}
        </ol>
      )}
    </Section>
  );
}

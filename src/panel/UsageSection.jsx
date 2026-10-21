import { useEffect, useState } from 'react';
import { call } from '../api.js';
import Section from './Section.jsx';
import Meter from './Meter.jsx';
import { resetTime, tokens } from '../format.js';

const WINDOWS = [
  ['five_hour', '5-hour window'],
  ['seven_day', 'Weekly, all models'],
  ['seven_day_opus', 'Weekly, Opus'],
  ['seven_day_sonnet', 'Weekly, Sonnet'],
];

function dayName(day) {
  const d = new Date(`${day}T12:00:00`);
  return d.toDateString() === new Date().toDateString() ? 'Today' : d.toLocaleDateString([], { weekday: 'short', day: 'numeric' });
}

export default function UsageSection({ ready, turns, live }) {
  const [limits, setLimits] = useState(null);
  const [daily, setDaily] = useState(null);

  useEffect(() => {
    if (!ready) return;
    call('usage:limits').then((r) => setLimits(r.limits)).catch(() => {});
  }, [ready, turns]);

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
      {shown.length === 0 && <p className="muted">Plan limits show after Claude Code starts.</p>}
      {shown.map(([k, label]) => (
        <Meter key={k} label={label} value={merged[k].utilization} sub={merged[k].resets_at ? `Resets ${resetTime(merged[k].resets_at)}` : ''} />
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

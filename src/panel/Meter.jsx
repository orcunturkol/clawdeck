const SEGMENTS = 24;

// Segment meter, like the level LEDs on a mixing desk.
export default function Meter({ label, value, sub }) {
  const v = Math.max(0, Math.min(100, value ?? 0));
  const lit = Math.round((v / 100) * SEGMENTS);
  return (
    <div className="meter">
      <div className="meter-head">
        <span className="meter-label">{label}</span>
        <span className="meter-val">{value == null ? 'No data' : `${Math.round(v)}%`}</span>
      </div>
      <div className="segments" role="meter" aria-label={label} aria-valuenow={Math.round(v)} aria-valuemin={0} aria-valuemax={100}>
        {Array.from({ length: SEGMENTS }, (_, i) => (
          <span key={i} className={`seg ${i < lit ? (i >= SEGMENTS * 0.8 ? 'hot' : 'lit') : ''}`} />
        ))}
      </div>
      {sub && <div className="meter-sub">{sub}</div>}
    </div>
  );
}

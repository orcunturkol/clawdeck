export default function Switch({ on, onChange, label, busy }) {
  return (
    <button role="switch" aria-checked={on} aria-label={label} className={`switch ${on ? 'on' : ''}`} disabled={busy} onClick={() => onChange(!on)}>
      <span className="switch-knob" />
    </button>
  );
}

import { useState } from 'react';
import Icon from '../components/Icon.jsx';

export default function Section({ title, icon, summary, defaultOpen = false, children }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className={`section ${open ? 'open' : ''}`}>
      <button className="section-head" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span className="chev" aria-hidden />
        {icon && <Icon name={icon} className="section-icon" />}
        <span className="section-title">{title}</span>
        <span className="section-sum">{summary}</span>
      </button>
      {open && <div className="section-body">{children}</div>}
    </section>
  );
}

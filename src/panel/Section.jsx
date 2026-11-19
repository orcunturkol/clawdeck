import Icon from '../components/Icon.jsx';
import { usePanelOpen } from './panelState.js';

export default function Section({ id, title, icon, summary, defaultOpen = false, children }) {
  const [open, setOpen] = usePanelOpen(id, defaultOpen);
  return (
    <section className={`section ${open ? 'open' : ''}`}>
      <button className="section-head" data-testid={id && `section-${id}`} onClick={() => setOpen(!open)} aria-expanded={open}>
        <span className="chev" aria-hidden />
        {icon && <Icon name={icon} className="section-icon" />}
        <span className="section-title">{title}</span>
        <span className="section-sum">{summary}</span>
      </button>
      {open && <div className="section-body">{children}</div>}
    </section>
  );
}

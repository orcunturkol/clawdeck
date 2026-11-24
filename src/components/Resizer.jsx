// The chat column keeps at least this width; the grid in styles.css has the same floor.
const CHAT_MIN = 360;

// A handle on one edge of the chat column. Dragging it changes the width of the pane on that side.
// The drag writes the CSS variable straight to .app, so the chat does not render again on each move.
export default function Resizer({ edge, prop, min, onDone }) {
  const down = (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const el = e.currentTarget;
    const frame = el.closest('.app');
    // Start from the width on screen: in a narrow window the grid shows less than the saved width.
    const chat = el.parentElement.getBoundingClientRect();
    const w0 = edge === 'left' ? chat.left - frame.getBoundingClientRect().left : window.innerWidth - chat.right;
    const top = Math.max(w0, w0 + chat.width - CHAT_MIN);
    const x0 = e.clientX;
    let w = w0;
    const move = (ev) => {
      const d = edge === 'left' ? ev.clientX - x0 : x0 - ev.clientX;
      w = Math.round(Math.min(top, Math.max(min, w0 + d)));
      frame.style.setProperty(prop, `${w}px`);
    };
    // The capture ends on pointerup, on pointercancel and when the window loses the pointer.
    const end = () => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('lostpointercapture', end);
      document.body.classList.remove('resizing');
      if (w !== w0) onDone(w);
    };
    el.setPointerCapture(e.pointerId);
    el.addEventListener('pointermove', move);
    el.addEventListener('lostpointercapture', end);
    document.body.classList.add('resizing');
  };
  return <div className={`resizer ${edge}`} role="separator" aria-orientation="vertical" onPointerDown={down} />;
}

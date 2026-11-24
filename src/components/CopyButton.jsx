import { useEffect, useRef, useState } from 'react';
import { copyText } from '../clipboard.js';

export default function CopyButton({ text, label = 'Copy code' }) {
  const [done, setDone] = useState(false);
  const timer = useRef(0);
  useEffect(() => () => clearTimeout(timer.current), []);
  const click = async () => {
    if (!(await copyText(text))) return;
    setDone(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setDone(false), 1500);
  };
  return (
    <button type="button" className={`copy-btn ${done ? 'done' : ''}`} data-testid="copy-button" aria-label={label} onClick={click}>
      {done ? 'Copied' : 'Copy'}
    </button>
  );
}

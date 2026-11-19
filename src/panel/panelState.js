import { useSyncExternalStore } from 'react';
import { call } from '../api.js';

// One shared store for the open or closed state of every panel section, keyed by id.
// It loads once from the main process and saves changes after a short pause.
let open = {};
let pending = {};
let timer = null;
const subs = new Set();
const emit = () => subs.forEach((f) => f());

call('settings:panelGet').then((s) => {
  // Clicks made before the load finished win over the saved values.
  open = { ...s.open, ...pending };
  emit();
}).catch(() => {});

function flush() {
  timer = null;
  const patch = pending;
  pending = {};
  call('settings:panelSet', patch).catch(() => {});
}

function setOpen(id, value) {
  open = { ...open, [id]: value };
  pending[id] = value;
  clearTimeout(timer);
  timer = setTimeout(flush, 300);
  emit();
}

window.addEventListener('beforeunload', () => { if (timer) flush(); });

const subscribe = (f) => { subs.add(f); return () => subs.delete(f); };
const snapshot = () => open;

// Returns [isOpen, setIsOpen]. Without an id, or before a saved value exists, it uses defaultOpen.
export function usePanelOpen(id, defaultOpen) {
  const all = useSyncExternalStore(subscribe, snapshot);
  const isOpen = id && typeof all[id] === 'boolean' ? all[id] : defaultOpen;
  return [isOpen, (v) => id && setOpen(id, v)];
}

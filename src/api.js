// Electron prefixes errors from the main process; keep only the message.
export const call = (channel, arg) => window.deck.invoke(channel, arg).catch((e) => {
  throw new Error(String(e.message).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''));
});
export const onEvent = (fn) => window.deck.on(fn);

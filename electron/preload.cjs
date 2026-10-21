const { contextBridge, ipcRenderer, webUtils } = require('electron');

const CHANNEL = /^(win|app|dir|session|sessions|mcp|plugins|usage|hooks|memory|settings|browser|voice|running|tts):\w+$/;

contextBridge.exposeInMainWorld('deck', {
  invoke(channel, arg) {
    if (!CHANNEL.test(channel)) throw new Error(`Blocked channel ${channel}`);
    return ipcRenderer.invoke(channel, arg);
  },
  on(listener) {
    const fn = (_e, event) => listener(event);
    ipcRenderer.on('deck:event', fn);
    return () => ipcRenderer.removeListener('deck:event', fn);
  },
  pathForFile: (file) => webUtils.getPathForFile(file),
});

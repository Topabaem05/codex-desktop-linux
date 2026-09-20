'use strict';
// No contextBridge and no new page-visible capabilities. Existing isolation stays on.
const { ipcRenderer, webFrame } = require('electron');
if (process.isMainFrame !== false) {
  let last = 0;
  ipcRenderer.on('codex-community:release-unused', () => {
    const now = Date.now();
    if (document.visibilityState !== 'hidden' || now - last < 60000) return;
    last = now;
    // Only unreachable Blink resources. Never cookies, storage or transcript text.
    webFrame.clearCache();
    ipcRenderer.send('codex-community:cache-released');
  });
  window.addEventListener('DOMContentLoaded', () => {
    ipcRenderer.send('codex-community:preload-ready');
  }, { once: true });
}

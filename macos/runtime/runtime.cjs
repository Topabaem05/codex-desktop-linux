'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const v8 = require('node:v8');
const { trustedUI, validateProfile, shouldRelease, css } = require('./policy.cjs');
let installed = false;
function install() {
  if (installed) return;
  installed = true;
  const { app, session, webContents, BrowserWindow, ipcMain } = require('electron');
  const profile = validateProfile(require('./profile.json'));
  const safeMode = process.env.CODEX_COMMUNITY_SAFE_MODE === '1';
  const stateDir = process.env.CODEX_COMMUNITY_STATE_DIR || path.join(os.homedir(), 'Library', 'Application Support', 'Codex Community', 'memory');
  fs.mkdirSync(stateDir, { recursive: true, mode: 0o700 });
  const report = {
    version: 1, profile: profile.name, pid: process.pid, safeMode,
    heapLimitBytes: v8.getHeapStatistics().heap_size_limit,
    requestedFeatures: profile.features, notPorted: profile.notPorted,
    hardLimitEnforced: false, ready: false, samples: 0, uiApplied: 0,
    preloadReady: 0, cacheReleases: 0, bytes: null, state: 'unknown',
    metric: 'physical-footprint-sum', lastError: null
  };
  function write() {
    // A single bounded snapshot. No prompts, URLs, code, tokens or argv in logs.
    report.updatedAt = new Date().toISOString();
    const body = JSON.stringify(report, null, 2);
    if (body.length > 65536) return;
    const dest = path.join(stateDir, 'status.json');
    const tmp = `${dest}.${process.pid}.tmp`;
    try { fs.writeFileSync(tmp, body, { mode: 0o600 }); fs.renameSync(tmp, dest); }
    catch { /* Diagnostics failure must not abort user work. */ }
  }
  write();
  if (safeMode) { app.whenReady().then(() => { report.ready = true; write(); }); return; }
  const { BudgetPolicy } = require('./budget/runtime/core.js');
  const { snapshot, pressureSource } = require('./budget/runtime/platform.js');
  const policy = new BudgetPolicy();
  const windows = new Map();
  const sessions = new WeakSet();
  const styles = css(profile);
  let systemPressure = 'unknown', sampling = false, closed = false, timer;
  const stopPressure = pressureSource(p => { systemPressure = p; }, () => { report.lastError = 'pressure-unavailable'; });
  function register(ses) {
    if (sessions.has(ses)) return;
    sessions.add(ses);
    if (profile.features.idleRendererCacheRelease) {
      if (typeof ses.registerPreloadScript !== 'function') {
        report.lastError = 'preload-api-unavailable'; write(); return;
      }
      ses.registerPreloadScript({ type: 'frame', filePath: path.join(__dirname, 'preload.cjs') });
    }
  }
  function trusted(wc) { return !wc.isDestroyed() && trustedUI(wc.getURL(), app.getAppPath()); }
  function track(wc) {
    if (windows.has(wc.id) || wc.getType() !== 'window') return;
    register(wc.session);
    const state = { wc, key: null, lastInput: Date.now(), lastRelease: 0, preload: false };
    windows.set(wc.id, state);
    wc.on('before-input-event', () => { state.lastInput = Date.now(); });
    wc.on('destroyed', () => { windows.delete(wc.id); });
    wc.on('did-start-navigation', (_event, _url, _inPlace, mainFrame) => {
      if (mainFrame) { state.key = null; state.preload = false; }
    });
    wc.on('dom-ready', async () => {
      if (!trusted(wc)) return;
      try {
        if (profile.features.backgroundThrottling) wc.setBackgroundThrottling(true);
        if (!state.key && styles) {
          state.key = await wc.insertCSS(styles);
          report.uiApplied++;
        }
        write();
      } catch { report.lastError = 'ui-application-failed'; write(); }
    });
  }
  app.on('session-created', register);
  app.on('web-contents-created', (_event, wc) => track(wc));
  function validSender(event) {
    const state = windows.get(event.sender.id);
    return state && trusted(event.sender) && event.senderFrame === event.sender.mainFrame ? state : null;
  }
  ipcMain.on('codex-community:preload-ready', event => {
    const state = validSender(event);
    if (state) { state.preload = true; report.preloadReady++; write(); }
  });
  ipcMain.on('codex-community:cache-released', event => {
    if (validSender(event)) { report.cacheReleases++; write(); }
  });
  async function sample() {
    if (sampling || closed) return;
    sampling = true;
    try {
      const result = await snapshot(process.pid);
      const decision = policy.update(result.bytes, systemPressure);
      report.samples++; report.bytes = result.bytes; report.state = decision.state;
      report.processCount = result.processes.length; report.systemPressure = systemPressure;
      const now = Date.now();
      for (const state of windows.values()) {
        if (!state.preload || !trusted(state.wc)) continue;
        const win = BrowserWindow.fromWebContents(state.wc);
        const hidden = !!win && (!win.isVisible() || win.isMinimized());
        if (shouldRelease(decision.state, hidden, now - state.lastInput, state.lastRelease, now, profile.cacheCooldownMs)) {
          state.lastRelease = now;
          state.wc.send('codex-community:release-unused');
        }
      }
    } catch { report.bytes = null; report.state = 'unknown'; report.lastError = 'sample-unavailable'; }
    finally { sampling = false; if (!closed) write(); }
  }
  app.whenReady().then(() => {
    register(session.defaultSession);
    for (const wc of webContents.getAllWebContents()) track(wc);
    report.ready = true; write();
    sample(); timer = setInterval(sample, profile.sampleMs); timer.unref();
  }).catch(() => { report.lastError = 'app-not-ready'; write(); });
  app.once('will-quit', () => { closed = true; clearInterval(timer); stopPressure(); });
}
module.exports = { install };

'use strict';
const {SnapshotWriter,groupProcesses,needsDocumentReset}=require('./telemetry.cjs');
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
  const ablation = process.env.CODEX_COMMUNITY_ABLATION || 'none';
  const stateDir = process.env.CODEX_COMMUNITY_STATE_DIR || path.join(os.homedir(), 'Library', 'Application Support', 'Codex Community', 'memory');
  globalThis.__codexCommunityLowMemory = !safeMode;
  globalThis.__codexCommunityMcpGuard = !safeMode && profile.features.stdioMcpGuardian === true;
  const writer=new SnapshotWriter(stateDir);
  const sessionPolicy=require('./session-policy.cjs');
  const report = {
    version: 3, ablation, observerMode: (safeMode||ablation==='no-observer')?'disabled':'persistent-native', groups: {}, profile: profile.name, pid: process.pid, safeMode,
    heapLimitBytes: v8.getHeapStatistics().heap_size_limit,
    requestedFeatures: profile.features, notPorted: profile.notPorted,
    hardLimitEnforced: false, ready: false, samples: 0, uiApplied: 0,
    preloadReady: 0, cacheReleases: 0, bytes: null, state: 'unknown',
    metric: 'physical-footprint-sum', lastError: null
  };
  function write() {
    report.updatedAt=new Date().toISOString();
    report.metadataSessions=sessionPolicy.stats();
    report.mcpGuardian=require('./guardian-policy.cjs').stats();
    writer.write(report);
  }
  write();
  const {BudgetPolicy}=require('./budget/runtime/core.js');
  const {observe}=require('./observer.cjs');
  const policy = new BudgetPolicy();
  const windows = new Map();
  const sessions = new WeakSet();
  const styles = css(profile);
  let systemPressure = 'unknown', closed = false, stopObserver=()=>{};
  function register(ses) {
    if (sessions.has(ses)) return;
    sessions.add(ses);
    if (safeMode || profile.features.idleRendererCacheRelease) {
      if (typeof ses.registerPreloadScript !== 'function') {
        report.lastError = 'preload-api-unavailable'; write(); return;
      }
      if(!safeMode&&ablation==='upstream-highlight')ses.registerPreloadScript({type:'frame',filePath:path.join(__dirname,'preload-highlight-ablation.cjs')});
      ses.registerPreloadScript({ type: 'frame', filePath: path.join(__dirname, safeMode?'preload-safe.cjs':'preload.cjs') });
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
      if (needsDocumentReset(_inPlace, mainFrame)) { state.key = null; state.preload = false; }
    });
    wc.on('dom-ready', async () => {
      if (safeMode || !trusted(wc)) return;
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
  ipcMain.on('codex-community:safe-ready',event=>{if(safeMode&&validSender(event)){report.safePreloadReady=(report.safePreloadReady??0)+1;write();}});
  ipcMain.on('codex-community:preload-ready', event => {
    const state = validSender(event);
    if (state) { state.preload = true; report.preloadReady++; write(); }
  });
  ipcMain.on('codex-community:cache-result', (event, value) => {
    if (!validSender(event) || !value || typeof value.released!=='boolean') return;
    if (value.released) report.cacheReleases++;
    report.lastCacheResult={released:value.released,
      unusedSize:Number.isSafeInteger(value.unusedSize)&&value.unusedSize>=0?value.unusedSize:null,
      sizeDelta:Number.isSafeInteger(value.sizeDelta)&&value.sizeDelta>=0?value.sizeDelta:null};
    write();
  });
  function sample(result) {
    if (closed) return;
    try {
      const decision = policy.update(result.bytes, systemPressure);
      report.samples++; report.bytes = result.bytes; report.state = decision.state;
      report.groups=groupProcesses(result.processes,app.getAppMetrics(),process.pid);
      report.roleClassification='electron-type-or-native-basename';
      report.processCount = result.processes.length; report.systemPressure = systemPressure;
      report.lastError=null;
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
    } catch { report.bytes = null; report.groups={}; report.state = 'unknown'; report.lastError = 'sample-unavailable'; }
    finally { if (!closed) write(); }
  }
  app.whenReady().then(() => {
    register(session.defaultSession);
    for (const wc of webContents.getAllWebContents()) track(wc);
    report.ready = true; write();
    if(!safeMode&&ablation!=='no-observer')stopObserver=observe({onSample:sample,onPressure:p=>{systemPressure=p;},
      onError:()=>{report.bytes=null;report.groups={};report.state='unknown';report.lastError='observer-unavailable';write();}});
  }).catch(() => { report.lastError = 'app-not-ready'; write(); });
  app.once('will-quit', () => { closed = true; stopObserver(); writer.close().catch(()=>{}); });
}
module.exports = { install };

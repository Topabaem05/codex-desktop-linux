'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const { execFile, spawn } = require('node:child_process');
const { promisify } = require('node:util');
const exec = promisify(execFile);
const helperPath = path.join(__dirname, '../native/macos-memory');
const finiteBytes = n => Number.isSafeInteger(n) && n >= 0;

function parseLinuxStat(text) {
  const end = text.lastIndexOf(')');
  const pid = Number(text.slice(0, text.indexOf(' ')));
  const fields = text.slice(end + 2).trim().split(/\s+/);
  if (end < 0 || !Number.isSafeInteger(pid) || pid < 1 || !/^\d+$/.test(fields[19] || '') || !/^\d+$/.test(fields[1] || '')) {
    throw new Error('Malformed /proc stat');
  }
  return { pid, ppid: Number(fields[1]), startId: fields[19] };
}
function descendantPids(table, rootPid, uid) {
  const root = table.find(x => x.pid === rootPid);
  if (!root || root.uid !== uid) throw new Error('Root is missing or is not owned by this user');
  const children = new Map();
  for (const row of table) {
    if (row.uid !== uid) continue;
    if (!children.has(row.ppid)) children.set(row.ppid, []);
    children.get(row.ppid).push(row.pid);
  }
  const found = new Set([rootPid]); const queue = [rootPid];
  for (let i = 0; i < queue.length; i++) {
    for (const pid of children.get(queue[i]) || []) {
      if (!found.has(pid)) { found.add(pid); queue.push(pid); }
    }
  }
  return found;
}
class RootIdentity {
  check(root) {
    if (!root || !Number.isSafeInteger(root.pid) || !Number.isSafeInteger(root.uid) || typeof root.startId !== 'string' || !root.startId) {
      throw new Error('Missing root process identity');
    }
    const key = `${root.uid}:${root.pid}:${root.startId}`;
    if (this.key && key !== this.key) throw new Error('Root process identity changed; observation stopped');
    this.key = key;
  }
}
const kib = (text, name) => {
  const m = text.match(new RegExp(`^${name}:\\s+(\\d+)\\s+kB$`, 'm'));
  const n = m ? Number(m[1]) * 1024 : null;
  return finiteBytes(n) ? n : null;
};
async function linuxRow(pid) {
  const base = `/proc/${pid}`;
  const before = parseLinuxStat(await fs.readFile(`${base}/stat`, 'utf8'));
  const status = await fs.readFile(`${base}/status`, 'utf8');
  const uid = status.match(/^Uid:\s+(\d+)/m);
  const after = parseLinuxStat(await fs.readFile(`${base}/stat`, 'utf8'));
  if (!uid || before.startId !== after.startId) throw new Error('Process changed during sampling');
  return { ...after, uid: Number(uid[1]), rssBytes: kib(status, 'VmRSS'), swapBytes: kib(status, 'VmSwap') };
}
async function linuxSnapshot(pid) {
  const guard = new RootIdentity(); const root = await linuxRow(pid); guard.check(root);
  const entries = (await fs.readdir('/proc')).filter(x => /^\d+$/.test(x));
  const table = [];
  // Bound concurrent reads; do not create a Promise and file descriptor per PID.
  for (let i = 0; i < entries.length; i += 16) {
    const rows = await Promise.all(entries.slice(i, i + 16).map(x => linuxRow(Number(x)).catch(() => null)));
    table.push(...rows.filter(Boolean));
  }
  const selected = descendantPids(table, pid, process.getuid());
  const processes = table.filter(x => selected.has(x.pid));
  for (const row of processes) {
    row.pssBytes = null;
    try {
      const smaps = await fs.readFile(`/proc/${row.pid}/smaps_rollup`, 'utf8');
      const after = await linuxRow(row.pid);
      if (after.startId !== row.startId) { row.rssBytes = null; continue; }
      row.pssBytes = kib(smaps, 'Pss');
    } catch { /* PSS is optional, not zero. RSS remains a best-effort snapshot. */ }
  }
  guard.check(await linuxRow(pid));
  let pressure = 'unknown'; let psiFullAvg10 = null;
  try {
    const psi = await fs.readFile('/proc/pressure/memory', 'utf8');
    const match = psi.match(/^full avg10=([\d.]+)/m);
    if (match && Number.isFinite(Number(match[1]))) {
      psiFullAvg10 = Number(match[1]);
      pressure = psiFullAvg10 >= 10 ? 'critical' : psiFullAvg10 >= 1 ? 'warning' : 'normal';
    }
  } catch { /* Unsupported PSI is explicitly unknown. */ }
  const total = key => processes.every(x => finiteBytes(x[key])) ? processes.reduce((n, x) => n + x[key], 0) : null;
  return { root, processes, bytes: total('rssBytes'), rssBytes: total('rssBytes'), pssBytes: total('pssBytes'),
    metric: 'rss-sum', pressure, psiFullAvg10, coverage: 'best-effort-descendants', hardLimitEnforced: false };
}
async function snapshot(pid) {
  if (!Number.isSafeInteger(pid) || pid < 1 || pid > 2147483647) throw new RangeError('Invalid PID');
  if (process.platform === 'linux') return linuxSnapshot(pid);
  if (process.platform !== 'darwin') throw new Error('Unsupported platform');
  const { stdout } = await exec(helperPath, [String(pid)], { timeout: 5000, maxBuffer: 8 * 1024 * 1024 });
  const data = JSON.parse(stdout);
  new RootIdentity().check(data.root);
  if (data.root.pid !== pid || data.root.uid !== process.getuid() || !Array.isArray(data.processes)) throw new Error('Invalid native sample');
  for (const row of data.processes) {
    if (row.uid !== process.getuid() || !Number.isSafeInteger(row.pid)) throw new Error('Invalid process scope');
  }
  const total = key => data.processes.length && data.processes.every(x => finiteBytes(x[key])) ? data.processes.reduce((n, x) => n + x[key], 0) : null;
  return { ...data, bytes: total('footprintBytes'), footprintBytes: total('footprintBytes'), rssBytes: total('rssBytes'),
    metric: 'physical-footprint-sum', pressure: 'unknown', coverage: 'best-effort-descendants', hardLimitEnforced: false };
}
function pressureSource(onPressure, onError = () => {}) {
  if (process.platform !== 'darwin') return () => {};
  const child = spawn(helperPath, ['--pressure'], { stdio: ['ignore', 'pipe', 'ignore'] });
  let pending = ''; let closed = false;
  const stop = () => { closed = true; if (child.exitCode === null) child.kill(); };
  child.on('error', error => { if (!closed) { onPressure('unknown'); onError(error); } });
  child.on('exit', () => { if (!closed) onPressure('unknown'); });
  child.stdout.on('data', chunk => {
    pending += chunk.toString('utf8');
    if (pending.length > 4096) { onPressure('unknown'); onError(new Error('Oversized pressure event')); stop(); return; }
    let end;
    while ((end = pending.indexOf('\n')) >= 0) {
      const line = pending.slice(0, end); pending = pending.slice(end + 1);
      try {
        const { pressure } = JSON.parse(line);
        if (!['unknown', 'normal', 'warning', 'critical'].includes(pressure)) throw new Error('Invalid pressure event');
        onPressure(pressure);
      } catch (error) { onPressure('unknown'); onError(error); }
    }
  });
  return stop;
}
module.exports = { parseLinuxStat, descendantPids, RootIdentity, snapshot, pressureSource, helperPath };

#!/usr/bin/env node
'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { parseArgs, promisify } = require('node:util');
const { spawn, execFile } = require('node:child_process');
const { once } = require('node:events');
const { setTimeout: delay } = require('node:timers/promises');
const { BudgetPolicy, launchPlan } = require('./core');
const { RootIdentity, snapshot, pressureSource } = require('./platform');
const exec = promisify(execFile);

function parse(argv) {
  const args = [...argv]; const mode = args.shift() || 'help';
  if (mode === '--help' || mode === 'help') return { mode: 'help', options: {}, command: [] };
  if (!['snapshot', 'monitor', 'run'].includes(mode)) throw new Error('Expected snapshot, monitor or run');
  const delimiter = args.indexOf('--');
  const command = delimiter >= 0 ? args.splice(delimiter).slice(1) : [];
  const { values: options } = parseArgs({ args, strict: true, options: {
    pid: { type: 'string' }, samples: { type: 'string' }, 'interval-ms': { type: 'string' },
    'hard-limit': { type: 'boolean' }, 'electron-heap-mib': { type: 'string' },
    app: { type: 'string' }, 'dry-run': { type: 'boolean' }
  } });
  const allowed = mode === 'run' ? ['hard-limit', 'electron-heap-mib', 'app', 'dry-run'] :
    mode === 'snapshot' ? ['pid'] : ['pid', 'samples', 'interval-ms'];
  if (Object.keys(options).some(k => !allowed.includes(k))) throw new Error(`Option not applicable to ${mode}`);
  for (const k of ['pid', 'samples', 'interval-ms', 'electron-heap-mib']) {
    if (options[k] === undefined) continue;
    if (!/^\d+$/.test(options[k])) throw new Error(`Invalid --${k}`);
    options[k] = Number(options[k]);
    if (!Number.isSafeInteger(options[k]) || options[k] < 1) throw new Error(`Invalid --${k}`);
  }
  if (mode !== 'run' && (!options.pid || command.length)) throw new Error('Supply --pid; commands are only accepted by run');
  if (options['interval-ms'] !== undefined && (options['interval-ms'] < 250 || options['interval-ms'] > 60000)) throw new Error('Interval must be 250..60000 ms');
  return { mode, options, command };
}
async function write(stream, data) {
  if (!stream.write(`${JSON.stringify(data)}\n`)) await once(stream, 'drain');
}
async function observe(pid, { samples = 30, intervalMs = 2000, signal, emit }) {
  const guard = new RootIdentity(); const policy = new BudgetPolicy();
  let pressure = 'unknown';
  const stop = pressureSource(p => { pressure = p; }, e => { process.stderr.write(`[memory-budget] ${e.message}\n`); });
  try {
    for (let i = 0; i < samples && !signal?.aborted; i++) {
      const data = await snapshot(pid); guard.check(data.root);
      if (signal?.aborted) break;
      const decision = policy.update(data.bytes, process.platform === 'darwin' ? pressure : data.pressure);
      await emit({ ...data, pressure: process.platform === 'darwin' ? pressure : data.pressure, ...decision, sampledAt: new Date().toISOString() });
      if (i + 1 < samples) await delay(intervalMs, undefined, { signal });
    }
  } finally { stop(); }
}
async function appExecutable(bundle) {
  if (process.platform !== 'darwin') throw new Error('--app is macOS-only');
  const app = await fs.realpath(bundle);
  const plist = path.join(app, 'Contents/Info.plist');
  const { stdout } = await exec('/usr/libexec/PlistBuddy', ['-c', 'Print :CFBundleExecutable', plist], { timeout: 5000 });
  const name = stdout.trim();
  if (!name || name === '.' || name === '..' || name.includes('/') || name.includes('\\')) throw new Error('Unsafe CFBundleExecutable');
  const executable = path.join(app, 'Contents/MacOS', name);
  if (!(await fs.stat(executable)).isFile()) throw new Error('Missing app executable');
  await exec('/usr/bin/codesign', ['--verify', '--deep', '--strict', app], { timeout: 30000 });
  return executable;
}
async function run(command, options) {
  if (options['hard-limit'] && process.platform !== 'linux') throw new Error('Hard process-tree limits are not supported on macOS');
  if (options.app) command = [await appExecutable(options.app), ...command];
  const plan = launchPlan(command, { hard: !!options['hard-limit'], heapMiB: options['electron-heap-mib'] });
  if (options['dry-run']) { await write(process.stdout, plan); return 0; }
  if (plan.kernelLimitRequested) {
    const controllers = await fs.readFile('/sys/fs/cgroup/cgroup.controllers', 'utf8');
    if (!controllers.split(/\s+/).includes('memory')) throw new Error('A cgroup-v2 memory controller is required');
  }
  // No shell, no alternate unconstrained retry, and no changes to auth/config.
  const child = spawn(plan.command, plan.args, { shell: false, stdio: 'inherit' });
  let done = false;
  const completion = new Promise(resolve => {
    child.once('error', error => { done = true; resolve({ error }); });
    child.once('exit', (code, signal) => { done = true; resolve({ code, signal }); });
  });
  const controller = new AbortController();
  let lastState;
  const observation = child.pid ? observe(child.pid, { samples: Number.MAX_SAFE_INTEGER, signal: controller.signal,
    emit: async data => {
      if (data.state === lastState) return;
      lastState = data.state;
      await write(process.stderr, { kind: 'memory-budget', pid: child.pid, metric: data.metric,
        bytes: data.bytes, state: data.state, advice: data.advice, hardLimitRequested: plan.kernelLimitRequested });
    }
  }).catch(error => { if (!done && !controller.signal.aborted) process.stderr.write(`[memory-budget] Observation unavailable: ${error.message}\n`); }) : Promise.resolve();
  const forward = signal => { if (!done) child.kill(signal); };
  const onInt = () => forward('SIGINT'); const onTerm = () => forward('SIGTERM');
  process.on('SIGINT', onInt); process.on('SIGTERM', onTerm);
  try {
    const result = await completion;
    controller.abort(); await observation;
    if (result.error) throw result.error;
    return result.code ?? (128 + (os.constants.signals[result.signal] || 1));
  } finally {
    controller.abort(); process.off('SIGINT', onInt); process.off('SIGTERM', onTerm);
  }
}
async function main(argv) {
  const { mode, options, command } = parse(argv);
  if (mode === 'help') {
    process.stdout.write('Memory budget toolkit (Node >=22)\n' +
      'snapshot --pid PID\nmonitor --pid PID [--samples 30] [--interval-ms 2000]\n' +
      'run [--hard-limit] [--electron-heap-mib 384] [--app /path/App.app] [--dry-run] -- [command] [args...]\n' +
      'macOS requires native/build-macos.sh; hard limits are Linux-only. Heap flags are experimental, not total RAM caps.\n');
    return 0;
  }
  if (mode === 'snapshot') { await write(process.stdout, await snapshot(options.pid)); return 0; }
  if (mode === 'monitor') {
    await observe(options.pid, { samples: options.samples || 30, intervalMs: options['interval-ms'] || 2000, emit: data => write(process.stdout, data) });
    return 0;
  }
  return run(command, options);
}
if (require.main === module) main(process.argv.slice(2)).then(code => { process.exitCode = code; }, error => {
  process.stderr.write(`memory-budget: ${error.message}\n`); process.exitCode = 2;
});
module.exports = { parse, observe, main };

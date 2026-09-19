'use strict';
const { randomUUID } = require('node:crypto');
const MiB = 1024 * 1024;
const validBytes = n => Number.isSafeInteger(n) && n >= 0;
function positive(n, name, max = Number.MAX_SAFE_INTEGER) {
  if (!Number.isSafeInteger(n) || n < 1 || n > max) throw new RangeError(`Invalid ${name}`);
  return n;
}

// Cooperative advice only. Never signals processes or invents a kernel limit.
class BudgetPolicy {
  constructor({ warningMiB = 800, criticalMiB = 900, maxMiB = 1024,
    hysteresisMiB = 64, recoverySamples = 3 } = {}) {
    [warningMiB, criticalMiB, maxMiB, hysteresisMiB].forEach(n => positive(n, 'budget MiB', 1048576));
    if (!(hysteresisMiB < warningMiB && warningMiB < criticalMiB && criticalMiB < maxMiB)) {
      throw new RangeError('Expected hysteresis < warning < critical < max');
    }
    this.thresholds = [0, warningMiB * MiB, criticalMiB * MiB, maxMiB * MiB];
    this.maxBytes = maxMiB * MiB;
    this.hysteresis = hysteresisMiB * MiB;
    this.recoverySamples = positive(recoverySamples, 'recovery samples', 100);
    this.level = 0;
    this.recovery = 0;
  }
  update(bytes, pressure = 'unknown') {
    if (!validBytes(bytes)) {
      this.recovery = 0;
      return { state: 'unknown', bytes: null, advice: ['defer-heavy-tools', 'repair-telemetry'] };
    }
    let next = bytes >= this.thresholds[3] ? 3 : bytes >= this.thresholds[2] ? 2 : bytes >= this.thresholds[1] ? 1 : 0;
    next = Math.max(next, pressure === 'critical' ? 2 : pressure === 'warning' ? 1 : 0);
    if (next >= this.level) { this.level = next; this.recovery = 0; }
    else if (bytes < this.thresholds[this.level] - this.hysteresis) {
      if (++this.recovery >= this.recoverySamples) { this.level = next; this.recovery = 0; }
    } else this.recovery = 0;
    const states = ['normal', 'warning', 'critical', 'over-budget'];
    const advice = this.level ? ['trim-display-caches', 'batch-render-updates'] : [];
    if (this.level >= 2) advice.push('defer-heavy-tools', 'release-idle-owned-resources');
    if (this.level === 3) advice.push('reject-new-work', 'explicit-budget-required');
    return { state: states[this.level], bytes, advice };
  }
}

// A bounded display tail, NOT a transcript/RPC/model-context buffer.
class ByteTail {
  constructor(maxBytes = 2 * MiB) {
    this.maxBytes = positive(maxBytes, 'tail capacity', 64 * MiB);
    this.buffer = Buffer.alloc(0);
    this.bytes = 0; this.start = 0; this.droppedBytes = 0;
  }
  get storageBytes() { return this.buffer.byteLength; }
  append(value) {
    const input = Buffer.isBuffer(value) ? value : Buffer.from(value);
    if (!input.length) return;
    if (!this.buffer.length) this.buffer = Buffer.allocUnsafeSlow(this.maxBytes);
    if (input.length >= this.maxBytes) {
      this.droppedBytes += this.bytes + input.length - this.maxBytes;
      input.copy(this.buffer, 0, input.length - this.maxBytes);
      this.start = 0; this.bytes = this.maxBytes; return;
    }
    const overflow = Math.max(0, this.bytes + input.length - this.maxBytes);
    this.droppedBytes += overflow;
    this.start = (this.start + overflow) % this.maxBytes;
    this.bytes -= overflow;
    const end = (this.start + this.bytes) % this.maxBytes;
    const first = Math.min(input.length, this.maxBytes - end);
    input.copy(this.buffer, end, 0, first);
    input.copy(this.buffer, 0, first);
    this.bytes += input.length;
  }
  text() {
    const out = Buffer.allocUnsafe(this.bytes);
    const first = Math.min(this.bytes, this.maxBytes - this.start);
    this.buffer.copy(out, 0, this.start, this.start + first);
    this.buffer.copy(out, first, 0, this.bytes - first);
    let offset = 0;
    while (offset < out.length && (out[offset] & 0xc0) === 0x80) offset++;
    return out.toString('utf8', offset);
  }
  clear() { this.buffer = Buffer.alloc(0); this.bytes = 0; this.start = 0; }
}

// Synchronous byte sink; decode UTF-8 with StringDecoder at the consuming edge.
// A disk/IPC sink must implement its own backpressure instead of queueing promises.
class StreamBatcher {
  constructor(consume, { maxBytes = 64 * 1024, intervalMs = 75 } = {}) {
    if (typeof consume !== 'function' || Object.prototype.toString.call(consume) === '[object AsyncFunction]') throw new TypeError('Expected a synchronous sink');
    this.capacity = positive(maxBytes, 'batch capacity', 8 * MiB);
    this.intervalMs = positive(intervalMs, 'batch interval', 60000);
    this.consume = consume;
    this.buffer = Buffer.allocUnsafeSlow(this.capacity);
    this.bytes = 0; this.timer = null; this.closed = false;
  }
  append(value) {
    if (this.closed) throw new Error('Batcher is closed');
    const input = Buffer.isBuffer(value) ? value : Buffer.from(value);
    for (let offset = 0; offset < input.length;) {
      const n = Math.min(this.capacity - this.bytes, input.length - offset);
      input.copy(this.buffer, this.bytes, offset, offset + n);
      this.bytes += n; offset += n;
      if (this.bytes === this.capacity) this.flush();
    }
    if (this.bytes && !this.timer) {
      this.timer = setTimeout(() => this.flush(), this.intervalMs);
      this.timer.unref();
    }
  }
  flush() {
    clearTimeout(this.timer); this.timer = null;
    if (!this.bytes) return;
    const chunk = Buffer.from(this.buffer.subarray(0, this.bytes));
    this.bytes = 0;
    this.consume(chunk);
  }
  close() {
    if (this.closed) return;
    this.closed = true;
    try { this.flush(); } finally { this.buffer = Buffer.alloc(0); }
  }
}

// Reservations are conservative: observed bytes can already include active work.
class AdmissionGate {
  constructor({ maxBytes = 900 * MiB, concurrency = 2 } = {}) {
    this.maxBytes = positive(maxBytes, 'admission budget');
    this.concurrency = positive(concurrency, 'concurrency', 128);
    this.reservedBytes = 0; this.active = 0;
  }
  acquire(observedBytes, estimateBytes, state) {
    positive(estimateBytes, 'reservation');
    const limit = state === 'warning' ? 1 : this.concurrency;
    if (!validBytes(observedBytes) || !['normal', 'warning'].includes(state) ||
      this.active >= limit || observedBytes + this.reservedBytes + estimateBytes > this.maxBytes) return null;
    this.active++; this.reservedBytes += estimateBytes;
    let released = false;
    return () => {
      if (released) return;
      released = true; this.active--; this.reservedBytes -= estimateBytes;
    };
  }
}

function launchPlan(argv, { platform = process.platform, hard = false, heapMiB,
  unit = `codex-budget-${process.pid}-${randomUUID().slice(0, 8)}` } = {}) {
  if (!['linux', 'darwin'].includes(platform)) throw new Error('Supported platforms: Linux and macOS');
  if (!Array.isArray(argv) || !argv.length || argv.some(x => typeof x !== 'string' || x.includes('\0')) || !argv[0]) {
    throw new TypeError('Expected a nonempty command argv');
  }
  if (hard && platform !== 'linux') throw new Error('A process-tree hard memory limit is not supported on macOS');
  const [command, ...args] = argv;
  if (heapMiB !== undefined) {
    positive(heapMiB, 'Electron old-space MiB', 768);
    if (heapMiB < 128 || args.some(x => x.startsWith('--js-flags'))) throw new Error('Invalid or conflicting Electron heap option');
    args.unshift(`--js-flags=--max-old-space-size=${heapMiB}`);
  }
  if (!hard) return { command, args, shell: false, kernelLimitRequested: false };
  if (!/^[a-zA-Z0-9_.-]+$/.test(unit)) throw new Error('Invalid scope name');
  return { command: 'systemd-run', args: ['--user', '--scope', '--quiet', `--unit=${unit}`,
    '--property=MemoryHigh=891289600', '--property=MemoryMax=1073741824',
    '--property=MemorySwapMax=0', '--', command, ...args], shell: false, kernelLimitRequested: true };
}
module.exports = { MiB, BudgetPolicy, ByteTail, StreamBatcher, AdmissionGate, launchPlan };

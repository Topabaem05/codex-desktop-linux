'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawn, execFileSync } = require('node:child_process');
const { once } = require('node:events');
const corePath = path.join(__dirname, 'runtime/core.js');

test('runtime is implemented', () => assert.ok(fs.existsSync(corePath)));

if (fs.existsSync(corePath)) {
  const { MiB, BudgetPolicy, ByteTail, StreamBatcher, AdmissionGate, launchPlan } = require(corePath);
  test('default budget distinguishes target from Linux ceiling', () => {
    const p = new BudgetPolicy();
    assert.equal(p.update(600 * MiB).state, 'normal');
    assert.equal(p.update(850 * MiB).state, 'warning');
    assert.equal(p.update(930 * MiB).state, 'critical');
    assert.equal(p.update(1024 * MiB).state, 'over-budget');
    assert.equal(p.maxBytes, 1024 * MiB);
  });
  test('recovery requires three low samples, not one dip', () => {
    const p = new BudgetPolicy(); p.update(950 * MiB);
    assert.equal(p.update(600 * MiB).state, 'critical');
    assert.equal(p.update(600 * MiB).state, 'critical');
    assert.equal(p.update(600 * MiB).state, 'normal');
  });
  test('unknown data is not zero and breaks recovery streak', () => {
    const p = new BudgetPolicy(); p.update(950 * MiB); p.update(600 * MiB);
    assert.equal(p.update(null).state, 'unknown');
    assert.equal(p.update(600 * MiB).state, 'critical');
    for (const n of [NaN, Infinity, -1, '10']) assert.equal(p.update(n).state, 'unknown');
  });
  test('system pressure raises state without hiding observed bytes', () => {
    const p = new BudgetPolicy();
    assert.equal(p.update(200 * MiB, 'critical').state, 'critical');
    assert.equal(p.update(200 * MiB, 'unknown').bytes, 200 * MiB);
  });
  test('tail stays byte bounded even for huge input and multibyte text', () => {
    const b = new ByteTail(16); b.append('a'.repeat(100000));
    b.append('한글🙂');
    assert.ok(b.bytes <= 16); assert.ok(b.text().endsWith('한글🙂'));
    assert.ok(!b.text().includes('\ufffd'));
    assert.ok(b.droppedBytes > 0);
  });
  test('tail copies input rather than retaining caller backing allocation', () => {
    const b = new ByteTail(8); const input = Buffer.from('abcdefghijk');
    b.append(input); input.fill(120);
    assert.equal(b.text(), 'defghijk');
    assert.equal(b.storageBytes, 8);
    b.clear(); assert.equal(b.bytes, 0);
  });
  test('tail validates bounds', () => {
    for (const n of [0, -1, NaN, 1.1]) assert.throws(() => new ByteTail(n));
  });
  test('stream batches without dropping data, including oversized chunks', () => {
    const out = []; const s = new StreamBatcher(x => out.push(x), { maxBytes: 8, intervalMs: 10000 });
    const input = Buffer.from('abc한글🙂def'.repeat(100));
    s.append(input); s.close();
    assert.deepEqual(Buffer.concat(out), input);
    assert.ok(out.every(x => x.length <= 8));
    assert.throws(() => s.append('late'));
  });
  test('stream flushes on timer and releases timer on close', async () => {
    const out = []; const s = new StreamBatcher(x => out.push(x), { intervalMs: 10 });
    s.append('one'); s.append('two');
    await new Promise(r => setTimeout(r, 40));
    s.close(); assert.equal(Buffer.concat(out).toString(), 'onetwo');
    assert.equal(out.length, 1);
  });
  test('admission includes reservations and releases idempotently', () => {
    const g = new AdmissionGate({ maxBytes: 900 * MiB, concurrency: 2 });
    const a = g.acquire(500 * MiB, 200 * MiB, 'normal'); assert.equal(typeof a, 'function');
    assert.equal(g.acquire(500 * MiB, 250 * MiB, 'normal'), null);
    const b = g.acquire(500 * MiB, 150 * MiB, 'normal'); assert.ok(b);
    assert.equal(g.acquire(0, 1, 'normal'), null);
    a(); a(); b(); assert.equal(g.reservedBytes, 0);
  });
  test('admission refuses unknown/high pressure, never suspends live work', () => {
    const g = new AdmissionGate();
    for (const state of ['unknown', 'critical', 'over-budget']) assert.equal(g.acquire(1, 1, state), null);
    assert.equal(g.acquire(null, 1, 'normal'), null);
    assert.throws(() => g.acquire(1, -1, 'normal'));
  });
  test('hard cap is rejected on macOS before spawning anything', () => {
    assert.throws(() => launchPlan(['codex'], { platform: 'darwin', hard: true }), /not supported/);
  });
  test('Linux hard limit has zero swap and does not use shell interpolation', () => {
    const p = launchPlan(['codex', 'a; touch /tmp/nope', 'x y'], { platform: 'linux', hard: true, unit: 'test-budget' });
    assert.equal(p.command, 'systemd-run');
    assert.ok(p.args.includes('--property=MemoryMax=1073741824'));
    assert.ok(p.args.includes('--property=MemorySwapMax=0'));
    assert.deepEqual(p.args.slice(-3), ['codex', 'a; touch /tmp/nope', 'x y']);
    assert.equal(p.shell, false);
  });
  test('heap option is explicit, per-isolate and rejects duplicate js flags', () => {
    assert.deepEqual(launchPlan(['app'], { platform: 'darwin' }).args, []);
    assert.ok(launchPlan(['app'], { heapMiB: 384 }).args.includes('--js-flags=--max-old-space-size=384'));
    assert.throws(() => launchPlan(['app', '--js-flags=x'], { heapMiB: 384 }));
    assert.throws(() => launchPlan(['app'], { heapMiB: 0 }));
    assert.throws(() => launchPlan([]));
  });
}

const platformPath = path.join(__dirname, 'runtime/platform.js');
test('platform sampler is implemented', () => assert.ok(fs.existsSync(platformPath)));
if (fs.existsSync(platformPath)) {
  const { parseLinuxStat, descendantPids, RootIdentity, snapshot, pressureSource } = require(platformPath);
  test('Linux stat parser handles parentheses/spaces without shifting start time', () => {
    const fields = ['S', '12', ...Array(17).fill('0'), '98765', '0'];
    const s = parseLinuxStat(`34 (odd ) name) ${fields.join(' ')}`);
    assert.equal(s.pid, 34); assert.equal(s.ppid, 12); assert.equal(s.startId, '98765');
    assert.throws(() => parseLinuxStat('bad'));
  });
  test('descendant scope includes grandchildren but excludes other users', () => {
    const table = [{ pid: 1, ppid: 0, uid: 5 }, { pid: 2, ppid: 1, uid: 5 },
      { pid: 3, ppid: 2, uid: 5 }, { pid: 4, ppid: 1, uid: 6 }, { pid: 8, ppid: 0, uid: 5 }];
    assert.deepEqual([...descendantPids(table, 1, 5)].sort(), [1, 2, 3]);
    assert.throws(() => descendantPids(table, 1, 6));
  });
  test('root identity rejects PID reuse and missing roots', () => {
    const guard = new RootIdentity();
    guard.check({ pid: 2, uid: 5, startId: 'a' });
    guard.check({ pid: 2, uid: 5, startId: 'a' });
    assert.throws(() => guard.check({ pid: 2, uid: 5, startId: 'b' }), /identity/);
    assert.throws(() => new RootIdentity().check(null));
  });
  test('sampler observes real child memory and root identity', { timeout: 10000 }, async () => {
    const child = spawn(process.execPath, ['-e', 'global.b=Buffer.alloc(16*1024*1024,1);console.log("ready");setInterval(()=>{},1000)'], { stdio: ['ignore', 'pipe', 'inherit'] });
    try {
      await once(child.stdout, 'data');
      const data = await snapshot(process.pid);
      assert.equal(data.root.pid, process.pid);
      assert.ok(data.processes.some(x => x.pid === child.pid && x.rssBytes > 8 * 1024 * 1024));
      assert.ok(data.bytes > 0);
      assert.equal(data.coverage, 'best-effort-descendants');
      assert.equal(data.hardLimitEnforced, false);
      new RootIdentity().check(data.root);
    } finally { const exited = once(child, 'exit'); child.kill(); await exited; }
  });
  test('sampler rejects invalid or disappeared root instead of reporting zero', async () => {
    await assert.rejects(snapshot(0));
    await assert.rejects(snapshot(2147483647));
  });
  test('macOS pressure source initializes as unknown and can be disposed', { skip: process.platform !== 'darwin', timeout: 5000 }, async () => {
    let resolveEvent;
    const first = new Promise(r => { resolveEvent = r; });
    const stop = pressureSource(x => resolveEvent(x));
    try { assert.equal(await first, 'unknown'); } finally { stop(); }
  });
}

const cliPath = path.join(__dirname, 'runtime/cli.js');
test('CLI is implemented', () => assert.ok(fs.existsSync(cliPath)));
if (fs.existsSync(cliPath)) {
  const { parse } = require(cliPath);
  test('CLI keeps command argv separate from its own options', () => {
    const p = parse(['run', '--hard-limit', '--', 'codex', '--help', 'two words']);
    assert.equal(p.mode, 'run'); assert.equal(p.options['hard-limit'], true);
    assert.deepEqual(p.command, ['codex', '--help', 'two words']);
    assert.throws(() => parse(['snapshot', '--pid', 'oops']));
    assert.throws(() => parse(['monitor', '--pid', '1', '--samples', '0']));
    assert.throws(() => parse(['run', '--pid', '1', '--', 'codex']));
  });
  test('CLI dry run is side-effect free and preserves a quoted argument', () => {
    const output = execFileSync(process.execPath, [cliPath, 'run', '--dry-run', '--', 'codex', 'a b; c'], { encoding: 'utf8' });
    const plan = JSON.parse(output);
    assert.deepEqual(plan.args, ['a b; c']); assert.equal(plan.shell, false);
  });
  test('CLI propagates child exit status', () => {
    assert.throws(() => execFileSync(process.execPath, [cliPath, 'run', '--', process.execPath, '-e', 'process.exit(7)'], { stdio: 'pipe' }), error => error.status === 7);
  });
  test('CLI snapshot produces scoped metrics for a live parent', () => {
    const raw = execFileSync(process.execPath, [cliPath, 'snapshot', '--pid', String(process.pid)], { encoding: 'utf8' });
    const result = JSON.parse(raw);
    assert.equal(result.root.pid, process.pid); assert.ok(result.bytes > 0);
  });
  test('Linux hook is opt-in and does not overwrite existing JS flags', () => {
    const hook = path.join(__dirname, 'launcher.sh');
    const env = { ...process.env, CODEX_MEMORY_JS_HEAP_MIB: '' };
    assert.equal(execFileSync('sh', [hook], { env, encoding: 'utf8' }), '');
    env.CODEX_MEMORY_JS_HEAP_MIB = '384';
    assert.match(execFileSync('sh', [hook], { env, encoding: 'utf8' }), /max-old-space-size=384/);
    assert.equal(execFileSync('sh', [hook, '--js-flags=--other'], { env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }), '');
    for (const bad of ['abc', '12', '99999999999999999999', '384\n--no-sandbox']) {
      env.CODEX_MEMORY_JS_HEAP_MIB = bad;
      assert.throws(() => execFileSync('sh', [hook], { env, stdio: 'pipe' }));
    }
  });
}

test('batcher refuses an async sink that could form an unbounded queue', () => {
  const { StreamBatcher } = require(corePath);
  assert.throws(() => new StreamBatcher(async () => {}), /synchronous/);
});
test('display tail matches a bounded reference over repeated wraparound', () => {
  const { ByteTail } = require(corePath); const b = new ByteTail(37); let reference = '';
  for (let i = 1; i <= 300; i++) {
    const text = String.fromCharCode(65 + i % 26).repeat(i % 89);
    reference = (reference + text).slice(-37); b.append(text);
    assert.equal(b.text(), reference); assert.ok(b.storageBytes <= 37);
  }
});
test('feature remains opt-in, stages only present resources, and has no ASAR patch', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, 'feature.json'), 'utf8'));
  assert.equal(manifest.defaultEnabled, false);
  assert.equal(manifest.entrypoints?.patchDescriptors, undefined);
  for (const resource of manifest.resources) assert.ok(fs.existsSync(path.join(__dirname, resource.source)));
  assert.ok(fs.existsSync(path.join(__dirname, manifest.runtimeHooks.launcher)));
});

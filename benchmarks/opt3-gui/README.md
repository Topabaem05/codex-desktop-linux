# Original versus shipped opt3: GUI memory attribution

Diagnostic branch only. No product or distributed artifact is changed. `stock`
compares the exact original and opt3 DMGs verified by hashes/signatures/ASAR.
Both versions use default tuning, same runner, separate reused Codex/browser
profiles, one warmup and three counterbalanced measured launches. Logged primary
window and renderer route milestones are not interactive task completion.
Measure physical-footprint by process role, CPU for surviving process identities,
visible 1/5/15/30/60s, hidden 70s, shown 75s, and known survivors 5s after native
quit request. Native HOME stays that of the disposable Actions runner; credentials
and model turns are absent. Installation requests/outcomes are reported separately:
`install_started` alone does not prove a byte download. OS caches are not purged.

`probe` is separate and does NOT supply stock speed numbers. Identical temporary
ASAR instrumentation and ad-hoc signing expose numeric main/V8/Blink/cache/DOM
stats via private IPC; nothing callable is exposed to web pages. No inspector
port, security fuse changes, force-GC or transcript collection. It records visible
and hidden content, unused-cache clearing and resource sizes. Timers/IPC alter
cost and signatures differ; do not pool with stock runs. V8 heap, native footprint
and Blink/cache sizes are overlapping/different metrics and must NOT be added.
Multiple webContents can share a renderer; deduplicate PID when analyzing heaps.

High Electron share is not a proof that its whole footprint is waste/leak.
Unused cache and hidden contents are candidates, not guaranteed reclaimable OS
RAM. Memory on an unauthenticated empty screen is not an agent workload benchmark.
Group classification outside Electron is best effort from native names and
Chromium flags, with raw argv discarded. Reparented helpers not previously seen
may be outside root-tree accounting. Native quit is a request, not a blanket
promise of cleanup; measure before the harness kills only known test identities.

Run on macOS: `python3 benchmarks/opt3-gui/run.py stock` and `... probe`.
Portable tests: `python3 -m unittest discover -s benchmarks/opt3-gui -p test_metrics.py`.

# Cross-platform Codex memory budget: design

## Outcome and accounting

Target a 500–900 MiB working range and a 1024 MiB Linux cgroup ceiling for an
**independently owned process domain**, not each conversation in a shared
app-server. These are engineering targets, not measurements or guarantees.
A shared renderer/app-server must be reported once, outside individual domains.
A build or browser needing more than this budget must queue, run elsewhere, or
explicitly use a different budget. It cannot transparently fit because of a cap.

Linux: report descendant RSS and PSS separately; enforce only through an explicit
systemd cgroup-v2 scope. RSS double-counts shared pages. cgroup memory.current
also charges file cache and kernel memory; it is not RSS. memory.high causes
reclaim/throttling, not application GC. memory.max can invoke the cgroup OOM
killer and has documented transient exceptions. Swap is disabled in hard mode.

macOS: native libproc per-process physical-footprint and resident-size sampling,
with Dispatch memory-pressure notifications. Footprint, summed RSS and PSS are
not interchangeable. Sampling is best effort, cannot capture every short-lived
child and is not a kernel-enforced tree limit. A request for a hard cap fails
before launch. Do not substitute ulimit, launchd limits or polling-and-killing.

## Architecture

The first deliverable is an opt-in portable toolkit under
linux-features/low-memory-budget. It preserves Linux signed payloads and does
not unpack, inject into, re-sign, disable SIP for, or modify a macOS .app.

1. BudgetPolicy: monotonic hysteresis, explicit unknown samples and cooperative
   pressure advice; no processes are killed or suspended for memory pressure.
2. ByteTail and StreamBatcher: bounded *display* state and batched rendering;
   never truncate protocol, approval, model-context, or persisted transcript data.
3. AdmissionGate: bound concurrent heavy work and reservations before starting
   new tasks. Do not interrupt active tools or assume SIGSTOP frees their memory.
4. Platform sampling: identify root by PID + UID + start identity; stop following
   it on reuse. Same-user descendants only. No command lines or credentials logged.
5. CLI: inspect an existing tree; run a new owned domain; optionally constrain a
   Linux scope or explicitly experiment with an Electron V8 old-space budget.
   The V8 setting is per isolate, not a total Electron limit, and may cause OOM.
6. Native macOS sampler: footprint snapshots and system-pressure event source.
7. CI: Linux and macOS module/integration tests, native Intel and ARM compilation,
   strict source checks and an isolated Linux cgroup accounting/OOM test.

## Integration boundary

This toolkit does not pretend that importing a utility changes the official
React tree. Full message/diff virtualization, server-side idle-thread unloading,
MCP lazy lifecycle and broker-level tool admission need verified owner-specific
integration. Never patch unknown minified symbols. Native macOS GUI optimization
requires upstream source integration or an independently built/signed client;
package signing must remain intact. The common primitives make those changes
testable, but are not automatically wired into official Codex UI or its tools.

Existing optional Watchbound/reapers remain separate. Do not enable both watch
strategies; do not share stateful MCP/browser sessions across agents merely to
make accounting look smaller. Neither shared services nor swap may be hidden
from a total-machine memory report.

## Validation and release gate

Test finite/invalid samples, threshold recovery, Unicode and large-chunk buffer
bounds, lossless stream order, admission reservations, root reuse, unavailable
metrics, real children, failed commands, argument preservation and rejection of
unsupported hard limits. Tests of dummy children are not Codex RAM benchmarks.

An optimized release additionally needs A/B traces on the user's 8 GiB Mac and
Linux hardware: cold launch; one/three agents; long conversation; large diff;
100 MiB tool output; build/browser workload; repeated close/open; 60-minute soak.
Record OS/app/CLI versions, accounting domain, shared cost, peak and P95 memory,
swap/pressure, input latency, idle CPU and crashes. Never report 500–900 MiB as
achieved without these traces. Keep the upstream default branch unchanged until
review. No forced pushes, automated merges or binary distribution in this change.

# Cross-platform Memory Budget Toolkit

**Experimental, disabled by default.** This is a measurement/control foundation,
not a claim that official Codex now uses 500–900 MiB. It adds no ASAR patches and
never alters a signed macOS app. Node.js 22 or newer is required for the tools.
The native Mac observer also requires Xcode Command Line Tools to build locally.

## What is implemented

- A cooperative 800/900/1024 MiB pressure policy with 64 MiB hysteresis and three
  recovery samples. 500–900 MiB is the desired working range, not a minimum allocation.
- A fixed-capacity display byte tail; a lossless synchronous byte batcher (75 ms,
  64 KiB default); a heavy-work admission gate with conservative reservations.
- Same-user process-tree snapshots: Linux RSS and optional PSS; macOS physical
  footprint and RSS from libproc. Dispatch reports Mac system-pressure changes.
- A launcher with optional Linux cgroup limits and optional experimental Electron
  old-space tuning. Unknown metrics are never interpreted as zero.
- A Linux feature hook which does nothing unless CODEX_MEMORY_JS_HEAP_MIB is set.

These primitives are **not automatically wired into official Codex React state,
MCP lifecycle or app-server tool dispatch**. The observer emits advice; it cannot
make another process run GC or discard its state. Application-owned adapters are
required for those optimizations. See the [design](../../docs/superpowers/specs/2026-09-19-memory-budget-design.md).

## Budget and platform semantics

| Property | Linux | macOS |
| --- | --- | --- |
| Default operation | Observation/advice | Observation/advice |
| Actual memory signal | RSS sum, PSS separately | Physical-footprint sum, RSS separately |
| OS pressure | PSI full avg10, heuristic 1%/10% | Dispatch memory-pressure events |
| Explicit kernel cap | systemd/cgroup v2 domain | Not provided; --hard-limit is rejected |
| Signed app modification | None | None |

All reported tree snapshots are best-effort, not an atomic census. Very short
children and reparented/daemonized processes may escape observation. Root
PID/UID/start-time changes stop observation instead of following a reused PID.
RSS sums double-count shared pages; PSS, footprint and cgroup accounting must not
be compared as identical quantities. The helper does not log command arguments,
source text, tokens or credentials. Unsupported/unreadable measurements remain
unknown. A CLI snapshot's hardLimitEnforced=false describes the observer, not a
claim that an externally managed cgroup has no limits.

A desktop with three conversations in one app-server is **one shared process
accounting domain**, not three independently limitable OS processes. Count the
shared UI, app-server, MCP and browser costs once in the machine total. Do not
move memory outside an agent's report to manufacture a per-agent result.

Linux --hard-limit requests MemoryHigh=850 MiB, MemoryMax=1024 MiB and
MemorySwapMax=0. The ceiling is **1 GiB**, not decimal 1 GB. It requires a running
user systemd manager and delegated cgroup-v2 memory control. A failed scope launch
never falls back to unrestricted execution. memory.high throttles/reclaims; it
is not an application-GC request. memory.max can trigger cgroup OOM and has
kernel-documented transient exceptions. A browser/build that genuinely needs
more memory may fail; a ceiling is not a memory optimizer.

## macOS: existing official desktop, no bundle modifications

From the repository root:

```sh
sh linux-features/low-memory-budget/native/build-macos.sh
node linux-features/low-memory-budget/runtime/cli.js --help
```

The helper is compiled **outside** the application bundle. No re-signing,
entitlement edits, SIP changes, accessibility permission or task_for_pid access
is required. The app's own OS/CPU requirements remain unchanged: compiling this
helper for Intel does not make an Apple-Silicon-only app run on Intel.

Select the actual main-app PID in Activity Monitor, then record a baseline:

```sh
umask 077
node linux-features/low-memory-budget/runtime/cli.js monitor \
  --pid 12345 --samples 30 --interval-ms 2000 > codex-memory.jsonl
```

Replace 12345 with the actual PID. To launch a completely exited app and observe
its newly launched tree, use the installed app's actual path:

```sh
node linux-features/low-memory-budget/runtime/cli.js run \
  --app /Applications/Codex.app --
```

The launcher reads CFBundleExecutable and verifies the existing signature. If
another instance is running, upstream's single-instance handoff can make the new
process exit immediately: that is **not a low-memory success**. Quit first or
monitor the existing PID. LaunchServices helpers outside the tree are not counted.

An optional A/B experiment, after a baseline:

```sh
node linux-features/low-memory-budget/runtime/cli.js run \
  --app /Applications/Codex.app --electron-heap-mib 384 --
```

This passes --js-flags=--max-old-space-size=384. It limits V8 old space **per
isolate**, not the app's RSS, native allocations, GPU or tool processes. The
upstream runtime may ignore unsupported switches; verify actual behavior. It
can increase GC stalls or crash a large conversation, so it is not enabled by
default. Remove --electron-heap-mib to roll back. No file inside .app is changed.

## Linux

The toolkit runs directly from this checkout. For an independent agent domain:

```sh
node linux-features/low-memory-budget/runtime/cli.js run --hard-limit -- codex
```

The entire newly launched command tree shares that scope. Do not mistake this
for a per-conversation cap inside an already-running shared Desktop.

To stage the helper and launcher hook into a Linux package, select
`low-memory-budget` using `make setup-native`, preserving all existing feature
choices, and run `make install-native`. Neither command is a macOS installer.
The staged CLI is `.codex-linux/features/low-memory-budget/runtime/cli.js` under
the generated app directory. From a fully exited app, an explicit heap experiment
is `CODEX_MEMORY_JS_HEAP_MIB=384 codex-desktop`. Existing --js-flags take priority.

Remove the variable to stop the heap experiment. Disable the feature and rebuild
to remove its staged resources. No user profile, transcript, auth, MCP state or
plugin cache is deleted. No globally configured swap/oomd/sysctl is changed.

## App-owner integration contract

`runtime/core.js` exports:

- `BudgetPolicy.update(bytes, pressure)` returns state/advice, with invalid bytes
  producing unknown. It has no side effects and does not know individual agents.
- `ByteTail(maxBytes).append(buffer|string)`, `.text()`, `.clear()` bounds a display
  tail; keep the full tool output/transcript in its existing persistent channel.
- `StreamBatcher(synchronousSink, options)` uses `.append()` and `.close()`; chunk
  boundaries are bytes. Use StringDecoder for UTF-8 at the sink. Do not attach an
  async sink or queue its outputs indefinitely. Never use it to drop RPC events.
- `AdmissionGate.acquire(observedBytes, estimateBytes, state)` returns an
  idempotent release callback or null (defer). The integrating caller must retry
  deferred jobs fairly, bound its queue, and release in finally. Estimates can
  be wrong. Active reservations can overlap measured use, conservatively reducing
  concurrency. Existing work is never killed or SIGSTOPed to fake reclamation.

GUI virtualization, inactive-view disposal, idle MCP ownership and tool admission
must be integrated at their actual source owners and regression-tested. They are
explicitly outside the automatically applied changes in this first version.

## Tests and acceptance

```sh
node --test linux-features/low-memory-budget/test.js
node --check linux-features/low-memory-budget/runtime/cli.js
sh -n linux-features/low-memory-budget/launcher.sh
```

On Mac, build the native observer before running tests. CI builds a universal
Intel/ARM observer, runs real-child and pressure-lifecycle tests on macOS, runs
Linux tests/framework validation, and exercises a **scaled-down isolated** Linux
cgroup OOM case. Synthetic tests are not a benchmark of actual Codex.

Before calling a release optimized, run the same versions/repositories on an
8 GiB machine with one and three agents, long history, large diff, tool output,
MCP/browser/build activity and a 60-minute soak. Report cold baseline, P95/peak,
shared memory costs, swap/pressure, input latency and crashes. Achieving the
500–900 MiB target remains unverified until these application traces exist.

## Primary references

- [Linux cgroup-v2 memory controller](https://www.kernel.org/doc/html/latest/admin-guide/cgroup-v2.html)
- [Apple memory-pressure dispatch source](https://developer.apple.com/documentation/dispatch/dispatchsourcememorypressure)
- [Apple resource accounting structures](https://github.com/apple-oss-distributions/xnu/blob/main/bsd/sys/resource.h)
- [Electron performance guidance](https://www.electronjs.org/docs/latest/tutorial/performance)
- [Electron supported switches](https://www.electronjs.org/docs/latest/api/command-line-switches)
- [Codex app-server architecture](https://openai.com/index/unlocking-the-codex-harness/)

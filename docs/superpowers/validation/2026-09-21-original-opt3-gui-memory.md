# Original versus opt3: GUI speed and memory audit — 2026-09-21

## Provenance and boundaries

Product branch remains `ecc864fe406d0a20d8aa5e2a1971c67852ea4e06`. This work is only
on `bench/opt3-gui-memory`; no runtime, DMG, main branch or security policy changed.
No account credentials, model turns or user projects were used.

- Original and shipped opt3 version: 26.915.31945.
- Both bundled backends: `codex-cli 0.155.0-alpha.9.2`.
- Original DMG SHA-256: `f4bc8e95f921f45c3f1d1891ead21eafdbe8e40612eb34cf0be173988c1996dd`.
- Opt3 DMG SHA-256: `8314e2a94c886c019bd543ab5649c165ce641ebbc05b1199c3946ce58099df7c`.
- Stock observations: run `35510598767`, code `754535b`, artifact `10605611656`.
- Stock artifact ZIP SHA-256: `3692c4187113dc5835e1c5646e691bb5655361c36f3143038669b17f7e05eec8`.
- Numeric probe recheck: run `35562186212`, code `9350d2788b8b73e2cc3aa3a4f43f03f4d6da373f`.
- Recheck artifact `10622528027`; ZIP SHA-256 `f734a83f4960667e3fbd58685510b1588f21a305eaa7a9eec76fb354a66e40ff`.
- Stock measurements were collected 2026-09-20; recheck 2026-09-21.
- Both runners: macOS 26.6.2 (25G83), ARM64, `hw.memsize=7516192768` bytes (7 GiB).

## 1. Valid stock A/B: modest memory savings, no demonstrated speedup

After one warmup per version, order was original/opt3/opt3/original/original/opt3.
Mode-private browser and Codex profiles were reused. All six measured stock trials
reached routes-mounted and had complete native memory samples. Values below are
medians of three. MiB means 1,048,576 bytes. Timing is the original app's internal
route marker, NOT external interactive readiness, token latency or task throughput.

| Metric | Original | opt3 |
| --- | ---: | ---: |
| Routes mounted | 4003 ms | 5017 ms |
| Primary ready marker (a different milestone) | 678 ms | 713 ms |
| App-tree footprint at 15s | 1037.27 MiB | 1008.13 MiB |
| At 30s | 885.02 MiB | 857.39 MiB |
| At 60s | 679.12 MiB | 645.27 MiB |
| At 70s, after hiding | 656.89 MiB | 642.70 MiB |
| At 75s, after restoring | 639.92 MiB | 627.12 MiB |

Opt3's observed route time is 25.3% longer, and 60s footprint 33.86 MiB (5.0%)
lower. One measured original trial reported optional runtime installation. After
excluding it: original route median 4394ms (n=2), opt3 5017ms (n=3), or 14.2%
longer. These small-sample descriptive differences do not establish a causal
regression from a particular optimization. Installation request logs alone do
not measure downloaded bytes. No overall speedup is supported.

Memory declines after initial loading in these idle observations. Hiding retains
most allocations, but elapsed time/GC and hiding are confounded. This is not
proof of a monotonic leak, per-agent memory or a reclaimable-byte quantity.

The standalone CLI baseline did not confirm initialization and is excluded.
The earlier stock workflow's separate instrumented probe job failed; that does
not invalidate the completed stock trial records or make the whole workflow pass.

## 2. Electron processes dominate the observed idle GUI footprint

To keep components additive, these are individual 60s snapshots whose total equals
each version's median total, not independently computed per-role medians. Each had
one ordinary visible window and three renderer processes.

| Role | Original MiB | opt3 MiB |
| --- | ---: | ---: |
| Electron main | 223.55 | 193.58 |
| Three renderer processes | 308.59 | 305.76 |
| GPU process | 32.67 | 32.61 |
| Network process | 25.66 | 25.41 |
| Chromium utility | 37.16 | 37.16 |
| Rust Codex engine | 21.30 | 20.77 |
| Added observer | 0 | 1.02 |
| Other helpers | 30.19 | 28.96 |
| Total | 679.12 | 645.27 |
| Electron-family subtotal | 627.63 | 594.52 |
| Electron-family fraction | 92.42% | 92.14% |

Largest renderer: roughly 250 MiB original, 248 MiB opt3. The other two are about
33 MiB and 25 MiB. Allocation priorities are main/renderer rather than GPU or idle
Rust engine. This idle engine sample must not be extrapolated to active tasks.

Electron-process attribution includes Codex application JS, libraries, state and
native allocations. It is NOT intrinsic framework overhead or automatically
unnecessary memory. Three renderers for one window is not by itself a leak.
Logical agent sessions share GUI costs; do not multiply the entire GUI footprint
by the number of agents.

RSS sums in these same snapshots are 1677.64/1629.81 MiB, not unique physical RAM.
Footprint, RSS, V8 and Blink counters are different accounting views; they cannot
be added or subtracted as disjoint allocation categories.

## 3. Valid opt3-only internal diagnostic and cache effectiveness gap

Recheck warms verified unmodified binaries before identically instrumenting
owned temporary copies. Both warmups succeeded. Instrumented opt3 reached routes
and produced five complete primary heap/DOM probes. Instrumented original did
not reach routes; its reduced memory is excluded from comparison. The recheck
workflow correctly reports FAILURE for a complete matched internal comparison.
It is not reported as fully passing CI. This does not change the separate valid
stock A/B data above.

One valid opt3-only probe at about 51.94s, while visible:

| Metric | Value |
| --- | ---: |
| Main used V8 heap | 55.25 MiB |
| Primary renderer used V8 heap | 109.34 MiB |
| Auxiliary webview used V8 heap | 3.48 MiB |
| Primary renderer Blink allocated objects | 4.41 MiB |
| Primary renderer Blink total allocation | 6.51 MiB |
| Primary document element count | 308 |

This is single-run diagnostic data, not a matched original comparison or a stock
footprint breakdown. A small DOM does not imply small application/runtime memory.
There is no identified unreachable-object count or proven reclaimable-byte total.

Every observed renderer reports `webFrame.getResourceUsage` unavailable. This is
not zero unused cache. The planned cache-clear probe phases report no actual
cache-clear attempt; their names do not indicate successful reclamation.

The shipped product preload calls `getResourceUsage()` before `clearCache()`.
A control-flow reproduction using exact blob
`697e4c83bfae75ed323e5ca8d0b66d8bff01ca7c` with a stub matching that unavailable API
returns `released=false, unusedSize=null, sizeDelta=null`, with **zero clearCache
calls**. Thus this optional cleanup path cannot reclaim cache in that API context.
The test reproduces the control flow, not live RAM reclamation. Feature flags and
preload-ready counters are insufficient evidence of effect. A capability check
alone would not fix reclamation; use a supported path without disabling sandbox
or context isolation and verify its actual effect.

## 4. Shutdown and measurement correctness

All six measured stock GUI runs accepted NSRunningApplication.terminate(), exited
the root, and had zero known survivors/unknown live identities after five seconds.
That is a normal application termination request, not an actual keyboard Cmd-Q.
Only observed UID/PID/start identities were checked. No MCP/agent jobs were active;
this does not prove universal cleanup of arbitrary tools or escaped descendants.

Old native CPU percentages are deliberately excluded: proc_pid_rusage values were
raw Mach ticks mislabeled nanoseconds. Correct conversion requires measured
mach_timebase_info, not a guessed constant. The recheck retains raw-tick names
and omits these rates. Memory bytes and internal elapsed-ms markers are unaffected.
Electron-provided CPU metrics are a separate instrumented measurement.

Metric/capability guards passed 11 Python and 4 Node regression tests. Those tests
were rerun locally from the exact source snapshot downloaded from the recheck CI.
Native matched-probe incompleteness remains a failure, not a test waived to green.

## Next engineering targets, not implemented by this audit

1. Main/renderer allocation retainers and eager module/service initialization.
2. Explicit unsupported-cache reporting and a measured, supported reclamation path.
3. Identify the two smaller renderer owners before lazy initialization/disposal;
   preserve authentication, isolation and active work.
4. Authenticated completed-workload comparison for long-session retention and
   agent throughput. No 500–900 MiB/agent or 1 GiB hard-cap claim is made.

# Original versus opt2: speed and process-lifecycle audit

## Provenance and boundaries

Measured 2026-09-20 on GitHub Actions macOS 26.6.2 (25G83), ARM64,
7,516,192,768 bytes (7 GiB) RAM reported by `hw.memsize`.

- Repository: Topabaem05/codex-desktop-linux.
- Diagnostic branch: `bench/opt2-ab-lifecycle`.
- Tested diagnostic code: `2a4218d2aafc2fc48e67859e1297d9cbb27402df`.
- Successful observation run: `35505699481`; job: `106065024720`.
- Evidence artifact: `10604245491`, archive SHA-256:
  `ac6bea08b516c59dad16dd8b142464287463347b737948d15102e7f0b7470ad3`.
- Original: audited 26.915.31945 DMG, SHA-256
  `f4bc8e95f921f45c3f1d1891ead21eafdbe8e40612eb34cf0be173988c1996dd`.
- Optimized: exact shipped opt2 artifact `10603397258`; DMG SHA-256
  `f5f9d06e99dae41a6689a8be0e9c335deb25cd067dfc343ddc7eaee540cc1149`.
- Product branch remains `288a1928a9bf82746bf75ef2c2710ca4ff4e821b`.
  Neither the DMG nor product runtime was changed for this audit.

All reported native numbers come from downloaded `startup.json` and
`lifecycle.json`; queue numbers come from `queue.json`. Archive and DMG
hashes are verified before execution. There are no model turns, account
credentials or user projects in these tests. Native MCP tests directly invoke
the actual bundled Rust app-server and the shipped metadata preparation policy;
they are not authenticated, end-to-end GUI agent tests.

The audit workflow completed successfully. **That does not mean all cleanup
cases passed:** cleanup failures are measurement results, intentionally preserved.
Positive-control and measurement failures would fail the workflow.

## 1. Startup: no demonstrated overall speed improvement

Three launches per version on the same runner, ordered original/opt2/opt2/
original/original/opt2. Codex and browser profiles are disposable; clean runner
native HOME/XPC is retained. The operating-system file cache is not purged.
Every launch reported optional primary-runtime downloading. These are first-run
startup observations, not fully warmed, offline, steady-state performance tests.

| Metric: median of 3 | Original | opt2 | Descriptive difference |
| --- | ---: | ---: | ---: |
| First ordinary window, external elapsed time | 3461.19 ms | 3880.49 ms | opt2 +12.1% time |
| Renderer routes mounted, source-reported elapsed time | 3420 ms | 6047 ms | opt2 +76.8% time |
| App-tree footprint at 10 seconds | 780.75 MiB | 706.09 MiB | -9.6% |
| App-tree footprint at 20 seconds | 908.99 MiB | 894.19 MiB | -1.6% |
| App-tree footprint at 25 seconds | 868.10 MiB | 893.55 MiB | +2.9% |

The external window time and internal route marker use different start clocks;
do not subtract them. A window appearing is not interactive/task readiness.
With only three runs and network-driven installation, these ratios do not prove
causal regressions from a particular optimization. They do show that claiming
opt2 starts faster or always uses less RAM is unsupported by this experiment.
Slower progress through startup can itself lower an early footprint sample.

All six final trials observed the primary UI milestone. Each opt2 trial also
reported ready=true, safeMode=false, uiApplied=2, preloadReady=2, lastError=null.
Earlier attempts with a fully replaced native HOME and a window-only gate did
not obtain valid matched opt2 observations and are excluded, not averaged in.
Both applications launched in the revised environment without product changes.

SIGTERM of the GUI root left 2 tracked PIDs for original and 3 for opt2 at five
seconds, with no unknown probe identities. Their roles and eventual exit were
not traced; this is not proof that every remaining GUI PID is a runaway, nor is
SIGTERM equivalent to a user's normal Cmd-Q.

## 2. Metadata-session costs: prevention is effective in the fixture

Two independent cooperative-fixture repetitions per version. Each repetition
has one ordinary session as a positive control, then six metadata sessions
cycling summary/title/description. Each configured MCP has one worker child.

| Measurement after 6 metadata sessions and 5s after unsubscribe | Original | opt2 |
| --- | ---: | ---: |
| Additional MCP server startup records, per repetition | 24 | 0 |
| Live fixture server/worker PIDs, baseline to final | 4 -> 28 | 4 -> 4 |
| Loaded session IDs after unsubscribe | 7 | 7 |
| App-server plus descendant footprint, two-repetition median | 355.23 MiB | 75.79 MiB |
| Metadata RPC sequence, median of 12 sequences | 178.36 ms | 19.14 ms |

The measured RPC sequence includes configuration preparation for opt2,
thread/start, mcpServerStatus/list and unsubscribe, but no model generation.
The ratio is 9.32x for this limited local fixture path (89.3% less elapsed time),
**not a 9.32x faster coding agent**. The footprint excludes the GUI and real
browser/build workloads; it is not per-agent production memory.

Startup records and simultaneously live PIDs are different metrics. Some test
launchers finish before the liveness snapshot. Loaded session count remained
seven for both versions: this is prevention of extra MCP startup, not immediate
session destruction. A five-second observation cannot establish an infinite
leak or test a thirty-minute inactivity unload policy.

## 3. Automatic cleanup: stubborn descendants still survive

All counts below are taken **before** harness cleanup. Fixture PIDs are tracked
by UID + PID + native start identity, even after reparenting. Unknown live
identities were zero in these observations. Zombies are excluded from live
fixture counts.

| Fixture and root shutdown | Original live at +5s | opt2 live at +5s |
| --- | ---: | ---: |
| Cooperative; app-server stdin EOF | 0 (both repetitions) | 0 (both repetitions) |
| Cooperative; app-server root SIGKILL | 0 | 0 |
| Ignores EOF/SIGTERM; app-server stdin EOF | 4 | 2 |
| Ignores EOF/SIGTERM; app-server root SIGKILL | 8 | 4 |

All app-server roots exited. Four of ten cases had automaticCleanupPass=false:
stubborn fixtures after EOF/crash, for both versions. Opt2 creates fewer
unnecessary trees but does not add a general macOS process-tree reaper.

Cooperative fixtures deliberately exit when their input pipe closes and stop
their worker. Success therefore demonstrates the combined backend/fixture
lifecycle, not an independent supervisor capable of cleaning every child.
After each observation the test harness explicitly kills remaining owned test
processes. Those kills are not counted as product cleanup. This tests bounded
simulated stubborn processes, not a real unbounded fork bomb or every third-party
MCP, browser, node_repl, PTY, detached build daemon or CPU-bound infinite loop.

## 4. Streaming queue: fewer updates, a latency tradeoff

Exact original and patched bundled JavaScript is replayed with simulated 16ms
frames and 50-Hz input, for one and three streams. This is not a React/GPU/FPS,
real-time CPU or cloud-token benchmark. All eight cases preserve text/order.

| Per-stream input | Original update callbacks | opt2 callbacks | Initial simulated display |
| --- | ---: | ---: | --- |
| 400 UTF-16 units/s | 500 | 125 | 16ms -> 75ms |
| 4000 UTF-16 units/s | 631 | 125 | 16ms -> 75ms |

In the three-stream burst case peak retained queue length changes from 75,144
to 960 UTF-16 units and completion-drain delay from 116ms to 0ms. The normal
low-rate case instead retains a slightly larger batch. Lower callback count
must not be reported as an equivalent application speedup.

## Verdict and next targets

- Verified: no additional MCP startup in the controlled metadata path, lower
  fixture costs, and fewer display callbacks without text loss.
- Not verified: overall faster application, faster cloud/model output, full
  cleanup of runaway descendants, 500-900 MiB per active agent or a 1 GiB cap.
- Observed limitation: stubborn descendants survive in both versions; opt2 is
  a prevention/retention optimization, not a complete macOS orphan supervisor.
- Next engineering priorities: owner-aware process-tree teardown that preserves
  legitimate jobs; first visible chunk immediate with subsequent adaptive
  batching; matched warmed-cache ablations of heap cap, observer and highlight
  concurrency. Keep those changes separate from this observation-only branch.

# Optimization v3 — final rerun and downloadable artifact

This supersedes the artifact identity in 2026-09-20-optimization-v3.md, which
remains the record of the first successful run. Runtime code is unchanged from
4f1c903; the final build at 1ae94d7 includes test and documentation clarification.

## Completed verification

- Repository: Topabaem05/codex-desktop-linux.
- Branch: feat/cross-platform-memory-budget; main remains 1ef0ece.
- Tested build commit: 1ae94d7a0381ca15386552418b3c5a5d7de7415b.
- DMG and portable CI run: 35508753340; both jobs passed.
- Shared memory CI at that commit: 35508753327; success.
- macOS Python: 30 passed, no failures.
- macOS Node: 61 passed, no failures/skips.
- Local Linux: 30 Python passed; 60 Node passed with 1 Mac-only skip;
  31 existing feature-framework regressions passed.
- Exact patched bundle syntax and stream/inactivity contracts passed.
- Normal and safe-mode actual application launches passed.
- Actual Rust MCP metadata conformance and guardian controls passed.
- DMG creation, checksum, read-only remount, ASAR integrity and signature passed.
- Final evidence ZIP artifact 10604678609; ZIP digest
  5cd45dc2d0593362d68d58ed88a72925225764a06fb72a2f359e6743030cdd7d.

## Actual Rust backend cleanup, before any harness cleanup

| Stubborn fixture | Live before shutdown | Live at +5s |
| --- | ---: | ---: |
| Unguarded, app-server stdin EOF | 4 | 2 |
| Unguarded, app-server root SIGKILL | 3 | 3 |
| Guarded, app-server stdin EOF | 4 | 0 |
| Guarded, app-server root SIGKILL | 4 | 0 |

UID/PID/native start identities are verified; unknown live identities fail.
Mere unsubscribe did not terminate live transports. Six metadata sessions still
created zero additional MCP startup records (12 disabled-server decisions,
zero config preparation failures). No model turns or account credentials used.
Both this run and the earlier successful run observed zero guarded survivors.
This is actual backend/config transport testing, not authenticated GUI agent
execution or normal GUI Cmd-Q testing.

Local three-group fixture additionally observed live counts [4,4,4], then [0,4,4]
after closing only the first owner, and [0,0,0] after closing the other owners.
This tests independence on Linux, not macOS workload performance.

## Startup experiment: variability is material

Each runner completed four mode-specific warmups and eight counterbalanced starts.
Table entries are route-mounted time / app-tree footprint at 20s, median of TWO
measured starts per mode in each run. Do not pool the runners as matched samples.
Every measured start still reported optional runtime installation/download work.

| Mode | Earlier successful runner | Final runner |
| --- | --- | --- |
| Default | 3973.5ms / 882.00MiB | 5859.0ms / 928.11MiB |
| No V8 old-space cap | 3102.0ms / 1009.57MiB | 4632.0ms / 897.66MiB |
| No observer | 3685.0ms / 900.50MiB | 4799.5ms / 914.27MiB |
| Four highlighting workers | 3754.5ms / 878.44MiB | 4461.0ms / 857.58MiB |

Removing the old-space cap coincides with shorter route mounting in both runs,
but memory changes reverse sign between runners. There is no established causal
whole-app speedup, agent throughput result, or reproducible peak memory estimate.
The default remains the memory-conservative experiment; launch-local no-heap,
no-observer and upstream-highlight switches allow further controlled testing.
A 512MiB old-space setting is not a whole-app cap. Highlight ablation changes
workers only, retaining the tuned AST cache.

## First text and cleanup boundaries

First nonempty stream chunks now bypass the 75ms batching wait; later chunks
retain batching, size flush and completion barriers. Eight local exact-bundle
replays preserve text/order with 0 added initial queue delay. This is not model
latency, visible screen latency, FPS or token-generation speed.

Only newly wrapped explicitly configured local stdio MCP process groups are
covered. No global cleanup of old/unwrapped node_repl, browser, builds, remote
MCP or deliberately escaped groups. KILL of the isolated supervisor itself is
not covered. Each wrapped transport adds two small C processes; production
aggregate overhead is unmeasured. There is no idle/infinite-loop detector or
non-destructive immediate thread-unload RPC. Long legitimate work is not killed
merely because a session is idle or unsubscribed. No user config files, security
permissions or Rust engine implementation are changed.

## Final download

- GitHub Actions run: 35508753340.
- DMG artifact: 10604633755; ZIP size 669608227 bytes.
- File: Codex-Community-26.915.31945-arm64-opt3-dev.dmg.
- DMG bytes: 669607793.
- DMG SHA-256: 8314e2a94c886c019bd543ab5649c165ce641ebbc05b1199c3946ce58099df7c.
- Apple Silicon / macOS13+ development copy, ad-hoc signed and not notarized.
- Original Keychain/APNs/Computer Use compatibility limits remain.
- Artifacts expire 2026-09-27 under the configured seven-day policy.

Keep the official app as fallback and do not run both copies together. Fully
quit before replacing the Community app. Safe mode is available with
`open -a '/Applications/Codex Community.app' --args --community-safe-mode`.

No claim of 500–900MiB per active agent, 1GiB hard ceiling, universal runaway
cleanup, or original-versus-opt3 authenticated workload speedup is made.

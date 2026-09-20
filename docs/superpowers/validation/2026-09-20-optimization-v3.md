# Optimization v3 verification — 2026-09-20

## Artifact identity and scope

- Product repository: Topabaem05/codex-desktop-linux.
- Branch: feat/cross-platform-memory-budget. No main merge or force push.
- Runtime/build code: 4f1c90340b2de2ed6e5d159ce0a908e3368ab8f0.
- macOS DMG / Ubuntu portable CI: 35508052195, both jobs passed.
- Evidence artifact: 10604418211; DMG artifact: 10604338417.
- Shared Node22/24 macOS/Linux observer/cgroup CI: 35507557347, five jobs passed
  at 8011c46. Later runtime changes only affect the new MCP guardian.
- Original input: version 26.915.31945, SHA-256
  f4bc8e95f921f45c3f1d1891ead21eafdbe8e40612eb34cf0be173988c1996dd.

Numbers below were read from the downloaded CI evidence, not estimated.

## Priority 1 — owned local stdio MCP cleanup

A backend-facing C launcher and separate C lifetime supervisor wrap only explicit
local stdio MCP transports. They retain argument/environment/cwd/protocol contracts.
On transport closure, owner exit, or termination, the supervisor tears down only
its command's dedicated process group, even if the backend KILLs the direct launcher.
The child leader remains unreaped until group signaling finishes to reserve its
identity. Darwin uses kqueue EV_EOF to see closure despite a blocked input relay.
Two initial CI failures (blocked-input detection and direct-launcher lifetime)
were reproduced and fixed; the actual backend gate was not relaxed.

Actual bundled Rust backend, one controlled stubborn MCP plus worker configuration:

| Wrapper | Shutdown | Tracked fixture processes before | Live fixture survivors at +5s |
| --- | --- | ---: | ---: |
| Disabled control | app-server stdin EOF | 3 | 1 |
| Disabled control | app-server SIGKILL | 3 | 3 |
| Enabled | app-server stdin EOF | 4 | 0 |
| Enabled | app-server SIGKILL | 4 | 0 |

These counts precede all harness cleanup. UID/PID/native start identities are
checked, missing live identities fail the test, and zombies are not counted as
live. Controls start with different transient process counts: this is not an
exactly matched process-count reduction percentage. Mere unsubscribe left active
transports alive as intended. No credentials or model turns were used. This tests
actual backend transport/config behavior, not authenticated GUI task execution.

Metadata prevention is retained: six internal metadata sessions started zero
additional MCP servers, with twelve request-local disable decisions and no config
preparation failures.

Coverage excludes deliberately escaped process groups, SIGKILL of the isolated
supervisor itself, old unwrapped processes, general node_repl/browser/build daemons,
remote MCP and every plugin. It is not a sandbox, fork-bomb defense or global
memory cap. CODEX_COMMUNITY_MCP_KEEPALIVE bypasses our wrapper, not upstream's
existing lifetime control. There are two extra small C processes per wrapped
transport; their real-workload aggregate overhead has not been benchmarked.

## Priority 2 — startup ablations, not an overall speed claim

The same signed opt3 app was launched in four modes. Each has one warmup, then two
counterbalanced measured launches with its profile reused. All twelve observations
completed. These are within-build unauthenticated startup experiments; no new
original-versus-opt3 comparison or coding-agent workload was performed.

| Mode | Primary ready marker median | Routes-mounted median | App-tree footprint at 20s median |
| --- | ---: | ---: | ---: |
| Default | 378.5ms | 3973.5ms | 882.00MiB |
| No 512MiB old-space flag | 371.5ms | 3102.0ms | 1009.57MiB |
| No observer | 324.5ms | 3685.0ms | 900.50MiB |
| Four highlight workers | 343.0ms | 3754.5ms | 878.44MiB |

Only two measured samples per mode, and every one still reported optional primary
runtime installation/download activity. The no-heap samples ranged from about
904.5 to 1114.6MiB. These descriptive numbers cannot establish causal speedups.
The primary marker and route marker are internal milestones, not external
interactive readiness. The highlight ablation changes workers only, retaining
the tuned AST cache. Defaults remain unchanged pending stronger evidence.

Launch-only CODEX_COMMUNITY_ABLATION accepts none, no-heap, no-observer or
upstream-highlight; unknown values fail. Actual status confirms selected mode,
heap cap removal and observer disabling. Safe mode disables added tuning for new
requests. A 512MiB V8 old-space budget is not a whole-app limit.

## Priority 3 — first text

Actual digest-verified patched queue contracts pass: first nonempty chunk per
recent stream key is delivered synchronously, subsequent deltas retain 75ms
batching, oversized retained batches flush, completion preserves text/order.
The recent-key set is bounded at 256. Local exact original/patched replay covers
one/three streams in eight scenarios with no loss, and observes 0 added initial
queue delay versus the original simulated 16ms frame. Opt2 had a 75ms initial
queue delay in the prior audit. This is not a network, model-token or screen-FPS
measurement and does not imply instantaneous visible response.

## Test and package gates

At the verified runtime commit, macOS CI passed 29 Python tests and all 61 Node
tests with no skips/failures. Ubuntu portable passed. Normal and safe application
boots passed, followed by DMG creation, checksum verification, read-only remount,
ASAR hash and code-signature checks. Local prior framework regression tests passed
31 cases. Review was inline; no independent reviewer was available.

A subsequent local repeated run exposed a test-contract issue: the 1MiB relay
completed all bytes but sometimes exceeded the test-only 150ms exit grace, exiting
143. The production default is 1000ms. The relay/normal-exit test now uses that
unchanged production default, and a separate deterministic test demonstrates
termination under the short deadline versus successful cooperative drain under
the default. Stubborn-process cleanup gates remain unchanged. This follow-up
changes tests/documentation only, not the verified runtime or DMG contents.

## Output

- File: Codex-Community-26.915.31945-arm64-opt3-dev.dmg.
- Bytes: 675084068.
- SHA-256: 552108faa0f0bb55c38c60b5db29b9980e9199b9200e0bfda34194414e581e43.
- Apple Silicon/macOS13+ development copy, ad-hoc signed, not notarized.
- Original Keychain/APNs/Computer Use limitations still apply.
- No 500–900MiB per active agent, 1GiB hard-cap, authenticated performance or
  universal runaway-process cleanup claim is made.

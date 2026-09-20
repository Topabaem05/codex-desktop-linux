# Optimization v2 verification — 2026-09-20

## Identity and scope
- Repository: Topabaem05/codex-desktop-linux.
- Branch: feat/cross-platform-memory-budget. Main was not changed or merged.
- Runtime/build code: 92f321c2a9eb93c1fa3b4efd57fb07a6b3f19ff0.
- DMG/CLI CI: https://github.com/Topabaem05/codex-desktop-linux/actions/runs/35504255307
- Shared memory CI: https://github.com/Topabaem05/codex-desktop-linux/actions/runs/35503871612
- DMG artifact: 10603397258. Evidence artifact: 10603725923.

## Results read from the downloaded CI evidence
- Python: 18 passed, no failures.
- macOS Node tests: 56 passed, no failures or skips.
- Local Linux Node: 55 passed, one macOS-specific skip.
- Local existing feature framework: 31 passed.
- Five digest-pinned upstream bundles patched with 14 verified edits.
- Real transformed text queue preserves Unicode, oversized chunks and completion order.
- Inactive release rechecks active view, active turn, approval and follower protections.
- Native observer compiles and normal smoke observes exactly one persistent helper.
- Actual application boots pass in normal mode and safe mode.
- DMG creation, checksum verification, read-only remount and signature checks pass.
- Shared memory CI: Ubuntu/macOS with Node 22/24 plus isolated Linux cgroup test,
  five successful jobs. This ran at 59e1481; following code changes were Mac MCP-only.

## Bundled Rust backend conformance
Two sentinel MCP servers were configured in disposable HOME/CODEX_HOME. No account
credentials were supplied and no model turn was requested. Backend connection
prewarming may attempt unauthenticated network connections; this is not an
entirely network-free execution.

| Measurement | Result |
| --- | ---: |
| Ordinary-session positive-control startup records | 4 |
| Unoptimized metadata control additional startup records | 4 |
| Optimized metadata sessions | 6 |
| Optimized additional MCP startup records | 0 |
| Request-local server disable decisions | 12 |
| Configuration preparation failures | 0 |

Startup records are not a count of simultaneously resident processes. The test
exercises thread/start, configuration read and unsubscribe, not authenticated
summary generation, actual model turns or an immediate thread destruction API.

## Smoke accounting, not a performance benchmark
Normal-mode second sample: 739574976 bytes physical-footprint sum across 13
processes; one observer contributes 1049408 bytes. This is about 705 MiB for the
whole observed app tree at this point, not per-agent usage, a peak or a reduction
versus the prior DMG. There were two renderers in this sample. No matched A/B or
1/3-agent long-session test was run. Safe mode reports no observer samples and
no added CSS applications. Requested-feature flags describe configuration, not
proof of every path being exercised in an empty unauthenticated UI.

## Output
- File: Codex-Community-26.915.31945-arm64-opt2-dev.dmg
- Bytes: 682919168
- SHA-256: f5f9d06e99dae41a6689a8be0e9c335deb25cd067dfc343ddc7eaee540cc1149
- Apple Silicon/macOS 13+ development copy; ad-hoc signing, not notarized.
- Original signing/Keychain/APNs/Computer Use limitations still apply.

## Explicit remaining work
Global heavy-tool admission inside the Rust engine, shared stateful MCP pooling,
non-destructive immediate thread unload, and authenticated performance testing
are not implemented/verified here. The 500–900 MiB target and macOS 1 GiB hard cap
are not claimed. Review was inline; no independent code reviewer was available.

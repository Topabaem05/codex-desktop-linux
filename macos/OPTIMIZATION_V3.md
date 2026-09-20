# Optimization revision 3

Development-only Apple Silicon/macOS 13+ copy. This builds on opt2; the original
app, Rust engine and user configuration files are not replaced. Ad-hoc signing,
no notarization, and original Keychain/APNs/Computer Use limitations still apply.
Read [中文说明](OPTIMIZATION_V3.zh-CN.md).

## Owned stdio MCP lifetimes

Enabled local stdio MCP configurations are wrapped at audited thread start,
resume and fork request boundaries. Arguments, environment and working directory
are retained. Remote app servers, HTTP MCP, disabled entries, metadata-only
requests and safe mode are not wrapped. Tool-free metadata requests still skip
unneeded MCP startup. Existing transports are not retroactively changed.

The native wrapper uses two small C processes: a backend-facing launcher and an
isolated lifetime supervisor. The supervisor survives a direct launcher KILL and
creates a dedicated session/process group for the command,
relays stdin with a fixed 64 KiB buffer, and inherits stdout/stderr. Closing the
transport, exiting its parent, terminating the guardian, or command exit starts
teardown: close input, allow a 1-second grace, TERM the owned group, wait 1 second,
then KILL remaining group members. The leader is not reaped before signaling;
this keeps its PID/group identity reserved. Full-buffer hangup is detected, and
queued input is allowed to drain during a bounded grace interval. A child that
never reads cannot be promised delivery of pending input after shutdown.

Mere unsubscribe/idle does not close a still-active transport. There is no new
immediate-unload RPC. Session caches and native backend expiry still apply.
No name-based process scanning or whole-user kills are used. This does not cover
children which deliberately leave the process group, the isolated supervisor itself killed by KILL,
old unwrapped processes, shell/build daemons, every plugin or a fork bomb.

For an intentionally persistent configured server, explicitly opt out in that
server's environment table (the application never writes this for you):

```toml
[mcp_servers.my_server.env]
CODEX_COMMUNITY_MCP_KEEPALIVE = "1"
```

The keepalive flag bypasses only Community wrapping; upstream still controls its
own child lifetimes.

Configuration ambiguity or an unavailable guardian falls back to the original
request and records a sanitized failure/skip counter. Counts in status.json are
wrapping decisions, not proof that each descendant exited. The native tests
measure live survivors before any fixture cleanup and keep unguarded controls.

## First text and controlled startup experiments

The first nonempty chunk for a stream key is delivered immediately. Subsequent
chunks retain 75ms batching, large-buffer flushing and completion barriers. A
256-key bounded history prevents the optimization itself retaining all streams.
This removes the batching delay, not network/model or rendering latency.

Defaults remain 512 MiB V8 old-space, the persistent observer and two syntax
workers. The following environment variable is a launch-local diagnostic switch;
fully quit the app first. Use the executable directly so the environment applies:

```bash
CODEX_COMMUNITY_ABLATION=no-heap \
  '/Applications/Codex Community.app/Contents/MacOS/CodexCommunity'
```

Values: `none` (default), `no-heap` (omit the old-space flag), `no-observer`
(disable memory sampling, keep other tuning), `upstream-highlight` (four syntax
workers; AST entry limit remains tuned). Unknown values are rejected. Status
reports the selected ablation and observed heap limit. Safe mode bypasses all
added tuning/guard wrapping for new requests:

```bash
open -a '/Applications/Codex Community.app' --args --community-safe-mode
```

The build runs four profile warmups plus eight counterbalanced measured starts,
then writes startup-ablation.json. Only two measured trials per variant; optional
runtime downloads are recorded. This is not a matched original-app, coding-agent,
8GB workload or authenticated performance benchmark. Do not turn n=2 medians into
causal speedup claims. No whole-app/per-agent 1GiB memory cap is provided.

## Build and verification

```bash
python3 -m unittest discover -s macos/tests -p 'test_*.py'
node --test macos/tests/*.test.cjs linux-features/low-memory-budget/test.js
sh macos/build-dmg.sh
```

macOS CI additionally compiles native observers, runs the actual bundled Rust
backend with cooperative/stubborn fixtures, checks both normal and safe app boot,
and validates signatures and a remounted DMG. Output name ends `arm64-opt3-dev.dmg`.
Read the CI artifacts for actual results; this document describes release gates,
not a claim that a particular run or workload has already passed.

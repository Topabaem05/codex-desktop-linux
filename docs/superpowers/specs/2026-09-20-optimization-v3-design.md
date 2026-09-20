# Optimization v3: ownership-first resource handling

User-approved priority: MCP descendant cleanup, startup ablations, then first-text latency.
Base: product 288a192; unchanged upstream 26.915.31945 and Rust engine.

## P1: stdio lifetime guardian
Wrap enabled, user-configured local stdio MCP commands in a native C guardian;
retain arguments, environment, working directory and protocol bytes. Never wrap
HTTP transports, remote app servers, disabled entries, or explicitly opted-out
servers. Do not modify configuration on disk, approvals, sandbox or credentials.
Create a dedicated child session/process group. A parent-owned pipe EOF, guardian
termination signal, command exit or guardian-parent exit starts bounded teardown:
close input, allow a grace interval, SIGTERM the owned group, then SIGKILL only
that group. Keep the command leader unreaped until group teardown is complete,
so its PID/process-group number cannot be reused before signaling. The relay
retains at most 64 KiB. Never scan by process name or kill other user processes.

Boundary: process groups are lifetime ownership, not a security sandbox. Children
which deliberately setsid/setpgid away, kill the guardian itself, or never get
wrapped are not covered. A running conversation is not killed on idle or merely
unsubscribing. Intentionally persistent servers opt out via their configured environment. This is
not a global orphan reaper, per-turn timeout, fork-bomb defense or memory cap.

## P2: attributable startup experiments
Keep a stable product default while exposing launch-local heap, observer and
highlight-worker ablation controls. Compare counterbalanced repeated starts in
the same CI runner with a warm-up, common milestones, version/flags and runtime
download activity recorded. Do not label reduced early initialization as memory
savings or claim authenticated task speed. Do not change OS security settings.

## P3: first text
Deliver the first nonempty chunk of each bounded recent stream key immediately;
keep subsequent 75ms batching, size flush and completion barriers. Bound recent
key retention to 256. Safe mode restores upstream behavior. Actual bundle queue
replay must prove lossless Unicode/order, completion, concurrent streams and
bounded key history. This measures callback behavior, not display FPS.

## Release gates
Native guardian tests on Linux/macOS, positive-control unguarded survivors,
guarded EOF/TERM/root-crash cases, unrelated-live-job protection and binary relay;
actual bundled Rust MCP conformance; exact patched bundle contract tests; normal
and safe app smoke; codesign, DMG mount/hash checks. Report unmet boundaries.
Cooperative EOF preserves queued protocol bytes; a blocked child receives only a bounded drain grace. Missing guardian/config ambiguity fails
back to original launch and increments a bounded diagnostic, never silently
claiming cleanup is covered. Remote host detection must be explicit.

# macOS optimization v2

## Approved goal
Continue the user's ordered optimization proposal on feat/cross-platform-memory-budget,
verify with CLI and native macOS CI, commit and push. Keep the working DMG recoverable.
500–900 MiB is a workload target, NOT a measured guarantee or a macOS hard cap.

## Architecture and decisions
1. Measure native physical footprint by process role, including shared costs exactly once.
   A single persistent read-only C helper replaces repeated snapshot launches. No argv,
   prompts, credentials, paths or source content in telemetry. Unknown stays unknown.
2. For an explicit allowlist of tool-free ephemeral metadata requests, read effective
   config and disable inherited MCP servers for that request only. Preserve approval,
   auth lifetime, user/side-chat sessions, remote behavior and supported unsubscribe.
   No deletion/archive masquerading as memory reclamation. The pinned backend lacks
   an immediate public unload endpoint: do not invent one or kill its live children.
3. Tune EXISTING upstream inactive-history release and virtualization/cache machinery,
   rather than adding a second virtualizer or removing React-owned DOM.
4. Tune EXISTING lossless delta queue scheduling, retaining terminal/control flushes.
5. Bound display/highlighter work; do not truncate model context or monkeypatch process
   spawning. A global in-agent build scheduler needs a supported Rust execution hook;
   report that boundary explicitly rather than falsely marking it integrated.
6. Async coalesced status writes, same-document navigation preservation, and cache
   effect feedback. No blanket GC, no low heap experiment, no process-name kill.

## Safety and compatibility
Mac-specific integration stays under macos/. Linux feature defaults and Rust backend
payload stay unchanged. Upstream SHA/signature and semantic unique-anchor checks are
required. Safe mode must restore original upstream policies, not only CSS.
Ad-hoc signing restrictions from the prior build remain. No cloud credentials in CI.

## Release evidence
Portable regression tests; current pinned ASAR patch/idempotency/drift checks; actual
bundled app-server MCP sentinel test; native helper stream and process exit tests;
actual unauthenticated app boot and DMG verification. Full authenticated 1/3-agent
soak testing remains separate and is never inferred from a login-screen smoke.

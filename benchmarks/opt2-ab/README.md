# Original versus shipped opt2 audit

Diagnostic-only branch; does not change the app, runtime settings or previous DMG.

- Inputs: audited original 26.915.31945 DMG and the exact opt2 artifact 10603397258.
  Both archive and extracted DMG hashes are checked before execution.
- Startup: original/opt2/opt2/original/original/opt2 on the same macOS runner.
  Each GUI starts with disposable CODEX_HOME and Chromium user data while retaining
  the clean runner native HOME/XPC environment, matching the validated app smoke.
  Source-reported primary-window and renderer milestones are recorded separately;
  CoreGraphics window timing is optional and is NOT interactive readiness.
  No purge of OS disk caches. Footprints are sampled at 1, 5, 10, 20 and 25 seconds.
  Optional runtime downloading and missing milestones are reported, not counted
  as a speedup. Native lifecycle tests run before the independent GUI trials. SIGTERM
  is NOT a UI Cmd-Q test. Three repetitions are descriptive, not statistical proof.
- Native MCP: two bounded fixture servers, one child each, at most six metadata
  sessions per case. Positive controls must start servers. Comparisons use the
  exact shipped backend and the current request-local metadata policy directly.
  No model turn or account login; unauthenticated prewarming/network may occur.
- Teardown: count identity-checked survivors BEFORE harness cleanup, including
  reparented fixture children. Cooperative and EOF/SIGTERM-ignoring fixtures are
  separately tested. Crashes kill only the test-owned app-server root, not its tree.
  The harness never interprets its own final SIGKILL as product cleanup success.
- A five-second post-unsubscribe observation does NOT verify the documented
  thirty-minute unload timer or prove an infinite leak. Loaded threads are counted.
- The exact queue replay uses simulated 16-ms frames and 50-Hz input. It measures
  update calls/buffer lengths/ordering; it is NOT an end-to-end speed or FPS test.

CI stays green when the measurement completes even if `automaticCleanupPass` is
false; inspect lifecycle.json. Positive-control/measurement failures fail CI.

Run with an artifact-read GitHub token in GH_TOKEN on a disposable Mac account:
`python3 benchmarks/opt2-ab/run.py`. Never use an account with active Codex work.
No user project is modified; artifacts contain metrics/fixture evidence and bounded
error logs from the disposable, unauthenticated test environment, never auth tokens.

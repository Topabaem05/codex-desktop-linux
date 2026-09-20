# Optimization v3 Implementation Plan

> Execution: inline using executing-plans; user requested implementation in priority order.

**Goal:** Recover owned MCP process groups without harming unrelated tasks, isolate startup cost, remove initial batching delay.
**Architecture:** Native stdio guardian + request-local config adapter; existing digest-pinned ASAR patch framework; per-launch ablation flags.
**Tech Stack:** C11/POSIX, Node 22, Python 3, macOS Actions.
**Spec:** ../specs/2026-09-20-optimization-v3-design.md

## Constraints and review focus
No user-config mutation or broad kills; preserve stdout/argv/environment/cwd; retain
leader PID until cleanup; exclude remote transports and explicit keepalive environment flags;
never make missing observations zero; safe-mode bypass for every new behavior.

- [x] P1: write native fixture tests in macos/tests/test_guardian.py, observe missing guardian failure, implement macos/native/mcp-guardian.c, run EOF/TERM/parent-crash and unrelated survivor tests. Compile with `cc -std=c11 -Wall -Wextra -Werror -O2`.
- [x] P1 integration: test request-local wrapping in guardian-policy.test.cjs, implement guardian-policy.cjs using existing TOML normalization, guard local stdio transport only, patch audited startThread/resumeThread contracts. Re-run real bundled Rust tests through the compiled guardian in CI.
- [x] P2: add launch-local ablation switches and tests, capture common startup markers and memory under counterbalanced warm runs; report optional runtime download confounds. Keep default tuning until evidence favors a change.
- [x] P3: update actual-bundle test to require first nonempty chunk now, confirm failure against opt2, add bounded key set and synchronous initial flush; repeat 1/3-stream queue tests in normal/safe mode.
- [x] Package: opt3 name, compile/sign guardian, persist dedicated cleanup evidence before test harness cleanup; run portable/native CI and rebuild DMG.
- [x] Review and verify: read complete diff, record native results and limitations, commit/push product branch without changing main.

## Execution ledger

Native Linux guardian red/green reproduced full-buffer EOF failure and fixed HUP
observation without overwriting pending bytes. Real protocol relay, signal/crash
cleanup and unrelated-process protection pass locally. Unknown live fixture
identities are a native-test failure, never assumed exited. Mac runtime CI passed at 4f1c903; see the validation report for exact scope.

Final ruling: a single wrapper can be killed by the backend before cleanup;
use a backend-facing launcher plus an isolated lifetime supervisor. Native backend
EOF/crash controls now prove zero guarded fixture survivors. This does not cover
arbitrary detached processes. Startup defaults stay unchanged because n=2 results
remain confounded by runtime downloads. The production relay test uses its actual
1000ms grace; accelerated cleanup tests keep 150ms. No runtime change is needed
for that test-contract clarification. See ../validation/2026-09-20-optimization-v3.md.

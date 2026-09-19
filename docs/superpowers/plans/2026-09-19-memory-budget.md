# Cross-platform memory budget implementation plan

**Goal:** Deliver testable budget controls and accurate macOS/Linux measurement without modifying signed apps.
**Architecture:** A dependency-free Node toolkit, native macOS observer, explicit Linux cgroup launcher and separate CI.
**Tech Stack:** Node >=22, C/libproc/libdispatch, systemd/cgroup v2, node:test.
**Spec:** ../specs/2026-09-19-memory-budget-design.md

## Global constraints

500–900 MiB is a target; 1024 MiB is an optional Linux domain ceiling.
No hard-limit promise on macOS. No upstream ASAR/macOS signing changes.
No killing arbitrary helpers, modifying auth, truncating RPC or hiding shared costs.

## Review focus

Unknown metrics must never count as zero. Root PID reuse must stop observation.
Large chunks must not retain large backing buffers. Arguments must not go through
a shell. A Linux hard-limit failure must not retry unconstrained.

## Execution

1. Write node:test assertions for policy thresholds, recovery, byte buffers,
   batching and reservations. Observe failure; implement runtime/core.js; rerun.
2. Add real-process and parser assertions. Implement runtime/platform.js and
   native/macos-memory.c; test real Linux children locally and Mac in CI.
3. Test CLI argument preservation and hard-limit refusal. Implement runtime/cli.js,
   Linux hook and feature manifest with opt-in defaults and no ASAR descriptors.
4. Add adjacent README, top-level English/Chinese usage and CI matrix. Run
   `node --test linux-features/low-memory-budget/test.js`; syntax-check JS/shell;
   run `git diff --check`. CI additionally runs native and upstream-framework tests.
5. Review implementation against spec, publish a new feature branch through the
   authorized GitHub connection, verify exact blob hashes and inspect Actions.
   Report actual completed/pending/failed tests; never infer success from a push.

## Local execution note

The container cannot resolve github.com. Files are read through the authorized
GitHub connector. Only this additive component is staged locally; upstream files
are preserved through a Git tree based on the original commit. Full upstream
and macOS checks therefore belong to CI, not a claimed local full checkout.

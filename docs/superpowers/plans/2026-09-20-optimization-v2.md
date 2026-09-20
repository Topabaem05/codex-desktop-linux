# Optimization v2 Implementation Plan

> Execute inline with test-driven development and evidence before completion.

**Goal:** Reduce retained display/process overhead while preserving agent correctness.
**Architecture:** Native observation + scoped request policy + audited ASAR patches.
**Tech Stack:** C/libproc/Dispatch, Node/CommonJS, Python append-only ASAR builder.
**Spec:** ../specs/2026-09-20-optimization-v2-design.md

## Tasks
- [x] 1. Add role grouping, bounded persistent-helper decoder and stream-decoder tests; native streaming is exercised by the app smoke.
- [x] 2. Add allowlisted request-local MCP policy; exercise real bundled server with a sentinel.
- [x] 3. Audit/tune existing retention and highlighting budgets with unique anchors.
- [x] 4. Audit/tune existing delta scheduler, testing ordering and completion flush.
- [x] 5. Budget display work without modifying source/model output; document execution-hook gap.
- [x] 6. Wire async latest-state writer, navigation reset fix and cache-effect feedback.
- [x] 7. Run portable tests, current-bundle patches, native CLI and actual DMG CI; push verified changes.

## Review focus
PID reuse/unknown samples, authentication changes across awaited config read,
quoted MCP names and explicit caller overrides, same-document navigation,
callback cleanup and stream backpressure, shared process accounting, safe-mode
reversibility, active turns/approvals retained, no authenticated benchmark claims.

## Execution evidence
Portable Node/Python tests and actual extracted-bundle queue/race/safe-mode contracts are exercised locally. Native backend and DMG gates are required in CI before reporting success. Task 5 preserves the existing output cap and limits display cadence; global Rust execution admission is explicitly outside this implemented boundary.

## Verified completion
Implementation head: `92f321c2a9eb93c1fa3b4efd57fb07a6b3f19ff0`.
Native DMG/CLI run `35504255307` passed both jobs; Node 56/56 and Python 18/18.
Six optimized ephemeral metadata sessions added zero MCP starts after positive
controls. Normal and safe-mode actual app boots and remounted DMG checks passed.
Common memory CI run `35503871612` passed five jobs at `59e1481`; shared components
were unchanged by the two following MCP-only corrections. Global Rust tool
admission and immediate unload remain outside this implemented boundary.
See ../validation/2026-09-20-optimization-v2.md for evidence and limitations.

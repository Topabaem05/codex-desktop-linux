# Memory-budget work for Linux and macOS

The optional [low-memory-budget toolkit](linux-features/low-memory-budget/README.md)
adds cross-platform measurements, bounded display-state primitives, cooperative
work admission, a Linux cgroup launcher and an explicit Electron heap experiment.
It does not patch official macOS apps, change the Linux packaging baseline, or
claim that Codex now stays under 1 GiB. Linux native installation remains Linux-only.

Read the [design and release gate](docs/superpowers/specs/2026-09-19-memory-budget-design.md)
for accounting boundaries and the outstanding real-app benchmark. Run
`node --test linux-features/low-memory-budget/test.js`; on Mac first run
`sh linux-features/low-memory-budget/native/build-macos.sh`.

Mac hard-cap requests fail explicitly. The 500–900 MiB range is a target, not a
measurement. Shared desktop sessions cannot receive independent process limits.
See [中文说明](LOW_MEMORY.zh-CN.md).

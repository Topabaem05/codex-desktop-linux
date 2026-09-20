# Memory-budget work for Linux and macOS

## macOS application and DMG

The [macOS Community port](macos/README.md) builds a separate ARM64 development
DMG with actual app-runtime integration and all implemented compatible memory
optimizations enabled. Read its signing/permission limitations before installing.
CI boot validation is not proof of the 500–900 MiB per-agent performance target.

## Cross-platform toolkit

The optional [low-memory-budget toolkit](linux-features/low-memory-budget/README.md)
provides measurements, bounded display-state primitives, cooperative work
admission, a Linux cgroup launcher and an explicit Electron heap experiment.
The toolkit alone does not modify signed apps; the separate macOS build modifies
and re-signs only a temporary copy. Linux packaging defaults remain unchanged.

Read the [budget design](docs/superpowers/specs/2026-09-19-memory-budget-design.md).
Run `node --test linux-features/low-memory-budget/test.js`; on Mac first run
`sh linux-features/low-memory-budget/native/build-macos.sh`.
Mac hard-cap requests fail explicitly. Shared desktop conversations do not have
independent OS memory limits. See [中文说明](LOW_MEMORY.zh-CN.md).

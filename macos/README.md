# macOS Community DMG

A separate **Apple Silicon, macOS 13+ development build** of the verified official
macOS app, not a Linux ELF port and not merely an observer wrapper. The build
preserves the native framework and tools, adds an ASAR bootstrap and a native
launcher, connects the budget observer to actual window lifecycle, then re-signs
the copied bundle and creates a DMG. The installed official app is never edited.

## Build and use

```bash
sh macos/build-dmg.sh
# Audited, already downloaded source can be reused (same pinned SHA required):
sh macos/build-dmg.sh --upstream-dmg /path/to/Codex.dmg --output /new/output
```

Build requires macOS, Python 3 and Xcode Command Line Tools. Installed users do
not need Node.js, Python, npm or Xcode. `macos/upstream.json` pins the official
DMG SHA-256, signer, version and architecture. A moved latest URL fails closed;
re-audit an official candidate before changing the pin. Outputs are in
`macos/dist/`: DMG, SHA256SUMS, build-info.json and real app boot evidence.
The `macOS Community DMG` Actions artifact contains those same outputs.

Drag **Codex Community.app** to Applications, leave the official app untouched,
and quit one before running the other. Internal identifiers remain upstream for
native compatibility; profiles/deep links are not a separate independent install.
This is an **ad-hoc signed, unnotarized development copy**, not an OpenAI or Apple
approved distribution. Follow the per-app Gatekeeper approval UI only after
verifying provenance; never disable Gatekeeper/SIP, sandbox, or TLS checks.
Authenticating and all account/system permissions remain the user's decision.
Re-signing can affect Keychain/native integrations: use the original app as the
fallback. No credentials or app permissions are granted by this port.

## Enabled by default: all compatible implemented optimization features

`profile.json` is the single source of defaults. The native launcher reads its
heap value at build time, supplying it **before** the original Electron starts.

| Feature | Actual connection |
|---|---|
| 512 MiB V8 old-space target | Native Finder entrypoint passes V8 startup flag |
| Native physical-footprint observation | libproc helper sampled by app bootstrap |
| System pressure + 800/900/1024 MiB policy | Native Dispatch signal plus existing budget policy |
| Background rendering throttle | Applied to verified app-local windows |
| Reduced Markdown motion | Scoped CSS installed on trusted app pages |
| Offscreen paint skipping | CSS content-visibility; not React/DOM virtualization |
| Unused renderer cache release | Hidden + idle + critical pressure; 60-second cooldown |
| Bounded diagnostics | One private status snapshot; no transcript or credentials |

**Not claimed as enabled:** Linux cgroups, Watchbound/inotify and Linux reapers;
MCP pooling, app-server tool admission and transcript virtualization. They require
other platform/runtime integration, not a configuration flip. Built-in account
features are preserved, not unlocked. Shared renderer/app-server memory cannot be
split into per-conversation kernel limits. The profile's `notPorted` map is also
reported at runtime, so unsupported work is never silently marked active.

500–900 MiB per agent remains an **unverified workload target**. 512 MiB limits
only V8 old-space, not native allocations, GPU memory, tools or the whole tree.
Low heap budgets may increase GC or OOM during long work. Safe mode disables the
added tuning and pressure helper, retaining the upstream application:

```bash
# Fully quit the app before switching mode.
open -a '/Applications/Codex Community.app' --args --community-safe-mode
```

Status: `~/Library/Application Support/Codex Community/memory/status.json`.
Automatic upstream updates may replace the modifications. This port does not
intercept or weaken the official updater. Rebuild from a reviewed pin for updates.

## Testing and safety

```bash
python3 -m unittest discover -s macos/tests -p 'test_*.py'
node --test macos/tests/*.test.cjs linux-features/low-memory-budget/test.js
```

Linux runs parser/policy tests. macOS CI also compiles the actual helper/launcher,
verifies original codesign and ASAR integrity, patches only a temporary copy,
recomputes integrity (without disabling fuses), signs inside-out, boots the real
app in a disposable unauthenticated profile, checks CSS/preload/footprint/heap
integration, creates and remounts the DMG, and verifies its signature and hash.
The boot test is **not** login, authenticated agent, three-agent, Intel Mac, or
long-session performance validation. Do not infer those from green packaging CI.

The builder refuses team-bound entitlements it cannot legitimately reproduce.
There is no global process killer and no automatic deletion of user data. Cache
release frees unused Blink allocations, not cookies/localStorage/model context.

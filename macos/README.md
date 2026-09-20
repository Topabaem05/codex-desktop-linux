# macOS Community DMG

Experimental **Apple Silicon / macOS 13+** development copy of the audited
native macOS app. This is not a Linux ELF conversion or only an observer wrapper.
The installed official application is never modified or replaced by the build.

## Build and install

```bash
sh macos/build-dmg.sh
# Optional local input must still match the audited digest:
sh macos/build-dmg.sh --upstream-dmg /path/to/Codex.dmg --output /new/output
```

Building needs macOS, Python 3, Node.js 22+ and Xcode Command Line Tools. The built app does
not need a separate Node/Python installation; upstream may download optional
runtimes/plugins on first launch. `upstream.json` pins the source DMG digest,
OpenAI signing team, version and ARM64 architecture. A changed latest download
fails closed until reviewed and repinned. Outputs: DMG, SHA256SUMS,
build-info.json and real-app smoke evidence in `macos/dist/`.

The `macOS Community DMG` Actions artifact contains those outputs **only after
a successful build**. A failed job uploads diagnostic logs, not a runnable DMG.
Drag Codex Community.app to Applications and retain the official app as fallback.
Internal bundle/profile contracts are shared: do not run both copies together.

## All implemented compatible optimizations are enabled

`profile.json` is the defaults source. The native Finder entrypoint passes a
512 MiB V8 old-space setting before starting the original runtime. The actual
app bootstrap adds native physical-footprint/pressure monitoring, the
800/900/1024 MiB pressure policy, background renderer throttling, scoped Markdown
animation reduction, offscreen paint skipping, unused-cache release for hidden
idle windows under critical pressure, and one bounded private status snapshot.
The verified app-local `app://-/` origin is eligible; external pages are not.
Only an immutable tuning boolean is page-visible; no callable capability or
transcript/model-context mutation is added.

Paint skipping is **not DOM/React virtualization**. The profile explicitly lists
unported Linux cgroups/inotify/reapers and not-yet-wired MCP pooling and global
tool admission. Existing upstream virtualization is tuned in revision 2 below.
Built-in account features are retained
subject to upstream rollout/permissions, never unlocked by this package.
500–900 MiB per agent is an **unverified workload target**. V8 old-space is not
whole-app memory. macOS has no claimed per-conversation 1 GiB kernel cap.

## Signing and recovery

This is ad-hoc development signing, **not Developer ID signing or notarization**.
The original APNs production, app-group and shared-Keychain authority claims are
removed, not impersonated. Remote APNs push is unavailable; login/Keychain and
native Computer Use compatibility are not certified. See [SIGNING.md](SIGNING.md).
After verifying source/digest, use only the system's per-app approval flow when
required. Never disable Gatekeeper, SIP, sandboxing or TLS globally.

Safe mode disables the added tuning and pressure helper. Quit first:

```bash
open -a '/Applications/Codex Community.app' --args --community-safe-mode
```

Status: `~/Library/Application Support/Codex Community/memory/status.json`.
No prompts, code, tokens or command arguments are stored there. Upstream updates
may replace modifications; rebuild from a reviewed source pin after an update.

## Validation scope

```bash
python3 -m unittest discover -s macos/tests -p 'test_*.py'
node --test macos/tests/*.test.cjs linux-features/low-memory-budget/test.js
```

CI verifies the official signature/digest and ASAR integrity, modifies an owned
temporary copy, recomputes integrity without disabling fuses, compiles native
components, signs inside-out, then boots the actual app with disposable user data.
CSS/preload/footprint/heap checks must pass before DMG creation, remount, signature
and hash verification. This is **not** authenticated agent, three-agent,
long-session performance, Intel Mac or every macOS version validation.

## Optimization revision 2

The build now also needs **Node.js 22+** for real-bundle contract and native
app-server CLI tests. Installed apps still need no separate Node installation.
Revision-2 DMGs use `-arm64-opt2-dev.dmg` so they cannot be confused with the first
experimental artifact. CI publishes the DMG only on success and publishes small
verification logs separately, including failures.

The audited 26.915.31945 bundles already virtualize conversations and diffs, cap
visible command output at 20,000 characters, and batch deltas. Revision 2 reuses
those mechanisms instead of installing a competing renderer. Its defaults are:

| Surface | Revision 2 | Original / safe mode |
| --- | --- | --- |
| Eligible inactive owner histories | 2 cached, 60-second TTL | 10 cached, 3-hour TTL |
| Offscreen turn overscan | 1 turn | 2 turns |
| Syntax-highlight workers / AST cache entries | 2 / 32 | 4 / 100 |
| Text delta delivery | 75ms batches, immediate flush at 65,536 UTF-16 units | animated frame draining |
| Tool output delivery | 100ms, existing final flush and 20,000-character tail | 50ms |

Active turns, approvals, displayed conversations and followers remain protected.
The unsubscribe boundary rechecks those protections to avoid a selection/dispatch
race. Source digests and unique anchors must match; an upstream update rejects
the build until reviewed. No model transcript or tool execution output is trimmed.
The 65,536-unit threshold bounds a *retained display batch*, not a single incoming
allocation. Entry-count caches are not byte-exact memory limits.

Only app-owned ephemeral `thread_title`, `thread_description` and `thread_summary`
requests without app/dynamic tools get request-local disabled MCP overrides. The
policy reads effective project configuration, handles quoted server names,
preserves user configuration and guards authentication lifetime across the read.
Normal sessions, side conversations and safe mode bypass it. Config-read failure
falls back to the original request and increments a sanitized counter.

**Not implemented:** a global scheduler inside the Rust engine, shared stateful
MCP pools, and immediate session destruction. The bundled protocol has no safe
non-destructive immediate-unload call; supported unsubscribe remains in use. The
native CLI conformance test performs no model turns and claims no authenticated
agent throughput or memory result.

One persistent read-only native helper combines footprint snapshots and pressure
events (15-second normal sampling, 5 seconds under pressure). Status separates
Electron process roles and heuristic native executable categories, counting each
PID once; it does not pretend to know which MCP/session owns every process.
Status writes are asynchronous, atomic and latest-only. Same-document navigation
no longer clears preload readiness. Hidden-window cache release checks unused
cache size first, reports the observed resource-size delta, and backs off when
ineffective. That delta is not proof of an equivalent reduction in process RAM.

The only new page-visible value is the immutable boolean
`__codexCommunityLowMemory`; no callable/native capability is exposed. Safe mode
sets it false before the packaged UI loads and restores all patched constants.
Normal and safe-mode real-app boots are separate CI gates. The existing macOS
hard-cap, signing, account-integration and 500–900 MiB benchmark limitations above
still apply.

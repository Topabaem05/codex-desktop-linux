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

Building needs macOS, Python 3 and Xcode Command Line Tools. The built app does
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
No new page-visible capability or transcript/model-context mutation is added.

Paint skipping is **not DOM/React virtualization**. The profile explicitly lists
unported Linux cgroups/inotify/reapers and not-yet-wired MCP pooling, tool
admission and transcript virtualization. Built-in account features are retained
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

# Development signing and upstream privileges

The first real DMG build (Actions run 35479946728) verified the audited source,
then deliberately stopped when it found original team-bound entitlements.

The development port now **removes** the original application identifier, team
identifier, app-group and keychain-group claims before re-signing. It does not
impersonate OpenAI or grant access to those groups. Unknown restricted developer
capabilities still reject the build and require an explicit port review. Original
runtime/JIT entitlements are preserved; no new machine-wide exception is added.

This narrows the previous fail-on-any-team-entitlement design: an ad-hoc copy may
run without protected integration features. Login, shared Keychain/app-group and
native integrations are not claimed tested or preserved. Keep the official app.
A valid development build remains unnotarized and is not an official distribution.

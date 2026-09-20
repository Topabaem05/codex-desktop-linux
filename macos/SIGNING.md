# Development signing and upstream privileges

Real source inspection: Actions 35480154223, signed official 26.915.31945.

The development port removes the original application/team identifiers,
app-group and keychain-group claims, and the original APNs production entitlement
`com.apple.developer.aps-environment`. It does not impersonate OpenAI or gain access
to any original group. **Remote APNs push is unavailable in the ad-hoc copy.**
Unknown restricted developer capabilities still reject the build for review.
The original runtime/JIT settings are retained; no machine-wide exceptions.

This supersedes the initial fail-on-any-team-entitlement design in the original
README/spec: a development copy may run without those protected integrations.
Login, shared Keychain/app groups, computer-use native integration and remote
notifications are not claimed preserved or tested. Keep the official app as a
fallback and do not run both together. Ad-hoc signing is not notarization.

Reference: Apple APS Environment (macOS) Entitlement documentation:
https://developer.apple.com/documentation/bundleresources/entitlements/com.apple.developer.aps-environment

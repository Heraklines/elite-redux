# M9 signed runtime assignment

Production modes are `RUST_PRODUCTION`, `RUST_CANARY`, `RUST_SHADOW_SAMPLE`, and `LEGACY_TRANSITION`. Exactly one mechanical authority starts.

`RuntimeAssignmentV1` contains assignment/release IDs, authority, cohort, sticky scope, issued/expiry timestamps, and policy version. It is signed with Ed25519 over `er-m9:runtime-assignment-v1\0` plus canonical payload bytes. Assignment release, policy, clock interval, scope, key status, and eligibility are verified before release loading.

Selection order is: verify existing session/run pin; otherwise obtain and verify a signed assignment; verify signed release; verify/cache the complete artifact set; initialize the assigned Worker; migrate/load save; persist the pin before the first canonical mutation; then begin play.

An existing valid pin overrides newer rollout policy. Production ignores query parameters, local/session storage runtime values, globals, unsigned cookies, user-editable configuration, and DevTools mutations. Development may use the existing explicit selector.

`LEGACY_TRANSITION` requires an existing legacy pin, a deterministic unmigratable classification, or a signed unexpired emergency directive. At R7 no new legacy assignment is valid without that directive. `RUST_SHADOW_SAMPLE` keeps Rust canonical and grants the reference runtime no platform capabilities.

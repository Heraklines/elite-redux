# M8 browser security

All worker messages, frames, saves, content, release manifests, caches, artifacts, and debug traffic are untrusted and byte/count/depth/time bounded before parse or allocation.

Rust authority uses authenticated P33 participant/account/bearer/generation routes only. Legacy code-and-role `/coop` signaling/save routes are forbidden. Role, seat, account, generation, and storage authority never come from an unauthenticated body.

RTC direct ingress checks binary type and size before UTF-8/JSON decode. Unknown frame types and stale generations drop without canonical delivery.

Shadow effects are capability-empty. Any platform-effect attempt is a fatal shadow invariant and cannot reach an adapter.

Wasm loads only from the active release manifest with matching hash/ABI/content. CSP/worker type restrict code; no dynamic script/callback from Rust data. DOM/reference output escapes all text.

Development forensic access is a build-authorized bounded MessagePort. Production has no unrestricted global or route flag. Private staging rejects unauthorized users before loading Rust artifacts.

Disposal proves zero workers, ports, timers, listeners, channels, storage requests, presentations, render maps, telemetry handles, and unbounded capsules.

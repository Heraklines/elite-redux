# M8 browser security and performance audit

## Activation blockers

1. Legacy `/coop` code-and-role signaling/save routes in `workers/er-coop-api/src/index.ts` are unauthenticated. Rust authority may use only P33 account/bearer/generation-bound routes. Wrong/stale credentials cannot read, clear, or mutate rows.
2. Direct RTC messages currently reach string conversion/JSON parsing without a pre-parse byte cap. M8 bounds `ArrayBuffer` size before decoding and validates closed frame types.
3. Worker request count, total queued bytes, per-message bytes, observation bytes, artifacts, effects, and Wasm memory are bounded before allocation.
4. Rust shadow effects never reach storage, transport, UI, audio, assets, telemetry, or lifecycle adapters.
5. Wasm/JS/content/asset/adapter identities are checked as one release unit before worker creation.
6. Development forensic ports require build-time authorization and a bounded `MessagePort`; no unrestricted production global is permitted.
7. Storage is opaque bytes with generation/CAS. Rust saves never pass through legacy localStorage JSON interpretation.
8. Every browser-supplied string is escaped in DOM/reference output. No HTML from Rust is assigned unsanitized.
9. Worker disposal terminates queues, ports, timers, sessions, RTC commands, storage requests, presentation maps, and retained diagnostics.
10. Mobile/low-memory tests cover startup failure, allocation refusal, background throttling, and teardown.

## Frozen initial ceilings

- Warm worker/session ready: 750 ms.
- Cold desktop ready: 3 s.
- Cold low-end/mobile ready: 6 s.
- Raw input to Rust effect p95: 5 ms desktop, 12 ms mobile.
- Main-thread bridge work: 2 ms per effect batch.
- Pending worker requests: at most 256.
- Wasm hot simulation: at most 2.5× native.
- Automated 200-wave Wasm run: at most 120 s.
- Shadow CPU overhead: at most 25% over legacy.
- Integration-created main-thread tasks over 50 ms: zero.
- Render frame p95/p99: 16.7/33 ms desktop.
- Artifact growth from G39: at most 15% without waiver.

Deterministic work counters accompany wall-clock medians. Missing timing is explicit failure, not zero.

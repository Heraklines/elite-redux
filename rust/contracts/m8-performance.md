# M8 browser performance

G39 records cold/warm baselines separately. Hard ceilings:

- warm worker/session ready 750 ms;
- cold desktop ready 3 s;
- cold low-end/mobile ready 6 s;
- raw input to Rust effect p95 5 ms desktop, 12 ms mobile;
- main-thread bridge work 2 ms per effect batch;
- pending worker requests at most 256;
- Wasm hot simulation at most 2.5× native;
- automated 200-wave Wasm run at most 120 s;
- shadow CPU overhead at most 25%;
- integration-created main-thread long tasks above 50 ms: zero;
- rendered desktop frame p95/p99 16.7/33 ms;
- artifact size growth from G39 at most 15% without waiver.

Each timing includes exact release identity, browser/OS/device profile, repetitions, median/p95/p99, RSS/Wasm memory, allocations where observable, message sizes, copies, queue depth, and deterministic work checksum. Missing evidence fails.

Worker dispatch batches ordered events. No per-field getter hot path. Canonical JSON V1 remains until measured encode/decode/copy/allocation evidence misses a frozen ceiling; binary V2 must preserve schemas.

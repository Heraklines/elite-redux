# M9 production performance

G48 baseline is `rust/fixtures/m9/m9-rollout-baseline.json`, tied to M8/M8.1 exact SHAs and M8.1 G47 run `33271954731`.

Hard ceilings: warm Worker ready 750 ms; cold desktop ready 3 s; cold low-end/mobile ready 6 s; input-to-Rust-effect p95 8 ms desktop and 20 ms mobile; main-thread bridge p95 3 ms; zero Rust-integration tasks above 50 ms; memory and Wasm simulation regressions at most 15%; policy evaluation 20 ms excluding network; normal save migration 1 s typical; rollback policy propagation 60 s target; mixed-release execution zero.

Measure repeated medians, p95, p99, maxima, sample counts, browser/device class, release/generation identity, cache state, snapshot/save size, and resource deltas. Setup, download, signature verification, cache verification, Worker startup, migration, restore, first effect, and teardown are separate metrics.

Service-worker activation never interrupts active pinned sessions. Candidate prefetch consumes bounded CPU/memory and has no authority/platform capabilities. After every journey, retired Workers, ports, listeners, timers, leases, storage requests, presentations, and cache write handles are zero.

Ring promotion uses hosted exact-release evidence. Metrics from different SHAs, releases, browser artifacts, or policy revisions are never combined.

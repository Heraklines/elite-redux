# M9 production boundary inventory

Base: `rust-kernel-m81-final` at `1b9b167ded66a2dcef842a8aae5789c08d9f6d5b`.

## Runtime and entry graph

- `src/rust-browser/host/browser-runtime-selector.ts` returns `LEGACY_TYPESCRIPT` for every non-development build. Development query selection admits only `rust-local` and `rust-shadow`.
- `src/main.ts` is the production entry. It statically imports platform initialization and Phaser, then dynamically imports `loading-scene` and `battle-scene`. It does not select or verify a Rust production release.
- `src/rust-browser/routes/rust-local-entry.ts`, `rust-phaser-entry.ts`, and `rust-staging-entry.ts` are separate Rust authority entries. Staging requires a private route and an externally authorized M8 manifest that still declares a legacy production default.
- Phaser adapters under `src/rust-browser/render/` consume Rust projections and presentation. They are the retained M9 renderer boundary.

## Generation and release ownership

- M8.1 generation identity, immutable artifact loading, candidate Worker isolation, snapshot migration, replay comparison, atomic switching, and rollback live under `src/rust-browser/hot-reload/`.
- `dev-controls.ts` exposes reload and rollback over an authorized MessagePort. M9 production builds must not import this module.
- `src/rust-browser/contracts/browser-release-manifest.ts` is unsigned and frozen to private staging. M9 requires a signed v2 manifest and signed assignment before any authority selection.

## Cache and offline boundary

- `src/rust-browser/adapters/release-cache.ts` validates every listed asset before atomically updating one release pointer.
- `src/rust-browser/adapters/indexeddb-adapter.ts` namespaces opaque storage by release and publishes revision notices through `BroadcastChannel`.
- Production currently does not register an operational release service worker. `index.html` removes existing registrations/caches, while `deploy/standalone-assets/service-worker.js` only claims clients.
- M9 requires complete-release caching, pin references, N/N-1 retention, offline selection, and reference-counted eviction.

## Save and platform boundary

- Rust canonical saves and the idealized TypeScript v1 converter live in `rust/crates/er-save`.
- Current browser/cloud persistence provides bounded bytes and explicit CAS conflicts, but no production save envelope, migration receipt, immutable legacy backup, or multi-tab lease.
- Authentication, session cookies, co-op tickets, and credentialed fetches stay in browser API adapters. Rust receives typed result bytes only.

## Co-op boundary

- `src/rust-browser/adapters/signaling-adapter.ts` compares runtime, protocol, content, material, save, ABI, and model identities. It does not yet compare release ID or a signed compatibility set.
- P33 session bindings and WebRTC connection generations fence reconnect and stale channels independently of release selection.
- Matchmaking and party assignment currently lack a signed common-release assignment.

## Deployment and observability boundary

- `.github/workflows/deploy-prod.yml` manually rebuilds and deploys Workers plus Pages. It resolves the current `er-assets/main` SHA during deployment, so it is not build-once promotion.
- Production telemetry currently includes rich gameplay events. M9 requires a separate bounded health-event schema; full capsules remain consented/internal only.

## Contract blockers

1. Signed release and assignment verification before selection.
2. Minimal bootstrap that does not statically import legacy mechanics.
3. Complete atomic service-worker release cache.
4. Copy-on-write production save migration and lease.
5. Release-aware matchmaking, pairing, reconnect, and recovery.
6. Deterministic rollout health and Rust-first rollback.
7. Separate legacy transition artifact and import-graph proof.
8. Build, publish, promote, and rollback workflows that never rebuild between rings.

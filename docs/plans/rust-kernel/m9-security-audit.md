# M9 production security audit

Base: `rust-kernel-m81-final` at `1b9b167ded66a2dcef842a8aae5789c08d9f6d5b`.

## Critical

### M9-SEC-001 — unsigned release authority

M8/M8.1 manifests and native generation manifests authenticate neither signer nor channel. Self-asserted SHA-256 values cannot establish deployment authority. A pinned Ed25519 trust root, canonical signed payload, key ID/revocation, channel binding, expiry, and anti-rollback floor are required before any URL, digest, runtime, migration, or executable is used.

### M9-SEC-002 — verified cache is not the execution source

`artifact-loader.ts` verifies cache membership but returns mutable network URLs. Worker bytes are not tied to `artifact_sha256`; `rust-wasm-loader.ts` derives and imports unhashed glue JS. M9 must sign every executable artifact, reverify cached responses at use, and execute only immutable verifier-produced handles. Mixed Worker/glue/Wasm/content cohorts fail before execution.

## High

### M9-SEC-003 — native executable path traversal

`GenerationArtifactManifestV1.executable_name` reaches cache write, verification, and `Command::new` without a single-component/final-containment rule. M9 uses a fixed platform basename, rejects separators/dot/absolute/drive/UNC/device paths, proves canonical parent equality, and adds traversal/reparse/race tests.

### M9-SEC-004 — production graph hard-pins legacy authority

`src/main.ts`, `browser-runtime-selector.ts`, the M8 manifest, and M8 contract checker all enforce legacy production. M9 requires a clean production Rust entry and fail-closed unavailable UI; no verification/start failure may fall back to TypeScript.

### M9-SEC-005 — unsigned update sidecar forces reload

`init-update-checker.ts` trusts `/version.json` and calls `location.reload`. M9 removes authority-changing public page reload from the Rust production graph. Update discovery may notify only; active sessions remain pinned.

### M9-SEC-006 — co-op ingress relabels stale frames

`transport-adapter.ts` stamps untrusted bytes with the current local generation instead of verifying authenticated public frame generation/sequence. M9 extends the existing public protocol with session, participant/seat, release, connection generation, monotonic sequence, payload digest, and authenticated binding; stale frames deliver zero bytes.

## Medium

### M9-SEC-007 — debug mutation graph remains importable

Production imports the dev-tools registry and tracked scenario modules behind runtime/build flags. M9 production uses graph exclusion: no dev registry, fixture importer, shadow/local/staging route, hot-reload controls, or debug-enabled artifact can be production-signed.

### M9-SEC-008 — cloud save bytes lack production binding

Cloud save values carry revision and opaque bytes only. M9 validates account/slot, release, generation, mechanical/content identity, schema, canonical payload hash, and migration receipt before restore or CAS. Conflict never falls back to last-write-wins.

## Existing controls retained

Same-origin restrictions, byte/count bounds, exact peer compatibility, CAS revisions, storage identity checks, quiescent swap, stale-response rejection, and minimal native child environments remain defense in depth. None substitutes for signatures, one authority graph, or an authenticated public frame/save envelope.

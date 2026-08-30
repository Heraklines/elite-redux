# M9-LM legacy save migration and public cutover

Historical legacy migration is deliberately disabled during M9 isolated-preview qualification. The preview browser and preview-only Worker accept only fresh `M9_RUST_PREVIEW_V1` Rust envelopes. They expose no legacy migration route, no legacy account lookup, and no browser-accessible Wasm migration export. Missing preview state starts from the signed Rust session template; it never consults ordinary production saves.

The dedicated preview Worker has only the `RUST_PREVIEW_DB` D1 capability. The ordinary production save Worker has only `DB`. Preview account IDs are domain-separated as `rust-preview:<stable-random-id>` and must exist in the preview database before lease or save operations. Legacy achievements, unlocks, profiles, and saves are not imported.

`ProductionSaveEnvelopeV2` binds slot, cloud generation, origin runtime, release, mechanical identity, save schema, content hash, payload hash, canonical payload, optional future migration receipt, and immutable legacy backup reference.

When M9-LM is separately authorized, legacy migration will be copy-on-write: read and verify source; retain exact source bytes; migrate in Rust without gameplay RNG; validate complete Rust state; construct a fresh environment; snapshot and restore in another fresh kernel; compare digests; write the Rust envelope using cloud and local CAS; read it back; verify generation and payload hash; then activate Rust and persist the session pin.

No source overwrite or deletion may occur during future migration. Same input, content, migrator, and target release must produce byte-identical output and receipt. Retry is idempotent. Unsupported valid sources receive a stable explicit classification. Quota, network, crash, conflict, and readback failures leave source and any conflicting versions recoverable.

Preview writes require both the local `SaveLeaseV1` and a live server-side preview lease. IndexedDB transaction, BroadcastChannel, server lease, cloud CAS, backup-before-overwrite, and bounded expiry serialize multi-tab and multi-device writers. Last-write-wins is forbidden.

Normal rollback after Rust mutation is Rust N+1 to compatible Rust N. TypeScript may resume an immutable legacy backup only after a separately qualified and authorized M9-LM migration/cutover. Authentication tokens never enter the envelope or Rust Worker.

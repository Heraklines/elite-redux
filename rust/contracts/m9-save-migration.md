# M9 production save migration

`ProductionSaveEnvelopeV2` binds slot, cloud generation, origin runtime, release, mechanical identity, save schema, content hash, payload hash, canonical payload, optional migration receipt, and immutable legacy backup reference.

Legacy migration is copy-on-write: read and verify source; retain exact source bytes; migrate in Rust without gameplay RNG; validate complete Rust state; construct a fresh environment; snapshot and restore in another fresh kernel; compare digests; write the Rust envelope using cloud and local CAS; read it back; verify generation and payload hash; then activate Rust and persist the session pin.

No source overwrite or deletion occurs during migration. Same input, content, migrator, and target release produce byte-identical output and receipt. Retry is idempotent. Unsupported valid sources receive a stable explicit classification. Quota, network, crash, conflict, and readback failures leave source and any conflicting versions recoverable.

`SaveLeaseV1` combines slot, browser holder, generation, and expiry. IndexedDB transaction, BroadcastChannel, cloud CAS, and bounded renewal serialize multi-tab and multi-device writers. Last-write-wins is forbidden.

Normal rollback after Rust mutation is Rust N+1 to compatible Rust N. TypeScript may resume the immutable legacy backup only before Rust mutation, unless a separately qualified downgrade exporter exists. Authentication tokens never enter the envelope or Rust Worker.

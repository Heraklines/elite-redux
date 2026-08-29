# M8.1 snapshot migration

The supervisor owns a closed `SnapshotMigrationRegistryV1`. A migration edge declares migration ID, source schema, target schema, accepted source artifact/content constraints, output size bound, and deterministic migration function. Candidate workers do not choose migrations.

A route is valid only when it is unique, acyclic, no longer than eight edges, and ends inside the candidate's declared snapshot schema range. Ambiguous routes, downgrade edges, missing edges, unknown fields, excessive output, content mismatch, or invariant failure reject the reload.

Each step consumes canonical bytes and returns canonical bytes plus `SnapshotMigrationEvidenceV1`: input/output hashes, schemas, migration ID, and invariant result. The registry executes twice in debug/qualification mode and requires byte equality. Migration cannot read clocks, files, environment variables, network, random state, or mutable global state.

Optional additive schema extensions require an explicit edge that supplies deterministic defaults. Breaking removals or semantic reinterpretation reject an active session unless an explicit tested edge preserves all state. The original snapshot remains immutable for rollback and reproduction.

After migration the candidate must deserialize, validate, reconstruct all live owners, re-snapshot, and match the migrated canonical image before tail replay. Native and Wasm registries consume the same migration vectors and must produce byte-identical output.

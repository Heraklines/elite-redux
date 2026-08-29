# M5 content compiler

## Boundary

`er-content-compiler` is an offline deterministic binary. Production crates do not link it and never read TypeScript. It consumes canonical JSON artifacts generated from the exact oracle worktree and writes canonical JSON packs/reports outside the source tree before publication.

## Inputs

1. `SourceCatalogV1` at the frozen oracle SHA/tree.
2. Post-initialization content capture for moves, abilities, species, type chart, held items, statuses, volatile tags, weather, terrain, and side/arena tags.
3. `ClassificationManifestV1` with exactly one entry per catalog identity.
4. `BespokeManifestV1` for every bespoke classification.
5. IR mapping tables keyed by source identity and exact observed attribute shape.
6. Frozen compiler/version contract.

Input paths are explicit CLI arguments. Directory walking is sorted by normalized UTF-8 path. Locale, timezone, object insertion order, host path, and wall clock cannot affect output.

## Classification

Each source identity appears exactly once as `COMPILED`, `BESPOKE`, or `UNSUPPORTED`. Active and passive ability reachability are classified separately while sharing the same definition programs where their behavior is identical. Duplicate entries, missing entries, unknown identities, empty compiled program lists, missing bespoke records, and unknown reason codes are compiler errors.

`UNCLASSIFIED` may exist only in a development report. It is not a valid pack classification and compilation fails while any entry remains unclassified.

## Compilation

The compiler matches a source definition against closed mapping rules. A rule validates constructor/attribute kind, all operands, flags, target class, condition shape, patch order, and expected source location/hash where load-bearing. Partial matches fail; they do not emit partial programs.

Generated IDs are stable functions of catalog identity and program ordinal, checked for collision. Output vectors are ID-indexed where numeric, otherwise UTF-8 byte sorted. Program and node order derives from final source initialization/patch order.

## Outputs

- `battle-content-pack-v2.json`
- `run-content-pack-v2.json`
- `classification-manifest-v1.json`
- `bespoke-manifest-v1.json`
- `capability-report-v1.json`
- `coverage-report-v1.json`
- `compiler-attestation-v1.json`

The attestation records oracle SHA/tree, input digests, compiler commit, contract versions, output digests, item counts, classification counts, and zero-unclassified assertion. It contains no timestamp or host-specific path.

## Hashes

Every JSON output is canonical. `BattleContentPackV2` uses the frozen M5 BLAKE3 domain and includes the source-catalog digest, IR version, program version, oracle SHA, and semantic content. Embedded `content_hash` is calculated with that field omitted, then verified after deserialization.

## Determinism gate

The hosted compiler runs twice in independent fresh processes and work directories. Inventories and bytes must match. Native and Wasm loaders must produce identical validated pack digests. A source catalog change without a corresponding classification/pack change fails CI.

## Fail-closed runtime

A pack loader validates all schemas, IDs, vector indexes, source/classification closure, program references, program budgets, bespoke references, and content hashes. Battle initialization computes reachable active and bench content and rejects unsupported or missing entries before RNG or state mutation.

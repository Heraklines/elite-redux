# M7 closure evidence contract

This contract governs source-bound behavior closure for Rust Kernel M7. It inherits `m7-api.md` and `m7-contract.toml`. The pinned TypeScript oracle remains read-only.

## Inventories

`game-system-catalog-v1.json` is the immutable AST-level source ledger. `run-behavior-unit-manifest-v1.json` is its canonical nonvisual M7 subset. Platform, presentation, M6 battle, and M6 protocol classifications remain source-catalog dispositions and never become M7 implementation records.

`m7-semantic-groups-v1.json` partitions every run behavior ID exactly once. A semantic group contains one or more root behaviors and zero or more helper behaviors. Group membership does not remove or replace any source behavior ID.

`m7-domain-closure-v1.json` reports unique behavior counts. Scenario and AI counts are subsets of the run total, never additive totals.

## Semantic grouping

A group has:

- a stable group ID derived from its domain, semantic root, and sorted member IDs;
- exactly one domain;
- nonempty root behavior IDs;
- helper behavior IDs disjoint from roots;
- source files and one semantic owner;
- explicit group dependencies;
- planned implementation kind;
- required positive and negative witnesses.

The group union MUST equal the frozen run catalog. Duplicate membership, unknown IDs, mixed domains, unresolved AST declarations, computed dispatch, and ambiguous ownership fail generation.

A callback nested beneath a behavior belongs to that behavior's group when both have the same domain. A nested behavior with a different frozen domain starts a separate group and becomes a dependency. Methods on the same class owner and domain share a group; top-level functions remain separate semantic roots.

## Implementation V2

`m7-behavior-implementation-v2.json` is group-based. Each entry contains:

- semantic group ID and domain;
- final status: `COMPILED`, `BESPOKE_IMPLEMENTED`, or `SEMANTICALLY_INERT`;
- the exact sorted behavior IDs;
- compiled Rust symbols;
- proof-registry group ID;
- discovered Rust test names;
- executed proof digest.

Partial group implementation is illegal. `PENDING_PROOF_EXECUTION` is not a final closure status and contributes zero qualified groups. The V1 manifest remains transitional input only until every V2 record has executed proof evidence.

## Semantically inert behavior

A group may be `SEMANTICALLY_INERT` only when its executed proof establishes all applicable negative assertions:

- no canonical mutation;
- no RNG draw;
- no control transition;
- no option generation;
- no legality decision;
- no material;
- no save field;
- no platform effect.

Visibility, naming, or private-helper status alone never proves semantic inertia.

## Compiled Rust proof registry

`er-testkit::m7_proof_registry` owns the compiled registry contract. Every record binds:

- semantic group ID;
- semantic owner;
- exact behavior IDs;
- Rust symbol;
- compiled symbol anchor;
- exact discovered test name;
- executable witness function.

A symbol anchor MUST reference the production Rust symbol at compile time. A witness returns `BehaviorProofEvidence` containing exact reached behavior IDs, mutations, RNG draws, controls, materials, and negative assertions. Registry execution fails unless reached IDs equal the record IDs exactly.

The executed artifact is canonical JSON. Rust recomputes each evidence digest. Node verification compares the artifact against semantic groups, implementation V2, and `cargo test -- --list`. File existence or a nonempty test-name string is insufficient.

No proof may emit an unclaimed behavior ID. No behavior may be emitted by more than one proof. One broad witness may not claim unrelated semantic groups.

## Closure stages

G29 requires:

- zero unique unresolved run behaviors;
- zero scenario subset gaps;
- zero AI subset gaps;
- zero clustered gaps;
- all required campaign sources present and executable;
- qualified implementation V2 and executed proof registry.

G29 does not require `m7-final-qualification.json`.

G30 is the exact-SHA aggregate over all domain, campaign, parity, performance, teardown, and regression jobs. The M7 final qualification manifest is written only after G30, on the first M8 commit, and records the frozen M7 SHA and successful G30 run ID.

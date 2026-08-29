# CR-0025: reuse sealed authority transaction evidence and retained payloads

Status: approved by the integration owner during final M3 hosted benchmark
calibration.

## Problem

The reducer/finalizer already computed and retained the exact TURN before/after
mechanical digests, but `GameRuntime::prepare_authority_turn` discarded the
opaque wrapper into a publicly field-constructible bundle. The authority common
material applier then independently canonicalized and hashed both complete
states again. This duplicated proof inside one rollback-owned transaction while
the 10,000-turn production benchmark remained above its frozen ceiling.

The authority material codec also parsed its canonical bytes into a JSON
`Value`, then passed that already-parsed value through the generic serialized
canonical-byte helper. That helper deep-cloned and revalidated the complete
value before performing the required canonical round-trip comparison.

The outer authority log was copy-on-write, but cloning it still recursively
cloned every retained `AuthorityEntry` material payload. Authority staging also
copied the canonical byte vector into its private event and cloned the already
installed game/control/policy solely to compare them during synchronous
publication validation.

## Decision

- Keep `TurnDigestEvidence` attached to `PreparedAuthorityTurn` and make all
  fields and its constructor non-public outside `er-game`.
- Expose immutable transition, control-plan, and admission access only; expose
  no raw transition transfer, mutable evidence, boolean bypass, or public
  constructor.
- Add one doc-hidden authority-only entry into the existing TURN material
  implementation. It must require exact equality of the decoded material's
  before state, before digest, after state, and after digest with the sealed
  reducer evidence before skipping those two digest computations.
- Keep public, local, replica, recovery, replacement, and ordinary trusted
  material paths on independent digest computation.
- Canonicalize the already-parsed material `Value` directly and compare the
  resulting canonical string bytes with the original typed canonical bytes.
  Retain typed decode/equality and the original byte vector for material digest
  and prepared-entry evidence.
- Retain immutable authority entries behind `Arc` inside delivery leases and
  the latest-commit proof. Log transaction clones share those payloads;
  generation rebind uses `Arc::make_mut` before changing entry context so a
  failed or discarded transaction cannot mutate its predecessor.
- Move the one canonical material byte vector into the public cross-crate
  `PreparedAuthorityEntry` DTO after preparation through one crate-private
  production authority-preparation
  `AuthorityPreparedTransaction::take_prepared_entry` construction seam, and
  borrow the already-installed game, control, and scripted policy during
  synchronous pre/post-publication comparison. The DTO bytes are
  construction-correlated diagnostic evidence; the prepared AuthorityLog
  `Material { digest, payload }` remains the publication input.

## Consequences

The authority still applies decoded material through the same role-neutral
validation implementation and cannot adopt the resolver candidate directly.
Schema, wire payload, material bytes, digest domains, error classes, and
snapshot state do not change. Mutation, command, RNG, presentation, frontier,
allocator, endpoint, content, identity, control, and final transaction checks
remain mandatory. Public authority-log APIs and snapshots still expose owned
entries. Only work already proved by an unforgeable reducer capability, an
already-parsed canonical value, or immutable rollback-owned state is reused.
The FIFO evidence is not independently canonicalized, hashed, or compared in
the resolving loop.

## Acceptance evidence

- source audits prove `PreparedAuthorityTurn` retains sealed reducer evidence,
  the public cross-crate `PreparedAuthorityEntry` DTO has one crate-private
  production authority-preparation construction seam, and no raw transition or
  skip flag exists;
- material audits prove all four reducer evidence equalities and independent
  digest mode for ordinary paths;
- a cloned authority log remains unchanged when its successor is rebound while
  both the retained entry and latest-commit recovery proof adopt the new
  context;
- canonical material/wire vectors and native/Wasm continuation remain exact;
- the unchanged hosted 10,000-turn benchmark is below its exclusive ceiling;
  and
- the exact-SHA Rust Kernel Gate is green.

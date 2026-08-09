# CR-0014: Separate replacement occurrence identities

Status: approved by the integration owner during M3A-09, before any Rust
replacement proposal implementation or M3 command fixture was accepted.

## Problem

The frozen command API describes two different faint-occurrence identities:

- `FaintOccurrence.id` / `next_faint_occurrence` is a globally unique queue and
  diagnostic identity; and
- `FaintSource.turn_occurrence` is a zero-based sequence scoped to one resolved
  turn and is the `o` component of the pinned REPLACEMENT operation grammar.

The prose states that the operation grammar uses `turn_occurrence`, but
`BattleReplacementProposalV1` carries only `occurrence: FaintOccurrenceId`.
That shape cannot both preserve the global queue identity and reproduce the
production operation ID. Treating the global ID as `/o` would silently diverge
from the pinned authority adapter.

## Evidence

At the pinned oracle commit, the production adapter builds the replacement
operation ID from `ReplacementChainAddress.occurrence`, and chain derivation
assigns that address from the per-turn settled-faint sequence:

- `src/data/elite-redux/coop/coop-faint-switch-operation.ts`, lines 74-80;
- `src/data/elite-redux/coop/authority-v2/adapters/faint-replacement.ts`, lines
  65-83 and 347-349; and
- `docs/plans/rust-kernel/m3-state-oracle.md`, lines 508-560.

The frozen Rust state model separately allocates `FaintOccurrenceId` through
`next_faint_occurrence`, so the two values are not interchangeable even when
they happen to match early in a battle.

## Decision

- Add `turn_occurrence: u32` to `BattleReplacementProposalV1` immediately after
  its global `occurrence: FaintOccurrenceId`.
- Keep `occurrence` as the globally unique queue identity used to resolve the
  stored `FaintOccurrence`.
- Use `turn_occurrence` exclusively for the REPLACEMENT operation ID's `o`
  component.
- At admission, resolve `occurrence` to the stored queue head and require its
  source epoch, wave, resolved turn, and turn occurrence plus its owner and
  field slot to match the proposal and operation address exactly.
- Include both occurrence fields, the operation ID, and every other proposal
  field in the existing replacement fingerprint preimage.
- Keep `replacement_proposal_version = 1`: no Rust replacement proposal or M3
  command fixture has been accepted under the incomplete shape, so this repairs
  the definition of version 1 rather than versioning deployed behavior.
- Leave production TypeScript, `rust/source-lock.toml`, and unrelated M3 APIs
  unchanged.

## Required evidence

- the M3 contract-freeze gate requires the dual-field proposal shape and the
  exclusive `turn_occurrence` operation binding;
- stale implementations that use `FaintOccurrenceId` for `/o` fail hosted
  command DTO tests;
- proposal admission tests reject every mismatch between the global queue
  identity, stored faint source, owner, field slot, and operation address; and
- the hosted M3 gate and fresh G6 attestation pass at the exact corrected SHA.

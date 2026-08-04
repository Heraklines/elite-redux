# PokéRogue Redux Rust-kernel source inventory

This document reconciles the Milestone 0 source inventories for the first
production Rust-kernel migration line. The product is **PokéRogue Redux**.
Names such as `elite-redux`, the `er-*` crate prefix, and protocol
`er-coop-47` are retained only where they are existing source paths or frozen
compatibility identifiers; they are not the product name.

## Immutable oracle

The migration branch consumes one pinned TypeScript implementation as an
oracle. It is not rebased as the feature line moves.

| Field | Frozen value |
| --- | --- |
| Oracle game SHA | `3b534099919efae827019d4a3f3c4ab0ecd6d67b` |
| Oracle branch | `ci/coop/v2-showdown-command-coordinate-20260720` |
| Wire protocol | `er-coop-47` |
| Authority frame schema | `2` |
| Export schema | `1` |
| Input repeat delay | `250 ms` |
| Input repeat interval | `250 ms` |

The machine-readable lock is [`rust/source-lock.toml`](../../rust/source-lock.toml).
Only the integration owner may update it, and any future update must be a
dedicated reviewed sync commit.

## Reconciled inventories

| Domain | Artifacts | Coverage and frozen observations |
| --- | --- | --- |
| Raw input | [`input-oracle.md`](rust-kernel/input-oracle.md), [`input-map-v1.json`](../../schemas/kernel/source/input-map-v1.json) | All 18 logical buttons, default keyboard/gamepad/touch maps, down/up symmetry, focus and blur behavior, custom aliases/blacklists, and the observed 250 ms repeat path. The oracle's unmatched-keyup `splice(-1, 1)` and touch-cancel no-release behaviors are recorded as risks, not silently hidden. |
| Menu/UI | [`menu-oracle.md`](rust-kernel/menu-oracle.md), [`menu-behaviors-v1.json`](../../schemas/kernel/source/menu-behaviors-v1.json) | All 72 tracked handler files: 60 concrete behavior records and 12 explicit exclusions. Inherited `MessageUiHandler` actionability (`active && isAwaitingPromptAction()`) is separate from local `processInput` guards and from plain `UiHandler` behavior. Form-modal, DOM, async, timer, ownership, and `Math.random` boundaries remain explicit. |
| Authority V2 | [`authority-v2-oracle.md`](rust-kernel/authority-v2-oracle.md), [`authority-v2-map-v1.json`](../../schemas/kernel/source/authority-v2-map-v1.json) | 37 production modules and 29 node-pure tests. One global revision order, exact frame context, entry validation, staged receipts, non-evicting unresolved retention, proposal admission/leases, successor controls, recovery fences/transactions, timers, cleanup, and global adapter dependencies are represented. The wire protocol is `er-coop-47`; the Authority frame version is separately `2`. |
| State, checkpoints, and traces | [`state-trace-oracle.md`](rust-kernel/state-trace-oracle.md), [`state-fields-v1.json`](../../schemas/kernel/source/state-fields-v1.json) | 27 tracked source files, 33 declarations, and 347/347 field records with field-level source and boundary metadata. Replay, checkpoint, engine, Pokémon, modifier, and save projections are separated. `mysteryEncounterSaveData` absence and `typePregenArgs` declared-versus-observed behavior remain documented ambiguities rather than invented contracts. |
| Canonicalization | [`canonicalization-oracle.md`](rust-kernel/canonicalization-oracle.md), [`canonicalization-v1.json`](../../schemas/kernel/source/canonicalization-v1.json) | 45 source files and 72 algorithm/identity records. Canonical JSON variants, FNV/SHA digests, operation IDs, ordering, integer-index enumeration, absent/null behavior, and safe-number boundaries are distinct. Core canonicalizers that use `Number.isInteger` are not misreported as safe-integer validators. |
| Existing tests | [`test-oracle.md`](rust-kernel/test-oracle.md), [`test-coverage-map.json`](../../rust/fixtures/v1/test-coverage-map.json) | 236 source files. Authority V2 maps 444 production identities plus 17 reference-simulator identities; parameterized `it.each`, conditional, and todo call sites retain raw title expressions. Input/menu, scenario, two-engine, and browser execution classes remain explicit and external where Phaser/global/browser state is required. |

## Golden export

The TypeScript exporter reads the pinned source and produces ten deterministic
JSON envelopes in [`test/kernel-fixtures/v1`](../../test/kernel-fixtures/v1).
Every envelope carries:

- `project_name = "PokéRogue Redux"`;
- the exact oracle SHA;
- protocol and schema versions;
- source provenance;
- a recomputable canonical digest.

The exporter verifies that the current commit descends from the oracle and that
all 20 consumed TypeScript source files are byte-identical to the oracle tree.
It does not invent Phaser numeric values: 77 unresolved Phaser expressions are
preserved as unresolved/null source facts. Two consecutive exports must be
byte-identical.

## Baseline contract

[`baseline-manifest.json`](../../rust/fixtures/v1/baseline-manifest.json) and
[`baseline-methodology.md`](rust-kernel/baseline-methodology.md) define six
honest baseline records:

1. the node-pure production Authority V2 suite;
2. the TypeScript protocol simulator;
3. one headless Phaser scenario;
4. one ten-wave headless Phaser scenario;
5. one two-engine co-op journey;
6. one browser journey.

Unmeasured values are `null` and records are `not_measured`; they are never
fabricated as zero or passed. Heavy measurement is GitHub-hosted only. The
coordinator uses explicit argv with `shell: false`, a script-specific hosted
gate, an allowlisted effective environment, stable environment digests, and
separate setup, spawn, cold, warm, full-execution, and RSS fields.

## Cross-language contract decisions

The following decisions reconcile contradictions found during review and bind
the Milestone 1 and 2 public-interface work:

- JSON-crossing integers use validated `SafeU53` values. Milestones 0–2 do not
  introduce floating-point canonical state.
- Missing, explicit `null`, and source wildcard behavior remain distinct where
  the wire does. Optional control-address fields encode both null and omission
  as `*` only where the oracle uses `== null`.
- Proposal fingerprints are opaque strings, not hashes. Choice admission uses
  exact JavaScript tuple text
  `JSON.stringify([seq, kind, choice, data ?? null, rewardSurface ?? null])`;
  Bargain outcome admission uses
  `JSON.stringify([seq, kind, outcome])`. There is no single cross-surface
  fingerprint algorithm at the oracle SHA.
- Material digests are separate from proposal fingerprints. Existing wire
  FNV/SHA algorithms remain wire-exact; BLAKE3 is reserved for new fixture or
  content-bundle hashes, not substituted into compatibility digests.
- One global Authority revision is retained. Replica progress is staged as
  `received <= material <= control`; revision `N+1` cannot execute while `N`
  is incomplete.
- Retention is fail-closed and cannot evict unresolved truth. The same proposal
  ID with the same fingerprint is a duplicate; the same ID with another
  fingerprint is a conflict.
- Recovery fences before requesting a bundle and keeps final control pending
  until material and control completion. Timer/retry ownership belongs to the
  deterministic scheduler.
- Production adapters may provide Phaser material, presentation, storage, or
  transport facts, but engine handles, callbacks, browser transport objects,
  and process-global scene state do not enter the canonical Rust context.
- Representative campaign APIs admit raw physical input and environment
  outcomes only. Direct command/choice/cursor submission is not part of the
  public test driver.

## M0 verification boundary

Milestone 0 is additive. The integration diff is restricted to `rust/**`,
`schemas/kernel/**`, `test/kernel-fixtures/**`, the two permitted script
families, the Rust workflow, and Rust-kernel planning documents. No production
TypeScript file is changed and no browser bundle includes Rust.

The dedicated [Rust workflow](../../.github/workflows/rust-kernel.yml) has six
separate jobs:

1. `source-lock-and-fixtures`;
2. `rust-format`;
3. `rust-clippy`;
4. `rust-native-tests`;
5. `rust-wasm-node-parity`;
6. `rust-benchmarks`.

It verifies the exact six-field source lock, oracle ancestry/tree identity,
two-pass fixture determinism, the pinned Rust and Node toolchains, locked
dependencies, native/Wasm checks, compact success evidence, and detailed
failure artifacts. It does not run Chromium or co-op Vitest during Milestones
0–2. Phaser-heavy and co-op acceptance remains on isolated GitHub-hosted
runners under the repository's standing policy.

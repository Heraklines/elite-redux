# CR-0015: Admit signed safe integers on the strict canonical path

Status: approved by the integration owner during M3A-03, before any M3
`ContentPackHash` or content artifact was accepted.

## Problem

The frozen M3 content model contains
`MoveEffectDefinition::ChangeStatStage { delta: i8 }`, and the selected PLAY
NICE definition has the exact semantic delta `-1`. The same contract defines
`ContentPackHash` over the serialized `ContentPack` through the strict kernel
canonicalizer. The current `er-canonical` implementation rejects every negative
integer on that path, so the required content pack cannot be hashed without
changing or hiding an exact gameplay value.

This is not a content-lane choice: encoding the delta as a string, omitting it,
or substituting an unsigned magnitude would violate the frozen serialized-pack
preimage.

## Evidence

- `rust/contracts/m3-api.md` freezes the signed `i8` stat-stage delta and the
  exact serialized `ContentPack` BLAKE3 preimage.
- `docs/plans/rust-kernel/m3-content-oracle.md` records PLAY NICE `589` as an
  Attack `-1` stage effect at the pinned oracle commit.
- `rust/crates/er-canonical/src/lib.rs` currently accepts only
  `serde_json::Number::as_u64()` on the strict path and has tests that reject
  all negative integers.
- The source canonical number rule documented in
  `docs/plans/rust-kernel/canonicalization-oracle.md` serializes integer-valued
  JavaScript numbers with `Number.prototype.toString()`, including negative
  integers. Admission and formatting remain separate concerns.

## Decision

- The strict kernel canonical/content path accepts signed JavaScript-safe
  integer values in the inclusive range
  `-9_007_199_254_740_991..=9_007_199_254_740_991` and emits canonical decimal
  integer tokens.
- It continues to reject floating-point serialized values, even when their
  mathematical value is integral, plus every integer outside that signed safe
  range, NaN, and infinity.
- `SafeU53` and all unsigned coordinate/counter newtypes remain unchanged and
  nonnegative. This correction changes only the generic canonicalizer's valid
  signed-integer value domain.
- The TypeScript fixture SHA-256 compatibility path remains unchanged.
- Keep the existing canonical/content algorithm and content-pack schema
  versions: no M3 content hash or artifact has been accepted under the
  impossible unsigned-only preimage, so this repairs their version-1
  definitions rather than versioning deployed behavior.
- Leave production TypeScript and `rust/source-lock.toml` unchanged.

## Required evidence

- the contract-freeze gate requires the signed-safe domain in both the core
  canonical contract and the M3 content-hash contract;
- hosted native and wasm tests accept `-1` and both signed safe endpoints,
  reject both out-of-range directions and every floating form, and preserve
  existing nonnegative canonical bytes;
- a hosted exact content-preimage test hashes the selected PLAY NICE `-1`
  effect without a custom projection or compatibility canonicalizer; and
- the M3A-03 content lane starts from the corrected implementation SHA before
  publishing a `ContentPackHash`.

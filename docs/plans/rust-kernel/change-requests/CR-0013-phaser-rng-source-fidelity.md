# CR-0013: Phaser 3.90 RNG source fidelity

Status: approved by the integration owner during M3A-01, before any Rust RNG
implementation or M3 RNG golden vector was accepted.

## Problem

The frozen RNG contract and its extraction note contain three transcriptions
that conflict with the dependency source pinned by the oracle lockfile:

- `frac()` was written with a `512` / `0x200` multiplier, while Phaser 3.90.0
  uses `0x200000` (2,097,152) before its `| 0` coercion;
- `integer()` was described as applying `ToUint32`, while the source returns
  `rnd() * 0x100000000` without a source-level coercion; and
- `n` was described as an `rnd()` call counter, while it is the accumulator
  used by `hash()` during `sow()` and is not touched by `rnd()`.

Implementing the frozen transcription would diverge from the exact dependency
the M3 contract claims to port. Generating vectors from that transcription
would compound the error by blessing non-oracle output.

## Evidence

The oracle commit pins `phaser@3.90.0` in its lockfile. At Phaser tag
`v3.90.0`, `RandomDataGenerator.js` establishes:

- `rnd()` at lines 116-126, with no access to `n`;
- `hash()` and `sow()` at lines 139-218, where `n` is initialized and updated;
- `integer()` at lines 229-233, returning the multiplication directly; and
- `frac()` at lines 243-247, using literal `0x200000` and `| 0`.

Primary source:
<https://github.com/phaserjs/phaser/blob/v3.90.0/src/math/random-data-generator/RandomDataGenerator.js>

## Decision

- Correct `m3-js-number-rng.md` to the exact source expressions.
- Correct `m3-rng-oracle.md` to distinguish the seed-hash accumulator from
  draw state.
- Preserve the binary64 result of `integer()` exactly. Rust may convert it to
  `u32` only after finite, integral, range, and exact round-trip checks.
- Keep `rng_algorithm_version = 1`: no Rust M3 RNG implementation or accepted
  M3 RNG vector exists under the incorrect transcription, so this repairs the
  definition of version 1 rather than versioning a deployed behavior change.
- Leave production TypeScript, `rust/source-lock.toml`, all content manifests,
  and every non-RNG frozen API unchanged.

## Required evidence

- the M3 contract-freeze gate passes with the corrected documents;
- the freeze validator requires the corrected integer, fraction, and `n`
  descriptions and rejects all three stale transcriptions;
- M3A-01 starts from the corrected integration SHA;
- hosted native and wasm tests compare exact state strings, binary64 bits, and
  the first 1,000 primitive/range results against two fresh Phaser 3.90.0
  exports; and
- mutation tests independently fail for the old `0x200` multiplier, an added
  uint coercion at `integer()`, and any invented `rnd()` mutation of `n`.

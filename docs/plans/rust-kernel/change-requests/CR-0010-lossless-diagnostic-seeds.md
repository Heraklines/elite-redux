# CR-0010: lossless diagnostic seeds and observational counter saturation

Status: approved for the immediate M2 contract revision

Owner: integration owner

Base: `f6db3605418c6bc7ce62b7249c9c171c0d4764b8`

## Request

Preserve the complete deterministic network seed across native, wasm32,
JavaScript, JSON fixtures, and pair snapshots without weakening the `SafeU53`
rule for mechanical numeric values.

## Why the frozen contract was insufficient

The simulator intentionally accepts a full `u64` seed, but
`FaultNetworkDiagnostics.seed` and `PairSnapshot.seed` serialized that seed as a
JSON number. Values above JavaScript's safe-integer maximum cannot round-trip
exactly. A parity failure could therefore report a different seed from the one
that generated the run.

Diagnostic counters also used a saturating helper without a written contract.
Treating observational overflow as a protocol failure would make sufficiently
long diagnostics affect mechanics; silently saturating an unspecified value
would make audits ambiguous.

## Approved change

1. Internal configuration and RNG state retain the complete `u64` seed.
2. `FaultNetworkDiagnostics.seed` and `PairSnapshot.seed` are canonical unsigned
   decimal strings produced by `u64::to_string()`. No sign, whitespace, prefix,
   exponent, or redundant leading zero is emitted.
3. Diagnostic event counters remain `SafeU53` and saturate explicitly at
   `SafeU53::MAX`.
4. Diagnostic saturation is observational and cannot affect RNG state, packet
   identity/order, deadlines, queues, connection generations, or protocol
   behavior.
5. Mechanical cursors never saturate. Exhaustion or arithmetic overflow returns
   an explicit error before any network state, including RNG state, changes.

## Serialization and fixture impact

The diagnostic and pair-snapshot seed JSON field changes from a number to a
decimal string. Add the `u64::MAX` boundary to native/Wasm parity fixtures and
retain `SafeU53::MAX` tests for mechanical IDs/cursors.

## Affected lanes

M2-09 fault network, M2B-02 pair orchestration, M2B-09 native/Wasm parity,
M2B-11 benchmark metadata, and all failure reports that expose a seed.

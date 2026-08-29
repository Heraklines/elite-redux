# CR-0010: lossless diagnostic seeds and observational counter saturation

Status: approved for the immediate M2 contract revision

Owner: integration owner

Base: `4c73a48586d9d37a5560f46210bdd4ceb4ac14d0`

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

1. Internal configuration and diagnostic state retain the complete `u64` seed;
   the oracle-compatible RNG state is the explicitly truncated low 32 bits.
2. `FaultNetworkDiagnostics.seed` and `PairSnapshot.seed` are canonical unsigned
   decimal strings produced by `u64::to_string()`. No sign, whitespace, prefix,
   exponent, or redundant leading zero is emitted. Seed serialization and
   deserialization accept only that exact spelling and reject empty, signed,
   whitespace, exponent, leading-zero, and out-of-range values.
3. Diagnostic event counters remain `SafeU53` and saturate explicitly at
   `SafeU53::MAX`.
4. Diagnostic saturation is observational and cannot affect RNG state, packet
   identity/order, deadlines, queues, connection generations, or protocol
   behavior.
5. Mechanical cursors never saturate. Exhaustion or arithmetic overflow returns
   an explicit error before any network state, including RNG state, changes.

## M2 network parity and mechanical proof

6. The fault network uses the pinned oracle `mulberry32` stream from
   `test/tools/coop-authority-v2-simulator.ts` at game SHA
   `3b534099919efae827019d4a3f3c4ab0ecd6d67b`. The complete configured `u64`
   seed remains diagnostic state, while RNG entry applies the oracle's exact
   `seed >>> 0` truncation. Inclusive actions use
   `min + floor(next() * (max - min + 1))`; high seed bits therefore do not
   change the action stream.
7. A queued packet records both source and destination endpoint incarnations
   internally. Reconnect advances the shared pair generation for both endpoints;
   packets carrying a stale source or destination incarnation remain retained
   only for deterministic stale-drop/reaping and can never be delivered. The
   public packet wire shape is unchanged.
8. Packet-ID exhaustion, generation exhaustion, and delay-deadline overflow are
   mechanically tested as fail-atomic errors: RNG state, cursors, queue order,
   reorder markers, endpoint generations, connection flags, and diagnostics are
   unchanged on failure. Saturated observational counters are compared against
   an otherwise identical near-maximum run to prove isolation.
9. Cross-language RNG vectors are pinned in
   `rust/fixtures/v1/m2-network-rng-golden.json`; the fixture records the oracle
   game SHA/source and hard-coded `u32`/delay outputs rather than comparing two
   Rust implementations.

## Serialization and fixture impact

The diagnostic and pair-snapshot seed JSON field changes from a number to a
decimal string. Add the `u64::MAX` boundary to native/Wasm parity fixtures and
retain `SafeU53::MAX` tests for mechanical IDs/cursors. The M2 network fixture
also pins the oracle's low-32-bit seed truncation and inclusive delay sampling.

## Affected lanes

M2-09 fault network, M2B-02 pair orchestration, M2B-09 native/Wasm parity,
M2B-11 benchmark metadata, and all failure reports that expose a seed.

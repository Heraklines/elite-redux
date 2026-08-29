# PokéRogue Redux M3 JavaScript-number and RNG contract

Status: normative once the G6 contract-freeze commit is accepted.

This contract binds M3 to the pinned oracle's Phaser 3.90.0
`RandomDataGenerator` and JavaScript `Number` evaluation order. It describes
normal successful oracle behavior. M3 deliberately strengthens exceptional
behavior through clone-and-swap: a failed draw or transition restores all live
RNG state even where the TypeScript save/restore sequence lacks `finally`.

## Canonical generator state

```rust
pub struct PhaserRdgState {
    pub state_string: String,
    pub s0_bits: F64Bits,
    pub s1_bits: F64Bits,
    pub s2_bits: F64Bits,
    pub carry: u32,
}

pub struct F64Bits(String);

pub struct RunRngState {
    pub rdg: PhaserRdgState,
}

pub struct BattleRngState {
    pub battle_seed: String,
    pub turn: TurnIndex,
    pub saved_substream: Option<PhaserRdgState>,
}
```

`F64Bits` is exactly 16 lowercase hexadecimal digits containing the IEEE-754
binary64 bits, with no `0x` prefix. Canonical state never serializes `s0`,
`s1`, or `s2` as JSON numbers. `state_string` is the exact Phaser public form
`!rnd,c,s0,s1,s2`, generated with JavaScript number-to-string semantics and
validated to represent the same four canonical fields.

Phaser's private `n` seed-hash accumulator is excluded from M3 canonical
state. `sow()` resets it to `0xefc8249d`, `hash()` updates it while processing
seed UTF-16 code units, and `rnd()` does not read or mutate it. It is not
serialized/restored by Phaser and does not affect draws from an already sown
or restored generator; a later `sow()` resets it before use. M3 tracks its own
`SafeU53` audit sequence separately; unsupported direct hash APIs fail
capability validation.

A valid canonical state has finite `s0/s1/s2` in `[0,1)`, a carry representable
as `u32`, and a state string that reparses to the same bits and carry. Although
Phaser's permissive setter can install `NaN` through malformed text, M3 rejects
such state at a material/snapshot boundary rather than admitting poisoned
canonical state.

## Phaser 3.90.0 transition

One primitive `rnd()` call evaluates, in this exact order as binary64:

```text
t  = (2091639 * s0) + (carry * 2.3283064365386963e-10)
carry = ToInt32(t), then validated nonnegative for a canonical state
s0 = old s1
s1 = old s2
s2 = t - carry
return s2
```

No multiplication/addition is fused. The implementation may use integer
constants converted at the same source point, but may not reassociate the two
products or subtraction.

The selected public operations are exact:

| Operation | Evaluation | Primitive calls |
| --- | --- | ---: |
| `integer()` | `rnd() * 4294967296` | 1 |
| `frac()` | `rnd() + (ToInt32(rnd() * 2097152) * 2^-53)` | 2 |
| `realInRange(min,max)` | `frac() * (max - min) + min` | 2 |
| `integerInRange(min,max)` | `Math.floor(realInRange(0, max - min + 1) + min)` | 2 |
| `pick(values)` | `values[integerInRange(0, len - 1)]` | 0 when `len = 1`; 2 when `len > 1` |

The `frac()` multiplier is Phaser's literal `0x200000`; the following `| 0`
is the `ToInt32` coercion. Phaser's `integer()` source performs no `>>> 0`,
`| 0`, `Math.floor`, or other conversion at that call site. Its binary64
result is preserved exactly; a Rust integer representation is permitted only
after checking that the result is finite, integral, in `0..=u32::MAX`, and
round-trips to the same binary64 value.

`randSeedInt(cardinality, minimum)` returns `minimum` without a state swap or
primitive draw when `cardinality <= 1`. Otherwise it invokes
`integerInRange(minimum, minimum + cardinality - 1)`. Ranges are inclusive;
the standard damage roll is `minimum = 85`, `cardinality = 16`, result
`85..=100`.

`pick([])` is `RngError::EmptyPick` before audit-sequence allocation and
consumes no draw. A non-empty `pick` creates one logical `RngDraw` with
`public_api = Pick`, `minimum = 0`, `cardinality = len`, and `result` equal to
the selected zero-based index (not the selected value). Length one records a
non-consuming audit entry with result zero; length greater than one consumes
the same two primitive calls as `integerInRange`. The nested range helper does
not create a second audit entry.

Shuffle is descending Fisher-Yates. For `i = len - 1` through `1`, draw
`integerInRange(0, i)` and swap indices `i` and the result. Each swap is one
logical range draw and two primitive `rnd()` calls.

## Seed and state-string semantics

Phaser sowing is ported byte-for-behavior from 3.90.0:

1. reset `s0`, `s1`, `s2`, and carry exactly as Phaser does;
2. hash the single space seed into each state component;
3. coerce each supplied seed as JavaScript would, process UTF-16 code units in
   source order, and fold it into all three state components;
4. preserve every binary64 operation and floor/truncation point.

The M3 selected slice supplies string seeds only. Their canonical JSON must be
valid Unicode. Hashing and `shiftCharCodes` operate on UTF-16 code units, not
Unicode scalar values or UTF-8 bytes. A seed requiring an unpaired-surrogate
JSON carrier is outside M3 and fails closed.

The public parser accepts only the exact `!rnd,c,s0,s1,s2` shape required by a
validated fixture/material. Rust does not reproduce Phaser's acceptance of
trailing junk, missing values, `NaN`, or infinities at an untrusted boundary.
For valid strings, decimal parsing and serialization must round-trip to the
same binary64 bits as JavaScript.

## Run, offset, and battle streams

```rust
pub enum RngStream {
    Run,
    Battle,
    SeedOffset,
}
```

The streams are semantically distinct even though they use the same generator
algorithm.

`Battle.randSeedInt` is one atomic battle-cache transaction:

1. for cardinality `<= 1`, return immediately and record a non-consuming
   audit entry;
2. preserve the run generator and current seed-override context;
3. install `saved_substream` when present, otherwise sow exactly one string,
   `shiftCharCodes(battle_seed, turn << 6)`;
4. execute the selected range operation;
5. save the resulting generator as `saved_substream`;
6. restore the run generator and override context exactly.

Ordinary battle draws advance only the battle substream. Battle construction
may consume run/offset RNG separately; fixtures must record that initialization
or provide an already-constructed canonical state. `increment_turn` increments
the turn first and clears `saved_substream`. The first active oracle turn is
turn 1.

The speed-order shuffle uses a `SeedOffset` scope, not the cached battle
substream. It saves the run generator, sows from the oracle wave seed with
offset `turn * 1000 + list_length`, performs the exact shuffle, then restores
the run generator. The offset and wave-seed identity belong in each audit
entry's stream context.

Any direct global/float RNG seam not listed as supported in
`m3-capability-manifest.json` is rejected before resolution and consumes no
draw. M3 does not silently redirect a global draw into the battle stream.

## Closed audit

```rust
pub struct RngDraw {
    pub sequence: SafeU53,
    pub stream: RngStream,
    pub reason: RngReason,
    pub public_api: RngPublicApi,
    pub callsite_id: RngCallsiteId,
    pub minimum: SafeU53,
    pub cardinality: SafeU53,
    pub result: SafeU53,
    pub consumed: bool,
    pub primitive_draw_count: u8,
    pub before_state: RngAuditState,
    pub after_state: RngAuditState,
    pub before_fingerprint: String,
    pub after_fingerprint: String,
}

pub struct RngCallsiteId(String);

pub struct RngAuditState {
    pub run: PhaserRdgState,
    pub battle: Option<BattleRngState>,
    pub seed_offset: Option<SeedOffsetContext>,
}

pub struct SeedOffsetContext {
    pub wave_seed: String,
    pub offset: SafeU53,
}

pub enum RngPublicApi {
    RandSeedInt,
    IntegerInRange,
    Pick,
    FisherYatesSwap,
}

pub enum RngReason {
    BattleSeedCharacter,
    SpeedTie,
    ParalysisActivation,
    Accuracy,
    CriticalHit,
    DamageVariance,
    SecondaryEffect,
    MultiHitCount,
    AbilityChance,
}
```

Only reasons reachable from the frozen content manifest are permitted.
`MultiHitCount` and `AbilityChance` remain reserved closed values; if the
selected M3 content does not exercise them, they have zero coverage claims.
Arbitrary reason strings are forbidden.

One logical `integerInRange` or `pick` call creates one audit entry. A normal
consuming entry has `primitive_draw_count = 2`; the no-draw
`cardinality <= 1` fast path has zero. Nested scene/Pokémon/battle wrappers
correlate to one logical entry. The sequence is monotonic across every stream
in the owning game runtime so a first divergence is unambiguous.

`callsite_id` comes from the checked-in closed callsite map and includes the
exact pinned path/line identity used by the exporter. `before_state` and
`after_state` are complete exact-bit stream snapshots; fingerprints are the
canonical compact comparison of those same values and must recompute exactly.

Fingerprints are computed from the complete exact-bit state and stream
context. A parity error reports sequence, stream/reason, minimum/cardinality,
expected/actual result, primitive count, and both before/after fingerprints.
A final-state digest alone is insufficient.

## Draw order for the selected slice

The mechanically relevant order is:

1. speed-order offset shuffle before speed comparison when ordering requires
   it;
2. validate actor/command/move and finite PP availability without a draw;
3. per-action paralysis activation; a full stop consumes no PP and performs no
   target accuracy, critical, variance, or effect draw;
4. deduct PP exactly once after first-failure checks;
5. resolve any supported random target or hit-count draw (none unless the
   capability manifest explicitly enables one);
6. for each target in canonical target-array order, resolve damaging-move type
   and selected defensive ability immunity before accuracy; an immune target
   performs no accuracy, critical, variance, or HP draw;
7. perform the target accuracy draw unless the move is `AlwaysHits`;
8. for each successful damaging target, critical hit then damage variance;
9. run post-apply secondary/status/stat-stage chance at the frozen effect point;
   chance None or 100 consumes no chance draw;
10. reset the battle cache when the oracle increments the turn at turn end.

Status-category moves do not consult the ordinary damage type chart unless a
selected attribute explicitly requests it; M3 selects no such attribute.
Existing-status, type-status, and powder admission checks occur after a
successful accuracy/chance gate and consume no RNG. Wonder Guard applies only
to damaging `AttackMove` content and does not block a status attempt.

Ability hooks may insert a draw only at a trigger point explicitly frozen by
the content/action-order contracts. NONE, the selected Intimidate-like ability,
and the selected type-immunity ability are deterministic in the M3 slice and
consume no ability-chance draw.

## JavaScript arithmetic module

`er-battle/src/js_math.rs` owns:

```text
js_floor
js_ceil
js_trunc
js_round
js_min
js_max
js_clamp
safe_integer_from_f64
```

The helpers reproduce ECMAScript `Math` behavior for finite values and retain
the specified NaN and signed-zero behavior for unit tests. `js_round` rounds a
half toward positive infinity and preserves negative zero where JavaScript
does; Rust's half-away-from-zero `f64::round` is not a substitute. `js_min` and
`js_max` preserve JavaScript's signed-zero choice and NaN propagation.

Battle formulas use binary64 only where the pinned TypeScript evaluates a
`Number`. Source operation order is literal and load-bearing:

- no algebraic simplification or reassociation;
- no `mul_add`, FMA-dependent result, SIMD reduction, or fast-math;
- no early integer conversion;
- no saturating/clamping fallback unless the oracle calls the matching clamp;
- floor/ceil/trunc/round occurs only at the cited oracle point;
- overflow, NaN, infinity, and non-safe integer conversion are typed errors;
- transient floats never enter canonical game state or material.

`safe_integer_from_f64` accepts only finite integral values in
`[-9_007_199_254_740_991, 9_007_199_254_740_991]`, normalizes negative zero to
integer zero, and otherwise fails. Concrete damage operation and rounding
order is frozen separately in `m3-damage-oracle.md` and may not be rewritten
into an algebraically equivalent formula.

## Atomic failure and restoration

Every RNG operation runs on staged state. Invalid commands, unsupported
content, malformed ranges, arithmetic errors, failed material application, and
failed final validation consume no live draw and allocate no audit sequence.
Unlike the oracle's normal-path callback wrappers, Rust restoration is
exception-safe by construction: failed staged state is discarded with the
rest of the external step.

Hosted acceptance includes Phaser golden state strings and exact-bit states,
the first 1,000 primitive and range results for selected seeds, per-turn cache
reset/swap traces, speed-offset shuffles, native/wasm32 eventwise audits, and a
first-divergence mutation test. Golden vectors must be exported from two fresh
oracle processes; static source extraction alone is not parity evidence.

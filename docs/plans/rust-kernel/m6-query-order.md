# M6 query and JavaScript-number order

Oracle SHA: `3bb6d49c924293ef79e3ab2f11e10cf4f5b9c6c7`.

## Query contract

A query is an ordered fold over an immutable input value and the eligible behavior units for one hook. It may record audited RNG draws only at oracle-observed draw sites. It may not mutate canonical state.

The deterministic query key is the trigger-source order from `m6-trigger-order.md`, followed by behavior-unit ordinal. Query operands are typed. Callback source text, `serde_json::Value`, and dynamic trait-object dispatch are forbidden in canonical content.

Supported composition operations must be closed and explicit, including:

- replace;
- add/subtract;
- multiply/divide in authored order;
- min/max/clamp;
- boolean allow/deny;
- target-set filter/promote/replace;
- typed effectiveness, accuracy, priority, critical, and damage modifiers.

Commutative-looking operations are not reordered. Equivalent algebra is not necessarily JavaScript-equivalent.

## Damage order

Observed source evidence in `src/phases/move-effect-phase.ts:339-763`, with the existing Rust parity boundary in `rust/crates/er-battle/src/damage.rs:1-353`, freezes this sequence for ordinary damage:

1. level/base-power/offense/defense base expression in literal source operation order;
2. target-count modifier;
3. critical modifier;
4. random damage variance;
5. STAB;
6. type effectiveness;
7. burn modifier;
8. field multiplier last;
9. integer conversion at the oracle rounding boundary;
10. minimum-damage handling at the oracle boundary.

A mechanic that inserts an additional modifier must declare the exact hook stage. It cannot append an arbitrary multiplier after the final field boundary.

## JavaScript `Number` rules

- Use `f64` only where the oracle uses JavaScript `Number` intermediates.
- Preserve expression and rounding order exactly.
- Do not algebraically simplify.
- Do not use `mul_add`, fast-math, or saturating arithmetic.
- Convert to integer only at the observed oracle boundary.
- Reject non-finite or unsafe-integer results; do not clamp them silently.
- Canonical state stores resulting integers or exact IEEE-754 bit strings where the value itself is persistent RNG state. Transient query floats are not serialized.

## Accuracy, critical, and damage RNG

The ordinary move path keeps distinct draw reasons and order:

1. accuracy draw, only after non-RNG hit gates pass;
2. critical draw, only for a hit and a critical-eligible move;
3. damage variance draw, only for a damaging hit;
4. secondary-effect draws after primary damage/effect application at the authored hook.

An invalid command, illegal target, immunity gate, or deterministic miss/hit path must not consume a later draw. A parity failure reports the first divergent draw with reason, range, result, and before/after RNG fingerprints.

## Gap rule

The TypeScript oracle still expresses many query modifiers through callbacks. Static callback presence is classified as `BESPOKE_GAP`; it is not mapped to a generic arithmetic operation without a witness proving the exact selector, condition, order, and value operation.

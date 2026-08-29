# M6 trigger-source ordering

Oracle SHA: `3bb6d49c924293ef79e3ab2f11e10cf4f5b9c6c7`.

## Observed contracts

### Ability sources

`src/field/pokemon.ts:2979-3196,3222-3267` constructs ability sources in this order:

1. active ability;
2. passive slot 0;
3. passive slot 1;
4. passive slot 2;
5. runtime-added sources.

Duplicate ability IDs are removed while retaining the first source. Enemy passive-slot limits filter the ordered source list; they do not reorder it. `getAbilitySources()` represents structural presence. `getActiveAbilitySources()` applies unlock, suppression, faint, form, transform, Neutralizing Gas, and other runtime gates.

`src/data/abilities/apply-ab-attrs.ts:13-152,192-311` iterates the active source view in that order. Within one ability, attributes retain authored array order from `src/data/abilities/ability.ts:39-160,239-360`. Passive slot is part of trigger identity; legacy slot-zero fallback is not permission to erase it from M6 state.

### Move and target effects

`src/phases/move-effect-phase.ts:339-763` establishes the observed per-target gate sequence:

1. self/field target short-circuits;
2. Commander and semi-invulnerable gates;
3. protection;
4. reflection;
5. type effectiveness or immunity;
6. accuracy;
7. pre-apply callbacks;
8. move application;
9. post-apply and on-target callbacks.

M6 may split this into typed hooks, but the resulting mechanical order and RNG frontier must remain identical.

### Field state changes

`src/field/arena.ts` applies weather, terrain, and arena-tag lifecycle mutations before their post-change hooks. Side-aware arena tags and per-Pokémon battler tags are distinct sources. Stable source identity, side, slot, creation ordinal, and behavior-unit ordinal are required tie-break inputs.

## M6 ordering key

Mechanics IR V2 must derive a total order from typed fields, never hash-map iteration or class discovery order:

```text
hook stage
→ authored priority
→ source class rank
→ battle side / field slot
→ ability source rank or mechanic instance creation ordinal
→ behavior-unit ordinal
→ stable source identity
```

`authored priority` is used only where the oracle exposes one. Missing oracle priority is not synthesized from source names.

## Required negative behavior

- Suppressed or locked sources do not execute and do not consume RNG.
- A duplicate active/passive ability ID executes from its first retained source only.
- Empty or unavailable passive slots do not collapse later slot identity.
- Disabled held items remain canonical state but do not contribute effects.
- A source added during a hook cannot execute retroactively in an earlier ordering position.

## Open evidence gap

The source proves local lists and hook sites. It does not by itself prove one global cross-family order for every callback class. Any cross-family edge not represented above remains a witness obligation in `oracle-witness-plan-v1.json`; implementation workers must not infer it from class names or current Rust module order.

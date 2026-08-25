# M6 semantic extraction evidence

## Immutable inputs

- M5 production base: `200caaee1697fe40a293f0a5da76af8b11f3cea9`.
- TypeScript oracle: `3bb6d49c924293ef79e3ab2f11e10cf4f5b9c6c7`.
- Production TypeScript is read-only. The runtime extractor is a test-only overlay.
- Static outputs are canonical JSON and must be byte-identical across two fresh exports.
- Runtime outputs must be byte-identical across two fresh Vitest processes on the same pinned runner image and dependency lock.

## Frozen inventory

`rust/fixtures/m6/semantic-catalog-v1.json` contains 7,374 source identities and 9,388 behavior units:

| Source kind | Identities | Behavior units |
|---|---:|---:|
| Move | 1,110 | 2,092 |
| Active ability | 1,261 | 1,777 |
| Passive ability | 1,261 | 1,777 |
| Held item / modifier | 215 | 215 |
| Major status | 8 | 8 |
| Weather | 13 | 13 |
| Terrain | 6 | 6 |
| Battler tag | 123 | 123 |
| Arena tag | 42 | 42 |
| Positional tag | 3 | 3 |
| Species | 2,018 | 2,018 |
| Form | 534 | 534 |
| Unattached attribute, fixed dispatch, or RNG callsite | 780 | 780 |

Species identities include all 1,082 vanilla `SpeciesId` members, 881 `ErSpeciesId` object members, and 55 hand-authored newcomer/fakemon numeric declarations. Declared custom species not present in the final runtime registry remain explicit metadata gaps; every runtime-registered custom species must appear in this static superset.

Move extraction contains 1,112 declarations and 1,110 unique numeric identities; ability extraction contains 1,261 unique numeric identities including hand-authored `ER_*_ABILITY_ID` constants and `*_ABILITY_IDS` runtime-ID objects across the elite-redux tree. Aliases share one canonical behavior source. `ErMoveId`, `ErAbilityId`, and hand-authored vanilla-rebalance/newcomer constants (for example `FOREWARN_FUTURE_SIGHT_ID`) are catalogued alongside vanilla enums. Runtime-registered custom move/ability IDs must be present in these static supersets.

Resolution totals:

- `RESOLVED_INTRINSIC`: 3,634.
- `RESOLVED_OPERANDS`: 46.
- `BESPOKE_GAP`: 5,708.
- Unclassified identities or units: zero.

The M6B schema-upgrade checkpoint admits only the 46 behavior units whose implementation class, closed hook/effect, condition shape, and constructor operands match the audited exporter table exactly. Callback-bearing or shape-mismatched instances of the same class remain gaps.

## Evidence products

- `raw-source-catalog-v2.json`: source identities, definitions, constructor provenance, species/forms, raw dispatches, and raw RNG sites.
- `semantic-catalog-v1.json`: ordered source identities and behavior units with typed semantic descriptors.
- `behavior-unit-manifest-v1.json`: immutable behavior-unit identity surface.
- `primitive-gap-manifest-v1.json`: every callback or fixed-dispatch gap; no callback source text is embedded.
- `bespoke-clusters-v1.json`: deterministic gap clustering.
- `oracle-witness-plan-v1.json`: one positive and one negative witness obligation per behavior unit.
- `rng-site-manifest-v1.json`: all 273 RNG sites with stable identity, unique behavior-unit owner, domain/reason classification, and explicit non-executable range/stream/singleton gaps.

Behavior-unit identity is:

```text
source kind + numeric ID or registry key
+ behavior-unit kind
+ ordinal within that source/kind
+ provenance hash
```

Reordering, adding, removing, or changing an authored behavior therefore changes the catalog mechanically.

## Static versus runtime authority

Static AST extraction is authoritative for:

- enum and registry identity;
- source location;
- literal, enum, array, and object operands;
- callback presence and provenance hash;
- constructor order;
- species/form constructor metadata;
- fixed dispatch and raw RNG call-site inventory.

Runtime reflection is supporting evidence for the final post-initialization object graph:

- post-build flags and patches;
- final move and ability attribute arrays;
- modifier factory products;
- runtime-computed species/form collections;
- callback identities after module transformation.

Runtime reflection does not make a callback portable. A callback remains a bespoke gap until represented by closed Rust state and Mechanics IR V2 operations and covered by an oracle witness.

## Source-backed semantic families

### Moves

`src/data/moves/move.ts:259-523` defines fixed move fields, automatic flag seeding, ordered attributes, conditions, and restrictions. `src/phases/move-effect-phase.ts:339-763` supplies the current hit-resolution order. `src/data/moves/move-utils.ts:1-263` supplies target normalization, spread promotion, adjacency, and random-target selection.

### Active and passive abilities

`src/field/pokemon.ts:2979-3196,3222-3267,3372-3495,3623-3699,3789-3852` establishes active-first source enumeration, passive slots 0 through 2, deduplication, unlock rules, suppression, faint gates, and runtime applicability. `src/data/abilities/apply-ab-attrs.ts:13-152,192-311` applies attributes in that source order. Structural presence and runtime applicability are separate contracts.

### Held items and modifiers

`src/modifier/modifier.ts:211-292,731-905,1902-1975` establishes registry identity, subclass match/clone/argument semantics, holder binding, suppression gates, stack state, and berry consumption. `src/system/modifier-data.ts:1-59` and `src/data/elite-redux/er-persistent-modifiers.ts:1-69` define the save/reconstruction boundary.

### Status, field, and topology

`src/field/arena.ts`, `src/data/arena-tag.ts`, `src/data/battler-tags.ts`, `src/data/weather.ts`, and `src/data/terrain.ts` define separate arena-wide, side-aware, and per-Pokémon state with explicit lapse and suppression rules. `src/data/battle-format.ts` defines topology and legacy flat-index mapping. `src/data/pokemon-species.ts`, `src/data/pokemon-forms.ts`, `src/data/pokemon/pokemon-data.ts`, and `src/field/pokemon.ts` separate immutable species/form metadata from summon-scoped transform, illusion, ability, type, move, and stat overlays.

## Bespoke closure boundary

The 5,708 current gaps are grouped mechanically as:

| Cluster | Gap count |
|---|---:|
| Boss/custom ER | 1 |
| Charge/recharge lock | 12 |
| Custom dispatch | 3,287 |
| Delayed/scheduled effect | 4 |
| Item/berry lifecycle | 323 |
| Protect/endure/guard | 42 |
| Special damage/counter | 153 |
| Status/volatile/tag | 910 |
| Substitute proxy HP | 8 |
| Suppression/unusual immunity | 134 |
| Switch/trap/redirect | 119 |
| Transform/form copy | 658 |
| Weather/terrain/field | 57 |

These names are scheduling clusters, not implementations. G24 requires every member to be compiled or implemented through an explicit bespoke Rust mechanic with canonical state. No gap may become supported because an untyped callback is invoked, ignored, or treated as `NONE`.

## Known extraction limits

- Static parsing cannot determine callback semantics.
- Source inspection establishes state shape and hook sites but not every cross-phase ordering edge.
- RNG sites have conservative static domain/reason classifications and unique gap behavior owners. Range, stream, and singleton semantics remain explicitly non-executable until oracle witnesses close them.
- Runtime callback hashes are diagnostic evidence tied to the pinned transform toolchain, not stable cross-version behavior IDs.

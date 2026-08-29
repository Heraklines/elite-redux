# M5 oracle inventory

## Provenance

- Candidate oracle commit: `328824692f95b1aa1b38af85b54a6b72d9259eb4`.
- Candidate tree: `55ea78195244827bbacb21f7e0531b0827eae137`.
- M4 final base: `dde38446141880ec32331622307cc19105aee309`.
- M3 parity source: `3b534099919efae827019d4a3f3c4ab0ecd6d67b`.
- M4 oracle source: `45c89493e7edec9c4da247a98cd7858b1f015c09`.
- Machine inventory: `rust/fixtures/m5/source-catalog-v1.json`.
- Exporter: `scripts/export-kernel-m5-source-catalog.mjs`.

The exporter parsed 736 TypeScript mechanics files in the clean candidate worktree twice. Both outputs were byte-identical. Production TypeScript was not copied into or changed by the M5 integration worktree.

## Catalog closure

| Surface | Exact count | Source authority |
|---|---:|---|
| Move enum entries | 921 | `MoveId`, `ErMoveId` |
| Move registrations and patches | 942 | constructor calls with move IDs |
| Ability enum entries | 311 | `AbilityId`, `ErAbilityId` |
| Ability registrations | 311 | `AbBuilder` constructor calls |
| Modifier registry entries | 215 | `modifierTypeInitObj` |
| Ability-attribute classes | 672 | parsed class declarations and inheritance |
| Move-attribute classes | 263 | parsed class declarations and inheritance |
| Modifier classes | 175 | parsed class declarations and inheritance |
| Attribute attachments | 1,787 | `.attr` and `.conditionalAttr` calls |
| Ability/move/modifier dispatch sites | 180 | closed dispatcher call inventory |
| RNG call sites in mechanics roots | 249 | closed RNG call-name inventory |
| Battler-tag IDs | 123 | `BattlerTagType` |
| Arena-tag IDs | 42 | `ArenaTagType` |
| Positional-tag IDs | 3 | `PositionalTagType` |

Relative to the M4 source catalog, the candidate adds one move ID (`SWIRLY_ROOM`) and two modifier registry keys (`MOVE_RANDOMIZER`, `ER_GREATER_MOVE_RANDOMIZER`). It adds no ability ID and removes no move, ability, or modifier ID. Source behavior changed substantially: mechanic classes increase from 1,049 to 1,122 and the mechanics-root RNG-site count increases from 229 to 249. Therefore ID stability is not evidence of fixture parity; fresh-process M3 and M4 export is mandatory.

## Moves and move attributes

The source does not have one declarative move-effect vocabulary. A move is constructed from a concrete move class and chained attributes; later initialization passes may append or replace attributes. The source catalog therefore records both the 921-ID enum and all 942 constructor/patch registrations. A compiler must resolve the final post-initialization definition, not translate only `initMoves()`.

The 263 move-attribute classes include query modifiers, state mutations, target rewriting, delayed/volatile effects, multi-hit behavior, recoil/drain, switches, weather/terrain, side conditions, and presentation-producing effects. M5 IR admission is by an explicit compiler mapping from final runtime attribute shape to a closed IR operation. Class-name recognition without validated operands is forbidden.

## Abilities, passives, and archetypes

The candidate has 311 ability IDs and 311 primary `AbBuilder` registrations. The same ability definition can occupy the active slot or any passive source. Source execution order is:

1. active ability;
2. passive sources in stored slot order;
3. additional always-on sources appended by the source runtime;
4. duplicate ability IDs removed after eligibility/suppression gates.

`Pokemon.collectAbilitySources()` is the ordering authority. Enemy passive eligibility is level-gated. The normal source has exactly three persistent passive slots, while additional runtime sources are distinguished from those slots and are not mutable by passive-slot operations. The compiler must not flatten all ability sources into an unordered set.

`applyAbAttrs()` iterates the final ability attribute vector in declaration/patch order. For each attribute it evaluates source eligibility, attribute filter, condition, and `canApply`; then it records presentation and applies the attribute. M5 must preserve this stable ordering through explicit `source_rank`, `hook_rank`, and `program_order` keys.

The 672 parsed ability-attribute classes include 151 direct `AbAttr` subclasses plus timed subclasses such as `PostSummonAbAttr`, `PostAttackAbAttr`, `PostDefendAbAttr`, `PostTurnAbAttr`, and query modifiers. Dynamic function operands in the source are compiler inputs, not executable content in Rust. Each must compile to a closed condition/selector/value node, a named bespoke implementation, or an unsupported classification.

## Held items and modifiers

`modifierTypeInitObj` contains 215 stable registry keys. The runtime modifier hierarchy contains 175 parsed modifier or modifier-type classes in the mechanics roots. Registry identity is the string key; display text, constructor name, and reward-pool position are not identity.

Battle-relevant held-item behavior participates in the same ordered hook/query pipeline as move and ability mechanics. Run-only reward, market, currency, unlock, and UI modifiers remain in `RunContentPackV2`; battle-visible held items compile into `BattleContentPackV2`. An item reachable from a battle party must be classified before battle initialization. Unsupported battle-visible items fail closed rather than becoming inert inventory.

## Status, volatile, weather, terrain, and field inventory

Major status IDs are exact: `NONE=0`, `POISON=1`, `TOXIC=2`, `PARALYSIS=3`, `SLEEP=4`, `FREEZE=5`, `BURN=6`, `FAINT=7`.

Weather IDs are exact: `NONE=0`, `SUNNY=1`, `RAIN=2`, `SANDSTORM=3`, `HAIL=4`, `SNOW=5`, `FOG=6`, `HEAVY_RAIN=7`, `HARSH_SUN=8`, `STRONG_WINDS=9`, `TEMPEST_STORM=10`, `SNOWY_WRATH=11`, `EERIE_FOG=12`.

Terrain IDs are exact: `NONE=0`, `MISTY=1`, `ELECTRIC=2`, `GRASSY=3`, `PSYCHIC=4`, `TOXIC=5`.

Volatile mechanics are distributed across 123 battler-tag IDs, 42 arena-tag IDs, and 3 positional-tag IDs. Their state includes remaining turns, source identity, side/slot ownership, counters, payload values, lapse policy, and transfer/removal behavior. M5 must store this state in versioned canonical mechanic instances. Reconstructing volatile behavior from presentation events or class names is forbidden.

## Trigger and query order

The oracle has two distinct operation kinds:

- **queries** update a typed accumulator without directly mutating canonical state;
- **triggers** evaluate conditions/selectors and emit ordered mutations plus presentation cues.

For a source/hook pair the stable order is active ability, passive slot order, held-item order, status/volatile order, side/arena order, move program order, then explicit bespoke order where the frozen hook contract says so. Order is never derived from hash-map iteration.

The candidate damage query demonstrates why a generic unordered multiplier list is invalid. Its observable order is category rewrite; type/effectiveness; arena weather/terrain; fixed/OHKO branches; base damage; spread and multi-strike modifiers; crit; random roll; STAB; type; burn/frostbite; tags/screens/terrain/relics; integer conversion; post-formula field and ability boosts; enemy tokens; consumable and held-item boosts; defensive abilities and allies; move `ModifiedDamageAttr`; endure; suppression ceiling; nullification; and final bespoke calculated-damage hooks. Each integer conversion remains at its source position.

## Targeting topology

`MoveTarget` has 28 closed IDs covering user, ally, enemy, spread, side, party, counterattacker, and Curse-specific selection. Targeting first applies `VariableTargetAttr`, then ability-granted spread rewriting, then side selection, then adjacency filtering, then active-target filtering.

Near-target adjacency is topology data, not fixed battler arithmetic. In triples, wings cannot reach the far diagonal; centre positions reach every adjacent slot. Flying and pulse moves bypass near adjacency. A lone remaining battler is treated as centred. `RANDOM_NEAR_ENEMY` consumes one battle RNG draw after the opponent candidate list is formed. M5 selectors must model all of these steps explicitly.

## RNG additions

The mechanics-root catalog contains 249 closed-name RNG call sites. Battle mechanics use the existing Phaser-compatible battle stream; run generation uses the run stream. Random target selection, chance conditions, multi-hit counts, duration/count selection, item selection, and move selection must each use a closed `RngReason` and preserve call order.

Five `Math.random()` sites exist in catalogued roots. Two are co-op session-token/transport concerns and three are achievement-reward concerns; none is admissible to deterministic battle or run-mechanics IR. The compiler rejects any reachable catalog entry whose mechanical path depends on an unclassified nondeterministic RNG seam.

## M4-to-M5 state and snapshot audit

M4 canonical roots are `GameStateV2`, `BattleStateV2`, and `PokemonStateV2`; endpoint and pair restoration use snapshot V3. M5 needs schema V3 state because generalized mechanics add state that cannot be reconstructed from the M4 selected slice:

- Pokémon-held item instances and ordered source identity;
- battler volatile instances and counters;
- side, arena, weather, terrain, and positional mechanic instances;
- per-instance source, owner, target, creation order, remaining duration, counters, and typed payload;
- compiled program/content identities used to interpret every instance.

Migration is one-way and explicit. M4 selected status, arena-condition, ability-loadout, and modifier state maps to corresponding V3 mechanic instances with stable addresses. Unknown V2 data, missing program IDs, duplicate addresses, or unsupported reachable content fails migration. V3 never infers a mechanic from UI or presentation state.

Snapshot V4 must carry the V3 game state, BattleContentPackV2 and RunContentPackV2 hashes, mechanics program version, internal event state, pending material V3, input/router/scheduler/protocol state, presentation barriers, and the complete pair network/fault state. Continuation parity must hold across native and Wasm after restoration.

## Architectural risks

1. Class-name scanning is not an executor. It is only catalog evidence.
2. Source callbacks and closures cannot cross the compiler boundary.
3. Query and mutation hooks need separate typed APIs.
4. Hook/source order must be explicit and covered by differential fixtures.
5. Every catalog identity must have exactly one final classification.
6. A compiled pack may contain only validated programs, named bespoke references, or explicit unsupported entries; reachable unsupported entries fail initialization.
7. Host and replica continue to apply the same serialized material. Mechanics IR does not create a host-only state path.
8. M0–M4 compatibility remains versioned and read-only; M5 does not mutate the frozen M4 final manifest or production TypeScript.

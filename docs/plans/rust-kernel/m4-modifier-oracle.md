# M4 Modifier Oracle

- Status: frozen M4-00 oracle evidence
- M4 base SHA: `45c89493e7edec9c4da247a98cd7858b1f015c09`
- TypeScript oracle SHA: `45c89493e7edec9c4da247a98cd7858b1f015c09`
- Evidence mode: read-only source extraction; observed behavior is distinguished from proposed Rust contracts and explicit gaps in the text below.

## Summary

M4-00 modifier oracle extraction for TypeScript @ 45c89493e7edec9c4da247a98cd7858b1f015c09. Observed modifier identity is a stable string registry key, not a numeric ModifierId. The narrow, closed M4 proposal should support: persistent acquisition/stack algebra for AMULET_COIN, CANDY_JAR, EXP_CHARM, SUPER_EXP_CHARM, GOLDEN_EXP_CHARM, HEALING_CHARM, and LOCK_CAPSULE; immediate POTION/SUPER_POTION/HYPER_POTION/MAX_POTION healing on a living selected target with no ER_BLEED; NUGGET/BIG_NUGGET/RELIC_GOLD under neutral money-callback invariants; and RARE_CANDY/RARER_CANDY under selected-species/no-learn/no-evolution invariants. It should defer status-curing/revive items, held EXP eggs, participation/share/balance mechanics, arbitrary move/ability healing, actual locked reward generation, Golden Punch/Coin Case, every evolution/form-change item, and every callback-driven branch listed below. No selected modifier-effect application draws RNG; lock-controlled reroll generation does, and its exact draw order is recorded below.

## Source evidence

### `src/modifier/modifier-type.ts`

Canonical string IDs/factories, target type classes and UI filters, exact modifier constants, reward generation, lock-tier RNG, full-stack fallback type, and option-cost rounding. Key symbols: ModifierType, PokemonModifierType, PokemonHpRestoreModifierType, PokemonReviveModifierType, PokemonStatusHealModifierType, PokemonLevelIncrementModifierType, AllPokemonLevelIncrementModifierType, MoneyRewardModifierType, ExpBoosterModifierType, modifierTypeInitObj, getPlayerModifierTypeOptions, getNewModifierTypeOption, getDefaultModifierTypeForTier.

### `src/modifier/modifier.ts`

Runtime target matching, stacking, max stacks, immediate/persistent effect algebra and callbacks. Key symbols: Modifier, PersistentModifier, ConsumableModifier, PokemonHeldItemModifier, ConsumablePokemonModifier, PokemonHpRestoreModifier, PokemonStatusHealModifier, LevelIncrementBoosterModifier, PokemonLevelIncrementModifier, ExpBoosterModifier, PokemonExpBoosterModifier, HealingBoosterModifier, MoneyRewardModifier, MoneyMultiplierModifier, MoneyInterestModifier, DamageMoneyRewardModifier, LockModifierTiersModifier.

### `src/battle-scene.ts`

Causal owner of modifier add/apply, party iteration, heal multiplier injection, money formula/mutation, persistent application order, EXP distribution, and scene RNG seed. Key symbols: addModifier, applyModifiers/Internal, applyModifier, addMoney, getWaveMoneyAmount, applyPartyExp, resetSeed.

### `src/phases/select-modifier-phase.ts`

Reward/market target selection, apply-before-payment behavior, co-op target relay, lock toggle, reroll cost, captured prior tiers, and reroll phase sequencing. Key symbols: applyChosenModifier, openModifierMenu, buildPokemonModifier, applyModifier, toggleRerollLock, rerollModifiers, getRerollCost, getModifierTypeOptions.

### `src/phases/exp-phase.ts`

On-field EXP delivery: global EXP charms in modifier-array order, then dynamic ability multiplier, final floor, addExp, and possible LevelUpPhase.

### `src/phases/show-party-exp-bar-phase.ts`

Bench EXP delivery with the same mechanical global-charm/ability/floor order as ExpPhase.

### `src/phases/level-up-phase.ts`

Deferred level presentation followed by dynamic level-move discovery and evolution selection; authoritative co-op guest skips evolution and host owns it.

### `src/phases/pokemon-heal-phase.ts`

General move/item phase-heal hook: heal-block and ER_BLEED precede Healing Charm; charm is excluded for revive; heal is floored before Pokemon.heal.

### `src/phases/reset-status-phase.ts`

Deferred phase which performs Pokemon.clearStatus after Full Heal/Full Restore/Revive application has already returned.

### `src/field/pokemon.ts`

resetStatus queues ResetStatusPhase by default; clearStatus mutates vanilla status/confusion and records co-op status events.

### `src/data/elite-redux/er-status-cure.ts`

Immediate custom-ailment clear list/order: ER_BLEED, ER_FROSTBITE, ER_FEAR; mechanical ER_ITEM_DISABLED and ER_ICE_STATUE are deliberately not cured.

### `src/data/elite-redux/archetypes/ability-meta-consumers.ts`

Dynamic ability-marker reducers for EXP and battle-money multipliers.

### `src/data/elite-redux/er-money-streak.ts`

Dynamic party money-streak callback used inside every getWaveMoneyAmount call.

### `src/data/elite-redux/er-balance-knobs.ts`

Default numeric tuning: rerollBase 250, locked tier values [50,125,300,750,2000], Rare Candy friendship 6.

### `src/data/elite-redux/er-balance-tuning.ts`

Runtime resolution of validated JSON overrides over the numeric defaults; selected Rust fixtures must freeze resolved values rather than assume defaults silently.

### `src/modifier/init-modifier-pools.ts`

Observed normal player tiers: numeric ModifierTier COMMON=0, GREAT=1, ULTRA=2, ROGUE=3, MASTER=4. Narrow item assignments are listed in the architecture findings.

### `src/enums/modifier-tier.ts`

Numeric tier enum order: COMMON 0, GREAT 1, ULTRA 2, ROGUE 3, MASTER 4, LUXURY 5.

### `src/utils/common.ts`

randSeedInt(range,min): no draw for range<=1; otherwise Phaser.Math.RND.integerInRange(min, range-1+min), inclusive at both stated endpoints.

### `src/data/elite-redux/coop/coop-reward-operation.ts`

Live reward operation action-slot addressing, owner parity, intent-before-mutation, terminal rules, and REWARD/SHOP_BUY kind selection.

### `src/data/elite-redux/coop/coop-operation-envelope.ts`

Live operation ID format `${epoch}:${owner}:${kind}:${pinnedSeq}` and parser.

### `src/data/elite-redux/coop/coop-session.ts`

Interaction owner seat is normalized counter modulo player count; for two players even counter=>seat 0, odd=>seat 1.

### `src/data/elite-redux/coop/coop-operation-address.ts`

Reward action stride is 100000; each ambient/Mystery surface action range uses stride 5000 in coop-reward-operation.ts.

### `src/data/elite-redux/coop/authority-v2/adapters/interactions-reward.ts`

Defines unused adapter-local IREW/IMKT address helpers. No production caller of rewardOperationId was found; do not substitute IREW for the live phase's colon-form ID without new evidence.

## Architecture and contract guidance

## Evidence labels
All statements below marked **Observed** come from production TypeScript at the pinned SHA. **Proposed M4** is a deliberately narrower Rust contract. **Gap/deferred** means TypeScript invokes dynamic state/callbacks or a later phase and this extraction does not guess their outcome.

## Identity and target kinds

**Observed.** `initModifierTypes` copies every `modifierTypeInitObj` entry into `modifierTypes`; pool construction/reward fix-up writes the registry key into `ModifierType.id` (`modifier-type.ts:2188-2192,2250-2253,2947-2949,3104-3106,3760-3763`). Therefore exact modifier content IDs are strings. There is no numeric modifier-content enum in this surface. Numeric values that are actually observed must remain numeric: tier IDs are COMMON=0, GREAT=1, ULTRA=2, ROGUE=3, MASTER=4, LUXURY=5 (`modifier-tier.ts:1-8`); Gimmighoul is species content ID 999 (`er-species.ts:175976-175979`). A held/targeted instance stores a runtime `Pokemon.id`, not a numeric species/content ID (`modifier.ts:694-721,2089-2116`).

Target kinds are:
1. **Run-wide persistent:** ordinary `ModifierType` creates a `PersistentModifier`; acquisition adds/stacks it in `globalScene.modifiers`, and its effect runs later only when the relevant hook calls `applyModifier(s)`.
2. **Run-wide immediate:** ordinary `ModifierType` creates a `ConsumableModifier`; acquisition invokes it immediately and never stores it.
3. **One party member:** `PokemonModifierType` opens PARTY, resolves a party slot to the live Pokémon, constructs the modifier with that Pokémon's runtime ID, then `addModifier` iterates the party and `shouldApply` matches exactly that ID (`select-modifier-phase.ts:1271-1349,1572-1620`; `modifier.ts:2089-2117`; `battle-scene.ts:3845-3878`).
4. **Whole party:** `RARER_CANDY` constructs `PokemonLevelIncrementModifier(...,-1)`; `-1` matches every party member. Mutation iterates party order synchronously; each apply unshifts a LevelUpPhase, so mutations occur forward in party order while later-unshifted presentation phases can execute before earlier ones (`modifier-type.ts:1315-1327,2258-2261`; `battle-scene.ts:3849-3878`).
5. **Held owner:** Lucky/Golden Egg store runtime Pokémon ID and match by both effect type and ID. Their effects can be disabled/suppressed by `erIsHeldItemDisabled`/`erIsHeldItemSuppressed`, so they are not callback-free (`modifier.ts:694-759`).

## Add, stacking, and ordering

**Observed.** Persistent construction throws when `type.id` is blank. `PersistentModifier.add` scans the live array in order. First matching instance receives the incoming `stackCount`; otherwise the new instance is appended. A stack succeeds only if combined real+virtual stacks do not exceed max. `updateModifiers` does not sort the mechanical array; only `ModifierBar.updateModifiers` sorts filtered clones for UI. Consequently every `applyModifiers` filter and loop preserves live modifier-array/insertion order (`modifier.ts:194-256`; `battle-scene.ts:4226-4258,4374-4428`; `modifier.ts:84-125`).

If a non-virtual persistent add exceeds max, TypeScript does not simply reject it: `addModifier` queues a full-stack message and recursively grants the first pool entry for that tier (`battle-scene.ts:3783-3844`; `modifier-type.ts:3619-3627`). Those defaults are Poké Ball, Great Ball, Ultra Ball, Rogue Ball, or Master Ball according to tier. **Proposed M4:** pre-admit `current+incoming<=max`; reject an out-of-cap selected operation rather than silently importing ball inventory into the narrow modifier capability.

Exact stack/effect rules:
- `AMULET_COIN` -> `MoneyMultiplierModifier`, matches any instance of that class, max 5. Hook: `value += floor(value*0.2*S)` (`modifier.ts:3528-3549`).
- `CANDY_JAR` -> `LevelIncrementBoosterModifier`, class match, max 99. Hook: level-count holder `+=S` (`modifier.ts:1818-1847`).
- `EXP_CHARM` 25%, `SUPER_EXP_CHARM` 60%, `GOLDEN_EXP_CHARM` 100%. `ExpBoosterModifier` matches only equal internal multiplier, so unlike IDs remain separate instances; max is 99 for 25%, 30 for 60%, 10 for 100%. Each hook does `value=floor(value*(1+S*p))` (`modifier.ts:3102-3140`; factories `modifier-type.ts:2603-2608`). Separate instances apply in insertion order and floor after each. Concrete proof of order sensitivity: input 3 with 25% then 60% becomes `floor(floor(3*1.25)*1.6)=4`; reverse acquisition becomes `floor(floor(3*1.6)*1.25)=5`.
- `HEALING_CHARM` -> multiplier parameter 1.1, class match, max 5. Hook multiplier becomes `1+(1.1-1)*S = 1+0.1S`, linear rather than exponential (`modifier.ts:3065-3100`; factory `modifier-type.ts:2700-2712`).
- `LOCK_CAPSULE` -> class match, max 1; its `apply` is a no-op returning true. Presence merely exposes the lock control (`modifier.ts:3692-3714`; `modifier-select-ui-handler.ts:281-299,438-454`).

Normal player-pool tier IDs: RARE_CANDY/POTION/SUPER_POTION are 0; FULL_HEAL/REVIVE/MAX_REVIVE/HYPER_POTION/MAX_POTION/FULL_RESTORE/NUGGET are 1; BIG_NUGGET/AMULET_COIN/CANDY_JAR/RARER_CANDY/EXP_CHARM are 2; RELIC_GOLD/LOCK_CAPSULE/SUPER_EXP_CHARM are 3; HEALING_CHARM is 4 (`init-modifier-pools.ts:65-230,270-405,600-765`). GOLDEN_EXP_CHARM has an exotic-shop registry entry but no ordinary player-pool tier in this source (`er-exotic-shop.ts:43-49`).

## Immediate money effects

Factories are exact: `NUGGET=1`, `BIG_NUGGET=2.5`, `RELIC_GOLD=10` wave-money multipliers; `AMULET_COIN` is persistent (`modifier-type.ts:2639-2677`). `MoneyRewardModifier.apply` performs, in order: (1) `getWaveMoneyAmount(multiplier)`; (2) every MoneyMultiplierModifier in live insertion order; (3) `addMoney`; (4) party scan for species/fusion GIMMIGHOUL 999 and add an evolution tracker with factor `min(floor(moneyMultiplier),3)` (`modifier.ts:3493-3526`).

`getWaveMoneyAmount` computes `waveSet=ceil(wave/10)-1`, then `((waveSet+1 + 0.75 + ((((wave-1)%10)+1)/10))*100)^(1+0.005*waveSet) * itemMultiplier`, multiplies by `1+erTeamMoneyBonusPercent()/100`, and floors to a multiple of 10. `addMoney` then optionally floors a Coin Purse multiplier, clamps the resulting balance above at `Number.MAX_SAFE_INTEGER`, updates UI, and validates achievements (`battle-scene.ts:3757-3781`). No selected money modifier draws RNG. At wave 9 with streak=0, Coin Purse=0: NUGGET=260, BIG_NUGGET=660, RELIC_GOLD=2650 before Amulet Coin; one Amulet stack yields 312, 792, and 3180 respectively.

**Proposed M4 money closure:** support these three consumables only with explicitly captured wave, resolved streak bonus 0, Coin Purse bonus 0, no base/fusion species 999, and a balance that cannot hit the safe-integer cap. Otherwise reject as `unsupported_dynamic_money_callback`. Defer `GOLDEN_PUNCH` (damage-time holder hook), `COIN_CASE` (biome-transition interest plus queued localized message), battle MoneyRewardPhase ability snapshots, Happy Hour, and Gambler's Coin (`modifier.ts:3551-3608`; `money-reward-phase.ts:18-76`).

## Level and EXP

`RARE_CANDY` targets one Pokémon; `RARER_CANDY` targets all via ID -1 (`modifier-type.ts:2258-2261`). For each target, `PokemonLevelIncrementModifier.apply` starts a holder at 1, applies Candy Jar(s), snapshots stats/last level, immediately adds `1+S` levels, conditionally resets cumulative EXP to `getLevelTotalExp(newLevel,growthRate)`, adds resolved Rare-Candy friendship (default 6 but JSON-tunable), recalculates stats synchronously, snapshots new stats, then unshifts LevelUpPhase (`modifier.ts:2827-2865`). The `getMaxExpLevel(true)` call normally returns MAX_SAFE_INTEGER, but a positive `LEVEL_CAP_OVERRIDE` still wins; if the new level exceeds it, EXP is left unchanged (`battle-scene.ts:3209-3221`). There is no RNG here.

LevelUpPhase later performs UI/achievement work, discovers level moves, may open LearnMoveBatchPhase, calls `getValidEvolutions`, and queues EvolutionPhase; authoritative co-op guest skips evolution while host owns it (`level-up-phase.ts:32-151`). **Proposed M4 closure:** support candy only for the selected GrowthStats species set, with frozen balance value 6, no positive level-cap override crossed, and an oracle-proven empty level-move/evolution candidate set across the entire `(oldLevel,newLevel]` range. Otherwise stop; do not guess callbacks.

EXP causal order is split across owners. `applyPartyExp` builds participation/share/pokerus multiplier, applies each eligible held egg booster (each floors), floors into `partyMemberExp`, optionally performs Exp Balance interpolation, then queues an on-field or bench phase (`battle-scene.ts:4728-4834`). ExpPhase/ShowPartyExpBarPhase later applies global charms in insertion order (each floors), multiplies dynamic eligible ability markers, floors, adds EXP, and queues LevelUpPhase if needed (`exp-phase.ts:19-52`; `show-party-exp-bar-phase.ts:19-40`; `ability-meta-consumers.ts:106-112`). **Proposed M4:** support only the global charm algebra on an already-resolved nonnegative finite EXP holder, preserving insertion order and per-instance floors. Participation, Exp Share, Exp Balance, Oval Charm, Pokerus, ability markers, Lucky Egg, and Golden Egg remain owned/deferred to the participation/ability/item lanes.

## Healing

Exact factory constants (`modifier-type.ts:2309-2325`): POTION points=20/percent=10; SUPER=50/25; HYPER=200/50; MAX=0/100; FULL_RESTORE=0/100+status; REVIVE=0/50+fainted; MAX_REVIVE=0/100+fainted; FULL_HEAL is status-only.

For a non-revive HP item, `addModifier` first creates multiplier 1, applies Healing Charm(s), and passes its numeric value to the consumable. Revive passes literal 1 and excludes charms (`battle-scene.ts:3856-3867`). `PokemonHpRestoreModifier.apply` checks `(!pokemon.hp)===fainted`; for living healing it floors `restorePoints*multiplier`; healing amount is `max(floor(percent/100*maxHP), scaledPoints, 1)` (the surrounding ceil is inert for these integers), then clamps HP to max. Full Restore/Revive first queues `resetStatus(true,true,false,false-default? no: fourth argument omitted, therefore asPhase defaults true)`, immediately clears ER ailment tags, then mutates HP. Ordinary Potion-family healing immediately removes ER_BLEED but still restores HP (`modifier.ts:2155-2230`; `pokemon.ts:7376-7417`; `er-status-cure.ts:49-67,96-107`). Thus vanilla status clearing is deferred to ResetStatusPhase, while ER tags and HP mutate before `apply` returns.

The UI selection filters reject fainted targets for potions, unaffected/full targets as appropriate, and non-fainted targets for revive; revive additionally calls dynamic `ChallengeType.PREVENT_REVIVE` (`modifier-type.ts:506-621`). These are UI filters, not all rechecked by `apply`. General PokemonHealPhase additionally checks Heal Block and consumes a positive heal to cure ER_BLEED before Healing Charm; it excludes charms for revive and floors `hpHealed*multiplier` before `pokemon.heal` (`pokemon-heal-phase.ts:72-129`).

**Proposed M4 closure:** support POTION/SUPER_POTION/HYPER_POTION/MAX_POTION only for a validated living selected target with positive missing HP, no ER_BLEED, no status-cure responsibility, and an already-resolved max HP. Preserve point scaling/floor/max/clamp exactly. Defer FULL_RESTORE, FULL_HEAL, REVIVE, MAX_REVIVE, SACRED_ASH, arbitrary PokemonHealPhase sources, Heal Block/Bleed, challenge gates, ResetStatusPhase ordering, revive achievement dynamic import, and status-event recording.

## Lock enabling and RNG

Acquiring LOCK_CAPSULE only stores the persistent max-1 capability. Toggling checks reroll availability, publishes co-op intent before mutation, flips `globalScene.lockModifierTiers`, records it, updates UI/cost, and commits the result (`select-modifier-phase.ts:930-965`). No toggle RNG draw occurs. On reroll, cost is computed before mutation. Default unlocked base is 250; locked base is the sum of current option tier values `[50,125,300,750,2000]`. Then `ceil(wave/10) * base * 2^rerollCount * customMultiplier`, capped at MAX_SAFE_INTEGER, is passed through first HealShopCostModifier and then dynamic Merchant's Seal, with final floor (`select-modifier-phase.ts:1438-1487`; `er-balance-knobs.ts:265-287`). Payment precedes creation/shift to a new SelectModifierPhase, which carries the prior displayed tiers; the next phase uses those tiers only when the global lock flag is true (`select-modifier-phase.ts:761-829,1489-1501`).

Actual reward generation is not callback-free. RNG source is global `Phaser.Math.RND`, sown with `shiftCharCodes(runSeed,wave)` on a fresh screen; reroll phases do not reset it (`select-modifier-phase.ts:465-481`; `battle-scene.ts:2932-2937`; `common.ts:95-115`). Per unlocked slot: draw tier in `[0,1023]`; unless tier draw is zero, perform at least one luck-upgrade draw and continue while `<4`; then draw weighted pool index. Per explicit locked tier: luck-upgrade draws continue tier-by-tier until first failure, then weighted pool-index draw. Generators/gates and duplicate retries can consume further draws (`modifier-type.ts:3187-3236,3490-3609`). Therefore **Proposed M4** supports acquisition, boolean toggle, and cost arithmetic only with frozen default tuning and no HealShopCost/Merchant's Seal/custom multiplier; actual reroll results remain unsupported until the complete pool weights, party callbacks, challenge callbacks, dynamic generators, appearance gates, and exact Phaser RNG state are selected together.

## Immediate/persistent causal order and failure

A non-party consumable is applied immediately after the co-op pending choice is flushed. A party modifier waits for target selection/relay, reconstructs from party slot to runtime ID, then applies (`select-modifier-phase.ts:740-757,1271-1349`). A persistent acquisition mutates the modifier list first and calls `updateModifiers`; that routine launches asynchronous party stat/info updates but `addModifier` does not await them. A consumable applies synchronously and then calls each party member's `updateInfo` without awaiting (`battle-scene.ts:3783-3881,4226-4270`). Do not claim those presentation callbacks are settled at the return boundary.

`addModifier` returns false for null/type-less inputs. Targeted consumables return success iff at least one matched apply returns true. Paid shop flow deducts money only after true; on false it errors, and a co-op owner with an exposed operation fails the shared session rather than committing a rejected result. A true paid application mutates first, then deducts/adopts owner money (`select-modifier-phase.ts:1065-1152`). Free reward flow closes/commits through a separate branch; this extraction does not infer a rollback for an unexpected false consumable result. Target filters should be enforced before constructing a selected M4 operation.

## Co-op operation identity and owner

For the live reward phase, owner seat is `((trunc(counter)%2)+2)%2`: even pin=>seat 0, odd=>seat 1 (`coop-session.ts:239-243`). Wrong-seat intents fail the owner-parity validator. The owner publishes an intent before target/money/lock mutation; a watcher never opens PARTY and applies the relayed `[partySlot,subOption]` directly (`select-modifier-phase.ts:1271-1347`; `coop-reward-operation.ts:609-617,779-831`). The live ID is `epoch:owner:kind:actionSlot`, kind `REWARD` or `SHOP_BUY`; ambient `actionSlot=pin*100000+ordinal`, while ordered Mystery surfaces add `(surfaceOrdinal+1)*5000` before ordinal (`coop-operation-envelope.ts:596-635`; `coop-reward-operation.ts:176-240,562-565`). A free reward pick is terminal; paid buy/check/transfer/lock and reroll retain the surface, and explicit leave is terminal (`coop-reward-operation.ts:580-607`). The separate `IREW/e...` helper in `authority-v2/adapters/interactions-reward.ts:296-304` has no production caller found and is not evidence to rename live operations.

## Explicit unanswered gaps / stop conditions

1. Authority material capture versus deferred ResetStatusPhase settlement is not established by the modifier call itself; Full Heal/Restore/Revive must remain deferred until the run-flow/authority oracle fixes that boundary.
2. `LevelUpPhase` callback results (learn choices, branched evolutions, forms, co-op adoption) are not derivable from the candy modifier alone.
3. `EVOLUTION_ITEM`, `RARE_EVOLUTION_ITEM`, `FORM_CHANGE_ITEM`, and `RARE_FORM_CHANGE_ITEM` depend on party-specific `validate`/`canChange` callbacks and seeded generator choice; none belongs in the selected modifier capability.
4. Money streak, Coin Purse, Gimmighoul tracker, battle-end ability markers, Gambler's Coin, Merchant's Seal, and editable balance tuning are external dynamic callbacks, not constants to fold silently.
5. Held EXP eggs are owner-specific but reachable item-disable/suppression callbacks make them unsupported without the held-item lane.
6. Lock Capsule proves permission/toggle, not deterministic reroll content. A natural Classic grant occurs before the wave-165 shop; a wave-9–11 fixture must explicitly pre-seed it rather than claim natural acquisition.
7. No numeric modifier-content ID was observed. G12 therefore freezes an explicit migration-owned numeric `ModifierId` table in `rust/fixtures/m4/m4-slice-manifest.json`. Oracle fixtures always retain the exact TypeScript registry key; `RunContentPack` requires a bijection between that key and the frozen numeric ID, and content hash/material validation rejects any mismatch. The numeric value is Rust contract identity, never represented as observed TypeScript evidence.

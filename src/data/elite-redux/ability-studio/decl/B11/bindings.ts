/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// Instance bindings of batch B11 (spec 2.1). Chunk 3 of 5: ReflectDamageOnDefendAbAttr, RemoveScreensOnTypedAttackAbAttr,
// RepeatMovePowerBoostAbAttr, SandStatusImmunityAbAttr, SandSecondaryEffectImmunityAbAttr, SePriorityBonusAbAttr,
// SelfDamageOnAttackAbAttr and SelfHighestStatBoostOnSummonAbAttr.
//
// Every line was read by hand from the live attr (the dump of `condition` and the constructor options) and mapped to the atom that
// calls the SAME engine predicate, or marked as a legacy closure with the reason. `attrIndex` is the position in `ability.attrs`.
// Other chunks of B11 add their bindings below the chunk 3 section.
import { bindCondition, bindLegacyClosure } from "#data/elite-redux/ability-studio/bindings";

// ---------------------------------------------------------------------------------------------------------------
// ReflectDamageOnDefendAbAttr, slot ctor:1, a PokemonDefendCondition (holder, attacker, move). The holder of the frame is the
// defender and `other` is the attacker.
//   Soul Linker: `(_t, attacker) => !(exception != null && attacker?.hasAbility(exception))` with the exception being Soul Linker.
//   This IS not(mon.has-ability { other }), but the atom resolves its ability NAME in the vanilla AbilityId enum, which has no entry for
//   ER custom abilities such as Soul Linker (5070): compiling it throws '"SOUL_LINKER" is not a known ability'. So it stays a legacy
//   closure until the atom can name an ER ability (request R-B11-14).
bindLegacyClosure(
  5070,
  0,
  "The condition is 'the attacker does not have Soul Linker', but the atom mon.has-ability only knows vanilla ability names and Soul Linker is an ER custom ability (5070). Needs the atom to accept ER ability names (R-B11-14).",
  "ctor:1",
);

// ---------------------------------------------------------------------------------------------------------------
// RemoveScreensOnTypedAttackAbAttr, slot gate. `pokemon.getMoveType(move) === moveType` is move.type with effective true
// (`moveUser.getMoveType(move)`); gateParams writes the live `type` into the atom.
//   Warrior's Spear: Fighting. Its attr-level condition `holder.isOfType(FIGHTING)` is not a constructor slot (recomposeAttr copies it).
bindCondition(5730, 3, { block: "move.type", params: { type: "FIGHTING", effective: true } }, "gate");

// ---------------------------------------------------------------------------------------------------------------
// RepeatMovePowerBoostAbAttr, slot ctor:1, a PokemonAttackCondition.
//   Rhythmic: `(_p, _t, move) => move.hasFlag(SOUND_BASED)`, the move's own bit. move.flag would ask `doesFlagEffectApply`, which also
//   counts flags that abilities inject (Musical Notes makes status moves sound-based), so it is not the same predicate.
bindLegacyClosure(
  5344,
  0,
  "The class tests the move's own SOUND_BASED bit (move.hasFlag); the library atom move.flag asks doesFlagEffectApply, which also counts injected flags. Needs an atom for the plain move property (R-B11-13).",
  "ctor:1",
);

// ---------------------------------------------------------------------------------------------------------------
// SandStatusImmunityAbAttr (slot ctor:0) and SandSecondaryEffectImmunityAbAttr (slot gate): `sandActive()`, a sandstorm that is NOT
// suppressed (`weather.weatherType === SANDSTORM && !weather.isEffectSuppressed()`). field.weather reads `arena.weatherType` and has
// no suppression test, so it is not the same predicate (request R-B11-05: weather is X and not suppressed).
const SAND_REASON =
  "The sandstorm test also asks weather.isEffectSuppressed(); the library atom field.weather has no suppression test. Needs the atom 'the weather is X and is not suppressed' (R-B11-05).";
for (const abilityId of [5148, 5604]) {
  bindLegacyClosure(abilityId, 0, SAND_REASON, "ctor:0");
  bindLegacyClosure(abilityId, 1, SAND_REASON, "gate");
}

// ---------------------------------------------------------------------------------------------------------------
// SePriorityBonusAbAttr, slot ctor:1, a PokemonAttackCondition whose target is the FIRST opposing Pokemon (the class wrapper picks it
// and keeps the no-foe and throwing nets). Overzealous: `target.getMoveEffectiveness(user, move) >= 2` = move.effectiveness gte 2.
bindCondition(5529, 0, { block: "move.effectiveness", params: { cmp: "gte", n: 2 } }, "ctor:1");

// ---------------------------------------------------------------------------------------------------------------
// SelfDamageOnAttackAbAttr, slot ctor:1, a PokemonAttackCondition. With the soul-link rules off the default is `() => true`.
//   Super Strain (5217) and Blood Price (5264): always.
bindCondition(5217, 1, { all: [] }, "ctor:1");
bindCondition(5264, 1, { all: [] }, "ctor:1");
//   Soul Linker (5070): the target has NOT fainted (`target?.isFainted()`) and is not another Soul Linker.
bindLegacyClosure(
  5070,
  1,
  "The condition needs 'the target has fainted' (target.isFainted()), which has no library atom (status.has FAINT reads the status, not hp), and 'the target has Soul Linker', which mon.has-ability cannot name (ER custom ability). Needs a fainted atom (R-B11-13) and ER ability names in the atom (R-B11-14).",
  "ctor:1",
);

// ---------------------------------------------------------------------------------------------------------------
// SelfHighestStatBoostOnSummonAbAttr, slot ctor:1, an AbAttrCondition (holder). The weather list test `weather?.weatherType` in the
// list equals an OR of field.weather (arena.weatherType is `weather?.weatherType ?? NONE`); no list at all is always true.
//   Sun Worship: Sun or Extremely harsh sunlight.        Sea Guardian: Rain or Heavy rain.        Greater Spirit: Fog or Eerie fog.
bindCondition(
  5117,
  0,
  {
    any: [
      { block: "field.weather", params: { weather: "SUNNY" } },
      { block: "field.weather", params: { weather: "HARSH_SUN" } },
    ],
  },
  "ctor:1",
);
bindCondition(
  5094,
  0,
  {
    any: [
      { block: "field.weather", params: { weather: "RAIN" } },
      { block: "field.weather", params: { weather: "HEAVY_RAIN" } },
    ],
  },
  "ctor:1",
);
bindCondition(
  5329,
  0,
  {
    any: [
      { block: "field.weather", params: { weather: "FOG" } },
      { block: "field.weather", params: { weather: "EERIE_FOG" } },
    ],
  },
  "ctor:1",
);
//   Majestic Moth, Berserk DNA, Turf War (attr 1): no weather and no terrain list = always.
bindCondition(5068, 0, { all: [] }, "ctor:1");
bindCondition(5258, 0, { all: [] }, "ctor:1");
bindCondition(5608, 1, { all: [] }, "ctor:1");

// =============================================================================================================================
// CHUNK 1 of 5: PostTurnFoeStatDropAbAttr, PostTurnRandomPureTypeAbAttr, PostTurnScriptedMoveAbAttr,
// PostVictoryClearRechargeAbAttr, PostWeatherMoveFollowUpAbAttr, AllyFaintPowerBoostTriggerAbAttr, AllyFaintPowerBoostAbAttr and
// AllyFaintPowerBoostExpireAbAttr. Read by hand from the live attrs (the dump of every user and its fields).
// PostTurnFoeStatDropAbAttr and PostTurnRandomPureTypeAbAttr have no condition slot, so nothing is bound for them.
// =============================================================================================================================

// ---------------------------------------------------------------------------------------------------------------
// PostTurnScriptedMoveAbAttr, slot gate: `turn > 0 && turn % everyNTurns === 0` on `tempSummonData.turnCount`. Both users have
// everyNTurns 2. time.turn-count only compares (`compare(turnCount, cmp, n)`), it has no "a multiple of N" form, so the cadence is a
// legacy closure (request R-B11-C1-04).
//   Sumo Wrestler (5638) and Cool Exit (5641).
const CADENCE_REASON =
  "The gate is 'turn > 0 and the turn count is a multiple of N' (here N = 2). The library atom time.turn-count only compares the turn count with a number, so it cannot say 'every 2nd turn'. Needs an atom for 'I have been out for a multiple of N turns' (R-B11-C1-04).";
bindLegacyClosure(5638, 0, CADENCE_REASON, "gate");
bindLegacyClosure(5641, 0, CADENCE_REASON, "gate");

// ---------------------------------------------------------------------------------------------------------------
// PostVictoryClearRechargeAbAttr, slot gate: `pokemon.getTag(BattlerTagType.RECHARGING) !== undefined`. This IS the atom tag.has
// (`target.getTag(BattlerTagType[tag]) !== undefined`, the same call with the same enum value) on the holder.
//   Rampage (5013), Berserker Rage (5211 attr 2), Master Hand (5387 attr 1), Raging Goddess (5424), Qigong (5463),
//   Drake Of Rage (5512 attr 1) and Going Berserk (5693 attr 1).
const RECHARGING = { block: "tag.has", params: { who: "holder", tag: "RECHARGING" } } as const;
bindCondition(5013, 0, RECHARGING, "gate");
bindCondition(5211, 2, RECHARGING, "gate");
bindCondition(5387, 1, RECHARGING, "gate");
bindCondition(5424, 0, RECHARGING, "gate");
bindCondition(5463, 0, RECHARGING, "gate");
bindCondition(5512, 1, RECHARGING, "gate");
bindCondition(5693, 1, RECHARGING, "gate");

// ---------------------------------------------------------------------------------------------------------------
// PostWeatherMoveFollowUpAbAttr, slot gate: `source.getBattlerIndex() === pokemon.getBattlerIndex()` (the mover is the holder,
// side.is self) AND `move.getMove().hasAttr("WeatherChangeAttr")` (the move sets the weather: no library atom). One gate slot holds
// one binding, so the whole gate stays a legacy closure until the atom exists (request R-B11-C1-07); then it is
// `all [side.is self, move.sets-weather]`.
//   Forecast (59, attr 3).
bindLegacyClosure(
  59,
  3,
  "The gate is 'the mover is me AND the move sets the weather'. The first half is the atom side.is self, but the second half (the move carries the weather-change effect, move.getMove().hasAttr('WeatherChangeAttr')) has no library atom, and one gate holds one binding. Needs an atom 'the move sets the weather' (R-B11-C1-07).",
  "gate",
);

// ---------------------------------------------------------------------------------------------------------------
// AllyFaintPowerBoostTriggerAbAttr, slot gate: `victim.id !== pokemon.id && victim.isPlayer() === pokemon.isPlayer()`. In the
// PostKnockOut frame `other` is the victim, so this IS side.is ally (`other !== holder && other.isPlayer() === holder.isPlayer()`).
//   Avenger (5030 attr 0) and Cursed Spirit (6095 attr 1).
bindCondition(5030, 0, { block: "side.is", params: { kind: "ally" } }, "gate");
bindCondition(6095, 1, { block: "side.is", params: { kind: "ally" } }, "gate");

// ---------------------------------------------------------------------------------------------------------------
// AllyFaintPowerBoostAbAttr (slot ctor:1, a PokemonAttackCondition) and AllyFaintPowerBoostExpireAbAttr (slot gate): both read the
// holder's private Symbol timer (`isActive(pokemon)`), which the trigger attr arms. No library atom can read it (request R-B11-C1-09).
//   Avenger (5030: boost attr 1, expire attr 2) and Cursed Spirit (6095: boost attr 2, expire attr 3).
const TIMER_REASON =
  "The condition is 'the holder's teammate-faint boost timer is running', a private per-Pokemon Symbol number armed by the trigger attr. No library atom can read a timed effect. Needs an atom 'my timed effect is running' with the matching arm and tick-down effects (R-B11-C1-09, R-B11-C1-10, R-B11-C1-11).";
bindLegacyClosure(5030, 1, TIMER_REASON, "ctor:1");
bindLegacyClosure(6095, 2, TIMER_REASON, "ctor:1");
bindLegacyClosure(5030, 2, TIMER_REASON, "gate");
bindLegacyClosure(6095, 3, TIMER_REASON, "gate");

// =============================================================================================================================
// CHUNK 2 of 5: PreFaintReviveAbAttr, PostSummonRetrieverSnapshotAbAttr, PreSwitchOutItemRestoreAbAttr,
// PreemptivePriorityCounterAbAttr, PriorityModifierAbAttr, RechargeChargedOnElectricTerrainAbAttr,
// RechargeChargedOnElectricKoAbAttr and RecoilDamageMultiplierAbAttr. Read by hand from the live attrs (the dump of every user, its
// options object and its position in `ability.attrs`).
// PostSummonRetrieverSnapshotAbAttr, PreemptivePriorityCounterAbAttr and RecoilDamageMultiplierAbAttr have no condition slot, so nothing
// is bound for them (Surprise!'s fog test is an attr-level condition that recomposeAttr carries over).
// =============================================================================================================================

// ---------------------------------------------------------------------------------------------------------------
// PreFaintReviveAbAttr, slot gate: `matchesGate(hp / maxHp, isFullHp())`. Lucky Halo (5426 attr 1) is built with
// `{ kind: "hp-threshold", threshold: 0 }`: `hp / maxHp >= 0` is true at every HP, so the gate is an always-true condition. (Its usage
// policy, the first hit of the battle, is the `firstHitsOnly` setting of the residual, not part of the gate.)
bindCondition(5426, 1, { all: [] }, "gate");

// ---------------------------------------------------------------------------------------------------------------
// PreSwitchOutItemRestoreAbAttr, slot gate: `ateBerry || canRestoreItem`, with
//   ateBerry = `summonData.berriesEatenLast.length > 0` and canRestoreItem = `getHeldItems().length === 0 && memory.length > 0`.
// item.none is the second half's first test (`getHeldItems().length === 0`), but the berry record and the remembered-items memory have no
// atom, and one gate slot holds one binding, so the whole gate is a legacy closure (requests R-B11-C2-04 and R-B11-C2-05).
//   Retriever (5244, attr 1).
bindLegacyClosure(
  5244,
  1,
  "The gate is 'a berry was eaten (summonData.berriesEatenLast is not empty) OR I hold nothing and remember items from entry'. The library has item.none for 'I hold nothing' but no atom for the eaten-berry record or for the remembered-items memory, and one gate holds one binding. Needs the two atoms (R-B11-C2-04, R-B11-C2-05).",
  "gate",
);

// ---------------------------------------------------------------------------------------------------------------
// PriorityModifierAbAttr, slot gate: `matchesFilter(filter, holder, move) && matchesCondition(condition, holder)`.
//   type filter: `holder.getMoveType(move) === type`  = move.type with effective true (`matchesAbilityStudioMoveFilter(moveUser, move,
//     { type })`, the same call; moveUser is the holder in the priority frame).
//   full-hp condition: `holder.isFullHp()` = hp.full on the holder (the same call).
//   maxBasePower filter: `!(move.power > n)` = move.power lte n (a status move has power -1 and qualifies in both).
//   The tests run filter first, then condition, and `all` keeps that order.
const FULL_HP = { block: "hp.full", params: { who: "holder" } } as const;
const movesOfType = (type: string) => ({ block: "move.type", params: { type, effective: true } }) as const;
const typeAtFullHp = (type: string) => ({ all: [movesOfType(type), FULL_HP] }) as const;
//   Galeforce Wings (5624) and Sky Sovereign (20023): Flying moves, no HP condition.
bindCondition(5624, 0, movesOfType("FLYING"), "gate");
bindCondition(20023, 0, movesOfType("FLYING"), "gate");
//   Flaming Soul (5089) and Flame Bubble (5368 attr 4): Fire moves at full HP.
bindCondition(5089, 0, typeAtFullHp("FIRE"), "gate");
bindCondition(5368, 4, typeAtFullHp("FIRE"), "gate");
//   Frozen Soul (5100): Ice.   Volt Rush (5166) and Ultra Recon Hunter (20002 attr 1): Electric.   Early Grave (5251): Ghost.
//   Stygian Rush (5279): Dark.   Tidal Rush (5281) and Ebb and Flow (6073): Water.   Pretty Privilege (5332): Fairy. All at full HP.
bindCondition(5100, 0, typeAtFullHp("ICE"), "gate");
bindCondition(5166, 0, typeAtFullHp("ELECTRIC"), "gate");
bindCondition(20002, 1, typeAtFullHp("ELECTRIC"), "gate");
bindCondition(5251, 0, typeAtFullHp("GHOST"), "gate");
bindCondition(5279, 0, typeAtFullHp("DARK"), "gate");
bindCondition(5281, 0, typeAtFullHp("WATER"), "gate");
bindCondition(6073, 0, typeAtFullHp("WATER"), "gate");
bindCondition(5332, 0, typeAtFullHp("FAIRY"), "gate");
//   Perfectionist (5026 attr 1): moves with 25 base power or less, no HP condition.
bindCondition(5026, 1, { block: "move.power", params: { cmp: "lte", n: 25 } }, "gate");
//   Punching or sound moves at full HP: `move.hasFlag(flag)`, the move's own bit. move.flag asks doesFlagEffectApply, which also counts
//   flags that abilities inject, so it is not the same predicate (request R-B11-13 of chunk 3).
const OWN_FLAG_REASON =
  "The filter tests the move's own property bit (move.hasFlag) and the holder's full HP. The library atom move.flag asks doesFlagEffectApply, which also counts flags that abilities inject, so it is not the same predicate; one gate holds one binding. Needs an atom for the plain move property (R-B11-13).";
//   Blitz Boxer (5015): punching moves.   Presto (5468) and Siren's Song (20015): sound moves.
bindLegacyClosure(5015, 0, OWN_FLAG_REASON, "gate");
bindLegacyClosure(5468, 0, OWN_FLAG_REASON, "gate");
bindLegacyClosure(20015, 0, OWN_FLAG_REASON, "gate");
//   Accuracy limit: `move.accuracy >= 0 && move.accuracy < 80` (an always-hit move, accuracy -1, never qualifies).
const ACCURACY_REASON =
  "The filter is 'the move's accuracy is 0 or more and below 80' (an always-hit move never qualifies). The library has no atom for a move's accuracy. Needs an atom 'the move's accuracy is {cmp} {n}' (R-B11-C2-09).";
//   Sighting System (5106 attr 1) and Iron Barrage (5132 attr 2): priority -3.
bindLegacyClosure(5106, 1, ACCURACY_REASON, "gate");
bindLegacyClosure(5132, 2, ACCURACY_REASON, "gate");

// ---------------------------------------------------------------------------------------------------------------
// RechargeChargedOnElectricTerrainAbAttr, slot gate: `terrain === TerrainType.ELECTRIC` on the terrain slot of the event (the terrain
// that was just set). field.terrain reads `arena.terrainType`, which is NONE while a field-suppressing effect is up, so it is not the
// same predicate (request R-B11-C2-10).
//   Generator (5208, attr 1) and Energized (5402, attr 1).
const TERRAIN_REASON =
  "The gate is 'the terrain that just began is Electric Terrain' and reads the event's own terrain. The library atom field.terrain reads arena.terrainType, which is None while the field is suppressed (Clueless), so it is not the same predicate. Needs an atom 'the terrain that just began is {terrain}' (R-B11-C2-10).";
bindLegacyClosure(5208, 1, TERRAIN_REASON, "gate");
bindLegacyClosure(5402, 1, TERRAIN_REASON, "gate");

// ---------------------------------------------------------------------------------------------------------------
// RechargeChargedOnElectricKoAbAttr, slot gate: the holder's most recent move exists and its PRINTED type is Electric
// (`allMoves[last.move]?.type === ELECTRIC`). The trigger has no move slot (move.type cannot read it) and time.last-move names a single
// move, not a type (request R-B11-C2-12).
//   Energized (5402, attr 2).
bindLegacyClosure(
  5402,
  2,
  "The gate is 'my most recent move's printed type is Electric' (allMoves[last.move].type). move.type reads the move slot, which the win trigger does not provide, and time.last-move names one move, not a type. Needs an atom 'my last move was a {type}-type move' (R-B11-C2-12).",
  "gate",
);

// =================================================================================================================================
// CHUNK 4 of 5: SelfHighestStatMultiplierAbAttr, SelfPersistentBleedAbAttr, SelfSwitchOnMoveTypeAbAttr, SelfSwitchOnStatLowerAbAttr,
// SetFogOnHitAbAttr, SetTargetAbilityOnMoveAbAttr, SkipChargeTurnAbAttr and SpeedBonusToStatAbAttr.
// Every line was read by hand from the live attr (the dump of the fields and the constructor options). `attrIndex` is the position
// in `ability.attrs`.
// =================================================================================================================================

// ---------------------------------------------------------------------------------------------------------------
// SelfHighestStatMultiplierAbAttr, slot ctor:1, an AbAttrCondition (holder): the weather list test `weather?.weatherType` is in the
// list, which equals an OR of field.weather (`arena.weatherType` is `weather?.weatherType ?? NONE`). All users: Attack and Sp. Atk, 1.5.
const SUN = {
  any: [
    { id: "field.weather", weather: "SUNNY" },
    { id: "field.weather", weather: "HARSH_SUN" },
  ],
};
//   Sun or Extremely harsh sunlight: Solar Power (94), Big Leaves (5111 attrs 4 and 5), Rite Of Spring (5503), Photovoltaic (6030).
//   Attr 4 of Big Leaves also carries an attr-level condition (addCondition) that the rebuild copies.
bindCondition(94, 0, SUN, "ctor:1");
bindCondition(5111, 4, SUN, "ctor:1");
bindCondition(5111, 5, SUN, "ctor:1");
bindCondition(5503, 1, SUN, "ctor:1");
bindCondition(6030, 0, SUN, "ctor:1");
//   Sandstorm only: Sand Force (159 attr 1), Sand Bender (5445 attr 3), Sand Fiend (5601 attr 1).
const SAND = { id: "field.weather", weather: "SANDSTORM" };
bindCondition(159, 1, SAND, "ctor:1");
bindCondition(5445, 3, SAND, "ctor:1");
bindCondition(5601, 1, SAND, "ctor:1");
//   Whiteout (5007): Hail or Snow.   Ectoplasm (5325): Fog or Eerie fog.   Raging Storm (5636): Rain or Heavy rain.
bindCondition(
  5007,
  0,
  {
    any: [
      { id: "field.weather", weather: "HAIL" },
      { id: "field.weather", weather: "SNOW" },
    ],
  },
  "ctor:1",
);
bindCondition(
  5325,
  0,
  {
    any: [
      { id: "field.weather", weather: "FOG" },
      { id: "field.weather", weather: "EERIE_FOG" },
    ],
  },
  "ctor:1",
);
bindCondition(
  5636,
  0,
  {
    any: [
      { id: "field.weather", weather: "RAIN" },
      { id: "field.weather", weather: "HEAVY_RAIN" },
    ],
  },
  "ctor:1",
);

// ---------------------------------------------------------------------------------------------------------------
// SelfPersistentBleedAbAttr, slot gate: `!pokemon.getTag(ER_BLEED)` = not(tag.has { holder, ER_BLEED }). Blood Stain (5377, attr 1).
bindCondition(5377, 1, { not: { id: "tag.has", who: "holder", tag: "ER_BLEED" } }, "gate");

// ---------------------------------------------------------------------------------------------------------------
// SelfSwitchOnMoveTypeAbAttr, slot gate: `super.canApply` (the default attack condition: `move.category !== STATUS`) and
// `pokemon.getMoveType(move) === moveType` (move.type with effective true, the same call). gateParams writes the live `type`.
//   Hollow Ice Zone (5680, attr 1): Ice.
bindCondition(5680, 1, { all: [{ id: "move.damaging" }, { id: "move.type", type: "ICE", effective: true }] }, "gate");

// ---------------------------------------------------------------------------------------------------------------
// SelfSwitchOnStatLowerAbAttr, slot gate, in the class order: the once-per-battle memory (the per-wave Set under the key the class
// writes itself), then `stages < 0`. Tactical Retreat (5282).
bindCondition(
  5282,
  0,
  {
    all: [
      { id: "time.once-per", scope: "wave", key: "erTacticalRetreat.used" },
      { id: "stage.just-changed", direction: "lowered" },
    ],
  },
  "gate",
);

// ---------------------------------------------------------------------------------------------------------------
// SetFogOnHitAbAttr, slot gate: `move?.is("AttackMove")` and the active weather is not the weather to set. The first clause is the
// engine class test, NOT the atom move.damaging (`category !== STATUS`): L1 found 9 moves where they differ (status moves whose data
// category is Physical or Special: Whirlwind, Growl, Poison Gas, Flash, Splash, Nightmare, Captivate, Octolock, Decorate).
//   Fog Machine (5606): Eerie fog.
bindLegacyClosure(
  5606,
  0,
  "The gate is 'the move is an attack (the AttackMove class) and the weather is not already up'. The library atom move.damaging asks category !== STATUS, which differs for 9 status moves with a Physical or Special data category (Splash, Whirlwind, Growl...). Needs an atom 'the move is an attack move' (R-B11-C4-08); the weather clause maps to not(field.weather).",
  "gate",
);

// ---------------------------------------------------------------------------------------------------------------
// SetTargetAbilityOnMoveAbAttr, slot gate: `move.id === moveId` = move.is-move. Temporal Rupture (5531): Roar of Time. The setting
// `move` is read-only, so the move lives in the atom only.
bindCondition(5531, 0, { id: "move.is-move", moveId: "ROAR_OF_TIME" }, "gate");

// ---------------------------------------------------------------------------------------------------------------
// SkipChargeTurnAbAttr, slot gate: any of the four charging tags is present on the holder. Accelerate (5205, attr 0).
bindCondition(
  5205,
  0,
  {
    any: [
      { id: "tag.has", who: "holder", tag: "CHARGING" },
      { id: "tag.has", who: "holder", tag: "UNDERGROUND" },
      { id: "tag.has", who: "holder", tag: "UNDERWATER" },
      { id: "tag.has", who: "holder", tag: "FLYING" },
    ],
  },
  "gate",
);

// ---------------------------------------------------------------------------------------------------------------
// SpeedBonusToStatAbAttr, slot ctor:1, a PokemonAttackCondition called as (holder, null, move). With no filter the default test is
// always true; with a contact filter it tests the move's RAW contact bit (`move.hasFlag(MAKES_CONTACT)`).
//   Every move: Slipstream (5398 attrs 0, 1), Max Acceleration (5379 attrs 1, 2), Mach 3 (5635 attrs 2, 3), Sky Sovereign (20023 attrs
//   1, 2), Power Core (5105 attrs 0, 1), Unstable Core (5721 attrs 0, 1), Sleek Scales (5731 attrs 0, 1).
for (const [abilityId, attrIndexes] of [
  [5398, [0, 1]],
  [5379, [1, 2]],
  [5635, [2, 3]],
  [20023, [1, 2]],
  [5105, [0, 1]],
  [5721, [0, 1]],
  [5731, [0, 1]],
] as const) {
  for (const attrIndex of attrIndexes) {
    bindCondition(abilityId, attrIndex, { all: [] }, "ctor:1");
  }
}
const RAW_CONTACT_REASON =
  "The filter tests the move's RAW contact bit (move.hasFlag(MAKES_CONTACT)). The library atom move.flag asks doesFlagEffectApply (which also counts Long Reach, Punching Glove and substitutes) and needs the moveUser slot, which a stat calculation does not provide. Needs an atom 'the move has this property, plain' that needs only the move slot (R-B11-13 a, widened in R-B11-C4-07).";
//   Contact moves only: Speed Force (5093 attrs 0, 1, 2), Juggernaut (5059 attr 0), Iron Giant (5386 attr 3), Sumo Guard (5637 attr 0),
//   Blur (5510 attrs 0, 1).
for (const [abilityId, attrIndexes] of [
  [5093, [0, 1, 2]],
  [5059, [0]],
  [5386, [3]],
  [5637, [0]],
  [5510, [0, 1]],
  // Moves that do NOT make contact: Terminal Velocity (5275 attrs 0, 1), Impulse (5274 attrs 0, 1), Elude (5511 attrs 0, 1).
  [5275, [0, 1]],
  [5274, [0, 1]],
  [5511, [0, 1]],
] as const) {
  for (const attrIndex of attrIndexes) {
    bindLegacyClosure(abilityId, attrIndex, RAW_CONTACT_REASON, "ctor:1");
  }
}

// ===============================================================================================================
// Chunk 5 of 5: StabAddAbAttr, StabSuppressAuraAbAttr, StatBlendAbAttr and StatChangeOnAttackAbAttr.
// Same rule as above: every line was read by hand from the live attr dump and mapped to the atom that calls the SAME engine predicate,
// or marked as a legacy closure with the reason.

// ---------------------------------------------------------------------------------------------------------------
// StabAddAbAttr, slot ctor:1 (which moves) and slot ctor:2 (the move's type is not one of my own types), both PokemonAttackConditions
// called as (holder, target, move).
//   ctor:1 is `pokemon.getMoveType(move) === targetType` (no target type: always true) = move.type with effective true
//   (`moveUser.getMoveType(move)`). ctor:2 is `!pokemon.getTypes(false, false).includes(pokemon.getMoveType(move))`: the library has no
//   atom for "the move's type is one of my own types" (and mon.has-type asks isOfType, which counts a Tera type), so every ctor:2 is a
//   legacy closure (request R-B11-C5-01).
const STAB_OFF_TYPE_REASON =
  "The test is 'the move's resolved type is NOT one of my own types, Tera type left out' (!getTypes(false, false).includes(getMoveType(move))). The library has no atom 'the move's type is one of my own types' (mon.has-type needs a fixed type and counts a Tera type). Needs request R-B11-C5-01.";
// [abilityId, attrIndex, type or "ANY"]; every user has the multiplier 1.5.
for (const [abilityId, attrIndex, type] of [
  [5017, 1, "FIRE"], // Immolate
  [5025, 0, "ANY"], // Mystic Power
  [5029, 0, "ICE"], // Aurora Borealis
  [5035, 0, "WATER"], // Amphibious
  [5038, 1, "FIGHTING"], // Fighting Spirit
  [5046, 1, "GROUND"], // Tectonize
  [5053, 1, "WATER"], // Hydrate
  [5063, 1, "POISON"], // Intoxicate
  [5103, 0, "FAIRY"], // Lunar Eclipse
  [5103, 1, "DARK"],
  [5104, 2, "FIRE"], // Solar Flare
  [5118, 1, "BUG"], // Pollinate
  [5123, 1, "GHOST"], // Spectralize
  [5140, 1, "ROCK"], // Mineralize
  [5149, 1, "DRAGON"], // Draconize
  [5190, 1, "PSYCHIC"], // Emanate
  [5209, 0, "FAIRY"], // Moon Spirit
  [5209, 1, "DARK"],
  [5219, 1, "PSYCHIC"], // Enlightened
  [5224, 0, "ANY"], // Arcane Force
  [5237, 1, "GRASS"], // Fertilize
  [5324, 2, "WATER"], // Old Mariner
  [5351, 3, "FAIRY"], // Unicorn
  [5403, 2, "ANY"], // Color Spectrum
  [5404, 3, "BUG"], // Steel Beetle
  [5428, 1, "POISON"], // Sludgy Mix
  [5457, 2, "FAIRY"], // Twinkle Toes
  [5461, 2, "POISON"], // Acidic Slime
  [5463, 3, "FIGHTING"], // Qigong
  [5477, 0, "ANY"], // Unown Power
  [5486, 11, "DARK"], // Two-Faced (attr-level condition: hangry form)
  [5501, 1, "DARK"], // Deviate
  [5527, 2, "FAIRY"], // Tender Affection
  [5530, 5, "STEEL"], // Stainless Steel
  [5542, 1, "DRAGON"], // Draconic Might
  [5552, 1, "DRAGON"], // Komodo
  [5557, 1, "ROCK"], // Molten Coat
  [5619, 1, "DRAGON"], // Dragonfruit
  [5621, 2, "ROCK"], // Lead Claws
  [5668, 1, "WATER"], // Hand Barnacles
  [5688, 1, "ELECTRIC"], // Storm Cloud
  [5689, 1, "WATER"], // Waterborne
  [5714, 2, "DARK"], // Mob Boss
  [5730, 2, "FIGHTING"], // Warrior's Spear
  [5936, 0, "ANY"], // Brain Food
  [5940, 1, "PSYCHIC"], // Brainpower
  [5955, 1, "WATER"], // Waterborne (second id)
  [5956, 1, "DRAGON"], // Dragonfruit (second id)
  [5957, 1, "DRAGON"], // Komodo (second id)
  [6003, 5, "STEEL"], // Stainless Steel (second id)
  [6036, 3, "PSYCHIC"], // Nucleus
  [6053, 1, "STELLAR"], // Stellarize
  [6074, 1, "FAIRY"], // Moonarch
  [6074, 2, "DARK"],
  [6076, 1, "WATER"], // Bodhisattva
  [6108, 1, "FIRE"], // Blaze Release
  [6111, 3, "STELLAR"], // Bejeweled
  [20000, 0, "ANY"], // Psychic Supremacy
  [20008, 4, "FIGHTING"], // Heartless Style
] as const) {
  bindCondition(
    abilityId,
    attrIndex,
    type === "ANY" ? { all: [] } : { block: "move.type", params: { type, effective: true } },
    "ctor:1",
  );
  bindLegacyClosure(abilityId, attrIndex, STAB_OFF_TYPE_REASON, "ctor:2");
}

// ---------------------------------------------------------------------------------------------------------------
// StabSuppressAuraAbAttr, slot ctor:0 (another battler on the field has my ability) and slot ctor:1 (the move's type is one of my own
// types, Tera type counted). Users: Relic Stone (5567 attr 0) and Titan (5934 attr 1). Neither test has a library atom.
const STAB_AURA_REASON =
  "The test is 'another battler on the field (not fainted, not me) has my ability as its ability or its passive' (field.some(p => p !== pokemon && (p.hasAbility(id) || p.getPassiveAbility().id === id))). The library has no atom for it (party.ally-ability only looks at the ally). Needs request R-B11-C5-02.";
const STAB_OWN_TYPE_REASON =
  "The test is 'the move's resolved type is one of my own types, Tera type counted' (getTypes(true).includes(getMoveType(move))). The library has no atom 'the move's type is one of my own types' (mon.has-type needs a fixed type). Needs request R-B11-C5-01.";
for (const [abilityId, attrIndex] of [
  [5567, 0],
  [5934, 1],
] as const) {
  bindLegacyClosure(abilityId, attrIndex, STAB_AURA_REASON, "ctor:0");
  bindLegacyClosure(abilityId, attrIndex, STAB_OWN_TYPE_REASON, "ctor:1");
}

// ---------------------------------------------------------------------------------------------------------------
// StatBlendAbAttr, slot gate: `appliesTo.includes(stat)` with Attack and Sp. Atk. The library has no atom for "the stat being worked
// out is one of these" (request R-B11-C5-03), so both users keep the class's own gate as a legacy closure.
const STAT_BLEND_GATE_REASON =
  "The gate is 'the stat being worked out is Attack or Sp. Atk' (appliesTo.includes(stat)). The library has no atom for the stat being calculated. Needs request R-B11-C5-03.";
bindLegacyClosure(5545, 1, STAT_BLEND_GATE_REASON, "gate");
bindLegacyClosure(5547, 1, STAT_BLEND_GATE_REASON, "gate");

// ---------------------------------------------------------------------------------------------------------------
// StatChangeOnAttackAbAttr, slot gate: [damaging move (the parent test `move.category !== STATUS`), the flag or the type test, the chance
// roll], in the class's own order. The type test is the RAW `move.type !== moveType`, so move.type with effective false; the flag test
// is `move.doesFlagEffectApply({ flag, user: holder, target })`, the same call as move.flag; the chance roll is
// `chance !== 100 && randBattleSeedInt(100) >= chance`, the same draw as rng.chance (which draws nothing at 100 or when simulated).
//   Sinister Claws (5712 attr 2): SLICING_MOVE, chance 100.
bindCondition(
  5712,
  2,
  {
    all: [
      { block: "move.damaging" },
      { block: "move.flag", params: { flag: "SLICING_MOVE" } },
      { block: "rng.chance", params: { pct: 100 } },
    ],
  },
  "gate",
);
//   Archmage (5186 attrs 8 to 11) and Familiar (5941 attrs 9 to 12): a move type each, chance 30.
for (const [abilityId, attrIndexes] of [
  [5186, [8, 9, 10, 11]],
  [5941, [9, 10, 11, 12]],
] as const) {
  // Fighting, Flying, Steel, Dragon, in this order.
  for (const [offset, type] of [
    [0, "FIGHTING"],
    [1, "FLYING"],
    [2, "STEEL"],
    [3, "DRAGON"],
  ] as const) {
    bindCondition(
      abilityId,
      attrIndexes[offset],
      {
        all: [
          { block: "move.damaging" },
          { block: "move.type", params: { type, effective: false } },
          { block: "rng.chance", params: { pct: 30 } },
        ],
      },
      "gate",
    );
  }
}

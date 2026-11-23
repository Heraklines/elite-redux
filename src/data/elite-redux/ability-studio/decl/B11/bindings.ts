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

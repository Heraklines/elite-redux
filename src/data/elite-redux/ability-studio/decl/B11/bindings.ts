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

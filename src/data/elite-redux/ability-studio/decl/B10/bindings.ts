/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// Instance bindings of batch B10 (spec 2.1), keyed by (abilityId, attrIndex); "attr N" is the position in `ability.attrs`.
//
// Chunk 1 of 5 (NullifyFirstNHitsAbAttr, IgnoreResistancesAbAttr, OffensiveTypeChartOverrideAbAttr, OnCritStatBoostLowestAbAttr,
// OnFaintEffectAbAttr, OnOpponentStatRaiseAbAttr, OnOpponentStatRaiseScriptedMoveAbAttr, OnOpponentSwitchOutAbAttr):
// there is nothing to bind, and that was checked class by class, not assumed:
//  - none of them takes a constructor closure (NullifyFirstNHits hands the parent `() => true` itself, and its own two
//    arguments are a number and a test seam);
//  - none has a gate inside canApply that the library has to replace (Tier C: the whole rule is one piece);
//  - the only closure in any user is the attr-level holder condition that Draconize and Draconic Might add to an
//    OffensiveTypeChartOverrideAbAttr with `addCondition`; `recomposeAttr` copies it onto the rebuild, so it is not a
//    constructor slot.
//
// Chunk 2 of 5 binds the Tier B gates (slot "gate") of OncePerEntryContactDamageReductionAbAttr, OneShotTypeBoostAbAttr,
// OneShotTypeBoostFollowupAbAttr, PassiveRecoveryAbAttr and PoisonedFoePurgeAbAttr, written by hand after reading each class and its live users. The other three classes of the chunk are Tier C
// and have nothing to bind: OutgoingStatDropMultiplierAbAttr,
// PartyCountMultiHitAbAttr (no closure anywhere: each takes a number or an options object of plain values) and
// PersistentFieldAuraAbAttr (its only closure, the ally filter, sits under an options key that no constructor slot reaches, so it is
// carried by the `allies` param instead).
// The L1 differential evaluates the class's own gate and the compiled library gate over the state grid and fails on any
// difference; the B10 test chunk2-gates.test.ts adds the states the grid does not have (fog, terrains, types, poison).
// Later chunks of B10 add their bindings below this comment.
import { bindCondition, bindLegacyClosure } from "#data/elite-redux/ability-studio/bindings";

// =============================================================================================
// OncePerEntryContactDamageReductionAbAttr (Tier B). Slot "gate" = the parent's closure = move.doesFlagEffectApply(MAKES_CONTACT,
// user: attacker, target: holder). The once-per-entry charge test is the guard and stays in the class.
// =============================================================================================
bindCondition(5565, 0, { id: "move.flag", flag: "MAKES_CONTACT" }, "gate"); // Chuckster: contact moves

// =============================================================================================
// PoisonedFoePurgeAbAttr (Tier B). Slot "gate" = the target's status is POISON or TOXIC (params.opponent?.status?.effect). A missing
// target makes both atoms false, like the class.
// =============================================================================================
bindCondition(
  5483,
  0,
  {
    any: [
      { id: "status.has", who: "other", status: "POISON" },
      { id: "status.has", who: "other", status: "TOXIC" },
    ],
  },
  "gate",
); // Hemolysis

// =============================================================================================
// PassiveRecoveryAbAttr (Tier B, 17 attrs). Slot "gate" = matchesCondition(conditionSpec, holder). The parent's not-at-full-HP test is
// the guard and stays in the class. One library tree per situation:
// =============================================================================================

// always: the condition is `() => true`; an empty ALL group is always true.
const always = (): unknown => ({ all: [] });
bindCondition(5045, 0, always(), "gate"); // Self Sufficient: 1/16 every turn
bindCondition(5151, 0, always(), "gate"); // Self Repair: 1/16 every turn
bindCondition(5220, 2, always(), "gate"); // Peaceful Slumber (second part): 1/16 every turn
bindCondition(5417, 0, always(), "gate"); // Apple Pie: 1/16 every turn
bindCondition(5604, 2, always(), "gate"); // Dune Veil: 1/16 every turn
bindCondition(5951, 0, always(), "gate"); // Self Sufficient (second id): 1/16 every turn
bindCondition(6057, 2, always(), "gate"); // Honk Shoo: 1/8 every turn

// terrain: arena.terrainType is in the list; every live list has one terrain.
bindCondition(5082, 2, { id: "field.terrain", terrain: "TOXIC" }, "gate"); // Poison Absorb: 1/8 in Toxic Terrain
bindCondition(5298, 0, { id: "field.terrain", terrain: "MISTY" }, "gate"); // Celestial Blessing: 1/8 in Misty Terrain
bindCondition(5355, 0, { id: "field.terrain", terrain: "MISTY" }, "gate"); // Eternal Blessing: 1/8 in Misty Terrain
bindCondition(5310, 1, { id: "field.terrain", terrain: "GRASSY" }, "gate"); // Flourish: 1/8 in Grassy Terrain

// weather: arena.weatherType is in [FOG, EERIE_FOG], so ANY of the two exact weather checks.
const fogGate = (): unknown => ({
  any: [
    { id: "field.weather", weather: "FOG" },
    { id: "field.weather", weather: "EERIE_FOG" },
  ],
});
bindCondition(5357, 0, fogGate(), "gate"); // Rest in Peace: 1/8 in fog
bindCondition(5358, 4, fogGate(), "gate"); // White Noise: 1/8 in fog

// self-type: pokemon.getTypes().includes(ICE); getTypes() includes the Tera type like isOfType does.
bindCondition(5575, 1, { id: "mon.has-type", who: "holder", type: "ICE" }, "gate"); // Winter Throne: 1/8 for Ice types

// hp-below-fraction 0.5: pokemon.hp <= toDmgValue(maxHp * 0.5), floor-half is hp <= floor(maxHp * 50 / 100). They differ only at max
// HP 1, which the parent's not-at-full-HP guard has already excluded (see the declaration notes).
bindCondition(5692, 0, { id: "hp.at-most", who: "holder", pct: 50, rounding: "floor-half" }, "gate"); // Resilience: 1/4 at half HP or less

// status SLEEP: matchesCondition is true when the status is SLEEP OR isComatoseLike(pokemon) (an ability with the Comatose rule, or
// an active Honk Shoo). The library has no atom for the second half, so these two stay legacy (request R-B10-23); a plain
// status.has SLEEP would give a different answer for a Comatose holder.
bindLegacyClosure(
  5071,
  0,
  "Asleep OR Comatose-like (isComatoseLike): the library has no atom for the Comatose half, request R-B10-23 in requests/B10.md",
  "gate",
); // Sweet Dreams: 1/8 while asleep
bindLegacyClosure(
  5220,
  0,
  "Asleep OR Comatose-like (isComatoseLike): the library has no atom for the Comatose half, request R-B10-23 in requests/B10.md",
  "gate",
); // Peaceful Slumber (first part): 1/8 while asleep

// =============================================================================================
// OneShotTypeBoostAbAttr and OneShotTypeBoostFollowupAbAttr (Tier B, Power Outage). Slot "gate" = pokemon.getMoveType(move) === opts.type
// (the effective type, so effective: true). The type is also the class's `type` param (gateParams). The one-time flag is the guard and
// stays in the class (request R-B10-19).
// =============================================================================================
bindCondition(5706, 0, { id: "move.type", type: "ELECTRIC", effective: true }, "gate"); // Power Outage: boost, Electric moves
bindCondition(5706, 1, { id: "move.type", type: "ELECTRIC", effective: true }, "gate"); // Power Outage: lose Electric after one

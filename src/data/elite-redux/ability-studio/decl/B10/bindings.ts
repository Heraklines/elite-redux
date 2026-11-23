/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// Instance bindings of batch B10 (spec 2.1), keyed by (abilityId, attrIndex); "attr N" is the position in `ability.attrs`.
//
// Chunk 1 of 5 (NullifyFirstNHitsAbAttr, IgnoreResistancesAbAttr, OffensiveTypeChartOverrideAbAttr, OnCritStatBoostLowestAbAttr,
// OnFaintEffectAbAttr, OnOpponentStatRaiseAbAttr, OnOpponentStatRaiseScriptedMoveAbAttr, OnOpponentSwitchOutAbAttr):
// none of them takes a constructor closure (NullifyFirstNHits hands the parent `() => true` itself). Three of them are Tier B and have
// a gate slot, bound below by hand after reading each class and every user; the other five have nothing to bind (checked class by
// class): Ignore resistances is a flag, the type-chart class and the two scripted-move classes are Tier C, and Egoist has no condition.
// The only closure in any user of the type-chart class is the attr-level holder condition that Draconize and Draconic Might add with
// `addCondition`; `recomposeAttr` copies it onto the rebuild, so it is not a constructor slot.
//
// The three gates are legacy on purpose: each needs a library atom that does not exist yet (requests in requests/B10.md), and a
// bound atom that tests something else would be a lie.
//  - NullifyFirstNHits: `used(pokemon) < n`, the per-battle counter of hits already cancelled (R-B10-01 time.hits-taken-this-battle).
//  - OnCritStatBoostLowest: once per turn (R-B10-05) and "the target's first hit this turn was critical" (R-B10-04).
//  - OnFaintEffect: the clauses about the Pokemon that knocked me out, "it is still standing" (R-B10-c1-05 mon.is-standing), for
//    the curse also "it is not of the skipped type" (mon.has-type, who other, which exists) and for the PP drain "the move was a
//    damaging move" (move.damaging, which exists).
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
// Chunk 1 gates (Tier B, all legacy until the requested atoms exist).
// =============================================================================================
const HITS_COUNTER =
  "Fewer than n hits cancelled so far in this battle: the count lives in the class's own per-Pokemon, per-battle memory and the library has no atom that reads it, request R-B10-01 in requests/B10.md";
bindLegacyClosure(5163, 0, HITS_COUNTER, "gate"); // Cheating Death: the first 2 hits
bindLegacyClosure(5292, 0, HITS_COUNTER, "gate"); // Gallantry: the first hit

bindLegacyClosure(
  5615,
  0,
  "Once per turn (the class's own turn flag on the Pokemon) AND the target's first hit this turn was a critical hit: the library has neither a shared once-per-turn memory nor a was-critical atom, requests R-B10-05 and R-B10-04 in requests/B10.md",
  "gate",
); // Home Run

const KNOCKER_STANDING =
  "The Pokemon that knocked me out is still standing (and, for the curse, is not of the skipped type): the library has no is-still-standing atom for the other Pokemon, request R-B10-c1-05 in requests/B10.md";
bindLegacyClosure(5073, 0, KNOCKER_STANDING, "gate"); // Haunted Spirit: curse unless Ghost
bindLegacyClosure(5283, 0, KNOCKER_STANDING, "gate"); // Vengeful Spirit: curse unless Ghost
bindLegacyClosure(5280, 0, KNOCKER_STANDING, "gate"); // Guilt Trip: attacker still standing
bindLegacyClosure(5285, 0, KNOCKER_STANDING, "gate"); // Ill Will: attacker standing and the move was damaging
bindLegacyClosure(6095, 0, KNOCKER_STANDING, "gate"); // Cursed Spirit: attacker standing and the move was damaging

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

// =============================================================================================
// Chunk 3 gates (Tier B, slot "gate"). Every class of the chunk split canApply into guards, gate and residual by hand after reading
// the class and every one of its users; each binding below repeats ONE user's gate with library atoms, in the class's own clause
// order. The L1 attr differential evaluates the class's own canApply and the rebuild's over the state grid, and the B10 test
// chunk3-gates.test.ts adds the states the grid cannot reach (pulse, dance and sound moves, a Tera target, a poisoned target,
// every status, an immune hit).
// =============================================================================================

// "The move deals damage" is the parent's attack rule (move.category != STATUS), and "makes contact" asks doesFlagEffectApply with the
// moving Pokemon as the user, like every one of the classes below.
const damagingContact = (): unknown => ({
  all: [{ id: "move.damaging" }, { id: "move.flag", flag: "MAKES_CONTACT" }],
});

// ---- PostAttackChangeTargetTypeAbAttr: damaging move, then contact (contactOnly) and the flag (requireFlag) ----
bindCondition(6, 2, damagingContact(), "gate"); // Damp (offense half): Water on a contact move
bindCondition(5042, 1, damagingContact(), "gate"); // Magical Dust (offense half): Psychic on a contact move
bindCondition(5581, 0, { all: [{ id: "move.damaging" }, { id: "move.flag", flag: "PULSE_MOVE" }] }, "gate"); // Paint Shot: pulse moves, no contact rule

// ---- PostDefendChangeAttackerTypeAbAttr: the attack-move class test is a guard in the class; the gate is contact only ----
bindCondition(6, 0, { id: "move.flag", flag: "MAKES_CONTACT" }, "gate"); // Damp (defense half)
bindCondition(5042, 0, { id: "move.flag", flag: "MAKES_CONTACT" }, "gate"); // Magical Dust (defense half)

// ---- PostAttackRemoveTargetTypeAbAttr (the ab-attrs class): damaging move, then the target has the type. The type is the class's
// `type` setting (gateParams). ----
const ghostStrip = (): unknown => ({ all: [{ id: "move.damaging" }, { id: "mon.has-type", who: "other", type: "GHOST" }] });
bindCondition(35, 1, ghostStrip(), "gate"); // Illuminate
bindCondition(5229, 2, ghostStrip(), "gate"); // Refrigerator (its Illuminate copy)
bindCondition(5603, 2, ghostStrip(), "gate"); // Depth Explorer
bindCondition(5665, 1, ghostStrip(), "gate"); // Chandelier
bindCondition(5960, 3, ghostStrip(), "gate"); // Spectacle
bindLegacyClosure(
  5229,
  3,
  "Instance of the ARCHETYPE class that shares the name PostAttackRemoveTargetTypeAbAttr with the ab-attrs class this declaration builds (fields stripType and contactOnly, falls back to NORMAL, no Tera exception, no self check): one declaration cannot rebuild both, so this attr is not rebuilt; it strips the same Ghost type as attr 2",
  "gate",
); // Refrigerator (the dispatcher's extra copy)

// ---- PostAttackContactSuppressTargetAbilityAbAttr: (the attack-move class test is a guard) contact, then the target's status ----
bindCondition(
  5533,
  0,
  {
    all: [
      { id: "move.flag", flag: "MAKES_CONTACT" },
      {
        any: [
          { id: "status.has", who: "other", status: "POISON" },
          { id: "status.has", who: "other", status: "TOXIC" },
        ],
      },
    ],
  },
  "gate",
); // Hemotoxin: a contact attack on a poisoned or badly poisoned target

// ---- PostAttackScriptedMoveAbAttr: the clauses move list, stat-drop test, category, type, flag (each only when set) ----
const noRule = (): unknown => ({ all: [] }); // no filter at all: an empty ALL group is always true
const hasFlag = (flag: string): unknown => ({ id: "move.flag", flag });
bindCondition(5221, 0, noRule(), "gate"); // Aftershock: any move (Magnitude)
bindCondition(5554, 0, noRule(), "gate"); // Purple Haze: any move (Poison Gas)
bindCondition(5577, 0, noRule(), "gate"); // Sludge Spit: any move (Venom Bolt)
bindCondition(5673, 0, noRule(), "gate"); // Break it Down: any move (Rapid Spin)
bindCondition(5694, 0, { id: "move.category", category: "SPECIAL" }, "gate"); // Thunder Clouds: special moves
bindCondition(5246, 0, hasFlag("DANCE_MOVE"), "gate"); // Two Step: dance moves
bindCondition(5434, 0, hasFlag("DANCE_MOVE"), "gate"); // Blade Dance: dance moves
bindCondition(5676, 0, hasFlag("DANCE_MOVE"), "gate"); // Backflip: dance moves
bindCondition(5345, 0, hasFlag("SOUND_BASED"), "gate"); // Chunky Bass Line: sound moves
bindCondition(5513, 1, hasFlag("SOUND_BASED"), "gate"); // Reverberate: sound moves
bindCondition(5134, 0, hasFlag("PULSE_MOVE"), "gate"); // Pyro Shells: pulse moves
bindCondition(5192, 1, { id: "move.is-move", moveId: "TICKLE" }, "gate"); // Monkey Business: only Tickle
const TYPE_LIST =
  "The move's type OR any type another of my abilities lets it count as (getTriggeredMoveTypes, Sea Specter) is on the list: the library move.type atom reads only the move's own type, request R-B10-c3-07 in requests/B10.md";
bindLegacyClosure(5119, 0, TYPE_LIST, "gate"); // Volcano Rage: Fire moves
bindLegacyClosure(5206, 0, TYPE_LIST, "gate"); // Frost Burn: Fire moves
bindLegacyClosure(5233, 0, TYPE_LIST, "gate"); // High Tide: Water moves
bindLegacyClosure(6073, 1, TYPE_LIST, "gate"); // Ebb and Flow: Water moves
bindLegacyClosure(5489, 0, TYPE_LIST, "gate"); // Glacial Rage: Ice moves
bindLegacyClosure(5710, 0, TYPE_LIST, "gate"); // Frost Dragon: Ice moves
bindLegacyClosure(5596, 0, TYPE_LIST, "gate"); // Lunar Wrath: Ghost moves

// ---- PostAttackSetTerrainByMoveTypeAbAttr and PostAttackSetHazardByMoveTypeAbAttr: damaging move, the move's PRINTED type (move.type,
// so `effective: false`), then the chance roll LAST (the class's one random draw). The chance and the hazard's type are settings
// repeated here through gateParams. ----
const printedType = (type: string): unknown => ({ id: "move.type", type, effective: false });
const terrainGate = (): unknown => ({
  all: [
    { id: "move.damaging" },
    { any: [printedType("ELECTRIC"), printedType("PSYCHIC"), printedType("GRASS"), printedType("FAIRY")] },
    { id: "rng.chance", pct: 30 },
  ],
});
const hazardGate = (): unknown => ({
  all: [{ id: "move.damaging" }, printedType("ROCK"), { id: "rng.chance", pct: 30 }],
});
bindCondition(5186, 12, terrainGate(), "gate"); // Archmage: terrain by move type
bindCondition(5941, 13, terrainGate(), "gate"); // Familiar: terrain by move type
bindCondition(5186, 13, hazardGate(), "gate"); // Archmage: Stealth Rock on Rock moves
bindCondition(5941, 14, hazardGate(), "gate"); // Familiar: Stealth Rock on Rock moves

// ---- PostDamageForceAttackerOutAbAttr: the attacker's last move makes contact (contactRequired) ----
const ATTACKER_MOVE =
  "The attacker's last move makes contact: the frame of 'after I take any damage' has no move, so the library move.flag atom cannot read it, request R-B10-c3-02 in requests/B10.md";
bindLegacyClosure(5393, 0, ATTACKER_MOVE, "gate"); // Restraining Order
bindLegacyClosure(5565, 1, ATTACKER_MOVE, "gate"); // Chuckster

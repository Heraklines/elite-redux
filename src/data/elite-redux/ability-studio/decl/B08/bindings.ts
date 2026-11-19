/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// Instance bindings of batch B08 chunk 1 (spec 2.1): the library form of every Tier B gate (slot "gate") of the
// classes below, keyed by (abilityId, attrIndex). "attr N" is the position in `ability.attrs`.
//
// Every line was written by hand after reading the class, then the live instance (chance, type, outcome and contact
// settings of each user). The L1 differential evaluates the class's own gate and the compiled library gate over the
// state grid and fails on any difference.
//
// Classes without a binding here: AbsorbantAbAttr, AllyAttackPowerBoostAbAttr and ChanceDodgeAbAttr (Tier C, no
// constructor closure), AttackStatSubstituteAbAttr and BoneMoveTypeChartAbAttr (parked, no WHEN yet).
import { bindCondition, bindLegacyClosure } from "#data/elite-redux/ability-studio/bindings";

// =============================================================================================
// AddTypeToAttackerOnContactAbAttr (Tier B). Slot "gate": doesFlagEffectApply(MAKES_CONTACT, user: attacker, target: holder).
// The residual (not Terastallized, does not have the type) stays in the class.
// =============================================================================================
bindCondition(5508, 1, { id: "move.flag", flag: "MAKES_CONTACT" }, "gate"); // Woodland Curse (adds Grass)

// =============================================================================================
// ChanceStatusOnHitAbAttr (Tier B). Slot "gate", in the ORIGINAL clause order:
//   contact: move.doesFlagEffectApply(MAKES_CONTACT)  ->  attacker has no status (only without tag outcomes)  ->  chance roll
// The chance atom stays LAST so a non-contact hit or a statused attacker draws no random number.
// =============================================================================================
const contactStatusGate = (pct: number): unknown => ({
  all: [
    { id: "move.flag", flag: "MAKES_CONTACT" },
    { id: "status.has", who: "other", status: "NONE" },
    { id: "rng.chance", pct },
  ],
});

bindCondition(143, 1, contactStatusGate(30), "gate"); // Poison Touch: 30% poison on contact
bindCondition(5199, 0, contactStatusGate(30), "gate"); // Super Hot Goo: 30% burn on contact
bindCondition(5350, 0, contactStatusGate(50), "gate"); // Arc Flash: 50% burn on contact
bindCondition(5448, 0, contactStatusGate(100), "gate"); // Daybreak: 100% burn on contact (the roll is skipped at 100)
bindCondition(5629, 0, contactStatusGate(20), "gate"); // Hypnotic Touch: 20% sleep on contact

// Crispy Cream pools a burn and a frostbite TAG under one 30% roll. With a tag outcome the class does NOT test
// "attacker has no status" (a tag can still land on a statused attacker), so the gate has no status.has atom.
bindCondition(
  5593,
  0,
  {
    all: [
      { id: "move.flag", flag: "MAKES_CONTACT" },
      { id: "rng.chance", pct: 30 },
    ],
  },
  "gate",
);

// The non-contact tier (contactExcluded): the move must INHERENTLY lack the contact flag (move.hasFlag, which ignores
// the attacker's Long Reach) AND the hit result must be a damaging one (EFFECTIVE, SUPER_EFFECTIVE, NOT_VERY_EFFECTIVE,
// ONE_HIT_KO). move.flag calls doesFlagEffectApply (user-aware), and no atom reads the hit result, so these four gates
// stay legacy until requests/B08.md R-B08-1 and R-B08-2 exist.
const NON_CONTACT_REASON =
  "non-contact tier: needs an atom for the move's own contact flag that ignores the attacker's Long Reach (move.hasFlag) and an atom for 'the hit was a damaging one' (hit result in EFFECTIVE, SUPER_EFFECTIVE, NOT_VERY_EFFECTIVE, ONE_HIT_KO); requests/B08.md R-B08-1 and R-B08-2";
bindLegacyClosure(9, 1, NON_CONTACT_REASON, "gate"); // Static: 10% paralysis on non-contact
bindLegacyClosure(49, 1, NON_CONTACT_REASON, "gate"); // Flame Body: 20% burn on non-contact
bindLegacyClosure(5358, 1, NON_CONTACT_REASON, "gate"); // White Noise: 10% paralysis on non-contact
bindLegacyClosure(5733, 3, NON_CONTACT_REASON, "gate"); // Smoldering Wood: 20% burn on non-contact

// =============================================================================================
// AteConditionalStatusAbAttr (Tier B). Slot "gate": holder.isOfType(T) && holder.getMoveType(move) === T, then (status and
// tag outcomes) the chance roll. The roll atom is last. The heal outcome (Fertilize) never rolls, so its gate has none.
// =============================================================================================
const ateGate = (type: string, pct: number): unknown => ({
  all: [
    { id: "mon.has-type", who: "holder", type },
    { id: "move.type", type, effective: true },
    { id: "rng.chance", pct },
  ],
});

bindCondition(5017, 2, ateGate("FIRE", 10), "gate"); // Immolate: burn
bindCondition(5104, 3, ateGate("FIRE", 10), "gate"); // Solar Flare: burn (the Immolate half)
bindCondition(6108, 2, ateGate("FIRE", 10), "gate"); // Blaze Release: burn
bindCondition(5063, 2, ateGate("POISON", 10), "gate"); // Intoxicate: badly poison
bindCondition(5428, 2, ateGate("POISON", 10), "gate"); // Sludgy Mix: badly poison
bindCondition(5140, 2, ateGate("ROCK", 10), "gate"); // Mineralize: bleed
bindCondition(5557, 2, ateGate("ROCK", 10), "gate"); // Molten Coat: bleed
bindCondition(5621, 3, ateGate("ROCK", 10), "gate"); // Lead Claws: bleed
bindCondition(5190, 2, ateGate("PSYCHIC", 10), "gate"); // Emanate: confusion
bindCondition(5219, 2, ateGate("PSYCHIC", 10), "gate"); // Enlightened: confusion
bindCondition(5940, 2, ateGate("PSYCHIC", 10), "gate"); // Brainpower: confusion
bindCondition(6036, 4, ateGate("PSYCHIC", 10), "gate"); // Nucleus: confusion

// Fertilize: the heal outcome is deterministic, so no chance atom.
bindCondition(
  5237,
  2,
  {
    all: [
      { id: "mon.has-type", who: "holder", type: "GRASS" },
      { id: "move.type", type: "GRASS", effective: true },
    ],
  },
  "gate",
);

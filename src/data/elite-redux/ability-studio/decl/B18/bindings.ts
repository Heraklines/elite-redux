/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// Instance bindings of batch B18 (spec 2.1): the library form of every Tier B gate of the three gated classes, keyed by
// (abilityId, attrIndex). The five marker classes (BiomeRevealBonusAbAttr, ExperienceGainMultiplierAbAttr,
// MoneyGainMultiplierAbAttr, BallRecoveryAbAttr, MoveHpCostModifierAbAttr) have no condition slot, so they need no binding.
//
// "attr N" is the position in `ability.attrs`. Every line was read by hand from the class source and the live attr, then
// mapped to the atom that calls the SAME engine predicate, in the ORIGINAL clause order (that order is the order of the
// random draw and of the short-circuits). The L1 differential evaluates the class's own `gate` against the library form
// over the state grid and fails on any difference.
import { bindCondition } from "#data/elite-redux/ability-studio/bindings";

// =============================================================================================
// ProvenanceBypassSpeedChanceAbAttr (Tier B). Slot "gate": the chance roll, `randBattleSeedInt(100) < chance`.
// The class guard (`!simulated`) runs before it and the residual (damaging move chosen, canAddTag) after it, both inside the class.
// =============================================================================================
bindCondition(259, 0, { id: "rng.chance", pct: 30 }, "gate"); // Quick Draw
bindCondition(5996, 0, { id: "rng.chance", pct: 30 }, "gate"); // Minigun

// =============================================================================================
// FirstTurnDirectDamageMultiplierAbAttr (Tier B). Slot "gate":
//   holder.tempSummonData.waveTurnCount === 1  &&  move.category !== STATUS
// =============================================================================================
const firstTurnDamagingMove = { all: [{ id: "time.first-turn" }, { id: "move.damaging" }] };
bindCondition(5278, 0, firstTurnDamagingMove, "gate"); // Readied Action
bindCondition(5320, 0, firstTurnDamagingMove, "gate"); // Demolitionist

// =============================================================================================
// PostDefendSuppressFirstInnateAbAttr (Tier B). Slot "gate", in the original order:
//   move.doesFlagEffectApply(MAKES_CONTACT, attacker -> holder)  &&  !hasMummyFamilyAbility(attacker)
// where the family is Mummy, Lingering Aroma, Wandering Spirit (`MUMMY_FAMILY.some(hasAbility)`). The residual (the attacker has
// an active first innate) stays in the class.
// =============================================================================================
const contactFromANonMummy = {
  all: [
    { id: "move.flag", flag: "MAKES_CONTACT" },
    {
      not: {
        any: [
          { id: "mon.has-ability", who: "other", ability: "MUMMY" },
          { id: "mon.has-ability", who: "other", ability: "LINGERING_AROMA" },
          { id: "mon.has-ability", who: "other", ability: "WANDERING_SPIRIT" },
        ],
      },
    },
  ],
};
bindCondition(152, 0, contactFromANonMummy, "gate"); // Mummy
bindCondition(268, 0, contactFromANonMummy, "gate"); // Lingering Aroma
bindCondition(6084, 0, contactFromANonMummy, "gate"); // Lingering Musk

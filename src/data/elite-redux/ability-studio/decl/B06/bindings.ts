/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// Instance bindings of batch B06 chunk 1 (spec 2.1): the library form of every constructor closure (slot "ctor:N") and every
// Tier B gate (slot "gate") of PostTurnStatusHealAbAttr, PostTurnResetStatusAbAttr, PostTurnRestoreBerryAbAttr, SpeedBoostAbAttr and
// PostTurnFormChangeAbAttr, keyed by (abilityId, attrIndex). attrIndex is the position in `ability.attrs`.
//
// Every line was read by hand from the live attr (the dump of the real instances, not the source text of the closure) and mapped
// to the atom that calls the SAME engine predicate, or marked legacy with the reason. The L1 differential then evaluates the
// original and the library form over the state grid; a binding is only a claim until that test passes.
//
// Not bound here (no constructor closure and no gate): MoodyAbAttr, CudChewRecordBerryAbAttr.
import { bindCondition, bindLegacyClosure } from "#data/elite-redux/ability-studio/bindings";

// =============================================================================================
// PostTurnStatusHealAbAttr, slot gate: `!pokemon.isFullHp()` (the status list is the class's own setting and guard).
// =============================================================================================
bindCondition(90, 0, { not: { id: "hp.full", who: "holder" } }, "gate"); // Poison Heal (Toxic, Poison)

// =============================================================================================
// PostTurnResetStatusAbAttr, slot gate, evaluated on the Pokemon that would be cured (the holder, or the picked ally):
//   (!!status && status !== FAINT) || hasErAilment(pokemon)   with ER_AILMENT_TAGS = ER_BLEED, ER_FROSTBITE, ER_FEAR.
// Same tree for every user; the ally mode only changes who is picked, which the class does before the gate runs.
// The class also excludes the FAINT status, which `status.has ANY` does not. It cannot differ in the real game: the holder comes
// from getField(true) (living Pokemon only) and an ally is picked by the class itself, which already skips FAINT.
// =============================================================================================
const CURABLE_STATUS_OR_AILMENT = {
  any: [
    { id: "status.has", who: "holder", status: "ANY" },
    { id: "tag.has", who: "holder", tag: "ER_BLEED" },
    { id: "tag.has", who: "holder", tag: "ER_FROSTBITE" },
    { id: "tag.has", who: "holder", tag: "ER_FEAR" },
  ],
};

const RESET_STATUS_SITES: readonly (readonly [abilityId: number, attrIndex: number, name: string])[] = [
  [61, 0, "Shed Skin (self, 30% attr condition)"],
  [93, 0, "Hydration"],
  [102, 0, "Leaf Guard"],
  [131, 0, "Healer (ally mode)"],
  [131, 1, "Healer (self)"],
  [5111, 2, "Big Leaves"],
  [5231, 0, "Purifying Waters"],
  [5371, 1, "Pattern Change (self, 30% attr condition)"],
  [5484, 0, "Caretaker (ally mode)"],
  [5484, 1, "Caretaker (self)"],
  [5502, 0, "Sun's Bounty"],
  [5528, 0, "Wonder Scale (self, 30% attr condition)"],
];
for (const [abilityId, attrIndex] of RESET_STATUS_SITES) {
  bindCondition(abilityId, attrIndex, CURABLE_STATUS_OR_AILMENT, "gate");
}

// =============================================================================================
// PostTurnRestoreBerryAbAttr, slot ctor:0: `procChance(pokemon)`, a NUMBER from 0 to 1 that is compared with one randSeedFloat().
// The library chance atom (rng.chance) is `randBattleSeedInt(100) < pct`, a different random stream and compare, so the
// closure stays as it is (requests/B06.md R-B06-4).
// =============================================================================================
const BERRY_CHANCE_REASON =
  "number-valued chance closure (1 in the sun, otherwise 0.5), rolled with randSeedFloat and >=; the library rng.chance uses randBattleSeedInt(100) < pct, a different draw (R-B06-4)";
bindLegacyClosure(139, 0, `Harvest: ${BERRY_CHANCE_REASON}`);
bindLegacyClosure(5111, 3, `Big Leaves: ${BERRY_CHANCE_REASON}`);
bindLegacyClosure(5502, 1, `Sun's Bounty: ${BERRY_CHANCE_REASON}`);
bindLegacyClosure(5970, 0, `Glycolysis: ${BERRY_CHANCE_REASON}`);
bindLegacyClosure(
  6055,
  0,
  "Serfdom: number-valued chance closure (1 while Grassy terrain and a Reap and Sow holder are on the field, otherwise 0.5), rolled with randSeedFloat and >= (R-B06-4)",
);

// =============================================================================================
// SpeedBoostAbAttr, slot gate: `simulated || (!turnData.switchedInThisTurn && !turnData.failedRunAway)`. No atom for either test.
// =============================================================================================
const SPEED_BOOST_REASON =
  "no atom for 'I did not switch in this turn' (turnData.switchedInThisTurn) or 'I did not fail to run away this turn' (turnData.failedRunAway) (R-B06-7)";
bindLegacyClosure(3, 0, `Speed Boost: ${SPEED_BOOST_REASON}`, "gate");
bindLegacyClosure(5379, 0, `Max Acceleration: ${SPEED_BOOST_REASON}`, "gate");

// =============================================================================================
// PostTurnFormChangeAbAttr, slot ctor:0: `formFunc(pokemon)`, a form NUMBER, not a yes/no condition (R-B06-8).
// =============================================================================================
bindLegacyClosure(
  161,
  2,
  "Zen Mode: form number function (HP ratio <= 0.5 gives form 1, otherwise 0); needs a number-valued form picker (R-B06-8)",
);
bindLegacyClosure(
  197,
  2,
  "Shields Down: form number function (stays Core, Meteor becomes Core at HP ratio <= 0.5, keeps its colour); needs form index atoms (R-B06-8)",
);
bindLegacyClosure(
  208,
  2,
  "Schooling: form number function (level < 20 or HP ratio <= 0.25 gives form 0, otherwise 1); needs a level atom and a form picker (R-B06-8)",
);
bindLegacyClosure(
  211,
  2,
  "Power Construct: form number function (formIndex + 2) behind an attr-level condition; needs form index atoms (R-B06-8)",
);
bindLegacyClosure(
  258,
  0,
  "Hunger Switch attr 0: form number function (a form with a key gives form 0, otherwise form 1), one direction of a toggle; needs a form key atom (R-B06-8)",
);
bindLegacyClosure(
  258,
  1,
  "Hunger Switch attr 1: form number function (a form with a key gives form 1, otherwise form 0), the other direction of the toggle; needs a form key atom (R-B06-8)",
);
bindLegacyClosure(
  5486,
  0,
  "Two-Faced attr 0: form number function (a form with a key gives form 0, otherwise form 1), one direction of a toggle; needs a form key atom (R-B06-8)",
);
bindLegacyClosure(
  5486,
  1,
  "Two-Faced attr 1: form number function (a form with a key gives form 1, otherwise form 0), the other direction of the toggle; needs a form key atom (R-B06-8)",
);
bindLegacyClosure(
  5586,
  2,
  "Revelation: form number function (Revelation form while HP ratio > 0.25, otherwise a base form); needs HP and form index atoms (R-B06-8)",
);

// =============================================================================================
// CudChewConsumeBerryAbAttr, slot gate: `pokemon.summonData.berriesEatenLast.length > 0` ("I ate a berry last turn"). No atom (R-B06-9).
// =============================================================================================
bindLegacyClosure(
  291,
  0,
  "Cud Chew: no atom for I ate a berry last turn (summonData.berriesEatenLast.length > 0) (R-B06-9)",
  "gate",
);

// =============================================================================================
// B06 chunk 2
//
// PostDancingMoveAbAttr, slot gate: `move.getMove().doesFlagEffectApply({ flag: DANCE_MOVE, user: source })` ("the move that was just
// used is a dance move"). The library atom move.flag calls the same predicate with the move user (the `other` of this moment). The
// two residual clauses (not my own move, not semi-invulnerable) stay in the class as feasibility and are not bound.
// Dancer (216, attr 0) and Samba (5469, attr 1) are the only users of this class; the ER copy-by-filter family is the subclass
// CopyMoveByFilterAbAttr, which replaces canApply and has no gate.
//
// Not bound here (no constructor closure and no gate): PostBiomeChangeWeatherChangeAbAttr, PostBiomeChangeTerrainChangeAbAttr,
// StatStageChangeMultiplierAbAttr, BypassBurnDamageReductionAbAttr, FullBurnDamageImmunityAbAttr, DoubleBerryEffectAbAttr and
// PreventBerryUseAbAttr.
// =============================================================================================
bindCondition(216, 0, { id: "move.flag", flag: "DANCE_MOVE" }, "gate"); // Dancer
bindCondition(5469, 1, { id: "move.flag", flag: "DANCE_MOVE" }, "gate"); // Samba

/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// Deadeye Draw, part 3 of 3 (Tier C, engine-query). "My pulse moves hit my marked foe's weaker defence."
//
// Source: abilities/newcomer-signature-mechanics.ts, DeadeyeMarkerAbAttr (extends AbAttr directly; apply is empty).
// The class is a MARKER that the engine looks for by name:
//   shouldDeadeyeUseLowerDefense(user, target, move) = hasAttr(user, "DeadeyeMarkerAbAttr") && deadeyeApplies(...)
//     where deadeyeApplies = a target exists, DEADEYE_MARK[user] === target, move.hasFlag(PULSE_MOVE), target.isOnField()
//   called from Pokemon.getAttackDamage (field/pokemon.ts:5684): when it is true (and the source's abilities are not
//   ignored) the defensive stat used is whichever of the target's effective DEF and SPDEF is lower (DEF on a tie).
// No RNG, no constructor arguments, no state of its own (the mark is DeadeyeMarkAbAttr's).
import { DeadeyeMarkerAbAttr } from "#data/elite-redux/abilities/newcomer-signature-mechanics";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";

export default defineDecl(DeadeyeMarkerAbAttr, {
  tier: "C",
  kind: "engine-query",
  when: "while.active",
  label: "Hit my marked foe's weaker defence with pulse moves",
  summary: () =>
    "While I have this, my pulse moves against the foe I marked are calculated against whichever of its Defense and Sp. Def is lower.",
  synonyms: [
    "target weaker defense",
    "ignore the stronger defense",
    "exploit weakness",
    "lower defense stat",
    "deadeye draw",
    "pierce",
  ],
  examples: ["My pulse moves hit the marked foe's weaker defence, like Deadeye Draw"],
  params: [],
  noParamsReason:
    "A presence flag read by name from the damage calculation (shouldDeadeyeUseLowerDefense); the weaker-defence choice has no number or setting.",
  conditions: [],
  guards: [],
  feasibility: [
    "Only against the foe I marked, only with a pulse move, only while that foe is on the field (tested inside the damage calculation, not by this ability: R-B13-34 and R-B13-38 ask for a moment and conditions)",
    "It does nothing when the attacker's abilities are ignored (Mold Breaker style)",
    "The weaker stat is compared with each stat's current value including stages; Defense wins a tie",
  ],
  reusableAlone: { when: true, if: false, do: true },
  flags: { rng: "none", state: "none", simulated: "respects" },
  l2StaticReason:
    "The flag is consulted by name inside the damage calculation, which is not a dispatched moment; B13/deadeye.test.ts proves the rule with a marked foe.",
  probes: [{ name: "a damaging hit with nothing marked", axes: { foeMove: ["TACKLE"] } }],
  status: "decomposed",
  notes:
    "ENGINE-QUERY, justified: the class is a flag; the rule lives in shouldDeadeyeUseLowerDefense, called by name from the damage calculation (field/pokemon.ts:5684), so a rebuilt attr cannot carry it. The trigger (a moment when the game picks the defence stat, with the move and the marked foe) and its conditions (the target is my mark, the move is a pulse move, the target is on the field) are not dispatched, so no WHEN or IF block can wrap them: requested as R-B13-38 (a dispatched WHEN for the defensive-stat pick, or `calc.defensive-stat-pick` reaching this class) together with R-B13-34 (the 'my mark' atom). The dispatch key list of while.active needs this class (R-B13-19; the same minimal flag-key entry the earlier chunks made was added). Users: Deadeye Draw (5984, attr 2). ODDITIES (not fixed): the ability text says 'cannon moves'; the code tests PULSE_MOVE only.",
});

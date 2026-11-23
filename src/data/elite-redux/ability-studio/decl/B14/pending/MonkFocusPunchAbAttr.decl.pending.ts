/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B14 chunk 3. PARKED until the librarian adds this class to the `flagKeys` of the WHEN `while.active` (request R-B14-3.1, same
// shape as R-B14-2.3 and R-B12-13); then rename this file to MonkFocusPunchAbAttr.decl.ts. The registry only collects `*.decl.ts`.
//
// "Focus Punch keeps its full power even after I was hit."
//
// Source: bernerd-roster-mechanics.ts `export class MonkFocusPunchAbAttr extends AbAttr {}`: an empty class, a presence marker.
// Nothing dispatches it. The only reader is the Elite Redux Focus Punch patch (init-elite-redux-vanilla-move-patches.ts:1397): it
// removes the interrupt, then adds a power multiplier `40 / move.power` whenever `user.turnData.attacksReceived.some(r => r.damage > 0)`
// AND the user does NOT have the marker (checked by class NAME). So without the marker Focus Punch drops from 150 to 40 power after I
// took damage this turn; with it, it stays at 150. The 40 is a literal in the patch, not in the class (requested R-B14-3.4).
// No constructor, no closure, no random draw, no state. The check is by class name: it must never be renamed.
import { MonkFocusPunchAbAttr } from "#data/elite-redux/abilities/bernerd-roster-mechanics";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";

export default defineDecl(MonkFocusPunchAbAttr, {
  tier: "C",
  kind: "engine-query",
  when: "while.active",
  label: "Keep Focus Punch at full power after being hit",
  summary: () =>
    "While I have this, Focus Punch keeps its normal power even if I took damage this turn (without it, its power drops to 40). Example: hit first, then Focus Punch still hits at full strength.",
  synonyms: [
    "focus punch",
    "no focus penalty",
    "keep focus",
    "ignore interruption",
    "monk",
    "punch after being hit",
    "calm mind",
  ],
  examples: ["My Focus Punch hits at full strength even when I am attacked first"],
  params: [],
  noParamsReason:
    "A presence marker read by the Focus Punch power patch; the penalty (power drops to 40) is a number inside that patch, so nothing in the class can be tuned; it is requested as an editable value.",
  conditions: [],
  guards: [],
  feasibility: [
    "It only changes Focus Punch; every other move ignores it",
    "Focus Punch is never interrupted in this game, it only loses power",
  ],
  reusableAlone: { when: true, if: false, do: true },
  flags: { rng: "none", state: "none", simulated: "respects" },
  l2StaticReason:
    "A flag has no dispatch moment (no trace event), so the twin only compares the whole battle: the holder takes a hit and attacks, and the battles must match. The power change is driven by B14/chunk3.test.ts.",
  probes: [{ name: "the holder takes a hit", axes: {} }],
  status: "decomposed",
  notes:
    "Engine-query, Tier C. Users (1): Monk (6083) attr 3 (its other attrs, BattlerTagImmunityAbAttr, IntimidateImmunityAbAttr, ConditionalAlwaysHitAbAttr and ChangeMovePriorityAbAttr (Focus Punch priority +3), belong to other batches). The reader is the move patch, not the class. In the test world the effective power of an unhit Focus Punch came out as 60 (not the move table value of 150), a factor outside this class that was not investigated; the marker removes exactly the 40/150 cut (proved in B14/chunk3.test.ts).",
});

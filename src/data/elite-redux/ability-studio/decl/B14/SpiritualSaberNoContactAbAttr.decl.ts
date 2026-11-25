/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B14 chunk 2. PARKED until the librarian adds this class to the `flagKeys` of the WHEN `while.active` (request R-B14-2.3, same shape
// as R-B12-13); then rename this file to SpiritualSaberNoContactAbAttr.decl.ts. The registry only collects `*.decl.ts`.
//
// "My slicing moves never count as making contact" (Spiritual Saber: Keen Edge moves are non-contact).
//
// Source: fakemon-pitch-mechanics.ts SpiritualSaberNoContactAbAttr (extends AbAttr directly, `super(false)`; no method, no field).
// It is never dispatched. The only reader is Move.doesFlagEffectApply (data/moves/move.ts:1014), MAKES_CONTACT case, after the
// Long Reach and Punching Glove exits and before the Manifest rewrite:
//   `this.doesFlagEffectApply({ flag: SLICING_MOVE, user, target })
//      && user.getAllActiveAbilityAttrs().some(attr => attr?.constructor?.name === "SpiritualSaberNoContactAbAttr")`  ->  no contact
// The "slicing move" test lives in that engine call site, not in the class: the class is a pure presence flag whose meaning
// (only slicing moves, by the move's flag as modified by abilities) is decided where the game asks "does this move make contact?".
// So this is an engine-query like FloatAbAttr, and the property cannot be a param of the class today. Moving the property into
// the class (an `appliesTo(move)` method read by the engine) is a game-code change for the engine-query sweep (request below).
// No constructor argument, no closure, no random draw, no state, no `simulated` test.
import { SpiritualSaberNoContactAbAttr } from "#data/elite-redux/abilities/fakemon-pitch-mechanics";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";

export default defineDecl(SpiritualSaberNoContactAbAttr, {
  tier: "C",
  kind: "engine-query",
  when: "while.active",
  label: "My slicing moves never count as making contact",
  summary: () =>
    "While I have this, my slicing moves (the Keen Edge group, like Night Slash) make no contact, so contact punishers do not trigger on them. Other moves are unchanged.",
  synonyms: [
    "spiritual saber",
    "keen edge",
    "slicing moves no contact",
    "no contact",
    "blade moves",
    "ranged blades",
    "sword moves",
  ],
  examples: ["My blade moves never trigger Rough Skin or Static"],
  params: [],
  noParamsReason:
    "A presence flag read by the engine query 'does this move make contact?' (Move.doesFlagEffectApply); the slicing-move rule is decided in that engine call site, so there is nothing in the class to configure.",
  conditions: [],
  guards: [],
  feasibility: [
    "Only moves with the slicing property are affected (decided where the game asks whether a move makes contact)",
    "Long Reach and Punching Glove checks run first and keep their answer; the Manifest rewrite runs after and is not reached for a slicing move",
  ],
  reusableAlone: { when: true, if: false, do: true },
  flags: { rng: "none", state: "none", simulated: "respects" },
  l2StaticReason:
    "A flag has no dispatch moment (no trace event), so the twin only compares the whole battle: the holder attacks a Rough Skin foe with a slicing move and a normal move and the battles must match.",
  probes: [{ name: "a slicing move and a contact move against a contact punisher", axes: {} }],
  status: "decomposed",
  notes:
    "Engine-query, Tier C (precedent: IgnoreContactAbAttr and FloatAbAttr). Users (1): Spiritual Saber (6065) attr 3 (attrs 0 and 1 are FlagDamageBoostAbAttr, attr 2 is MoveCategoryOverrideAbAttr, declared by other batches). Whether the slicing-move rule should move out of move.ts into the class (so the property becomes a param) is requested as part of the engine-query sweep. Oddity, not fixed: the rule reads the move's flag through doesFlagEffectApply, so a move that only counts as slicing because of another ability also loses contact.",
});

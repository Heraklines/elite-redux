/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B14 chunk 2. PARKED until the librarian adds this class to the `flagKeys` of the WHEN `while.active` (request R-B14-2.3, same shape
// as R-B12-13); then rename this file to ManifestContactAbAttr.decl.ts. The registry only collects `*.decl.ts`.
//
// "My moves that normally make no contact make contact" (Manifest: contact on every move).
//
// Source: fakemon-pitch-mechanics.ts ManifestContactAbAttr (extends AbAttr directly, `super(false)`). It has one method,
// `forcesContact(): true`, which nothing in the game calls (only a unit test). The real reader is Move.doesFlagEffectApply
// (data/moves/move.ts:1022), MAKES_CONTACT case, AFTER every exit that forces no contact:
//   `user.getAllActiveAbilityAttrs().some(attr => attr?.constructor?.name === "ManifestContactAbAttr") && !this.hasFlag(MAKES_CONTACT)`
//   ->  contact (true)
// Order of the contact checks there: Long Reach, substitute hit, Punching Glove, Spiritual Saber (all return false), then
// Manifest (returns true), then the move's own flag. Because Long Reach and the others come first, they win over Manifest.
// The "move has no contact of its own" test is the engine's, as with Spiritual Saber; the class is a presence flag.
// No constructor argument, no closure, no random draw, no state, no `simulated` test.
import { ManifestContactAbAttr } from "#data/elite-redux/abilities/fakemon-pitch-mechanics";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";

export default defineDecl(ManifestContactAbAttr, {
  tier: "C",
  kind: "engine-query",
  when: "while.active",
  label: "My moves always count as making contact",
  summary: () =>
    "While I have this, my moves that do not normally make contact make contact, so contact abilities like Rough Skin trigger on them. Long Reach style effects still win.",
  synonyms: ["manifest", "force contact", "always contact", "touch moves", "contact on every move", "makes contact"],
  examples: ["Even my ranged moves trigger the target's contact abilities"],
  params: [],
  noParamsReason:
    "A presence flag read by the engine query 'does this move make contact?' (Move.doesFlagEffectApply); the rule is decided in that engine call site, so there is nothing in the class to configure.",
  conditions: [],
  guards: [],
  feasibility: [
    "Effects that stop contact (Long Reach, Punching Glove, Spiritual Saber, hitting a substitute) are checked first and keep their answer",
  ],
  reusableAlone: { when: true, if: false, do: true },
  flags: { rng: "none", state: "none", simulated: "respects" },
  l2StaticReason:
    "A flag has no dispatch moment (no trace event), so the twin only compares the whole battle: the holder attacks a Rough Skin foe with a non-contact move and the battles must match.",
  probes: [{ name: "a non-contact move against a contact punisher", axes: {} }],
  status: "decomposed",
  notes:
    "Engine-query, Tier C. Users (1): Manifest (6068) attr 0. The method forcesContact() is dead code in the game (only test/tests/elite-redux/fakemon-pitch-expansion-abilities.test.ts calls it); the engine reads the class by name. Oddity, not fixed: the answer is decided by the move's OWN contact flag (hasFlag), so a move that gains contact from another ability is not affected, which is harmless.",
});

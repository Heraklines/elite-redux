/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B07 / while-active flag (copy of the IgnoreContact precedent). See ../PRECEDENTS.md.
//
// The class has no behaviour of its own (the body is empty, nothing is dispatched). The engine asks, inside
// `Move.doesFlagEffectApply` for the IGNORE_PROTECT flag (move.ts):
//   `user.hasAbilityWithAttr("IgnoreProtectOnContactAbAttr") && this.doesFlagEffectApply({ flag: MAKES_CONTACT, user })`
// and the move then goes through Protect-style effects. Order: this flag AND "the move makes contact" (which itself
// goes through the contact-ignoring abilities), then the ER flag-based bypass (Pinnacle Blade) and the first-turn bypass
// (Demolitionist), which are other classes. So the only thing a declaration can say is "this flag is present"; the
// contact test is the engine's.
import { IgnoreProtectOnContactAbAttr } from "#abilities/ab-attrs";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";

export default defineDecl(IgnoreProtectOnContactAbAttr, {
  tier: "C",
  kind: "while-active",
  when: "while.active",
  label: "My contact moves go through protection",
  summary: () =>
    "While I have this, my moves that make contact ignore protection moves such as Protect and hit anyway. Example: Tackle breaks through Protect.",
  synonyms: [
    "unseen fist",
    "ignore protect",
    "break through protect",
    "bypass protect",
    "protect breaker",
    "final blow",
    "contact ignores protection",
  ],
  examples: ["My contact moves break through Protect, like Unseen Fist"],
  params: [],
  noParamsReason:
    "A pure presence flag: the engine only checks that the attr exists (hasAbilityWithAttr), so there is nothing to configure.",
  conditions: [],
  guards: [],
  feasibility: [
    "Only moves that make contact (after contact-ignoring abilities such as Long Reach) are let through; the engine tests that itself",
  ],
  reusableAlone: { when: true, if: false, do: true },
  flags: { rng: "none", state: "none", simulated: "respects" },
  probes: [{ name: "a contact and a non-contact move against a protecting foe", axes: {} }],
  l2StaticReason:
    "A flag has no dispatch moment, so the shared twin only compares whole battles. The engine site (Move.doesFlagEffectApply, IGNORE_PROTECT) is driven directly in test/tests/elite-redux/decomp/B07/flag-sites.test.ts for the original, the rebuilt attr and a control.",
  status: "decomposed",
  notes:
    "While-active flag, Tier C. Read only by Move.doesFlagEffectApply (move.ts, IGNORE_PROTECT case) through hasAbilityWithAttr. Users: Unseen Fist (260, attr 0) and Final Blow (5388, attr 0); showAbility true for both (dump of the live attrs), which is the AbAttr default, so there is no constructor argument to fix. Nothing to bind (no closure). Siblings that are separate classes: IgnoreProtectByFlagAbAttr (a flag instead of contact, Pinnacle Blade) and IgnoreProtectFirstTurnAbAttr (Demolitionist).",
});

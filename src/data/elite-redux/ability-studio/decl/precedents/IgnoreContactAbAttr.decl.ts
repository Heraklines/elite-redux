/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// PRECEDENT: while-active (a pure flag). See ../PRECEDENTS.md.
//
// Nothing is dispatched. The engine asks `pokemon.hasAbilityWithAttr("IgnoreContactAbAttr")` inside
// Move.doesFlagEffectApply, and the flag is simply "present" or "absent". So there is no moment, no condition slot
// and no effect to configure: the whole declaration is the label, the synonyms and the written reason that it has
// no params. `when` is the shared "while.active" WHEN, whose flagKeys name this class.
import { IgnoreContactAbAttr } from "#abilities/ab-attrs";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";

export default defineDecl(IgnoreContactAbAttr, {
  tier: "C",
  kind: "while-active",
  when: "while.active",
  label: "My moves never count as making contact",
  summary: () => "While I have this, my moves make no contact",
  synonyms: ["long reach", "no contact", "contactless", "ranged attacks", "never touch"],
  examples: ["My attacks never make contact"],
  params: [],
  noParamsReason:
    "A pure presence flag: the engine only checks that the attr exists (hasAbilityWithAttr), so there is nothing to configure.",
  conditions: [],
  guards: [],
  feasibility: [],
  reusableAlone: { when: true, if: false, do: true },
  flags: { rng: "none", state: "none", simulated: "respects" },
  probes: [{ name: "contact moves against a contact punisher", axes: {} }],
  l2StaticReason:
    "A flag has no dispatch moment (no trace event), so the twin only compares the whole battle: the holder attacks a Rough Skin foe with Tackle and the battles must match.",
  status: "verified",
  notes:
    "Precedent for while-active flags. Tier C because there is nothing to split; extra IFs cannot be added (`if: false`). Read by Move.doesFlagEffectApply (MAKES_CONTACT case); see harness scenario 'while-active-flags'.",
});

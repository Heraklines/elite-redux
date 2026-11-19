/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B05 / while-active flag (copy of the IgnoreContact precedent). See ../PRECEDENTS.md.
//
// The class has no behaviour of its own (`apply` is empty, nothing is dispatched). The Drenched effect asks
// `pokemon.hasAbilityWithAttr("DrenchImmunityAbAttr")` inside `ErDrenchedTag.canAdd` (battler-tags.ts) and refuses to
// be added when the answer is yes. Order inside canApply of the tag: Water type -> this flag -> a Water-absorbing
// ability. So the only thing a declaration can say is "this flag is present".
import { DrenchImmunityAbAttr } from "#abilities/ab-attrs";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";

export default defineDecl(DrenchImmunityAbAttr, {
  tier: "C",
  kind: "while-active",
  when: "while.active",
  label: "Cannot be drenched",
  summary: () =>
    "While I have this, the Drenched slowdown cannot be put on me, so I keep my normal move order. Example: a foe's Water move cannot make me move last.",
  synonyms: [
    "drench immunity",
    "immune to drenched",
    "no water slowdown",
    "cannot be slowed",
    "amphibious",
    "old mariner",
    "poseidon's dominion",
  ],
  examples: ["Cannot become drenched, like Amphibious", "Water moves cannot make me move last"],
  params: [],
  noParamsReason:
    "A pure presence flag: the Drenched effect only asks whether the Pokemon has it (hasAbilityWithAttr), so there is nothing to configure.",
  conditions: [],
  guards: [],
  feasibility: [
    "Water types and Pokemon with a Water-absorbing ability are already immune to being drenched; that rule is separate and stays in the Drenched effect",
  ],
  reusableAlone: { when: true, if: false, do: true },
  flags: { rng: "none", state: "none", simulated: "respects" },
  probes: [{ name: "the Drenched effect is added to the holder", axes: {} }],
  l2StaticReason:
    "A flag has no dispatch moment, so the shared twin only compares whole battles. The engine site (ErDrenchedTag.canAdd) is driven directly in test/tests/elite-redux/decomp/B05/flag-sites.test.ts for the original and the rebuilt attr.",
  status: "decomposed",
  notes:
    "While-active flag, Tier C. Read only by ErDrenchedTag.canAdd (battler-tags.ts), which tests Water type first, then this flag, then a Water-absorbing TypeImmunityAbAttr. Users: Amphibious (attr 1), Old Mariner (attr 3), Poseidon's Dominion (attr 1, appended by the ability upgrade patch 784 through appendAbilityAttrsOnce). Nothing to bind (no closure). Stale comment: the class doc still says Drench is not implemented and the marker is inert, but ER_DRENCHED exists and is applied by moves and by Life Preserver, so the flag is live. Dropping the 'is drench-immune' effect into a composable block would need the engine to route the Drenched tag through the tag-immunity hook (see requests/B05.md, R-B05-2).",
});

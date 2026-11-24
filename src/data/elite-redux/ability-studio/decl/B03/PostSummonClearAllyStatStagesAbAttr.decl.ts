/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B03 chunk 3. Tier A, event-effect on entry, no constructor argument, no closure.
//
//   canApply   at least one ally (any, not only the adjacent one) is active: `pokemon.getAllies().some(a => a.isActive(true))`
//   apply      unless simulated, for EVERY active ally: set all seven stat stages (Attack, Defense, Sp. Atk, Sp. Def,
//              Speed, Accuracy, Evasion) to 0, raises AND drops alike, then queue one message per ally
//
// `canApply` is effect-side feasibility ("there is an ally whose stages can be reset"); the class has no number, no
// type and no status to tune, so it has no params. No library effect resets stat stages (`effect.stat-stage` changes
// by an amount, it cannot set to zero), so `effect` is left out and `effect.reset-stat-stages` is requested in
// requests/B03.md together with its sibling PostSummonClearOpponentPositiveStatStagesAbAttr.
import { PostSummonClearAllyStatStagesAbAttr } from "#abilities/ab-attrs";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";

export default defineDecl(PostSummonClearAllyStatStagesAbAttr, {
  tier: "A",
  kind: "event-effect",
  when: "event.on-entry",
  label: "Reset my ally's stat boosts and drops when I enter",
  summary: () =>
    "When I enter the battle, every active ally's stat stages go back to 0, both boosts and drops. Example: an ally at +2 Attack and -1 Speed ends at 0 in everything.",
  synonyms: [
    "curious medicine",
    "reset ally stats",
    "clear ally boosts",
    "haze on ally",
    "cleanse stat changes",
    "remove ally stat changes",
  ],
  examples: ["Reset my ally's stat changes when I enter, like Curious Medicine"],
  params: [],
  noParamsReason:
    "The class takes no arguments: it always resets all seven stat stages of every active ally to 0. There is no number, stat or type to tune.",
  conditions: [],
  guards: [],
  feasibility: [
    "At least one active ally must exist (in a triple battle any of them, not only the one next to me), otherwise nothing happens and the ability does not show",
    "It does nothing in a preview",
  ],
  reusableAlone: { when: true, if: true, do: false },
  flags: { rng: "none", state: "none", simulated: "respects" },
  probes: [{ name: "entry with the default field", axes: {} }],
  status: "decomposed",
  notes:
    "Tier A, 2 attrs of 2 abilities, no closure: Curious Medicine (261 attr 0) and its alias CuriusMedicn (5002 attr 0). No library DO block resets stat stages to zero, so the declaration has no `effect` until `effect.reset-stat-stages` (target: ally, foes or everyone; which: all stages or only the raised ones) exists (requests/B03.md); the single-player L2 battle has no ally, so `canApply` is false there and the effect itself is proven by test/tests/elite-redux/decomp/B03/chunk3.test.ts. Quirk recorded, not fixed: `canApply` asks any ally (`getAllies`) while PostSummonAllyHealAbAttr asks the adjacent ones, so the two classes disagree about who counts as an ally in a triple battle.",
});

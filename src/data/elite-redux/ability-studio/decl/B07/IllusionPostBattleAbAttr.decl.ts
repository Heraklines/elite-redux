/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B07 chunk 3 / event effect, Tier C (one-piece effect, no closure). See ../PRECEDENTS.md.
//
// "After the battle ends, drop any disguise I still have". The engine dispatches PostBattleAbAttr for every Pokemon allowed in battle
// (battle-end-phase.ts). The class has no canApply of its own (the base class says true) and `apply` is `pokemon.breakIllusion()`,
// which does nothing when there is no disguise (it returns false). The ability adds it with `.conditionalAttr(pokemon =>
// pokemon.isAllowedInBattle(), IllusionPostBattleAbAttr, false)`, so the attr carries an attr-level condition (`extraCondition`). That is
// not a constructor argument and not part of the class rule; `recomposeAttr` copies it onto a rebuilt attr as it is.
import { IllusionPostBattleAbAttr } from "#abilities/ab-attrs";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";

export default defineDecl(IllusionPostBattleAbAttr, {
  tier: "C",
  kind: "event-effect",
  when: "event.after-battle",
  label: "Drop my disguise when the battle ends",
  summary: () =>
    "When the battle is over, my disguise (the look of another Pokemon) is dropped, so I can use it again in the next battle. Example: Zoroark.",
  synonyms: [
    "illusion",
    "zoroark",
    "reset the disguise",
    "disguise ends after battle",
    "show my real form after the fight",
  ],
  examples: ["Take off the disguise once the fight is over, like Zoroark"],
  params: [],
  noParamsReason:
    "A fixed rule with nothing to choose. The only constructor argument is showAbility, which is never exposed (fixed to false, no ability banner is shown).",
  conditions: [],
  guards: [],
  feasibility: [
    "Does nothing when I am not disguised",
    "Only a Pokemon that can still battle is asked (the ability adds that check itself)",
  ],
  // No library effect says "drop my disguise"; request R-B07-9 (effect.reveal-illusion).
  effect: { id: "effect.package", params: [] },
  fixedCtorArgs: { 0: false },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "none", simulated: "ignores" },
  probes: [{ name: "the end of a battle while disguised", axes: {} }],
  l2StaticReason:
    "The WHEN event.after-battle is not reached by any scenario template of the shared battle twin (the decomp-l2-reach fixture lists it as unreached), so the engine site is driven directly in test/tests/elite-redux/decomp/B07/flag-sites-3.test.ts: set an illusion, dispatch PostBattleAbAttr, read summonData.illusion, for the original, the rebuilt attr and a control.",
  status: "decomposed",
  notes:
    "Tier C, one-piece effect. User (live dump): Illusion (149, attr 5), showAbility false, with the attr-level condition `pokemon => pokemon.isAllowedInBattle()` (extraCondition, carried over by the rebuild). The class never reads `simulated` (breakIllusion is a real change), but PostBattle is never dispatched as a preview.",
});

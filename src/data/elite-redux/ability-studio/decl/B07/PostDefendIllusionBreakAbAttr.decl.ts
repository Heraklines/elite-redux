/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B07 chunk 3 / event effect, Tier C (one-piece effect, no closure). See ../PRECEDENTS.md.
//
// "After I am hit, IF the hit did damage and I have a disguise on, drop the disguise". PostDefendAbAttr is dispatched from the move
// phases with `{ pokemon, opponent, move, damage, hitResult, simulated }`. Clauses, in the ORIGINAL order (ab-attrs.ts):
//   canApply  1. `hitResult` is EFFECTIVE, SUPER_EFFECTIVE, NOT_VERY_EFFECTIVE or ONE_HIT_KO. CONDITION in spirit: "a damaging hit
//                landed" (a miss, a block, a status move and indirect damage do not count). No library atom reads the hit result; R-B07-10.
//             2. `pokemon.summonData.illusion != null`   feasibility: there is a disguise to drop.
//   apply     `pokemon.breakIllusion()`: clears the look-alike, plays the transform sound and redraws the sprite.
// No random draw, no state of its own, no constructor argument except the inherited `showAbility`.
import { PostDefendIllusionBreakAbAttr } from "#abilities/ab-attrs";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";

export default defineDecl(PostDefendIllusionBreakAbAttr, {
  tier: "C",
  kind: "event-effect",
  when: "event.after-hit",
  label: "Drop my disguise when a damaging hit lands",
  summary: () =>
    "After I take a damaging hit while disguised as another Pokemon, my disguise is dropped and everybody sees my real look. Example: Zoroark loses its Illusion.",
  synonyms: [
    "illusion",
    "zoroark",
    "break the disguise",
    "reveal myself",
    "illusion ends when hit",
    "show my real form",
  ],
  examples: ["Stop looking like a teammate as soon as I take damage, like Zoroark"],
  params: [],
  noParamsReason:
    "A fixed rule with nothing to choose: any damaging hit drops the disguise. The only constructor argument is showAbility, which is never exposed (fixed to true).",
  conditions: [],
  guards: [],
  feasibility: [
    "Only a hit that did damage counts (a miss, a blocked move, a status move or indirect damage does not)",
    "Does nothing when I am not disguised",
  ],
  // No library effect says "drop my disguise"; request R-B07-9 (effect.reveal-illusion). The hit-result test is R-B07-10.
  effect: { id: "effect.package", params: [] },
  fixedCtorArgs: { 0: true },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "none", simulated: "ignores" },
  probes: [
    { name: "a damaging hit and a status move against a disguised holder", axes: { foeMove: ["TACKLE", "TOXIC"] } },
  ],
  status: "decomposed",
  notes:
    "Tier C, one-piece effect. User (live dump): Illusion (149, attr 2), showAbility true. The class never reads `simulated`, so a dispatch that is only a preview would still drop the disguise (the engine only dispatches PostDefend for real hits). A TODO in the source says the damaging-hit-result set is declared elsewhere too; it is not merged here.",
});

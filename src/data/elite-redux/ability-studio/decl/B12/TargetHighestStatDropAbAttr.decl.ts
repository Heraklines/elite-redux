/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B12 chunk 2. "When I enter, lower each foe's highest stat of a group" (Malicious: the higher of Attack and Sp. Atk, then the higher
// of Defense and Sp. Def).
//
// Source: src/data/elite-redux/archetypes/target-highest-stat-drop.ts, TargetHighestStatDropAbAttr (extends PostSummonAbAttr).
// Constructor: one options object `{ rules }`, a non-empty list of `{ candidates, stages }`; `super(true)` shows the banner and keeps
// the default "also works when gained mid-battle". Clauses, in the original order:
//   canApply  `pokemon.getOpponents().length > 0`                                        FEASIBILITY: there is at least one foe
//   apply     skipped when `simulated`; for each ADJACENT foe (`getAdjacentOpponents`) that is still standing, for each rule, in order:
//               best = the candidate with the highest `opp.getStat(stat, false)` (no stat stages; strictly higher wins, so a tie keeps the
//               earlier candidate), then queue ONE StatStageChangePhase on that foe for [best] by `rule.stages` (selfTarget false)
// No random draw, no memory. Tier C package for the EFFECT only: the library `effect.stat-stage` names its stat in advance, while this
// effect picks the stat at the moment it happens by comparing the foe's own values. The trigger (entering the battle) is the shared
// WHEN and there is no condition to separate (the foe-exists test is feasibility), so both stay swappable.
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";
import { TargetHighestStatDropAbAttr } from "#data/elite-redux/archetypes/target-highest-stat-drop";
import { highestStatRulesCodec } from "./b12-chunk2-codecs";

export default defineDecl(TargetHighestStatDropAbAttr, {
  tier: "C",
  kind: "package",
  when: "event.on-entry",
  label: "Lower each foe's highest stat of a group when I enter",
  summary: params =>
    `When I enter, each foe nearby loses stages in its highest stat of each group: ${params.rules}. Example: the higher of Attack and Sp. Atk goes down by 1.`,
  synonyms: [
    "lower highest stat",
    "intimidate on the best stat",
    "drop the strongest stat",
    "weaken foe's best stat",
    "entry stat drop",
    "malicious",
    "break their best stat",
  ],
  examples: [
    "Lower the higher of the foe's Attack and Sp. Atk, and the higher of its Defense and Sp. Def, by one stage each when I enter, like Malicious",
    "Lower the foe's highest of Attack, Sp. Atk and Speed by two stages when I enter",
  ],
  params: [
    {
      id: "rules",
      ctorIndex: 0,
      ctorOption: "rules",
      path: "rules",
      control: "text",
      label: "Rules separated by ';', like 'Attack or Sp. Atk -1; Defense or Sp. Def -1' (stages -6 to 6)",
      editable: true,
      default: "Attack or Sp. Atk -1; Defense or Sp. Def -1",
      codec: highestStatRulesCodec,
    },
  ],
  conditions: [],
  guards: [],
  feasibility: [
    "Needs at least one opposing Pokemon",
    "Only foes next to me are affected (in a triple battle the far foe is not), and a fainted foe is skipped",
    "The highest stat is compared by its real value with no stat stages; on a tie the first stat named wins",
    "A stat that is already at its limit does not move further",
    "Nothing happens when the game only previews the move",
  ],
  effect: { id: "effect.package", params: ["rules"] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "none", simulated: "respects" },
  probes: [{ name: "entry against a foe whose Attack is higher than its Defense", axes: {} }],
  status: "decomposed",
  notes:
    "Package for the effect only, justified: the library's stat-stage effect has a fixed stat chosen by staff (one stat, one number of stages), and the library has no 'foe's highest stat of this group' choice; the stat is picked from the foe's live values at the moment of the effect, so it cannot be a fixed block (request R-B12-14: `effect.stat-stage` with `stat: highest-of-group`, target 'each foe next to me'). The effect still has a typed setting (the rule list, with a codec) and the trigger is the swappable shared WHEN `event.on-entry`; there is no condition inside. Tier C, 1 attr: Malicious (5305 attr 0): rules [Attack or Sp. Atk, -1] then [Defense or Sp. Def, -1] (read from the live attr). Oddities, not fixed: (0) the dispatcher comment and the archetype file header say 'the higher of Attack vs Defense and of Sp. Atk vs Sp. Def', but the live rules compare Attack with Sp. Atk and Defense with Sp. Def, which matches the ability text 'highest Attack and Defense stat'; (a) `canApply` counts ALL opponents (`getOpponents`) while `apply` walks only the adjacent ones, so in a triple battle with only a far foe the ability flashes and does nothing; (b) `apply` has no random draw but queues one phase per rule per foe, so the order of the rules is the order of the drops; (c) a tie between two candidates keeps the first listed because the comparison is strictly greater than; (d) the highest stat is measured without stat stages, so a foe whose Defense was raised by stages can still lose its (higher by base value) Attack.",
});

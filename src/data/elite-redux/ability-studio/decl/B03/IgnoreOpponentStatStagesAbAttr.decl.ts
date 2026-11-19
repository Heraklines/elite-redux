/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B03 chunk 2. Tier A, calc-modifier.
//
//   canApply   stats.includes(stat)  &&  (opponentCondition is absent  ||  (the foe is known && opponentCondition(foe)))
//   apply      ignored.value = true      (never touches anything else; ignores `simulated` because it only sets a flag)
//
// Both clauses are rules staff may change, so there is NO gate refactor: the stat list is a param (`stats`), and the
// optional constructor closure `opponentCondition` is the condition slot `ctor:1`. A user without a closure
// (Unaware, Keen Eye, Mind's Eye, Contempt, ...) needs no binding. The class code is not touched.
//
// The closure is asked about the FOE (`opponent`), not about the holder. The only slot kind that hands a closure one
// bare Pokemon is "holder", so a library form of this closure reads the foe as its `holder`. That is a quirk of the slot
// kind, not of the atoms; requests/B03.md asks for a slot kind whose Pokemon is the foe (`other`).
//
// Dispatch (src/field/pokemon.ts getStatStageMultiplier and getAccuracyMultiplier): `pokemon` = the ability holder,
// `opponent` = the Pokemon whose stat stage is being read, `stat` = which stat. The holder's ability applies to every
// stat read of the other Pokemon, in both directions (holder attacking: the foe's Defense; holder defending: the foe's
// Attack), which is why the calc WHEN is "while the game applies the foe's stat stages".
import { IgnoreOpponentStatStagesAbAttr } from "#abilities/ab-attrs";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";
import { BATTLE_STAT_NAMES, statListCodec } from "./codecs";

export default defineDecl(IgnoreOpponentStatStagesAbAttr, {
  tier: "A",
  kind: "calc-modifier",
  when: "calc.ignore-stat-stages",
  label: "Ignore the foe's stat boosts and drops",
  summary: params =>
    `The foe's boosts and drops to ${params.stats} are treated as zero. Example: a foe at +6 Attack hits me as if it were at +0.`,
  synonyms: [
    "unaware",
    "ignore boosts",
    "ignore stat changes",
    "ignore evasion",
    "ignore defense boosts",
    "ignore accuracy changes",
    "ignore stat drops",
    "no stat stages",
  ],
  examples: [
    "Ignore all of the foe's stat boosts and drops like Unaware",
    "Ignore only the foe's Evasion boosts",
    "Ignore the foe's Defense and Sp. Def changes while the foe is trapped",
  ],
  params: [
    {
      id: "stats",
      ctorIndex: 0,
      path: "stats",
      control: "text",
      label: "Foe stats whose changes I ignore (comma separated names)",
      editable: true,
      default: "ATK,DEF,SPATK,SPDEF,ACC,EVA",
      options: [...BATTLE_STAT_NAMES],
      codec: statListCodec,
    },
  ],
  conditions: [
    // `opponentCondition(opponent)`: yes/no about the foe. Optional: most users pass none.
    { slot: "ctor:1", ctx: "holder", path: "opponentCondition", removable: true, editable: true, optional: true },
  ],
  guards: [],
  feasibility: [
    "It is skipped when the move being used ignores the target's ability (Mold Breaker style), except for accuracy and evasion",
  ],
  // No existing effect block ignores stat changes; see requests/B03.md (`effect.ignore-stat-changes`).
  reusableAlone: { when: true, if: true, do: false },
  flags: { rng: "none", state: "none", simulated: "ignores" },
  probes: [{ name: "the holder attacks a foe", axes: {} }],
  status: "decomposed",
  notes:
    "Tier A, 10 attrs of 10 abilities. Stat-list-only users (no closure, no binding): Unaware (109), Contempt (5312), Sword of Damnation (5392 attr 0), Lepidopteran (5672), In the Clouds (6020), Blase Powder (20012) and Unintentional Genius (20020), each with the six stats Attack, Defense, Sp. Atk, Sp. Def, Accuracy and Evasion; Mind's Eye (299 attr 2) with Evasion only. Grip Pincer (5110 attr 1) and Venoblaze Pincers (5354 attr 3) also pass the closure `(opponent) => opponent.getTag(TrappedTag) !== undefined` (Defense and Sp. Def): 'the foe is held by ANY trapping effect', an `instanceof` test over a family of tag classes (Trapped, Ingrain, Octolock, Bind, Wrap, ...). `tag.has` takes ONE battle effect name, so no atom reads it; both closures are legacy-closure until the librarian adds an 'is trapped' atom (requests/B03.md). The class is therefore pending request for those two abilities and for the missing 'ignore stat changes' effect block. The default stat list is the six-stat Unaware list; the class's own default (no list passed) is all seven battle stats including Speed. Quirks recorded, not fixed: canApply never reads `simulated` and apply only sets a flag, so previews and real calls agree; getAccuracyMultiplier dispatches the ability without the Mold Breaker skip that getStatStageMultiplier has, so accuracy and evasion are ignored even against a Mold Breaker foe while the other stats are not.",
});

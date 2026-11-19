/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B07 chunk 3 / event effect with a random draw in apply, Tier C (one-piece effect). See ../PRECEDENTS.md.
//
// "Just before I enter the battle, take the look of another Pokemon". The engine dispatches PreSummonAbAttr from summon-phase.ts,
// switch-summon-phase.ts and (for wild foes) encounter-phase.ts, with only `{ pokemon }`. Clauses, in the ORIGINAL order:
//   canApply  1. (trainer Pokemon only) `lastPokemon` = the last healthy party member that is not me, or me when there is none.
//             2. `lastPokemon === me`  feasibility: there is nobody to copy, so no illusion.
//             3. the Ogerpon / Terapagos rule: when the one to copy is Ogerpon or Terapagos and either of us is Terastallized, no
//                illusion (the Tera look would give the trick away). A safety rule of the game, not a design choice: feasibility.
//             4. wild Pokemon: always true (a wild holder can always disguise as a random species).
//   apply     trainer Pokemon: copy that last healthy party member; wild Pokemon: `arena.randomSpecies(waveIndex, level)` (RANDOM DRAW);
//             then `pokemon.setIllusion(...)`, which breaks any illusion it already had first.
// `hasTrainer()` decides the branch. The class is not edited, so a rebuilt attr behaves the same by construction.
import { IllusionPreSummonAbAttr } from "#abilities/ab-attrs";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";

export default defineDecl(IllusionPreSummonAbAttr, {
  tier: "C",
  kind: "event-effect",
  when: "event.before-entry",
  label: "Disguise myself as another Pokemon when I enter",
  summary: () =>
    "Just before I enter the battle I take the look of another Pokemon: a trainer's Pokemon copies its last healthy teammate, a wild one a random species. Example: Zoroark.",
  synonyms: [
    "illusion",
    "zoroark",
    "disguise as a teammate",
    "fake look",
    "copy the last party member",
    "pretend to be another pokemon",
  ],
  examples: ["Look like the last healthy Pokemon in my party until I get hit, like Zoroark"],
  params: [],
  noParamsReason:
    "A fixed rule with nothing to choose: who to copy is decided by whether the holder belongs to a trainer. The only constructor argument is showAbility, which is never exposed (fixed to false, no ability banner is shown).",
  conditions: [],
  guards: [],
  feasibility: [
    "A trainer's Pokemon needs another healthy teammate to copy; when it is the last healthy one, nothing happens",
    "Does nothing when the one to copy is Ogerpon or Terapagos and either of us is Terastallized",
    "A wild Pokemon can always disguise as a random species",
  ],
  // No library effect says "take the look of another Pokemon"; request R-B07-9 (effect.start-illusion).
  effect: { id: "effect.package", params: [] },
  fixedCtorArgs: { 0: false },
  reusableAlone: { when: true, if: true, do: true },
  flags: {
    rng: "apply",
    rngOrder: ["apply: wild holder only, arena.randomSpecies(waveIndex, level) draws the random species"],
    state: "none",
    simulated: "ignores",
  },
  probes: [{ name: "entering the battle with a teammate to copy", axes: {} }],
  status: "decomposed",
  notes:
    'Tier C, one-piece effect (it builds a look-alike from a party member or a random species and is torn down by breakIllusion). User (live dump): Illusion (149, attr 0), showAbility false. Illusion\'s other attrs: IllusionBreakAbAttr (attr 1, parked, R-B07-11), PostDefendIllusionBreakAbAttr (2), a MovePowerBoostAbAttr (3), NoFusionAbilityAbAttr (4) and IllusionPostBattleAbAttr (5). ENGINE QUERY ASPECT: Pokemon.canApplyAbility asks `getAttrs("PreSummonAbAttr")` to decide whether Neutralizing Gas can suppress the ability while the holder is off the field, so a rebuilt attr must stay on the Pokemon. The PreSummon frame carries no `simulated` flag and the class never reads it. SUSPECTED GAME QUIRK (not fixed): the party filter uses `isAllowedInBattle()`, so in a double battle the illusion can copy a teammate that is already on the field.',
});

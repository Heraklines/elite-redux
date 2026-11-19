/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B03 chunk 3. Tier C, package for the core effect (trigger and feasibility are separate).
//
//   canApply   reads every ADJACENT foe (null slots skipped): sums `getEffectiveStat(DEF)` and `getEffectiveStat(SPDEF)`
//              (stat stages and modifiers included), then `enemyDef = round(sum / count)`, same for `enemySpDef`;
//              false when there is no foe, or when either average is 0 or less. The averages are written to fields
//              of the attr instance.
//   apply      `stats = enemyDef <= enemySpDef ? [ATK] : [SPATK]` (ER dex: a tie raises Attack; vanilla used strict `<`),
//              then, unless simulated, ONE StatStageChangePhase raising that stat by 1 for the holder. The stat list is
//              also written to a field of the instance, even when simulated.
//
// Why it is a package: the effect is "raise the stat that matches the foes' weaker defence", and the choice reads the
// two averages that `canApply` computed and stored on the instance (`enemyDef`, `enemySpDef`, `enemyCountTally`,
// `stats`). Splitting the compare out as a library IF needs an atom for "the foes' average Defense is not higher than
// their average Sp. Def" (`foe.average-defense-not-higher`, requested in requests/B03.md) and the class would have to
// become two branches (Attack branch, Sp. Atk branch), which is a refactor of `apply`, not a pure move of code. The
// trigger is a separate, swappable WHEN; nothing inside the class is a staff-adjustable IF other than the compare
// itself; "there is a foe with a positive Defense" is feasibility. The numbers (1 stage; a tie raises Attack) are
// fixed inside the class and are not constructor arguments, so there are no params (reason below).
import { DownloadAbAttr } from "#abilities/ab-attrs";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";

export default defineDecl(DownloadAbAttr, {
  tier: "C",
  kind: "package",
  when: "event.on-entry",
  label: "Raise Attack or Sp. Atk to match the foes' weaker defense",
  summary: () =>
    "When I enter the battle, my Attack rises by 1 stage if the foes' Defense is not higher than their Sp. Def, otherwise my Sp. Atk rises by 1 stage.",
  synonyms: [
    "download",
    "adapt to foe",
    "read the foe's defenses",
    "raise attack or special attack",
    "scan the opponent",
    "exploit weaker defense",
  ],
  examples: [
    "Raise Attack or Sp. Atk by one stage depending on the foes' weaker defense, the way the download ability does",
  ],
  params: [],
  noParamsReason:
    "Every number and choice is fixed inside the class and none is a constructor argument: it always raises by exactly 1 stage, only Attack or Sp. Atk, and a tie between the foes' Defense and Sp. Def raises Attack.",
  conditions: [],
  guards: [],
  feasibility: [
    "At least one foe next to me must exist, and the foes' average Defense and average Sp. Def must both be above 0 (they include stat stages), otherwise nothing happens and the ability does not show",
    "The comparison uses the foes' Defense and Sp. Def after boosts and drops, rounded to a whole number per stat",
    "It does nothing in a preview",
  ],
  effect: { id: "effect.package", params: [] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "entry", simulated: "respects" },
  probes: [{ name: "entry with the default field", axes: {} }],
  status: "decomposed",
  notes:
    "Package, 1 user: Download (88 attr 0). Reason it cannot be split further today: the stat choice (the foes' average Defense against their average Sp. Def) is computed in canApply and stored on the shared instance, then read by apply; a library IF 'foes' average Defense is not higher than Sp. Def' and a two-branch form (raise Attack / raise Sp. Atk) do not exist (requests/B03.md: `foe.average-defense-not-higher`, plus an effect that raises a stat by a fixed amount for the holder that both branches can use; `effect.stat-stage` already exists for that). Trigger is separate (on entry), feasibility is written out, and extra IFs can only be ANDed on top. Quirks recorded, not fixed: the average is rounded per stat before the compare (round half up), so two foes at 100/101 Defense compare as 101; `canApply` mutates `enemyDef`, `enemySpDef`, `enemyCountTally` on the shared instance, and `apply` writes `stats` even for a simulated call, so a simulated check followed by a real one reuses the numbers of the last canApply (they are recomputed every canApply, so it is harmless); `getAdjacentOpponents` skips an empty slot, the null guard comes from a daily-run crash fix.",
});

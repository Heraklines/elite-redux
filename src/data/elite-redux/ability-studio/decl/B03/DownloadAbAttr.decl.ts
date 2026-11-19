/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B03 chunk 3. Tier B (gate and residual split), two branches. No longer a package.
//
//   canApply   (residual only) prepare: reads every ADJACENT foe (null slots skipped), sums `getEffectiveStat(DEF)` and
//              `getEffectiveStat(SPDEF)` (stat stages and modifiers included), `enemyDef = round(sum / count)`, same
//              for `enemySpDef`; then residual: false when there is no foe, or when either average is 0 or less.
//   gate       the compare "the foes' average Defense is not higher than their average Sp. Def" (a tie is true).
//              It is NOT inside `canApply`, because both outcomes act; `apply` reads it (through `gateOverride` when
//              staff replaced it) to choose the stat.
//   apply      gate true: [ATK], else [SPATK]; then, unless simulated, ONE StatStageChangePhase raising that stat by 1
//              for the holder. The stat list is written to a field of the instance even when simulated.
//
// Same shape as the HpThresholdFormChangeAbAttr precedent: two branches, one compare. The trigger is a swappable WHEN,
// the compare is the gate (library atom `foe.average-defense-not-higher`, requested in requests/B03.md, so the gate is
// a legacy binding for now), feasibility stays in the class, and the effect of both branches is the existing
// `effect.stat-stage` with the stat and the 1 stage fixed by the branch (not constructor arguments, so no params).
import { DownloadAbAttr } from "#abilities/ab-attrs";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";

export default defineDecl(DownloadAbAttr, {
  tier: "B",
  kind: "event-effect",
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
  conditions: [{ slot: "gate", ctx: "params", removable: false, editable: true }],
  guards: [],
  feasibility: [
    "At least one foe next to me must exist, and the foes' average Defense and average Sp. Def must both be above 0 (they include stat stages), otherwise nothing happens and the ability does not show",
    "The foes' Defense and Sp. Def are read after boosts and drops, rounded to a whole number per stat",
    "It does nothing in a preview",
  ],
  branches: [
    {
      label: "Raise my Attack",
      conditions: ["foe.average-defense-not-higher (requested)"],
      effect: { id: "effect.stat-stage", params: [] },
    },
    {
      label: "Raise my Sp. Atk",
      conditions: ["not foe.average-defense-not-higher (requested)"],
      effect: { id: "effect.stat-stage", params: [] },
    },
  ],
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "entry", simulated: "respects" },
  probes: [{ name: "entry with the default field", axes: {} }],
  status: "decomposed",
  notes:
    "Tier B, 1 user: Download (88 attr 0). Rewritten from a package after review: `canApply` is now prepare (read the adjacent foes, round the two averages) plus residual (a foe exists and both averages above 0), and the compare is the replaceable `gate`, read by `apply` through `gateOverride` to choose Attack or Sp. Atk; the body of apply is otherwise unchanged. The gate is not removable (without it the ability would always raise Attack). The gate binding is a legacy closure until the atom `foe.average-defense-not-higher` exists (requests/B03.md); both branch effects are `effect.stat-stage` with the stat and the 1 stage fixed per branch. Quirks recorded, not fixed: the average is rounded per stat before the compare (round half up), so two foes at 100/101 Defense compare as 101; `prepare` mutates `enemyDef`, `enemySpDef`, `enemyCountTally` on the shared instance, and `apply` writes `stats` even for a simulated call (the numbers are recomputed every canApply, so it is harmless); `getAdjacentOpponents` skips an empty slot, the null guard comes from a daily-run crash fix.",
});

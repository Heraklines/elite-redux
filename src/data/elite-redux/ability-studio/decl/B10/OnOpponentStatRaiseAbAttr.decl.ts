/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B10 / package (Tier C).
//
// Read by hand from archetypes/on-opponent-stat-raise.ts. The class is a pure marker subclass of StatStageChangeCopyAbAttr (the
// Opportunist hook): `private declare readonly _erMarker: never`, no constructor, no canApply, no apply override. The engine
// (phases/stat-stage-change-phase.ts) calls applyAbAttrs("StatStageChangeCopyAbAttr", { pokemon: opponent, stats, numStages })
// on each opponent of a Pokemon that made a copyable positive stat raise; the inherited `apply` then queues, for the HOLDER, a
// StatStageChangePhase with the SAME stats and the SAME number of stages, as a self change that is NOT copyable
// (`canBeCopied` false), unless simulated. So a copy can never chain off another Egoist or Opportunist.
// Nothing is configurable. No random draw.
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";
import { OnOpponentStatRaiseAbAttr } from "#data/elite-redux/archetypes/on-opponent-stat-raise";

export default defineDecl(OnOpponentStatRaiseAbAttr, {
  tier: "C",
  kind: "package",
  when: "event.foe-raised-stat",
  label: "Copy a foe's stat boost onto myself",
  summary: () =>
    "When a foe raises a stat, I raise the same stat by the same number of stages. A boost I copied is never copied again. Example: a foe's +2 Defense gives me +2 Defense.",
  synonyms: ["egoist", "opportunist", "copy stat boosts", "mirror boosts", "steal the boost", "me too"],
  examples: ["When the opposing Pokemon raises its Attack by 2, my Attack goes up by 2 as well"],
  params: [],
  noParamsReason:
    "The mechanic has no tunable numbers: it always copies the exact stats and stages the foe gained, and the copy is always marked as not copyable.",
  conditions: [],
  guards: [],
  feasibility: [
    "Only a boost the game allows to be copied counts (a boost that was itself a copy does not)",
    "Nothing happens in a preview",
  ],
  effect: { id: "effect.package", params: [] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "none", simulated: "respects" },
  probes: [{ name: "a foe raises a stat", axes: {} }],
  status: "decomposed",
  notes:
    "Package, justified: the library has no effect 'raise the same stat by the same stages as the foe just raised' (request R-B10-11 in requests/B10.md); the WHEN `event.foe-raised-stat` already exists and provides the stat and stages slots. Only user: Egoist, nothing to bind. Same hook as vanilla Opportunist (StatStageChangeCopyAbAttr), so the dispatcher's attr-level conditions apply as usual.",
});

/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// Lucky Wings and Super Luck (Tier C, marker). "While this Pokemon has the ability, the experience it receives is multiplied".
//
// Source: ability-upgrades/attrs/meta-markers.ts (constructor: multiplier > 0; `erMetaKind` "experience-gain-multiplier").
// Nothing is dispatched. The reader is `getExperienceGainMultiplier(pokemon)` (archetypes/ability-meta-consumers.ts:107),
// called with the Pokemon that RECEIVES the experience by phases/exp-phase.ts:33 and phases/show-party-exp-bar-phase.ts:26: it
// multiplies `getMultiplier()` of every attr of the receiver's ACTIVE ability sources whose `getCondition()` is null or true.
// Two such attrs on one Pokemon multiply together.
import { ExperienceGainMultiplierAbAttr } from "#data/elite-redux/ability-upgrades/attrs/meta-markers";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";

export default defineDecl(ExperienceGainMultiplierAbAttr, {
  tier: "C",
  kind: "while-active",
  when: "while.active",
  label: "Gain more (or less) experience",
  summary: params =>
    `While I have this, the experience points I receive are multiplied by ${params.multiplier}. Example: 1.2 means 20% more experience.`,
  synonyms: ["lucky wings", "super luck", "more exp", "level up faster", "experience boost", "xp bonus", "lucky egg"],
  examples: ["Receive 20% more experience, like Super Luck"],
  params: [
    {
      id: "multiplier",
      ctorIndex: 0,
      path: "multiplier",
      control: "number",
      min: 0.1,
      max: 5,
      step: 0.05,
      label: "Experience multiplier (1.2 = 20% more)",
      editable: true,
      gateIndependent: true,
      default: 1.2,
    },
  ],
  conditions: [],
  guards: [],
  feasibility: ["It multiplies with any other experience bonus I have, and with other copies of itself"],
  effect: { id: "effect.package", params: ["multiplier"] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "none", simulated: "respects" },
  probes: [{ name: "a plain battle with the marker on the holder", axes: {} }],
  l2StaticReason:
    "The marker is never dispatched; the experience phases read it by name (getExperienceGainMultiplier), which no battle scenario reaches. B18/meta-markers.test.ts calls the live reader on a holder, a plain Pokemon and a holder with a staff-added condition.",
  status: "decomposed",
  notes:
    "PACKAGE (marker), justified: no behaviour in the class (base no-ops, showAbility false); a number the experience phases ask for by name. The library has no effect that scales experience, so the effect is the package and the request is R-B18-6 (effect 'Multiply experience gained'). An attr-level condition ANDed by staff is honoured by the reader (getCondition), so `if` is true. The multiplier is read from the receiving Pokemon's own abilities only: an ally's marker does nothing. Users: Lucky Wings (5551, attr 2) and Super Luck (105, attr 1), both x1.2. A suppressed ability or a fainted holder is not counted (getActiveAbilitySources).",
});

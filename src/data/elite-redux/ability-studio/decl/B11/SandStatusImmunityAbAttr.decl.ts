/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B11 chunk 3 / calc-modifier (Tier C, no params).
//
// Read by hand from archetypes/sand-cloak.ts and the parents in ab-attrs.ts. It extends
// ConditionalUserFieldStatusEffectImmunityAbAttr (WHEN "while the game checks my side's status immunity"). The constructor
// takes NOTHING and hands the parent two things itself: the closure `() => sandActive()` and an EMPTY effect list.
//   sandActive = `arena.weather?.weatherType === SANDSTORM && !arena.weather.isEffectSuppressed()`
//   canApply (the parent's): `!cancelled && condition(target, source) && super.canApply`, where the base class says
//     "no effect list: block every status except FAINT" (`!cancelled && list empty && effect !== FAINT`).
//   apply: the CancelInteraction one, it only sets `cancelled`.
// Every clause is fixed inside the class: the weather, and "all statuses". No random draw. Nothing is read from `simulated`.
//
// Why Tier C and not Tier A: the closure is built in the constructor body, not passed in, so it is not a `ctor:N` slot.
// The sandstorm test is NOT the library atom field.weather (that atom reads `arena.weatherType` and ignores suppression; this
// one also asks `isEffectSuppressed`), so a binding would not be the same predicate (request R-B11-05 in requests/B11.md asks
// for a suppression-aware weather atom; request R-B11-06 for the closure to become a constructor argument).
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";
import { SandStatusImmunityAbAttr } from "#data/elite-redux/archetypes/sand-cloak";

export default defineDecl(SandStatusImmunityAbAttr, {
  tier: "C",
  kind: "calc-modifier",
  when: "cancel.status-immunity-field",
  label: "Block every status condition on my side during a sandstorm",
  summary: () =>
    "While a sandstorm is active, neither I nor my allies can get any status condition (burn, poison, sleep and so on). A suppressed weather does not count. Example: a foe's Will-O-Wisp fails in sand.",
  synonyms: [
    "sand veil",
    "desert cloak",
    "dune veil",
    "status immunity in sand",
    "safe in a sandstorm",
    "team status guard",
  ],
  examples: ["My whole side is immune to status conditions while the sandstorm rages"],
  params: [],
  noParamsReason:
    "The class has no constructor arguments: the weather (a sandstorm) and the list of blocked statuses (all of them) are fixed in the class. Staff reach a variant with the status-immunity block that takes a condition, once the weather test is available as a condition.",
  conditions: [],
  guards: [],
  feasibility: [
    "Only while the weather is a sandstorm and nothing is suppressing the weather",
    "Fainting is never blocked",
    "Works for me and for my allies, not for the foes",
  ],
  effect: { id: "effect.negate", params: [] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "none", simulated: "ignores" },
  probes: [{ name: "a sandstorm, another weather and no weather", axes: { weather: ["SANDSTORM", "RAIN", "NONE"] } }],
  status: "decomposed",
  notes:
    "Tier C, justified in the header. Users: Desert Cloak and Dune Veil, always together with SandSecondaryEffectImmunityAbAttr (dispatcher: `ok([new SandStatusImmunityAbAttr(), new SandSecondaryEffectImmunityAbAttr()])`). Nothing to bind. The class never reads `simulated`, so a preview behaves like the real check. The module-level `sandActive` helper is shared with SandSecondaryEffectImmunityAbAttr.",
});

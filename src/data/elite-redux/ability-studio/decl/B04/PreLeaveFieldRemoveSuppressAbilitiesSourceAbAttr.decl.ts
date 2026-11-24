/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B04 / Tier A event-effect, no closure, no setting (Neutralizing Gas, attr 1 only).
//
// Clause classification (PreLeaveFieldRemoveSuppressAbilitiesSourceAbAttr; the constructor calls super(false), silent):
//   canApply  `!!globalScene.arena.getTag(ArenaTagType.NEUTRALIZING_GAS)` -> GUARD (a safety rule): the gas cloud must
//             exist, because `apply` dereferences it (`suppressTag.onSourceLeave(...)` on undefined would throw). It is
//             exactly the library atom `field.arena-tag{ NEUTRALIZING_GAS, both }` (`getTag(t)` is `getTagOnSide(t, BOTH)`,
//             which matches a tag on any side), but dropping it would crash rather than change the ability's design, so
//             it must be a non-removable guard. The guard registry has no entry (requests/B04.md, guard
//             `ability-gas-cloud-active`), so it is written as a feasibility line and stays in the class, no class edit.
//   apply     `suppressTag.onSourceLeave(arena)`: one gas source less; at zero sources the tag is removed, at one source
//             the remaining holder's own abilities are re-activated -> the EFFECT. Does NOT read `simulated`.
// No RNG, no closure, no binding.
//
// The class is ALSO an identity marker the engine looks up by name (pokemon.ts getSuppressedAbility check, arena-tag.ts
// SuppressAbilitiesTag.onSourceLeave / onRemove: `hasAbilityWithAttr("PreLeaveFieldRemoveSuppressAbilitiesSourceAbAttr")`).
// A rebuilt attr must therefore keep the class name; the identity use is an engine-query (foundation, abilityQuery
// "suppresses-other-abilities") and is not reproduced by a decomposed rule.
import { PreLeaveFieldRemoveSuppressAbilitiesSourceAbAttr } from "#abilities/ab-attrs";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";

export default defineDecl(PreLeaveFieldRemoveSuppressAbilitiesSourceAbAttr, {
  tier: "A",
  kind: "event-effect",
  when: "event.leave-field",
  label: "End the ability-blocking gas when I leave the field",
  summary: () =>
    "When I leave the field, the gas that switches off other Pokemon's abilities loses one source and ends once no source is left. Nothing happens if no gas is active.",
  synonyms: [
    "neutralizing gas ends",
    "abilities work again",
    "end ability suppression",
    "gas cloud ends",
    "stop blocking abilities",
    "ability suppression leaves with me",
  ],
  examples: ["Everyone's abilities work again after I leave the field, like Neutralizing Gas"],
  params: [],
  noParamsReason:
    "The effect has no numbers or choices: it always removes exactly one source from the ability-blocking gas that is active.",
  conditions: [],
  guards: [],
  feasibility: ["An ability-blocking gas must currently be active on the field (otherwise nothing happens)"],
  effect: { id: "effect.package", params: [] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "none", simulated: "ignores" },
  probes: [
    {
      // The class reads no state of the holder; the gas cloud is what matters and is driven by the class test.
      name: "leave the field at full HP (the gas itself is set up by b04-chunk2.test.ts)",
      axes: { hp: ["max"] },
    },
  ],
  status: "decomposed",
  notes:
    "Package reason: the effect is one engine call, SuppressAbilitiesTag.onSourceLeave(arena). It decrements the gas tag's source count and, depending on what is left, removes the tag (which re-activates every suppressed ability, in speed order, through applyOnGainAbAttrs) or re-activates the last holder's own other abilities. That is a counter plus a scripted re-activation of every ability on the field, not something the effect blocks (stat, status, heal, tag) can express, and its settings do not exist (no number or choice). The trigger (when I leave the field) and the one check (gas active) are separate and swappable. User: Neutralizing Gas (attr 1; attr 0 is PostSummonAddArenaTagAbAttr, not this chunk). Dispatch: pokemon.leaveField (PreLeaveFieldAbAttr), attempt-run-phase (enemy field when the player flees) and applyOnLoseAbAttrs (ability lost or suppressed). apply ignores `simulated` (it would decrement the count in a simulated call); no engine path calls it simulated today. The count is decremented on the SHARED arena tag, so a rebuilt attr and the original share state: never run both against one arena in a battle (the L2 twin runs them in separate battles).",
});

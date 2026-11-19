/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B05 / event effect, Tier C (nothing to configure). See ../PRECEDENTS.md.
//
// A switch-in effect (`PostSummonAbAttr`, WHEN "when I enter the battle"). The class has no constructor argument, no
// `canApply` of its own (the inherited one answers true) and no random draw. `apply`, in order:
//   1. `simulated` -> nothing happens
//   2. for every opponent (`getOpponentsGenerator`): list the names of its held items, call `revealHeldItems(ids, true)` so the
//      game shows them as known, and, when it holds at least one item, queue the message "<me> frisked <foe> and found: <items>!"
// This is the Elite Redux Frisk (items, not the vanilla ability reveal). The message text is English only.
import { FriskAbAttr } from "#abilities/ab-attrs";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";

export default defineDecl(FriskAbAttr, {
  tier: "C",
  kind: "event-effect",
  when: "event.on-entry",
  label: "Reveal the foes' held items",
  summary: () =>
    "When I enter, I look at what every foe is holding and list the items in the battle log. Example: Garchomp is holding Leftovers.",
  synonyms: [
    "frisk",
    "gleam eyes",
    "reveal items",
    "check held items",
    "scout items",
    "search foe items",
    "show foe items",
  ],
  examples: ["Show every foe's held items when I enter, like Gleam Eyes"],
  params: [],
  noParamsReason:
    "A fixed rule: it always looks at every foe and has no number, type or choice. The only constructor value is whether the ability pop-up shows, which is never exposed.",
  conditions: [],
  guards: [],
  feasibility: [
    "A foe that holds nothing is skipped and gets no message",
    "Nothing is revealed during a simulated check",
  ],
  // No library effect reveals items yet (R-B05-18), so the effect is a package with no setting.
  effect: { id: "effect.package", params: [] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "none", simulated: "respects" },
  probes: [{ name: "entering against a foe that holds an item and one that holds nothing", axes: {} }],
  status: "decomposed",
  notes:
    "Tier C event effect. Effect is `package` ONLY because the library has no 'reveal the foes' held items' effect (R-B05-18); the moment is its own block and any IF can be ANDed on top. Users: Frisk (119 attr 0) and Gleam Eyes (5410 attr 0), both with no arguments, nothing to bind. The effect is a loop over every opponent (two in a double battle) that calls Pokemon.revealHeldItems; it has no state of its own. Observation, not fixed: the comment in the class says the dex also disables the foe's first item for two turns, which is not implemented. The class never reads anything but `simulated`.",
});

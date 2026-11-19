/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B06 chunk 3, engine-query marker. See ../PRECEDENTS.md.
//
// "While I am on the field, my foes cannot use their held items" (Unnerve, As One, Crowned King, Klutz, Voracity). The class has no body
// at all: it is the cancel base class used as a MARKER. Nothing ever dispatches it through applyAbAttrs; the ER item code asks
// `opponent.hasAbilityWithAttr("PreventItemUseAbAttr")` before a single-use item fires: elemental gems (er-elemental-gems.ts), the reactive
// items such as Red Card (er-reactive-items.ts) and the tactical items Eject Pack and Eject Button (er-tactical-items.ts, two checks).
// The berry meal itself is stopped by the sibling class PreventBerryUseAbAttr, which every user also carries. No constructor argument,
// no closure, nothing to bind.
import { PreventItemUseAbAttr } from "#abilities/ab-attrs";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";

export default defineDecl(PreventItemUseAbAttr, {
  tier: "C",
  kind: "engine-query",
  when: "cancel.interaction",
  label: "Stop my foes from using their held items",
  summary: () =>
    "While I am on the field, opposing Pokemon cannot use their single-use held items, such as gems, Red Card, Eject Button and Eject Pack. Example: a foe's Fire Gem does not boost its Fire move.",
  synonyms: ["as one", "unnerve", "klutz", "crowned king", "item lock", "no items for foes", "block held items"],
  examples: ["Foes cannot use their gems or Eject Button while I am out, like As One"],
  params: [],
  noParamsReason:
    "All or nothing: the class has no constructor argument and is only a marker the item code looks for on the opposing side.",
  conditions: [],
  guards: [],
  feasibility: [
    "Only the opposing side is stopped, never my own items",
    "Berries are stopped by the separate berry block that the same abilities carry",
  ],
  reusableAlone: { when: true, if: false, do: true },
  flags: { rng: "none", state: "none", simulated: "ignores" },
  l2StaticReason:
    "The marker is never dispatched through applyAbAttrs; the item code reads it by presence (hasAbilityWithAttr), so no trace event can show it evaluated. test/tests/elite-redux/decomp/B06/b06-chunk3.test.ts reads it from the real abilities and their rebuilds through the same hasAbilityWithAttr call the gems and reactive items make.",
  probes: [{ name: "a foe with a single-use item", axes: { hp: ["max", "50%-1"] } }],
  status: "decomposed",
  notes:
    "ENGINE-QUERY: the class is read by presence, like FloatAbAttr. It declares the WHEN cancel.interaction (its ancestor CancelInteractionAbAttr) only because while.active does not list it yet (request R-B06-16). Users (10 attrs): Klutz (103, attr 1), Unnerve (127, attr 1), As One (5004 and 5005, attrs 1 and 3 each; 20022, attr 2), Crowned King (5259, attrs 1 and 4) and Voracity (6101, attr 1). As One (5004, 5005) and Crowned King (5259) carry it twice, which changes nothing: the check only asks whether one exists. The sibling PreventBerryUseAbAttr is separate. Nothing is dispatched, so simulated is irrelevant; the gem check even runs in simulated damage calculations, on purpose, so the AI does not see a boost that will not fire.",
});

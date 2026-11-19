/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B04 / Tier A event-effect, no closure, no setting (Natural Cure, Natural Recovery, Self Repair).
//
// Clause classification (PreSwitchOutResetStatusAbAttr; its constructor calls super(false), so the ability is silent):
//   canApply  `pokemon.status != null || hasErAilment(pokemon)`  -> FEASIBILITY (there is something to cure). The ER
//             half is the three Elite Redux ailment tags (Bleed, Frostbite, Fear) that live on a tag, not on
//             `pokemon.status`. Both halves are "does the cure have anything to do", so they stay together in the
//             class instead of becoming a swappable condition.
//   apply     `if (!simulated) { pokemon.resetStatus(); clearErAilments(pokemon); pokemon.updateInfo(); }` -> the EFFECT.
//             The library "Cure ... status" is the closest DO; it is listed as the effect, with the difference
//             (the class also clears the three ER ailment tags and refreshes the info box) written in the notes and in
//             requests/B04.md so the librarian can make the library effect do the same.
// No RNG, no closure, no binding. The dispatch (switch-summon-phase.ts) runs AFTER leaveField(), the engine's own order.
import { PreSwitchOutResetStatusAbAttr } from "#abilities/ab-attrs";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";

export default defineDecl(PreSwitchOutResetStatusAbAttr, {
  tier: "A",
  kind: "event-effect",
  when: "event.switch-out",
  label: "Cure my status when I switch out",
  summary: () =>
    "When I switch out, I recover from any status condition (burn, poison, sleep, paralysis, freeze, Bleed, Frostbite, Fear). Nothing happens if I have none.",
  synonyms: [
    "natural cure",
    "heal status on switch",
    "cleanse when retreating",
    "status reset",
    "self repair",
    "natural recovery",
  ],
  examples: ["Cure my burn or poison when I switch out, like Natural Cure"],
  params: [],
  noParamsReason:
    "The effect has no numbers or choices: it always removes every status condition, including the Elite Redux ones.",
  conditions: [],
  guards: [],
  feasibility: ["I must have a status condition (a normal one, or Bleed, Frostbite or Fear) to cure"],
  effect: { id: "effect.cure-status", params: [] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "none", simulated: "respects" },
  probes: [
    {
      name: "switch out with and without a status",
      axes: { status: ["NONE", "BURN", "PARALYSIS", "SLEEP", "POISON"] },
    },
  ],
  status: "decomposed",
  notes:
    "Users: Natural Cure (attr 0), Self Repair (attr 1), Natural Recovery (attr 0, together with PreSwitchOutHealAbAttr at attr 1). The library effect effect.cure-status (V1 cure-status, status ANY) is only the nearest description: the class additionally clears the ER ailment tags and calls updateInfo, and canApply also fires for a tag-only ailment. The L1/L2 grid cannot set an ER ailment tag, so b04-attrs.test.ts drives a Frostbite-only holder through original and rebuild. apply honours `simulated`.",
});

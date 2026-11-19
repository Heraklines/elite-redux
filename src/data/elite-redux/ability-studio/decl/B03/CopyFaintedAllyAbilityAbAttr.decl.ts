/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B03. Tier B, no random draws.
//
//   canApply (now gate && residual, the original two clauses in the original order):
//     gate      the fainted Pokemon is on my side (`pokemon.isPlayer() === victim.isPlayer()`)
//     residual  its ability can be copied (`victim.getAbility().copiable`)
//   apply       I take the fainted Pokemon's ability as a temporary ability and a message is queued (skipped when simulated)
//
// WHEN: PostKnockOutAbAttr is dispatched for every Pokemon on the field once any Pokemon has fainted. The "same side"
// test is what turns "any faint" into "an ally faints". It includes the holder itself (`isPlayer()` equals its own),
// which the library form `any[self, ally]` reproduces on purpose.
import { CopyFaintedAllyAbilityAbAttr } from "#abilities/ab-attrs";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";

export default defineDecl(CopyFaintedAllyAbilityAbAttr, {
  tier: "B",
  kind: "event-effect",
  when: "event.on-ko",
  label: "Copy the ability of a fainted ally",
  summary: () =>
    "When a Pokemon on my side faints, I take its ability for the rest of the battle (if that ability can be copied). Example: a fainted partner passes on its ability.",
  synonyms: [
    "receiver",
    "power of alchemy",
    "inherit ability",
    "take a fainted ally's ability",
    "ability copy on faint",
  ],
  examples: ["When my partner faints, I copy its ability"],
  params: [],
  noParamsReason:
    "The class has no settings: it always copies the whole ability of the fainted Pokemon. Who counts (my side today) is the condition in the IF list.",
  conditions: [{ slot: "gate", ctx: "params", removable: true, editable: true }],
  guards: [],
  feasibility: ["The fainted Pokemon's ability must be one that can be copied", "It does nothing in a preview"],
  effect: { id: "effect.package", params: [] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "none", simulated: "respects" },
  probes: [{ name: "knock out a foe", axes: {} }],
  status: "decomposed",
  notes:
    "Tier B, one user: Receiver (222). Power of Alchemy has the attr removed again by the ER rebalance (init-elite-redux-vanilla-rebalance.ts). The effect is a one-off 'copy this ability' (effect.package until effect.copy-ability exists). The fainted-ability-copiable clause has no library atom (requests/B03.md: mon.ability-copiable) and stays in residual. The single-battle L2 scenario knocks out the FOE, so its same-side test is always false; the same-side faint is proven by test/tests/elite-redux/decomp/B03/gate-refactor.test.ts. Quirk recorded, not fixed: the same-side test includes the holder itself, so if the engine ever dispatched PostKnockOut to a fainted holder it would copy its own ability.",
});

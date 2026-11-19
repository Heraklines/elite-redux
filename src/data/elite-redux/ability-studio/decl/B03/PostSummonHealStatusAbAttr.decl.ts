/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B03 chunk 3. Tier B, event-effect on entry, no random draws.
//
//   canApply (gate && residual, in that order)
//     gate      my status is one of the listed ones, or ANY status when the list is empty
//     residual  I have a status at all (`pokemon.status?.effect != null`)
//   apply       cures whatever status I have (`resetStatus(false)` + `updateInfo()`), remembers it for the message;
//               it does NOT look at `simulated`
//   message     `getTriggerMessage` reads the remembered status ("<name> was cured of its <status>")
//
// The two clauses of the original `status != null && (list empty || list includes status)` are pure, so the list test
// runs first and "I have a status" second with the same answer. The list is read only by the gate: `apply` cures
// whatever status is there. The library has no "has any of these statuses" atom, so every gate is an `any` of single
// `status.has` atoms and the list param is not editable on a live ability (the gate repeats it); `status.has-any` is
// requested in requests/B03.md. A second dispatch exists in `move-end-phase.ts` (see the notes).
import { PostSummonHealStatusAbAttr } from "#abilities/ab-attrs";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";
import { enumListCodec } from "#data/elite-redux/ability-studio/param-codecs";
import { StatusEffect } from "#enums/status-effect";

// Player words for the status problems (spec 8.3: never enum constants). Typing is case-insensitive.
const STATUS_PLAYER_NAMES: Record<string, string> = {
  POISON: "Poison",
  TOXIC: "Bad poison",
  PARALYSIS: "Paralysis",
  SLEEP: "Sleep",
  FREEZE: "Freeze",
  BURN: "Burn",
};
const STATUS_NAMES = Object.values(STATUS_PLAYER_NAMES);

export default defineDecl(PostSummonHealStatusAbAttr, {
  tier: "B",
  kind: "event-effect",
  when: "event.on-entry",
  label: "Cure my status problem when I enter",
  summary: params =>
    `When I enter the battle (or gain this ability) while I have one of these status problems (${params.statuses}), it is cured. Example: Limber cures paralysis.`,
  synonyms: [
    "limber",
    "insomnia",
    "immunity",
    "water veil",
    "cure burn",
    "cure paralysis",
    "cure poison",
    "cure sleep",
    "cleanse status",
  ],
  examples: [
    "Cure my paralysis when I enter or gain this ability",
    "Cure poison and bad poison when I enter the battle",
  ],
  params: [
    {
      id: "statuses",
      ctorIndex: 0,
      path: "immuneEffects",
      control: "text",
      label:
        "Status problems that cure me (Poison, Bad poison, Paralysis, Sleep, Freeze, Burn; empty = any)",
      editable: false,
      default: "Paralysis",
      options: STATUS_NAMES,
      codec: enumListCodec(
        StatusEffect as unknown as Readonly<Record<string, number>>,
        "status problem",
        STATUS_PLAYER_NAMES,
      ),
      spread: true,
    },
  ],
  conditions: [{ slot: "gate", ctx: "params", removable: true, editable: true }],
  guards: [],
  feasibility: [
    "I must have a status problem, otherwise nothing happens and the ability does not show",
    "It also works right after a move hits me, not only on entry (the game checks it again at the end of every move)",
  ],
  effect: { id: "effect.cure-status", params: [] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "battle", simulated: "ignores" },
  probes: [
    { name: "entry with no status", axes: {} },
    { name: "entry with each status", axes: { status: ["PARALYSIS", "SLEEP", "POISON", "TOXIC", "FREEZE", "BURN"] } },
  ],
  status: "decomposed",
  notes:
    "Tier B, 15 attrs of 14 ability ids, no closure: Limber (7 attr 1), Steadfast (80 attr 2) and Superheavy (5549 attr 2): paralysis; Insomnia (15), Vital Spirit (72) and Brainpower (5940 attr 4): sleep; Immunity (17): poison and bad poison; Magma Armor (40): freeze; Water Veil (41, 5947), Water Bubble (199 attr 3), Thermal Exchange (270 attr 2), Purifying Waters (5231 attr 2), Flame Bubble (5368 attr 3) and Thermal Entropy (5711 attr 2): burn. `canApply` was `status != null && (list empty || list includes status)`, now gate then residual (pure clauses, same answer). Gate bindings are `any` over `status.has`. The `statuses` param is editable:false because the gate repeats it; request `status.has-any` plus `gateParams` would make it editable. Quirks recorded, not fixed: `apply` ignores `simulated` (its own TODO says so); `statusHealed` is one field on the shared attr instance, so the trigger message names the status healed by the LAST holder to trigger it (fine while dispatch is sequential); the second dispatch (after any move that targets me, move-end-phase.ts) is not expressible as a WHEN yet (requests/B03.md) and the engine passes only `pokemon` there.",
});

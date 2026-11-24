/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B03. Tier B, no random draws.
//
//   canApply (now guards && gate && residual):
//     guards    the target is not the attacker itself
//     gate      the move deals damage  &&  the move makes contact
//     residual  the target's ability can be replaced (`suppressable`)  &&  it is not already this giver
//   apply       replaces the target's ability with a temporary one (skipped when simulated)
//   message     "<holder> ..." through the post-defend ability-give text, with the ability name of the trigger
//
// The ability to hand over is the constructor argument `ability` (an AbilityId number). The editor has no ability
// picker yet, so it is a plain number; see requests/B03.md.
import { PostAttackAbilityGiveAbAttr } from "#abilities/ab-attrs";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";

export default defineDecl(PostAttackAbilityGiveAbAttr, {
  tier: "B",
  kind: "event-effect",
  when: "event.after-my-hit",
  label: "Give the target a chosen ability when I hit it with contact",
  summary: params =>
    `After my damaging move makes contact, the target's ability is replaced by ability number ${params.ability} (if its ability can be replaced).`,
  synonyms: [
    "mummy",
    "lingering aroma",
    "blood stain",
    "spread my ability",
    "change the target's ability",
    "ability infection",
  ],
  examples: ["Replace the ability of any Pokemon my contact move hits with my own ability"],
  params: [
    {
      id: "ability",
      ctorIndex: 0,
      path: "ability",
      control: "number",
      min: 1,
      max: 29999,
      step: 1,
      integer: true,
      label: "Ability to give (ability number from the ability list)",
      editable: true,
      gateIndependent: true,
      default: 5377,
    },
  ],
  conditions: [{ slot: "gate", ctx: "params", removable: true, editable: true }],
  guards: [],
  feasibility: [
    "The target must not be the user itself",
    "The target's ability must be one that can be replaced",
    "The target must not already have this ability-giving effect",
  ],
  effect: { id: "effect.package", params: [] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "none", simulated: "respects" },
  probes: [{ name: "contact attacks (Tackle, then Double Slap)", axes: {} }],
  status: "decomposed",
  notes:
    "Tier B. One user: Blood Stain (attr 5 of ability 5377), which gives ITSELF (ability 5377). The gate is [move.damaging, move.flag MAKES_CONTACT]. The clauses `suppressable` and `not already a giver` have no library atom (requests/B03.md: mon.ability-replaceable) and stay in residual as feasibility; the not-self rule is a guard request. The effect is a one-off 'give this ability' (effect.package until effect.give-ability exists). Quirk recorded: the trigger message is the post-DEFEND ability-give text, shared with the defensive half of Blood Stain.",
});

/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B01 chunk 4, Tier B event-effect. "After a hit that really hurt me, cure the status of my whole team."
//   canApply (now `gatedCanApply`): `gate` then `residual`, in the original clause order
//     gate      `!(hitResult >= HitResult.NO_EFFECT)`   = the hit dealt damage (the old early return `hitResult >= NO_EFFECT`
//                                                          -> false, kept as a negated >= so an undefined hitResult behaves as before)
//     residual  `party.some(p => p.status != null)`      = feasibility (at least one team member has a status to cure; it
//                                                          avoids a trigger message that would do nothing). The team is the
//                                                          player party for a player Pokemon, the enemy party otherwise,
//                                                          bench included.
//   apply     (skipped when `simulated`) for every team member with a status, in party order: queue the "was cured" message
//             (getStatusEffectHealText), `resetStatus(false)`, `updateInfo()`.
// The class has no constructor argument, so there are no settings and nothing to bind except the gate. The gate is the same
// clause as PostDefendTerrainChangeAbAttr's (library atom `hit.dealt-damage`, request R-B01-23).
import { PostDefendPartyStatusHealAbAttr } from "#abilities/ab-attrs";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";

export default defineDecl(PostDefendPartyStatusHealAbAttr, {
  tier: "B",
  kind: "event-effect",
  when: "event.after-hit",
  label: "Cure my whole team after a damaging hit on me",
  summary: () =>
    "After a move deals damage to me, every Pokemon on my team with a status condition, bench included, is cured. Example: burned and poisoned teammates both recover, like Seed Sower.",
  synonyms: [
    "seed sower",
    "heal party status",
    "cure the team",
    "cleanse everyone",
    "cure bench status",
    "aromatherapy when hit",
    "team status cure",
    "heal bell when hit",
  ],
  examples: ["Cure the status of my whole team when a move damages me, like Seed Sower"],
  params: [],
  noParamsReason:
    "Nothing to set: the class has no constructor argument. It always cures every status of the holder's own side, bench included; there is no number or choice in the code.",
  conditions: [
    // The gate is the single clause "the hit dealt damage" (no library atom yet, R-B01-23).
    { slot: "gate", ctx: "params", removable: true, editable: true },
  ],
  guards: [],
  feasibility: [
    "At least one Pokemon on my team must have a status condition, otherwise nothing happens and nothing is shown",
    "Nothing happens when the game only previews the move",
  ],
  effect: { id: "effect.cure-status", params: [] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "none", simulated: "respects" },
  probes: [
    {
      name: "a damaging hit and a status move",
      axes: { foeMove: ["TACKLE", "WATER_GUN", "GROWL"] },
    },
  ],
  status: "decomposed",
  notes:
    "Users (1 attr): Seed Sower (269 attr 1, added by the ER rebalance patcher after the Grassy Terrain attr; the ability has bypassFaint so both still act when the hit KOs the holder). Behaviour kept exactly: the gate is the old early return, the residual is the old `some(status)` line. The effect is the library cure-status, but that entry only knows one target (holder, ally, attacker); curing the whole side, bench included, with one message per Pokemon needs a new target (request R-B01-28). The gate is a legacy-closure pending R-B01-23. Oddity (not fixed): the class cures the holder too even if it fainted from the hit, which the bypassFaint flag intends.",
});

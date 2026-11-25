/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B11 chunk 4 / event-effect (Tier B: the move test is the gate inside canApply).
//
// Read by hand from archetypes/set-target-ability-on-move.ts. PostAttack hook (WHEN "after my attack lands"), constructor
// `(moveId, abilityId)` kept in the private fields `moveId` and `abilityId`; `super()` with the default banner. The parent's
// `attackCondition` field exists but this class does NOT call `super.canApply`, so a status move can trigger it.
//   canApply is now `guards && gate && residual`, in the ORIGINAL clause order:
//     1. guards:   `!simulated`                                                    (nothing happens in a preview)
//     2. gate:     `move.id === moveId`                                            (CONDITION: move.is-move)
//     3. residual: `hitResult < HitResult.NO_EFFECT`      (the hit really connected)       (feasibility; request R-B11-C4-02)
//                  `!!target`                              (there is a target)              (feasibility)
//                  `!target.isFainted()`                   (the target is still alive)      (feasibility; request R-B11-13 fainted atom)
//                  `target.getAbility().id !== abilityId`  (it does not have the ability yet) (feasibility: avoids a pointless swap)
//   apply: `target.setTempAbility(allAbilities[abilityId])` (Entrainment style, lasts as the engine decides for a temporary
//   ability). No random draw.
//
// There is no library effect "change the target's ability" (request R-B11-C4-04), so the effect is one piece with a typed setting
// (the ability). The trigger and the move test are separate blocks. The move to watch is read-only here: it belongs to the condition
// block "the move is X", which staff replace when they want another move, so the setting is locked and shown for information.
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";
import { SetTargetAbilityOnMoveAbAttr } from "#data/elite-redux/archetypes/set-target-ability-on-move";
import { moveNameCodec } from "./b11-chunk1-codecs";
import { abilityNameCodec } from "./b11-chunk4-codecs";

export default defineDecl(SetTargetAbilityOnMoveAbAttr, {
  tier: "B",
  kind: "event-effect",
  when: "event.after-my-hit",
  label: "Change the target's ability after I use a chosen move",
  summary: params =>
    `After I use ${params.move} and it connects, the target's ability becomes ${params.ability} (like Entrainment). Example: Roar of Time gives the target Slow Start.`,
  synonyms: [
    "entrainment",
    "swap ability",
    "give ability",
    "replace target ability",
    "temporal rupture",
    "ability change",
  ],
  examples: [
    "After Roar of Time hits, the target gets Slow Start",
    "Give the target a different ability after a chosen move",
  ],
  params: [
    {
      id: "move",
      ctorIndex: 0,
      path: "moveId",
      control: "text",
      label: "Move that triggers it (shown for information: change it in the condition block)",
      editable: false,
      default: "Roar of time",
      codec: moveNameCodec,
    },
    {
      id: "ability",
      ctorIndex: 1,
      path: "abilityId",
      control: "text",
      label: "Ability to give the target (type its name, for example Slow Start)",
      editable: true,
      gateIndependent: true,
      default: "Slow Start",
      codec: abilityNameCodec,
    },
  ],
  conditions: [{ slot: "gate", ctx: "params", lib: "move.is-move", removable: true, editable: true }],
  guards: [],
  feasibility: [
    "Never in a preview",
    "The hit must really connect: a move that is blocked or has no effect changes nothing",
    "Needs a living target that does not already have that ability",
  ],
  effect: { id: "effect.package", params: ["ability"] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "none", simulated: "respects" },
  probes: [
    {
      name: "after my attack lands at full and half HP",
      axes: { hp: ["max", "50%"] },
    },
  ],
  status: "decomposed",
  notes:
    "Tier B, justified in the header; a package only for the effect (request R-B11-C4-04), the trigger and the move test are separate blocks. Only user: Temporal Rupture (5531: Roar of Time, Slow Start). The gate binding is move.is-move ROAR_OF_TIME (`move.id === MoveId[moveId]`, the same test); the move setting is read-only because the atom text is an enum name and a player-word setting cannot be written into it (a locked setting, not a missing feature). The residual stays in the class because three of its clauses have no atom yet (hit connected R-B11-C4-02, fainted R-B11-13, and 'has this ability' which reads `getAbility()`, the CURRENT ability, where mon.has-ability asks hasAbility and R-B11-14 says it cannot name ER abilities). The ability codec finds vanilla and Elite Redux abilities by display name and prefers the lowest id on a duplicate name. Remarks, NOT fixed: (1) the class never calls the parent's damaging-move test, so a status move named in the configuration would trigger too; (2) the attached move-data tweaks of Temporal Rupture (100 power, no recharge) live in the move layer, outside this class.",
});

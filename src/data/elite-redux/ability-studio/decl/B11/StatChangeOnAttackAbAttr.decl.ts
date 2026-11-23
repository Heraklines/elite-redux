/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B11 chunk 5 / event-effect (Tier B: the move tests and the chance roll are the gate inside canApply).
//
// Read by hand from archetypes/stat-change-on-attack.ts. PostAttack hook (WHEN "after my attack lands"), constructor
// `(opts = { stats, stages, selfTarget?, flag?, type?, chance? })`; `super()` (default attack condition: the move is not a status
// move; banner shown). The constructor THROWS for an empty stat list and for a chance outside 0 to 100.
//   canApply is now `guards && gate`, in the original order except that the two pure clauses (damaging move, target) swapped:
//     guards: `selfTarget || (target exists && target is not the holder)`     (feasibility: there is somebody to change)
//     gate:   1. `super.canApply(params)`: the move is a damaging move                        (CONDITION: move.damaging)
//             2. `flag` set and `!move.doesFlagEffectApply({ flag, user: holder, target })` -> false   (CONDITION: move.flag)
//             3. `type` set and `move.type !== type` -> false     (the move's OWN type, not the ability-changed one) (CONDITION: move.type,
//                effective false)
//             4. `chance !== 100 && randBattleSeedInt(100) >= chance` -> false   (the ONLY random draw, last: CONDITION rng.chance)
//   apply: nothing in a preview (`simulated`); otherwise queues a StatStageChangePhase on the recipient (the holder when selfTarget,
//     else the opponent) for the listed stats and the stage change. The library effect "change a stat by stages".
// RNG: one draw in `canApply`, only when all the move tests passed and the chance is not 100, and drawn even for a simulated call
// (the library atom rng.chance skips the draw when simulated; see the notes).
//
// The flag, the move type and the chance are conditions that staff can change as blocks (the gate), so their settings here are locked
// or tied to the gate: `chance` is moved into the gate atom by gateParams; `flag` and `type` stay locked settings so that a rebuilt
// attr keeps the same fields, the real choice being the condition block.
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";
import { MOVE_FLAG_OPTIONS } from "#data/elite-redux/ability-studio/vocabulary/enums";
import { StatChangeOnAttackAbAttr } from "#data/elite-redux/archetypes/stat-change-on-attack";
import { MoveFlags } from "#enums/move-flags";
import { optionalEnumCodec, STAT_SET_OPTIONS, statSetCodec } from "./b11-chunk3-codecs";
import {
  ANY_MOVE_TYPE,
  MOVE_TYPE_WORDS,
  optionalMoveTypeCodec,
  STAT_CHANGE_RECIPIENT_WORDS,
  statChangeRecipientCodec,
} from "./b11-chunk5-codecs";

export default defineDecl(StatChangeOnAttackAbAttr, {
  tier: "B",
  kind: "event-effect",
  when: "event.after-my-hit",
  label: "Change a stat after my attack hits",
  summary: params =>
    `After my damaging move hits, ${
      params.recipient === STAT_CHANGE_RECIPIENT_WORDS[1] ? "my" : "the target's"
    } ${params.stats} change by ${params.stages} stages (${params.chance}% chance). Example: Sinister Claws lowers Sp. Def by 1.`,
  synonyms: [
    "lower stat on hit",
    "raise stat after attacking",
    "secondary stat drop",
    "sinister claws",
    "archmage",
    "familiar",
    "keen edge lowers defense",
    "stat change on attack",
  ],
  examples: [
    "Slicing moves lower the foe's Sp. Def by one stage",
    "30% chance to raise my Sp. Atk by one stage after a Fighting move hits",
  ],
  params: [
    {
      id: "stats",
      ctorIndex: 0,
      ctorOption: "stats",
      path: "stats",
      control: "select",
      label: "Which stats change",
      editable: true,
      gateIndependent: true,
      default: "Sp. Def",
      options: STAT_SET_OPTIONS,
      codec: statSetCodec,
    },
    {
      id: "stages",
      ctorIndex: 0,
      ctorOption: "stages",
      path: "stages",
      control: "number",
      min: -6,
      max: 6,
      step: 1,
      integer: true,
      label: "Number of stages (-1 = one stage lower, 1 = one stage higher)",
      editable: true,
      gateIndependent: true,
      default: -1,
    },
    {
      id: "recipient",
      ctorIndex: 0,
      ctorOption: "selfTarget",
      path: "selfTarget",
      control: "select",
      label: "Whose stat changes",
      editable: true,
      gateIndependent: true,
      default: STAT_CHANGE_RECIPIENT_WORDS[0],
      options: [...STAT_CHANGE_RECIPIENT_WORDS],
      codec: statChangeRecipientCodec,
    },
    {
      id: "chance",
      ctorIndex: 0,
      ctorOption: "chance",
      path: "chance",
      control: "slider",
      min: 0,
      max: 100,
      step: 1,
      integer: true,
      label: "Chance (%)",
      editable: true,
      default: 100,
    },
    {
      id: "flag",
      ctorIndex: 0,
      ctorOption: "flag",
      path: "flag",
      control: "select",
      label: "Move property this was built for (Any move = all moves); change it in the gate condition",
      editable: false,
      default: "ANY",
      options: ["ANY", ...MOVE_FLAG_OPTIONS],
      codec: optionalEnumCodec(MoveFlags, "ANY"),
    },
    {
      id: "type",
      ctorIndex: 0,
      ctorOption: "type",
      path: "moveType",
      control: "select",
      label: "Move type this was built for (Any type = all moves); change it in the gate condition",
      editable: false,
      default: ANY_MOVE_TYPE,
      options: [...MOVE_TYPE_WORDS],
      codec: optionalMoveTypeCodec,
    },
  ],
  gateParams: [{ param: "chance", block: "rng.chance", field: "pct" }],
  conditions: [
    // The gate is the group [move.damaging, (move.flag), (move.type, not ability-changed), rng.chance], in that order. Sinister Claws
    // (SLICING_MOVE, always) and Archmage and Familiar (one move type each, 30%).
    { slot: "gate", ctx: "params", removable: true, editable: true },
  ],
  guards: [],
  feasibility: [
    "There must be a Pokemon to change: a change aimed at the target needs a target that is not me",
    "Nothing happens in a preview",
    "The stat change can still be blocked or stopped at its limit by the usual rules (a stat already at its limit, Clear Body and so on)",
  ],
  effect: { id: "effect.stat-stage", params: ["stats", "stages", "recipient"] },
  reusableAlone: { when: true, if: true, do: true },
  flags: {
    rng: "canApply",
    rngOrder: [
      "canApply gate: the chance roll, drawn last, only after the damaging-move, flag and type tests passed and only when the chance is not 100",
    ],
    state: "none",
    simulated: "respects",
  },
  probes: [
    {
      name: "after my attack lands at full and half HP, against a Normal and a Water move",
      axes: { hp: ["max", "50%"], foeMove: ["TACKLE", "WATER_GUN"] },
    },
  ],
  status: "decomposed",
  notes:
    "Tier B, justified in the header. Users: Sinister Claws (5712 attr 2: Sp. Def -1 on the target, SLICING_MOVE, chance 100); Archmage (5186 attrs 8 to 11) and Familiar (5941 attrs 9 to 12), each four copies with chance 30 and a move type: Fighting raises my Sp. Atk, Flying raises my Speed, Steel raises my Defense, Dragon lowers the target's Attack. Every gate is bound to library atoms (move.damaging, move.flag or move.type with the raw move type, rng.chance); the type and the flag settings are locked because the condition blocks carry them, `chance` follows the slider through gateParams (Sinister Claws binds rng.chance with 100, which draws nothing, exactly like the class). The simulated difference: the class rolls the chance even for a simulated call, the atom rng.chance answers true without a draw when simulated. No engine path calls PostAttack attrs simulated today, so the two agree on every tested path (recorded, not fixed). The target check moved in front of the damaging-move check: both are pure reads, so the result and the random draw order are the same. Remarks, NOT fixed: (1) the type test uses the move's own type (`move.type`), not the type after abilities such as Aerilate, so a Normal move turned Fighting does not count for Archmage; (2) the stat list offers the five combat stats, the class also accepts Accuracy and Evasion (no user).",
});

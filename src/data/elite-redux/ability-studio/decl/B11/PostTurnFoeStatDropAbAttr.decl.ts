/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B11 chunk 1 / event-effect (Tier C: one effect that works through the foes one by one; the trigger is separate).
//
// Read by hand from archetypes/post-turn-foe-stat-drop.ts. PostTurn hook (WHEN "at the end of every turn"), constructor
// `(opts: { stat, stages, trapAtStage?, onlyIfTrapped?, inflictStatus? })`, kept in the private field `opts`; `super()`.
//   canApply: `pokemon.getOpponents().some(eligible)`, with `eligible(opp)` = the foe exists, is not fainted, and (when
//     `onlyIfTrapped`) carries a trapping effect (`opp.getTag(TrappedTag) != null`, the CLASS lookup, so every kind of trap counts). (feasibility)
//   apply: not when simulated. Then, for each ADJACENT opponent that is still `eligible`, in this order:
//     1. queue one StatStageChangePhase on the foe for `stages` of `stat`                                         (effect)
//     2. when `trapAtStage` is set and `getStatStage(stat) + stages <= trapAtStage` (the stage BEFORE the queued drop runs,
//        no clamping): `foe.addTag(TRAPPED, 4 turns, source = holder)`                                           (effect rider)
//     3. when `inflictStatus` is set and `foe.canSetStatus(status, true, false, holder)`: `foe.trySetStatus(...)`  (effect rider)
//   No random draw.
//
// Why Tier C and one piece: the three actions run foe by foe and the second one reads the stage the first one is about to
// change, so they cannot be pulled apart into independent blocks, and the library has no block for "trap the foe" (effect.apply-tag
// is not implemented, request R-B11-C1-02) nor for "every foe next to me" as a target (effect.stat-stage knows only holder, other,
// holder-side and opposing-side). The trigger (end of every turn) is its own block. "Only foes that are already trapped" is a plain
// yes/no setting here (a filter of WHICH foes are hit, not a rule about the holder); an atom for it is request R-B11-C1-01.
// Every number, stat and status the effect uses is a typed setting. Extra conditions staff add are ANDed on top of the trigger.
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";
import { PostTurnFoeStatDropAbAttr } from "#data/elite-redux/archetypes/post-turn-foe-stat-drop";
import {
  BATTLE_STAT_OPTIONS,
  battleStatCodec,
  fromOptionsKey,
  GIVEN_STATUS_OPTIONS,
  givenStatusCodec,
  plainNumberCodec,
  STATUS_NONE,
  TRAP_NEVER,
  TRAP_OPTIONS,
  trapAtStageCodec,
  trueOrAbsentCodec,
} from "./b11-chunk1-codecs";

export default defineDecl(PostTurnFoeStatDropAbAttr, {
  tier: "C",
  kind: "event-effect",
  when: "event.end-of-turn",
  label: "Lower the foes' stat each turn (can also trap them)",
  summary: params =>
    `Each turn's end, ${params.stat} of every foe next to me changes by ${params.stages} stages (-1 = one lower). ${
      params.onlyIfTrapped === true ? "Only trapped foes." : "All foes next to me."
    } Trap: ${params.trapAtStage === TRAP_NEVER ? "never" : String(params.trapAtStage).toLowerCase()}.${
      params.inflictStatus === STATUS_NONE ? "" : ` Also gives ${String(params.inflictStatus).toLowerCase()}.`
    }`,
  synonyms: [
    "sap trap",
    "serpent bind",
    "tentalock",
    "chokehold",
    "slow the foes every turn",
    "bind and slow",
    "trap at minus three",
    "residual stat drop",
  ],
  examples: [
    "Lower the foes' Speed by one stage at the end of every turn and trap them at -3",
    "Slow every trapped foe by one stage each turn",
  ],
  params: [
    {
      id: "stat",
      ctorIndex: 0,
      ctorOption: "stat",
      path: "opts",
      control: "select",
      label: "Which stat changes",
      editable: true,
      default: "Speed",
      options: [...BATTLE_STAT_OPTIONS],
      codec: fromOptionsKey("stat", battleStatCodec),
    },
    {
      id: "stages",
      ctorIndex: 0,
      ctorOption: "stages",
      path: "opts",
      control: "number",
      min: -6,
      max: 6,
      step: 1,
      integer: true,
      label: "Number of stages per turn (-1 = one stage lower, 1 = one stage higher)",
      editable: true,
      default: -1,
      codec: fromOptionsKey("stages", plainNumberCodec),
    },
    {
      id: "trapAtStage",
      ctorIndex: 0,
      ctorOption: "trapAtStage",
      path: "opts",
      control: "select",
      label: "Trap the foe for 4 turns once its stat stage gets this low",
      editable: true,
      default: TRAP_NEVER,
      options: [...TRAP_OPTIONS],
      codec: fromOptionsKey("trapAtStage", trapAtStageCodec),
    },
    {
      id: "onlyIfTrapped",
      ctorIndex: 0,
      ctorOption: "onlyIfTrapped",
      path: "opts",
      control: "boolean",
      label: "Only hit foes that are already trapped",
      editable: true,
      default: false,
      codec: fromOptionsKey("onlyIfTrapped", trueOrAbsentCodec),
    },
    {
      id: "inflictStatus",
      ctorIndex: 0,
      ctorOption: "inflictStatus",
      path: "opts",
      control: "select",
      label: "Also try to give each hit foe this status condition",
      editable: true,
      default: STATUS_NONE,
      options: [...GIVEN_STATUS_OPTIONS],
      codec: fromOptionsKey("inflictStatus", givenStatusCodec),
    },
  ],
  conditions: [],
  guards: [],
  feasibility: [
    "Only foes next to me are hit (every foe in a normal battle), and never a foe that has fainted",
    "The turn only counts for the ability when at least one living foe qualifies (a trapped one when the setting is on)",
    "A foe counts as trapped for any kind of trapping effect, not only one",
    "The status is only given when the foe can really receive it",
    "Never in a preview",
  ],
  effect: {
    id: "effect.package",
    params: ["stat", "stages", "trapAtStage", "onlyIfTrapped", "inflictStatus"],
  },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "none", simulated: "respects" },
  probes: [
    {
      name: "two quiet turns, with the holder at full HP and at half HP",
      axes: { hp: ["max", "50%"] },
    },
  ],
  status: "decomposed",
  notes:
    "Tier C package, justified in the header. Users (all SPEED, -1): Sap Trap (5644, trapAtStage -3, hits every foe), Serpent Bind (5520) and Tentalock (5519), both onlyIfTrapped. No live ability sets inflictStatus (the dispatcher branch for Chokehold passes it, but that branch builds no live ability in this build); the setting is declared because the class supports it and a staff rule can use it. Remarks, NOT fixed: (1) canApply looks at ALL opponents (`getOpponents`) while apply works through the ADJACENT ones, so in a triple battle the ability can flash its banner for a far trapped foe and then do nothing. (2) The trap test uses the stage before the queued drop runs and does not clamp at -6, and the trap is added even when the drop itself is blocked (Clear Body, Mist), so a blocked drop can still trap. (3) The trapped test is the class lookup `getTag(TrappedTag)`, which matches every trapping tag; the library atom tag.has with TRAPPED matches only the plain one, so it is not a drop-in (request R-B11-C1-01 asks for a per-foe 'is trapped' atom with the class lookup). No gate and no binding: the only conditions are the effect's own foe filter and feasibility, so there is no closure to bind.",
});

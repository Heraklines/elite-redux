/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B10 / package (Tier C).
//
// Read by hand from archetypes/on-opponent-stat-raise.ts. Same Opportunist hook as Egoist (StatStageChangeCopyAbAttr), constructor
// `{ moveId, power? }` kept in the private field `opts`, `super()` so the banner defaults apply. `apply` (no canApply override):
//   simulated -> nothing
//   foes = holder.getOpponents() that are not fainted; none -> nothing
//   queue a MovePhase for the HOLDER aimed at foes[0] (the FIRST living foe, not necessarily the one that raised its stat),
//   move = scriptedPokemonMove(moveId, power, { alwaysHit: true, noRecharge: true }), MoveUseMode.INDIRECT (ignores PP).
// The inherited StatStageChangeCopyAbAttr.apply is NOT called, so no stat is copied. No random draw. The move never misses and
// does not make the holder recharge (the dex says the triggered Hyper Beam "has no recharge period").
//
// The move and its power are two settings (the move, and an optional power with 0 = the move's own power, no `power` key),
// built into `{ moveId }` or `{ moveId, power }` by `assembleCtorArg`.
//
// Why a package: the library effect "Use a move" needs the foe that caused the trigger (slot `other`), but this moment provides
// only the stat and the stages, and the class aims at the first living foe instead (request R-B10-12 in requests/B10.md).
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";
import { OnOpponentStatRaiseScriptedMoveAbAttr } from "#data/elite-redux/archetypes/on-opponent-stat-raise";
import { buildScriptedMove, scriptedMoveIdCodec, scriptedMovePowerCodec } from "./b10-codecs";

export default defineDecl(OnOpponentStatRaiseScriptedMoveAbAttr, {
  tier: "C",
  kind: "package",
  when: "event.foe-raised-stat",
  label: "Strike back with a move when a foe raises a stat",
  summary: params =>
    `When a foe raises a stat, I use ${params.moveId} on a foe at once${Number(params.power) > 0 ? ` with ${params.power} power` : " at the move's own power"}. It never misses and has no recharge. Example: Hyper Beam with 150 power.`,
  synonyms: ["retribution blow", "punish stat boosts", "counter boosts", "answer a boost", "free attack on boost"],
  examples: ["When the opposing Pokemon boosts its stats, I fire a 150 power Hyper Beam at it, like Retribution Blow"],
  params: [
    {
      id: "moveId",
      ctorIndex: 0,
      ctorOption: "moveId",
      path: "opts",
      control: "text",
      label: "Move to use (type its name, for example Hyper Beam)",
      editable: true,
      default: "HYPER_BEAM",
      codec: scriptedMoveIdCodec,
    },
    {
      id: "power",
      ctorIndex: 0,
      ctorOption: "power",
      path: "opts",
      control: "number",
      min: 0,
      max: 250,
      step: 1,
      integer: true,
      label: "Power of the move (0 = the move's own power)",
      editable: true,
      default: 150,
      codec: scriptedMovePowerCodec,
    },
  ],
  assembleCtorArg: { index: 0, build: buildScriptedMove },
  conditions: [],
  guards: [],
  feasibility: [
    "At least one foe must still be standing",
    "The move goes at the first foe still standing, not necessarily the one that raised its stat",
    "The move is a free extra move: it uses no PP, never misses and leaves me with no recharge turn",
    "Nothing happens in a preview",
  ],
  effect: { id: "effect.package", params: ["moveId", "power"] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "none", simulated: "respects" },
  probes: [{ name: "a foe raises a stat", axes: {} }],
  status: "decomposed",
  notes:
    "Package, justified (see the header): the library 'Use a move' needs the foe that raised the stat (slot other), which this moment does not provide, and the class aims at the first living foe (R-B10-12). The move and the power are separate settings now (power 0 = the move's own power). Only user: Retribution Blow (Hyper Beam with 150 power), nothing to bind. Oddity, not fixed: unlike its switch-out sibling this attr never checks that the holder is still standing. The move name is typed as text because the move list has hundreds of entries; an unknown name is refused.",
});

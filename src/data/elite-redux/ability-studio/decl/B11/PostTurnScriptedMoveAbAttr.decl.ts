/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B11 chunk 1 / event-effect (Tier B: the "every N turns" cadence is the gate inside canApply).
//
// Read by hand from archetypes/post-turn-scripted-move.ts. PostTurn hook (WHEN "at the end of every turn"), constructor
// `(options: { moveId, power?, everyNTurns? })`; the fields `moveId`, `power` and `everyNTurns` (default 1; the constructor
// THROWS unless it is a whole number of 1 or more). `super()`.
//   canApply is now `guards && gate`, in the ORIGINAL clause order:
//     1. guard:  `pokemon.isFainted()` -> false                                                   (guard not-fainted)
//     2. gate:   `turn = pokemon.tempSummonData?.turnCount ?? 0`; `turn > 0 && turn % everyNTurns === 0`  (CONDITION)
//   apply: not when simulated. Then the FIRST non-fainted opposing Pokemon is the target (none: nothing happens) and one MovePhase
//     is queued for the holder with the scripted move (`scriptedPokemonMove(moveId, power)`), in INDIRECT use mode (no PP, no
//     move history). No random draw.
//
// The cadence is a real condition ("only on every 2nd turn out"), so it is the gate block. The library has no atom for "a
// multiple of N turns" (time.turn-count only compares: request R-B11-C1-04), so both shipped gates are legacy closures for now:
// reusable as a whole, swappable by staff, counted as undecomposed. Because that closure reads the class's own `everyNTurns`,
// the setting is locked (a changed value would be ignored by the kept gate); it becomes editable the moment the atom exists.
// The effect is one piece: effect.scripted-move needs the foe as a slot (`other`), which the end of the turn does not provide,
// and it refuses to start from an indirect move (request R-B11-C1-05 for the variant that targets the first living foe).
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";
import { PostTurnScriptedMoveAbAttr } from "#data/elite-redux/archetypes/post-turn-scripted-move";
import { moveNameCodec, optionalPowerCodec } from "./b11-chunk1-codecs";

export default defineDecl(PostTurnScriptedMoveAbAttr, {
  tier: "B",
  kind: "event-effect",
  when: "event.end-of-turn",
  label: "Use a free move on the foe every few turns",
  summary: params =>
    `Every ${params.everyNTurns} turns, at the end of the turn, I use ${params.moveId} on the first living foe for free (no PP). Power ${params.power} (0 = the move's own power).`,
  synonyms: [
    "sumo wrestler",
    "cool exit",
    "free move every other turn",
    "scheduled attack",
    "periodic move",
    "auto attack every turn",
  ],
  examples: [
    "Throw the foe with a weak Circle Throw every second turn",
    "Use Chilly Reception for free every other turn",
  ],
  params: [
    {
      id: "moveId",
      ctorIndex: 0,
      ctorOption: "moveId",
      path: "moveId",
      control: "text",
      label: "Move to use (type its name, for example Circle Throw)",
      editable: true,
      gateIndependent: true,
      default: "Circle throw",
      codec: moveNameCodec,
    },
    {
      id: "power",
      ctorIndex: 0,
      ctorOption: "power",
      path: "power",
      control: "number",
      min: 0,
      max: 250,
      step: 1,
      integer: true,
      label: "Base power of that move (0 = the move's own power)",
      editable: true,
      gateIndependent: true,
      default: 0,
      codec: optionalPowerCodec,
    },
    {
      id: "everyNTurns",
      ctorIndex: 0,
      ctorOption: "everyNTurns",
      path: "everyNTurns",
      control: "number",
      min: 1,
      max: 20,
      step: 1,
      integer: true,
      label: "Use it every this many turns (1 = every turn, 2 = every other turn)",
      editable: false,
      default: 2,
    },
  ],
  conditions: [
    // The cadence of the shipped abilities (a legacy closure for now, see the header). Staff swap it for any condition.
    { slot: "gate", ctx: "params", removable: true, editable: true },
  ],
  guards: ["not-fainted"],
  feasibility: [
    "Needs a living foe: the first living foe on the field is the target",
    "The move is cast for free (no PP used, nothing added to the move history)",
    "Never in a preview",
  ],
  effect: { id: "effect.package", params: ["moveId", "power"] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "none", simulated: "respects" },
  probes: [
    {
      name: "two quiet turns at full HP and at half HP",
      axes: { hp: ["max", "50%"] },
    },
  ],
  status: "decomposed",
  notes:
    "Tier B, justified in the header. Users: Sumo Wrestler (5638: Circle Throw, power 20, every 2 turns) and Cool Exit (5641: Chilly Reception, own power, every 2 turns); both gates are bound as legacy closures (request R-B11-C1-04) and `everyNTurns` is locked until then. The effect is one piece for the reason in the header (request R-B11-C1-05). The turn counter is `tempSummonData.turnCount`, which counts turns since the holder entered (turn 0 never fires). Remark, NOT fixed: the class's header comment also lists Life Steal and Soul Tap as users, but only the two abilities above build this class today.",
});

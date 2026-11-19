/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B11 chunk 3 / calc-modifier (Tier C).
//
// Read by hand from archetypes/repeat-move-power-boost.ts. It extends MovePowerBoostAbAttr (WHEN "while the game
// calculates a move's power"). The constructor takes ONE options object `{ bonus, cap?, flag? }` and builds the parent's
// closure itself: `(_p, _t, move) => options.flag === undefined || move.hasFlag(options.flag)`, with a power multiplier of
// 1 (the parent's own multiplier is a no-op). So the closure is NOT a constructor argument and there is nothing to bind.
//   canApply: the parent's, i.e. the flag closure above                                       (condition: move flag, the param)
//   apply: walk the holder's move history (most recent first) while each entry is the CURRENT move and was a SUCCESS,
//     counting `repeats`; stop at the first entry that is not. Multiply power by `min(cap, 1 + bonus * repeats)`.
// No random draw, no memory of its own (the history is the game's own `getLastXMoves`).
//
// Why Tier C: the closure is built inside the constructor, so the condition cannot be replaced from the outside; the flag is
// a param instead. There is no library atom for "I used this same move N times in a row" (request R-B11-04).
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";
import { MOVE_FLAG_OPTIONS } from "#data/elite-redux/ability-studio/vocabulary/enums";
import { RepeatMovePowerBoostAbAttr } from "#data/elite-redux/archetypes/repeat-move-power-boost";
import { MoveFlags } from "#enums/move-flags";
import { optionalCapCodec, optionalEnumCodec } from "./b11-chunk3-codecs";

export default defineDecl(RepeatMovePowerBoostAbAttr, {
  tier: "C",
  kind: "calc-modifier",
  when: "calc.move-power",
  label: "Raise move power each time I repeat the same move",
  summary: params =>
    `Each time in a row I use the same move successfully, its power goes up by ${params.bonus} of its normal power (0.1 = 10%), up to the limit you set. Example: 3 repeats at 0.1 = power x1.3.`,
  synonyms: ["rhythmic", "repeat boost", "combo", "momentum", "stack power", "same move again"],
  examples: [
    "Deal 10% more damage for each repeated move use",
    "Sound moves get 20% stronger every time I repeat them",
  ],
  params: [
    {
      id: "bonus",
      ctorIndex: 0,
      ctorOption: "bonus",
      path: "bonus",
      control: "number",
      min: 0,
      max: 2,
      step: 0.05,
      label: "Extra power for each repeat (0.1 = 10% more)",
      editable: true,
      default: 0.1,
    },
    {
      id: "cap",
      ctorIndex: 0,
      ctorOption: "cap",
      path: "cap",
      control: "number",
      min: 0,
      max: 8,
      step: 0.05,
      label: "Highest total power multiplier (0 = no limit, 1.5 = at most 50% more)",
      editable: true,
      default: 0,
      codec: optionalCapCodec,
    },
    {
      id: "flag",
      ctorIndex: 0,
      ctorOption: "flag",
      path: "flag",
      control: "select",
      label: "Only moves with this trait (Any move = all moves)",
      editable: true,
      default: "ANY",
      options: ["ANY", ...MOVE_FLAG_OPTIONS],
      codec: optionalEnumCodec(MoveFlags, "ANY"),
    },
  ],
  conditions: [],
  guards: [],
  feasibility: [
    "Only counts uses of the same move that succeeded, one right after the other; any other move or a failed use starts the count again",
    "If a trait is chosen, a move without that trait gets no bonus",
  ],
  effect: { id: "effect.multiply-power", params: ["bonus", "cap"] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "none", simulated: "respects" },
  probes: [{ name: "the first use of a damaging move", axes: { foeMove: ["TACKLE", "WATER_GUN"] } }],
  l2StaticReason:
    "The only user (Rhythmic) boosts sound moves only, and no L2 scenario lets the holder use a sound move: the holder's moves are fixed (Celebrate, Tackle, Swords Dance, Double Slap) and the probe axes steer only the foe, so the original's power attr is never evaluated. test/tests/elite-redux/decomp/B11/chunk3.test.ts drives the original and the rebuild with real sound and non-sound moves and a stand-in move history instead (request R-B11-11 asks for a holderMove probe axis).",
  status: "decomposed",
  notes:
    "Tier C, justified in the header. Users: Rhythmic (640), built by the dispatcher with `{ bonus: 0.1 }` and then REPLACED by the ability upgrade `upgrade:rhythmic:sound-repeat-20` with `{ bonus: 0.2, flag: SOUND_BASED }`; the live instance is read, so the declared values are the upgraded ones. Nothing to bind. The history walk is the game's own state, which the L1 grid and L2 twin cannot grow (they never use a move twice), so test/tests/elite-redux/decomp/B11/chunk3.test.ts drives apply on the original and the rebuild with a stand-in history. The flag test is the move's own `hasFlag(flag)` (a plain bit test), which is what the library atom move.flag must reproduce if it is ever bound to it.",
});

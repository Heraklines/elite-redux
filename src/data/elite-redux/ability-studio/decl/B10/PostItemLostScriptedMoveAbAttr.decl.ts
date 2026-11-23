/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B10 chunk 4 / event-effect (Tier A, no condition slot).
//
// Read by hand from archetypes/post-item-lost-scripted-move.ts. The class extends PostItemLostAbAttr (WHEN "when I lose my held
// item"; the hook is applied from modifier.ts, pokemon.ts, move.ts and battle-scene.ts, some with an `opponent`, some without),
// constructor `{ moveId, power? }` kept in the private field `opts`, `super()` (banner shown). canApply is `return true` (no clause).
// apply: simulated -> nothing; else the first LIVING opponent of the holder (`getOpponents()` filtered by not fainted) is the target;
// none -> nothing; else a MovePhase for the HOLDER aimed at that foe with scriptedPokemonMove(moveId, power), use mode INDIRECT, queued
// at the front. No closure, no random draw, no check on the holder or on who took the item.
//
// The move and its power are two settings (power 0 = the move's own power, then no `power` key at all, as in the live user). The
// effect is the library's "Use a move" (effect.scripted-move, params moveId and power); it is not equal to it yet (see the notes).
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";
import { PostItemLostScriptedMoveAbAttr } from "#data/elite-redux/archetypes/post-item-lost-scripted-move";
import { buildScriptedMove, scriptedMoveIdCodec, scriptedMovePowerCodec } from "./b10-codecs";

export default defineDecl(PostItemLostScriptedMoveAbAttr, {
  tier: "A",
  kind: "event-effect",
  when: "event.item-lost",
  label: "Use a free move when I lose my held item",
  summary: params =>
    `When I lose my held item, I use ${params.moveId} on a foe that is still standing${Number(params.power) > 0 ? ` with ${params.power} power` : " at the move's own power"}. It uses no PP. Example: Thief.`,
  synonyms: [
    "greedy",
    "thief when my item is taken",
    "revenge for item loss",
    "counter when knocked off",
    "item loss reaction",
    "steal back",
    "use a move after losing an item",
  ],
  examples: [
    "When my item is knocked off or used up, I use Thief on a foe, like Greedy",
    "When I lose my item, I hit a foe with a 40 power Knock Off",
  ],
  params: [
    {
      id: "moveId",
      ctorIndex: 0,
      ctorOption: "moveId",
      path: "opts",
      control: "text",
      label: "Move to use (type its name, for example Thief)",
      editable: true,
      default: "THIEF",
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
      default: 0,
      codec: scriptedMovePowerCodec,
    },
  ],
  assembleCtorArg: { index: 0, build: buildScriptedMove },
  conditions: [],
  guards: [],
  feasibility: [
    "At least one foe must still be standing; the move is aimed at the first one",
    "The move is a free extra move: it uses no PP and cannot start another follow-up",
    "Nothing happens in a preview",
  ],
  effect: { id: "effect.scripted-move", params: ["moveId", "power"] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "none", simulated: "respects" },
  probes: [{ name: "lose the held item with a foe in front of me", axes: {} }],
  l2StaticReason:
    "The L2 twin has no scenario that makes the holder lose an item (event.item-lost is listed as unreached in decomp-l2-reach.json), so the original cannot be shown evaluated. The B10 test (test/tests/elite-redux/decomp/B10/chunk4-effects.test.ts) calls apply of the original and the rebuild for a living foe, a fainted foe and a preview and compares the queued move.",
  status: "decomposed",
  notes:
    "Tier A. Only user (1 attr): Greedy attr 0 (Thief at its own power, power setting 0); nothing to bind. The move and the power are separate settings. The effect is the library's 'Use a move' by id, but not equal to it yet: the library effect needs the frame slot `other` (the item hook has no foe in every call: modifier.ts passes none), refuses when the holder has fainted and refuses a move that came from an indirect move, while the class picks the first living foe by itself and checks none of that (request R-B10-c4-07). Oddities, NOT fixed: the hook is applied from several places (item removal in modifier.ts, item effects in pokemon.ts and move.ts, item transfer in battle-scene.ts), and the holder is not checked for fainting before the move is queued (a fainted holder's MovePhase is dropped by the engine, not by the class).",
});

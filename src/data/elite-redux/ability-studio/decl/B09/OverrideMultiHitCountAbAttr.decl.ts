/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";
import { enumCodec, enumOptions } from "#data/elite-redux/ability-studio/param-codecs";
import { OverrideMultiHitCountAbAttr } from "#data/elite-redux/archetypes/multi-hit-count-override";
import { MoveId } from "#enums/move-id";
// B09 chunk 5. "One chosen move always hits an exact number of times" (Giant Shuriken: Water Shuriken hits exactly once).
//
// Source: src/data/elite-redux/archetypes/multi-hit-count-override.ts, class OverrideMultiHitCountAbAttr (extends AbAttr; showAbility
// false). NOTHING is dispatched by applyAbAttrs. `MoveEffectPhase.start` (src/phases/move-effect-phase.ts:273) scans the user's
// active ability attrs BY NAME ("OverrideMultiHitCountAbAttr") after the native hit count, Parental Bond style abilities and
// Multi-Lens were applied, calls the duck-typed `resolveHits(move)`, and when it is not null sets `hitCount.value = forced`
// (the last attr in the list wins). The rule of `resolveHits(move)`: `move.id === moveId ? hits : null`.
// Constructor: ({ moveId, hits }), one options object. No random draw, no state, nothing reads `simulated`.
//
// Tier C: there is no gate and no frame (the engine asks the attr directly), so the block is one "while I have this" piece with two
// settings. Extra IFs cannot be added (`if: false`). No binding is needed (no constructor closure).
export default defineDecl(OverrideMultiHitCountAbAttr, {
  tier: "C",
  kind: "while-active",
  when: "while.active",
  label: "Make one chosen move always hit an exact number of times",
  summary: params =>
    `Whenever I use ${params.moveId}, it hits exactly ${params.hits} time(s), whatever it normally does. This is decided last, after extra-hit abilities and items, so it wins.`,
  synonyms: [
    "giant shuriken",
    "fixed hit count",
    "always hits once",
    "no multi hit",
    "exact number of hits",
    "force hit count",
    "single hit",
    "water shuriken hits once",
  ],
  examples: [
    "Water Shuriken always hits exactly once, like Giant Shuriken",
    "Make Bullet Seed always hit three times",
  ],
  params: [
    {
      id: "moveId",
      ctorIndex: 0,
      ctorOption: "moveId",
      path: "moveId",
      control: "select",
      label: "Move whose number of hits is fixed (pick it from the list, for example Water Shuriken)",
      editable: true,
      default: "WATER_SHURIKEN",
      options: enumOptions(MoveId),
      codec: enumCodec(MoveId, "move"),
    },
    {
      id: "hits",
      ctorIndex: 0,
      ctorOption: "hits",
      path: "hits",
      control: "number",
      label: "Exact number of hits (1-10)",
      editable: true,
      integer: true,
      min: 1,
      max: 10,
      step: 1,
      default: 1,
    },
  ],
  conditions: [],
  guards: [],
  feasibility: [
    "The count is forced after every other source of extra hits, so Parental Bond style abilities and Multi-Lens cannot raise it",
    "Only that one move is affected; every other move keeps its own hit count",
  ],
  reusableAlone: { when: true, if: false, do: true },
  flags: { rng: "none", state: "none", simulated: "ignores" },
  probes: [{ name: "my attack against a foe that uses a damaging move", axes: { foeMove: ["TACKLE", "WATER_GUN"] } }],
  l2StaticReason:
    "The override has no dispatch moment (no trace event): the move phase scans for it by name. The twin compares the whole battle, and B09/chunk5.test.ts proves the forced count for the chosen move and for another move.",
  status: "decomposed",
  notes:
    "Tier C, 1 attr: Giant Shuriken (5659 attr 2: Water Shuriken, 1 hit; attr 0 is the power boost and attr 1 the crit bonus, other classes). It needs no binding. The scan runs every time a move starts (not per hit) and the LAST matching attr wins when a holder has several. Engine coupling, not fixed: the engine finds the attr by constructor name, so a rebuilt copy must keep the class name (the rebuild uses the real class). Request R-B09-39 asks for the effect 'Set the exact number of hits of a move' and a WHEN word, because the engine does the scan inside the move phase.",
});

/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B15 chunk 6. Package. "When I enter the battle, I forget every type I lost (World in Pieces starts whole again)."
//
// Source: src/data/elite-redux/abilities/world-in-pieces.ts, class WorldInPiecesSummonAbAttr (extends PostSummonAbAttr; the constructor passes showAbility false, activateOnGain stays the
// default; no constructor argument). The class has NO canApply of its own (PostSummonAbAttr answers true), so there is no condition, no guard and no gate to extract.
// apply, in order:
//   1. `if (simulated) return`                                                          -> effect-side (the class respects simulated)
//   2. WORLD_IN_PIECES_STATE.set(holder, { original: undefined, removed: new Set() })   -> forget the type snapshot and the removed list
//   3. WORLD_IN_PIECES_REMOVED_THIS_TURN.delete(holder)                                 -> forget the "already stripped a type this turn" memory
// No random draw anywhere. The two WeakMaps are module state shared with the other three halves (remove a type, speed bonus, restore a type) and with the AI snapshot
// (erWorldInPiecesState in combat-private-state.ts).
//
// Why a package (honest limit): the effect only resets private module memory that the three sibling classes own; the vocabulary has no memory it can address, so there is no
// effect block to express it with and nothing to give a typed setting to (no number, type, stat or status is involved). The trigger (when I enter) is the separate, swappable WHEN,
// and there is no condition in the class to separate.
import { WorldInPiecesSummonAbAttr } from "#data/elite-redux/abilities/world-in-pieces";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";

export default defineDecl(WorldInPiecesSummonAbAttr, {
  tier: "C",
  kind: "package",
  when: "event.on-entry",
  label: "Start over with all my types when I enter (World in Pieces)",
  summary: () =>
    "When I enter the battle, I forget every type I lost, so I start whole again. Example: after switching back in, I have all my types and no Speed bonus.",
  synonyms: [
    "world in pieces",
    "reset my lost types",
    "start whole again",
    "forget what I lost",
    "restore on switch in",
    "fresh start on entry",
  ],
  examples: ["Every time I switch in I start with all my types again, like World in Pieces"],
  params: [],
  noParamsReason:
    "The effect only clears the ability's own private memory of lost types; it has no number, type, stat or status to set. The memory is shared with the three sibling halves of World in Pieces and is not something the library can address.",
  conditions: [],
  guards: [],
  feasibility: [
    "It does nothing in a preview",
    "The memory it clears belongs to the three other halves of the same ability (lose a type, Speed bonus, win a type back)",
  ],
  effect: { id: "effect.package", params: [] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "battle", simulated: "respects" },
  probes: [{ name: "enter the battle", axes: {} }],
  status: "decomposed",
  notes:
    "PACKAGE, justified (see the header). 1 attr in 1 ability: World in Pieces (5917 attr 0). No closure, so no binding. The class itself is stateless: the state lives in the module WeakMaps WORLD_IN_PIECES_STATE and WORLD_IN_PIECES_REMOVED_THIS_TURN, keyed by the Pokemon object, so a rebuilt attr shares the very same memory with the original siblings. Requested: R-B15-46 (the lost-types memory as a library memory plus effects). Suspected oddity, NOT fixed: the memory is only cleared on summon (the ability has no leave-field reset), so a holder whose ability is swapped away mid-battle keeps its stripped types for as long as it stays out.",
});

/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";
// Aroma Veil, ally half (Tier B). "While the game works out the effect chance of a move that hits me or one of my allies, IF
// that chance is above 0% and below 100%, DO set it to 0%".
//
// Source: ability-upgrades/attrs/optional-secondary-effect.ts over UserFieldIgnoreMoveEffectsAbAttr (ab-attrs.ts:1572, canApply
// `chance.value > 0`, apply `chance.value = 0`). Dispatch: applyAbAttrs("UserFieldIgnoreMoveEffectsAbAttr", { pokemon: fieldMon,
// move, simulated: !showAbility, chance }) once for EVERY Pokemon of the target's side (`target.getAlliesGenerator()`, which
// includes the target itself) at move.ts:2067, so an ally holding the ability protects the target.
//
// canApply, in the ORIGINAL clause order (now gate only): 0 < chance.value < 100 (isOptionalEffectChance).
// apply (inherited, untouched): chance.value = 0, regardless of `simulated`.
import { UserFieldIgnoreOptionalMoveEffectsAbAttr } from "#data/elite-redux/ability-upgrades/attrs/optional-secondary-effect";

export default defineDecl(UserFieldIgnoreOptionalMoveEffectsAbAttr, {
  tier: "B",
  kind: "calc-modifier",
  when: "calc.incoming-effect-chance",
  label: "Block uncertain extra effects for me and my allies",
  summary: () =>
    "A move that hits me or my ally loses its extra effect when that effect only happens some of the time, between 1% and 99%. Guaranteed effects still happen.",
  synonyms: [
    "aroma veil",
    "side wide shield dust",
    "protect allies from side effects",
    "team shield dust",
    "desert cloak",
  ],
  examples: ["My whole side ignores uncertain extra effects, like the ally half of Aroma Veil"],
  params: [],
  noParamsReason:
    "The class has no settings: its only constructor argument is whether the ability pop-up shows (fixed). The 'uncertain' line (above 0% and below 100%) is the condition, which staff replace or remove as a block, not a number on this effect.",
  conditions: [
    // Legacy-closure binding "chance is above 0 and below 100" (bindings.ts, request R-B18-11).
    { slot: "gate", ctx: "params", removable: true, editable: true },
  ],
  guards: [],
  feasibility: [],
  effect: { id: "effect.package", params: [] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "none", simulated: "ignores" },
  probes: [
    { name: "a move with no extra effect and a move with an uncertain one", axes: { foeMove: ["TACKLE", "EMBER"] } },
  ],
  l2StaticReason:
    "The twin scenarios only reach the holder through Tackle-class moves, which have no effect chance, so the effect-chance calc is never evaluated there (decomp-l2-reach.json). B18/chunk2.test.ts drives the real dispatch (the ally walk of the target's side) with every chance from -1 to 100.",
  status: "decomposed",
  notes:
    "WHY THE EFFECT STAYS ONE PIECE: same as the holder half, 'set the move's effect chance to 0' changes a frame value no library effect owns yet (request R-B18-12); the condition has no atom (request R-B18-11) so the gate is a legacy closure. The WHEN is shared with the holder half (calc.incoming-effect-chance lists this class's dispatch key as `alsoDispatchKeys`), so the two cannot be told apart in the editor until the librarian gives the side-wide dispatch its own WHEN (request R-B18-13). Users: Aroma Veil (165, attr 2). ODDITIES (not fixed): (1) Sand Cloak's SandSecondaryEffectImmunityAbAttr extends the unconditional UserFieldIgnoreMoveEffectsAbAttr, not this class; (2) the ally walk includes the target itself, so on a holder this attr and the holder half both run on the same hit (the second finds chance 0 and does nothing).",
});

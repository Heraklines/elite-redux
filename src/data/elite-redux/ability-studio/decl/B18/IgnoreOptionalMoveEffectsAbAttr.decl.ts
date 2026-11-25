/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";
// Aroma Veil, holder half (Tier B). "While the game works out the effect chance of a move that hits me, IF that chance is
// above 0% and below 100%, DO set it to 0% (the extra effect never happens)".
//
// Source: ability-upgrades/attrs/optional-secondary-effect.ts over IgnoreMoveEffectsAbAttr (ab-attrs.ts:1550, whose
// canApply is `chance.value > 0` and whose apply is `chance.value = 0`). Dispatch: applyAbAttrs("IgnoreMoveEffectsAbAttr",
// { pokemon: target, move, simulated: !showAbility, chance }) at move.ts:2060 (Move effect chance), the holder being the
// move's TARGET.
//
// canApply, in the ORIGINAL clause order (now gate only; no guards, no draw, no residual):
//   gate   0 < chance.value < 100           (isOptionalEffectChance)  a guaranteed (100%) or absent (0 / -1) effect is left alone
// apply (inherited, untouched): chance.value = 0. It does NOT look at `simulated`: the effect chance is a number the damage
// and move code ask for, so the preview call must give the same answer as the real one.
import { IgnoreOptionalMoveEffectsAbAttr } from "#data/elite-redux/ability-upgrades/attrs/optional-secondary-effect";

export default defineDecl(IgnoreOptionalMoveEffectsAbAttr, {
  tier: "B",
  kind: "calc-modifier",
  when: "calc.incoming-effect-chance",
  label: "Block uncertain extra effects of moves that hit me",
  summary: () =>
    "A move that hits me loses its extra effect (burn, flinch, stat drop...) when that effect only happens some of the time, between 1% and 99%. Guaranteed effects still happen.",
  synonyms: [
    "shield dust",
    "aroma veil",
    "block secondary effects",
    "ignore added effects",
    "no flinch chance",
    "covert cloak",
  ],
  examples: ["Moves that only sometimes burn or flinch have no extra effect on me, like Shield Dust"],
  params: [],
  noParamsReason:
    "The class has no settings: its only constructor argument is whether the ability pop-up shows (fixed). The 'uncertain' line (above 0% and below 100%) is the condition, which staff replace or remove as a block, not a number on this effect.",
  conditions: [
    // The gate is the legacy-closure binding "chance is above 0 and below 100" (bindings.ts): the effect chance is a frame value
    // no atom reads yet (request R-B18-11).
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
    "The twin scenarios only reach the holder through Tackle-class moves, which have no effect chance, so the effect-chance calc is never evaluated there (decomp-l2-reach.json). B18/chunk2.test.ts drives the real dispatch with every chance from -1 to 100 on a live Aroma Veil holder, compared with the old rule.",
  status: "decomposed",
  notes:
    "WHY THE EFFECT STAYS ONE PIECE: 'set the move's effect chance to 0' writes a frame value (the NumberHolder `chance`) that no library effect changes yet (effect.negate modifies `cancelled`, not the effect chance); request R-B18-12. The trigger (calc.incoming-effect-chance) and the condition are separate blocks; the condition 'the effect chance is above 0 and below 100' has no atom yet, because the frame has no effect-chance slot (request R-B18-11), so the gate is bound as a legacy closure and counts as undecomposed. Removing the condition leaves a rule that blanks every effect chance (Shield Dust). Users: Aroma Veil (165, attr 1). ODDITIES (not fixed): (1) the base class IgnoreMoveEffectsAbAttr is also found by NAME elsewhere (move.ts:4543 Sparkling Aria, archetypes/absorbant.ts:23, chance-status-on-hit.ts:718 and :921, puppet-strings.ts:57, ate-conditional.ts:151, move-effect-phase.ts:1223 via hasAbilityWithAttr), and those checks do NOT use the 1-99% line, so Aroma Veil also blocks the Sparkling Aria cure and the same-name guarded effects even when their chance is 100%; (2) the holder variant is dispatched once for the move's target only, the ally variant (next declaration) iterates the whole side; (3) showAbility is false, so the pop-up never shows.",
});

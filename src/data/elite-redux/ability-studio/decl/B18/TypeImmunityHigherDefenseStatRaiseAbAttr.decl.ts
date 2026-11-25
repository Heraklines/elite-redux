/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B18 chunk 4. Rain Dish. "While the game checks whether a move can hit me, IF it is a move of <type>, DO make me immune AND raise my
// better defensive stat".
//
// Source: ability-upgrades/attrs/requested-combat-riders.ts over TypeImmunityAbAttr (ab-attrs.ts:458). Constructor `(type, stages = 1)`;
// it calls `super(type)`, so the parent's optional condition closure is always null and there is nothing to bind (Tier A, no class edit).
// Dispatch: applyAbAttrs("TypeImmunityAbAttr", { pokemon: holder, opponent: attacker, move, typeMultiplier, cancelled, simulated }) in
// Pokemon.getMoveEffectiveness. Clauses:
//   canApply  inherited, NOT overridden: the move does not target both sides, the enemy side or the user side; the attacker is not me;
//             the type is not null; and `getTriggeredMoveTypes(holder, attacker, move)` contains `type`   -> the immunity rule of the type setting
//   apply 1   typeMultiplier = 0, cancelled = true                                                         -> EFFECT (immunity)
//   apply 2   simulated -> stop                                                                            -> respects the preview flag
//   apply 3   stat = getStat(SPDEF, false) > getStat(DEF, false) ? SPDEF : DEF   (raw stats, no stat stages; Defense wins a tie)
//             queue ONE StatStageChangePhase for that stat by `stages` on the holder                       -> EFFECT (stat change)
// No random draw, no state.
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";
import { enumCodec } from "#data/elite-redux/ability-studio/param-codecs";
import { TYPE_OPTIONS } from "#data/elite-redux/ability-studio/vocabulary/enums";
import { TypeImmunityHigherDefenseStatRaiseAbAttr } from "#data/elite-redux/ability-upgrades/attrs/requested-combat-riders";
import { PokemonType } from "#enums/pokemon-type";

export default defineDecl(TypeImmunityHigherDefenseStatRaiseAbAttr, {
  tier: "A",
  kind: "calc-modifier",
  when: "calc.move-immunity",
  label: "Absorb one move type and raise my better defense",
  summary: params =>
    `Moves of the ${params.type} type do nothing to me, and my higher defensive stat (Defense or Sp. Def) goes up by ${params.stages}. Example: Water, 1 stage, like Rain Dish.`,
  synonyms: [
    "rain dish absorb",
    "water absorb and defense",
    "immune and raise defense",
    "absorb and boost defense",
    "type absorb",
    "immunity with a defense boost",
    "bulk up on absorb",
  ],
  examples: [
    "Water moves do nothing to me and my higher defensive stat rises by one stage, like Rain Dish",
    "Fire moves do nothing to me and my better defense goes up two stages",
  ],
  params: [
    {
      id: "type",
      ctorIndex: 0,
      path: "immuneType",
      control: "select",
      label: "Move type I absorb",
      editable: true,
      default: "WATER",
      options: TYPE_OPTIONS,
      codec: enumCodec(PokemonType, "type"),
    },
    {
      id: "stages",
      ctorIndex: 1,
      path: "stages",
      control: "number",
      min: 1,
      max: 6,
      step: 1,
      integer: true,
      label: "Number of stages my higher defensive stat rises (1-6)",
      editable: true,
      default: 1,
    },
  ],
  conditions: [],
  guards: [],
  feasibility: [
    "Moves that hit every Pokemon or a whole side (Spikes, Rain Dance) are never absorbed",
    "A Pokemon never absorbs its own move",
    "The higher defensive stat is picked from the raw stats, ignoring stat stages; Defense wins a tie",
    "Nothing is raised when the game only previews the move",
  ],
  // The immunity is the library effect; raising the higher of Defense and Sp. Def is not one (request R-B18-32), so it stays a typed setting of this block.
  effect: { id: "effect.immune-to-type", params: ["type", "stages"] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "none", simulated: "respects" },
  probes: [
    {
      name: "a move of the type, a neutral move, and other types",
      axes: { foeMove: ["WATER_GUN", "TACKLE", "EMBER", "BITE"] },
    },
  ],
  status: "decomposed",
  notes:
    "Tier A, 1 attr, nothing to bind (the constructor takes no closure and the parent's condition is null): Rain Dish (44, attr 1, Water, +1 stage; attr 0 is the rain heal). Same shape as B12's TypeImmunityHighestAttackStatStageAbAttr but for Defense and Sp. Def, and with the exact opposite tie rule (here Defense wins a tie, there Attack). The class does not override canApply, so the immunity rule is TypeImmunityAbAttr's own and the declaration describes it as the effect's feasibility, like the immune-to-type block. The raise cannot be split from the immunity because both live in one `apply`, so the block keeps the stat raise as the typed `stages` setting of the immunity effect; request R-B18-32 asks for an effect that raises the higher of two named stats. ODDITIES, not fixed: (a) unlike plain TypeImmunityAbAttr this class also sets `cancelled = true`, which the dispatcher reads as a cancelled move; (b) the inherited canApply has no status-move exemption, so a Water STATUS move (Soak) is absorbed too and raises the stat; (c) the pick uses raw stats without stages, so after a boost the pick can stay on the same stat; (d) the stat phase is queued even when the stat is already at +6; (e) the ability banner is shown (showAbility true).",
});

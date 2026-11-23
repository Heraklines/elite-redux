/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B12 chunk 4. "Moves of one type do nothing to me, and my better attacking stat goes up" (Lightning Rod, Storm Drain, Sap Sipper, Reservoir, Lightning Aspect).
//
// Source: src/data/elite-redux/archetypes/type-immunity-highest-attack-stat-stage.ts, TypeImmunityHighestAttackStatStageAbAttr (extends
// TypeImmunityAbAttr). Constructor: one options object `{ immuneType, stages }`; it calls `super(immuneType)` so the parent's condition is always
// null. Dispatched while the game checks whether a move can hit (applyAbAttrs("TypeImmunityAbAttr") in Pokemon.getMoveEffectiveness). Clauses (Tier A):
//   canApply  inherited from TypeImmunityAbAttr, NOT overridden: the move does not target both sides, the enemy side or the user side, the attacker is not
//             me, and the move's type (as triggered, `getTriggeredMoveTypes`) is `immuneType`      the immunity rule of the type setting (no closure, nothing to bind)
//   apply 1   `typeMultiplier = 0` (parent), then `cancelled = true`                                  EFFECT (immunity)
//   apply 2   `simulated` -> stop                                                                      respects the preview flag
//   apply 3   compare the raw Attack and Sp. Atk (`getStat(stat, false)`, no stat stages); Attack when they are equal or higher, else Sp. Atk;
//             queue ONE StatStageChangePhase for that stat by `stages` (holder, selfTarget true)      EFFECT (stat change)
// No random draw, no state.
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";
import { enumCodec } from "#data/elite-redux/ability-studio/param-codecs";
import { TYPE_OPTIONS } from "#data/elite-redux/ability-studio/vocabulary/enums";
import { TypeImmunityHighestAttackStatStageAbAttr } from "#data/elite-redux/archetypes/type-immunity-highest-attack-stat-stage";
import { PokemonType } from "#enums/pokemon-type";

const IN_OPTIONS = { ctorIndex: 0 } as const;

export default defineDecl(TypeImmunityHighestAttackStatStageAbAttr, {
  tier: "A",
  kind: "calc-modifier",
  when: "calc.move-immunity",
  label: "Absorb one move type and raise my better attacking stat",
  summary: params =>
    `Moves of the ${params.type} type do nothing to me, and my higher attacking stat (Attack or Sp. Atk) goes up by ${params.stages}. Example: Electric, 1 stage, like Lightning Rod.`,
  synonyms: [
    "lightning rod",
    "storm drain",
    "sap sipper",
    "reservoir",
    "lightning aspect",
    "absorb and boost",
    "immune and raise attack",
    "type absorb",
    "redirect and boost",
  ],
  examples: [
    "Electric moves do nothing to me and my higher attacking stat rises by one stage, like Lightning Rod",
    "Grass moves do nothing to me and my higher attacking stat rises by one stage, like Sap Sipper",
  ],
  params: [
    {
      id: "type",
      ...IN_OPTIONS,
      ctorOption: "immuneType",
      path: "immuneType",
      control: "select",
      label: "Move type I absorb",
      editable: true,
      default: "ELECTRIC",
      options: TYPE_OPTIONS,
      codec: enumCodec(PokemonType, "type"),
    },
    {
      id: "stages",
      ...IN_OPTIONS,
      ctorOption: "stages",
      path: "stages",
      control: "number",
      min: 1,
      max: 6,
      step: 1,
      integer: true,
      label: "Number of stages my higher attacking stat rises (1-6)",
      editable: true,
      default: 1,
    },
  ],
  conditions: [],
  guards: [],
  feasibility: [
    "Moves that hit every Pokemon or a whole side (Spikes, Rain Dance) are never absorbed",
    "A Pokemon never absorbs its own move",
    "The higher attacking stat is picked from the raw stats, ignoring stat stages; Attack wins a tie",
    "Nothing is raised when the game only previews the move",
  ],
  // The immunity is the library effect; raising the higher of Attack and Sp. Atk is not (R-B12-14 and R-B12-32), so it stays a typed setting of this block.
  effect: { id: "effect.immune-to-type", params: ["type", "stages"] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "none", simulated: "respects" },
  probes: [
    {
      name: "a move of the type, a neutral move, and other types",
      axes: { foeMove: ["THUNDERBOLT", "TACKLE", "WATER_GUN", "EMBER"] },
    },
  ],
  status: "decomposed",
  notes:
    "Tier A, 5 attrs, nothing to bind (the constructor takes no closure and the parent's condition is null): Lightning Rod (31 attr 1, Electric), Storm Drain (114 attr 1, Water), Sap Sipper (157 attr 0, Grass), Reservoir (5450 attr 2, Water) and Lightning Aspect (5569 attr 0, Electric), all +1 stage. They replace the vanilla fixed Sp. Atk absorb (init-elite-redux-vanilla-rebalance.ts patchTypeImmunityHighestAtk). The class does not override canApply, so the immunity rule is TypeImmunityAbAttr's own; the declaration describes it as the effect's feasibility, like the immune-to-type block. Oddities, not fixed: (a) unlike TypeImmunityAbAttr alone, this class also sets `cancelled = true`, (the plain immunity only zeroes the matchup), which the dispatcher reads as a cancelled move; (b) because the parent's canApply has no status-move exemption, a STATUS move of the type (Spore for Grass, Soak for Water, Thunder Wave for Electric) is absorbed too, and then raises the stat; (c) the pick uses raw stats without stat stages, so after a boost the pick can stay on the same stat; (d) the stat phase is queued even when the stat is already at +6; (e) the ability banner is shown.",
});

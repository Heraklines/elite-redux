/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B14 chunk 6. Tier A calc-modifier with TWO consequences (an immunity, then a charge stack), shown as two branches. "While the
// game checks whether a move can hit me, I am immune to <type> moves, and when one is absorbed I gain a charge stack"
// (Capacitor Bank absorbs Electric moves).
//
// Source: electivire.ts CapacitorBankAbsorbAbAttr (extends TypeImmunityAbAttr, dispatched as the move-immunity check).
// It overrides only `apply`; `canApply` is the parent's, four feasibility clauses and NO condition and NO constructor closure, so
// there is nothing to bind:
//   1. the move's target is not BOTH_SIDES, ENEMY_SIDE or USER_SIDE
//   2. the attacker is not the holder itself
//   3. the immune type is not null
//   4. `getTriggeredMoveTypes(pokemon, attacker, move)` includes the immune type (the move's type after ability changes, plus any
//      extra types the engine says the move triggers)
// (The parent TypeImmunityAbAttr does not exclude status moves, unlike AttackTypeImmunityAbAttr, so Thunder Wave is absorbed too.)
//
// apply, original order:
//   a. `super.apply(params)`: `typeMultiplier.value = 0`                            = branch "Block the move" (effect.immune-to-type)
//   b. `if (!simulated && getCharge(pokemon) < CHARGE_STACK_MAX) addCharge(pokemon)`  = branch "Gain a charge stack" (no library effect)
// At the maximum number of stacks, or in a preview, the move is still blocked but no stack is added.
// Class edit (pure move of code): the constructor takes `(immuneType = ELECTRIC, stacks = 1)` and passes the type to the parent; the
// attr count, the order and the class name are unchanged.
import { CapacitorBankAbsorbAbAttr } from "#data/elite-redux/abilities/electivire";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";
import { enumCodec } from "#data/elite-redux/ability-studio/param-codecs";
import { TYPE_OPTIONS } from "#data/elite-redux/ability-studio/vocabulary/enums";
import { PokemonType } from "#enums/pokemon-type";

export default defineDecl(CapacitorBankAbsorbAbAttr, {
  tier: "A",
  kind: "calc-modifier",
  when: "calc.move-immunity",
  label: "Absorb a type of move and gain a charge stack",
  summary: params =>
    `Moves of the ${params.type} type do nothing to me, and each one I absorb gives me ${params.stacks} charge stack (at most 4 in total). Example: absorb Electric moves, +1 stack.`,
  synonyms: [
    "absorb and charge",
    "lightning rod charge",
    "volt absorb charge",
    "capacitor bank",
    "immune and gain a stack",
    "soak up electricity",
    "store a type of move",
  ],
  examples: ["Immune to Electric moves, and every one I absorb adds a charge stack, like Capacitor Bank"],
  params: [
    {
      id: "type",
      ctorIndex: 0,
      path: "immuneType",
      control: "select",
      label: "Immune to this type",
      editable: true,
      default: "ELECTRIC",
      options: TYPE_OPTIONS,
      codec: enumCodec(PokemonType, "type"),
    },
    {
      id: "stacks",
      ctorIndex: 1,
      path: "stacks",
      control: "number",
      min: 1,
      max: 4,
      step: 1,
      integer: true,
      label: "Charge stacks gained per absorbed move (1-4)",
      editable: true,
      default: 1,
    },
  ],
  conditions: [],
  guards: [],
  feasibility: [
    "Moves that hit every Pokemon or a whole side (Spikes, Rain Dance) are never blocked",
    "A Pokemon never blocks its own move",
    "The stack is only added while I hold fewer than the maximum number of stacks (4) and the move is really used (not when the game only previews it)",
  ],
  branches: [
    {
      label: "Block the move",
      conditions: [],
      effect: { id: "effect.immune-to-type", params: ["type"] },
    },
    {
      label: "Gain charge stacks",
      conditions: ["I hold fewer than the maximum number of stacks"],
      effect: { id: "effect.package", params: ["stacks"] },
    },
  ],
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "battle", simulated: "respects" },
  probes: [
    {
      name: "an Electric move, a neutral move, a Ground move and a status Electric move",
      axes: { foeMove: ["THUNDER_SHOCK", "TACKLE", "MUD_SLAP", "THUNDER_WAVE"] },
    },
  ],
  status: "decomposed",
  notes:
    "Tier A calc-modifier, two branches: the immunity is the library immune-to-type; the stack is a part that works as one piece because no library effect writes the charge counter (request R-B14-6.1; the 'fewer than the maximum' test is the atom of R-B14-6.2). Users (1): Capacitor Bank (5925) attr 1 (attr 0 gains a stack when I am hit, attr 2 is the Lightning-Rod style redirect of another batch). No constructor closure and no condition, so no binding. The class inherits the parent's canApply unchanged. The attr does not check `simulated` in canApply, so a preview still reports the immunity; only the stack is skipped. Oddity, not fixed: unlike the Attack type immunity, status moves of the type are absorbed too and also give a stack. The maximum of 4 stacks is a module constant of the charge store.",
});

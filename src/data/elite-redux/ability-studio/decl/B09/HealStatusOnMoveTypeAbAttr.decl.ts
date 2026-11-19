/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";
import { enumCodec } from "#data/elite-redux/ability-studio/param-codecs";
import { TYPE_OPTIONS } from "#data/elite-redux/ability-studio/vocabulary/enums";
// B09 chunk 3. "After I use a move of one type, my status condition is cured" (Vital Spirit's ER Fighting clause).
//
// Source: src/data/elite-redux/archetypes/heal-status-on-move-type.ts, class HealStatusOnMoveTypeAbAttr (extends PostAttackAbAttr).
// Dispatched after the holder's attack connects (`applyAbAttrs("PostAttackAbAttr")` in MoveEffectPhase).
// Clauses of the original canApply, in order:
//   1. `super.canApply(params)`: the PostAttack default attack condition `move.category !== STATUS` (the constructor passes none)
//                                                                                          -> gate (IF: move.damaging)
//   2. `pokemon.getMoveType(move) === this.moveType`   the move's EFFECTIVE type (-ate abilities and the like count)
//                                                                                          -> gate (IF: move.type, effective)
//   3. `!!pokemon.status && effect !== NONE && effect !== FAINT`   there is a curable status          -> residual (feasibility)
// apply: simulated -> nothing; otherwise `pokemon.resetStatus(false, false, false, false)` right away, `updateInfo()`, and the
// status-heal message. No random draw, no state.
// Constructor: (moveType). Tier B: gate = clauses 1 and 2, residual = clause 3, no guards. Clause 1 is a rule players know
// ("damaging moves only"), so it belongs to the gate that staff may change.
import { HealStatusOnMoveTypeAbAttr } from "#data/elite-redux/archetypes/heal-status-on-move-type";
import { PokemonType } from "#enums/pokemon-type";

export default defineDecl(HealStatusOnMoveTypeAbAttr, {
  tier: "B",
  kind: "event-effect",
  when: "event.after-my-hit",
  label: "Cure my status after I use a move of one type",
  summary: params =>
    `After I use a damaging ${params.moveType}-type move, any status condition I have is cured right away. Example: Fighting moves cure my burn, poison or paralysis.`,
  synonyms: [
    "vital spirit",
    "cure status on attack",
    "heal status after move",
    "cleanse by attacking",
    "remove burn when i attack",
    "status wipe",
  ],
  examples: ["Cure my status after I use a Fighting move, like Vital Spirit in Elite Redux"],
  params: [
    {
      id: "moveType",
      ctorIndex: 0,
      path: "moveType",
      control: "select",
      label: "Type of move that cures me",
      editable: true,
      default: "FIGHTING",
      options: TYPE_OPTIONS,
      codec: enumCodec(PokemonType, "type"),
    },
  ],
  conditions: [
    // The gate: "the move is damaging and its effective type is the chosen one". Vital Spirit's binding is in bindings.ts.
    { slot: "gate", ctx: "params", removable: true, editable: true },
  ],
  // The chosen type is repeated as a literal inside the gate binding's move.type atom.
  gateParams: [{ param: "moveType", block: "move.type", field: "type" }],
  guards: [],
  feasibility: ["I must have a status condition to cure (not fainted)", "Does nothing in a simulated preview"],
  effect: { id: "effect.cure-status", params: [] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "none", simulated: "respects" },
  probes: [
    {
      name: "my attack while I have no status, a burn and a poison",
      axes: { status: ["NONE", "BURN", "POISON"] },
    },
  ],
  status: "decomposed",
  notes:
    "Tier B, 1 attr: Vital Spirit (72 attr 3, pushed by init-elite-redux-vanilla-rebalance.ts:721 after the vanilla sleep-immunity attrs). The default attack condition `move.category !== STATUS` is read from the parent's field, so the gate calls super.canApply exactly as before and the binding spells it as move.damaging (the same test). The type test uses getMoveType, the same call as the move.type atom with 'use the type after ability changes' on. The cure is effect.cure-status for 'any status' on the holder, but the class resets the status with resetStatus(false, false, false, false) and a custom message, so the effect stays inside the class. Oddity, not fixed: the cure also removes a status that the move itself just inflicted on the holder as a side effect (for example a recoil burn would be cured), and the heal message is queued as a normal message.",
});

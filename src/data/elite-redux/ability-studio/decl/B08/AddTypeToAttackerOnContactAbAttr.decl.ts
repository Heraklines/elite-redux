/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B08 / event-effect, Tier B (gate in canApply). Read from the source:
//
//   original canApply, in order:
//     1. move.doesFlagEffectApply({ MAKES_CONTACT, user: attacker, target: holder })   <- the GATE (a condition: a rule
//        staff may change, for example to "any hit")
//     2. !attacker.isTerastallized && !attacker.isOfType(addedType)                    <- RESIDUAL (feasibility: the
//        type could not be added anyway)
//   apply: returns when simulated; otherwise attacker.summonData.addedType = addedType, updateInfo(), queue the
//   "addType" message (the same mechanism as Forest's Curse / Trick-or-Treat).
//
// No random draw. The type is the only constructor argument (ctor 0) and is read back through `addedType`.
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";
import { enumCodec } from "#data/elite-redux/ability-studio/param-codecs";
import { TYPE_OPTIONS } from "#data/elite-redux/ability-studio/vocabulary/enums";
import { AddTypeToAttackerOnContactAbAttr } from "#data/elite-redux/archetypes/add-type-to-attacker-on-contact";
import { PokemonType } from "#enums/pokemon-type";

export default defineDecl(AddTypeToAttackerOnContactAbAttr, {
  tier: "B",
  kind: "event-effect",
  when: "event.after-hit",
  label: "Give the attacker an extra type when it touches me",
  summary: params =>
    `When a move that makes contact hits me, the attacker gains the ${params.addedType} type on top of its own. Example: a Normal attacker becomes Normal and ${params.addedType}.`,
  synonyms: [
    "extra type",
    "add a type",
    "forest's curse",
    "grass type on contact",
    "type change on touch",
    "woodland curse",
    "infect type",
  ],
  examples: ["Attackers that touch me gain the Grass type"],
  params: [
    {
      id: "addedType",
      ctorIndex: 0,
      path: "addedType",
      control: "select",
      label: "Type the attacker gains",
      editable: true,
      gateIndependent: true,
      default: "GRASS",
      options: TYPE_OPTIONS,
      codec: enumCodec(PokemonType, "type"),
    },
  ],
  conditions: [
    // The gate is the contact test (move.flag MAKES_CONTACT, which calls doesFlagEffectApply with the attacker as the user).
    { slot: "gate", ctx: "params", lib: "move.flag", removable: true, editable: true },
  ],
  guards: [],
  feasibility: [
    "Does nothing to an attacker that is Terastallized",
    "Does nothing when the attacker already has that type",
  ],
  effect: { id: "effect.package", params: ["addedType"] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "none", simulated: "respects" },
  probes: [
    {
      // A contact move and a non-contact move; the type is added only for the contact one.
      name: "contact and non-contact hit",
      axes: { foeMove: ["TACKLE", "WATER_GUN"] },
    },
  ],
  status: "decomposed",
  notes:
    "Tier B split by hand: canApply = gate (contact) && residual (not Terastallized, does not have the type), a pure move of the two original clauses in their original order. The library has no 'add a type to the attacker' effect yet, so the effect is `effect.package` (request R-B08-4). User: Woodland Curse (5508, attr 1), whose gate is bound as move.flag MAKES_CONTACT. `simulated`: apply returns early; canApply is pure.",
});

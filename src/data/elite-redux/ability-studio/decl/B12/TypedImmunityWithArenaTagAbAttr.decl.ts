/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B12 chunk 4. "Damaging moves of one type do nothing to me, and a field effect appears on my side" (Evaporate: Water, Mist for 5 turns).
//
// Source: src/data/elite-redux/archetypes/typed-immunity-with-arena-tag.ts, TypedImmunityWithArenaTagAbAttr (extends TypeImmunityAbAttr).
// Constructor: one options object `{ immuneType, arenaTag, turns }`; it calls `super(immuneType)` so the parent's condition is null. It MUST extend
// TypeImmunityAbAttr because the damage code collects immunities by that class. Dispatched while the game checks whether a move can hit
// (applyAbAttrs("TypeImmunityAbAttr")). Clauses, in the original order (Tier B):
//   canApply 1  the move is an attack move (`move.is("AttackMove")`)                                          GATE (replaceable)
//   canApply 2  `super.canApply`: the move does not target both sides, the enemy side or the user side, the attacker is not me, and the
//               move's type (as triggered) is the immune type                                                   RESIDUAL (feasibility kept in the class)
//   apply 1     `typeMultiplier = 0` (parent)                                                                   EFFECT (immunity)
//   apply 2     `simulated` -> stop                                                                              respects the preview flag
//   apply 3     add the field effect for `turns` turns on MY side (`arena.addTag`, source my id)                EFFECT (field effect)
// No random draw, no state.
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";
import { enumCodec } from "#data/elite-redux/ability-studio/param-codecs";
import { TYPE_OPTIONS } from "#data/elite-redux/ability-studio/vocabulary/enums";
import { TypedImmunityWithArenaTagAbAttr } from "#data/elite-redux/archetypes/typed-immunity-with-arena-tag";
import { PokemonType } from "#enums/pokemon-type";

const IN_OPTIONS = { ctorIndex: 0 } as const;

/** The field effects that lie on one side and are worth offering (Evaporate sets Mist). */
const SIDE_FIELD_EFFECTS = ["MIST", "SAFEGUARD", "REFLECT", "LIGHT_SCREEN", "AURORA_VEIL", "TAILWIND"] as const;

export default defineDecl(TypedImmunityWithArenaTagAbAttr, {
  tier: "B",
  kind: "calc-modifier",
  when: "calc.move-immunity",
  label: "Block one move type and set a field effect on my side",
  summary: params =>
    `Damaging ${params.type} moves do nothing to me, and ${params.arenaTag} appears on my side for ${params.turns} turns. Example: Water, Mist, 5 turns, like Evaporate.`,
  synonyms: [
    "immune and set mist",
    "absorb and field effect",
    "evaporate",
    "water immunity with mist",
    "immunity that sets a screen",
    "block a type and protect my side",
  ],
  examples: [
    "Water moves do nothing to me and Mist appears on my side for 5 turns, like Evaporate",
    "Fire moves do nothing to me and Light Screen appears on my side for 5 turns",
  ],
  params: [
    {
      id: "type",
      ...IN_OPTIONS,
      ctorOption: "immuneType",
      path: "immuneType",
      control: "select",
      label: "Move type that does nothing to me",
      editable: true,
      // Only the immunity rule (kept in the class) reads it; the gate (an attack move) never repeats it.
      gateIndependent: true,
      default: "WATER",
      options: TYPE_OPTIONS,
      codec: enumCodec(PokemonType, "type"),
    },
    {
      id: "arenaTag",
      ...IN_OPTIONS,
      ctorOption: "arenaTag",
      path: "arenaTag",
      control: "select",
      label: "Field effect that appears on my side",
      editable: true,
      gateIndependent: true,
      default: "MIST",
      options: SIDE_FIELD_EFFECTS,
    },
    {
      id: "turns",
      ...IN_OPTIONS,
      ctorOption: "turns",
      path: "tagTurns",
      control: "number",
      min: 1,
      max: 8,
      step: 1,
      integer: true,
      label: "Turns the field effect lasts (5 = five turns)",
      editable: true,
      gateIndependent: true,
      default: 5,
    },
  ],
  conditions: [
    // The gate: only damaging moves ("Takes no damage ... if hit by water"): the class asks move.is("AttackMove"), which is NOT the same set of moves as the
    // library atom "the move deals damage" (category is not Status): nine moves differ (R-B12-35), so the user stays legacy.
    { slot: "gate", ctx: "params", removable: true, editable: true },
  ],
  guards: [],
  feasibility: [
    "Moves that hit every Pokemon or a whole side (Spikes, Rain Dance) are never blocked",
    "A Pokemon never blocks its own move",
    "The move's type is read after other abilities have changed it",
    "Nothing is set when the game only previews the move",
  ],
  // The immunity is the library effect; setting a field effect on my side is the second effect (the library block exists as a plan only, R-B12-34), kept as typed settings of this block.
  effect: { id: "effect.immune-to-type", params: ["type", "arenaTag", "turns"] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "none", simulated: "respects" },
  probes: [
    {
      name: "a move of the type, a neutral move, a status move of the type",
      axes: { foeMove: ["WATER_GUN", "TACKLE", "EMBER", "SURF"] },
    },
  ],
  status: "decomposed",
  notes:
    "Tier B, 1 attr: Evaporate (5180 attr 0, Water, Mist, 5 turns; attr 1 of the same ability is a self-drop immunity with an own-side Mist condition, a separate block). The old canApply `move.is('AttackMove') && super.canApply(params)` is split in that order into `gate` (the attack-move test) and `residual` (the parent's immunity rule); the immune type is read by the residual, so it is not part of the gate. The gate binding is a legacy-closure for two reasons, both proven by B12/chunk4.test.ts: (1) the type-immunity moment gives the library no move user (request R-B12-30: WHEN_MOVE_USER has no entry for calc.move-immunity), so move.damaging reads false for every move there; (2) even with a move user, the class test move.is('AttackMove') is not the atom's 'category is not Status': nine moves whose category is not Status are still status-class moves (Captivate, Decorate, Flash, Growl, Nightmare, Octolock, Poison Gas, Splash, Whirlwind), so a library atom for the class test is needed (request R-B12-35); none of the nine is a Water move, so Evaporate itself is not affected today. Oddities, not fixed: (a) a status move of the type (Soak) is NOT blocked, the gate refuses it, unlike TypeImmunityHighestAttackStatStageAbAttr which has no such gate; (b) the field effect is set on EVERY blocked hit, so a second Water move refreshes it (addTag decides what happens to an existing tag); (c) when the game previews a move nothing is set; (d) the side is chosen by isPlayer() on the holder.",
});

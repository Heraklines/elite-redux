/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { percentCodec } from "#data/elite-redux/ability-studio/decl/B09/chunk4-codecs";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";
import { enumCodec } from "#data/elite-redux/ability-studio/param-codecs";
import { TYPE_OPTIONS } from "#data/elite-redux/ability-studio/vocabulary/enums";
import { TypeAbsorbHealAbAttr } from "#data/elite-redux/archetypes/immunity-with-absorb";
import { PokemonType } from "#enums/pokemon-type";

// B09 chunk 4. "Moves of one type do nothing to me and heal me instead" (Poison Absorb, Ice Plumes; the Water Absorb idea with a
// setting for how much).
//
// Source: src/data/elite-redux/archetypes/immunity-with-absorb.ts, class TypeAbsorbHealAbAttr (extends TypeImmunityHealAbAttr,
// which extends TypeImmunityAbAttr, ab-attrs.ts:458-532). Dispatched while the game checks whether a move can hit the holder
// (`applyAbAttrs("TypeImmunityAbAttr", ...)` from Pokemon.apply / getAttackMoveEffectiveness).
// Clauses, in order:
//   canApply  (TypeImmunityAbAttr, NOT the attack-only AttackTypeImmunityAbAttr): the move does not target a whole side or the
//             field (BOTH_SIDES, ENEMY_SIDE, USER_SIDE), the attacker is not the holder, and the move's triggered types (its
//             type after type-changing abilities) include the chosen type. There is NO status-move exclusion.   -> the immunity itself
//   apply     typeMultiplier = 0; then, only when the holder is not at full HP and the call is not simulated: queue a heal of
//             toDmgValue(maxHp * healFraction) (message null) and set `cancelled` so "no effect" is not shown.   -> effect
// Constructor: ({ type, healFraction }), one options object; healFraction defaults to 1/4 and must be in (0, 1], otherwise it
// throws. It passes no condition closure to the parent, so the inherited `condition` is always null.
// Tier A: nothing to bind. The type test is the class's own immunity (the same one the "immune to a type" block has), so it is a
// setting, not a gate. No random draw, no state.
export default defineDecl(TypeAbsorbHealAbAttr, {
  tier: "A",
  kind: "calc-modifier",
  when: "calc.move-immunity",
  label: "Be immune to a type and heal when hit by it",
  summary: params =>
    `Moves of the ${params.type} type cannot hurt me; instead I heal ${params.healPercent}% of my max HP (nothing if I am already at full HP). Example: Poison, 25 = like Poison Absorb.`,
  synonyms: [
    "water absorb",
    "volt absorb",
    "poison absorb",
    "absorb a type",
    "heal from a move type",
    "immune and heal",
    "drain a type",
    "ice plumes",
  ],
  examples: [
    "Immune to Poison moves and heal a quarter of my max HP when hit by one, like Poison Absorb",
    "Immune to Water moves and heal 50% of my max HP",
  ],
  params: [
    {
      id: "type",
      ctorIndex: 0,
      ctorOption: "type",
      path: "immuneType",
      control: "select",
      label: "Immune to moves of this type",
      editable: true,
      default: "WATER",
      options: TYPE_OPTIONS,
      codec: enumCodec(PokemonType, "type"),
    },
    {
      id: "healPercent",
      ctorIndex: 0,
      ctorOption: "healFraction",
      path: "healFraction",
      control: "number",
      label: "Heal this share of my max HP (% of max HP, 25 = a quarter)",
      editable: true,
      min: 1,
      max: 100,
      step: 0.5,
      default: 25,
      codec: percentCodec,
    },
  ],
  conditions: [],
  guards: [],
  feasibility: [
    "Moves that hit a whole side or the whole field (Spikes, Rain Dance) and my own moves are never blocked",
    "Status moves of the chosen type are blocked too (unlike a plain type immunity)",
    "The heal only happens when I am not at full HP; at full HP the move is still blocked but shows the usual no-effect message",
  ],
  effect: { id: "effect.immune-to-type", params: ["type", "healPercent"] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "none", simulated: "respects" },
  probes: [
    {
      name: "full HP and one HP below full (the heal only happens below full), a move of each user's type and a neutral move",
      axes: { hp: ["max-1", "max"], foeMove: ["SLUDGE_BOMB", "ROCK_THROW", "TACKLE"] },
    },
  ],
  status: "decomposed",
  notes:
    "Tier A calc-modifier, 2 attrs: Poison Absorb (5082 attr 1, Poison, 25%) and Ice Plumes (5571 attr 2, Rock, 25%). Nothing is bound: no closure, and the parent's `condition` is null for both. The immunity half is the same mechanism as AttackTypeImmunityAbAttr; the heal half has no library effect, so effect.immune-to-type names both settings and request R-B09-29 asks for one 'absorb' effect (immune, then heal or change a stat). Oddities, not fixed: (a) the heal phase gets a null message, whereas vanilla Water Absorb (TypeImmunityHealAbAttr) shows its own text; (b) unlike AttackTypeImmunityAbAttr there is no status-move exclusion, so a status move of the chosen type is also blocked (fine for the two users, but not what a staff member copying the Levitate block would expect); (c) the type test is made with getTriggeredMoveTypes, so abilities that change a move's type (Pixilate and friends) decide whether the immunity applies. Engine coupling: other code reads TypeImmunityAbAttr.getImmuneType() by instanceof, which a rebuilt attr keeps because it is built by the same constructor.",
});

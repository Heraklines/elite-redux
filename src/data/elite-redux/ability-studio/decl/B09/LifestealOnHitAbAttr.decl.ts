/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import {
  lifestealFilterCodec,
  NO_LIFESTEAL_FILTER_TEXT,
  optionalPercentCodec,
  percentCodec,
} from "#data/elite-redux/ability-studio/decl/B09/chunk4-codecs";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";
import { enumListCodec } from "#data/elite-redux/ability-studio/param-codecs";
import { TYPE_OPTIONS } from "#data/elite-redux/ability-studio/vocabulary/enums";
import { LifestealOnHitAbAttr } from "#data/elite-redux/archetypes/lifesteal";
import { PokemonType } from "#enums/pokemon-type";

// B09 chunk 4. "I heal a share of the damage my attacks deal" (Energy Siphon, Energy Tap, Nosferatu, Hydro Circuit's Water part,
// Pure Love, Vitality Strike, Twin Lion Fists, Energy Horns).
//
// Source: src/data/elite-redux/archetypes/lifesteal.ts, class LifestealOnHitAbAttr (extends PostAttackAbAttr, ab-attrs.ts:2196).
// Dispatched after the holder's attack lands (`applyAbAttrs("PostAttackAbAttr", { pokemon, opponent, move, damage, hitResult,
// simulated })`). Clauses of the old canApply, in order (the parent's `attackCondition` closure, then the damage test):
//   1. `move.category !== STATUS`                                                              -> guards()   (a status move deals no damage)
//   2. `target !== null`                                                                       -> guards()   (pokerogue's nullable signature)
//   3. `filter.targetTag !== undefined && target.getTag(targetTag) === undefined` -> false     -> gate (IF)    Pure Love: target infatuated
//   4. `matchesFilter(filter, user, move)`: (type set -> `user.getMoveType(move) === type`) AND (flag set ->
//      `move.hasFlag(flag)`, the PRINTED property, no ability injection); an empty filter matches every move -> gate (IF)
//   5. `params.damage > 0`                                                                     -> residual   (no heal from a 0-damage hit)
// apply: skipped when simulated; `fraction` = the bonus share when the target has one of `boostedTargetTypes`, otherwise the normal
// share; heal = toDmgValue(damage * fraction), nothing when it rounds to 0; paid through applyAbilityDrainRecovery, which turns the
// heal into damage to the holder when the TARGET has Liquid Ooze (ReverseDrainAbAttr). No random draw, no state.
// Constructor: ({ healFraction, filter, boostedTargetTypes, boostedHealFraction }), one options object; throws unless healFraction is
// in (0, 1], when a NONE flag is given, and when a bonus share is given without bonus types or outside (0, 1].
// Tier B: guards = 1-2, gate = 3-4, residual = 5 (clause order kept; none of them draws a random number).
//
// The filter is ONE nested object, so it is one param with a text codec (chunk4-codecs.ts); it is not editable because it decides
// the SHAPE of the gate (which atoms), and staff change the move test through the gate condition.
export default defineDecl(LifestealOnHitAbAttr, {
  tier: "B",
  kind: "event-effect",
  when: "event.after-my-hit",
  label: "Heal a share of the damage my attacks deal",
  summary: params =>
    `After my damaging attack lands, I heal ${params.healPercent}% of the damage it dealt. Example: 25 = a quarter of the damage, like Energy Siphon. A foe with Liquid Ooze hurts me instead.`,
  synonyms: [
    "lifesteal",
    "drain",
    "vampire",
    "leech",
    "heal from damage",
    "energy siphon",
    "energy tap",
    "nosferatu",
    "absorb health",
  ],
  examples: [
    "Heal a quarter of the damage I deal, like Energy Siphon",
    "Heal 12.5% of the damage dealt by my contact moves",
    "Heal a quarter of the damage my Water moves deal, like Hydro Circuit",
  ],
  params: [
    {
      id: "healPercent",
      ctorIndex: 0,
      ctorOption: "healFraction",
      path: "hitHealFraction",
      control: "number",
      label: "Heal this share of the damage dealt (% of the damage, 25 = a quarter)",
      editable: true,
      // Only the effect (apply) reads it; the gate never repeats it.
      gateIndependent: true,
      min: 1,
      max: 100,
      step: 0.5,
      default: 25,
      codec: percentCodec,
    },
    {
      id: "filter",
      ctorIndex: 0,
      ctorOption: "filter",
      path: "hitFilter",
      control: "text",
      label: "Which of my moves heal me (set by the move condition)",
      // Decides the SHAPE of the gate (type atom, property atom, target atom or none); staff replace the whole gate instead.
      editable: false,
      default: NO_LIFESTEAL_FILTER_TEXT,
      codec: lifestealFilterCodec,
    },
    {
      id: "bonusTypes",
      ctorIndex: 0,
      ctorOption: "boostedTargetTypes",
      path: "boostedTargetTypes",
      control: "text",
      label: "Foe types that give a bigger heal (comma separated, empty = none; set the bigger share below)",
      editable: true,
      gateIndependent: true,
      default: "",
      options: TYPE_OPTIONS,
      codec: enumListCodec(PokemonType, "type"),
    },
    {
      id: "bonusPercent",
      ctorIndex: 0,
      ctorOption: "boostedHealFraction",
      path: "boostedHealFraction",
      control: "number",
      label: "Bigger heal share against those foe types (% of the damage, 0 = no bigger share)",
      editable: true,
      gateIndependent: true,
      min: 0,
      max: 100,
      step: 0.5,
      default: 0,
      codec: optionalPercentCodec,
    },
  ],
  conditions: [
    // The gate: "the target carries the required battle effect" AND "the move matches the filter". Each user's binding names its
    // own shape (bindings.ts).
    { slot: "gate", ctx: "params", removable: true, editable: true },
  ],
  guards: [],
  feasibility: [
    "Only damaging moves that have a target can heal me; status moves never do",
    "A hit that deals no damage (an immune target, a substitute) heals nothing, and a heal that rounds down to 0 is skipped",
    "If the foe I hit has Liquid Ooze, I take the amount as damage instead of healing it",
    "The heal is a normal heal, so it stops at my max HP and obeys anything that blocks healing",
  ],
  effect: { id: "effect.drain", params: ["healPercent"] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "none", simulated: "respects" },
  probes: [
    {
      // The heal needs room (HP below max) and a damaging move; the move grid of L1 covers types, properties and status moves.
      name: "my attack at full HP and below full HP (the heal needs missing HP; the move grid covers types and properties)",
      axes: { hp: ["max-1", "50%", "max"] },
    },
  ],
  status: "decomposed",
  notes:
    "Tier B. 8 attrs in 8 abilities, healFraction 0.25 for Energy Siphon (5449 attr 0), Hydro Circuit (5159 attr 1, Water moves), Pure Love (5238 attr 2, target infatuated), Vitality Strike (5390 attr 0, punching), Twin Lion Fists (6094 attr 2, punching); 0.5 for Nosferatu (5122 attr 0, contact); 0.125 for Energy Tap (5576 attr 0) and Energy Horns (5452 attr 2, horn). Nobody uses boostedTargetTypes / boostedHealFraction (both settings are exposed so a rebuild keeps them; a 0 bonus share means 'not set' and reaches the constructor as undefined). Gate bindings: always-true for the unfiltered ones, move.type for Hydro Circuit, tag.has on the other Pokemon for Pure Love. Nosferatu, Vitality Strike, Twin Lion Fists and Energy Horns are legacy-closure: the class reads the move's PRINTED property with move.hasFlag, whereas move.flag calls doesFlagEffectApply (which also counts properties other abilities inject and has special contact rules); request R-B09-01 (move.inherent-flag). Engine coupling, not fixed: the closure that the constructor still hands to the parent (attackCondition) is no longer called, because canApply was split; it stays so the constructor contract and the stored field are unchanged, and it must be kept equal to guards plus gate if either is edited. Oddity, not fixed: the heal reads `params.damage`, the damage of the hit that was just dealt, and the dispatch sits in MoveEffectPhase.applyOnTargetEffects, which runs for every hit, so a multi-hit move heals once per hit.",
});

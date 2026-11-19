/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// PRECEDENT: engine-query. See ../PRECEDENTS.md.
//
// FloatAbAttr does nothing by itself: `Pokemon.isGrounded()` asks
//   !hasAbility(AbilityId.LEVITATE) && !hasAbilityWithAttr("FloatAbAttr") && ...
// so the whole effect lives in an ENGINE QUERY ("is this Pokemon grounded?") that reads the ability by identity
// (Levitate) or by presence (this flag). Decomposed attrs cannot reproduce those engine checks, so the class is
// declared `engine-query`: the coverage report counts it apart, class agents never touch the call sites, and the
// foundation's central `abilityQuery(pokemon, "grounded")` sweep owns the routing.
//
// Pair it with AttackTypeImmunityAbAttr(GROUND) for the "Ground moves miss me" half (Hover, Fey Flight, ...); this
// flag additionally lifts the holder off the ground for Spikes, terrain and Arena Trap.
import { FloatAbAttr } from "#abilities/ab-attrs";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";

export default defineDecl(FloatAbAttr, {
  tier: "C",
  kind: "engine-query",
  when: "while.active",
  label: "I float above the ground",
  summary: () => "While I have this, the game treats me as not touching the ground",
  synonyms: ["levitate", "hover", "ungrounded", "airborne", "float", "flying"],
  examples: ["Spikes, terrain and Arena Trap do not affect me"],
  params: [],
  noParamsReason:
    "A presence flag read by the engine query 'grounded' (Pokemon.isGrounded); there is nothing to configure.",
  conditions: [],
  guards: [],
  feasibility: [
    "The engine query 'grounded' decides the final answer: Iron Ball, Air Balloon, Gravity and Ingrain-style grounding tags override it",
  ],
  reusableAlone: { when: true, if: false, do: true },
  flags: { rng: "none", state: "none", simulated: "respects" },
  l2StaticReason:
    "The flag is consulted by Pokemon.isGrounded, which is not a dispatched moment; the twin compares whole battles of the five users instead.",
  probes: [{ name: "a ground move and entry hazards against the holder", axes: {} }],
  status: "verified",
  notes:
    "Precedent for engine-query. Read by Pokemon.isGrounded (src/field/pokemon.ts) via hasAbilityWithAttr('FloatAbAttr'); Levitate itself is read by `hasAbility(AbilityId.LEVITATE)` at the same place and in a few move/terrain conditions, which no attr rebuild can reproduce. Users: Celestial Bow, Dragonfly, Fey Flight, Hover, Witch Broom (each also has an AttackTypeImmunityAbAttr for Ground).",
});

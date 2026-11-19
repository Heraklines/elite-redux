/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B06 chunk 2, Tier C calc-modifier with a plain cancel effect. See ../PRECEDENTS.md.
//
// "While the game checks whether my burn (or frostbite) cuts my damage in half, say no" (Guts, Heatproof, Rage Point, Determination,
// Iron Giant, Thermal Entropy, Droideka). The class has no constructor argument, no closure and no `canApply` of its own: the
// inherited cancel base class answers `!cancelled.value` and `apply` sets `cancelled.value = true`. The engine asks the ATTACKER
// (`pokemon: source`) from the damage calculation in pokemon.ts (two places): for a physical move while the attacker is burned
// (unless the move itself ignores the burn cut), and for a special move while the attacker has ER Frostbite. It is skipped when
// the attacker's ability is being ignored. Nothing to bind.
// WHEN: the engine asks this key, not ReduceBurnDamageAbAttr, so it has its own moment (the shared 'burn damage on me' moment is the
// end-of-turn tick, a different thing).
import { BypassBurnDamageReductionAbAttr } from "#abilities/ab-attrs";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";

export default defineDecl(BypassBurnDamageReductionAbAttr, {
  tier: "C",
  kind: "calc-modifier",
  when: "cancel.burn-attack-cut",
  label: "Keep my attacks at full strength while burned",
  summary: () =>
    "A burn no longer halves my physical attacks, and frostbite no longer halves my special attacks. Example: a burned Pokemon with this deals the same damage as an unburned one.",
  synonyms: [
    "guts",
    "rage point",
    "ignore burn",
    "burn does not weaken attack",
    "no burn attack drop",
    "burn immunity to attack cut",
  ],
  examples: ["A burn does not halve my attack, like Guts"],
  params: [],
  noParamsReason:
    "All or nothing: the class has no constructor argument and cancels the halving whenever the engine asks it.",
  conditions: [],
  guards: [],
  feasibility: [
    "Only matters while I am burned (physical moves) or have frostbite (special moves)",
    "Not used while my ability is being ignored",
    "Does nothing when another effect already cancelled the halving",
  ],
  effect: { id: "effect.negate", params: [] },
  reusableAlone: { when: true, if: false, do: true },
  flags: { rng: "none", state: "none", simulated: "ignores" },
  probes: [{ name: "a burned holder using a physical move, and a special move", axes: { status: ["BURN"] } }],
  status: "decomposed",
  notes:
    "Users (8 attrs in 7 abilities): Guts (62, attr 0), Heatproof (85, attr 2, pushed at init), Determination (5236, attr 1), Iron Giant (5386, attrs 2 and 6: the ability carries the pair twice), Rage Point (5406, attr 4), Thermal Entropy (5711, attr 5) and Droideka (5716, attr 2). The ER archetype dispatcher also builds this class (archetype-dispatcher.ts 1773 together with a full burn immunity, 6431 and 6442 on their own), which is how the ER abilities get it. Simulated: the engine passes `simulated` to the dispatch and the class never reads it; it only sets a local flag, so a preview gives the same answer as a real call and it is recorded as ignoring `simulated`. Engine side: the frostbite half of the halving reads the same attr (the damage calculation in pokemon.ts); that is why the label talks about frostbite too.",
});

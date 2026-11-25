/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { hitFilterCodec, NO_FILTER_TEXT } from "#data/elite-redux/ability-studio/decl/B09/hit-filter-codec";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";
// B09 chunk 3. "Some of my moves hit extra times" (Raging Boxer, Primal Maw, Raging Moth, Hyper Aggressive, Dual Wield and
// 20 more Elite Redux abilities; the Parental Bond family).
//
// Source: src/data/elite-redux/archetypes/hit-multiplier.ts, class HitMultiplierAbAttr (extends AddSecondStrikeAbAttr, which
// extends PreAttackAbAttr). Dispatched once per move, when the first hit starts (`applyAbAttrs("AddSecondStrikeAbAttr")`,
// move-effect-phase.ts:259, params { pokemon, move, hitCount, opponent }).
// Clauses of the original canApply, in order:
//   1. `super.canApply(params)`: `move.canBeMultiStrikeEnhanced(pokemon, true, opponent)`: not a charging move (unless the user
//      skips the charge), not a spread move with several targets, not a status move, not a native multi-hit or sacrificial move,
//      not Fling, Uproar, Rollout, Ice Ball or Endeavor ...                                       -> guards()
//   2. `HitMultiplierAbAttr.matchesFilter(this.filter, pokemon, move)`: (type set  -> `pokemon.getMoveType(move) === type`)
//      AND (flag set -> `move.doesFlagEffectApply({ flag, user: pokemon })`) AND (flagsAny set -> any of them); an empty
//      filter matches every move                                                                  -> gate (IF)
// apply: `hitCount.value += extraStrikes`. No random draw, nothing reads `simulated`, no state.
// Constructor: ({ extraStrikes, filter }), one options object; throws for a non-integer or < 1 extraStrikes and for a NONE flag.
// Tier B: guards = clause 1, gate = clause 2, no prepare, no residual.
//
// The filter is ONE nested object, so it is one param with a text codec (hit-filter-codec.ts); it is not editable because it
// decides the SHAPE of the gate (which atoms), and staff change the move test through the gate condition.
import { HitMultiplierAbAttr } from "#data/elite-redux/archetypes/hit-multiplier";

export default defineDecl(HitMultiplierAbAttr, {
  tier: "B",
  kind: "calc-modifier",
  when: "calc.hit-count",
  label: "Make some of my moves hit extra times",
  summary: params =>
    `My matching damaging moves hit ${params.extraStrikes} extra time(s); 1 means twice in total, like Parental Bond. Charging, status and multi-hit moves are left alone.`,
  synonyms: [
    "parental bond",
    "hit twice",
    "double hit",
    "extra strike",
    "multi hit",
    "second hit",
    "raging boxer",
    "dual wield",
    "hit again",
  ],
  examples: [
    "Punching moves hit twice, like Raging Boxer",
    "Fire moves hit twice, like Raging Moth",
    "Every damaging move hits twice, like Hyper Aggressive",
  ],
  params: [
    {
      id: "extraStrikes",
      ctorIndex: 0,
      ctorOption: "extraStrikes",
      path: "extraStrikes",
      control: "number",
      label: "Extra hits (1 = the move hits twice in total)",
      editable: true,
      // Only the effect (apply) reads it; the gate never repeats it.
      gateIndependent: true,
      integer: true,
      min: 1,
      max: 4,
      step: 1,
      default: 1,
    },
    {
      id: "filter",
      ctorIndex: 0,
      ctorOption: "filter",
      path: "filter",
      control: "text",
      label: "Which moves get the extra hits (set by the move condition)",
      // Decides the SHAPE of the gate (type atom, property atom or none); staff replace the whole gate instead.
      editable: false,
      default: NO_FILTER_TEXT,
      codec: hitFilterCodec,
    },
  ],
  conditions: [
    // The gate: "the move matches the filter". Each user's binding names its own shape (bindings.ts).
    { slot: "gate", ctx: "params", removable: true, editable: true },
  ],
  guards: [],
  feasibility: [
    "The move must be one a multi-hit ability can add hits to: not a status move, a charging move (unless I skip the charge), a move aimed at several foes, a move that already hits many times, or Fling, Uproar, Rollout, Ice Ball and Endeavor",
  ],
  effect: { id: "effect.hit-n-times", params: ["extraStrikes"] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "none", simulated: "ignores" },
  probes: [
    {
      name: "my attack at full HP and one HP below full (the move test does not read HP; the move grid covers types and properties)",
      axes: { hp: ["max", "max-1"] },
    },
  ],
  status: "decomposed",
  notes:
    "Tier B. 31 attrs in 25 abilities. Six of them are a second instance carried by the attr-level condition 'enraged' (Hyper Aggressive, Raging Goddess, Balloon Blitz, Frenzied Phantom, Witch Broom, Ghost Frenzy) and Ice Cold Hunter carries a weather condition; recomposeAttr carries attr-level conditions over, so they are not part of the gate. Gate bindings: one move.flag for a single property (Raging Boxer, Steel Beetle, Formless Fist, Twin Lion Fists: Punching; Primal Maw, Devourer, Dogged Jaw, Metallic Jaws, World-Eater: Biting; Magus Blades: Slicing; Jackhammer: Hammer; Grievous Spear, Savage Spear: Horn), move.type for Raging Moth (Fire) and Ice Cold Hunter (Ice), an any of two move.flag for Flurry (Kicking or Arrow), an always-true gate for the unfiltered ones. Dual Wield, Minigun and Two-Chambered are legacy-closure: their filter is ONE combined mask (Pulse | Slicing) tested with a single doesFlagEffectApply call, and two move.flag atoms would differ when a flag injector (Rapier turns horn into slicing) is on the holder (request R-B09-12). The single-property bindings are exact because doesFlagEffectApply only reads the target for the contact and ignore-abilities flags, which no user filters on (the other special cases read the user only). Subclasses StarHitMultiplierAbAttr and ContaminatedHitMultiplierAbAttr (B16, B17) call super.canApply, so they keep working and need their own declarations. Engine coupling, not fixed: move.ts:8118 (the flinch rule of the first strike) reads `getFilter()` of every HitMultiplierAbAttr on the user, so a staff gate that differs from the class filter would change the hits but not that flinch rule (request R-B09-13). Merge note: if B01-B07 give AddSecondStrikeAbAttr its own guards or gate members, this class needs the `override` keyword on them.",
});

/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";
import { MovingFirstTrapFlinchAbAttr } from "#data/elite-redux/archetypes/moving-first-trap-flinch";
// B09 chunk 5. "When I move first, my attack traps the foe and may make it flinch" (From the Shadows).
//
// Source: src/data/elite-redux/archetypes/moving-first-trap-flinch.ts, class MovingFirstTrapFlinchAbAttr (extends PostAttackAbAttr,
// so showAbility is the default true). Dispatched after one of my hits resolves (`applyAbAttrs("PostAttackAbAttr")`), once per
// strike of a multi-hit move.
// Clauses of the original canApply, in order (now guards && gate, no prepare, no residual):
//   1. `super.canApply(params)`: the parent's attack condition, the default is "the move is not a status move"      -> guards()
//   2. `hitResult < HitResult.NO_EFFECT`: the hit was not negated (an immune or missed target does not count)     -> guards()
//   3. `!!target`: a target exists                                                                                 -> guards()
//   4. `!target.turnData.acted`: the foe has not acted yet this turn, i.e. I moved first                           -> gate (IF)
// apply (the effect):
//   - `simulated` or no target -> nothing.
//   - `target.addTag(TRAPPED, trapTurns, undefined, pokemon.id)` on EVERY moving-first strike, always.
//   - then `firstHit = pokemon.turnData.hitCount === pokemon.turnData.hitsLeft`; only on the first strike
//     `pokemon.randBattleSeedInt(100) < flinchChance` is DRAWN (draw 1, in apply, after the trap) and a hit adds
//     `addTag(FLINCHED, 1, undefined, pokemon.id)`. A later strike draws nothing.
// Constructor: (flinchChance = 20, trapTurns = 4). From the Shadows uses the first only: (20).
// Tier B: guards = clauses 1-3, gate = clause 4, no prepare, no residual. The gate holds no random draw; the only draw sits in apply.
// The gate is the library atom time.acted on the OTHER Pokemon (`other.turnData?.acted ?? false`, the opponent of my hit), negated:
// the same field the class reads.
export default defineDecl(MovingFirstTrapFlinchAbAttr, {
  tier: "B",
  kind: "event-effect",
  when: "event.after-my-hit",
  label: "Trap the foe and maybe flinch it when I move first",
  summary: params =>
    `When my damaging attack hits a foe that has not moved yet this turn, the foe is trapped for ${params.trapTurns} turns. On the first hit of the move there is also a ${params.flinchChance}% chance to make it flinch.`,
  synonyms: [
    "from the shadows",
    "trap and flinch",
    "move first trap",
    "first strike trap",
    "cannot escape",
    "no switching",
    "flinch chance",
    "first attack flinch",
    "ambush",
  ],
  examples: [
    "My attack traps the foe and has a 20% flinch chance when I move first, like From the Shadows",
    "Trap the foe for 4 turns when I hit it before it moves",
  ],
  params: [
    {
      id: "flinchChance",
      ctorIndex: 0,
      path: "flinchChance",
      control: "slider",
      label: "Chance to flinch the foe (%, only on the first hit of the move)",
      editable: true,
      // Only the effect (apply) reads it; the gate never repeats it.
      gateIndependent: true,
      integer: true,
      min: 0,
      max: 100,
      step: 1,
      default: 20,
    },
    {
      id: "trapTurns",
      ctorIndex: 1,
      path: "trapTurns",
      control: "number",
      label: "Turns the foe stays trapped (1-8)",
      editable: true,
      // Only the effect (apply) reads it; the gate never repeats it.
      gateIndependent: true,
      integer: true,
      min: 1,
      max: 8,
      step: 1,
      default: 4,
    },
  ],
  conditions: [
    // The gate: "the foe has not moved yet this turn". The binding in bindings.ts spells it out.
    { slot: "gate", ctx: "params", removable: true, editable: true },
  ],
  guards: [],
  feasibility: [
    "Only damaging moves count, the hit must not be negated (a foe that is immune or avoided it), and there must be a target",
    "The trap is added on every hit of a multi-hit move; the flinch roll happens only on the first hit",
    "Does nothing in a simulated preview",
  ],
  effect: { id: "effect.apply-tag", params: ["trapTurns", "flinchChance"] },
  reusableAlone: { when: true, if: true, do: true },
  flags: {
    rng: "apply",
    rngOrder: [
      "apply: after the trap is added, only on the first strike of the move and only when not simulated: one roll of 0-99 against the flinch chance",
    ],
    state: "none",
    simulated: "respects",
  },
  probes: [
    {
      name: "my attack against a foe that uses a status move, a physical and a special move (the foe acts first or after me); the foe-acted flag is set by the grid",
      axes: { foeMove: ["TACKLE", "WATER_GUN"] },
    },
  ],
  status: "decomposed",
  notes:
    "Tier B, 1 attr: From the Shadows (5405 attr 0, flinchChance 20, trapTurns 4 by default). The gate binding is not (time.acted other). Verified by B09/chunk5.test.ts in both foe-acted cases, for the first-strike rule (the draw happens only when hitCount equals hitsLeft, after the trap tag) and for the order of the trap tag and the draw. Pure move of code from the old canApply (guards then gate, same short circuit; the guards never touch turnData, so a missing target stops before the gate reads it). Effect word: effect.apply-tag only describes the trap; the flinch roll is part of this block (request R-B09-37 asks for an effect 'Trap the foe and sometimes flinch it'). Oddity, not fixed: the flinch rule says 'first strike' by comparing hitCount with hitsLeft, so a spread move that hits several foes rolls once per foe on the first strike.",
});

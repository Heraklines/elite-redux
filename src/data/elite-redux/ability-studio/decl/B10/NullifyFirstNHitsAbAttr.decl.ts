/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";
// B10 / calc-modifier (Tier C, memory inside the class).
//
// Read by hand from archetypes/nullify-first-n-hits.ts. The class extends ReceivedMoveDamageMultiplierAbAttr (so it is
// dispatched with the "damage I take" moment) but passes `() => true` and a multiplier of 0 to the parent and then
// OVERRIDES canApply and apply, so the parent's closure and multiplier are dead:
//     canApply: damage.value > 0  &&  used(pokemon) < n
//     apply:    simulated -> damage 0 and mark it nullified, NO charge used
//               real      -> usage.used++, damage 0, mark it nullified
// `used` is per Pokemon and per BATTLE: a WeakMap<Pokemon, {battle, used}> held by the instance, refreshed when
// `battleKey()` (globalScene.currentBattle) changes, so party members get fresh charges in the next wave.
//
// Clause classification: `used < n` is the identity of the ability, so it is the param `n` plus the class's own
// memory; `damage.value > 0` is feasibility (a hit that already does nothing does not burn a charge). No random draw.
// The second constructor argument (`battleKey`) is a test seam with a fixed default, so it is not exposed.
// Nothing to bind: the parent's closure slot is not a constructor argument of this class, and the attr has no
// condition of its own.
import { NullifyFirstNHitsAbAttr } from "#data/elite-redux/archetypes/nullify-first-n-hits";

export default defineDecl(NullifyFirstNHitsAbAttr, {
  tier: "C",
  kind: "calc-modifier",
  when: "calc.damage-taken",
  label: "Take no damage from the first few hits each battle",
  summary: params =>
    `The first ${params.n} hits that would damage me in each battle do 0 damage. The moves still connect and their extra effects still happen. Example: 2 = the first two hits.`,
  synonyms: [
    "cheating death",
    "gallantry",
    "free hits",
    "ignore the first hit",
    "first hit does nothing",
    "damage shield",
    "negate the first hits",
  ],
  examples: ["The first two hits I take each battle do no damage, like Cheating Death"],
  params: [
    {
      id: "n",
      ctorIndex: 0,
      path: "n",
      control: "number",
      min: 1,
      max: 10,
      step: 1,
      integer: true,
      label: "Number of hits to cancel in each battle (1 = only the first hit)",
      editable: true,
      default: 2,
    },
  ],
  // Argument 1 is the battle lookup (a test seam); leaving it out keeps the default "current battle".
  fixedCtorArgs: { 1: undefined },
  conditions: [],
  guards: [],
  feasibility: [
    "Only a hit that would really do damage uses up one of the free hits",
    "A preview of the damage shows 0 but does not use up a free hit",
    "The free hits are counted per Pokemon and come back at the start of every new battle",
  ],
  effect: { id: "effect.package", params: ["n"] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "battle", simulated: "respects" },
  probes: [{ name: "a foe hits me again and again", axes: { foeMove: ["TACKLE", "WATER_GUN"] } }],
  status: "decomposed",
  notes:
    "Package (Works as one piece), justified: the per-battle charge counter (WeakMap keyed by Pokemon and battle) lives in the class and the library has no counted-charges memory atom or 'set damage to 0' effect that marks damage as nullified (requests R-B10-01 and R-B10-02 in requests/B10.md). Tier C: extra IFs can be ANDed on top (the dispatcher honours attr-level conditions). Users: Cheating Death (n = 2) and Gallantry (n = 1), nothing to bind. Oddity, not fixed: the parent's constructor arguments (a closure that is always true and multiplier 0) are never read, because canApply and apply are both overridden. Own memory test: test/tests/elite-redux/decomp/B10/nullify-first-n-hits.test.ts.",
});

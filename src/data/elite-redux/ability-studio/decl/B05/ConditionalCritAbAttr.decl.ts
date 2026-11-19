/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B05 / calc modifier, Tier A (the condition is the constructor closure). See ../PRECEDENTS.md.
//
// `Pokemon.getCriticalHitResult` (pokemon.ts:6438): the ATTACKER's abilities are asked with
// `{ pokemon: source, isCritical: alwaysCrit, target: this, move }`, `alwaysCrit` being the "this hit is guaranteed to
// crit" holder.
//   canApply  !isCritical.value && this.condition(pokemon, target, move)
//             1. `!isCritical.value`  feasibility: an earlier source already guaranteed the crit (a move that only crits,
//                                     an earlier attr), so there is nothing to do. No side effect, no draw, so it could
//                                     not change the order of anything even if it ran after the closure.
//             2. the closure          condition (user, target, move)  <- staff replace this
//   apply     isCritical.value = true
// The constructor's second argument (`_checkUser`) is unused by the class and is never exposed.
import { ConditionalCritAbAttr } from "#abilities/ab-attrs";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";

export default defineDecl(ConditionalCritAbAttr, {
  tier: "A",
  kind: "calc-modifier",
  when: "calc.crit-roll",
  label: "Guarantee a critical hit",
  summary: () =>
    "My hit is always a critical hit when the rule you pick is true. Example: always crit against a poisoned foe, or on the first turn out.",
  synonyms: [
    "always crit",
    "guaranteed crit",
    "sure critical hit",
    "merciless",
    "never miss a crit",
    "auto crit",
    "100% critical",
  ],
  examples: ["Always crit against poisoned foes, like Merciless", "Always crit super effective hits, like Fatal Precision"],
  params: [],
  noParamsReason:
    "The only constructor argument that matters is the condition (a rule, bound per ability); the effect itself ('this hit is a critical hit') has no number, type or choice. The unused second constructor argument is never exposed.",
  conditions: [
    // The closure differs per user and each binding names its own (see bindings.ts). (user, target, move) = "attack".
    { slot: "ctor:0", ctx: "attack", path: "condition", removable: true, editable: true },
  ],
  guards: [],
  feasibility: [
    "Does nothing when the hit is already guaranteed to be a critical hit",
    "A target that blocks critical hits (Battle Armor, Shell Armor) still stops it: this only sets the guarantee",
  ],
  effect: { id: "effect.force-crit", params: [] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "none", simulated: "ignores" },
  probes: [
    {
      name: "the holder at the HP boundary and the foe with and without a status, speed drop or bleeding",
      axes: { hp: ["50%", "50%-1", "max"], foeMove: ["TACKLE", "EARTHQUAKE"] },
    },
  ],
  status: "decomposed",
  notes:
    "Tier A. 16 attrs on 13 abilities. Bound: first turn out (Ambush 5171, Showdown Mode 5270, Hunters Mark 5482, Ultra Recon Hunter 20002) = time.first-turn; the move is Spacial Rend (Heaven Asunder 5230); the hit is super effective (Fatal Precision 5078 attr 1 and 3, Final Blow 5388, Flawless Precision 5622, Heartless Style 20008 attr 8 and 10) = move.effectiveness > 1; the foe is poisoned, badly poisoned or paralysed, or bleeding, or has a lowered Speed stage (Merciless 196, Depravity 5419, Relentless 5473) = any of five atoms. Legacy (no atom): Ape Shift (5436 attr 1), `pokemon.getHpRatio() < .5`, which uses the ratio ROUNDED to two decimals (hp/max below 49.5%), so no existing HP atom is exact (R-B05-12). Observations (not fixed): (1) Fatal Precision and Heartless Style carry the same condition twice (attr 1 and 3, attr 8 and 10), so the second one never changes anything because of the first; (2) Merciless, Depravity and Relentless use three identical closures; (3) two spellings of the same test (`target != null` and `!!target`); (4) DeadeyeCritAbAttr extends this class (own declaration, another batch). The foe-side facts (status, bleeding, Speed stage) are not on the shared L1 grid, so they are proven in test/tests/elite-redux/decomp/B05/conditional-crit.test.ts.",
});

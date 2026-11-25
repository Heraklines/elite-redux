/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B17 / Lingering Musk, first half. Read by hand: bernerd-roster-mechanics.ts `LingeringMuskEndureAbAttr`, its base
// `PreFaintReviveAbAttr` (archetypes/pre-faint-revive.ts, B11), that base's base `PreDefendFullHpEndureAbAttr`
// (ab-attrs.ts:334) and the one dispatch site (pokemon.ts, `applyAbAttrs("PreDefendFullHpEndureAbAttr", ...)`).
//
// Clause by clause, in the order they run:
//   1. condition  matchesGate: gate { hp-threshold, threshold 0 } is `hpRatio >= 0`, always true (any HP)   [inherited]
//   2. guard      pokemon.getMaxHp() <= 1 stops it (a 1 HP-max Pokemon cannot be left at 1 HP)                [inherited]
//   3. condition  the hit would knock me out: damage.value >= pokemon.hp                                      [inherited]
//   4. condition  matchesUsage: per-hit = no STURDY tag on me yet (once per turn, the tag lapses at turn end) [inherited]
//   5. effect     (parent apply) pokemon.addTag(STURDY, 1), unless simulated: the damage pipeline then leaves 1 HP
//   6. effect     (this class) tempSummonData.lingeringMuskFaint = true, ALSO WHEN SIMULATED (see notes)
// No random draw anywhere. The shared marker of clause 6 is what LingeringMuskPostTurnAbAttr reads at turn end.
//
// Why a package: clauses 1 to 4 live in the inherited canApply of PreFaintReviveAbAttr, which is B11's class. A batch may
// only split canApply in the class it declares (spec 3.1), so the lethal-hit test cannot become a swappable condition
// here without editing B11's file; the requests in requests/B17.md (R1, R2) ask the librarian for the shared fix.
// The trigger is still separate (WHEN calc.damage-taken, the dispatch key is one of its alsoDispatchKeys) and extra IFs
// can be ANDed on top.
import { LingeringMuskEndureAbAttr } from "#data/elite-redux/abilities/bernerd-roster-mechanics";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";

export default defineDecl(LingeringMuskEndureAbAttr, {
  tier: "C",
  kind: "package",
  when: "calc.damage-taken",
  label: "Survive a knockout hit but be marked to faint later",
  summary: () =>
    "When a hit would knock me out, I stay at 1 HP instead, once per turn. I am then marked, and a matching end-of-turn effect makes me faint.",
  synonyms: [
    "lingering musk",
    "endure",
    "sturdy",
    "survive a lethal hit",
    "delayed knockout",
    "borrowed time",
    "cannot be one shot",
  ],
  examples: ["Survive a knockout hit, then faint when the turn ends"],
  params: [],
  noParamsReason:
    "The class takes no constructor arguments: it always survives at any HP (the inherited HP rule is 'at least 0%', always true) and once per turn. There is no number, type, stat or status to set.",
  conditions: [],
  guards: [],
  feasibility: [
    "The hit must be a knockout: its damage is at least my current HP",
    "My maximum HP must be above 1",
    "I must not already have survived a hit this turn (the survival marker lapses at the end of the turn)",
    "The survival really happens only for a real hit, not for a damage preview",
  ],
  effect: { id: "effect.package", params: [] },
  reusableAlone: { when: true, if: true, do: true },
  flags: {
    rng: "none",
    state: "entry",
    // The STURDY tag is only added when not simulated, but the "faint later" marker is set either way.
    simulated: "ignores",
  },
  probes: [
    {
      // Ordinary hits at full and half HP. A knockout hit is left out of the battle twin: the holder faints at the end of
      // that turn (that is the ability), which ends the scenario in a game over. The survival is driven in gates.test.ts.
      name: "ordinary hit at full and half HP",
      axes: { hp: ["max", "50%"] },
    },
  ],
  status: "decomposed",
  notes:
    "PACKAGE, written reason: the survive rule (clauses 1 to 4) is inherited from PreFaintReviveAbAttr (B11), whose canApply is not mine to split, and the effect (a STURDY tag that the damage pipeline reads, plus a per-switch-in marker that the matching end-of-turn attr reads) has no library effect: there is no 'survive a lethal hit' block and no 'set a marker' block. Requests R1 (split the inherited canApply into a swappable 'the hit would knock me out' condition) and R2 (effect: survive a knockout at 1 HP) in requests/B17.md. Typed params: none exist; the only number in the chain is the inherited HP rule threshold 0, which is always true. Users: Lingering Musk (6084, attr 2) only; its attr 3 is LingeringMuskPostTurnAbAttr. SUSPECTED GAME BUG, NOT FIXED: this class's apply sets tempSummonData.lingeringMuskFaint = true without checking `simulated`. PreDefendFullHpEndureAbAttr is dispatched from Pokemon.getAttackDamage with the caller's `simulated` flag, and getAttackDamage(simulated: true) is called for damage previews (move-phase.ts:682 and move-effect-phase.ts:1071 target ordering, the enemy move scoring in pokemon.ts around lines 10040 to 10360). A previewed knockout of a Lingering Musk holder (damage >= hp) therefore sets the marker although no hit landed, and the holder faints at the end of the turn. Needs a check by the owner; the declaration records simulated: ignores.",
});

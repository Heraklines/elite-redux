/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B07 chunk 4 / calc modifier (AI only), Tier A. PARKED: status legacy-closure-pending-request.
//
// This file is written and complete, but it is deliberately NOT named `*.decl.ts`, so the registry glob does not pick it up yet.
// Reason: the class's dispatch key AiMovegenMoveStatsAbAttr is in UNEXPOSED_DISPATCH_KEYS (vocabulary/dispatch-keys.ts, "not a battle
// moment staff can react to") and no WHEN in WHEN_REGISTRY owns it, so the L0 rule "the WHEN resolves to a dispatch key that is the class or
// an ancestor" cannot be met, and a batch may not edit the library (spec 6, step 3). The request is requests/B07.md, R-B07-15.
// The 43 closure bindings live next to it in `pending/bindings.chunk4.pending.ts`.
//
// To finish: once the librarian has added the WHEN (R-B07-15), set `when` below to its final id, rename this file to
// AiMovegenMoveStatsAbAttr.decl.ts, move the lines of bindings.chunk4.pending.ts into decl/B07/bindings.ts (or rename it to
// bindings.chunk4.ts), and run L0 / L1 / L2 for the class.
//
// What the class is (read from src/data/abilities/ab-attrs.ts and move.ts):
//   constructor(effect)  `super(false)` (showAbility false), one argument: the closure `(params) => void`
//   canApply             `globalScene.movesetGenInProgress`  -> the whole class is dead code in a battle: FEASIBILITY ("only while the
//                        game builds a computer-controlled Pokemon's moveset")
//   apply                `this.effect(params)`; the closure may change `powerMult`, `accMult`, `instantCharge` and `maxMultiHit`
// Dispatch: ONE site. `Move.effectivePowerAbilityCheck` (moves/move.ts, called by `calculateEffectivePower` while ai-moveset-gen.ts sets
// `movesetGenInProgress`) builds the frame `{ pokemon, move, powerMult: 1, accMult: 1, instantCharge: false, maxMultiHit: false, simulated: true }`
// and runs `applyAbAttrs("AiMovegenMoveStatsAbAttr", params)`; the numbers decide how highly the AI rates a move when it picks the moveset.
// Nothing in a real battle reads them. No random draw, no state, nothing is written to the Pokemon.
//
// Each closure mixes a CONDITION (a move category, type, flag or priority) with an EFFECT (a rating multiplier), written as one lambda per
// ability (43 users, see the notes). There is no constructor argument other than the closure, so the declaration has no setting; the
// closure is the single slot `ctor:0` and every user is bound as a legacy closure with its exact formula.
import { AiMovegenMoveStatsAbAttr } from "#abilities/ab-attrs";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";

export default defineDecl(AiMovegenMoveStatsAbAttr, {
  tier: "A",
  kind: "calc-modifier",
  // PLACEHOLDER id: the WHEN of request R-B07-15 ("While the game builds an enemy's moveset").
  when: "calc.ai-moveset-stats",
  label: "Change how computer opponents rate my moves",
  summary: () =>
    "Only when the game picks moves for a computer-controlled Pokemon: it rates my moves as stronger or more accurate, so it picks them more often. Never changes a real battle.",
  synonyms: [
    "ai moveset",
    "enemy ai",
    "move rating",
    "move scoring",
    "moveset generation",
    "trainer moves",
    "huge power",
    "compound eyes",
  ],
  examples: ["The AI treats physical moves as twice as strong, like Huge Power"],
  params: [],
  noParamsReason:
    "The only constructor argument is the rating closure (the condition slot ctor:0 and the multipliers together); there is no number, type or choice outside it. showAbility is not an argument (`super(false)`).",
  conditions: [
    // `(params) => void` writes the rating numbers: no library context takes this signature (see R-B07-15).
    { slot: "ctor:0", ctx: "none", path: "effect", removable: false, editable: false },
  ],
  guards: [],
  feasibility: [
    "Only runs while the game is building the moveset of a computer-controlled Pokemon, never during a real battle",
  ],
  effect: { id: "effect.package", params: [] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "none", simulated: "ignores" },
  l2StaticReason:
    "The moment exists only while the enemy moveset generator runs (no battle turn reaches it); the direct test test/tests/elite-redux/decomp/B07/flag-sites-4.test.ts is the place to drive Move.calculateEffectivePower once the declaration is live.",
  probes: [{ name: "a move is rated while the moveset generator runs", axes: {} }],
  status: "decomposed",
  notes:
    "Tier A, status legacy-closure-pending-request (R-B07-15: a WHEN for the AI moveset moment, a (params) closure context, and effects for 'multiply the AI's power rating', 'multiply the AI's accuracy rating', 'treat the move as never missing', 'treat the move as always hitting its maximum' and 'treat the move as charging instantly'). EVERY closure is a legacy closure for now, bound by hand in pending/bindings.chunk4.pending.ts with its exact formula. Users, 43 (live dump of ability id, attr index): Drizzle 2/2, Damp 6/1, Compound Eyes 14/1, Huge Power 37/1, Hustle 55/2, Drought 70/2, Pure Power 74/1, Skill Link 92/1, Sniper 97/1, Snow Warning 117/2, Analytic 148/1, Victory Star 162/2, Parental Bond 185/2, Primordial Sea 189/3, Desolate Land 190/3, Dazzling 219/2, Misty Surge 228/2, Intrepid Sword 234/1, Dauntless Shield 235/1, Gorilla Tactics 255/1, Sword of Ruin 285/1, Beads of Ruin 287/1, Orichalcum Pulse 288/3, Hadron Engine 289/2, Ninja's Blade 5191/2, Seaborne 5232/2, Crowned Sword 5256/1, Crowned Shield 5257/1, Sword of Damnation 5392/2, Desolate Sun 5447/3, Calculative 5494/1, Super Sniper 5507/1, Haste Makes Waste 5561/2, Supercell 5568/2, Fire Aspect 5570/3, Blistering Sun 5572/3, Sundae 5632/2, Lucha Libre 5686/2, Sword's Nature 6023/1, Solar Panel 6028/2, Fourth Degree 6107/1, Kagutsuchi 6109/3, Radiant Jewel 20019/4 (a composed ability that includes the class's accuracy closure). Subclasses are their own declarations: AlwaysHitAbAttr (live), SummonTerrainAiMovegenMoveStatsAbAttr (parked) and the archetype PerMoveAlwaysHitAbAttr (another batch). The closure's source mixes the moves' own attrs (hasAttr('ThunderAccuracyAttr'), 'CritOnlyAttr', 'DefAtkAttr') with fixed move ids and types, which is why no single atom set covers all of them. SUSPECTED ODDITIES (not fixed): the comment inside the Desolate Land, Desolate Sun, Fire Aspect and Blistering Sun closures (copied from Primordial Sea) says 'fire type move has 0 power' but the code tests the WATER type (the harsh sun rule; Primordial Sea itself tests FIRE, the heavy rain rule), so the comment misleads; Misty Surge is a plain AiMovegenMoveStatsAbAttr with an inline closure while the other three terrain surges use the subclass, and its Dragon x0.5 check runs BEFORE the flying/levitate early return while the subclass's boost does not.",
});

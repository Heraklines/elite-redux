/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B14 chunk 6. Tier B event-effect with two consequences (shown as two branches). "After my attack lands on a paralyzed foe, cure
// its paralysis and lower its better defensive stat" (Positive Feedback).
//
// Source: plusle-minun.ts PositiveFeedbackAbAttr (extends PostAttackAbAttr, dispatched after my hit). canApply, original clause
// order, is now `guards && gate`:
//   guards  1. `super.canApply(params)`   the parent's `attackCondition(pokemon, opponent, move)`: a constructor closure, argument 0,
//                                         default `move.category !== STATUS` (the move deals damage). The compiler swaps it through
//                                         the slot `ctor:0`, and the guard calls it, so it is still clause 1.
//           2. `hitResult < 4`            an ordinary hit: HitResult 4 is ONE_HIT_KO, 5 is NO_EFFECT, so a one-hit KO and a blocked
//                                         hit do not count (see the oddity in notes)
//   gate    3. `opponent?.status?.effect === StatusEffect.PARALYSIS`    the foe is paralyzed (library: status.has { who: other })
// Nothing is random in canApply or in apply.
//
// apply, original order:
//   a. `if (simulated || !opponent) return`                          a preview changes nothing
//   b. `opponent.resetStatus(true, false, false, false)`             cure the foe at once, not through a phase (no message)
//   c. `higherDef = foe.getStat(DEF) >= foe.getStat(SPDEF) ? DEF : SPDEF`   the better of the two defenses (ties: Defense)
//   d. unshift `StatStageChangePhase(foe, selfTarget false, [higherDef], -1)`   lower it by one stage
// Both steps exist in the library (effect.cure-status, effect.stat-stage), so this is two branches, not a package. The one thing the
// library lacks is the choice "whichever defense is higher" (a request: `statPick` on effect.stat-stage, like the Berserk precedent).
// Class edit (pure move of code): a constructor with the old behaviour as defaults, `(attackCondition?, showAbility = true,
// stageDrop = 1)`; `apply` queues `-this.stageDrop`.
import { PositiveFeedbackAbAttr } from "#data/elite-redux/abilities/plusle-minun";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";

export default defineDecl(PositiveFeedbackAbAttr, {
  tier: "B",
  kind: "event-effect",
  when: "event.after-my-hit",
  label: "Consume the foe's paralysis and lower its better defense",
  summary: params =>
    `After my attack hits a paralyzed foe, its paralysis is cured and its higher defense (Defense or Sp. Def) drops by ${params.stageDrop} stage. Example: 1 = one stage lower.`,
  synonyms: [
    "positive feedback",
    "cure paralysis and lower defense",
    "eat the paralysis",
    "convert paralysis into a stat drop",
    "shock to defense drop",
    "defense break after paralysis",
    "spend paralysis",
  ],
  examples: [
    "After I hit a paralyzed foe, its paralysis is gone and its better defense drops one stage, like Positive Feedback",
  ],
  params: [
    {
      id: "stageDrop",
      ctorIndex: 2,
      path: "stageDrop",
      control: "number",
      min: 1,
      max: 6,
      step: 1,
      integer: true,
      label: "Stages the foe's higher defense drops (1-6)",
      editable: true,
      default: 1,
      // Only the effect reads it; the gate never repeats it.
      gateIndependent: true,
    },
  ],
  // The constructor's second argument, `showAbility`, is never exposed.
  fixedCtorArgs: { 1: true },
  conditions: [
    // Clause 1: the parent's attack condition, a constructor closure (by default "the move deals damage"). Removable: "after any
    // hit, status moves included" is a valid design.
    { slot: "ctor:0", ctx: "attack", path: "attackCondition", removable: true, editable: true },
    // Clause 3, the gate = [the foe is paralyzed]. Removable: "after any hit" is a valid design.
    { slot: "gate", ctx: "params", removable: true, editable: true },
  ],
  guards: [],
  feasibility: [
    "Only after an ordinary hit: a one-hit KO or a blocked hit does not count",
    "Does nothing while the game is only previewing",
    "The foe's paralysis is cured at once, before the stat drop is queued",
  ],
  branches: [
    {
      label: "Cure the foe's paralysis",
      conditions: ["foe is paralyzed"],
      effect: { id: "effect.cure-status", params: [] },
    },
    {
      label: "Lower the foe's higher defense",
      conditions: ["foe is paralyzed"],
      effect: { id: "effect.stat-stage", params: ["stageDrop"] },
    },
  ],
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "none", simulated: "respects" },
  probes: [{ name: "I hit a foe", axes: {} }],
  status: "decomposed",
  notes:
    "Tier B event-effect, two branches (cure the paralysis, lower the stat), both with library effects. Users (1): Positive Feedback (5922) attr 1 (attr 0 is the power half, PositiveFeedbackPowerAbAttr). Both condition slots are bound (bindings.ts): ctor:0 = move.damaging (the default closure `move.category !== STATUS`), gate = status.has { other, PARALYSIS }. The class does read `simulated` in apply, but canApply does not, so a preview passes the gate and then does nothing. The shared L2 scenarios cannot put a status on the FOE, so the paralyzed branch is proven by B14/chunk6.test.ts (a literal copy of the original canApply over every combination of its clauses, and apply driven in a real battle). Suspected game bug, not fixed: `hitResult < 4` is a bare number. HitResult 4 is ONE_HIT_KO and 5 is NO_EFFECT, so a one-hit KO (Fissure and the like) never triggers it, which looks unintended (`< HitResult.NO_EFFECT` would be the usual test, as in the other Pokemon-pitch classes); a requested guard `hit-was-ordinary` reproduces the number exactly. The 'higher defense' choice is made at apply time on the foe's own stat values (`getStat`: the stored stat times the Moody and Endless-status multipliers, NOT its stat stages), and a tie goes to Defense.",
});

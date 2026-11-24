/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B16 chunk 3 (Tier B with RNG in canApply, event-effect). "My punches sometimes badly poison the foe and mark it as irradiated."
//
// Source: fakemon-pitch-mechanics.ts, IrradiatedFistAbAttr (extends PostAttackAbAttr). Constructor `(attackCondition?, chance = 50)`:
// argument 0 is the parent's attack condition (default: a damaging move), argument 1 the new `chance`, default equal to the old literal 50.
// canApply, original clause order, now `guards && gate && residual`:
//   guards    1. super.canApply: the inherited attack condition (constructor argument 0, replaceable, slot ctor:0, bound to move.damaging)
//             2. damage > 0                                                  the hit really dealt damage
//   gate      3. move.hasFlag(PUNCHING_MOVE)                                 a punching move                               -> move.flag
//             4. holder.randBattleSeedInt(100) < chance                      the chance roll: ONE draw, only for punches   -> rng.chance
//   residual  5. foe.canSetStatus(TOXIC, true, false, holder)                the foe can be badly poisoned (asked AFTER the roll,
//                                                                            so a punch that cannot poison still uses the draw)
// apply (skipped when `simulated`): `if (foe.trySetStatus(TOXIC, holder)) foe.addTag(ER_IRRADIATED_TOXIC, 0, MoveId.NONE, holder.id)`.
// The marker is added only when the poisoning really landed. No draw in apply. Draw order: exactly one draw (clause 4), and only when
// clauses 1 to 3 passed.
import { IrradiatedFistAbAttr } from "#data/elite-redux/abilities/fakemon-pitch-mechanics";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";

export default defineDecl(IrradiatedFistAbAttr, {
  tier: "B",
  kind: "event-effect",
  when: "event.after-my-hit",
  label: "Sometimes badly poison and curse the foe when I punch",
  summary: params =>
    `After my punching move hurts a foe, there is a ${params.chance}% chance it becomes badly poisoned. Once that poison is gone, its stat boosts are wiped and it cannot raise stats until it switches.`,
  synonyms: [
    "irradiated fist",
    "poison punch",
    "toxic punch",
    "punch poison chance",
    "badly poison on punch",
    "radioactive",
    "toxic touch",
  ],
  examples: ["Each punching move has a 50% chance to badly poison the foe, like Irradiated Fist"],
  params: [
    {
      id: "chance",
      ctorIndex: 1,
      path: "chance",
      control: "slider",
      min: 1,
      max: 100,
      step: 1,
      integer: true,
      label: "Chance (%)",
      editable: true,
      default: 50,
    },
  ],
  gateParams: [{ param: "chance", block: "rng.chance", field: "pct" }],
  conditions: [
    // Slot 0 of the constructor: the inherited attack condition (default: a damaging move). Staff may replace or drop it.
    { slot: "ctor:0", ctx: "attack", lib: "move.damaging", path: "attackCondition", removable: true, editable: true },
    // The gate is the group [move.flag PUNCHING_MOVE, rng.chance pct], in that order. Staff may replace or drop it.
    { slot: "gate", ctx: "params", removable: true, editable: true },
  ],
  guards: [],
  feasibility: [
    "The hit must really have dealt damage (more than 0)",
    "The foe must be able to be badly poisoned (it has no status and nothing blocks it); this is asked after the chance roll",
    "The curse (stat boosts wiped and locked once the poison is gone) is only put on the foe if the poisoning really landed",
    "Nothing happens while the game only previews a hit",
  ],
  branches: [
    {
      label: "Badly poison the foe",
      conditions: [],
      effect: { id: "effect.inflict-status", params: [] },
    },
    {
      label: "Curse the foe if it was badly poisoned",
      conditions: ["The poisoning really landed"],
      effect: { id: "effect.apply-tag", params: [] },
    },
  ],
  reusableAlone: { when: true, if: true, do: true },
  flags: {
    rng: "canApply",
    rngOrder: [
      "canApply gate: one chance roll (randBattleSeedInt(100) < chance), only after the damaging and punching checks passed, before the can-be-poisoned check",
    ],
    state: "none",
    simulated: "ignores",
  },
  probes: [
    {
      // A punch and a non-punch: the chance roll must only be drawn for the punch.
      name: "punching and non-punching hit",
      axes: { foeMove: ["MACH_PUNCH", "TACKLE"] },
    },
  ],
  status: "decomposed",
  notes:
    "Tier B with RNG in canApply (same pattern as the golden precedent PostDefendContactApplyStatusEffectAbAttr): trigger (after my attack lands), three IFs (the inherited damaging-move condition in slot ctor:0 bound to move.damaging; in the gate 'the move is a punching move' bound to move.flag PUNCHING_MOVE and the 50% chance bound to rng.chance, in that order) and two ordered effects written as two branches that BOTH happen (badly poison the foe; then, only if that landed, mark it as irradiated). `chance` is a typed percent and is in gateParams so a moved slider moves the compiled roll. The hit-dealt-damage clause stays in `guards` (R-B16-4); effect.apply-tag is planned (R-B16-7) and 'do the second effect only if the first landed' has no library form (R-B16-24). The check is `move.hasFlag(PUNCHING_MOVE)` (the printed flag); the atom move.flag calls `doesFlagEffectApply`, which differs from hasFlag only through flag-injecting abilities, and none of them injects the punching flag today, so the two agree on every real Pokemon. rng.chance answers true without a draw when `simulated`, whereas the class draws regardless; no engine path calls PostAttack simulated today (same note as the contact-status precedent). User: Irradiated Fist (6035, attr 0). Oddity, not fixed: the draw happens before the can-be-poisoned test, so a punch against an already statused foe still spends one random number (a replay-compatibility matter, so the order is kept). What the marker does (battler-tags.ts, ErIrradiatedToxicTag): at the end of each turn, once the foe is no longer Toxic, it sets every raised stat stage of the foe back to 0 and puts the lock marker on it (it cannot raise stats until it switches); while the foe is still Toxic nothing happens.",
});

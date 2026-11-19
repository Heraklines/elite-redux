/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// PRECEDENT: memory (once per wave), Tier B. See ../PRECEDENTS.md.
//
// The gate holds EVERY clause the rule decides, in the original order:
//   1. time.once-per { scope: wave, key: "berserk-on-threshold" }   <- the memory
//   2. move.damaging
//   3. side.is { foe }                                              <- the opponent check
//   4. hp.crossed-below { holder, ratio 0.5, rounding: floor-half } <- hp <= floor(max/2) && hp + damage > floor(max/2)
//
// The memory is NOT a private field: `time.once-per` with scope "wave" reads and writes
// pokemon.waveData.entryEffectsFired, the very Set the class (and every ER once-per-wave archetype) uses. So the
// class's own `apply` (which writes the key) and the library atom (which reads it, and whose pending write is
// committed when the rule applies) share one memory. Two rules of memory:
//   * a failing IF later in the list must NOT use the memory up (the atom only writes at apply time), and
//   * a simulated call never writes.
// The `floor-half` rounding is deliberately different from Wimp Out's `exact` crossing; do not unify them.
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";
import { BerserkOnThresholdAbAttr } from "#data/elite-redux/archetypes/berserk-on-threshold";

export default defineDecl(BerserkOnThresholdAbAttr, {
  tier: "B",
  kind: "event-effect",
  when: "event.after-hit",
  label: "Raise my stronger attack stat once when a hit drops me to half HP",
  summary: () => "Once per wave, the hit that takes me to half HP or less raises my higher attacking stat by one stage",
  synonyms: ["berserk", "anger", "rage at half hp", "once per wave boost", "enrage", "power up when hurt"],
  examples: ["Raise my best attack by one stage the first time I fall to half HP"],
  params: [],
  noParamsReason:
    "The class has no constructor arguments: the half-HP line, the +1 stage and the higher-of-Attack/Sp. Atk pick are fixed in the class. Staff reach the same behaviour with a composed rule (hp.crossed-below + time.once-per + effect.stat-stage).",
  conditions: [{ slot: "gate", ctx: "params", removable: true, editable: true }],
  guards: [],
  feasibility: [],
  effect: { id: "effect.stat-stage", params: [] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "battle", simulated: "respects" },
  probes: [
    {
      // Start well above the line, just above it (the hit crosses), on it and below it.
      name: "HP around the half line",
      axes: { hp: ["max", "50%+1", "50%", "50%-1"] },
    },
  ],
  status: "verified",
  notes:
    "Precedent for once-per memory. Users: Berserk, Going Berserk and Unlocked Potential; the last two carry an attr-level extraCondition (AbAttr.addCondition) that the rebuild copies as it is. Memory behaviour is proven by precedents/memory.test.ts (pre-set key blocks both the original and the rebuild; apply writes it; a failing later IF does not).",
});

/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B16 chunk 4 (Tier B, event-effect). "When my punching move hurts a foe, one of my stats goes up by one stage (Attack for Knuckle Down)."
//
// Source: bernerd-roster-mechanics.ts, KnuckleDownAbAttr (extends PostAttackAbAttr; showAbility true by default). The class used to have no
// constructor of its own and two literals in `apply` (`[Stat.ATK]`, `1`); the constructor is now `(attackCondition?, stat = ATK, stages = 1)`
// (behaviour-neutral, defaults equal the old literals, `super(attackCondition)` keeps showAbility at its default) and canApply is the
// Tier B split, original clause order, `guards && gate` (every clause is pure; no random draw, no residual):
//   guards  1. super.canApply: the inherited attack condition = constructor argument 0; default (and the only value the one user passes)
//              is `move.category !== STATUS` -> a replaceable library condition (slot ctor:0, bound to move.damaging). It sits in
//              `guards()` only to keep the order.
//           2. params.hitResult < HitResult.NO_EFFECT     the hit connected and dealt damage (EFFECTIVE, SUPER_EFFECTIVE, NOT_VERY_EFFECTIVE,
//                                                          ONE_HIT_KO) -> NO library atom or guard (requested as R-B16-17)
//           3. user.turnData.hitCount === user.turnData.hitsLeft
//                                                          this is the FIRST strike of the move. PostAttackAbAttr runs inside
//                                                          MoveEffectPhase.applyOnTargetEffects, BEFORE `end()` lowers `hitsLeft`, so the
//                                                          two are equal on strike one only (move-effect-phase.ts:296 uses the very same
//                                                          test as `firstHit`) -> NO library atom (requested as R-B16-18)
//   gate    4. move.doesFlagEffectApply({ flag: PUNCHING_MOVE, user: holder, target: foe })    a punching move -> library atom move.flag
// apply (skipped when `simulated`): queue a StatStageChangePhase on the holder itself (selfTarget true) for `[stat]` by `stages`.
// No random draw, no memory, no state.
//
// WHY clauses 2 and 3 are in `guards` and not in the gate: the library has no atom for either (the after-my-hit frame carries `hitResult`
// but there is no "the hit connected" atom, and it carries no hit counters, so move.hit-index / move.last-hit cannot be asked). A class
// has ONE replaceable gate slot and a binding that cannot be written in library words must not hide the punch test, so the gate stays the
// punch test alone and the two missing clauses stay locked in the class, in their original order, written to staff as "also requires"
// lines. Clause 3 is a design rule in nature ("only the first strike counts"), not a bug guard; once R-B16-18 is granted it belongs in the
// gate (`all[move.first-hit, move.flag]`) and the class edit moving it is one line.
import { KnuckleDownAbAttr } from "#data/elite-redux/abilities/bernerd-roster-mechanics";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";
import { enumCodec } from "#data/elite-redux/ability-studio/param-codecs";
import { STAT_OPTIONS } from "#data/elite-redux/ability-studio/vocabulary/enums";
import { Stat } from "#enums/stat";

export default defineDecl(KnuckleDownAbAttr, {
  tier: "B",
  kind: "event-effect",
  when: "event.after-my-hit",
  label: "Change a stat of mine after my punching move hits",
  summary: params =>
    `After the first strike of my punching move hurts a foe, my ${params.stat} changes by ${params.stages} stage(s). Example: Attack +1 after a punch, like Knuckle Down.`,
  synonyms: [
    "knuckle down",
    "punch boost",
    "raise attack after punching",
    "stat boost after a punch",
    "fist power up",
    "punching move raises attack",
    "boost on punch",
  ],
  examples: ["When my punching move hits, raise my Attack by 1 stage, like Knuckle Down"],
  params: [
    {
      id: "stat",
      ctorIndex: 1,
      path: "stat",
      control: "select",
      label: "Which stat (Attack, Defense, Sp. Atk, Sp. Def, Speed, Accuracy or Evasion)",
      editable: true,
      // The gate (the move is a punching move) never reads the stat; only apply does.
      gateIndependent: true,
      default: "ATK",
      options: STAT_OPTIONS,
      codec: enumCodec(Stat, "stat"),
    },
    {
      id: "stages",
      ctorIndex: 2,
      path: "stages",
      control: "number",
      min: -6,
      max: 6,
      step: 1,
      integer: true,
      label: "Number of stages (+1 raises by one stage, a negative number lowers)",
      editable: true,
      gateIndependent: true,
      default: 1,
    },
  ],
  conditions: [
    // Clause 1: the inherited attack condition (default: a damaging move). Staff may replace or drop it.
    { slot: "ctor:0", ctx: "attack", lib: "move.damaging", path: "attackCondition", removable: true, editable: true },
    // Clause 4: the move is a punching move. Staff may replace or drop it ("any damaging move raises my Attack").
    { slot: "gate", ctx: "params", removable: true, editable: true },
  ],
  guards: [],
  feasibility: [
    "The hit must really have connected and dealt damage (a blocked or immune hit does not count)",
    "Only the first strike of a move counts: a multi-hit punch raises the stat once, not once per strike",
    "Nothing happens while the game only previews a hit",
  ],
  effect: { id: "effect.stat-stage", params: ["stat", "stages"] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "none", simulated: "respects" },
  probes: [
    {
      name: "the holder lands a punching move and a non-punching move",
      axes: { foeMove: ["MACH_PUNCH", "TACKLE"] },
    },
  ],
  status: "decomposed",
  notes:
    "Tier B, fully expressed in library words EXCEPT two locked clauses. Trigger (after my attack lands), the attack condition (slot ctor:0, bound to move.damaging) and the punch test (gate, bound to move.flag PUNCHING_MOVE) are real swappable blocks; the effect is effect.stat-stage on the holder with typed params stat (which stat) and stages (-6 to +6), both former literals now trailing constructor arguments with the old values as defaults and read back by `path`. NOT swappable yet, written as 'also requires' lines: (1) the hit connected, `hitResult < NO_EFFECT` (R-B16-17, atom or guard), (2) this is the first strike of the move, `hitCount === hitsLeft` (R-B16-18, atom; the after-my-hit frame has no hit counters, so move.hit-index and move.last-hit cannot answer it today). Both are pure and sit in `guards` in their original order, before the gate. Because `gate` is the punch test alone, staff can already make 'any damaging move raises my Attack' or 'a Sound move raises my Speed'; the first-strike rule stays. User: Knuckle Down (6099, attr 0, the only attr). The move flag test is `doesFlagEffectApply` (the engine's own), which counts flag-injecting abilities and Substitute rules exactly as the class did. Oddities, not fixed: (1) the ability text says 'Using a Punch move raises Attack by one stage' but the code requires the move to HIT and deal damage (a missed punch, a punch into an immune foe or a status-like punch gives nothing); that is the intended reading of a post-attack trigger. (2) The `hitCount === hitsLeft` test makes a multi-hit punch (Double Iron Bash) raise Attack once, on the first strike, even if later strikes would also connect; only the first strike counts. (3) If the first strike is the one that knocks the foe out the stat still rises (PostAttack still runs). (4) The shared L1 grid cannot see the gate of this class: its frame has no hit counters (hitCount 0, hitsLeft -1 are never equal), so canApply is false for both original and rebuild on every row. A deliberate mutation (gate bound to the contact flag) passed L1 and was caught only by B16/chunk4.test.ts (truth table over moves, hit results and counters, plus the two-strike L2 twin). (5) `canApply` does not read `simulated`, `apply` does; canApply is pure, so a preview is safe.",
});

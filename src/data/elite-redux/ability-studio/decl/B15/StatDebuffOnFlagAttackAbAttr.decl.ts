/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B15 chunk 5. Tier B. "After my attack lands on a target, if the move has a given property (hammer, slicing, biting...), the target's stat drops (with an optional chance), only on the first strike."
//
// Source: src/data/elite-redux/abilities/stat-debuff-on-flag-attack.ts, class StatDebuffOnFlagAttackAbAttr (extends PostAttackAbAttr; constructor takes ONE options object
// { flag, stat, stages, chance = 100 }, throws when stages is 0 or not a whole number or chance is outside 0..100; showAbility stays true; the base class keeps its DEFAULT
// attackCondition move.category !== STATUS). canApply, now guards && gate && residual. ORIGINAL clause order, then where each one went:
//   1. super.canApply  attackCondition(holder, target, move) = move.category !== STATUS                   -> gate    CONDITION (a damaging move)
//   2. hitResult >= HitResult.NO_EFFECT -> false                                                          -> guards  GUARD (the hit connected: not a miss, a block or an immunity)
//   3. holder.turnData.hitCount !== holder.turnData.hitsLeft -> false                                     -> guards  GUARD, for now (first strike only; see notes and R-B15-39)
//   4. !move.doesFlagEffectApply({ flag, user: holder, target })  -> false                                -> gate    CONDITION (the move property)
//   5. chance >= 100 || holder.randBattleSeedInt(100) < chance                                            -> gate    RNG DRAW (the only draw, at the very end; no draw when chance is 100)
// A Pokemon stand-in without turnData (the old unit-test stubs, test/data/elite-redux/abilities/stat-debuff-on-flag-attack.test.ts) counts as the first strike in the guard, so such a stub still gets
// the old answer for a status move (the original returned false at clause 1 before it ever read turnData); a real Pokemon always has turnData.
// Clauses 2 and 3 were moved in front of clause 1 (guards run first). Clauses 1 to 4 are pure reads, so that changes no answer; clause 5 stays LAST in the gate, so a hit that fails
// any earlier clause still draws nothing, exactly as before. The chunk test replays the original clause order against the new split over every combination (and counts the draws).
// apply (effect), not when simulated: queues StatStageChangePhase(target, selfTarget false, [stat], stages) with unshiftNew. No message of its own, no draw. The phase clamps to -6..+6.
// Refactor (pure move of code, spec 3.1): canApply = gatedCanApply(this, params); guards and gate are the clauses above. `gateOverride` is declared for the compiler.
import { StatDebuffOnFlagAttackAbAttr } from "#data/elite-redux/abilities/stat-debuff-on-flag-attack";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";
import { enumCodec } from "#data/elite-redux/ability-studio/param-codecs";
import { MOVE_FLAG_OPTIONS, STAT_OPTIONS } from "#data/elite-redux/ability-studio/vocabulary/enums";
import { MoveFlags } from "#enums/move-flags";
import { Stat } from "#enums/stat";

export default defineDecl(StatDebuffOnFlagAttackAbAttr, {
  tier: "B",
  kind: "event-effect",
  when: "event.after-my-hit",
  label: "Change the target's stat after using a certain kind of move",
  summary: params =>
    `After my damaging move with the "${params.flag}" property hits, the target's ${params.stat} changes by ${params.stages} stage(s), ${params.chance}% of the time, only on the first strike. Example: hammer moves lower Defense by 1.`,
  synonyms: [
    "lower the target's defense after a hammer move",
    "debuff on hit with a move type",
    "weaken the foe with biting moves",
    "slicing moves lower defense",
    "stat drop on contact move property",
    "armor break",
    "denting blows",
    "chainsaw",
    "crushing jaw",
  ],
  examples: [
    "Hammer moves lower the target's Defense by one stage, like Denting Blows",
    "Biting moves have a 50% chance to lower the target's Defense, like Crushing Jaw",
  ],
  params: [
    {
      id: "flag",
      ctorIndex: 0,
      ctorOption: "flag",
      path: "flag",
      control: "select",
      label: "Move property that triggers it (for example Hammer based)",
      editable: true,
      default: "HAMMER_BASED",
      options: MOVE_FLAG_OPTIONS,
      codec: enumCodec(MoveFlags, "move property"),
    },
    {
      id: "stat",
      ctorIndex: 0,
      ctorOption: "stat",
      path: "stat",
      control: "select",
      label: "Which of the target's stats changes",
      editable: true,
      gateIndependent: true,
      default: "DEF",
      options: STAT_OPTIONS,
      codec: enumCodec(Stat, "stat"),
    },
    {
      id: "stages",
      ctorIndex: 0,
      ctorOption: "stages",
      path: "stages",
      control: "number",
      min: -6,
      max: 6,
      step: 1,
      integer: true,
      label: "Stages to change (-1 = one stage lower, 1 = one stage higher; not 0)",
      editable: true,
      gateIndependent: true,
      default: -1,
    },
    {
      id: "chance",
      ctorIndex: 0,
      ctorOption: "chance",
      path: "chance",
      control: "number",
      min: 0,
      max: 100,
      step: 1,
      integer: true,
      label: "Chance (%) that it happens (100 = always)",
      editable: true,
      default: 100,
    },
  ],
  // The property and the chance each live twice: as a param and as the literal of an atom in the gate binding. gateParams keeps them equal.
  gateParams: [
    { param: "flag", block: "move.flag", field: "flag" },
    { param: "chance", block: "rng.chance", field: "pct" },
  ],
  conditions: [
    // The gate is the group [move.damaging, move.flag, rng.chance], in that order (the chance roll stays last).
    { slot: "gate", ctx: "params", removable: true, editable: true },
  ],
  guards: [],
  feasibility: [
    "The hit must have connected: a miss, a block or an immunity does nothing",
    "Only the first strike of a multi-hit move counts, so a target is affected once per move",
    "The stat stops at -6 (or +6); the normal stat change handles that, and Clear Body, Mist and Contrary still apply",
    "A number of stages of 0 or a fraction, or a chance outside 0 to 100, is refused when the ability is built",
    "It does nothing in a preview",
  ],
  effect: { id: "effect.stat-stage", params: ["stat", "stages"] },
  reusableAlone: { when: true, if: true, do: true },
  flags: {
    rng: "canApply",
    rngOrder: [
      "canApply: after the damaging-move, property, hit-connected and first-strike clauses all pass, ONE seeded draw randBattleSeedInt(100) < chance (none when the chance is 100)",
    ],
    state: "none",
    simulated: "respects",
  },
  probes: [
    {
      // A move with the property and one without; the chance only matters for Crushing Jaw.
      name: "a move with the property and one without",
      axes: { foeMove: ["TACKLE", "WATER_GUN"] },
    },
  ],
  status: "decomposed",
  notes:
    "Tier B, event effect with the library effect effect.stat-stage (target = the other Pokemon, fixed by this class, so no target param; stat and stages are typed params), not a package. 5 attrs in 5 abilities, each bound individually: Denting Blows (5347 attr 0, Hammer based, Defense -1), Chainsaw (5623 attr 0, Slicing move, Defense -1), Crushing Jaw (5677 attr 1, Biting move, Defense -1, 50% chance), Augur (6043 attr 0, Drill based, Defense -1) and Crossbow (6105 attr 0, Arrow based, Defense -1) (archetype-dispatcher.ts builds Denting Blows, Chainsaw and Crushing Jaw, fakemon-pitch-mechanics.ts builds Augur, bernerd-roster-mechanics.ts builds Crossbow). A subclass in another batch (PushKickAbAttr, Push Kick 6088, Kicking move) overrides canApply and apply and calls super, so it keeps working through the new gate; it is declared by its own batch. The gate is the library group all[move.damaging, move.flag {flag}, rng.chance {pct}] in the ORIGINAL order, so the single random draw stays after every other clause (chunk test replays the original order over every input combination and counts draws); gateParams links the flag and chance params to their atoms. The hit-connected rule (hitResult < NO_EFFECT) and the first-strike rule (turnData.hitCount === hitsLeft, the engine's own firstHit test) are kept in the class as guards: the guard registry has no ids for them, so they are listed as feasibility and requested as R-B15-26 (hit-connected, shared) and R-B15-39 (event.after-my-hit does not provide the hits slot, so the existing atom move.hit-index cannot say 'this is the first strike'; once it does, the first-strike rule becomes the condition move.hit-index eq 1, which staff may want to remove, so it is a design condition, not a safety rule). Simulated: apply respects it; canApply draws its random number even when simulated (the rng.chance atom answers true without a draw when simulated), but the only dispatch (move-effect-phase.ts, PostAttackAbAttr) never passes simulated, so behaviour is the same. Suspected oddities, NOT fixed: (1) the Stat Boost sibling has no hit-connected or first-strike check while this one has both, so the two classes disagree on multi-hit moves; (2) the class comment says 'a miss or an immune target does NOT drop the stat', which the hitResult guard does enforce, but a pure miss never reaches the dispatch anyway; (3) the doc comment for Crushing Jaw says 976 while the live ability id is 5677 (ER source id vs game id), harmless.",
});

/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B15 chunk 5. Tier B. "After my attack lands, if the move has a given property (biting, horn, reckless...), I raise one of my own stats."
//
// Source: src/data/elite-redux/abilities/stat-boost-on-flag-attack.ts, class StatBoostOnFlagAttackAbAttr (extends PostAttackAbAttr; constructor takes ONE options object
// { flag, stat, stages }, throws when stages is 0 or not a whole number; showAbility stays true; the base class keeps its DEFAULT attackCondition move.category !== STATUS).
// canApply, now guards && gate && residual in the ORIGINAL clause order (no random draw anywhere):
//   1. super.canApply   attackCondition(holder, target, move) = move.category !== STATUS                -> gate  CONDITION (a damaging move)
//   2. the move property  move.doesFlagEffectApply({ flag, user: holder, target })                        -> gate  CONDITION (the move property, honouring ability overrides)
// There is NO guard and NO residual: unlike the sibling class that lowers a foe's stat, this one does not look at hitResult or at the hit number, so it fires on every strike of a
// multi-hit move (the source comment says the damage outcome does not matter). Both clauses stay in the gate, in the original order.
// apply (effect), not when simulated: queues StatStageChangePhase(holder, selfTarget true, [stat], stages) with unshiftNew. No message of its own, no random draw.
// Refactor (pure move of code, spec 3.1): canApply = gatedCanApply(this, params); gate = clauses 1 and 2 verbatim (super.canApply first). `gateOverride` is declared for the compiler.
import { StatBoostOnFlagAttackAbAttr } from "#data/elite-redux/abilities/stat-boost-on-flag-attack";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";
import { enumCodec } from "#data/elite-redux/ability-studio/param-codecs";
import { MOVE_FLAG_OPTIONS, STAT_OPTIONS } from "#data/elite-redux/ability-studio/vocabulary/enums";
import { MoveFlags } from "#enums/move-flags";
import { Stat } from "#enums/stat";

export default defineDecl(StatBoostOnFlagAttackAbAttr, {
  tier: "B",
  kind: "event-effect",
  when: "event.after-my-hit",
  label: "Raise my stat after using a certain kind of move",
  summary: params =>
    `After I use a damaging move with the "${params.flag}" property, my ${params.stat} changes by ${params.stages} stage(s). Example: Biting moves raise my Attack by 1 stage.`,
  synonyms: [
    "boost after a biting move",
    "attack up after using a horn move",
    "raise attack after hitting",
    "weapon move boost",
    "stat boost on move type",
    "snowball with a move property",
    "growing tooth",
    "hardened sheath",
    "daredevil",
  ],
  examples: [
    "Biting moves raise my Attack by one stage after they land, like Growing Tooth",
    "Reckless moves raise my Attack by one stage, like Daredevil",
  ],
  params: [
    {
      id: "flag",
      ctorIndex: 0,
      ctorOption: "flag",
      path: "flag",
      control: "select",
      label: "Move property that triggers it (for example Biting move)",
      editable: true,
      default: "BITING_MOVE",
      options: MOVE_FLAG_OPTIONS,
      codec: enumCodec(MoveFlags, "move property"),
    },
    {
      id: "stat",
      ctorIndex: 0,
      ctorOption: "stat",
      path: "stat",
      control: "select",
      label: "Which of my stats changes",
      editable: true,
      gateIndependent: true,
      default: "ATK",
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
      label: "Stages to change (1 = one stage up, -1 = one stage down; not 0)",
      editable: true,
      gateIndependent: true,
      default: 1,
    },
  ],
  // The move property lives twice: the flag param and the literal flag of the gate binding. gateParams keeps them equal.
  gateParams: [{ param: "flag", block: "move.flag", field: "flag" }],
  conditions: [
    // The gate is the group [move.damaging, move.flag], in that order.
    { slot: "gate", ctx: "params", removable: true, editable: true },
  ],
  guards: [],
  feasibility: [
    "The stat stops at +6 (or -6); the normal stat change handles that and a stat already at the limit shows its usual message",
    "A number of stages of 0 or a fraction is refused when the ability is built",
    "It does nothing in a preview",
  ],
  effect: { id: "effect.stat-stage", params: ["stat", "stages"] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "none", simulated: "respects" },
  probes: [
    {
      // The holder attacks with Tackle and Bite style moves in the harness: the property clause decides.
      name: "a move with the property and one without",
      axes: { foeMove: ["TACKLE", "WATER_GUN"] },
    },
  ],
  status: "decomposed",
  notes:
    "Tier B, event effect with the library effect effect.stat-stage (target = me, fixed by this class, so no target param; stat and stages are typed params), not a package. 3 attrs in 3 abilities, each bound individually: Growing Tooth (5027 attr 0, Biting move, Attack +1), Hardened Sheath (5129 attr 0, Horn based, Attack +1) and Daredevil (5709 attr 1, Reckless move, Attack +1; attr 0 is another class). The gate is the library group all[move.damaging, move.flag {flag}] (move.flag calls the same Move.doesFlagEffectApply with the holder as user and the other Pokemon as target); gateParams links the flag param to the flag field of that atom. Nothing in canApply is hidden: no guard, no residual, no random draw. Suspected oddities, NOT fixed: (1) there is NO hit-connected check and no first-strike check (the sibling that lowers a foe's stat has both), so every strike of a multi-hit move raises the stat again, and any hit result the dispatch passes counts (the dispatch itself only runs for a move that connected, so the practical gap is small); the source comment calls this intended; (2) the source comment says the proc fires 'even if the move misses', but the engine only dispatches PostAttack from the hit path (applyOnTargetEffects, reached for a HIT check result only), so a pure miss never reaches the class; (3) the class docs name KEEN_EDGE and SOUND_BASED as example flags, but the live users use BITING_MOVE, HORN_BASED and RECKLESS_MOVE.",
});

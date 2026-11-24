/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B15 chunk 5. Tier B. "After my attack lands, if the move is a physical (or special) one, a stat of mine or of the target changes."
//
// Source: src/data/elite-redux/abilities/stat-change-on-category-attack.ts, class StatChangeOnCategoryAttackAbAttr (extends PostAttackAbAttr; constructor takes ONE options
// object { category, stat, stages, target }, throws when stages is 0 or not a whole number; showAbility stays true; the base class keeps its DEFAULT attackCondition
// move.category !== STATUS). canApply, now guards && gate && residual in the ORIGINAL clause order (no random draw anywhere):
//   1. super.canApply   attackCondition(holder, target, move) = move.category !== STATUS     -> gate  CONDITION (a damaging move)
//   2. move.category === category                                                              -> gate  CONDITION (the move category)
// There is NO guard and NO residual: the class does not look at hitResult or at the hit number (unlike the sibling that lowers a stat after a move property), so it fires on every
// strike of a multi-hit move. Both clauses stay in the gate, in the original order.
// apply (effect), not when simulated: subject = target "self" ? holder : the other Pokemon; queues StatStageChangePhase(subject, selfTarget (target === "self"), [stat], stages) with
// unshiftNew. No message of its own, no draw.
// Refactor (pure move of code, spec 3.1): canApply = gatedCanApply(this, params); gate = clauses 1 and 2 verbatim (super.canApply first). `gateOverride` is declared for the compiler.
import { StatChangeOnCategoryAttackAbAttr } from "#data/elite-redux/abilities/stat-change-on-category-attack";
import { defineDecl, type ParamCodec } from "#data/elite-redux/ability-studio/define-decl";
import { enumCodec } from "#data/elite-redux/ability-studio/param-codecs";
import { STAT_OPTIONS } from "#data/elite-redux/ability-studio/vocabulary/enums";
import { MoveCategory } from "#enums/move-category";
import { Stat } from "#enums/stat";

const TARGET_NAMES = ["MYSELF", "THE_TARGET"] as const;
const TARGET_VALUES = ["self", "opponent"] as const;

/** What staff see ("THE_TARGET") and what the constructor wants ("opponent"). */
const targetCodec: ParamCodec = {
  toCtor: value => {
    const index = TARGET_NAMES.indexOf(String(value) as (typeof TARGET_NAMES)[number]);
    if (index < 0) {
      throw new Error(`"${String(value)}" is not a choice (myself or the target)`);
    }
    return TARGET_VALUES[index];
  },
  fromInstance: raw => {
    const index = TARGET_VALUES.indexOf(raw as (typeof TARGET_VALUES)[number]);
    return index < 0 ? undefined : TARGET_NAMES[index];
  },
};

export default defineDecl(StatChangeOnCategoryAttackAbAttr, {
  tier: "B",
  kind: "event-effect",
  when: "event.after-my-hit",
  label: "Change a stat after using a physical or special move",
  summary: params =>
    `After I use a damaging ${params.category} move, the stat ${params.stat} of ${params.target} changes by ${params.stages} stage(s). Example: physical moves lower the target's Defense by 1.`,
  synonyms: [
    "lower defense after a physical move",
    "stat drop on physical attacks",
    "special attacks lower special defense",
    "debuff by move category",
    "raise my attack after a special move",
    "armor shred",
    "whiplash",
  ],
  examples: [
    "Physical moves lower the target's Defense by one stage, like Whiplash",
    "Special moves raise my Sp. Atk by one stage after they land",
  ],
  params: [
    {
      id: "category",
      ctorIndex: 0,
      ctorOption: "category",
      path: "category",
      control: "select",
      label: "Move category that triggers it (Physical or Special)",
      editable: true,
      default: "PHYSICAL",
      options: ["PHYSICAL", "SPECIAL"],
      codec: enumCodec(MoveCategory, "move category"),
    },
    {
      id: "stat",
      ctorIndex: 0,
      ctorOption: "stat",
      path: "stat",
      control: "select",
      label: "Which stat changes",
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
      id: "target",
      ctorIndex: 0,
      ctorOption: "target",
      path: "target",
      control: "select",
      label: "Whose stat changes",
      editable: true,
      gateIndependent: true,
      default: "THE_TARGET",
      options: [...TARGET_NAMES],
      codec: targetCodec,
    },
  ],
  // The category lives twice: the category param and the literal category of the gate binding. gateParams keeps them equal.
  gateParams: [{ param: "category", block: "move.category", field: "category" }],
  conditions: [
    // The gate is the group [move.damaging, move.category], in that order.
    { slot: "gate", ctx: "params", removable: true, editable: true },
  ],
  guards: [],
  feasibility: [
    "The stat stops at -6 (or +6); the normal stat change handles that, and Clear Body, Mist and Contrary still apply",
    "A number of stages of 0 or a fraction is refused when the ability is built",
    "It does nothing in a preview",
  ],
  effect: { id: "effect.stat-stage", params: ["target", "stat", "stages"] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "none", simulated: "respects" },
  probes: [
    {
      // Tackle is physical, Water Gun special: the category clause decides.
      name: "a physical move and a special move",
      axes: { foeMove: ["TACKLE", "WATER_GUN"] },
    },
  ],
  status: "decomposed",
  notes:
    "Tier B, event effect with the library effect effect.stat-stage (stat, stages and whose stat are typed params), not a package. 1 attr in 1 ability: Whiplash (5425 attr 0, Physical, Defense -1, target the opponent; archetype-dispatcher.ts builds it). The gate is the library group all[move.damaging, move.category {category}] (move.category compares move.category to the category exactly like the class); gateParams links the category param to that atom. The target choice is a codec: staff see MYSELF or THE_TARGET, the constructor gets self or opponent. Nothing in canApply is hidden: no guard, no residual, no draw. Suspected oddities, NOT fixed: (1) no hit-connected or first-strike check (the property sibling has both), so a multi-hit physical move lowers Defense on every strike; (2) the base condition already excludes status moves, so the category param can only usefully be Physical or Special (the options list only those two); (3) target 'self' and a positive stages is a valid but unused shape (a self boost by move category).",
});

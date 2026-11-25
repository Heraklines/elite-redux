/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B10 / calc-modifier (Tier C, read by name).
//
// The class extends only AbAttr and is never dispatched through applyAbAttrs. The engine finds it BY CLASS NAME in
// Pokemon.getAttackTypeEffectiveness (field/pokemon.ts, "ER OFFENSIVE type-chart overrides"), for an attacker that is known
// and whose ability is not ignored, and calls `fire(moveType, defenderTypes, multi)` only when the attr has no
// condition or its condition (the holder-side `addCondition`, for example "I am Dragon type" on Draconize / Draconic
// Might) is true for the attacker. The WHEN `calc.my-type-chart-override` carries the class name as its dispatch key.
//
// What the class is (read from the source): one constructor argument `{ rules }`, an ordered list of
// { attackType, defenderType, newMultiplier }, no closure, no random draw. `fire` takes the FIRST rule whose attack type is the
// move's type and whose defender type is one of the defender's types, then:
//     natural = chart(moveType, defenderType)
//     natural === 0 (an immunity): multi = (product of the OTHER defender types, one occurrence consumed) * newMultiplier
//     otherwise:                   multi = (multi / natural) * newMultiplier   (only that type's part is replaced)
// `getRules()` is a test seam.
//
// The rule is split into its three parts, each its own setting: my move's type, the target's type (up to three, for the one live
// ability that lists three) and the new multiplier. Clause classification of the loop in `fire`:
//   condition   "my move is of type X"            (library atom move.type)
//   condition   "the target has type Y"           (library atom mon.has-type, who: other)
//   effect      replace the part of the matchup that comes from Y by the multiplier (request R-B10-15, no library effect yet)
// The engine calls `fire` with a move TYPE and a list of types, not a frame with a move and a target, so the two conditions
// cannot be compiled into a library gate yet; they are listed as the branch below, and the effect is the one piece the library
// lacks. `assembleCtorArg` builds the `{ rules }` argument from the settings.
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";
import { TYPE_OPTIONS } from "#data/elite-redux/ability-studio/vocabulary/enums";
import { OffensiveTypeChartOverrideAbAttr } from "#data/elite-redux/archetypes/offensive-type-chart-override";
import {
  buildMatchupRules,
  matchupAttackTypeCodec,
  matchupMultiplierCodec,
  matchupTargetCodec,
  NO_TYPE,
} from "./b10-codecs";

const IN_RULES = { ctorIndex: 0, path: "rules" } as const;

export default defineDecl(OffensiveTypeChartOverrideAbAttr, {
  tier: "C",
  kind: "calc-modifier",
  when: "calc.my-type-chart-override",
  label: "Change how my moves match up against a type",
  summary: params =>
    `My ${params.attackType} moves hit a ${params.targetType} target for x${params.multiplier}, even through an immunity. Example: Poison against Steel with 2 = super effective.`,
  synonyms: [
    "super effective against",
    "hit immune types",
    "pierce immunity",
    "change type matchup",
    "corrosion",
    "molten down",
    "ground shock",
    "draconize",
  ],
  examples: ["My Fire moves are super effective against Rock types, like Molten Down"],
  params: [
    {
      id: "attackType",
      ...IN_RULES,
      ctorOption: "attackType",
      control: "select",
      label: "Type of my move",
      editable: true,
      default: "POISON",
      options: TYPE_OPTIONS,
      codec: matchupAttackTypeCodec,
    },
    {
      id: "targetType",
      ...IN_RULES,
      ctorOption: "targetType",
      control: "select",
      label: "Type the target must have",
      editable: true,
      default: "STEEL",
      options: TYPE_OPTIONS,
      codec: matchupTargetCodec(0),
    },
    {
      id: "targetType2",
      ...IN_RULES,
      ctorOption: "targetType2",
      control: "select",
      label: "Another target type that gets the same change (None = no other type)",
      editable: true,
      default: NO_TYPE,
      options: [NO_TYPE, ...TYPE_OPTIONS],
      codec: matchupTargetCodec(1),
    },
    {
      id: "targetType3",
      ...IN_RULES,
      ctorOption: "targetType3",
      control: "select",
      label: "A third target type that gets the same change (None = no other type)",
      editable: true,
      default: NO_TYPE,
      options: [NO_TYPE, ...TYPE_OPTIONS],
      codec: matchupTargetCodec(2),
    },
    {
      id: "multiplier",
      ...IN_RULES,
      ctorOption: "multiplier",
      control: "number",
      min: 0,
      max: 4,
      step: 0.25,
      label: "Damage multiplier against that type (0 = no damage, 0.5 = resisted, 1 = neutral, 2 = super effective)",
      editable: true,
      default: 2,
      codec: matchupMultiplierCodec,
    },
  ],
  assembleCtorArg: { index: 0, build: buildMatchupRules },
  conditions: [],
  guards: [],
  feasibility: [
    "Only the part of the matchup that comes from the chosen target type is replaced: a second type on the target still counts",
    "Only the first matching matchup in the list is used",
    "Does not work while my ability is being ignored (for example by a Mold Breaker foe)",
  ],
  branches: [
    {
      label: "Replace the matchup against the chosen type",
      conditions: [
        "my move is of the chosen type (move.type)",
        "the target has the chosen type (mon.has-type, who = other)",
      ],
      effect: { id: "effect.package", params: ["multiplier"] },
    },
  ],
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "none", simulated: "respects" },
  probes: [{ name: "my move against a target of the chosen type, alone and paired with another type", axes: {} }],
  l2StaticReason:
    "The class is read by a by-name scan in the type-effectiveness calculation, not dispatched, so no trace event shows it evaluated. The B10 test (test/tests/elite-redux/decomp/B10/offensive-type-chart-override.test.ts) rebuilds every live user and compares fire() over every attack type against every single and dual defender typing.",
  status: "decomposed",
  notes:
    "Tier C. The rule is three settings (my move's type, the target's type, the multiplier) plus up to two more target types; there is no rules sentence. The two conditions of the loop in fire() ('my move is of this type', 'the target has this type') are written as the branch and map to move.type and mon.has-type, but cannot be compiled as a library gate because the engine scan passes a type and a type list, not a frame (request R-B10-c1-06 asks for a frame, or the effect R-B10-15 with both conditions built in); the replace-the-matchup effect has no library block (R-B10-15). Users (26 attrs on 17 abilities in the inventory): Acidic Slime, Corrosion, Corrupted Mind, Depravity, Draconic Might, Draconize, Dragonfruit, Extermination Vector, Ground Shock, Komodo, Magma Eater, Molten Down, Overcharge, Overwhelm, Pyroclastic Flow, Trash Heap and Tummyache; one rule each except Corrupted Mind (my Psychic moves against Steel, Psychic and Dark at 1). Nothing to bind: the only closure is the attr-level holder condition set with addCondition (Draconize, Draconic Might), which recomposeAttr copies, not a constructor argument. Representable limits: all rules of one attr share one move type and one multiplier (every live one does). Oddity, not fixed: when the target has the same type twice only one occurrence is consumed for an immunity. WHEN `calc.my-type-chart-override` was added to the library by this batch (R-B10-03, should have been a request); the merge captain should fold it with B08's `calc.my-attack-matchup` if the owner wants one moment.",
});

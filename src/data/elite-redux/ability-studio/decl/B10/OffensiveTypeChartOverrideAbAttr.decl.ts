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
// Might) is true for the attacker. The new WHEN `calc.my-type-chart-override` carries the class name as its dispatch key.
//
// What the class is (read from the source): one constructor argument `{ rules }`, an ordered list of
// { attackType, defenderType, newMultiplier }, no closure, no random draw. `fire` takes the FIRST rule whose attack type is the
// move's type and whose defender type is one of the defender's types, then:
//     natural = chart(moveType, defenderType)
//     natural === 0 (an immunity): multi = (product of the OTHER defender types, one occurrence consumed) * newMultiplier
//     otherwise:                   multi = (multi / natural) * newMultiplier   (only that type's part is replaced)
// `getRules()` is a test seam.
//
// The rules are edited as ONE sentence ("Poison > Steel = 2; Fire > Rock = 2"), see b10-codecs.ts: a declared param fills one
// constructor slot, and the class reads one list. The engine's attr-level condition is honoured, so extra IFs may be ANDed on.
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";
import { OffensiveTypeChartOverrideAbAttr } from "#data/elite-redux/archetypes/offensive-type-chart-override";
import { matchupRulesCodec } from "./b10-codecs";

export default defineDecl(OffensiveTypeChartOverrideAbAttr, {
  tier: "C",
  kind: "calc-modifier",
  when: "calc.my-type-chart-override",
  label: "Change how my moves match up against a type",
  summary: () =>
    "My moves use the damage multiplier you set against a target that has the chosen type, even through an immunity. Example: Poison > Steel = 2 makes my Poison moves super effective on Steel types.",
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
      id: "rules",
      ctorIndex: 0,
      ctorOption: "rules",
      path: "rules",
      control: "text",
      label: "Matchups to change: my move type > target type = new multiplier (separate several with ;)",
      editable: true,
      default: "Poison > Steel = 2",
      codec: matchupRulesCodec,
    },
  ],
  conditions: [],
  guards: [],
  feasibility: [
    "Only the part of the matchup that comes from the chosen target type is replaced: a second type on the target still counts",
    "Only the first matching matchup in the list is used",
    "Does not work while my ability is being ignored (for example by a Mold Breaker foe)",
  ],
  effect: { id: "effect.package", params: ["rules"] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "none", simulated: "respects" },
  probes: [{ name: "my move against a target of the chosen type, alone and paired with another type", axes: {} }],
  l2StaticReason:
    "The class is read by a by-name scan in the type-effectiveness calculation, not dispatched, so no trace event shows it evaluated. The B10 test (test/tests/elite-redux/decomp/B10/offensive-type-chart-override.test.ts) rebuilds every live user and compares fire() over every attack type against every single and dual defender typing.",
  status: "decomposed",
  notes:
    "Tier C. Users (26 attrs on 17 abilities in the inventory): Acidic Slime, Corrosion, Corrupted Mind, Depravity, Draconic Might, Draconize, Dragonfruit, Extermination Vector, Ground Shock, Komodo, Magma Eater, Molten Down, Overcharge, Overwhelm, Pyroclastic Flow, Trash Heap and Tummyache; one rule each except the Psychic one with three rules (Steel, Psychic and Dark at 1). Nothing to bind: the only closure is the attr-level holder condition set with addCondition (Draconize, Draconic Might), which recomposeAttr copies, not a constructor argument. Oddity, not fixed: when the target has the same type twice only one occurrence is consumed for an immunity. WHEN `calc.my-type-chart-override` was added to the library by this batch (R-B10-03); the merge captain should fold it with B08's `calc.my-attack-matchup` if the owner wants one moment.",
});

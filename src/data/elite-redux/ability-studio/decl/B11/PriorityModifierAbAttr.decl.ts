/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B11 chunk 2 / calc-modifier (Tier B: the move filter and the HP or turn condition are built INSIDE the constructor, so they are the gate).
//
// Read by hand from archetypes/priority-modifier.ts and ChangeMovePriorityAbAttr in ab-attrs.ts. WHEN "while the game calculates my move's
// priority" (Move.getPriority: `applyAbAttrs("ChangeMovePriorityAbAttr", { pokemon: user, simulated, move, priority })`). Constructor: ONE
// options object `{ priority, filter?, condition? }`; the class turns `filter` and `condition` into the private predicate it hands to the
// parent (`moveFunc`), and `canApply` of the parent just runs it.
//   canApply is now the gate alone (nothing is left as a residual), in the ORIGINAL clause order:
//     gate: matchesFilter(filter, holder, move) && matchesCondition(condition, holder)
//       matchesFilter, in this order, each test only when the option is set:
//         type          `holder.getMoveType(move) === type`                  (the move's type AFTER ability changes)
//         flag          `move.hasFlag(flag)`                                  (the move's own bit, not the injected flags)
//         maxBasePower  `move.power <= maxBasePower`  (a status move has power -1, so it always qualifies)
//         maxAccuracy   `move.accuracy >= 0 && move.accuracy < maxAccuracy`  (an always-hit move, accuracy -1, never qualifies)
//       matchesCondition: always: true;  full-hp: `holder.isFullHp()`;  low-hp: `holder.getHpRatio() <= threshold` (default 0.5, the
//         ROUNDED ratio);  first-turn: `holder.tempSummonData.waveTurnCount === 1`
//   apply (the parent's): `priority.value += changeAmount`. No random draw, no message, nothing to preview.
//
// Every filter option and every condition is a rule staff would change, so the gate is all conditions; the amount is the one setting
// staff edit. The two other settings (`movesBuiltFor`, `whenBuiltFor`) are NOT editable: the class keeps its two option objects in
// fields of their own and the identity check compares them, so a rebuilt rule starts from the same words the shipped one was built
// with (each word is exactly one object shape a live ability uses). Once the gate is replaced they have no effect on the rule.
// The 18 users are read from the live attrs (bindings.ts): 13 map completely to library atoms (a move type, a base power limit, and full
// HP); 3 filter by a move property (punching, sound) and 2 by accuracy, for which the library has no matching atom (requests
// R-B11-13 of chunk 3 for the plain move property and R-B11-C2-09 for accuracy), so those 5 gates stay legacy closures. The effect is the
// library block effect.change-priority.
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";
import { PriorityModifierAbAttr } from "#data/elite-redux/archetypes/priority-modifier";
import {
  HOLDER_CONDITION_OPTIONS,
  holderConditionCodec,
  MOVE_FILTER_OPTIONS,
  moveFilterCodec,
  priorityChangeCodec,
} from "./b11-chunk2-codecs";

export default defineDecl(PriorityModifierAbAttr, {
  tier: "B",
  kind: "calc-modifier",
  when: "calc.priority",
  label: "Change my matching moves' priority (go earlier or later)",
  summary: params =>
    `My moves that pass the conditions get ${params.priority} priority: above 0 goes earlier in the turn, below 0 later. Example: +1 for Flying moves, like Gale Wings.`,
  synonyms: [
    "gale wings",
    "prankster",
    "go first",
    "priority boost",
    "move last",
    "negative priority",
    "extra priority at full HP",
    "quick",
  ],
  examples: [
    "Fire moves get +1 priority while I am at full HP, like Flaming Soul",
    "Moves with less than 80% accuracy go 3 priority later, like Sighting System",
  ],
  params: [
    {
      id: "priority",
      ctorIndex: 0,
      ctorOption: "priority",
      path: "priorityDelta",
      control: "number",
      min: -7,
      max: 7,
      step: 1,
      integer: true,
      label: "Priority change (+1 = goes a step earlier, -1 = a step later, 0 is not allowed)",
      editable: true,
      // Only the effect (the parent's apply) reads it; no gate binding repeats it.
      gateIndependent: true,
      default: 1,
      codec: priorityChangeCodec,
    },
    {
      id: "movesBuiltFor",
      ctorIndex: 0,
      ctorOption: "filter",
      path: "filter",
      control: "select",
      label: "Which of my moves it was built for (shown for information; change it with the conditions)",
      // The move rule is the condition block (the gate), and staff change THAT. This setting only records what the shipped rule
      // was built with, because the class keeps it in a field of its own.
      editable: false,
      default: "Any move",
      options: MOVE_FILTER_OPTIONS,
      codec: moveFilterCodec,
    },
    {
      id: "whenBuiltFor",
      ctorIndex: 0,
      ctorOption: "condition",
      path: "condition",
      control: "select",
      label: "When it was built to work (shown for information; change it with the conditions)",
      editable: false,
      default: "Always",
      options: HOLDER_CONDITION_OPTIONS,
      codec: holderConditionCodec,
    },
  ],
  conditions: [
    // The whole filter-and-condition rule. Shipped users: a move type, with or without "I am at full HP" (move.type, hp.full), a base power
    // limit (move.power), or a move property / accuracy limit (legacy closures, see the header).
    { slot: "gate", ctx: "params", lib: "move.type", removable: true, editable: true },
  ],
  guards: [],
  feasibility: [],
  effect: { id: "effect.change-priority", params: ["priority"] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "none", simulated: "ignores" },
  probes: [
    {
      // Full HP and one HP below it (the full-HP users), and moves of every shape the grid has.
      name: "full HP, one below full and half HP, with a damaging, a status and a priority move",
      axes: { hp: ["max", "max-1", "50%"], foeMove: ["TACKLE", "EMBER"] },
    },
  ],
  status: "decomposed",
  notes:
    "Tier B, justified in the header. 18 users, the gate bound for each: Galeforce Wings (5624) and Sky Sovereign (20023, attr 0): Flying, always; Flaming Soul (5089), Flame Bubble (5368 attr 4): Fire, full HP; Frozen Soul (5100): Ice; Volt Rush (5166) and Ultra Recon Hunter (20002 attr 1): Electric; Early Grave (5251): Ghost; Stygian Rush (5279): Dark; Tidal Rush (5281) and Ebb and Flow (6073): Water; Pretty Privilege (5332): Fairy (all full HP); Perfectionist (5026 attr 1): power at most 25. Legacy closures: Blitz Boxer (5015) punching moves at full HP, Presto (5468) and Siren's Song (20015) sound moves at full HP (the plain move property, request R-B11-13); Sighting System (5106 attr 1) and Iron Barrage (5132 attr 2): accuracy below 80, priority -3 (request R-B11-C2-09). The `low-hp` and `first-turn` conditions are in the class but no live ability uses them; low-hp reads the ROUNDED ratio (`getHpRatio()` rounds to 2 decimals), which no integer atom reproduces exactly, so a future user needs a decision. The class used to hand its predicate to the parent (`moveFunc`); the parent's field is still built the same way but `canApply` is now the class's own gatedCanApply, so the constructor and `attrs[]` are unchanged.",
});

/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B12 chunk 3. "Some of my moves get more power" (the boost half of Crystallize, Sand Song, Spectral Shroud, Superconductor...).
//
// Source: src/data/elite-redux/archetypes/type-conversion.ts, TypeConversionPowerBoostAbAttr (extends MovePowerBoostAbAttr).
// Constructor: one options object `{ source, multiplier }`, the same `source` filter as the type change next to it; it throws for a multiplier
// that is not above 0 or an empty property. It hands the parent `matchesSource(source, user, move)` and the multiplier, with showAbility off.
// Dispatched while a move's power is calculated (applyAbAttrs("MovePowerBoostAbAttr")). Clauses (Tier B):
//   canApply  `matchesSource(source, user, move)`   GATE (replaceable), the whole old canApply: the move's OWN type is the source type, or it has
//             the source property (and the source type, when one is named). It never asks the move's type after other abilities changed it
//   apply     `power.value *= multiplier`           EFFECT (calc), the parent's apply
// No random draw, no state, no `simulated` test.
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";
import { TypeConversionPowerBoostAbAttr } from "#data/elite-redux/archetypes/type-conversion";
import { conversionSourceCodec } from "./b12-chunk3-codecs";

const IN_OPTIONS = { ctorIndex: 0 } as const;

export default defineDecl(TypeConversionPowerBoostAbAttr, {
  tier: "B",
  kind: "calc-modifier",
  when: "calc.move-power",
  label: "Make my moves of one type or kind stronger (ate-ability power)",
  summary: params => {
    const source = String(params.source);
    const moves = /moves/i.test(source) ? source : `${source} moves`;
    return `My ${moves} get ${params.multiplier} times their power. Example: Sound moves get 1.2 times their power, like Sand Song.`;
  },
  synonyms: [
    "aerilate boost",
    "ate boost",
    "sound moves stronger",
    "normal moves stronger",
    "power boost for converted moves",
    "sand song",
    "crystallize",
    "extra power for one kind of move",
  ],
  examples: [
    "Sound moves get 1.2 times their power, like Sand Song",
    "Rock moves get 1.1 times their power, like Crystallize",
  ],
  params: [
    {
      id: "source",
      ...IN_OPTIONS,
      ctorOption: "source",
      path: "source",
      control: "text",
      label: "Which moves get stronger, like 'Normal' or 'Sound moves'",
      // It decides the shape of the gate, which staff change with the move blocks.
      editable: false,
      default: "Normal",
      codec: conversionSourceCodec,
    },
    {
      id: "multiplier",
      ...IN_OPTIONS,
      ctorOption: "multiplier",
      path: "multiplier",
      control: "number",
      min: 0.1,
      max: 4,
      step: 0.05,
      label: "Power multiplier (1.2 = 20% stronger)",
      editable: true,
      // Only the effect reads it; the gate (which moves) never repeats it.
      gateIndependent: true,
      default: 1.1,
    },
  ],
  conditions: [
    // The gate: the move's own type is the source type, or it has the source property (and the source type, when one is named).
    // Type sources map to move.type { effective: false }; property sources need R-B12-04 (the plain property atom), so those users are legacy.
    { slot: "gate", ctx: "params", removable: true, editable: true },
  ],
  guards: [],
  feasibility: [
    "The move's own type is checked, before any other ability changes it",
    "Moves that deal fixed damage are not changed by a power boost",
  ],
  effect: { id: "effect.multiply-power", params: ["multiplier"] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "none", simulated: "ignores" },
  probes: [
    {
      name: "the holder's moves of the source types and properties",
      axes: {},
    },
  ],
  l2StaticReason:
    "The shared L2 reports calc.move-power as unreached (it is dispatched under VariableMovePowerAbAttr, see R-B12-19) although the twins are identical; B12's own test (B12/chunk3.test.ts) runs the class on the original and the rebuild for every move of the game and checks the power.",
  status: "decomposed",
  notes:
    "Tier B, 10 attrs. Type sources, gate bound to move.type { effective: false } (4 attrs): Crystallize (5018 attr 1, Rock, x1.1), Bejeweled (6111 attr 1, Rock, x1.1), Superconductor (5363 attr 1, Steel, x1.1), Spectral Shroud (5124 attr 1, Normal, x1.2). Property sources, every gate a legacy-closure pending request R-B12-04 (6 attrs): Sand Song (5012 attr 1), Banshee (5268 attr 1), Snow Song (5328 attr 1) and Power Metal (5361 attr 1) boost every Sound move x1.2 whatever its type, Grievous Spear (5959 attr 1) and Grim Jab (5964 attr 1) boost Drill moves that are Normal x1.2. The old canApply is the whole gate. Oddities, not fixed: (a) for the four sound abilities the boost is wider than the conversion next to it (every sound move, not only Normal ones); (b) the boost reads the move's base type, so after a conversion ability on the same Pokemon changed the type it still matches by the ORIGINAL type, which is the intended pairing; (c) abilities that carry this boost as well as a second type boost (a 'same type as me' ate rule) multiply both.",
});

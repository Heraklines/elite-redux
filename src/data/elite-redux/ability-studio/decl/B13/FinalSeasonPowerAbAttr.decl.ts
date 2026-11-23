/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// Final Season, part 3 of 3 (Tier B, calc-modifier). "In my own Eerie Fog, my Dark and Flying moves have 1.3x power."
//
// Source: abilities/newcomer-signature-mechanics.ts, FinalSeasonPowerAbAttr (MovePowerBoostAbAttr, constructor takes
// NO arguments and hands the base class a hidden closure plus the multiplier 1.3). The closure was four clauses:
//   1. finalSeasonFogOwner === holder
//   2. finalSeasonFogInstance === arena.weather          (still the very same fog the holder set)
//   3. arena.weatherType === EERIE_FOG                    -> library atom field.weather {EERIE_FOG}
//   4. [DARK, FLYING].includes(holder.getMoveType(move))  -> library atoms any(move.type DARK, move.type FLYING)
// Because the constructor takes no argument, a "ctor:0" closure slot is impossible; this is a Tier B class. The
// closure is now two shared module functions used by BOTH the constructor and the split, with the ORIGINAL clause
// order: `guards` = clauses 1 and 2 (private memory, no library atom: they stay in the class and are listed as
// "also requires"), `gate` = clauses 3 and 4 (swappable library conditions). No RNG, no side effects.
// apply is the base class's: power *= 1.3.
import { FinalSeasonPowerAbAttr } from "#data/elite-redux/abilities/newcomer-signature-mechanics";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";

export default defineDecl(FinalSeasonPowerAbAttr, {
  tier: "B",
  kind: "calc-modifier",
  when: "calc.move-power",
  label: "Boost Dark and Flying moves by 1.3x in my own Eerie Fog",
  summary: () =>
    "While the Eerie Fog on the field is the one I set, my Dark and Flying moves have 1.3x power. Example: a 100 power Dark move becomes 130.",
  synonyms: ["weather power boost", "fog boost", "dark and flying boost", "own weather bonus", "final season"],
  examples: ["Dark and Flying moves are 30% stronger while my own Eerie Fog is up"],
  params: [],
  noParamsReason:
    "The class has no constructor arguments: the 1.3x multiplier is passed to the base class by the constructor itself. Staff reach the same behaviour with a composed rule (a move-power trigger, a weather condition, a move-type condition and the multiply-power block set to 1.3).",
  conditions: [
    // Clauses 3 and 4 of the original closure, in order: the weather is Eerie Fog, the move is Dark or Flying.
    { slot: "gate", ctx: "params", removable: true, editable: true },
  ],
  guards: [],
  feasibility: [
    "The Eerie Fog on the field must be the one I set myself and still the same fog (checked inside the class until a library condition exists)",
  ],
  effect: { id: "effect.multiply-power", params: [] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "battle", simulated: "respects" },
  l2StaticReason:
    "The trigger's registered dispatch key (MovePowerBoostAbAttr) is never dispatched by the engine, which dispatches VariableMovePowerAbAttr, so the shared reach probe cannot see it (decomp-l2-reach.json). The twin still shows the original evaluating this attr when a damaging move is used, and B13/final-season.test.ts drives the real fog flow.",
  probes: [
    {
      // The default grid has no Eerie Fog owner, so the closure is false everywhere; the fog case is in B13/final-season.test.ts.
      name: "damaging moves of different types without a fog of my own",
      axes: { weather: ["EERIE_FOG"] },
    },
  ],
  status: "decomposed",
  notes:
    "Users: Final Season (5972, attr 2). Clauses 3 and 4 are bound to library atoms (bindings.ts); clauses 1 and 2 (fog owner and fog instance, module-level variables written by FinalSeasonFogAbAttr) need a new atom, requested as `field.weather-set-by-me` in requests/B13.md. Until then they are the class's `guards`, which run before the gate exactly as the original clauses did. The multiplier 1.3 is hidden in the constructor call, not an argument, so it is not a param here; the L1 differential compares the original gate with the rebuilt one over the grid and B13/final-season.test.ts proves the positive case (an owned fog) with draws counted.",
});

/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B11 chunk 4 / event-effect with memory (Tier B: both clauses of canApply are the gate).
//
// Read by hand from archetypes/self-switch-on-stat-lower.ts. PostStatStageChange hook (WHEN "when one of my stats changes"), no
// constructor arguments, the default banner. It owns a `ForceSwitchOutHelper(SwitchType.SWITCH)`.
//   canApply is now `gate` alone (no guard, no residual), in the ORIGINAL clause order:
//     1. `pokemon.waveData.entryEffectsFired.has("erTacticalRetreat.used")` -> false   (CONDITION: time.once-per, wave memory)
//     2. `stages < 0`  (any stat was LOWERED, self-inflicted drops included)           (CONDITION: stage.just-changed, lowered)
//   apply: simulated -> nothing. Else add the key to `entryEffectsFired` (the memory), then `helper.switchOutLogic(holder)`.
//   No random draw. The memory is the per-wave Set the ER once-per-wave archetypes share, which is exactly what the library atom
//   time.once-per (scope wave) reads and writes, so the class and its library form share ONE memory.
//
// The effect is the library effect.force-switch-out. That effect carries the Wimp Out guards, which this class does not apply
// (it has no guard at all), so none is listed here.
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";
import { SelfSwitchOnStatLowerAbAttr } from "#data/elite-redux/archetypes/self-switch-on-stat-lower";

export default defineDecl(SelfSwitchOnStatLowerAbAttr, {
  tier: "B",
  kind: "event-effect",
  when: "event.stat-changed",
  label: "Switch out the first time one of my stats drops",
  summary: () =>
    "The first time in a battle that one of my stats is lowered (even by my own move), I switch out. Example: an Intimidate drop sends me back to the party.",
  synonyms: [
    "eject button",
    "tactical retreat",
    "flee when stats drop",
    "retreat on drop",
    "pivot on stat drop",
    "run away when lowered",
  ],
  examples: ["Switch out once per battle when a stat is lowered", "Retreat the first time I get Intimidated"],
  params: [],
  noParamsReason:
    "The class has no constructor argument: the once-per-battle memory key and the lowered-stat test are fixed in the class. Staff change the behaviour by swapping the condition blocks (a different drop size, another memory scope), not through a setting.",
  conditions: [{ slot: "gate", ctx: "params", lib: "stage.just-changed", removable: true, editable: true }],
  guards: [],
  feasibility: [
    "Never in a preview",
    "The switch can fail like any switch (nothing to switch to, or something traps me)",
  ],
  effect: { id: "effect.force-switch-out", params: [] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "battle", simulated: "respects" },
  probes: [
    {
      name: "a stat drop at full and half HP",
      axes: { hp: ["max", "50%"] },
    },
  ],
  status: "decomposed",
  notes:
    "Tier B, justified in the header. Only user: Tactical Retreat (5282). The gate binding is all[time.once-per wave 'erTacticalRetreat.used', stage.just-changed lowered], in the class order (memory first). `stage.just-changed` lowered is `frame.stages < 0`, the class tests `params.stages < 0` (the frame reads `raw.stages`). The class marks the memory in `apply` itself and so does the library gate (its commit runs just before apply), writing the same key twice, which is harmless. Memory is proven by test/tests/elite-redux/decomp/B11/chunk4.test.ts (a used key blocks both versions; apply writes it; a simulated call writes nothing). Remark, NOT fixed: a rebuilt instance shares no state with the original except the per-wave Set, which is the intended single memory.",
});

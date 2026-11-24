/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B04 chunk 3 / Tier A calc-modifier, one setting (the roll percent), no closure (Bad Luck, Bad Omen, Scarecrow).
//
// Class (ab-attrs.ts:4252): `constructor() { super(false) }` and one override:
//   constructor(rollPercent = 85): optional trailing argument added in this chunk (every user passes nothing, so 85).
//   apply      `rollMultiplier.value = rollPercent / 100` -> the EFFECT: the random damage spread of an attack AGAINST the holder
//              is forced to this value (85 / 100 is exactly the old literal 0.85, so behaviour is unchanged).
//              There is NO canApply override (the default answers true): no condition, no guard.
// Dispatch: pokemon.ts:6085 in `getAttackDamage`, with `this` the DEFENDER, ONLY when `!simulated`:
//   const randomMultiplierHolder = new NumberHolder(forcedRandomMultiplier ?? (simulated ? 1 : this.randBattleSeedIntRange(85, 100) / 100));
//   if (!simulated) applyAbAttrs("EnemyMinDamageRollAbAttr", { pokemon: this, simulated, rollMultiplier: randomMultiplierHolder });
// RNG: the spread is drawn FIRST (`randBattleSeedIntRange(85, 100)`) and the class then overwrites the value, so a Bad Luck
// holder consumes the same random numbers as any other. The class draws nothing itself. A forced roll
// (`forcedRandomMultiplier`) is overwritten too.
// Library effect: effect.set-damage-roll (modifies rollMultiplier), added with this chunk; no existing effect fixes the spread
// (multiply-damage-taken scales the finished number, which gives different results).
import { EnemyMinDamageRollAbAttr } from "#abilities/ab-attrs";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";

export default defineDecl(EnemyMinDamageRollAbAttr, {
  tier: "A",
  kind: "calc-modifier",
  when: "calc.damage-roll",
  label: "Make foes always roll the lowest damage against me",
  summary: params =>
    `Attacks against me always use the same damage roll, ${params.rollPercent}% of the top value, instead of a random 85 to 100%. Example: at 85%, a hit that could do 85 to 100 damage does 85.`,
  synonyms: [
    "bad luck",
    "bad omen",
    "scarecrow",
    "lowest damage roll",
    "minimum damage roll",
    "foes roll low",
    "always minimum damage",
  ],
  examples: ["Foes always deal their minimum damage to me, like Bad Luck"],
  params: [
    {
      id: "rollPercent",
      ctorIndex: 0,
      path: "rollPercent",
      control: "slider",
      min: 85,
      max: 100,
      step: 1,
      label: "Damage roll (percent of the top value)",
      editable: true,
      default: 85,
    },
  ],
  conditions: [],
  guards: [],
  feasibility: [
    "Damage previews (calculations that only look ahead) never use the damage roll, so this block does nothing there",
  ],
  effect: { id: "effect.set-damage-roll", params: ["rollPercent"] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "none", simulated: "respects" },
  probes: [
    {
      name: "a foe hits me with a physical and a special move",
      axes: { foeMove: ["BITE", "WATER_GUN"] },
    },
  ],
  status: "decomposed",
  notes:
    "The 85 floor is the typed setting rollPercent (optional trailing constructor argument, default 85; apply writes rollPercent / 100, identical to the old literal 0.85). The trigger is a separate swappable WHEN (`calc.damage-roll`), there is no condition inside. Users (live dump): Bad Luck (id 5072, attr 3), Bad Omen (id 5375, attr 1), Scarecrow (id 5522, attr 4); Bad Luck and Bad Omen are also built by archetype-dispatcher.ts (lines 5047 and 5118). The call is gated by `!simulated`, so damage previews use the neutral roll of 1 (the preview is not the 85% floor): harmless, noted, not fixed.",
});

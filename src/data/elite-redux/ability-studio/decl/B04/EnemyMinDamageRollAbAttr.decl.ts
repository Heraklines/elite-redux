/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B04 chunk 3 / Tier A calc-modifier, no setting, no closure (Bad Luck, Bad Omen, Scarecrow). The effect is a package.
//
// Class (ab-attrs.ts:4252): `constructor() { super(false) }` and one override:
//   apply      `rollMultiplier.value = 0.85` -> the EFFECT: the random damage spread of an attack AGAINST the holder is forced to
//              its floor. The 0.85 is a literal inside `apply`, not a constructor argument, so it cannot be a setting.
//              There is NO canApply override (the default answers true): no condition, no guard.
// Dispatch: pokemon.ts:6085 in `getAttackDamage`, with `this` the DEFENDER, ONLY when `!simulated`:
//   const randomMultiplierHolder = new NumberHolder(forcedRandomMultiplier ?? (simulated ? 1 : this.randBattleSeedIntRange(85, 100) / 100));
//   if (!simulated) applyAbAttrs("EnemyMinDamageRollAbAttr", { pokemon: this, simulated, rollMultiplier: randomMultiplierHolder });
// RNG: the spread is drawn FIRST (`randBattleSeedIntRange(85, 100)`) and the class then overwrites the value, so a Bad Luck
// holder consumes the same random numbers as any other. The class draws nothing itself. A forced roll
// (`forcedRandomMultiplier`) is overwritten too.
// Why the effect is a package: no library effect sets the damage roll (the nearest, "multiply damage taken", scales the
// finished number instead of fixing the spread, which gives different results). A library effect is requested
// (requests/B04.md); until then the block works as one piece, still with its trigger as a separate swappable WHEN.
import { EnemyMinDamageRollAbAttr } from "#abilities/ab-attrs";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";

export default defineDecl(EnemyMinDamageRollAbAttr, {
  tier: "A",
  kind: "calc-modifier",
  when: "calc.damage-roll",
  label: "Make foes always roll the lowest damage against me",
  summary: () =>
    "Attacks against me always use the lowest damage roll (85% of the top value) instead of a random 85 to 100%. Example: a hit that could do 85 to 100 damage does 85.",
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
  params: [],
  noParamsReason:
    "The 85% floor is a fixed number written inside the class (not a constructor argument), so there is no setting to expose; a different roll needs the library effect requested in requests/B04.md.",
  conditions: [],
  guards: [],
  feasibility: [
    "Damage previews (calculations that only look ahead) never use the damage roll, so this block does nothing there",
  ],
  effect: { id: "effect.package", params: [] },
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
    "Package reason: the only thing the class does is write the literal 0.85 into the damage-roll holder; no existing effect block sets the roll (multiply-damage-taken multiplies the finished damage, which is a different number), and the number is not a constructor argument so it cannot be a typed param (a batch may not add one). The trigger is a separate swappable WHEN (`calc.damage-roll`), there is no condition inside, and requests/B04.md asks for `effect.set-damage-roll` with a percent setting plus an optional trailing constructor argument (default 85) so the package can later become a plain library effect. Users (live dump): Bad Luck (id 5072, attr 3), Bad Omen (id 5375, attr 1), Scarecrow (id 5522, attr 4); Bad Luck and Bad Omen are also built by archetype-dispatcher.ts (lines 5047 and 5118). The call is gated by `!simulated`, so damage previews use the neutral roll of 1 (the preview is not the 85% floor): harmless, noted, not fixed.",
});

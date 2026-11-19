/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B04 chunk 4 / Tier A calc-modifier, no setting, no closure (Deadeye, Hunter's Mark, Celestial Bow). The effect is a package.
//
// Class (ab-attrs.ts:4307): `constructor() { super(false) }` and one override:
//   apply   `if (!defender) return;` then reads `defender.getEffectiveStat(Stat.DEF)` and `getEffectiveStat(Stat.SPDEF)` (stat
//           stages included) and writes `statHolder.value = def <= spDef ? Stat.DEF : Stat.SPDEF` -> the EFFECT: the damage formula
//           reads the foe's LOWER defensive stat (a tie picks Defense). The `!defender` line is a defensive guard that never fires
//           in a real hit (the call site always passes `this`), so it is not a clause staff could use.
//   There is NO canApply override (the default answers true): the class has no condition of its own.
// Dispatch (pokemon.ts:5675, in `getAttackDamage`): `if (isCritical && !ignoreSourceAbility) applyAbAttrs("CritUseLowerDefensiveStatAbAttr",
// { pokemon: source, simulated, defender: this, statHolder })`. So the ATTACKER owns the attr, `other` is the defender, and the call site
// itself holds two gates that are not constructor closures: the hit is a CRITICAL hit, and the attacker's ability is not being ignored.
// Both stay in the engine (feasibility lines below); the library has no "the hit is critical" atom and the WHEN provides no `isCritical`
// slot (requests/B04.md section 15). Order at the call site: Tangled Feet (DefensiveStatSubstituteAbAttr, defender side) first, this attr
// can overwrite its answer, then Deadeye Draw's mark rule and Exploit Weakness (separate classes of other batches) can overwrite this one.
// No RNG. `simulated` is never read: the attr only writes the local stat holder, so a preview call gives the same answer.
//
// Why the effect is a package: no library effect chooses WHICH stat a calculation reads and then compares two live stats (multiply-stat
// scales a value; requests/B04.md asks for `effect.use-weaker-defense`). The pick has no number, stat or type a person could set
// (it always compares exactly Defense and Sp. Def), so there is nothing to type; the trigger is a separate WHEN and no condition is
// hidden inside.
import { CritUseLowerDefensiveStatAbAttr } from "#abilities/ab-attrs";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";

export default defineDecl(CritUseLowerDefensiveStatAbAttr, {
  tier: "A",
  kind: "calc-modifier",
  when: "calc.defensive-stat-pick",
  label: "Hit the foe's weaker defense on critical hits",
  summary: () =>
    "When my hit is a critical hit, the damage formula uses whichever is lower, the foe's Defense or Sp. Def. Example: a foe with 100 Defense and 60 Sp. Def takes a physical crit as if it had 60.",
  synonyms: [
    "deadeye",
    "hunter's mark",
    "celestial bow",
    "crits hit weakest defense",
    "target lower defense",
    "weaker defensive stat",
    "crit weak side",
    "aim at weak spot",
  ],
  examples: ["My critical hits target the foe's weaker defensive stat, like Deadeye"],
  params: [],
  noParamsReason:
    "The block always compares exactly the foe's Defense and Sp. Def (stat stages included) and takes the lower one, so there is no number, stat or type to set. What can change is when it works, which comes from the trigger and from conditions added on top.",
  conditions: [],
  guards: [],
  feasibility: [
    "The game only asks when the hit is a critical hit",
    "The game does not ask while my own ability is being ignored",
    "A tie between Defense and Sp. Def picks Defense",
  ],
  effect: { id: "effect.package", params: [] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "none", simulated: "respects" },
  probes: [
    {
      name: "a critical hit against a foe whose Defense and Sp. Def differ",
      axes: { foeMove: ["TACKLE", "WATER_GUN"] },
    },
  ],
  l2StaticReason:
    "The L2 template of this trigger ('foe-crits-holder') makes the FOE hit the holder, but this attr sits on the ATTACKER, so the twin never evaluates it (decomp-l2-reach.json). b04-chunk4.test.ts proves it instead with real battles: the holder (Deadeye) crits a foe with unequal Defense and Sp. Def, original against rebuilt shadow, and direct apply over every stage combination.",
  status: "decomposed",
  notes:
    "Package reason: no library effect picks the lower of two live stats (requests/B04.md `effect.use-weaker-defense`), and the pick has no setting. The trigger is its own WHEN and the two call-site gates (critical hit, my ability not ignored) are listed as feasibility; no condition is hidden in the package. Users (live dump, 3 attrs): Deadeye (id 5113, attr 2, after two ConditionalAlwaysHit attrs), Hunter's Mark (5482, attr 3), Celestial Bow (20011, a saved editor ability, attr 6); none passes an argument and none has an attr-level condition. Sibling LowerDefensiveStatVsStatusedFoeAbAttr (Exploit Weakness) has the same body and is another batch's class (its WHEN alias is calc.defensive-stat-pick). Oddity, not fixed: the WHEN label 'While the game picks the foe's defensive stat' hides that the game only asks on a critical hit; a staff rule built on it alone would fire only on crits, and cannot be made to fire on every hit.",
});

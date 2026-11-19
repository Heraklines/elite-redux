/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B04 chunk 3 / Tier A calc-modifier, one setting (which stat), no constructor closure (Tangled Feet). The effect is a package.
//
// Class (ab-attrs.ts:4275): `constructor(substituteStat: Stat = Stat.SPD) { super(false); this.substituteStat = substituteStat }`
// and one override:
//   apply      `statHolder.value = this.substituteStat` -> the EFFECT: the damage formula reads this stat in place of the
//              holder's Defense (physical hit) or Sp. Def (special hit). There is NO canApply override (the default answers
//              true): the class has no clause of its own.
// The condition lives OUTSIDE the class, at attr level: init-elite-redux-vanilla-rebalance.ts:880 builds
// `new DefensiveStatSubstituteAbAttr(Stat.SPD)` and calls `sub.addCondition(p => !!p.getTag(CONFUSED) || !!p.getTag(ER_ENRAGE))`.
// That attr-level condition is NOT a constructor argument and the contract has no slot for it (requests/B04.md section 10);
// its library form is `any[ tag.has{who: holder, tag: CONFUSED}, tag.has{who: holder, tag: ER_ENRAGE} ]`, written here so a
// reviewer can read it. The rebuild copies it unchanged (recomposeAttr carries `extraCondition`).
// Dispatch: pokemon.ts:5666 in the defensive-stat selection of `getAttackDamage`, with `this` the DEFENDER and
// `if (!ignoreAbility)` (a Mold Breaker style attacker bypasses it): `applyAbAttrs("DefensiveStatSubstituteAbAttr", { pokemon:
// this, simulated, statHolder })`. The stat holder starts as DEF (physical) or SPDEF (special). The next call, the attacker's
// CritUseLowerDefensiveStatAbAttr (Deadeye), can overwrite it again on a crit.
// No RNG, no `simulated` read.
// Why the effect is a package: no library effect changes WHICH stat a calculation reads (multiply-stat scales a stat's value).
// The stat is a typed setting, so staff can already pick any of the five battle stats.
import { DefensiveStatSubstituteAbAttr } from "#abilities/ab-attrs";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";
import { DEFENSIVE_SUBSTITUTE_CHOICES, defensiveSubstituteCodec } from "./shared-codecs";

export default defineDecl(DefensiveStatSubstituteAbAttr, {
  tier: "A",
  kind: "calc-modifier",
  when: "calc.defensive-stat-substitute",
  label: "Defend with another stat instead of Defense and Sp. Def",
  summary: params =>
    `When I am hit, the damage formula uses my ${String(params.stat)} instead of my Defense or Sp. Def. Example: choose Speed and a fast Pokemon takes less damage.`,
  synonyms: [
    "tangled feet",
    "speed as defense",
    "use speed for defense",
    "swap defensive stat",
    "defend with speed",
    "defense from another stat",
  ],
  examples: ["Take hits with my Speed instead of my Defense, like Tangled Feet while confused"],
  params: [
    {
      id: "stat",
      ctorIndex: 0,
      path: "substituteStat",
      control: "select",
      label: "Stat used in place of Defense and Sp. Def",
      editable: true,
      default: "Speed",
      options: DEFENSIVE_SUBSTITUTE_CHOICES,
      codec: defensiveSubstituteCodec,
    },
  ],
  conditions: [],
  guards: [],
  feasibility: ["Does nothing when the attacker ignores my ability (Mold Breaker style)"],
  effect: { id: "effect.package", params: ["stat"] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "none", simulated: "respects" },
  probes: [
    {
      name: "a foe hits me with a physical and a special move",
      axes: { foeMove: ["TACKLE", "WATER_GUN"] },
    },
  ],
  status: "decomposed",
  notes:
    "Package reason: the class overwrites WHICH stat the damage formula reads, and no library effect does that (multiply-stat scales a value); the stat is a typed setting and the trigger is a separate WHEN, with no condition hidden inside (the only condition is the attr-level one described above). requests/B04.md asks for `effect.use-stat-as-defense`. User (live dump): Tangled Feet (id 77, attr 0, Speed), created by the ER rebalance patch with the attr-level condition 'confused or enraged'; it also removes the vanilla evasion boost. The confusion check reads the CONFUSED tag and the ER_ENRAGE tag directly (the ER 'FOG' proxy named in the class comment is not what the patch uses). Not fixed: the class comment says the attr is 'gated by an extraCondition (confused tag, or the ER FOG enrage proxy)'; the live condition is the ER_ENRAGE tag.",
});

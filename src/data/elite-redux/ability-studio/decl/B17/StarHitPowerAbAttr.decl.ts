/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B17 chunk 3 / Starcrossed, its damage half. Read by hand: fakemon-pitch-mechanics.ts `StarHitPowerAbAttr` and `isStarMove`, its base
// HitMultiplierPowerAbAttr (archetypes/hit-multiplier.ts, owned by another batch; options `{ multiplier, filter, extraStrikesOnly }`, it
// hands MoveDamageBoostAbAttr the closure `matchesFilter(filter) && (!extraStrikesOnly || strikeIndex > 0)`), the grandparent
// MoveDamageBoostAbAttr (ab-attrs.ts:1799, canApply = `condition(holder, foe, move)`, apply = `damage = toDmgValue(damage * multiplier)`) and
// its dispatch (the `MoveDamageBoostAbAttr` key of the damage-dealt calculation).
//
// canApply, clause by clause, in the order they run (the split is `canApply = gate`, no guards, no residual):
//   1. condition  the inherited closure of the base class: empty filter and `extraStrikesOnly` false here, so it is always true
//                 (its multiplier 0.7 is the setting below)                                              -> `gate`, nothing to map
//   2. condition  the move is Star-based: `move.hasFlag(LUNAR_MOVE)` OR the holder has an AstralProjectStarMarkerAbAttr
//                                                                                                       -> `gate`, NO ATOM (request R31)
// apply (inherited): `damage.value = toDmgValue(damage.value * multiplier)`; it applies to EVERY strike of the move (not only the extra one).
// No random draw, no side effect.
import { StarHitPowerAbAttr } from "#data/elite-redux/abilities/fakemon-pitch-mechanics";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";

export default defineDecl(StarHitPowerAbAttr, {
  tier: "B",
  kind: "calc-modifier",
  when: "calc.damage-dealt",
  label: "Deal less damage with each hit of my Star moves",
  summary: params =>
    `While the game calculates damage I deal, each hit of a move that counts as a Star move does ${params.multiplier} times its damage. Example: 0.7 = 70% damage per hit.`,
  synonyms: [
    "starcrossed",
    "reduce damage per hit",
    "weaker hits",
    "damage penalty",
    "lunar damage",
    "balance for extra strikes",
  ],
  examples: ["Each hit of my Star moves does 70% damage", "Weaken the strikes of lunar moves to 0.7x"],
  params: [
    {
      id: "multiplier",
      ctorIndex: 0,
      path: "powerMultiplier",
      control: "number",
      label: "Damage multiplier per hit (0.7 = 70% damage)",
      editable: true,
      gateIndependent: true,
      default: 0.7,
      min: 0.05,
      max: 1,
      step: 0.05,
    },
  ],
  conditions: [
    // The gate: <move is Star-based (R31)>. No atom yet, so it is legacy-closure-pending-request. (The inherited always-true closure of the
    // base class is not a constructor argument of this class, so it has no slot.)
    {
      slot: "gate",
      ctx: "params",
      lib: "request R31 (the move is Star-based)",
      removable: true,
      editable: true,
    },
  ],
  guards: [],
  feasibility: ["The multiplier can only lower damage (up to 1): the base class refuses values above 1"],
  effect: { id: "effect.multiply-damage-dealt", params: ["multiplier"] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "none", simulated: "ignores" },
  probes: [
    {
      // calc.damage-dealt has an L1 engine-parameter builder, but the gate is legacy so the rebuild is skipped; the old rule (including the
      // Astral Project marker) is compared by hand in test/.../B17/chunk3.test.ts.
      name: "damaging foe moves against a healthy and a half-health foe",
      axes: { foeHp: ["max", "50%"], foeMove: ["TACKLE", "WATER_GUN"] },
    },
  ],
  status: "decomposed",
  notes:
    "Tier B, no package: the effect is the library's effect.multiply-damage-dealt (apply is `toDmgValue(damage * multiplier)`; the class and the effect agree). The literal 0.7 of the old constructor is now the constructor argument `multiplier` (default 0.7, same behaviour); the base class refuses 0 and values above 1, so the setting is 0.05 to 1. Source edit (pure move of code, spec 3.1): the old canApply moved into `gate`, order kept. The gate is legacy-closure-pending-request (R31 Star-based move). The base class's own closure (always true for the empty filter) is not a constructor argument here, so no condition slot and no binding exist for it; it is described above. Users: Starcrossed (6017, attr 1) only, always together with attr 0 (extra strikes). Oddity, not a bug: because this multiplier applies to every strike while attr 0 only adds one, a Star move hits twice at 70% each (about 1.4 times the damage), which matches the ability text 'hit twice at 70% power each'.",
});

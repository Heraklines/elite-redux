/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B14 chunk 3. Tier B, PACKAGE effect. "Once per battle, in Misty Terrain or Rain, a hit that would knock me out leaves me at
// a quarter of my HP instead, and cures my status."
//
// Source: fakemon-pitch-mechanics.ts CelestialJellyAbAttr, extends PreDefendFullHpEndureAbAttr (the Sturdy-style class, whose
// dispatch key `PreDefendFullHpEndureAbAttr` is listed as an alsoDispatchKey of calc.damage-taken). The class OVERRIDES canApply
// and apply (nothing of Sturdy's is used). canApply, original clause order, now `guards && gate`:
//   guard 1. !battleData.erAbilityProvenance.includes("celestial-jelly:spent")   once per battle (spent by apply, below)
//   guard 2. getMaxHp() > 1                                                         a 1 max HP Pokemon cannot be left with HP
//   guard 3. damage.value >= pokemon.hp                                             the hit would really knock me out
//   gate  4. arena.terrain?.terrainType === MISTY                                   Misty Terrain, read RAW (Clueless does not hide it)
//   gate  5. weather !== null && !weather.isEffectSuppressed() && weatherType in {RAIN, HEAVY_RAIN}
//                                                                                   Rain or Heavy Rain whose effect is not negated
//   gate = clause 4 || clause 5. Nothing is random.
// Guard 3 is a correctness rule, not a design choice: apply SETS the damage to `hp - targetHp`, so on a hit that would not knock
// me out it would raise the damage. Guards 1 and 2 are requested as library guards (requests/B14.md); until then they are
// feasibility text. The weather and terrain atoms the library has (field.weather, field.terrain) are NOT the same predicate (they
// read `arena.weatherType`, which ignores Cloud Nine style suppression, and `arena.terrainType`, which hides the terrain under
// Clueless), so the gate is a legacy closure and two exact atoms are requested.
//
// apply: targetHp = max(1, floor(maxHp * hpFraction)); damage.value = max(0, hp - targetHp). Then, only when not simulated:
// push the "spent" key, resetStatus(true, false, false, false) (cure every status, no confusion cure, no asset reload, not as a
// phase) and updateInfo(). The preview (simulated) therefore already shows the saved HP but remembers nothing.
//
// PACKAGE, because the effect library has no "leave me at X% HP instead of knocking me out" effect (requested, together with its
// memory) and the class writes its memory and cures status in the very same call, in a fixed order. The trigger (damage taken)
// and the condition (the gate) are separate blocks; the one number is a typed param.
import { CelestialJellyAbAttr } from "#data/elite-redux/abilities/fakemon-pitch-mechanics";
import type { ParamCodec } from "#data/elite-redux/ability-studio/define-decl";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";

// Staff think in percent; the class keeps a share of max HP (0.25).
const percentOfMaxHpCodec: ParamCodec = {
  toCtor: value => Number(value) / 100,
  fromInstance: raw => (typeof raw === "number" ? Math.round(raw * 100) : undefined),
};

export default defineDecl(CelestialJellyAbAttr, {
  tier: "B",
  kind: "package",
  when: "calc.damage-taken",
  label: "Survive a knockout once per battle and cure my status",
  summary: params =>
    `A hit that would knock me out leaves me with ${params.hpPercent}% of my max HP instead, and cures my status. Works once per battle. Example: 25% left.`,
  synonyms: [
    "survive a hit",
    "endure",
    "sturdy",
    "second chance",
    "revive once",
    "cheat death",
    "last stand",
    "celestial jelly",
  ],
  examples: ["Once per battle, in Misty Terrain or Rain, survive a lethal hit with a quarter of my HP"],
  params: [
    {
      id: "hpPercent",
      ctorIndex: 0,
      path: "hpFraction",
      control: "number",
      min: 1,
      max: 100,
      step: 1,
      integer: true,
      label: "HP left after the saved hit (% of max HP)",
      editable: true,
      default: 25,
      codec: percentOfMaxHpCodec,
      gateIndependent: true,
    },
  ],
  conditions: [
    // Gate = [Misty Terrain OR Rain/Heavy Rain that is not negated]. Removable: with no condition it works in any weather.
    { slot: "gate", ctx: "params", removable: true, editable: true },
  ],
  guards: [],
  feasibility: [
    "Works only once per battle: it is spent the first time it saves me",
    "Needs more than 1 max HP",
    "Only when the hit would really knock me out (a smaller hit is left alone)",
    "Cures any status condition, except a burn that nothing can cure (an Amaterasu burn)",
  ],
  effect: { id: "effect.package", params: ["hpPercent"] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "battle", simulated: "respects" },
  probes: [
    {
      // Low HP so the foe's hit is lethal; rain on, rain off (the gate), and full HP (guard 3, not lethal).
      name: "a lethal hit with and without rain",
      axes: { hp: [5, "max"], weather: ["RAIN", "NONE"] },
    },
  ],
  l2StaticReason:
    "The gate (Misty Terrain or unsuppressed Rain) is a legacy closure until the exact weather and terrain atoms exist, so there is nothing to rebuild for the twin. B14/chunk3.test.ts proves the Tier B split against a literal copy of the original canApply and drives real battles (rain, no weather, full HP, a second lethal hit).",
  status: "decomposed",
  notes:
    "Tier B + package. Users (1): Celestial Jelly (6078) attr 0 (its only attr). The 0.25 was a literal in apply; it is now constructor argument 0 (a fraction, default 0.25) shown to staff as a percent through a codec. Package, reason: no library effect leaves a Pokemon at X% HP in place of a knockout, and the class pushes its once-per-battle memory (battleData.erAbilityProvenance, key celestial-jelly:spent) and cures status in the same apply, in a fixed order, so splitting it in the declaration would re-implement it; requested as effect.survive-lethal-hit plus the memory in time.once-per. The gate cannot be bound yet: field.weather reads arena.weatherType (not suppression aware) and field.terrain reads arena.terrainType (hidden by Clueless), while the class reads the raw terrain and asks weather.isEffectSuppressed(); requests R-B14-3.2 and R-B14-3.3. Oddities, not fixed: (1) the cure is resetStatus, which refuses to cure an Amaterasu burn; (2) Heavy Rain counts as Rain here; (3) the flyout is shown by the engine around apply, and the preview rewrites the damage without remembering anything; (4) SUSPECTED BUG: the gate reads `weather !== null` and then `weather.isEffectSuppressed()`, but a fresh arena holds `undefined` (a weather that was set and cleared holds `null`), so on a lethal hit with no weather ever set the gate throws a TypeError inside the damage calculation (seen in a battle, and pinned in B14/chunk3.test.ts); `weather != null` would be the fix.",
});

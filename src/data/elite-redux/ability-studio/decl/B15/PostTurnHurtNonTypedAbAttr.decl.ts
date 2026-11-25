/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B15 chunk 3. Tier B. "At the end of every turn, each foe that is not of a spared type loses a share of its max HP (optionally only in certain weather, optionally the whole field, optionally Poison Heal foes recover instead)."
//
// Source: src/data/elite-redux/abilities/post-turn-hurt-non-typed.ts, class PostTurnHurtNonTypedAbAttr (extends PostTurnAbAttr; constructor takes ONE options object and passes showAbility true;
// it throws when damageFraction is not in (0, 1]). canApply, now guards-less gate && residual in the ORIGINAL order (no random draw anywhere):
//   1. gate      isWeatherActive(): requiredWeathers === null || requiredWeathers.includes(arena.weatherType)    -> CONDITION (the weather gate; Christmas Nightmare only)
//   2. residual  some target t in getTargets(holder) with isValidTarget(t)                                       -> feasibility (at least one valid target)
//        getTargets = fieldWide ? globalScene.getField(true) minus the holder : holder.getOpponents()
//        isValidTarget(t) = !t.switchOutStatus && !t.isFainted() && none of safeTypes in t.isOfType(..) (Tera counts)  -> per-target filter (the spared types are a setting)
// apply (effect, not when simulated), per valid target in order:
//   amount = toDmgValue(maxHp * damageFraction)
//   poisonHealRecovers && abilityQuery(t, POISON_HEAL_RECOVERY): heal phase "poisonHeal" (skipped at full HP) and next target
//   else applyAbAttrs BlockNonDirectDamageAbAttr on the target (Magic Guard): cancelled -> next target; else damageAndUpdate(amount, INDIRECT) and the "hurt by item" message
// Weather: the gate compares the CACHED arena.weatherType (the same value atom field.weather reads), so it matches the library atom field.weather. A list of weathers is any[field.weather ...].
// Refactor (pure move of code, spec 3.1): canApply = gatedCanApply(this, params); gate = the old isWeatherActive clause; residual = the old target loop. `gateOverride` is declared for the compiler.
import { PostTurnHurtNonTypedAbAttr } from "#data/elite-redux/abilities/post-turn-hurt-non-typed";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";
import { enumListCodec } from "#data/elite-redux/ability-studio/param-codecs";
import { TYPE_OPTIONS, WEATHER_OPTIONS } from "#data/elite-redux/ability-studio/vocabulary/enums";
import { PokemonType } from "#enums/pokemon-type";
import { WeatherType } from "#enums/weather-type";

export default defineDecl(PostTurnHurtNonTypedAbAttr, {
  tier: "B",
  kind: "event-effect",
  when: "event.end-of-turn",
  label: "Hurt every foe a little at the end of each turn",
  summary: params =>
    `At the end of every turn, each foe that is not of a spared type (${params.safeTypes === "" ? "none spared" : params.safeTypes}) loses ${Math.round(Number(params.damageFraction) * 1000) / 10}% of its max HP. Magic Guard blocks it.`,
  synonyms: [
    "chip damage",
    "residual damage",
    "flame coat",
    "funeral pyre",
    "trash heap",
    "bad dreams",
    "hurt non fire types",
    "damage the field",
  ],
  examples: [
    "Every foe that is not Fire type loses 1/8 of its HP each turn",
    "Foes take 1/8 damage each turn while it hails",
  ],
  params: [
    {
      id: "safeTypes",
      ctorIndex: 0,
      ctorOption: "safeTypes",
      path: "safeTypes",
      control: "text",
      label: "Types that are spared (comma separated; a foe with any of them takes nothing; empty = none spared)",
      editable: true,
      gateIndependent: true,
      default: "FIRE",
      options: TYPE_OPTIONS,
      codec: enumListCodec(PokemonType, "type"),
    },
    {
      id: "damageFraction",
      ctorIndex: 0,
      ctorOption: "damageFraction",
      path: "damageFraction",
      control: "slider",
      min: 0.01,
      max: 1,
      step: 0.005,
      label: "Damage each turn (share of max HP, 0.125 = 1/8)",
      editable: true,
      gateIndependent: true,
      default: 0.125,
    },
    {
      id: "requiredWeathers",
      ctorIndex: 0,
      ctorOption: "requiredWeathers",
      path: "requiredWeathers",
      control: "text",
      label: "Weather that must be active (comma separated; empty = any weather)",
      // The weather is edited through the condition block (the compiled gate), not through this setting.
      editable: false,
      default: "",
      options: WEATHER_OPTIONS,
      codec: enumListCodec(WeatherType, "weather"),
    },
    {
      id: "fieldWide",
      ctorIndex: 0,
      ctorOption: "fieldWide",
      path: "fieldWide",
      control: "boolean",
      label: "Also hurt my own ally (every other Pokemon on the field)",
      editable: true,
      gateIndependent: true,
      default: false,
    },
    {
      id: "poisonHealRecovers",
      ctorIndex: 0,
      ctorOption: "poisonHealRecovers",
      path: "poisonHealRecovers",
      control: "boolean",
      label: "Targets with Poison Heal recover the amount instead of losing it",
      editable: true,
      gateIndependent: true,
      default: false,
    },
  ],
  conditions: [
    // The gate is the weather clause: always true without a weather list, otherwise any of the listed weathers.
    { slot: "gate", ctx: "params", removable: true, editable: true },
  ],
  guards: [],
  feasibility: [
    "At least one living target on the field that is not of a spared type must exist; foes that switched out or fainted are skipped",
    "Each target is checked on its own: Magic Guard and other blocks of indirect damage spare that target only",
    "The damage is not an attack, so it does not set off abilities that react to being hit",
    "It does nothing in a preview",
  ],
  effect: { id: "effect.package", params: ["damageFraction", "safeTypes", "fieldWide", "poisonHealRecovers"] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "none", simulated: "respects" },
  probes: [
    {
      // The weather clause is the gate: no weather, the right weather, another weather.
      name: "end of turn in different weather",
      axes: { weather: ["NONE", "HAIL", "SNOW", "RAIN"] },
    },
  ],
  status: "decomposed",
  notes:
    "PACKAGE for the effect, justified; the trigger and the weather condition are separate blocks. 7 attrs in 7 abilities: Parasitic Spores (5314 attr 0, spares Ghost), Funeral Pyre (5367 attr 0, spares Ghost, Dark and Fire, 1/4), Trash Heap (5427 attr 2, spares Poison, whole field, Poison Heal recovers), Flame Coat (5476 attr 0, spares Fire), Winter Throne (5575 attr 0, spares Ice), Christmas Nightmare (5643 attr 0, spares none, only in Hail or Snow) and Decomposer (5945 attr 0, spares Ghost); all damage 1/8 except Funeral Pyre. Each user is bound by its gate: six with the always-true group, Christmas Nightmare with 'the weather is Hail or the weather is Snow'. The effect cannot be split because the library has no effect that takes HP from other Pokemon as a share of their max HP (effect.recoil and effect.drain are about the holder), no target 'every foe that does not have these types' and no 'Poison Heal recovers instead' branch; requested as R-B15-24 (effect 'Hurt {target} by a share of its max HP' with a per-target type filter, the field-wide switch and the Poison Heal branch). The weather list is not editable as a setting because it changes the SHAPE of the gate (one atom per weather); staff edit it through the condition block. Suspected oddities, NOT fixed: (1) the damage message reuses the held-item text ('is hurt by its item'); (2) with fieldWide and Poison Heal a target at full HP still counts as a valid target in canApply although nothing happens to it; (3) isValidTarget uses isOfType, so a Tera type counts as the target type, which the source comment says is intended.",
});

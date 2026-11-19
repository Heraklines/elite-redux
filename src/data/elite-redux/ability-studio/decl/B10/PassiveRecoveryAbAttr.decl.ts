/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B10 / event-effect (Tier B).
//
// Read by hand from archetypes/passive-recovery.ts and the 17 live users. The class extends PostTurnHealAbAttr (WHEN "at the end
// of every turn"), constructor `{ healFraction, condition? }` (throws unless 0 < healFraction <= 1, and 0 < fraction < 1 for the HP
// situation), `super()` so showAbility is true. canApply is now guards && gate, in the original clause order:
//
//   guards   1. the parent's PostTurnHealAbAttr.canApply: !pokemon.isFullHp()          nothing to heal at full HP
//   gate     2. matchesCondition(conditionSpec, pokemon): ONE situation chosen by the user's `condition` option
//   (no prepare, no residual, no random draw)
//   apply    simulated -> nothing; else queue a PokemonHealPhase of toDmgValue(maxHp * healFraction) with the postTurnHeal message
//
// The situation is a discriminated union of six kinds, and every kind has a library form that calls the same engine read:
//   always              {all: []}
//   status SLEEP        pokemon.status?.effect === SLEEP, OR isComatoseLike(pokemon)            no atom for the Comatose half (R-B10-23)
//   weather [list]      arena.weatherType in the list                                           any of field.weather
//   terrain [list]      arena.terrainType in the list                                           any of field.terrain
//   hp-below-fraction   pokemon.hp <= toDmgValue(maxHp * fraction)                              hp.at-most (see notes for the max HP 1 case)
//   self-type           pokemon.getTypes().includes(type) (getTypes() includes the Tera type)   mon.has-type (isOfType, the same list)
// The situation is not an editable setting: each user's binding spells it out as a library IF, so staff change the IF block. The
// `when` param exists so a rebuilt attr carries the same condition object as the original (the upgrade code in
// init-elite-redux-ability-upgrades.ts reads it back through getRecoveryCondition()).
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";
import { PassiveRecoveryAbAttr } from "#data/elite-redux/archetypes/passive-recovery";
import { fractionAsPercentCodec, passiveRecoveryWhenCodec } from "./b10-codecs";

export default defineDecl(PassiveRecoveryAbAttr, {
  tier: "B",
  kind: "event-effect",
  when: "event.end-of-turn",
  label: "Heal a share of my max HP at the end of every turn",
  summary: params =>
    `At the end of every turn I heal ${params.percent}% of my max HP while I am missing HP. Situation: ${params.when}. Example: 6.25 = one sixteenth, 12.5 = one eighth.`,
  synonyms: [
    "passive recovery",
    "heal every turn",
    "regenerate each turn",
    "leftovers",
    "rain dish",
    "ice body",
    "self sufficient",
    "residual healing",
  ],
  examples: [
    "Heal one sixteenth of my max HP at the end of every turn, like Self Sufficient",
    "Heal one eighth of my max HP each turn while Misty Terrain is up, like Celestial Blessing",
    "Heal a quarter of my max HP each turn while I am at half HP or less, like Resilience",
  ],
  params: [
    {
      id: "percent",
      ctorIndex: 0,
      ctorOption: "healFraction",
      path: "healFractionValue",
      control: "number",
      min: 0.5,
      max: 100,
      step: 0.25,
      label: "Share of max HP healed each turn (% ; 6.25 = one sixteenth, 12.5 = one eighth)",
      editable: true,
      // Only apply reads the share; the gate never repeats it.
      gateIndependent: true,
      default: 12.5,
      codec: fractionAsPercentCodec,
    },
    {
      id: "when",
      ctorIndex: 0,
      ctorOption: "condition",
      path: "conditionSpec",
      control: "text",
      label: "Situation that turns the healing on (shown for reading; change the condition block to change it)",
      // The situation IS the gate (each user's binding spells it out with library atoms), so editing this text would not change
      // the compiled rule.
      editable: false,
      default: "Always",
      codec: passiveRecoveryWhenCodec,
    },
  ],
  conditions: [
    // The gate is one library tree per user (bindings.ts): always, a terrain, a weather list, a type, an HP limit or asleep.
    { slot: "gate", ctx: "params", removable: true, editable: true },
  ],
  guards: [],
  feasibility: [
    "Healing only happens while I am missing HP: at full HP nothing is healed and nothing is shown",
    "Nothing is healed in a preview",
  ],
  effect: { id: "effect.heal-percent", params: ["percent"] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "none", simulated: "respects" },
  probes: [
    {
      // The HP limit of Resilience (half HP) and the full-HP rule; weather and status are other axes of the grid.
      name: "full HP, just under full, half HP, just under half, and 1 HP",
      axes: { hp: ["max", "max-1", "50%", "50%-1", 1], weather: ["RAIN", "SUNNY"], status: ["SLEEP", "BURN"] },
    },
  ],
  status: "decomposed",
  notes:
    "Tier B split by hand: canApply = guards (the parent's not-at-full-HP test) && gate (the situation), both pure and in the original order. 17 attrs of 16 abilities: always (Self Sufficient 5045 and 5951, Self Repair 5151, Peaceful Slumber attr 2, Apple Pie, Dune Veil attr 2, Honk Shoo attr 2) bound as an empty ALL group; terrain Toxic (Poison Absorb attr 2), Misty (Celestial Blessing, Eternal Blessing), Grassy (Flourish attr 1) bound as field.terrain; Fog or Eerie Fog (Rest in Peace, White Noise attr 4) bound as ANY of two field.weather; Ice type (Winter Throne attr 1) as mon.has-type on the holder; HP at most half (Resilience) as hp.at-most 50% floor-half. The two SLEEP users (Sweet Dreams 5071, Peaceful Slumber attr 0) stay legacy-closure: matchesCondition is true for a Pokemon that is asleep OR comatose-like (isComatoseLike: an ability with the Comatose rule or an active Honk Shoo) and the library has no atom for the second half (request R-B10-23, an atom 'is asleep or Comatose'); a plain status.has SLEEP would drift for a Comatose holder. HP situation: the class tests hp <= toDmgValue(max * 0.5) = max(floor(max / 2), 1); hp.at-most floor-half is hp <= floor(max / 2). They differ only at max HP 1, where the parent's not-at-full-HP guard has already stopped the heal, so no state reaches the difference. Oddities, NOT fixed: the heal message takes the ability name from pokemon.getAbility() while the parent resolves the ability that really triggered (resolveTriggerAbility), so a passive or composite source can show the main ability's name; `healFraction` above 1/2 is accepted by the class although its comment calls such values unusual. Own test (the shared L1 grid and L2 twin cannot see it all): test/tests/elite-redux/decomp/B10/chunk2-gates.test.ts.",
});

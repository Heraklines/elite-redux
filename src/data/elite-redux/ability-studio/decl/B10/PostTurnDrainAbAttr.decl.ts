/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B10 chunk 5 / package (Tier B).
//
// Read by hand from archetypes/post-turn-drain.ts (and archetypes/lifesteal.ts for the heal). The class extends PostTurnAbAttr (WHEN "at
// the end of every turn"), constructor `{ fraction, weather?, onlyIfTrapped? }` kept in the private fields `fraction`, `weather` (list or
// null) and `onlyIfTrapped`, `super()` (banner shown). canApply in the ORIGINAL clause order:
//   1. weather set: the current weather (arena.weather?.weatherType ?? NONE) is in the list    gate     (library field.weather, any-of)
//   2. some opponent is alive, has hp, and (not onlyIfTrapped or is trapped)                    residual (feasibility)
// no random draw. apply: simulated -> nothing; else for every ADJACENT opponent that is alive, has hp and (not onlyIfTrapped or is
// trapped): damage = toDmgValue(opp.getMaxHp() * fraction), opp.damageAndUpdate(damage, INDIRECT), amount = hp lost (before - after);
// when amount <= 0 skip; else applyAbilityDrainRecovery(holder, opp, amount, the "postTurnHeal" message): a PokemonHealPhase for me is queued
// for THAT foe's amount (one heal per foe, not one summed heal), or, when the foe has an ability that reverses draining (Liquid Ooze),
// I take the amount as indirect damage instead (unless something blocks indirect damage).
//
// Clause classification: clause 1 is the part staff may want to change ("only in fog"), so it is the replaceable gate; Soul Tap's binding
// spells it with library atoms. Clause 2 is feasibility and stays in the class. The trapped-foes-only filter is a per-foe filter inside
// the effect (a setting), not a yes/no fact about the whole frame.
//
// Package, with a reason: the effect hurts every foe next to me by a share of ITS max HP as indirect damage and then heals me by what was
// really taken from that foe, with the drain-reversing rule in between. The library has no "hurt by a share of max HP" effect
// (requested as R-B10-08) and its "heal by the damage dealt" effect needs a damage slot that an end-of-turn trigger does not have, and
// each heal is read AFTER its foe's damage was applied. It has typed settings for the share, the
// trapped filter and (as a gate rule) the weather.
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";
import { PostTurnDrainAbAttr } from "#data/elite-redux/archetypes/post-turn-drain";
import { NO_REQUIREMENT, weatherListCodec } from "./c4-codecs";
import { shareOfMaxHpCodec } from "./c5-codecs";

const IN_OPTIONS = { ctorIndex: 0 } as const;

export default defineDecl(PostTurnDrainAbAttr, {
  tier: "B",
  kind: "package",
  when: "event.end-of-turn",
  label: "Drain foes' HP every turn and heal me (like Life Steal)",
  summary: params =>
    `At the end of every turn, every foe next to me loses ${params.percent}% of its max HP${params.onlyTrapped === true ? " (only if it is trapped)" : ""} and I heal by what I took. Example: 10 = a tenth of each foe's max HP.`,
  synonyms: [
    "drain hp each turn",
    "leech the foes every turn",
    "steal hp at end of turn",
    "life steal",
    "soul tap",
    "vampire aura",
    "constant lifesteal",
  ],
  examples: [
    "At the end of every turn, steal a tenth of every foe's max HP and heal myself, like Life Steal",
    "At the end of every turn in fog, drain a tenth of every foe's max HP, like Soul Tap",
    "At the end of every turn, drain a sixth of each trapped foe's max HP, like Poseidon's Dominion",
  ],
  params: [
    {
      id: "percent",
      ...IN_OPTIONS,
      ctorOption: "fraction",
      path: "fraction",
      control: "number",
      min: 1,
      max: 50,
      step: 0.5,
      label: "Share of each foe's max HP drained every turn (%, 10 = a tenth, 16.6667 = a sixth)",
      editable: true,
      // Only apply reads the share; the gate never repeats it.
      gateIndependent: true,
      default: 10,
      codec: shareOfMaxHpCodec,
    },
    {
      id: "onlyTrapped",
      ...IN_OPTIONS,
      ctorOption: "onlyIfTrapped",
      path: "onlyIfTrapped",
      control: "boolean",
      label: "Only drain foes that cannot leave the battle (trapped)",
      editable: true,
      // The residual and apply read it; the weather gate never does.
      gateIndependent: true,
      default: false,
    },
    {
      id: "weather",
      ...IN_OPTIONS,
      ctorOption: "weather",
      path: "weather",
      control: "text",
      label:
        "Built-in rule: weather needed for the drain (a list; None = any weather; your condition block replaces it)",
      editable: false,
      default: NO_REQUIREMENT,
      codec: weatherListCodec,
    },
  ],
  conditions: [
    // The gate: the weather. Soul Tap is any-of the two fog weathers; Life Steal and Poseidon's Dominion need no weather (an empty ALL group).
    { slot: "gate", ctx: "params", removable: true, editable: true },
  ],
  guards: [],
  feasibility: [
    "At least one foe next to me must still be standing (and trapped, when only trapped foes are drained)",
    "Only foes next to me are drained (every foe in a normal or double battle)",
    "A foe that loses no HP gives me nothing",
    "A foe whose ability reverses draining (like Liquid Ooze) hurts me instead of healing me",
    "Nothing happens in a preview",
  ],
  effect: { id: "effect.package", params: ["percent", "onlyTrapped"] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "none", simulated: "respects" },
  // The foe starts at full HP so that Poseidon's Dominion (a trapping entry move plus this drain) cannot end the battle before the second turn.
  probes: [{ name: "end of turn with and without fog", axes: { weather: ["FOG", "SUNNY"], foeHp: ["max"] } }],
  status: "decomposed",
  notes:
    "Tier B split by hand (gate = the weather list, residual = a living (trapped) foe; no guards, no random draw; the preview check stays in apply as before). Users (3 attrs): Life Steal attr 0 (a tenth, any weather), Soul Tap attr 0 (a tenth, Fog or Eerie fog) and Poseidon's Dominion attr 3 (a sixth, only trapped foes). Bindings: Life Steal and Poseidon's Dominion have no weather clause (an empty ALL group); Soul Tap is any-of two field.weather atoms (the class reads arena.weather?.weatherType ?? NONE and the atom reads arena.weatherType, the same expression). Package justified in the header (hurt by a share of max HP, then heal by what was really taken from each foe, no library pieces: request R-B10-c5-05, which also asks for the shared piece R-B10-08). The share is shown as a percent and snapped to the exact unit fraction when it is within a hundred-thousandth of one, so a sixth survives the round trip (a plain percent / 100 would not). Oddities, NOT fixed: canApply asks whether ANY opponent qualifies (getOpponents) but apply only drains ADJACENT opponents (a far foe in a triple battle lets it fire with nobody to drain); the heal message is the generic end-of-turn heal text with the ability's name; the amount healed is the HP the foe really lost (so a foe with little HP left gives less), queued as one heal per foe although the class description says the holder heals by the total drained.",
});

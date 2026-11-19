/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B11 chunk 3 / event-effect (Tier C).
//
// Read by hand from archetypes/self-highest-stat-boost-on-summon.ts. PostSummon hook (WHEN "when I enter the battle"),
// constructor `{ candidates, stages, weathers?, terrains? }`, one private field each; `super(true)` (shows the ability banner).
// The constructor THROWS for an empty candidate list and for `stages === 0`.
//   canApply, in the ORIGINAL order:
//     1. `weathers` set AND (no weather OR the active weather is not in the list)  -> false   (raw `arena.weather?.weatherType`)
//     2. `terrains` set AND (no terrain OR the active terrain is not in the list)  -> false   (raw `arena.terrain?.terrainType`)
//   apply: simulated -> nothing. Else pick the candidate with the highest `pokemon.getStat(stat, false)` (strict `>`, so a tie goes
//     to the one listed first) and queue ONE StatStageChangePhase on the holder for `stages`. No random draw.
//
// Why Tier C and not Tier B: the two gates are real conditions, but the library atom field.weather does not read the weather
// the way this class does when a weather ends or is suppressed (request R-B11-05 in requests/B11.md), the list of weathers
// is a list (an OR of atoms) that a gate param cannot scale, and the library has no effect "raise my highest stat among these"
// (request R-B11-10). The two lists are params, so staff can still tune the weather and terrain gate by hand.
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";
import { SelfHighestStatBoostOnSummonAbAttr } from "#data/elite-redux/archetypes/self-highest-stat-boost-on-summon";
import { TerrainType } from "#data/terrain";
import { Stat } from "#enums/stat";
import { WeatherType } from "#enums/weather-type";
import { optionalWordListCodec, requiredWordListCodec } from "./b11-chunk3-codecs";

export default defineDecl(SelfHighestStatBoostOnSummonAbAttr, {
  tier: "C",
  kind: "event-effect",
  when: "event.on-entry",
  label: "Raise my best stat when I enter",
  summary: params =>
    `When I enter the battle, my highest stat among the ones you list changes by ${params.stages} stage(s). Weather and terrain lists can limit it. Example: +1 to the best stat in sun.`,
  synonyms: ["highest stat", "best stat boost", "beast boost", "sun worship", "majestic moth", "boost on entry"],
  examples: ["Raise my highest stat by one stage when I enter", "Raise my best attacking stat by 2 when I enter"],
  params: [
    {
      id: "candidates",
      ctorIndex: 0,
      ctorOption: "candidates",
      path: "candidates",
      control: "text",
      label: "Stats to compare (for example Attack, Sp. Atk)",
      editable: true,
      default: "Attack, Defense, Sp. Atk, Sp. Def, Speed",
      codec: requiredWordListCodec(Stat, "stat"),
    },
    {
      id: "stages",
      ctorIndex: 0,
      ctorOption: "stages",
      path: "stages",
      control: "number",
      min: -6,
      max: 6,
      step: 1,
      integer: true,
      label: "Number of stages (1 to 6 raises, -1 to -6 lowers, not 0)",
      editable: true,
      default: 1,
    },
    {
      id: "weathers",
      ctorIndex: 0,
      ctorOption: "weathers",
      path: "weathers",
      control: "text",
      label: "Only in these weathers (leave empty for any weather)",
      editable: true,
      default: "",
      codec: optionalWordListCodec(WeatherType, "weather"),
    },
    {
      id: "terrains",
      ctorIndex: 0,
      ctorOption: "terrains",
      path: "terrains",
      control: "text",
      label: "Only on these terrains (leave empty for any terrain)",
      editable: true,
      default: "",
      codec: optionalWordListCodec(TerrainType, "terrain"),
    },
  ],
  conditions: [],
  guards: [],
  feasibility: [
    "The highest stat is picked by the real stat value right now, and a tie goes to the stat listed first",
    "If you list weathers or terrains, one of them must be active when I enter (a suppressed weather still counts as active)",
    "Never in a preview",
  ],
  effect: { id: "effect.stat-stage", params: ["candidates", "stages"] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "none", simulated: "respects" },
  probes: [
    {
      name: "entry in sun, rain, fog and clear weather",
      axes: { weather: ["SUNNY", "RAIN", "FOG", "NONE"] },
    },
  ],
  status: "decomposed",
  notes:
    "Tier C, justified in the header. Users: Berserk DNA (Attack and Sp. Atk, +2, no gate), Greater Spirit (all five, +1, Fog or Eerie fog), Majestic Moth (all five, +1, no gate), Sea Guardian (Rain or Heavy rain), Sun Worship (Sun or Extremely harsh sunlight), Turf War (all five, +1, no gate). The values are read from the live instances. Nothing to bind. The stat comparison reads live stats, which the L2 twin covers by letting both versions enter a real battle. Remark, NOT fixed: `weathers` is compared with the raw weather type (`arena.weather?.weatherType`); unlike the sandstorm classes it has no suppression test.",
});

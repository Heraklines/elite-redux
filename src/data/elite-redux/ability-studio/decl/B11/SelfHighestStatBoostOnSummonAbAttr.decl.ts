/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B11 chunk 3 / event-effect (Tier A: the weather and terrain gates are one constructor closure).
//
// Read by hand from archetypes/self-highest-stat-boost-on-summon.ts. PostSummon hook (WHEN "when I enter the battle"),
// constructor `(opts = { candidates, stages, weathers?, terrains? }, condition?)`; `super(true)` (shows the ability banner).
// The constructor THROWS for an empty candidate list and for `stages === 0`. `condition(holder)` is handed in at constructor
// argument 1 (slot ctor:1, field `condition`); its DEFAULT is the two list tests below, built from `opts.weathers` and
// `opts.terrains` (which the class no longer keeps as fields).
//   canApply = `condition(holder)`, whose default is, in the ORIGINAL order:
//     1. `weathers` set AND (no weather OR the active weather is not in the list)  -> false   (raw `arena.weather?.weatherType`)
//     2. `terrains` set AND (no terrain OR the active terrain is not in the list)  -> false   (raw `arena.terrain?.terrainType`)
//   apply: simulated -> nothing. Else pick the candidate with the highest `pokemon.getStat(stat, false)` (strict `>`, so a tie goes
//     to the one listed first) and queue ONE StatStageChangePhase on the holder for `stages`. No random draw.
//
// The two gates are real conditions and are now one condition block (slot ctor:1) that staff can swap or extend (any weather,
// any terrain, HP and so on). The effect "raise the highest of these stats" has no library block (request R-B11-10 in
// requests/B11.md), so it is declared as one piece; the stats to compare are a pick list, not typed text.
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";
import { SelfHighestStatBoostOnSummonAbAttr } from "#data/elite-redux/archetypes/self-highest-stat-boost-on-summon";
import { STAT_SET_OPTIONS, statSetCodec } from "./b11-chunk3-codecs";

export default defineDecl(SelfHighestStatBoostOnSummonAbAttr, {
  tier: "A",
  kind: "event-effect",
  when: "event.on-entry",
  label: "Raise my best stat when I enter",
  summary: params =>
    `When I enter, the highest of ${params.candidates} changes by ${params.stages} stage(s), if the condition holds (a weather for the shipped ones). Example: +1 to the best stat in sun.`,
  synonyms: ["highest stat", "best stat boost", "beast boost", "sun worship", "majestic moth", "boost on entry"],
  examples: ["Raise my highest stat by one stage when I enter", "Raise my best attacking stat by 2 when I enter"],
  params: [
    {
      id: "candidates",
      ctorIndex: 0,
      ctorOption: "candidates",
      path: "candidates",
      control: "select",
      label: "Which stats to compare (the highest of them is raised)",
      editable: true,
      default: STAT_SET_OPTIONS[0],
      options: STAT_SET_OPTIONS,
      codec: statSetCodec,
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
  ],
  conditions: [
    // Sun Worship / Sea Guardian / Greater Spirit: the weather is one of two (an OR of field.weather); the others: always.
    { slot: "ctor:1", ctx: "holder", lib: "field.weather", path: "condition", removable: true, editable: true },
  ],
  guards: [],
  feasibility: [
    "The highest stat is picked by the real stat value right now, and a tie goes to the stat listed first",
    "Never in a preview",
  ],
  effect: { id: "effect.package", params: ["candidates", "stages"] },
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
    "Tier A, justified in the header. Users: Berserk DNA (5258, Attack and Sp. Atk, +2, no gate), Greater Spirit (5329, all five, +1, Fog or Eerie fog), Majestic Moth (5068, all five, +1, no gate), Sea Guardian (5094, Rain or Heavy rain), Sun Worship (5117, Sun or Extremely harsh sunlight), Turf War (5608 attr 1, all five, +1, no gate). The gates are bound to `any` of field.weather (raw weather type: `arena.weatherType` is `weather?.weatherType ?? NONE`, the class reads `weather?.weatherType`, the same for every non-NONE weather) or `{ all: [] }`. No shipped user has a terrain list; a terrain atom (`arena.terrainType`) would differ from the class's raw `arena.terrain?.terrainType` only while Clueless negates field effects. The stat comparison reads live stats, which the L2 twin covers by letting both versions enter a real battle. Remark, NOT fixed: the weather list is compared with the raw weather type; unlike the sandstorm classes it has no suppression test.",
});

/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B10 chunk 4 / event-effect (Tier B).
//
// Read by hand from archetypes/post-summon-clear-terrain.ts. The class extends PostSummonAbAttr (WHEN "when I enter the battle"),
// constructor `{ onCleared?, byTerrain?, healFractionOnCleared? }` (all optional, default empty / 0), `super(true)`. canApply, the only
// clause and all of it the replaceable gate:
//   arena.terrain?.terrainType !== undefined && arena.terrain.terrainType !== NONE        (a terrain object is set and it is not NONE)
// apply: simulated -> nothing; else cleared = arena.terrain?.terrainType, then in this order:
//   1. arena.trySetTerrain(NONE, false)                                        (clear the terrain)
//   2. for each change of [...onCleared, ...byTerrain entries whose terrain === cleared]: StatStageChangePhase for the HOLDER (unshifted)
//   3. healFractionOnCleared > 0 && !holder.isFullHp(): PokemonHealPhase for toDmgValue(maxHp * fraction) with the "post attack heal" message
// No closure, no random draw.
//
// Clause classification: "a terrain is active" is a rule staff would change, so it is the gate; it is bound legacy because it reads the
// terrain OBJECT, while the library terrain atom reads the terrain after the Clueless negation (request R-B10-c4-02). The effect is three
// outcomes of the library (clear the terrain = set it to None, raise a stat, heal a share of max HP), declared as three branches so each
// maps to its library block; they run together, in this order, and the stat raise of a terrain depends on which terrain was cleared (the
// class reads it BEFORE clearing), so the three stay in the class (requests R-B10-c4-06 and R-B10-c4-11). Every number, stat and terrain is
// its own setting; a stat of None leaves the raise out.
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";
import { STAT_OPTIONS } from "#data/elite-redux/ability-studio/vocabulary/enums";
import { PostSummonClearTerrainAbAttr } from "#data/elite-redux/archetypes/post-summon-clear-terrain";
import { NO_STAT } from "./b10-codecs";
import {
  buildClearTerrainOptions,
  clearedStagesCodec,
  clearedStatCodec,
  healPercentCodec,
  terrainRaiseStagesCodec,
  terrainRaiseStatCodec,
} from "./c4-codecs";

/** Every setting lives inside the one options argument, built by `assembleCtorArg`; each names its own key. */
const IN_OPTIONS = { ctorIndex: 0 } as const;

export default defineDecl(PostSummonClearTerrainAbAttr, {
  tier: "B",
  kind: "event-effect",
  when: "event.on-entry",
  label: "Clear the terrain when I enter and gain a bonus",
  summary: params =>
    `When I enter and a terrain is active, it is removed${params.clearedStat === NO_STAT || params.clearedStat === "None" ? "" : `, and I raise ${params.clearedStat} by ${params.clearedStages}`}${Number(params.healPercent) > 0 ? ` and heal ${params.healPercent}% of my max HP` : ""}. Can raise a different stat for each terrain.`,
  synonyms: [
    "remove the terrain",
    "eat the terrain",
    "destroy terrain on entry",
    "lawnmower",
    "turf war",
    "curse of famine",
    "terrain eater",
  ],
  examples: [
    "When I enter, the terrain is cleared and my Defense goes up one stage, and I heal 25%, like Curse of Famine",
    "Clearing Grassy Terrain raises Defense, clearing Misty Terrain raises Sp. Def, like Lawnmower",
  ],
  params: [
    {
      id: "clearedStat",
      ...IN_OPTIONS,
      ctorOption: "clearedStat",
      path: "onCleared",
      control: "select",
      label: "Stat I raise whenever a terrain is cleared (None = no raise)",
      editable: true,
      gateIndependent: true,
      default: NO_STAT,
      options: [NO_STAT, ...STAT_OPTIONS],
      codec: clearedStatCodec,
    },
    {
      id: "clearedStages",
      ...IN_OPTIONS,
      ctorOption: "clearedStages",
      path: "onCleared",
      control: "number",
      min: -6,
      max: 6,
      step: 1,
      integer: true,
      label: "Stages for that raise (1 = one stage up)",
      editable: true,
      gateIndependent: true,
      default: 1,
      codec: clearedStagesCodec,
    },
    {
      id: "healPercent",
      ...IN_OPTIONS,
      ctorOption: "healPercent",
      path: "healFractionOnCleared",
      control: "number",
      min: 0,
      max: 100,
      step: 1,
      integer: true,
      label: "HP I heal when a terrain is cleared (% of max HP, 0 = no heal)",
      editable: true,
      gateIndependent: true,
      default: 0,
      codec: healPercentCodec,
    },
    {
      id: "grassyStat",
      ...IN_OPTIONS,
      ctorOption: "grassyStat",
      path: "byTerrain",
      control: "select",
      label: "Stat to raise when Grassy Terrain is cleared (None = no raise)",
      editable: true,
      gateIndependent: true,
      default: NO_STAT,
      options: [NO_STAT, ...STAT_OPTIONS],
      codec: terrainRaiseStatCodec("GRASSY"),
    },
    {
      id: "grassyStages",
      ...IN_OPTIONS,
      ctorOption: "grassyStages",
      path: "byTerrain",
      control: "number",
      min: -6,
      max: 6,
      step: 1,
      integer: true,
      label: "Stages for the Grassy Terrain raise (1 = one stage up)",
      editable: true,
      gateIndependent: true,
      default: 1,
      codec: terrainRaiseStagesCodec("GRASSY"),
    },
    {
      id: "electricStat",
      ...IN_OPTIONS,
      ctorOption: "electricStat",
      path: "byTerrain",
      control: "select",
      label: "Stat to raise when Electric Terrain is cleared (None = no raise)",
      editable: true,
      gateIndependent: true,
      default: NO_STAT,
      options: [NO_STAT, ...STAT_OPTIONS],
      codec: terrainRaiseStatCodec("ELECTRIC"),
    },
    {
      id: "electricStages",
      ...IN_OPTIONS,
      ctorOption: "electricStages",
      path: "byTerrain",
      control: "number",
      min: -6,
      max: 6,
      step: 1,
      integer: true,
      label: "Stages for the Electric Terrain raise (1 = one stage up)",
      editable: true,
      gateIndependent: true,
      default: 1,
      codec: terrainRaiseStagesCodec("ELECTRIC"),
    },
    {
      id: "mistyStat",
      ...IN_OPTIONS,
      ctorOption: "mistyStat",
      path: "byTerrain",
      control: "select",
      label: "Stat to raise when Misty Terrain is cleared (None = no raise)",
      editable: true,
      gateIndependent: true,
      default: NO_STAT,
      options: [NO_STAT, ...STAT_OPTIONS],
      codec: terrainRaiseStatCodec("MISTY"),
    },
    {
      id: "mistyStages",
      ...IN_OPTIONS,
      ctorOption: "mistyStages",
      path: "byTerrain",
      control: "number",
      min: -6,
      max: 6,
      step: 1,
      integer: true,
      label: "Stages for the Misty Terrain raise (1 = one stage up)",
      editable: true,
      gateIndependent: true,
      default: 1,
      codec: terrainRaiseStagesCodec("MISTY"),
    },
    {
      id: "psychicStat",
      ...IN_OPTIONS,
      ctorOption: "psychicStat",
      path: "byTerrain",
      control: "select",
      label: "Stat to raise when Psychic Terrain is cleared (None = no raise)",
      editable: true,
      gateIndependent: true,
      default: NO_STAT,
      options: [NO_STAT, ...STAT_OPTIONS],
      codec: terrainRaiseStatCodec("PSYCHIC"),
    },
    {
      id: "psychicStages",
      ...IN_OPTIONS,
      ctorOption: "psychicStages",
      path: "byTerrain",
      control: "number",
      min: -6,
      max: 6,
      step: 1,
      integer: true,
      label: "Stages for the Psychic Terrain raise (1 = one stage up)",
      editable: true,
      gateIndependent: true,
      default: 1,
      codec: terrainRaiseStagesCodec("PSYCHIC"),
    },
    {
      id: "toxicStat",
      ...IN_OPTIONS,
      ctorOption: "toxicStat",
      path: "byTerrain",
      control: "select",
      label: "Stat to raise when Toxic Terrain is cleared (None = no raise)",
      editable: true,
      gateIndependent: true,
      default: NO_STAT,
      options: [NO_STAT, ...STAT_OPTIONS],
      codec: terrainRaiseStatCodec("TOXIC"),
    },
    {
      id: "toxicStages",
      ...IN_OPTIONS,
      ctorOption: "toxicStages",
      path: "byTerrain",
      control: "number",
      min: -6,
      max: 6,
      step: 1,
      integer: true,
      label: "Stages for the Toxic Terrain raise (1 = one stage up)",
      editable: true,
      gateIndependent: true,
      default: 1,
      codec: terrainRaiseStagesCodec("TOXIC"),
    },
  ],
  assembleCtorArg: { index: 0, build: buildClearTerrainOptions },
  conditions: [
    // The gate: a terrain is active (the terrain object is set and is not None). All three users are legacy until R-B10-c4-02 exists.
    { slot: "gate", ctx: "params", removable: true, editable: true },
  ],
  guards: [],
  feasibility: [
    "The heal only happens when I am not already at full HP",
    "The stat raises and the heal are queued in front of everything else, one after the other",
    "Nothing happens in a preview",
  ],
  branches: [
    {
      label: "Clear the terrain",
      conditions: ["a terrain is active"],
      effect: { id: "effect.set-terrain", params: [] },
    },
    {
      label: "Raise a stat of mine for the cleared terrain",
      conditions: ["a terrain is active", "the cleared terrain has a stat set"],
      effect: {
        id: "effect.stat-stage",
        params: [
          "clearedStat",
          "clearedStages",
          "grassyStat",
          "grassyStages",
          "electricStat",
          "electricStages",
          "mistyStat",
          "mistyStages",
          "psychicStat",
          "psychicStages",
          "toxicStat",
          "toxicStages",
        ],
      },
    },
    {
      label: "Heal a share of my max HP",
      conditions: ["a terrain is active", "I am not at full HP"],
      effect: { id: "effect.heal-percent", params: ["healPercent"] },
    },
  ],
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "none", simulated: "respects" },
  probes: [{ name: "entry with and without a terrain", axes: { hp: ["max", "50%"] } }],
  l2StaticReason:
    "All three users are legacy-closure gates, so the rebuild cannot be built and the L2 twin has no rebuilt attr to compare. The B10 test (test/tests/elite-redux/decomp/B10/chunk4-gates.test.ts) drives canApply of the class and of a frozen copy of the original rule over every terrain, and chunk4-effects.test.ts compares the queued phases of the original and the rebuild for each user.",
  status: "decomposed",
  notes:
    "Tier B split by hand (no guards, gate = the whole old canApply, no residual). Users (3 attrs): Lawnmower attr 0 (no common raise, per terrain Grassy and Electric raise Defense 1, Misty, Psychic and Toxic raise Sp. Def 1, no heal), Curse of Famine attr 0 (common raise Defense 1, heal 25%) and Turf War attr 0 (no options at all: it only clears the terrain; its stat boost is the next attr, SelfHighestStatBoostOnSummonAbAttr); the three gates are legacy (request R-B10-c4-02: the class tests the terrain object, so a terrain negated by Clueless still counts here, while the library atom answers None then). The effect is declared as three branches (clear, raise a stat, heal) that each map to a library block (set terrain to None, raise a stat, heal a share of max HP); they are not equal to the library blocks yet because the stat raise depends on the terrain read before the clear and the order of the queued phases (stat raises first, then the heal, each unshifted to the front) is part of the behaviour (requests R-B10-c4-06 and R-B10-c4-11). The class keeps every list as data: the per-terrain list holds one entry per terrain in the order Grassy, Electric, Misty, Psychic, Toxic (an entry list that does not fit is reported as not representable instead of dropped). Oddities, NOT fixed: the heal uses the generic post-attack heal message text; two entries for the same terrain would both apply (the settings allow only one per terrain); the heal needs `!isFullHp()` at queue time, not when the heal phase runs.",
});

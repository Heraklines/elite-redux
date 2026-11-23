/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B10 chunk 5 / event-effect (Tier A, no condition slot).
//
// Read by hand from archetypes/post-summon-stack-set-effects.ts. The class extends PostSummonAbAttr (WHEN "when I enter the battle"),
// constructor `{ terrain?, tags? }` kept in the private field `opts`, `super(true)`. canApply: always true (no condition, no
// feasibility). apply: simulated -> nothing; else (1) the terrain, when one is set: arena.trySetTerrain(terrain, false); then (2) for each
// field effect in the list, in order: its side is resolved RELATIVE to the holder (PLAYER = the holder's own side, ENEMY = the other side,
// BOTH = both) and arena.addTag(type, turns, undefined, holder.id, side) is called. No closure, no random draw.
//
// Settings: the terrain (or none), and up to two field effects, each with its own type, turns and side. The class takes any number of
// field effects; both live users have exactly one (Tailwind for 4 turns on my own side). The effect is the library's "set the terrain"
// followed by "set a field effect" (effect.arena-tag, planned, not compiled yet), declared as two branches that each map to a library block.
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";
import { PostSummonStackSetEffectsAbAttr } from "#data/elite-redux/archetypes/post-summon-stack-set-effects";
import { NOTHING } from "./c3-codecs";
import {
  buildStackOptions,
  SIDE_MINE,
  STACK_FIELD_EFFECTS,
  STACK_SIDES,
  STACK_TERRAINS,
  stackTagSideCodec,
  stackTagTurnsCodec,
  stackTagTypeCodec,
  stackTerrainCodec,
} from "./c5-codecs";

const IN_OPTS = { ctorIndex: 0, path: "opts" } as const;

/** The three settings of one field effect slot (1 or 2). */
function fieldEffectSlot(slot: 1 | 2, position: 0 | 1) {
  const ordinal = slot === 1 ? "first" : "second";
  return [
    {
      id: `tagType${slot}`,
      ...IN_OPTS,
      ctorOption: `tagType${slot}`,
      control: "select" as const,
      label: `The ${ordinal} field effect to set (None = not used)`,
      editable: true,
      default: slot === 1 ? "TAILWIND" : NOTHING,
      options: [NOTHING, ...STACK_FIELD_EFFECTS],
      codec: stackTagTypeCodec(position),
    },
    {
      id: `tagTurns${slot}`,
      ...IN_OPTS,
      ctorOption: `tagTurns${slot}`,
      control: "number" as const,
      min: 1,
      max: 10,
      step: 1,
      integer: true,
      label: `Number of turns the ${ordinal} field effect lasts (1-10)`,
      editable: true,
      default: slot === 1 ? 4 : 5,
      codec: stackTagTurnsCodec(position),
    },
    {
      id: `tagSide${slot}`,
      ...IN_OPTS,
      ctorOption: `tagSide${slot}`,
      control: "select" as const,
      label: `Which side gets the ${ordinal} field effect (my side, the foes' side or both)`,
      editable: true,
      default: SIDE_MINE,
      options: [...STACK_SIDES],
      codec: stackTagSideCodec(position),
    },
  ];
}

export default defineDecl(PostSummonStackSetEffectsAbAttr, {
  tier: "A",
  kind: "event-effect",
  when: "event.on-entry",
  label: "Set a terrain and a field effect together when I enter",
  summary: params =>
    `When I enter, the terrain becomes ${params.terrain === "NONE" ? "unchanged" : params.terrain} and ${params.tagType1 === NOTHING ? "no field effect is set" : `${params.tagType1} is set for ${params.tagTurns1} turns`}. Example: Grassy Terrain plus Tailwind for 4 turns on my side.`,
  synonyms: [
    "terrain and tailwind",
    "set terrain and a screen",
    "double field setup on entry",
    "surge and tailwind",
    "field effect on entry",
    "gale bloom",
    "harukaze",
    "team buff on switch in",
  ],
  examples: [
    "When I enter, Grassy Terrain is set and Tailwind runs for 4 turns on my side, like Harukaze",
    "When I enter, Light Screen goes up on my side for 5 turns",
  ],
  params: [
    {
      id: "terrain",
      ...IN_OPTS,
      ctorOption: "terrain",
      control: "select",
      label: "Terrain to set (None = leave the terrain alone)",
      editable: true,
      default: "GRASSY",
      options: [...STACK_TERRAINS],
      codec: stackTerrainCodec,
    },
    ...fieldEffectSlot(1, 0),
    ...fieldEffectSlot(2, 1),
  ],
  assembleCtorArg: { index: 0, build: buildStackOptions },
  conditions: [],
  guards: [],
  feasibility: [
    "The terrain can fail to change when the game blocks it (the same terrain already up, or a terrain lock)",
    "Each field effect lands on the side chosen RELATIVE to me: my side is whichever side I am on",
    "The terrain is set first, then the field effects in order",
    "Nothing happens in a preview",
  ],
  branches: [
    {
      label: "Set the terrain",
      conditions: [],
      effect: { id: "effect.set-terrain", params: ["terrain"] },
    },
    {
      label: "Set a field effect on a side",
      conditions: [],
      effect: {
        id: "effect.arena-tag",
        params: ["tagType1", "tagTurns1", "tagSide1", "tagType2", "tagTurns2", "tagSide2"],
      },
    },
  ],
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "none", simulated: "respects" },
  probes: [{ name: "entry with and without a terrain", axes: {} }],
  status: "decomposed",
  notes:
    "Tier A. Users (2 attrs): Harukaze attr 0 and Gale Bloom attr 1, both Grassy Terrain plus Tailwind for 4 turns on my own side (side PLAYER = holder-relative); nothing to bind. The effect is declared as two branches that each map to a library block (set the terrain; set a field effect, effect.arena-tag, which is planned and has no turns, no holder-relative side and no source yet, request R-B10-c5-04). Settings: the terrain, and two field effect slots (type, turns, side); a rebuilt instance with an empty second slot lists exactly one field effect, as the live users do. A live list longer than two, or a side the choices do not have, is reported as not representable instead of dropped; an explicit terrain of None (clear it) is also not representable. Oddities, NOT fixed: the description of Harukaze says 'setting Grassy Terrain sets Tailwind and vice versa' but the class only sets both when the holder enters (the 'vice versa' half does not exist, documented in the source as an approximation); Gale Bloom's description is not covered by this class beyond the same entry pair; the inverse (a tag on the foes' side) can use the second slot for two different sides.",
});

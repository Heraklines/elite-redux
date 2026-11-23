/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B15 chunk 1. Tier A, event-effect on entry, no condition slot. "When I enter, a Swirly Room (physical and special moves swap) starts for 3 turns."
//
// Source: src/data/elite-redux/abilities/barbaracle-mechanics.ts, class SwirlifyAbAttr (extends PostSummonAbAttr; showAbility true, activateOnGain true).
//   canApply   none of its own (PostSummonAbAttr answers true)
//   apply      unless simulated: arena.addTag(tagType, turnCount, MoveId.NONE, holder.id, side)
// The class used to hard-code Swirly Room, getSwirlyRoomDuration("ability") = 3 turns and both sides; the constructor now takes those three values with
// the old ones as defaults (behaviour-neutral). The source move is always MoveId.NONE here, whereas the generic "set a field effect on entry" class
// passes `undefined`; this class keeps its own call. No random draw, no state of its own (the tag lives in the arena). Nothing to bind (no closure).
import { SwirlifyAbAttr } from "#data/elite-redux/abilities/barbaracle-mechanics";
import { defineDecl, type ParamCodec } from "#data/elite-redux/ability-studio/define-decl";
import { ArenaTagSide } from "#enums/arena-tag-side";
import { ArenaTagType } from "#enums/arena-tag-type";

const SIDE_NAMES = ["BOTH_SIDES", "PLAYER_SIDE", "ENEMY_SIDE"] as const;

const sideCodec: ParamCodec = {
  toCtor: value => {
    switch (String(value)) {
      case "BOTH_SIDES":
        return ArenaTagSide.BOTH;
      case "PLAYER_SIDE":
        return ArenaTagSide.PLAYER;
      case "ENEMY_SIDE":
        return ArenaTagSide.ENEMY;
      default:
        throw new Error(`"${String(value)}" is not a side (both sides, the player's side or the enemy's side)`);
    }
  },
  fromInstance: raw => {
    switch (raw) {
      case ArenaTagSide.BOTH:
        return "BOTH_SIDES";
      case ArenaTagSide.PLAYER:
        return "PLAYER_SIDE";
      case ArenaTagSide.ENEMY:
        return "ENEMY_SIDE";
      default:
        return;
    }
  },
};

const FIELD_EFFECT_OPTIONS = Object.values(ArenaTagType).filter(name => name !== ArenaTagType.NONE);

export default defineDecl(SwirlifyAbAttr, {
  tier: "A",
  kind: "event-effect",
  when: "event.on-entry",
  label: "Set Swirly Room (or another field effect) when I enter",
  summary: params =>
    `When I enter the battle, ${params.arenaTag} starts on ${params.side} for ${params.turnCount} turn(s). Swirly Room makes physical moves count as special and special moves count as physical.`,
  synonyms: [
    "swirlify",
    "swirly room",
    "swap physical and special",
    "category swap",
    "room on entry",
    "field effect on entry",
  ],
  examples: ["Start Swirly Room for 3 turns when I enter", "Set a field effect for a few turns as I come in"],
  params: [
    {
      id: "turnCount",
      ctorIndex: 0,
      path: "turnCount",
      control: "number",
      min: 1,
      max: 99,
      step: 1,
      integer: true,
      label: "Number of turns it lasts",
      editable: true,
      default: 3,
    },
    {
      id: "arenaTag",
      ctorIndex: 1,
      path: "tagType",
      control: "select",
      label: "Field effect to set",
      editable: true,
      default: "SWIRLY_ROOM",
      options: FIELD_EFFECT_OPTIONS,
    },
    {
      id: "side",
      ctorIndex: 2,
      path: "side",
      control: "select",
      label: "Which side gets it",
      editable: true,
      default: "BOTH_SIDES",
      options: [...SIDE_NAMES],
      codec: sideCodec,
    },
  ],
  conditions: [],
  guards: [],
  feasibility: [
    "A field effect of that kind already on that side is not added a second time",
    "It does nothing in a preview",
  ],
  effect: { id: "effect.arena-tag", params: ["arenaTag", "side", "turnCount"] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "none", simulated: "respects" },
  probes: [{ name: "enter and let three turns pass", axes: {} }],
  status: "decomposed",
  notes:
    "Tier A, no closure, nothing to bind. 1 attr in 1 ability: Swirlify (6075 attr 0). Constructor change (behaviour-neutral): turnCount, tagType and side are now constructor arguments whose defaults are the old literals (3 turns from getSwirlyRoomDuration('ability'), SWIRLY_ROOM, both sides). Differs from the generic entry field-effect class in two ways kept as they are: the source move is MoveId.NONE (the generic class passes undefined) and the side is stored as BOTH (the generic class stores undefined). The Swirly Room tag itself (category swap in Pokemon.getMoveCategory and the damage path) is read through isSwirlyRoomActive and is not part of this attr. The move version (Swirly Room, 5 turns) is a move effect, not this class.",
});

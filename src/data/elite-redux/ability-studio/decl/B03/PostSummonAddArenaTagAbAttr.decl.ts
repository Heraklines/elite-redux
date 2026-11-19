/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B03 chunk 2. Tier A, event-effect on entry, no condition slot.
//
//   canApply   none of its own (PostSummonAbAttr answers true)
//   apply      this.sourceId = holder.id   (a temp field; the next call overwrites it)
//              unless simulated: arena.addTag(tagType, turnCount, undefined, sourceId, side, quiet)
//              arena.addTag defaults: side BOTH, quiet false. A tag of that type already on that side is only told
//              "overlap" (no second copy), so repeating the entry does not stack.
//
// All five constructor arguments are params. `side` and `quiet` are optional: every shipped user leaves them out, which
// the class stores as `undefined` (not as "both" / false). The codecs therefore read `undefined` as the choices
// "BOTH_SIDES" and "no", and write those choices back as `undefined`, so a rebuilt instance of a shipped user has exactly
// the same fields. (An explicit `ArenaTagSide.BOTH` or `quiet = false` would read back as the same words and be rebuilt
// as `undefined`: same behaviour, different field; no shipped user does that.)
import { PostSummonAddArenaTagAbAttr } from "#abilities/ab-attrs";
import { defineDecl, type ParamCodec } from "#data/elite-redux/ability-studio/define-decl";
import { ArenaTagSide } from "#enums/arena-tag-side";
import { ArenaTagType } from "#enums/arena-tag-type";
import { stringEnumCodec } from "./codecs";

const SIDE_NAMES = ["BOTH_SIDES", "PLAYER_SIDE", "ENEMY_SIDE"] as const;

const sideCodec: ParamCodec = {
  toCtor: value => {
    switch (String(value)) {
      case "BOTH_SIDES":
        return;
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
      case undefined:
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

const quietCodec: ParamCodec = {
  toCtor: value => (value === true ? true : undefined),
  fromInstance: raw => raw === true,
};

const FIELD_EFFECT_OPTIONS = Object.keys(ArenaTagType).filter(name => name !== "NONE");

export default defineDecl(PostSummonAddArenaTagAbAttr, {
  tier: "A",
  kind: "event-effect",
  when: "event.on-entry",
  label: "Set a field effect when I enter",
  summary: params =>
    `When I enter the battle, ${params.arenaTag} is set on ${params.side} for ${params.turnCount} turn(s) (0 = until something removes it). Example: Inverse Room for 5 turns.`,
  synonyms: [
    "neutralizing gas",
    "set a room",
    "summon field effect",
    "inverse room",
    "entry field effect",
    "start a room on entry",
  ],
  examples: ["Set Inverse Room for 5 turns when I enter", "Switch off all other abilities while I am on the field"],
  params: [
    {
      id: "showAbility",
      ctorIndex: 0,
      path: "showAbility",
      control: "boolean",
      label: "Show my ability name when it triggers",
      editable: true,
      default: true,
    },
    {
      id: "arenaTag",
      ctorIndex: 1,
      path: "tagType",
      control: "select",
      label: "Field effect to set",
      editable: true,
      default: "INVERSE_ROOM",
      options: FIELD_EFFECT_OPTIONS,
      codec: stringEnumCodec(ArenaTagType as unknown as Readonly<Record<string, string>>, "field effect"),
    },
    {
      id: "turnCount",
      ctorIndex: 2,
      path: "turnCount",
      control: "number",
      min: 0,
      max: 99,
      step: 1,
      integer: true,
      label: "Number of turns it lasts (0 = until something removes it)",
      editable: true,
      default: 5,
    },
    {
      id: "side",
      ctorIndex: 3,
      path: "side",
      control: "select",
      label: "Which side gets it",
      editable: true,
      default: "BOTH_SIDES",
      options: [...SIDE_NAMES],
      codec: sideCodec,
    },
    {
      id: "quiet",
      ctorIndex: 4,
      path: "quiet",
      control: "boolean",
      label: "Hide the field effect's own start message",
      editable: true,
      default: false,
      codec: quietCodec,
    },
  ],
  conditions: [],
  guards: [],
  feasibility: [
    "A field effect of that kind already on that side is not added a second time",
    "It does nothing in a preview",
  ],
  effect: { id: "effect.arena-tag", params: ["arenaTag", "side"] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "entry", simulated: "respects" },
  probes: [{ name: "entry with the default field", axes: {} }],
  status: "decomposed",
  notes:
    "Tier A, 2 attrs of 2 abilities, no closure: Neutralizing Gas (256: NEUTRALIZING_GAS, 0 turns = until the holder leaves, both sides) and Inverse Room (5998: INVERSE_ROOM, 5 turns). Both leave `side` and `quiet` undefined. The effect block `effect.arena-tag` has no turn count and offers only holder-side / opposing-side / both, while the class takes an ABSOLUTE side (player or enemy) and a turn count; both are params here and the block should gain them (requests/B03.md). `sourceId` is a temp field the class writes on every apply; the rebuilt instance has its own, so nothing is shared. Neutralizing Gas also depends on the foundation's engine-query routing (the engine asks the arena tag, not this attr).",
});

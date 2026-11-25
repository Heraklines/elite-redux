/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B16 chunk 3 (Tier A, event-effect). "When I enter the battle, Wonder Room (Defense and Sp. Def swap) is set on both sides for 5 turns."
//
// Source: fakemon-pitch-mechanics.ts, PostSummonWonderRoomAbAttr (extends PostSummonAbAttr; `activateOnGain` true from the parent).
// Constructor `(roomTurns = 5)`: the new argument replaces the literal 5.
//   canApply  the parent's (always true): no condition, no feasibility test (a second Wonder Room is simply refused by the arena)
//   apply     (skipped when `simulated`) `arena.addTag(WONDER_ROOM, roomTurns, MoveId.WONDER_ROOM, holder.id, ArenaTagSide.BOTH)`
// No random draw, no state. The field effect, its source move (Wonder Room) and its side (both) are fixed.
import { PostSummonWonderRoomAbAttr } from "#data/elite-redux/abilities/fakemon-pitch-mechanics";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";

export default defineDecl(PostSummonWonderRoomAbAttr, {
  tier: "A",
  kind: "event-effect",
  when: "event.on-entry",
  label: "Swap Defense and Sp. Def for everyone when I enter",
  summary: params =>
    `When I enter the battle, Defense and Sp. Def are swapped for every Pokemon on both sides for ${params.turns} turns. Example: 5 = the room lasts 5 turns.`,
  synonyms: [
    "wonder room",
    "swap defenses",
    "swap defense and special defense",
    "false equivalence",
    "defense swap room",
    "field defense swap",
    "stat swap field",
  ],
  examples: ["Set Wonder Room for 5 turns when I enter the battle, like False Equivalence"],
  params: [
    {
      id: "turns",
      ctorIndex: 0,
      path: "roomTurns",
      control: "number",
      label: "How many turns the room lasts",
      editable: true,
      integer: true,
      min: 1,
      max: 20,
      step: 1,
      default: 5,
    },
  ],
  conditions: [],
  guards: [],
  feasibility: [
    "Nothing happens while the game only previews the entry",
    "If a Wonder Room is already up, the field refuses a second one",
  ],
  effect: { id: "effect.arena-tag", params: ["turns"] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "none", simulated: "respects" },
  probes: [{ name: "entry with the default field", axes: {} }],
  status: "decomposed",
  notes:
    "Tier A, fully decomposed: trigger (on entry), no IF (the class has no condition), one effect (set a field effect on both sides: Wonder Room) with one typed param, the number of turns. The library effect effect.arena-tag is planned and has no turns, no source move and no Wonder Room entry in its tag list: R-B16-20 in requests/B16.md. The tag, the source move (Wonder Room, which the arena tag reads for its message and its 'already up' refusal) and the side (both) are fixed by the class; staff choose them through the library effect, only the length is a class setting. Nothing to bind: no closure. User: False Equivalence (6007, attr 0). Unlike the weather and terrain abilities, this class does not call the length patch with the item extender itself; whether the field effect adds an extension on its own is the field effect's business.",
});

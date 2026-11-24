/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B08 chunk 3 / event-effect, Tier B. Read from the source (archetypes/copy-move-by-filter.ts, its parent
// PostDancingMoveAbAttr in ab-attrs.ts, the dispatch in move-phase.ts executeMove) and from the live instances of the 3
// users (Parroting, Ball Fetch, Lunar Affinity). canApply is now `guards && gate`, in the original clause order:
//
//   guards  1. the source is the holder itself (same battler index)                       -> false   (feasibility: never copy my own move)
//           2. the holder is semi-invulnerable (flying, underwater, underground, hidden)  -> false   (feasibility: the copy could not be used)
//   gate    3. flag set and !move.hasFlag(flag)                                           -> false   atom move.inherent-flag
//           4. anyFlags set and no flag of the list is on the move                        -> false   any[ move.inherent-flag ... ]
//           5. moveIds set and the move id is not in the list                             -> false   any[ move.is-move ... ]
//   apply   (inherited PostDancingMoveAbAttr.apply, unchanged) queues the SAME move as an indirect move: on the holder
//           itself when the move targets the user or its allies, otherwise at the source of the move (or its targets).
//           Skipped when simulated. No random draw anywhere.
//
// The three filter settings (flag, anyFlags, moveIds) decide the SHAPE of the gate, so they are not editable: each user's
// gate binding spells out its own shape (bindings.ts). The class reads the move's OWN flags (hasFlag), so the atom is
// `move.inherent-flag`, not the user-aware `move.flag` (they differ for Long Reach and for substitutes).
//
// The effect is a package placeholder: no library block "use the move that was just used" exists yet (request R-B08-24).
import {
  MOVE_LIST_CHOICES,
  moveListPresetCodec,
  NO_MOVE_LIST,
  NO_PROPERTIES,
  PROPERTY_CHOICES,
  propertyCodec,
  propertyListCodec,
} from "#data/elite-redux/ability-studio/decl/B08/chunk3-choices";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";
import { CopyMoveByFilterAbAttr } from "#data/elite-redux/archetypes/copy-move-by-filter";

export default defineDecl(CopyMoveByFilterAbAttr, {
  tier: "B",
  kind: "event-effect",
  when: "event.after-any-move",
  label: "Copy a matching move another Pokemon just used",
  summary: params => {
    const kinds: string[] = [];
    if (params.flag !== "None") {
      kinds.push(String(params.flag).toLowerCase());
    }
    if (String(params.anyFlags) !== NO_PROPERTIES) {
      kinds.push(`any of these: ${String(params.anyFlags).toLowerCase()}`);
    }
    if (params.moveList !== NO_MOVE_LIST) {
      kinds.push("moves with star, moon or lunar in their name");
    }
    const which = kinds.length === 0 ? "any move" : kinds.join(", and also ");
    return `Right after another Pokemon uses ${which}, I use the same move myself, for free. Example: copying every sound move that is used.`;
  },
  synonyms: [
    "copy moves",
    "dancer",
    "parroting",
    "echo a move",
    "repeat a move",
    "mimic moves",
    "copy sound moves",
    "ball fetch",
    "lunar affinity",
  ],
  examples: ["Copy every sound move that another Pokemon uses, like Parroting"],
  params: [
    {
      id: "flag",
      ctorIndex: 0,
      ctorOption: "flag",
      path: "flag",
      control: "select",
      label: "Only moves with this property (set by the conditions)",
      // Decides the SHAPE of the gate (each user's binding spells it out).
      editable: false,
      default: "None",
      options: PROPERTY_CHOICES,
      codec: propertyCodec,
    },
    {
      id: "anyFlags",
      ctorIndex: 0,
      ctorOption: "anyFlags",
      path: "anyFlags",
      control: "text",
      label: "Moves with any one of these properties (comma separated, empty = no list; set by the conditions)",
      editable: false,
      default: NO_PROPERTIES,
      options: PROPERTY_CHOICES.filter(choice => choice !== "None"),
      codec: propertyListCodec,
    },
    {
      id: "moveList",
      ctorIndex: 0,
      ctorOption: "moveIds",
      path: "moveIds",
      control: "select",
      label: "Only these moves (set by the conditions; a list this long is kept as a ready-made choice)",
      editable: false,
      default: NO_MOVE_LIST,
      options: MOVE_LIST_CHOICES,
      codec: moveListPresetCodec,
    },
  ],
  conditions: [
    // The gate is a group of atoms per user shape, in the original order (bindings.ts):
    //   flag:        move.inherent-flag F
    //   anyFlags:    any[ move.inherent-flag F1, move.inherent-flag F2 ]
    //   moveIds:     any[ move.is-move M1 ... Mn ]
    { slot: "gate", ctx: "params", removable: true, editable: true },
  ],
  guards: [],
  feasibility: [
    "Never copies a move that I used myself",
    "Cannot copy while I am up in the air, underground, underwater or otherwise out of reach",
    "Only attacking and status moves are copied, and the copy never uses up PP",
  ],
  effect: { id: "effect.package", params: [] },
  reusableAlone: { when: true, if: true, do: true },
  flags: {
    rng: "none",
    rngOrder: [],
    state: "none",
    simulated: "respects",
  },
  probes: [
    {
      // A sound move, a contact move, a status move and a ball move used by the foe: the filter must pass or stop each of them.
      // A copied attack would knock out the default level 30 enemy in the middle of the scenario, so the enemy is level 100 and
      // my Sp. Atk is at -6 (both runs get the same state).
      name: "sound, ball, contact, status and non-matching moves",
      axes: {
        foeMove: ["HYPER_VOICE", "ACID_SPRAY", "TACKLE", "GROWL", "WATER_GUN"],
        foeLevel: [100],
        stage: ["SPATK:-6"],
      },
    },
  ],
  status: "decomposed",
  notes:
    "Tier B split by hand: canApply = guards && gate (a pure move of the original clauses; nothing random). The effect is a package PLACEHOLDER, written reason: no library effect copies 'the move that was just used' (the move is only known at run time, aimed at the right side by PostDancingMoveAbAttr.apply, which Dancer shares), so the DO cannot be split into existing blocks. Request R-B08-24 asks for `effect.copy-used-move`. WHEN and every IF are separate blocks. Users (3; two gates bound, Lunar Affinity legacy): Parroting (flag: sound), Ball Fetch attr 1 (anyFlags: ball and bomb, throwing), Lunar Affinity (a list of 15 moves, built at start-up from every move whose name has star, moon or lunar in it; four are Elite Redux custom moves that the atom move.is-move cannot name yet, so its gate is a LEGACY CLOSURE with a reason, request R-B08-33). The moveIds param is a two-choice preset because a 15-name list is longer than a setting may be (120 characters). The class ignores the move's targets for filtering and never rolls. The parent's dance-flag check is NOT part of this class (it is overridden), so Taekkyeon-style flag injection does not matter here (hasFlag, not the user-aware check). Siblings (PostDancingMoveAbAttr, Dancer) are separate classes.",
});

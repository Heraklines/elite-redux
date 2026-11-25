/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B15 chunk 1. Tier C, while-active property injection. "My slicing moves also count as horn moves, and my horn moves also count as slicing moves."
//
// Source: src/data/elite-redux/abilities/barbaracle-mechanics.ts, class RapierFlagInjectionAbAttr (extends AbAttr; showAbility false). NOTHING is
// dispatched. Move.doesFlagEffectApply (src/data/moves/move.ts, the user-aware flag check) walks the USER's active ability attrs and asks every attr that
// has the duck-typed method `injects(flag, move)`; the first yes makes the property apply. The rule of `injects`, with the two properties now ctor
// arguments (defaults = the old literals, behaviour-neutral):
//   (flag === firstFlag  && move.hasFlag(secondFlag))  ||  (flag === secondFlag && move.hasFlag(firstFlag))
// The tests read the move's PRINTED properties (hasFlag), never an injected one, so two injectors never chain. The flag is compared by EQUALITY, so a
// bit mask never matches. Consumers that call move.hasFlag directly (not doesFlagEffectApply) do not see an injection. No random draw, no state,
// nothing reads `simulated`. No closure, nothing to bind.
// Tier C: there is no gate to split; the whole rule is one lookup the engine does by itself. Extra IFs cannot be added (`if: false`).
import { RapierFlagInjectionAbAttr } from "#data/elite-redux/abilities/barbaracle-mechanics";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";
import { enumCodec } from "#data/elite-redux/ability-studio/param-codecs";
import { MOVE_FLAG_OPTIONS } from "#data/elite-redux/ability-studio/vocabulary/enums";
import { MoveFlags } from "#enums/move-flags";

export default defineDecl(RapierFlagInjectionAbAttr, {
  tier: "C",
  kind: "while-active",
  when: "while.active",
  label: "Two kinds of my moves count as each other (Rapier)",
  summary: params =>
    `While I have this, my moves with the "${params.firstFlag}" property also count as "${params.secondFlag}", and the reverse, for anything that checks those properties. The moves do not change.`,
  synonyms: [
    "rapier",
    "slicing counts as horn",
    "horn counts as slicing",
    "keen edge and hunter's horn",
    "swap move property",
    "counts as another kind of move",
  ],
  examples: ["My slicing moves also count as horn moves and my horn moves also count as slicing moves, like Rapier"],
  params: [
    {
      id: "firstFlag",
      ctorIndex: 0,
      path: "firstFlag",
      control: "select",
      label: "First move property (for example Horn based)",
      editable: true,
      default: "HORN_BASED",
      options: MOVE_FLAG_OPTIONS,
      codec: enumCodec(MoveFlags, "move property"),
    },
    {
      id: "secondFlag",
      ctorIndex: 1,
      path: "secondFlag",
      control: "select",
      label: "Second move property (for example Slicing move)",
      editable: true,
      default: "SLICING_MOVE",
      options: MOVE_FLAG_OPTIONS,
      codec: enumCodec(MoveFlags, "move property"),
    },
  ],
  conditions: [],
  guards: [],
  feasibility: [
    "Only abilities and effects that ask the game whether a move counts as that property notice it; anything that reads the move's own printed property does not",
    "Which of my moves qualify is decided from the move's own printed properties, never from a property another ability added",
  ],
  reusableAlone: { when: true, if: false, do: true },
  flags: { rng: "none", state: "none", simulated: "respects" },
  probes: [{ name: "the holder attacks a foe with a damaging move", axes: { foeMove: ["TACKLE", "WATER_GUN"] } }],
  l2StaticReason:
    "A property injection has no dispatch moment (no trace event): the engine asks it from Move.doesFlagEffectApply. The twin compares the whole battle, and B15/chunk1.test.ts proves the truth table through the engine function itself.",
  status: "decomposed",
  notes:
    "Tier C, 1 attr in 1 ability: Rapier (6079 attr 0), no binding. Constructor change (behaviour-neutral): the two properties are ctor arguments (defaults Horn based and Slicing move) instead of literals; the instance fields firstFlag and secondFlag are read back through `path`. Same family as the 'some of my moves also count as another kind' injection class of B09, which has one direction and a closed list of scopes; this class is the symmetric pair. REQUEST R-B15-1: WHEN `while.active` needs `RapierFlagInjectionAbAttr` in its `flagKeys` (L0 reports 'when while.active dispatches ..., none of which is the class or one of its ancestors' until then). Suspected oddity, NOT fixed: the free helper rapierInjectsFlag (hard-wired to the two defaults, never reads the attr) is a lookalike of `injects`; it injects for any user that reaches it and ignores changed params. No caller outside barbaracle-mechanics.ts uses it today.",
});

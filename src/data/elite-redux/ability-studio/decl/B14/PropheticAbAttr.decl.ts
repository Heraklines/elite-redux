/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B14. "When I enter, set a delayed attack on the first foe still standing."
//
// Clause by clause (the class has no canApply override, so the inherited `true` runs and everything is in `apply`):
//   effect-side  simulated: return (nothing is set up while the game only previews)
//   feasibility  the first foe that is not fainted (`getOpponents().find(!isFainted)`) must exist
//   feasibility  `positionalTagManager.canAddTag(DELAYED_ATTACK, thatFoe's slot)`: no delayed attack is already
//                waiting on that slot
//   effect       addTag({ DELAYED_ATTACK, sourceId: holder, targetIndex, sourceMove: FUTURE_SIGHT,
//                         sourceMoves: [FUTURE_SIGHT, DOOM_DESIRE], turnCount: 3 })
// When the tag triggers (src/data/positional-tags/positional-tag.ts DelayedAttackTag.trigger) it simulates both moves
// against the target and uses the one that would deal more damage. That choice is made there, not in this class.
//
// Nothing is random in the class. The ability flyout is shown by the engine around `apply`, so it appears even when
// there is no foe or a delayed attack is already waiting (recorded in notes, not changed).
//
// KIND: package, because the effect library has no "delayed attack" effect (`effect.delayed-attack` is requested in
// requests/B14.md). The trigger (on entry) is already a separate block, and the class has no IF.
import { PropheticAbAttr } from "#data/elite-redux/abilities/fakemon-pitch-mechanics";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";

export default defineDecl(PropheticAbAttr, {
  tier: "C",
  kind: "package",
  when: "event.on-entry",
  label: "Set up a delayed attack on a foe when I enter",
  summary: () =>
    "When I enter, I set a delayed attack on the first foe still standing. It hits 3 turns later with Future Sight or Doom Desire, whichever would hurt more.",
  synonyms: [
    "future sight",
    "doom desire",
    "delayed attack",
    "delayed damage",
    "time bomb",
    "attack later",
    "prophecy",
  ],
  examples: ["When I enter, a Future Sight style attack lands on the foe three turns later"],
  params: [],
  noParamsReason:
    "The class takes no constructor argument: the two moves to choose from (Future Sight and Doom Desire) and the 3-turn delay are fixed inside it, so there is no value to tune until it is given parameters (requested in requests/B14.md).",
  conditions: [],
  guards: [],
  feasibility: [
    "There must be a foe still standing",
    "No delayed attack may already be waiting on that foe's position",
    "Nothing is set up while the game is only previewing",
  ],
  effect: { id: "effect.package", params: [] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "none", simulated: "respects" },
  probes: [{ name: "enter the field", axes: {} }],
  status: "decomposed",
  notes:
    "Package, reason: no delayed-attack effect in the library (requested); the class itself is one call to positionalTagManager.addTag with fixed arguments (sourceMoves [Future Sight, Doom Desire], turnCount 3), so it should be re-declared as an event-effect with params {moves, turns} when the effect exists. Users (1): Prophetic (6014) attr 0 (its only attr). Oddities, not fixed: canApply is the inherited true, so the ability flyout can show when no delayed attack is set (no foe, or a delayed attack already waiting on that slot); the tag is aimed at the first living foe only, never at both foes in a double battle.",
});

/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B17 chunk 3 / Split Mind. Read by hand: fakemon-pitch-mechanics.ts `PostSummonScreensAbAttr`, its base PostSummonAbAttr
// (ab-attrs.ts: canApply always true, constructor (showAbility = true, activateOnGain = true)), the dispatch
// `applyAbAttrs("PostSummonAbAttr", ...)` in post-summon-activate-ability-phase.ts and `Arena.addTag` (field/arena.ts:1173).
//
// canApply: the inherited `true` (no guard, no condition, no feasibility, no residual, no closure).
// apply, unless simulated: `side = holder.isPlayer() ? PLAYER : ENEMY`; `arena.addTag(REFLECT, turns, MoveId.REFLECT, holder.id, side)` then
// `arena.addTag(LIGHT_SCREEN, turns, MoveId.LIGHT_SCREEN, holder.id, side)`. No random draw. `addTag` returns false and adds nothing for
// a screen that is already up on that side (it only calls onOverlap), so an existing screen is not refreshed.
import { PostSummonScreensAbAttr } from "#data/elite-redux/abilities/fakemon-pitch-mechanics";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";

export default defineDecl(PostSummonScreensAbAttr, {
  tier: "A",
  kind: "event-effect",
  when: "event.on-entry",
  label: "Raise Reflect and Light Screen on my side when I enter",
  summary: params =>
    `When I enter the battle, my side gets both Reflect and Light Screen for ${params.turns} turns. A screen that is already up is not renewed. Example: 3 turns.`,
  synonyms: [
    "split mind",
    "set up screens",
    "reflect and light screen",
    "defensive screens on entry",
    "barrier on switch in",
    "team barrier",
  ],
  examples: ["Set up Reflect and Light Screen for 3 turns when I come in", "Both screens on entry for 5 turns"],
  params: [
    {
      id: "turns",
      ctorIndex: 0,
      path: "turns",
      control: "number",
      label: "How many turns both screens last",
      editable: true,
      default: 3,
      min: 1,
      max: 8,
      step: 1,
      integer: true,
    },
  ],
  conditions: [],
  guards: [],
  feasibility: [
    "A screen that is already active on my side is left as it is (it is not refreshed)",
    "It never sets anything for a preview (a simulated entry)",
  ],
  effect: { id: "effect.arena-tag", params: ["turns"] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "none", simulated: "respects" },
  probes: [{ name: "entry with the default field", axes: {} }],
  status: "decomposed",
  notes:
    "Tier A, no package: the effect is 'set a field effect on my side', which is the library's effect.arena-tag (not implemented yet, request R36). The class sets TWO field effects (Reflect then Light Screen, in that order) in one attr, and the declaration cannot split them without changing the attr count, so the effect lists the shared duration `turns` as its only setting and the pair is fixed; R36 asks the librarian for a `turns` option and for a list of field effects. The old literal 3 is now the constructor argument `turns` (default 3, same behaviour). There is nothing to bind: no closure, no gate. The source of both field effects is the move (Reflect, Light Screen) so their end-of-turn messages are the move's. Users: Split Mind (6045, attr 0) only. No game bug found. Oddity, not a bug: the attr does not check whether the screens are already up; it simply asks the field to add them.",
});

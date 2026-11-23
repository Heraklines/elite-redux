/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B11 chunk 1 / event-effect (Tier B: "I used a weather move" is the gate inside canApply).
//
// Read by hand from archetypes/post-weather-move-follow-up.ts and PostMoveUsedAbAttr in ab-attrs.ts. PostMoveUsed hook (WHEN
// "after anyone uses a move", dispatched at the end of MovePhase for every Pokemon on the field with `source` = the mover),
// constructor `(followUpMoveId)`, field `followUpMoveId`; `super()` (shows the ability banner).
//   canApply is now `gate && residual`, in the ORIGINAL clause order:
//     1. gate (a), CONDITION: `source.getBattlerIndex() === pokemon.getBattlerIndex()`   (the mover is the holder)
//     2. gate (b), CONDITION: `move.getMove().hasAttr("WeatherChangeAttr")`              (the move sets the weather)
//     3. residual, feasibility: `pokemon.getOpponents().some(o => !o.isFainted())`        (a living foe remains)
//   apply: not when simulated. The first living foe is the target (none: nothing happens); one MovePhase for the holder with
//     the follow-up move at full power, INDIRECT use mode and the timing modifier FIRST (it resolves right after the weather move).
//     No random draw.
//
// Both gate clauses are conditions staff would change ("after ANYONE's weather move", "after a sound move"). The library has
// atom side.is self for (a) but none for (b) "the move sets the weather" (request R-B11-C1-07), and one gate slot can only hold one
// binding, so the whole gate is a legacy closure for now: reusable as a whole, swappable by staff, counted as undecomposed. The
// moment the atom exists it is `all [side.is self, move.sets-weather]`. The effect is one piece: effect.scripted-move needs
// the foe as the `other` slot (here `other` is the mover, the holder itself), forces a power and refuses to start from an
// indirect move, while this follow-up keeps the move's own power and may follow any move (request R-B11-C1-08).
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";
import { PostWeatherMoveFollowUpAbAttr } from "#data/elite-redux/archetypes/post-weather-move-follow-up";
import { moveNameCodec } from "./b11-chunk1-codecs";

export default defineDecl(PostWeatherMoveFollowUpAbAttr, {
  tier: "B",
  kind: "event-effect",
  when: "event.after-any-move",
  label: "Follow up my weather move with an attack on a foe",
  summary: params =>
    `After I use a move that sets the weather, I use ${params.followUpMoveId} on the first living foe for free, right after it. Example: Weather Ball after Rain Dance.`,
  synonyms: [
    "forecast",
    "weather ball after weather",
    "follow up after rain dance",
    "weather combo",
    "free attack after weather",
  ],
  examples: ["Use Weather Ball for free right after I set the weather"],
  params: [
    {
      id: "followUpMoveId",
      ctorIndex: 0,
      path: "followUpMoveId",
      control: "text",
      label: "Move to use afterwards (type its name, for example Weather Ball)",
      editable: true,
      gateIndependent: true,
      default: "Weather ball",
      codec: moveNameCodec,
    },
  ],
  conditions: [
    // "I used a weather-setting move" (a legacy closure for now, see the header). Staff swap it for any condition.
    { slot: "gate", ctx: "params", removable: true, editable: true },
  ],
  guards: [],
  feasibility: [
    "A living foe must still be standing: the first living foe on the field is the target",
    "The follow-up is cast for free (no PP used, nothing added to the move history) and shows the ability banner",
    "Never in a preview",
  ],
  effect: { id: "effect.package", params: ["followUpMoveId"] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "none", simulated: "respects" },
  probes: [
    {
      name: "a foe move and two quiet turns at full HP and at half HP",
      axes: { hp: ["max", "50%"], foeMove: ["TACKLE", "WATER_GUN"] },
    },
  ],
  l2StaticReason:
    "The shipped gate is a legacy closure (the weather-move test has no library atom, request R-B11-C1-07), so the shared twin cannot rebuild it, and no L2 scenario lets the holder use a weather-setting move (its moves are Celebrate, Tackle, Swords Dance and Double Slap). test/tests/elite-redux/decomp/B11/chunk1.test.ts drives the original and the rebuild (with the gate handed in) with real weather moves, the foe's moves and a fainted foe.",
  status: "decomposed",
  notes:
    "Tier B, justified in the header. Only user: Forecast (59, attr 3), follow-up Weather Ball (added to the vanilla ability by the ER rebalance; per the class comment it reaches 100 power once the weather is up). The gate is bound as one legacy closure. Remark, NOT fixed: the mover test compares battler indexes, not the Pokemon itself, which is the same Pokemon while both are on the field.",
});

/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B07 chunk 3 / calc modifier, Tier A (constructor closure). See ../PRECEDENTS.md.
//
// "While the game decides whether I may jump the turn order (Quick Draw, Quick Claw), IF <rule about the move I chose>, say no".
// BattlerTag BypassSpeedTag.canAdd asks `applyAbAttrs("PreventBypassSpeedChanceAbAttr", { pokemon, bypass })` with `bypass` starting at
// true; the attr turns it false. Clauses, in the ORIGINAL order (ab-attrs.ts):
//   canApply  1. `turnCommand?.command === Command.FIGHT`   feasibility: I chose to use a move this turn (the command is read from the
//                                                           battle's turn commands, not passed in).
//             2. `this.condition(pokemon, move)`            the CONSTRUCTOR CLOSURE (ctor:0), the CONDITION. `move` is the move I chose,
//                                                           read from the same command (it may be undefined when no move is queued).
//   apply     `bypass.value = false`.
// No random draw, no state, `simulated` is never read. The only constructor argument is the closure; showAbility is `super(true)`.
//
// Honest limit: the closure has the signature `(pokemon, move) => boolean`, which fits no condition context of the library yet, and
// the WHEN `calc.speed-bypass` provides only the holder, not the chosen move. The one user is therefore bound as a legacy closure with
// its exact formula; requests R-B07-1 (a context for `(pokemon, move)`) and R-B07-12 (the WHEN must provide the move) fix both.
import { PreventBypassSpeedChanceAbAttr } from "#abilities/ab-attrs";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";

export default defineDecl(PreventBypassSpeedChanceAbAttr, {
  tier: "A",
  kind: "calc-modifier",
  when: "calc.speed-bypass",
  label: "Stop my chosen move from jumping the turn order",
  summary: () =>
    "While the game checks whether my move may go first in its priority bracket (Quick Claw, Quick Draw), a move that meets your rule is not allowed to. Example: status moves never jump the queue.",
  synonyms: [
    "no quick claw",
    "no quick draw",
    "cannot jump the turn order",
    "mycelium might",
    "block the speed bypass",
    "never move first by luck",
  ],
  examples: ["My status moves never get Quick Claw's turn order boost, like Mycelium Might"],
  params: [],
  noParamsReason:
    "The only constructor argument is the per-move closure, which is the condition slot (ctor:0), not a setting. showAbility is not an argument (`super(true)`).",
  conditions: [
    // `(pokemon, move) => boolean`: no library context takes this signature yet (R-B07-1), see the bindings.
    { slot: "ctor:0", ctx: "none", path: "condition", removable: false, editable: false },
  ],
  guards: [],
  feasibility: [
    "Only when I chose to use a move this turn (not a switch, an item or a run)",
    "Only changes anything when something would let me jump the turn order",
  ],
  // No library effect says "do not let it jump the turn order"; request R-B07-9 (effect.stop-turn-order-jump).
  effect: { id: "effect.package", params: [] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "none", simulated: "ignores" },
  probes: [{ name: "a status move and a damaging move chosen while Quick Claw would work", axes: {} }],
  l2StaticReason:
    "The only user is a legacy closure (no library form until R-B07-1), so the twin has nothing it can rebuild; the engine site (BypassSpeedTag.canAdd reading the chosen move from the turn commands) is driven directly in test/tests/elite-redux/decomp/B07/flag-sites-3.test.ts.",
  status: "decomposed",
  notes:
    "Tier A. User (live dump): Mycelium Might (298, attr 1), closure `(_pokemon, move) => move.category === STATUS` (category 2), showAbility true. Mycelium Might also carries ChangeMovePriorityInBracketAbAttr (attr 0) and MoveAbilityBypassAbAttr (attr 2, chunk 1). The dispatch key is an alias of the WHEN calc.speed-bypass (its alsoDispatchKeys), shared with BypassSpeedChanceAbAttr, which raises the chance and sits in another batch. ODDITY (not fixed): `condition(pokemon, move!)` is called with `move` undefined when the command is FIGHT but no move was recorded; the one closure would then throw on `move.category`.",
});

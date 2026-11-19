/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B01 chunk 2, Tier B calc-modifier (Queenly Majesty, Dazzling, Armor Tail and the ER weather versions).
//
// "While the game checks whether a move can hit me, IF the move's priority is above 0 for its user, it has no effect
// and nothing happens." The old `canApply` had four clauses, all pure (no draw, no side effect), in this ORIGINAL order:
//   1. `!cancelled.value`                   = guard (another ability already blocked the move; the usual cancel-check
//                                             pattern). The class's own `guards()`, never removable.
//   2. `move.getPriority(attacker) > 0`     = the GATE: the design rule ("priority moves"). `getPriority` asks the user's
//                                             abilities and the move's own attrs too (Prankster, Gale Wings, Triage
//                                             raise it), so a library atom must call it, not read the move's static
//                                             priority (R-B01-13).
//   3. `!move.isAllyTarget()`               = residual / feasibility: a move aimed at the attacker itself or its ally
//                                             (Helping Hand, a self-boost) is never blocked.
//   4. `attacker.isOpponent(pokemon)`       = residual / feasibility: only foes are blocked, not my own side.
// canApply is now `gatedCanApply`: guards (1), gate (2), residual (3, 4), same order, same short-circuiting.
// `apply` sets `cancelled.value = true`. `simulated` is never read.
//
// TWO dispatch sites, same attr: move-phase.ts:1106 (the real move, for every Pokemon on the defending side) and
// pokemon.ts:4214 (type-effectiveness previews, only when `simulated`, for the target's allies). In both the frame's
// holder is the Pokemon that owns the ability and `other` is the attacker.
//
// WHY THE GATE IS A LEGACY CLOSURE FOR ALL 15 USERS: the library has no atom that calls `move.getPriority(user)`; the
// atom move.priority reads the move's static `priority` field and would be wrong for Prankster and friends. Request
// R-B01-13 (`move.effective-priority`). Once it exists every binding is the same one-atom tree.
import { FieldPriorityMoveImmunityAbAttr } from "#abilities/ab-attrs";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";

export default defineDecl(FieldPriorityMoveImmunityAbAttr, {
  tier: "B",
  kind: "calc-modifier",
  when: "calc.move-immunity",
  label: "Block priority moves used against my side",
  summary: () =>
    "A foe's move that goes first (priority above 0) does nothing against this Pokemon or its ally. Example: Quick Attack fails. Moves aimed at the foe's own side still work.",
  synonyms: [
    "queenly majesty",
    "dazzling",
    "armor tail",
    "block priority",
    "block quick attack",
    "no priority moves",
    "priority immunity",
  ],
  examples: ["Foes cannot use priority moves against my side, like Queenly Majesty"],
  params: [],
  noParamsReason:
    "The class has no constructor argument: the rule 'priority above 0' is the gate, a condition staff swap, and the foe-only and own-side exceptions are fixed safety rules.",
  conditions: [
    // The gate: clause 2 of the old canApply. Every user's binding is a legacy-closure for now (see the header).
    { slot: "gate", ctx: "params", removable: true, editable: true },
  ],
  guards: [],
  feasibility: [
    "Does nothing when another ability already blocked the move",
    "Never blocks a move aimed at the attacker itself or its own ally (Helping Hand, a self-boost)",
    "Only blocks moves from foes, never from my own side",
  ],
  effect: { id: "effect.negate", params: [] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "none", simulated: "ignores" },
  probes: [
    {
      name: "a priority move, a normal move and a priority status move",
      axes: { foeMove: ["QUICK_ATTACK", "TACKLE", "PROTECT"] },
    },
  ],
  status: "decomposed",
  notes:
    "Users (15 attrs): Queenly Majesty (214), Dazzling (219), Armor Tail (296), Royal Decree (5558), Empress (5625), Lucha Libre (5686), Moonarch (6074), Duplicity (20010 attr 1) and Radiant Jewel (20019 attr 2) carry no extra rule. Jungle's Guard (5194 attr 4: only on Grassy Terrain), Sand Guard (5213 attr 1), Sun Basking (5293 attr 1), Sepia Lens (5506 attr 2) and Sand Fiend (5601 attr 3) (a weather helper with a Reap and Sow exception) and Rain Shroud (5660 attr 1: Rain or Heavy rain, weather not suppressed) carry an ATTR-LEVEL condition set with addCondition. That is not a constructor argument and is copied onto a rebuilt attr as it is (build-attr.ts recomposeAttr); mapping those rules to library atoms needs a binding slot for attr-level conditions (request R-B01-16). All 15 gates are legacy-closures pending R-B01-13, so the attr cannot be rebuilt and the shared L2 twin skips them. The Tier B split is a pure move of code, proven by test/tests/elite-redux/decomp/B01/immunity-gates.test.ts against the old formula. Oddity (not fixed): the class never reads `simulated`, so the preview site (pokemon.ts:4214) sets the shared `cancelled` holder in a simulated call exactly like the real move-phase site does.",
});

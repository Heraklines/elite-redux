/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";
import { enumListCodec } from "#data/elite-redux/ability-studio/param-codecs";
// B09 chunk 2. "Until my first-move bonus is spent, moves with a chosen property get +1 priority" (Cutthroat, Edgelord,
// Coil Up, Quick Charge ...).
//
// Source: src/data/elite-redux/archetypes/first-move-priority.ts, class FirstFlaggedMovePriorityAbAttr (extends
// ChangeMovePriorityAbAttr). Dispatched from Move.getPriority (src/data/moves/move.ts, `applyAbAttrs("ChangeMovePriorityAbAttr")`
// for the USER of the move).
// Clauses of the original canApply, in order:
//   1. `!hasUsedPriority(pokemon)`                 the one-shot memory (tempSummonData[USED_FLAG], set by the sister
//                                                  classes, cleared on switch-out with the rest of tempSummonData)  -> guards()
//   2. `flags.some(flag => move.hasFlag(flag))`    the move carries one of the printed flags (move.hasFlag, NOT
//                                                  doesFlagEffectApply)                                              -> gate (IF)
// apply: `priority.value += 1`. The constructor passes `() => false` and 0 to the parent, so the parent's own rule and
// amount are dead; the +1 is hard-coded here. No random draw, nothing reads `simulated`.
// Constructor: (flag | flags[]). Quick Charge (arrow or reckless moves) and Flicker Jab (horn or punching moves) pass two.
// Tier B: guards = clause 1, gate = clause 2, no prepare, no residual.
//
// Why the gate stays a legacy-closure for all 9 users: the library atom move.flag calls doesFlagEffectApply, which also
// counts flags that OTHER abilities inject (Rapier turns slicing into horn and horn into slicing, Taekkyeon adds dance, ...).
// The class reads the printed flag with hasFlag. The two differ in real battles, so the atom would change behaviour. Request
// R-B09-01 asks the librarian for an atom that calls move.hasFlag. The memory (clause 1) has no atom either (R-B09-03).
import { FirstFlaggedMovePriorityAbAttr } from "#data/elite-redux/archetypes/first-move-priority";
import { MoveFlags } from "#enums/move-flags";

export default defineDecl(FirstFlaggedMovePriorityAbAttr, {
  tier: "B",
  kind: "calc-modifier",
  when: "calc.priority",
  label: "Give +1 priority to my first move of one kind",
  summary: params =>
    `Until my first-move bonus is spent, my moves of the kind "${params.flags}" get +1 priority and go before normal moves. Other blocks spend and restore the bonus.`,
  synonyms: [
    "first bite goes first",
    "first slash goes first",
    "cutthroat",
    "edgelord",
    "coil up",
    "quick charge",
    "one time priority",
    "priority on entry",
    "go first once",
    "act before the foe",
  ],
  examples: [
    "My first slicing move after I enter gets +1 priority, like Cutthroat",
    "My first biting move goes first, like Sidewinder",
  ],
  params: [
    {
      id: "flags",
      ctorIndex: 0,
      path: "flags",
      control: "text",
      label: "Kinds of move that get the bonus (comma separated, any of them counts)",
      // Decides the SHAPE of the gate (one atom per property): staff replace the whole gate instead. It becomes
      // editable together with request R-B09-01.
      editable: false,
      default: "SLICING_MOVE",
      codec: enumListCodec(MoveFlags, "move property"),
    },
  ],
  conditions: [
    // The gate: "the move carries the printed property". Each user's binding names its own list (bindings.ts).
    { slot: "gate", ctx: "params", removable: true, editable: true },
  ],
  guards: [],
  feasibility: [
    "The bonus must not be spent yet (it is spent by a move of the chosen kind, and some abilities give it back); it resets when I switch out",
  ],
  effect: { id: "effect.change-priority", params: [] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "entry", simulated: "ignores" },
  probes: [
    {
      name: "my attack against a foe that uses a status, a physical and a special move",
      axes: { foeMove: ["TACKLE", "WATER_GUN"] },
    },
  ],
  status: "decomposed",
  notes:
    "Tier B. 9 users: Coil Up (5040 attr 0), Sidewinder (5380 attr 0), Cutthroat (5444 attr 0), Edgelord (5583 attr 0), Curlipede (5687 attr 1), First Serpent (5933 attr 0), Head First (6033 attr 0), Quick Charge (6092 attr 0, two flags), Flicker Jab (6093 attr 0, two flags). All 9 gates are legacy-closure pending request R-B09-01 (an atom that calls move.hasFlag; the existing move.flag atom sees injected flags, which would change behaviour with Rapier or Taekkyeon in play). The +1 is hard-coded in apply (the parent's changeAmount is 0 and never used), so the effect has no amount setting. The memory lives in tempSummonData under a module-private Symbol; the sister classes ConsumeFirstFlaggedMovePriorityAbAttr, ConsumeFirstFlaggedMoveOnUseAbAttr and RearmFirstFlaggedMoveOnMoveAbAttr write it. The rebuild shares it because it reads the same Symbol. Parent ChangeMovePriorityAbAttr (B05) will get its own gate/gateOverride members; at merge this class's gateOverride and gate need the `override` keyword.",
});

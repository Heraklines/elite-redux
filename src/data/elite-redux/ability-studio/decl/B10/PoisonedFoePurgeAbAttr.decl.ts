/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B10 / event-effect (Tier B).
//
// Read by hand from archetypes/poisoned-foe-purge.ts. The class extends PostAttackAbAttr (WHEN "after my attack lands"), no
// constructor of its own, `super()` defaults (showAbility true, the parent's damaging-move condition, which this class never
// consults). canApply is now just the gate:
//
//   gate     the target's status is POISON or TOXIC            (params.opponent?.status?.effect)
//   (no guards, no prepare, no residual, no random draw)
//   apply    simulated or no target -> nothing; else for every battle stat with a positive stage set the stage to 0, then add the
//            HEAL_BLOCK tag unless the target already has it
//
// Clause classification: "the target is poisoned" is a rule staff would change (burned foes, any status), so it is the gate and
// the binding spells it with two library atoms. What happens is one piece in apply (clear boosts, block healing); the library has
// neither "remove a target's stat boosts" nor a way to run it only when a tag is missing, so the effect stays the class's apply
// (request R-B10-24, effect 'Remove all stat boosts of a Pokemon').
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";
import { PoisonedFoePurgeAbAttr } from "#data/elite-redux/archetypes/poisoned-foe-purge";

export default defineDecl(PoisonedFoePurgeAbAttr, {
  tier: "B",
  kind: "event-effect",
  when: "event.after-my-hit",
  label: "Strip a poisoned target's stat boosts and block its healing",
  summary: () =>
    "After my attack, a poisoned target loses all its raised stats and cannot heal. The block is refreshed on every attack while it stays poisoned.",
  synonyms: [
    "hemolysis",
    "remove stat boosts from poisoned foes",
    "no healing for poisoned foes",
    "heal block",
    "poison cleanse of buffs",
    "punish poisoned targets",
  ],
  examples: ["Poisoned foes lose all stat boosts and cannot heal, like Hemolysis"],
  params: [],
  noParamsReason:
    "The class has no constructor arguments: the situation (poisoned) is the replaceable IF and the effect is fixed (remove all raised stats, block healing).",
  conditions: [
    // The gate: the target has regular or bad poison (bindings.ts, two library atoms).
    { slot: "gate", ctx: "params", removable: true, editable: true },
  ],
  guards: [],
  feasibility: [
    "There must be a target, and nothing happens in a preview",
    "Only raised stats (above zero) are reset; lowered stats stay as they are",
    "The healing block is added only if the target does not already have it",
  ],
  effect: { id: "effect.package", params: [] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "none", simulated: "respects" },
  probes: [{ name: "I hit a foe that is poisoned, badly poisoned or healthy", axes: {} }],
  status: "decomposed",
  notes:
    "Tier B split by hand: the whole old canApply is the gate (no guards, no residual). Only user: Hemolysis (attr 0), gate bound as ANY of status.has other POISON, status.has other TOXIC. The effect is a package (see the header) with no settings: the class has no constructor argument. Oddities, NOT fixed: the class's canApply never calls the parent's damaging-move test (the parent's own condition field is unused), so the purge does not check that the move is damaging; the apply clears stages with setStatStage directly (no stat-change message, no Clear Body or Mirror Armor check) and adds HEAL_BLOCK with addTag with default turns; the shared L1 grid has no 'target poisoned' state, so the B10 test (test/tests/elite-redux/decomp/B10/chunk2-gates.test.ts) compares the original gate, the refactored gate and the library gate for every target status.",
});

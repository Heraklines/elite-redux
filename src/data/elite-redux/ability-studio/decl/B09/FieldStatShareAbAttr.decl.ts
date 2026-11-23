/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";
// B09 chunk 1. "When one of my stats changes, every other battler gets the same change" (Sharing Is Caring).
//
// Source: src/data/elite-redux/archetypes/field-stat-share.ts, class FieldStatShareAbAttr (extends PostStatStageChangeAbAttr,
// constructor `super(true)`, no arguments). Dispatched by StatStageChangePhase (stat-stage-change-phase.ts:357) for the Pokemon
// whose stat just changed, i.e. the HOLDER's own change only (not an ally's: that is the separate PostAllyStatStageChangeAbAttr).
// Clauses of the original canApply, in order (`last !== turn && params.stages !== 0`):
//   1. `(pokemon[SHARED_TURN_FLAG] ?? -1) !== currentBattle.turn`   the reentrancy memory: this Pokemon has not shared or received
//                                                                  a change this turn (stops the copies from being copied again) -> guards()
//   2. `params.stages !== 0`                                       the stat really changed                                     -> gate (IF)
// apply: `simulated` -> nothing; stamps the holder and every other standing battler with the turn, then for each other
// non-fainted battler on the field `unshiftNew("StatStageChangePhase", other, selfTarget, stats, stages)`, the SAME stats, stages and
// selfTarget as the trigger. No random draw. showAbility is `super(true)`.
// Tier B: guards = clause 1, gate = clause 2, no prepare, no residual.
//
// The effect is a PACKAGE: "give every other battler the change that just happened" copies a value that comes from the trigger
// (the stat list and the stages) and stamps the reentrancy memory on everybody in the same step. `effect.stat-stage` raises a
// FIXED stat by a FIXED amount on one target, so it cannot repeat whatever changed. The trigger (when one of my stats changes)
// and the gate (the stat really changed) are separate, swappable blocks. Request R-B09-22 asks for the copy-the-change effect and
// R-B09-25 for a guard that names the reentrancy memory.
import { FieldStatShareAbAttr } from "#data/elite-redux/archetypes/field-stat-share";

export default defineDecl(FieldStatShareAbAttr, {
  tier: "B",
  kind: "package",
  when: "event.stat-changed",
  label: "Give every other battler the same stat change I just got",
  summary: () =>
    "When one of my stats goes up or down, every other Pokemon on the field gets the same change. Example: my Attack rises by 2, so does everyone else's.",
  synonyms: [
    "sharing is caring",
    "share stat changes",
    "copy stat boosts",
    "everyone gets the boost",
    "stat sharing",
    "mirror my stat drops",
  ],
  examples: ["Everyone on the field gets the same stat change when mine changes, like Sharing Is Caring"],
  params: [],
  noParamsReason:
    "The class has no constructor arguments: it repeats whatever stat change just happened, so there is no number, stat or status to choose.",
  conditions: [
    // The gate: "the stat really changed" (stages !== 0). The binding is library atom stage.just-changed (any direction).
    { slot: "gate", ctx: "params", lib: "stage.just-changed", removable: true, editable: true },
  ],
  guards: [],
  feasibility: [
    "Does nothing if I already shared or received a change this turn (so the copies are not copied again), kept in the class as a safety rule",
    "Only Pokemon that are on the field and have not fainted receive the change",
    "Does nothing in a simulated preview",
  ],
  effect: { id: "effect.package", params: [] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "battle", simulated: "respects" },
  probes: [{ name: "my stat changes while I am at full HP and one HP below", axes: { hp: ["max", "max-1"] } }],
  status: "decomposed",
  notes:
    "Package with a Tier B gate, 1 attr: Sharing Is Caring (5290 attr 0). Justification for the package: the effect repeats the trigger's own stat list and stages on every other battler and writes the per-turn reentrancy memory (a Symbol on each Pokemon) in the same step; effect.stat-stage cannot repeat a variable change. The memory is the `guards()` clause (module-private Symbol FieldStatShare.lastTurn on the Pokemon object, compared with currentBattle.turn); it has no library atom or guard yet (R-B09-25), so it stays in the class and is listed as feasibility. The gate `stages !== 0` is stage.just-changed with direction any (same test). Oddities, not fixed: (a) the hook only fires for the holder's own changes, so a stat change on another battler is NOT shared unless that battler also has the ability, although the ability text says 'between all battlers'; (b) the copied phases reuse the original `selfTarget` flag, so a copy of a self-inflicted change is also marked self-inflicted for the receivers; (c) the memory is stamped on the Pokemon object and never cleared, which is harmless because it is compared with the turn number.",
});

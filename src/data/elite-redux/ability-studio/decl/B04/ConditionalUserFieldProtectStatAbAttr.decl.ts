/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B04 chunk 3 / Tier A calc-modifier, NO setting and ONE constructor closure that does not map yet (Flower Veil, Jungle's
// Guard).
//
// Dispatch: stat-stage-change-phase.ts:198 and :202, inside the OTHER-source drop branch (`!ignoreAbilities && !cancelled &&
// !selfTarget && stages < 0`, after Mist): the phase asks `applyAbAttrs("ConditionalUserFieldProtectStatAbAttr", { pokemon,
// stat, cancelled, simulated, target: pokemon, stages })` for the dropped Pokemon ITSELF and once more with `pokemon: ally`.
// So the protected Pokemon is `target`, and the holder is either that Pokemon or its partner: the holder protects itself AND
// its partner (a different rule from the status and battle-effect blocks, which protect only the partner).
//
// Constructor `(condition, _protectedStat?)`. Clause classification, in the ORIGINAL order of
// `canApply = target && !cancelled.value && (protectedStat == null || stat === protectedStat) && condition(target)`:
//   1. `if (!target) return false`   -> feasibility (a drop with no target Pokemon cannot be checked).
//   2. `!cancelled.value`            the cancel-chain convention; not a staff rule.
//   3. `protectedStat == null || stat === protectedStat`   DEAD clause: the constructor accepts a stat as its second argument
//                                    but never stores it (`_protectedStat` is unused), so `protectedStat` is always undefined and
//                                    every stat is always protected. Hence NO setting is declared (suspected game bug, notes).
//   4. `condition(target)`           constructor closure ctor:0. Both users pass `target.isOfType(GRASS, true, true)` (third
//                                    argument returnOriginalTypesIfStellar = true). No library atom is the same predicate
//                                    (`mon.has-type` uses the default third argument false), requested in requests/B04.md, so the
//                                    closure is a legacy closure for now (bindings.ts).
//   apply     `cancelled.value = true` -> the EFFECT (library "Block it"). It never reads `simulated`.
// No RNG. No trigger message override.
import { ConditionalUserFieldProtectStatAbAttr } from "#abilities/ab-attrs";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";

export default defineDecl(ConditionalUserFieldProtectStatAbAttr, {
  tier: "A",
  kind: "calc-modifier",
  when: "cancel.stat-protect-field",
  label: "Protect me and a qualifying partner from stat drops",
  summary: () =>
    "Other Pokemon cannot lower any stat of me or of my partner while that Pokemon passes the check (Flower Veil: it is a Grass type). Drops from its own moves still land.",
  synonyms: [
    "flower veil",
    "jungle's guard",
    "protect grass partner from stat drops",
    "team stat protection",
    "ally stat drop immunity",
    "side stat protection",
    "block intimidate for allies",
  ],
  examples: ["Grass-type Pokemon on my side cannot have their stats lowered by foes, like Flower Veil"],
  params: [],
  noParamsReason:
    "The constructor takes a stat as its second argument but never stores it (the parameter is unused), so every stat is always protected and there is no setting to expose. The only input is the check on the protected Pokemon, a function that staff cannot type; it is bound as a legacy closure until the type atom in requests/B04.md exists.",
  conditions: [
    {
      slot: "ctor:0",
      ctx: "none",
      path: "condition",
      removable: false,
      editable: false,
    },
  ],
  guards: [],
  feasibility: [
    "Only stat drops that other Pokemon or field effects cause are checked (a drop from my own move is not)",
    "A drop that another ability or effect already blocked is left alone",
    "Every stat is protected; the block cannot be limited to one stat",
  ],
  effect: { id: "effect.negate", params: [] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "none", simulated: "respects" },
  l2StaticReason:
    "Both users keep a legacy closure, so the shared twin has nothing to rebuild for them. b04-chunk3.test.ts rebuilds the attr with the original closure and drives every stat, stage amount, cancelled yes/no and target type against the original.",
  probes: [
    {
      name: "a foe lowers my Attack (Growl)",
      axes: { foeMove: ["GROWL"] },
    },
  ],
  status: "decomposed",
  notes:
    "legacy-closure-pending-request. Users (live dump): Flower Veil (id 166, attr 2) and Jungle's Guard (id 5194, attr 2, archetype-dispatcher.ts case 463): no stat argument, the same Grass closure. Suspected game bug, NOT fixed: the constructor's `_protectedStat` is never assigned, so the `protectedStat` field and the clause that reads it are dead code and a caller that passes a stat would believe it limited the block. Unlike ProtectStatAbAttr this class is asked for the dropped Pokemon itself AND its ally, so the Pokemon with Flower Veil is covered too. Sticky Web (arena-tag.ts) does not ask this class (only ProtectStatAbAttr).",
});

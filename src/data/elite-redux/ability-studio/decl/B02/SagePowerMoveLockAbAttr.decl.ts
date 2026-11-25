/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B02 chunk 4. "When my move starts, lock me into the first move I use" (Sage Power, without Gorilla Tactics' Attack boost).
//
// Source: src/data/abilities/ab-attrs.ts SagePowerMoveLockAbAttr, an ExecutedMoveAbAttr, dispatched like GorillaTacticsAbAttr
// (MoveEffectPhase.postAnimCallback, move-effect-phase.ts:455).
// canApply: `!pokemon.getTag(BattlerTagType.ER_SAGE_POWER_LOCK)`: the stacking rule, kept in the class as feasibility (Tier C).
// apply: `if (!simulated) pokemon.addTag(ER_SAGE_POWER_LOCK)`. SagePowerLockTag (battler-tags.ts:666) is Gorilla Tactics' tag
// without the x1.5 Attack write: `canAdd` needs a last non-virtual move that is not Struggle, `onAdd` remembers it as the
// only usable move.
import { SagePowerMoveLockAbAttr } from "#abilities/ab-attrs";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";

export default defineDecl(SagePowerMoveLockAbAttr, {
  tier: "C",
  kind: "event-effect",
  when: "event.my-move-starts",
  label: "Lock me into the first move I use",
  summary: () =>
    "After the first move I use, I can only use that move while I stay in. My stats do not change. Example: the Choice lock without the item and without a boost.",
  synonyms: [
    "sage power",
    "choice lock",
    "locked into a move",
    "move lock",
    "only use one move",
    "choice scarf lock",
    "stuck with one move",
  ],
  examples: ["Be locked into the first move I use, like Sage Power"],
  params: [],
  noParamsReason:
    "The class takes only the ability-flash flag (never exposed, always false). The locking battle effect is fixed by the class, not by a constructor argument.",
  fixedCtorArgs: { 0: false },
  conditions: [],
  guards: [],
  feasibility: [
    "I am not already locked into a move",
    "I have already used a real move (not Struggle) that I can be locked into",
  ],
  effect: { id: "effect.apply-tag", params: [] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "none", simulated: "ignores" },
  probes: [{ name: "first move and second move", axes: { foeMove: ["TACKLE", "WATER_GUN"] } }],
  status: "decomposed",
  notes:
    "Tier C. One user: Sage Power (5090, attr 1; attr 0 is its +50% Sp. Atk StatMultiplierAbAttr, declared separately). The effect is the library's 'apply a battle effect' block aimed at myself with the fixed battle effect ER_SAGE_POWER_LOCK; no constructor argument carries it. It is the same rule as the sibling lock class, with another tag and without the Attack boost, so the two cannot share one block with a setting (the tag is not a constructor argument). `canApply` ignores `simulated` (copied from the sibling); `apply` skips the tag when simulated. The ER_SAGE_POWER_LOCK tag is declared in battler-tags.ts as a copy of GorillaTacticsTag, so any fix of one has to be mirrored in the other.",
});

/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// Instance bindings of batch B11 (spec 2.1). Chunk 3 of 5: ReflectDamageOnDefendAbAttr, RemoveScreensOnTypedAttackAbAttr,
// RepeatMovePowerBoostAbAttr, SandStatusImmunityAbAttr, SandSecondaryEffectImmunityAbAttr, SePriorityBonusAbAttr,
// SelfDamageOnAttackAbAttr and SelfHighestStatBoostOnSummonAbAttr.
//
// There is nothing to bind for these eight classes, and that was checked class by class, not assumed:
//  - none of them takes a closure as a constructor argument. RepeatMovePowerBoostAbAttr, SandStatusImmunityAbAttr and
//    SePriorityBonusAbAttr build the parent's closure INSIDE their own constructor (the flag test, the sandstorm test, the
//    super effective test), so it is not a `ctor:N` slot; the other five have no closure at all;
//  - none has a gate inside canApply that the library replaces (all eight are Tier C);
//  - the only attr-level closure is Qigong's `addCondition(holder => holder.isOfType(FIGHTING))` on its
//    RemoveScreensOnTypedAttackAbAttr; `recomposeAttr` copies it onto the rebuild, so it is not a constructor slot.
// Other chunks of B11 add their bindings below this comment.
export {};

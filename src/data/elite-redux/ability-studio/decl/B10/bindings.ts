/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// Instance bindings of batch B10 (spec 2.1). Chunk 1 of 5: NullifyFirstNHitsAbAttr, IgnoreResistancesAbAttr,
// OffensiveTypeChartOverrideAbAttr, OnCritStatBoostLowestAbAttr, OnFaintEffectAbAttr, OnOpponentStatRaiseAbAttr,
// OnOpponentStatRaiseScriptedMoveAbAttr and OnOpponentSwitchOutAbAttr.
//
// There is nothing to bind for these eight classes, and that was checked class by class, not assumed:
//  - none of them takes a constructor closure (NullifyFirstNHits hands the parent `() => true` itself, and its own two
//    arguments are a number and a test seam);
//  - none has a gate inside canApply that the library has to replace (Tier C: the whole rule is one piece);
//  - the only closure in any user is the attr-level holder condition that Draconize and Draconic Might add to an
//    OffensiveTypeChartOverrideAbAttr with `addCondition`; `recomposeAttr` copies it onto the rebuild, so it is not a
//    constructor slot.
// Later chunks of B10 add their bindings below this comment.
export {};

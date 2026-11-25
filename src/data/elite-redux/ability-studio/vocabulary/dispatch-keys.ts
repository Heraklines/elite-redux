/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// PURE vocabulary file: no game imports. Hand-written (spec Step 0).
//
// The dispatch-key worklist (scripts/decomp/dispatch-worklist.mjs) lists every key of the
// AbilityAttrs map plus every literal key passed to applyAbAttrs / applyFilteredAbAttrs. A key is
// accounted for when exactly one of these holds:
//   1. it is the dispatchKey / alsoDispatchKeys / flagKeys of a WHEN in WHEN_REGISTRY
//      (the WHEN assignment itself lives in when-registry.ts),
//   2. it appears in UNEXPOSED_DISPATCH_KEYS with a written reason,
//   3. it is a leaf class that the engine never dispatches under its own name and it is listed in
//      DISPATCHED_THROUGH under an ancestor key that is itself accounted for. The L0 test checks
//      that the ancestor really is in the class chain.

/** Keys that are not offered to staff, each with the reason. */
export const UNEXPOSED_DISPATCH_KEYS: Readonly<Record<string, string>> = {
  AiMovegenMoveStatsAbAttr:
    "Only consulted while the enemy AI generates movesets (move.ts getMovegen stats). It is not a battle moment staff can react to.",
  PostSummonRemoveEffectAbAttr:
    "Re-run by MoveEndPhase to undo entry-time ignore-ability effects (Mold Breaker style). An engine clean-up call, not a moment staff reason about.",
  FieldMovePowerBoostAbAttr:
    "Abstract base of the field power boosters. Its leaf classes either dispatch through calc.move-power or are queried with getAbilityAttrs, so the base itself is never dispatched.",
  PreAttackFieldMoveTypePowerBoostAbAttr:
    "Abstract base of the field type power boosters; only its subclasses are used.",
};

/**
 * Leaf classes the engine reaches only through an ancestor's dispatch key.
 * Shape: ancestor key -> descendant keys (all must be in the ancestor's class chain).
 */
export const DISPATCHED_THROUGH: Readonly<Record<string, readonly string[]>> = {
  PostSummonAbAttr: [
    "DownloadAbAttr",
    "ForewarnAbAttr",
    "FriskAbAttr",
    "PostSummonAddArenaTagAbAttr",
    "PostSummonAddBattlerTagAbAttr",
    "PostSummonAllyHealAbAttr",
    "PostSummonClearAllyStatStagesAbAttr",
    "PostSummonClearWeatherAbAttr",
    "PostSummonCopyAbilityAbAttr",
    "PostSummonCopyAllyStatsAbAttr",
    "PostSummonFogRestoreDisguiseAbAttr",
    "PostSummonFormChangeAbAttr",
    "PostSummonFormChangeByWeatherAbAttr",
    "PostSummonHealStatusAbAttr",
    "PostSummonMessageAbAttr",
    "PostSummonRemoveArenaTagAbAttr",
    "PostSummonRemoveBattlerTagAbAttr",
    "PostSummonStatStageChangeAbAttr",
    "PostSummonStatStageChangeOnArenaAbAttr",
    "PostSummonTerrainChangeAbAttr",
    "PostSummonTransformAbAttr",
    "PostSummonUnnamedMessageAbAttr",
    "PostSummonUserFieldRemoveStatusEffectAbAttr",
    "PostSummonWeatherChangeAbAttr",
    "PostSummonWeatherSuppressedFormChangeAbAttr",
  ],
  AiMovegenMoveStatsAbAttr: ["SummonTerrainAiMovegenMoveStatsAbAttr"],
  PostTurnAbAttr: [
    "CudChewRecordBerryAbAttr",
    "FetchBallAbAttr",
    "MoodyAbAttr",
    "PostTurnFormChangeAbAttr",
    "PostTurnHealAbAttr",
    "PostTurnHurtIfSleepingAbAttr",
    "PostTurnRandomBerryEffectAbAttr",
    "PostTurnResetStatusAbAttr",
    "PostTurnRestoreBerryAbAttr",
    "PostTurnStatusHealAbAttr",
    "SpeedBoostAbAttr",
  ],
  PostDefendAbAttr: [
    "EffectSporeAbAttr",
    "PostDefendAbilityGiveAbAttr",
    "PostDefendAbilitySwapAbAttr",
    "PostDefendApplyArenaTrapTagAbAttr",
    "PostDefendApplyBattlerTagAbAttr",
    "PostDefendContactApplyStatusEffectAbAttr",
    "PostDefendContactApplyTagChanceAbAttr",
    "PostDefendContactDamageAbAttr",
    "PostDefendHpGatedStatStageChangeAbAttr",
    "PostDefendIllusionBreakAbAttr",
    "PostDefendMoveDisableAbAttr",
    "PostDefendPartyStatusHealAbAttr",
    "PostDefendPerishSongAbAttr",
    "PostDefendStatStageChangeAbAttr",
    "PostDefendStealHeldItemAbAttr",
    "PostDefendTerrainChangeAbAttr",
    "PostDefendTypeChangeAbAttr",
    "PostDefendWeatherChangeAbAttr",
    "ReverseDrainAbAttr",
  ],
  PostAttackAbAttr: [
    "PostAttackAbilityGiveAbAttr",
    "PostAttackApplyBattlerTagAbAttr",
    "PostAttackApplyStatusEffectAbAttr",
    "PostAttackContactApplyStatusEffectAbAttr",
    "PostAttackRemoveTargetTypeAbAttr",
    "PostAttackStealHeldItemAbAttr",
  ],
  PostFaintAbAttr: [
    "PostFaintContactDamageAbAttr",
    "PostFaintFormChangeAbAttr",
    "PostFaintHPDamageAbAttr",
    "PostFaintUnsuppressedWeatherFormChangeAbAttr",
  ],
  PostKnockOutAbAttr: ["CopyFaintedAllyAbilityAbAttr", "PostKnockOutStatStageChangeAbAttr"],
  PostVictoryAbAttr: ["PostVictoryFormChangeAbAttr"],
  PostDamageAbAttr: ["PostDamageForceSwitchAbAttr"],
  PostMoveUsedAbAttr: ["PostDancingMoveAbAttr"],
  PostItemLostAbAttr: ["PostItemLostApplyBattlerTagAbAttr"],
  PostStatStageChangeAbAttr: ["PostStatStageChangeStatStageChangeAbAttr"],
  PostSetStatusAbAttr: ["SynchronizeStatusAbAttr"],
  PostBattleAbAttr: ["IllusionPostBattleAbAttr", "MoneyAbAttr", "PostBattleLootAbAttr"],
  PostBattleInitAbAttr: ["PostBattleInitFormChangeAbAttr"],
  PostBiomeChangeAbAttr: ["PostBiomeChangeTerrainChangeAbAttr", "PostBiomeChangeWeatherChangeAbAttr"],
  PostWeatherChangeAbAttr: [
    "FogRestoreDisguiseFormChangeAbAttr",
    "IceFaceFormChangeAbAttr",
    "PostWeatherChangeFormChangeAbAttr",
  ],
  PostWeatherLapseAbAttr: ["PostWeatherLapseDamageAbAttr", "PostWeatherLapseHealAbAttr"],
  PreSummonAbAttr: ["IllusionPreSummonAbAttr"],
  PreSwitchOutAbAttr: ["PreSwitchOutFormChangeAbAttr", "PreSwitchOutHealAbAttr", "PreSwitchOutResetStatusAbAttr"],
  PreLeaveFieldAbAttr: ["PreLeaveFieldClearWeatherAbAttr", "PreLeaveFieldRemoveSuppressAbilitiesSourceAbAttr"],
  FlinchEffectAbAttr: ["FlinchStatStageChangeAbAttr"],
  ExecutedMoveAbAttr: ["GorillaTacticsAbAttr", "SagePowerMoveLockAbAttr"],
  RedirectMoveAbAttr: ["RedirectTypeMoveAbAttr"],
  CheckTrappedAbAttr: ["ArenaTrapAbAttr"],
  ReceivedMoveDamageMultiplierAbAttr: ["FormBlockDamageAbAttr", "ReceivedTypeDamageMultiplierAbAttr"],
  TypeImmunityAbAttr: ["AttackTypeImmunityAbAttr", "NonSuperEffectiveImmunityAbAttr", "TypeImmunityHealAbAttr"],
  MoveImmunityAbAttr: ["MoveImmunityStatStageChangeAbAttr"],
  MovePowerBoostAbAttr: ["LowHpMoveTypePowerBoostAbAttr", "MoveTypePowerBoostAbAttr"],
  VariableMovePowerAbAttr: ["VariableMovePowerBoostAbAttr"],
  UserFieldBattlerTagImmunityAbAttr: ["ConditionalUserFieldBattlerTagImmunityAbAttr"],
  UserFieldStatusEffectImmunityAbAttr: ["ConditionalUserFieldStatusEffectImmunityAbAttr"],
  PreApplyBattlerTagAbAttr: ["PreApplyBattlerTagImmunityAbAttr"],
  PreSetStatusAbAttr: ["PreSetStatusEffectImmunityAbAttr"],
  CancelInteractionAbAttr: ["PreventItemUseAbAttr"],
};

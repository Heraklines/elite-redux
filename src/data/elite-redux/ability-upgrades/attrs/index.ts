/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// biome-ignore lint/performance/noBarrelFile: shared ability-upgrade primitive surface
export {
  type AbilityAttrFactory,
  appendAbilityAttrsOnce,
  replaceAbilityAttrsOnce,
  replaceMatchingAbilityAttrOnce,
} from "./ability-patch";
export { ProvenanceBypassSpeedChanceAbAttr } from "./bypass-speed-provenance";
export { FirstTurnDirectDamageMultiplierAbAttr } from "./first-turn-direct-damage";
export { canTriggerFollowUpMove } from "./follow-up-guard";
export {
  claimCommandAbilityProvenance,
  claimSummonAbilityProvenance,
  hasCommandAbilityProvenance,
  hasSummonAbilityProvenance,
  type InnateSlot,
  isAbilityIdSuppressed,
  isInnateSlotSuppressed,
  lapseTimedAbilitySuppressions,
  suppressAbilityIdForTurns,
  suppressInnateSlotUntilSwitch,
} from "./innate-slot-suppression";
export {
  BallRecoveryAbAttr,
  BiomeRevealBonusAbAttr,
  EncounterTypeWeightAbAttr,
  ExperienceGainMultiplierAbAttr,
  MoneyGainMultiplierAbAttr,
} from "./meta-markers";
export { getMoveHpCostFraction, MoveHpCostModifierAbAttr } from "./move-hp-cost";
export { hasMummyFamilyAbility, PostDefendSuppressFirstInnateAbAttr } from "./mummy-family";
export {
  IgnoreOptionalMoveEffectsAbAttr,
  UserFieldIgnoreOptionalMoveEffectsAbAttr,
} from "./optional-secondary-effect";
export {
  FirstEntryPartyHealAbAttr,
  type FirstEntryPartyHealOptions,
  HolderAndAlliesRecoveryAbAttr,
} from "./party-recovery";
export {
  AllyHigherStatMultiplierAbAttr,
  AttackerTypeDamageReductionAbAttr,
  BreakScreensOnAttackAbAttr,
  type BreakScreensOnAttackOptions,
  ChancePostAttackStealHeldItemAbAttr,
  type ChanceStealHeldItemOptions,
  FaintedAllyStatMultiplierAbAttr,
  FieldPoisonWeaknessOnEntryAbAttr,
  FullHpMoveTypeDamageReductionAbAttr,
  HigherStatMultiplierAbAttr,
  MoveFlagImmunityAbAttr,
  OnceLowHpStatRaiseAbAttr,
  OnDirectFaintRetaliationAbAttr,
  PostDefendAddTagAbAttr,
  PreLeaveFieldRemoveLinkedTailwindAbAttr,
  ReverseNegativeStatChangesAbAttr,
  SameTypeStabOtherwiseBoostAbAttr,
  TaggedStateStatRaiseAbAttr,
  TelekineticStruggleOnEntryAbAttr,
  TypeImmunityHigherDefenseStatRaiseAbAttr,
} from "./requested-combat-riders";
export {
  PostSummonSnowCloakAuroraVeilAbAttr,
  PreLeaveFieldRemoveSnowCloakAuroraVeilAbAttr,
} from "./snow-cloak-aurora-veil";
export {
  onSuccessfulStatDrop,
  type SuccessfulStatDropCallback,
  selectHigherDefenseStat,
  selectHigherOffenseStat,
} from "./stat-control";

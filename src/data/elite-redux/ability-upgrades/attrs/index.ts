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
} from "./ability-patch";
export { FirstTurnDirectDamageMultiplierAbAttr } from "./first-turn-direct-damage";
export {
  type InnateSlot,
  isInnateSlotSuppressed,
  suppressInnateSlotUntilSwitch,
} from "./innate-slot-suppression";
export {
  BallRecoveryAbAttr,
  BiomeRevealBonusAbAttr,
  EncounterTypeWeightAbAttr,
  ExperienceGainMultiplierAbAttr,
  MoneyGainMultiplierAbAttr,
} from "./meta-markers";
export {
  FirstEntryPartyHealAbAttr,
  type FirstEntryPartyHealOptions,
  HolderAndAlliesRecoveryAbAttr,
} from "./party-recovery";

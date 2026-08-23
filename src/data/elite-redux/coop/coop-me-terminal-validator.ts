/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// Cycle-free, engine-free admission contract shared by the legacy ME adapter and Authority V2 entry
// construction. Keeping one validator prevents the V2 log from retaining a terminal image the real
// destination executor would later reject.

import { isValidWaveProgressionPresentation } from "#data/elite-redux/coop/authority-v2/adapters/wave-terminal";
import {
  COOP_ME_REROLL_MULTIPLIER_MAX,
  COOP_ME_REWARD_SURFACE_ID_MAX_LENGTH,
  COOP_ME_REWARD_SURFACE_LIMIT,
  type CoopMarketProjectionKind,
  type CoopMeRewardSurfaceProjection,
  type CoopMeTerminalPayload,
  type CoopTrainerVictoryMaterial,
} from "#data/elite-redux/coop/coop-operation-envelope";
import type {
  CoopAuthoritativeBattleStateV1,
  CoopInteractionOutcome,
  CoopSerializedTrainer,
} from "#data/elite-redux/coop/coop-transport";
import { ER_ID_MAP } from "#data/elite-redux/er-id-map";
import { EggSourceType } from "#enums/egg-source-types";
import { MysteryEncounterMode } from "#enums/mystery-encounter-mode";
import { VariantTier } from "#enums/variant-tier";

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function isSafeNonNegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function isBoundedNonNegativeInteger(value: unknown, maximum: number): value is number {
  return isSafeNonNegativeInteger(value) && value <= maximum;
}

const COOP_ME_REWARD_SURFACE_ID_PATTERN = /^[a-z][a-z0-9]*(?:[._:-][a-z0-9]+)*$/;
const COOP_ME_EGG_DESCRIPTOR_MAX_LENGTH = 256;
const COOP_TRAINER_VICTORY_TEXT_MAX_LENGTH = 512;
const COOP_TRAINER_VICTORY_MESSAGE_LIMIT = 32;
const COOP_TRAINER_VICTORY_REWARD_LIMIT = 16;
const COOP_TRAINER_PRESENTATION_MESSAGE_LIMIT = 64;
const COOP_MODIFIER_TYPE_ID_PATTERN = /^[A-Z][A-Z0-9_]*$/;
const REGISTERED_EGG_SPECIES = new Set<number>(Object.values(ER_ID_MAP.species));
const VALID_EGG_SOURCE_TYPES = new Set<number>(
  Object.values(EggSourceType).filter((value): value is number => typeof value === "number"),
);
const VALID_VARIANT_TIERS = new Set<number>(
  Object.values(VariantTier).filter((value): value is number => typeof value === "number"),
);
const VALID_MARKET_PROJECTION_KINDS = new Set<CoopMarketProjectionKind>([
  "biome",
  "exotic",
  "black-market",
  "import-bazaar",
]);

function isCanonicalCoopMeRewardSurfaceId(value: unknown): value is string {
  return (
    typeof value === "string"
    && value.length <= COOP_ME_REWARD_SURFACE_ID_MAX_LENGTH
    && COOP_ME_REWARD_SURFACE_ID_PATTERN.test(value)
  );
}

function isExecutableCoopMeRerollMultiplier(value: unknown): value is number {
  return (
    typeof value === "number"
    && Number.isFinite(value)
    && (value === -1 || (value >= 0 && value <= COOP_ME_REROLL_MULTIPLIER_MAX))
  );
}

function isCompleteCoopMeEggRewardSurface(surface: Record<string, unknown>): boolean {
  return (
    isSafeNonNegativeInteger(surface.id)
    && isSafeNonNegativeInteger(surface.timestamp)
    && (surface.sourceType === null
      || (isSafeNonNegativeInteger(surface.sourceType) && VALID_EGG_SOURCE_TYPES.has(surface.sourceType)))
    && isBoundedNonNegativeInteger(surface.tier, 3)
    && isBoundedNonNegativeInteger(surface.hatchWaves, 1_000_000)
    && isSafeNonNegativeInteger(surface.species)
    && REGISTERED_EGG_SPECIES.has(surface.species)
    && typeof surface.isShiny === "boolean"
    && isSafeNonNegativeInteger(surface.variantTier)
    && VALID_VARIANT_TIERS.has(surface.variantTier)
    && isBoundedNonNegativeInteger(surface.eggMoveIndex, 3)
    && typeof surface.overrideHiddenAbility === "boolean"
    && (surface.eggDescriptor === null
      || (typeof surface.eggDescriptor === "string"
        && surface.eggDescriptor.length <= COOP_ME_EGG_DESCRIPTOR_MAX_LENGTH))
  );
}

function isCompleteCoopMeRewardSurface(surface: Record<string, unknown>): boolean {
  if (surface.kind === "modifier") {
    return isExecutableCoopMeRerollMultiplier(surface.rerollMultiplier);
  }
  if (surface.kind === "market") {
    return (
      typeof surface.marketKind === "string"
      && VALID_MARKET_PROJECTION_KINDS.has(surface.marketKind as CoopMarketProjectionKind)
    );
  }
  return surface.kind === "egg" && isCompleteCoopMeEggRewardSurface(surface);
}

function isCompleteCoopMeRewardSurfacePlan(value: unknown): value is CoopMeRewardSurfaceProjection[] {
  if (!Array.isArray(value) || value.length > COOP_ME_REWARD_SURFACE_LIMIT) {
    return false;
  }
  const surfaceIds = new Set<string>();
  for (const surface of value) {
    if (!isPlainObject(surface) || !isCanonicalCoopMeRewardSurfaceId(surface.surfaceId)) {
      return false;
    }
    if (!isCompleteCoopMeRewardSurface(surface) || surfaceIds.has(surface.surfaceId)) {
      return false;
    }
    surfaceIds.add(surface.surfaceId);
  }
  return true;
}

function isBoundedText(value: unknown): value is string {
  return typeof value === "string" && value.length <= COOP_TRAINER_VICTORY_TEXT_MAX_LENGTH;
}

function isOptionalBoundedText(value: unknown): value is string | undefined {
  return value === undefined || isBoundedText(value);
}

function isBoundedTextArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.length <= COOP_TRAINER_PRESENTATION_MESSAGE_LIMIT && value.every(isBoundedText);
}

function isCompleteCoopSerializedTrainer(value: unknown): value is CoopSerializedTrainer {
  if (!isPlainObject(value) || !isPlainObject(value.renderNames)) {
    return false;
  }
  const names = value.renderNames;
  return (
    isSafeNonNegativeInteger(value.trainerType)
    && isSafeNonNegativeInteger(value.variant)
    && isSafeNonNegativeInteger(value.partyTemplateIndex)
    && isOptionalBoundedText(value.nameKey)
    && isOptionalBoundedText(value.partnerNameKey)
    && isOptionalBoundedText(value.name)
    && isOptionalBoundedText(value.partnerName)
    && isBoundedText(value.nameWithTitle)
    && isBoundedText(names.none)
    && isBoundedText(names.noneWithTitle)
    && isBoundedText(names.trainer)
    && isBoundedText(names.trainerWithTitle)
    && isBoundedText(names.partner)
    && isBoundedText(names.partnerWithTitle)
    && isBoundedTextArray(value.encounterMessages)
    && (value.selectedEncounterMessage === null || isBoundedText(value.selectedEncounterMessage))
    && isBoundedTextArray(value.victoryMessages)
    && isBoundedTextArray(value.defeatMessages)
    && isOptionalBoundedText(value.erGhostApproach)
    && isOptionalBoundedText(value.erGhostAura)
    && (value.erGhostFxSpeed === undefined
      || (typeof value.erGhostFxSpeed === "number" && Number.isFinite(value.erGhostFxSpeed)))
    && (value.erGhostFxIntensity === undefined
      || (typeof value.erGhostFxIntensity === "number" && Number.isFinite(value.erGhostFxIntensity)))
  );
}

export function isCompleteCoopTrainerVictoryMaterial(value: unknown): value is CoopTrainerVictoryMaterial {
  if (!isPlainObject(value)) {
    return false;
  }
  return (
    isSafeNonNegativeInteger(value.sourceWave)
    && isSafeNonNegativeInteger(value.trainerType)
    && typeof value.moneyMultiplier === "number"
    && Number.isFinite(value.moneyMultiplier)
    && value.moneyMultiplier >= 0
    && Array.isArray(value.modifierRewardTypeIds)
    && value.modifierRewardTypeIds.length <= COOP_TRAINER_VICTORY_REWARD_LIMIT
    && value.modifierRewardTypeIds.every(
      id => typeof id === "string" && id.length <= 128 && COOP_MODIFIER_TYPE_ID_PATTERN.test(id),
    )
    && typeof value.isBoss === "boolean"
    && typeof value.hasCharSprite === "boolean"
    && (value.victoryBgm === null || isBoundedText(value.victoryBgm))
    && isBoundedText(value.trainerSpriteKey)
    && isBoundedText(value.trainerName)
    && isBoundedText(value.trainerDialogueName)
    && Array.isArray(value.victoryMessages)
    && value.victoryMessages.length <= COOP_TRAINER_VICTORY_MESSAGE_LIMIT
    && value.victoryMessages.every(isBoundedText)
    && isSafeNonNegativeInteger(value.biomeId)
    && typeof value.isErGhost === "boolean"
  );
}

/** Strict complete-state image shared by ME terminals and other outcome-blob interactions such as Bargain. */
export function isCompleteCoopMeResyncOutcome(value: unknown): value is Extract<
  CoopInteractionOutcome,
  { k: "meResync" }
> & {
  readonly authoritativeState: CoopAuthoritativeBattleStateV1;
} {
  if (
    !isPlainObject(value)
    || value.k !== "meResync"
    || (value.base !== null && !isPlainObject(value.base))
    || !Array.isArray(value.party)
    || !value.party.every(item => typeof item === "string")
    || typeof value.meSaveData !== "string"
    || typeof value.seed !== "string"
    || typeof value.waveSeed !== "string"
    || typeof value.dex !== "string"
    || !Array.isArray(value.progression)
    || value.progression.length > 128
    || !value.progression.every(isValidWaveProgressionPresentation)
    || !isPlainObject(value.authoritativeState)
  ) {
    return false;
  }
  const state = value.authoritativeState;
  return (
    state.version === 1
    && Number.isSafeInteger(state.tick)
    && (state.tick as number) > 0
    && isSafeNonNegativeInteger(state.wave)
    && isSafeNonNegativeInteger(state.turn)
    && Array.isArray(state.playerParty)
    && Array.isArray(state.enemyParty)
    && Array.isArray(state.field)
    && Array.isArray(state.arenaTags)
    && Array.isArray(state.pokeballCounts)
    && Array.isArray(state.playerModifiers)
    && Array.isArray(state.enemyModifiers)
  );
}

/** Validate the all-in-one ME terminal state and exact executable destination before any mutation/retention. */
export function isCompleteCoopMeTerminalPayload(value: unknown): value is CoopMeTerminalPayload {
  if (
    !isPlainObject(value)
    || (value.terminal !== "leave"
      && value.terminal !== "battle"
      && value.terminal !== "battle-settled"
      && value.terminal !== "reward-settled")
  ) {
    return false;
  }
  const outcome = value.outcome;
  const destination = value.destination;
  if (!isCompleteCoopMeResyncOutcome(outcome) || !isPlainObject(destination)) {
    return false;
  }
  if (value.terminal === "battle") {
    const trainerBattle = destination.encounterMode === MysteryEncounterMode.TRAINER_BATTLE;
    return (
      destination.kind === "battle"
      && (destination.boot === "encounter-phase" || destination.boot === "direct-turn")
      && isSafeNonNegativeInteger(destination.hostTurn)
      && isSafeNonNegativeInteger(destination.encounterMode)
      && (trainerBattle ? isCompleteCoopSerializedTrainer(destination.trainer) : destination.trainer === null)
      && typeof destination.disableSwitch === "boolean"
      && outcome.authoritativeState.enemyParty.length > 0
    );
  }
  if (value.terminal === "battle-settled" || value.terminal === "reward-settled") {
    const rewardSurfaces = destination.rewardSurfaces;
    if (
      destination.kind !== "reward"
      || !isSafeNonNegativeInteger(destination.hostTurn)
      || (destination.result !== "victory" && destination.result !== "failure")
      || (destination.continuation !== "rewards"
        && destination.continuation !== "encounter"
        && destination.continuation !== "none")
      || typeof destination.trainerVictory !== "boolean"
      || !isCompleteCoopMeRewardSurfacePlan(rewardSurfaces)
      || typeof destination.eggLapse !== "boolean"
    ) {
      return false;
    }
    let trainerVictoryMaterial: CoopTrainerVictoryMaterial | null;
    if (destination.trainerVictory) {
      if (!isCompleteCoopTrainerVictoryMaterial(destination.trainerVictoryMaterial)) {
        return false;
      }
      trainerVictoryMaterial = destination.trainerVictoryMaterial;
    } else {
      if (destination.trainerVictoryMaterial !== null) {
        return false;
      }
      trainerVictoryMaterial = null;
    }
    const commonValid =
      (!destination.trainerVictory || destination.result === "victory")
      && (trainerVictoryMaterial == null || trainerVictoryMaterial.sourceWave === outcome.authoritativeState.wave)
      && ((rewardSurfaces.length === 0 && !destination.eggLapse) || destination.continuation === "rewards");
    return value.terminal === "reward-settled"
      ? commonValid && destination.continuation === "rewards" && destination.trainerVictory === false
      : commonValid;
  }
  return (
    destination.kind === "continue"
    && isSafeNonNegativeInteger(destination.nextWave)
    && typeof destination.selectBiome === "boolean"
  );
}

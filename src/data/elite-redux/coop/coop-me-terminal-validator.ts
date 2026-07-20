/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// Cycle-free, engine-free admission contract shared by the legacy ME adapter and Authority V2 entry
// construction. Keeping one validator prevents the V2 log from retaining a terminal image the real
// destination executor would later reject.

import {
  COOP_ME_REROLL_MULTIPLIER_MAX,
  COOP_ME_REWARD_SURFACE_ID_MAX_LENGTH,
  COOP_ME_REWARD_SURFACE_LIMIT,
  type CoopMeRewardSurfaceProjection,
  type CoopMeTerminalPayload,
} from "#data/elite-redux/coop/coop-operation-envelope";
import type { CoopAuthoritativeBattleStateV1, CoopInteractionOutcome } from "#data/elite-redux/coop/coop-transport";
import { ER_ID_MAP } from "#data/elite-redux/er-id-map";
import { EggSourceType } from "#enums/egg-source-types";
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
const REGISTERED_EGG_SPECIES = new Set<number>(Object.values(ER_ID_MAP.species));
const VALID_EGG_SOURCE_TYPES = new Set<number>(
  Object.values(EggSourceType).filter((value): value is number => typeof value === "number"),
);
const VALID_VARIANT_TIERS = new Set<number>(
  Object.values(VariantTier).filter((value): value is number => typeof value === "number"),
);

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

function isCompleteCoopMeRewardSurfacePlan(value: unknown): value is CoopMeRewardSurfaceProjection[] {
  if (!Array.isArray(value) || value.length > COOP_ME_REWARD_SURFACE_LIMIT) {
    return false;
  }
  const surfaceIds = new Set<string>();
  for (const surface of value) {
    if (!isPlainObject(surface) || !isCanonicalCoopMeRewardSurfaceId(surface.surfaceId)) {
      return false;
    }
    const validSurface =
      surface.kind === "modifier"
        ? isExecutableCoopMeRerollMultiplier(surface.rerollMultiplier)
        : surface.kind === "egg"
          && isSafeNonNegativeInteger(surface.id)
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
              && surface.eggDescriptor.length <= COOP_ME_EGG_DESCRIPTOR_MAX_LENGTH));
    if (!validSurface || surfaceIds.has(surface.surfaceId)) {
      return false;
    }
    surfaceIds.add(surface.surfaceId);
  }
  return true;
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
    return (
      destination.kind === "battle"
      && isSafeNonNegativeInteger(destination.hostTurn)
      && isSafeNonNegativeInteger(destination.encounterMode)
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
    const commonValid =
      (!destination.trainerVictory || destination.result === "victory")
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

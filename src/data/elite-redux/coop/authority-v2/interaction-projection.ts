/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// AUTHORITY V2 - CLOSED SHARED-INTERACTION PROJECTION CAPSULES.
//
// The comprehensive battle snapshot intentionally does not serialize a Phaser
// phase tree. Therefore a recoverable executable interaction must carry enough
// immutable entry material to reconstruct its exact public phase generation.
// This module decodes that material into a closed, engine-free plan. The live
// runtime is allowed to execute the plan; it is never allowed to invent one
// from its ambient queue, local RNG, or a stale handler.
// =============================================================================

import type { CoopAuthorityEntry } from "#data/elite-redux/coop/authority-v2/contract";
import { decodeCoopV2InteractionEnvelope } from "#data/elite-redux/coop/authority-v2/cutover-interaction";
import {
  COOP_ABILITY_ACTION_STRIDE,
  COOP_COLOSSEUM_ACTION_STRIDE,
} from "#data/elite-redux/coop/coop-operation-address";
import type {
  CoopAbilityPresentationPayload,
  CoopBargainPresentationPayload,
  CoopCatchFullPayload,
  CoopLearnMoveBatchPayload,
  CoopLearnMovePayload,
  CoopMePresentPayload,
  CoopRevivalPayload,
  CoopRewardPresentationPayload,
  CoopStormglassPresentationPayload,
} from "#data/elite-redux/coop/coop-operation-envelope";
import { parseCoopOperationId } from "#data/elite-redux/coop/coop-operation-envelope";
import { COOP_ME_PUMP_SEQ_BASE } from "#data/elite-redux/coop/coop-seq-registry";

type RewardProjection = Extract<CoopRewardPresentationPayload, { readonly surface: "reward" }>;
type MarketProjection = Extract<CoopRewardPresentationPayload, { readonly surface: "market" }>;

export type CoopV2InteractionProjectionPlan =
  | {
      readonly kind: "ability";
      readonly operationId: string;
      readonly phaseName: "ErAbilityCapsulePhase" | "ErGreaterAbilityCapsulePhase" | "ErGreaterAbilityRandomizerPhase";
      readonly presentation: CoopAbilityPresentationPayload;
    }
  | {
      readonly kind: "bargain";
      readonly operationId: string;
      readonly pinned: number;
      readonly sins: readonly string[];
    }
  | {
      readonly kind: "biome";
      readonly operationId: string;
      readonly sourceWave: number;
    }
  | {
      readonly kind: "catch-full";
      readonly operationId: string;
      readonly pokemonName: string;
      readonly speciesId: number;
    }
  | {
      readonly kind: "colosseum";
      readonly operationId: string;
      readonly pinned: number;
      readonly round: number;
      readonly labels: readonly string[];
    }
  | {
      readonly kind: "learn-move";
      readonly operationId: string;
      readonly partySlot: number;
      readonly moveId: number;
      readonly maxMoveCount: number;
    }
  | {
      readonly kind: "learn-move-batch";
      readonly operationId: string;
      readonly partySlot: number;
      readonly learnableIds: readonly number[];
      readonly ownerIsGuest: boolean;
    }
  | {
      readonly kind: "mystery";
      readonly operationId: string;
      readonly pinned: number;
      readonly presentation: NonNullable<CoopMePresentPayload["presentation"]>;
    }
  | {
      readonly kind: "revival";
      readonly operationId: string;
      readonly fieldIndex: number;
    }
  | {
      readonly kind: "reward";
      readonly operationId: string;
      readonly projection: RewardProjection;
    }
  | {
      readonly kind: "market";
      readonly operationId: string;
      readonly projection: MarketProjection;
    }
  | {
      readonly kind: "stormglass";
      readonly operationId: string;
      readonly presentation: CoopStormglassPresentationPayload;
    };

function plain(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function rewardProjectionFromOperation(
  kind: string,
  payload: Record<string, unknown>,
): RewardProjection | MarketProjection | null {
  if (kind === "REWARD_PRESENT" || kind === "SHOP_PRESENT") {
    return payload as unknown as RewardProjection | MarketProjection;
  }
  if (kind !== "REWARD" && kind !== "SHOP_BUY") {
    return null;
  }
  const result = plain(payload.result) ? payload.result : null;
  const continuation = result != null && plain(result.continuation) ? result.continuation : null;
  return continuation as RewardProjection | MarketProjection | null;
}

/**
 * Decode one executable shared successor into its complete immutable constructor plan.
 *
 * Returning null is fail-closed. In particular, a non-terminal reward/market result without its complete
 * continuation capsule can never be acknowledged as `controlInstalled` and can never recover by guessing.
 */
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: one exhaustive closed-union decoder is the compile-time completeness boundary
export function projectionPlanOfCoopV2InteractionEntry(
  entry: CoopAuthorityEntry,
): CoopV2InteractionProjectionPlan | null {
  const material = decodeCoopV2InteractionEnvelope(entry);
  const control = entry.nextControl;
  if (material == null || control.kind !== "SHARED_INTERACTION") {
    return null;
  }
  const operation = material.envelope.pendingOperation;
  const payload = operation != null && plain(operation.payload) ? operation.payload : null;
  const parsed = operation == null ? null : parseCoopOperationId(operation.id);
  if (operation == null || payload == null || parsed == null) {
    return null;
  }

  switch (operation.kind) {
    case "ABILITY_PRESENT": {
      const presentation = payload as unknown as CoopAbilityPresentationPayload;
      const phaseName =
        presentation.workflow === "capsule"
          ? "ErAbilityCapsulePhase"
          : presentation.workflow === "greater-capsule"
            ? "ErGreaterAbilityCapsulePhase"
            : presentation.workflow === "greater-randomizer"
              ? "ErGreaterAbilityRandomizerPhase"
              : null;
      return phaseName == null || presentation.pinned !== parsed.pinnedSeq / COOP_ABILITY_ACTION_STRIDE
        ? null
        : { kind: "ability", operationId: control.operationId, phaseName, presentation };
    }
    case "BARGAIN_PRESENT": {
      const presentation = payload as unknown as CoopBargainPresentationPayload;
      return presentation.sins.length === 0
        ? null
        : {
            kind: "bargain",
            operationId: control.operationId,
            pinned: presentation.pinned,
            sins: [...presentation.sins],
          };
    }
    case "CROSSROADS_PICK":
      return payload.optionIndex === 1
        ? { kind: "biome", operationId: control.operationId, sourceWave: material.envelope.wave }
        : null;
    case "CATCH_FULL": {
      const prompt = payload as unknown as CoopCatchFullPayload;
      return prompt.type === "prompt"
        ? {
            kind: "catch-full",
            operationId: control.operationId,
            pokemonName: prompt.pokemonName,
            speciesId: prompt.speciesId,
          }
        : null;
    }
    case "COLO_PICK": {
      const round = payload.round;
      const labels = payload.labels;
      const pinned = Math.floor(parsed.pinnedSeq / COOP_COLOSSEUM_ACTION_STRIDE);
      return payload.type === "board"
        && Number.isSafeInteger(round)
        && Array.isArray(labels)
        && labels.every(label => typeof label === "string")
        ? {
            kind: "colosseum",
            operationId: control.operationId,
            pinned,
            round: round as number,
            labels: [...labels] as string[],
          }
        : null;
    }
    case "LEARN_MOVE": {
      const prompt = payload as unknown as CoopLearnMovePayload;
      return prompt.type === "prompt"
        ? {
            kind: "learn-move",
            operationId: control.operationId,
            partySlot: prompt.partySlot,
            moveId: prompt.moveId,
            maxMoveCount: prompt.maxMoveCount,
          }
        : null;
    }
    case "LEARN_MOVE_BATCH": {
      const prompt = payload as unknown as CoopLearnMoveBatchPayload;
      return prompt.type === "prompt"
        ? {
            kind: "learn-move-batch",
            operationId: control.operationId,
            partySlot: prompt.partySlot,
            learnableIds: [...prompt.learnableIds],
            ownerIsGuest: prompt.ownerIsGuest,
          }
        : null;
    }
    case "ME_PRESENT": {
      const presentation = payload as unknown as CoopMePresentPayload;
      const pinned = Math.floor(parsed.pinnedSeq / 8000) - COOP_ME_PUMP_SEQ_BASE;
      return presentation.present === true && presentation.presentation != null && pinned >= 0
        ? {
            kind: "mystery",
            operationId: control.operationId,
            pinned,
            presentation: structuredClone(presentation.presentation),
          }
        : null;
    }
    case "REVIVAL": {
      const prompt = payload as unknown as CoopRevivalPayload;
      return prompt.type === "prompt"
        ? { kind: "revival", operationId: control.operationId, fieldIndex: prompt.fieldIndex }
        : null;
    }
    case "REWARD":
    case "REWARD_PRESENT": {
      const projection = rewardProjectionFromOperation(operation.kind, payload);
      return projection?.surface === "reward"
        ? { kind: "reward", operationId: control.operationId, projection: structuredClone(projection) }
        : null;
    }
    case "SHOP_BUY":
    case "SHOP_PRESENT": {
      const projection = rewardProjectionFromOperation(operation.kind, payload);
      return projection?.surface === "market"
        ? { kind: "market", operationId: control.operationId, projection: structuredClone(projection) }
        : null;
    }
    case "STORMGLASS_PRESENT":
      return {
        kind: "stormglass",
        operationId: control.operationId,
        presentation: structuredClone(payload) as unknown as CoopStormglassPresentationPayload,
      };
    case "ABILITY_PICK":
    case "BARGAIN":
    case "BIOME_PICK":
    case "ME_BUTTON":
    case "ME_PICK":
    case "ME_SUB":
    case "ME_TERMINAL":
    case "QUIZ_ANSWER":
    case "STORMGLASS":
    case "FAINT_SWITCH":
    case "WAVE_ADVANCE":
      return null;
  }
}

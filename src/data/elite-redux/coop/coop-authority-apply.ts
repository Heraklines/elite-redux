/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { COOP_CHECKSUM_SENTINEL } from "#data/elite-redux/coop/coop-battle-checksum";
import {
  applyCoopAuthoritativeBattleState,
  applyCoopCheckpoint,
  applyCoopFieldSnapshot,
  captureCoopChecksum,
  coopAppliedStateTick,
  drainCoopApplyFailures,
  reapplyAcceptedCoopAuthoritativeBattleState,
} from "#data/elite-redux/coop/coop-battle-engine";
import type { CoopCheckpointEnvelope } from "#data/elite-redux/coop/coop-battle-stream";
import { coopLog, coopWarn } from "#data/elite-redux/coop/coop-debug";

function isCompleteRetainedCheckpoint(envelope: CoopCheckpointEnvelope): boolean {
  const checkpointTick = envelope.checkpoint.tick;
  const stateTick = envelope.authoritativeState?.tick;
  return (
    envelope.reason === "replacement"
    && Number.isSafeInteger(checkpointTick)
    && (checkpointTick as number) > 0
    && Number.isSafeInteger(stateTick)
    && (stateTick as number) > (checkpointTick as number)
    && Array.isArray(envelope.fullField)
    && envelope.fullField.length > 0
    && envelope.checksum !== COOP_CHECKSUM_SENTINEL
  );
}

function applyCompleteRetainedCheckpoint(envelope: CoopCheckpointEnvelope, authoritativeGuest: boolean): boolean {
  const state = envelope.authoritativeState;
  const checkpointTick = envelope.checkpoint.tick as number;
  const stateTick = state.tick;
  const admittedBefore = coopAppliedStateTick();
  if (admittedBefore > stateTick || (admittedBefore > checkpointTick && admittedBefore < stateTick)) {
    coopWarn(
      "checkpoint",
      `guest retained checkpoint ticks ${checkpointTick}/${stateTick} conflict with lastApplied=${admittedBefore}`,
    );
    return false;
  }

  const checkpointAlreadyApplied = admittedBefore === checkpointTick || admittedBefore === stateTick;
  const checkpointApplied = checkpointAlreadyApplied || applyCoopCheckpoint(envelope.checkpoint);
  const admittedAfterCheckpoint = coopAppliedStateTick();
  const authoritativeAlreadyApplied = admittedAfterCheckpoint === stateTick;
  const authoritativeApplied =
    checkpointApplied
    && (authoritativeAlreadyApplied
      ? reapplyAcceptedCoopAuthoritativeBattleState(state, authoritativeGuest)
      : applyCoopAuthoritativeBattleState(state, authoritativeGuest));
  if (authoritativeApplied) {
    applyCoopFieldSnapshot(envelope.fullField, authoritativeGuest);
  }
  const failures = drainCoopApplyFailures();
  const guestChecksum = captureCoopChecksum();
  const converged =
    checkpointApplied
    && authoritativeApplied
    && failures.length === 0
    && guestChecksum !== COOP_CHECKSUM_SENTINEL
    && guestChecksum === envelope.checksum;
  if (converged) {
    coopLog(
      "checkpoint",
      `guest retained checkpoint transaction COMMIT host=guest=${guestChecksum} `
        + `checkpoint=${checkpointAlreadyApplied ? "reused" : "applied"} `
        + `state=${authoritativeAlreadyApplied ? "reasserted" : "applied"}`,
    );
    return true;
  }
  coopWarn(
    "checkpoint",
    `guest retained checkpoint transaction NOT converged checkpointApplied=${checkpointApplied} `
      + `authoritativeApplied=${authoritativeApplied} failures=${failures.length} `
      + `host=${envelope.checksum} guest=${guestChecksum}`,
  );
  return false;
}

/**
 * Apply one retained out-of-band authority frame as a single verified transaction.
 *
 * The numeric checkpoint, id-addressed state, rich field companion, structured failure ledger, and checksum
 * are one indivisible proof. A failed first attempt may already have admitted one of the two monotonic ticks,
 * so an exact retry reasserts the accepted state rather than turning a retriable projection failure into a
 * permanent stale-tick rejection. The caller keeps the carrier retained and unacknowledged until this returns
 * true; presentation and continuation readiness remain later, independent evidence stages.
 */
export function applyCoopRetainedCheckpointTransaction(
  envelope: CoopCheckpointEnvelope,
  authoritativeGuest: boolean,
): boolean {
  const checkpointTick = envelope.checkpoint.tick;
  const stateTick = envelope.authoritativeState?.tick;
  if (!isCompleteRetainedCheckpoint(envelope)) {
    coopWarn(
      "checkpoint",
      `guest rejected incomplete retained checkpoint reason=${envelope.reason} `
        + `checkpointTick=${checkpointTick ?? "missing"} stateTick=${stateTick ?? "missing"} `
        + `fullField=${envelope.fullField?.length ?? 0} checksum=${envelope.checksum}`,
    );
    return false;
  }

  try {
    return applyCompleteRetainedCheckpoint(envelope, authoritativeGuest);
  } catch (error) {
    coopWarn("checkpoint", "guest retained checkpoint transaction threw; frame retained", error);
  }
  return false;
}

/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Active co-op session registry (#633, co-op mode - phase P1).
//
// A module-level singleton holding the in-progress co-op session for the current
// run. Lives here (NOT as a field on BattleScene) so the mode-entry menu, the
// starter-select phase, and later the battle phases can all reach the session
// without threading it through `globalScene` - and so co-op stays a self-contained
// module that never edits the shared battle-scene file.
//
// During local development the session is host + a SpoofGuest over a
// LoopbackTransport (a stand-in player 2); at phase P6 the same `controller` is
// constructed over a real WebRTC transport instead and nothing here changes.
// =============================================================================

import { globalScene } from "#app/global-scene";
import {
  armCoopAbilityJournalMaterialization,
  COOP_ABILITY_ACTION_STRIDE,
  isCoopAbilityOperationEnabled,
  resetCoopAbilityOperationState,
  setCoopAbilityOperationRevisionFloor,
} from "#data/elite-redux/coop/coop-ability-operation";
import {
  COOP_ABILITY_KIND,
  COOP_ABILITY_OUTCOME,
  coopAbilityPickerSeq,
} from "#data/elite-redux/coop/coop-ability-picker-relay";
import {
  setCoopAuthoritativeGuestPredicate,
  setShowdownGuestFlipPredicate,
} from "#data/elite-redux/coop/coop-authoritative-gate";
import {
  armCoopBargainJournalMaterialization,
  isCoopBargainOperationEnabled,
  resetCoopBargainOperationState,
  setCoopBargainOperationRevisionFloor,
} from "#data/elite-redux/coop/coop-bargain-operation";
import { COOP_CHECKSUM_SENTINEL, canonicalize, fnv1a64 } from "#data/elite-redux/coop/coop-battle-checksum";
import {
  applyCoopAuthoritativeBattleState,
  applyCoopDexDelta,
  applyCoopFullSnapshot,
  applyCoopMeOutcome,
  captureCoopAuthoritativeBattleState,
  captureCoopCaptureParty,
  captureCoopChecksum,
  captureCoopDexDelta,
  captureCoopEnemies,
  captureCoopFullSnapshot,
  captureCoopMeOutcome,
  consumeCoopMeOutcomeRollbackFatal,
  coopAppliedStateTick,
  reapplyAcceptedCoopAuthoritativeBattleState,
  resetCoopStateTicks,
} from "#data/elite-redux/coop/coop-battle-engine";
import { CoopBattleStreamer } from "#data/elite-redux/coop/coop-battle-stream";
import { CoopBattleSync, type CoopCommandTimeout } from "#data/elite-redux/coop/coop-battle-sync";
import {
  isCoopBiomeOperationEnabled,
  preflightCoopBiomeJournalMaterialization,
  publishCoopBiomeJournalMaterialization,
  resetCoopBiomeOperationState,
  setCoopBiomeOperationRevisionFloor,
} from "#data/elite-redux/coop/coop-biome-operation";
import {
  COOP_CAP_DURABILITY_JOURNAL,
  COOP_CAP_OP_ABILITY,
  COOP_CAP_OP_BARGAIN,
  COOP_CAP_OP_BIOME,
  COOP_CAP_OP_CATCH_FULL,
  COOP_CAP_OP_COLOSSEUM,
  COOP_CAP_OP_FAINT_SWITCH,
  COOP_CAP_OP_LEARN_MOVE,
  COOP_CAP_OP_ME,
  COOP_CAP_OP_REVIVAL,
  COOP_CAP_OP_REWARD,
  COOP_CAP_OP_STORMGLASS,
  COOP_CAP_OP_WAVE,
  COOP_CAP_RENDERER_ALLOWLIST_ENFORCE,
  type CoopCapabilityKey,
  clearNegotiatedCoopCapabilities,
  isCoopCapabilityNegotiated,
} from "#data/elite-redux/coop/coop-capabilities";
import {
  isCoopCatchFullOperationEnabled,
  resetCoopCatchFullOperationState,
  setCoopCatchFullOperationRevisionFloor,
} from "#data/elite-redux/coop/coop-catch-full-operation";
import { recordCoopCausalEvent } from "#data/elite-redux/coop/coop-causal-trace";
import { getCoopChecksumAssertionCount } from "#data/elite-redux/coop/coop-checksum-assert";
import {
  COOP_COLOSSEUM_ACTION_STRIDE,
  isCoopColosseumOperationEnabled,
  resetCoopColosseumOperationState,
  setCoopColosseumOperationRevisionFloor,
} from "#data/elite-redux/coop/coop-colosseum-operation";
import { coopLog, coopWarn, isCoopDebug } from "#data/elite-redux/coop/coop-debug";
import { CoopDurabilityManager, isCoopDurabilityEnabled } from "#data/elite-redux/coop/coop-durability";
import {
  isCoopFaintSwitchOperationEnabled,
  resetCoopFaintSwitchOperationState,
  setCoopFaintSwitchOperationRevisionFloor,
} from "#data/elite-redux/coop/coop-faint-switch-operation";
import {
  COOP_DEX_SYNC_SEQ,
  COOP_FAINT_SWITCH_SEQ_BASE,
  COOP_INTERACTION_LEAVE,
  CoopInteractionRelay,
  coopBiomeShopSeq,
  isCoopFaintSwitchSeq,
  isCoopFaintSwitchWindowOpen,
  resetCoopFaintSwitchWindows,
} from "#data/elite-redux/coop/coop-interaction-relay";
import {
  isCoopLearnMoveOperationEnabled,
  resetCoopLearnMoveOperationState,
  setCoopLearnMoveOperationRevisionFloor,
} from "#data/elite-redux/coop/coop-learn-move-operation";
import { COOP_DISCONNECT_GRACE_MS } from "#data/elite-redux/coop/coop-lifecycle";
import { meBattleHandoffKey } from "#data/elite-redux/coop/coop-me-battle-handoff";
import {
  CoopMeTerminalTransactionReceiver,
  commitMeOwnerIntent,
  isCompleteCoopMeTerminalPayload,
  isCoopMeOperationEnabled,
  resetCoopMeOperationState,
  setCoopMeOperationRevisionFloor,
} from "#data/elite-redux/coop/coop-me-operation";
import {
  canMaterializeCoopMeCommittedTerminal,
  canRestoreCoopActiveMysteryControl,
  captureCoopActiveMysteryControl,
  captureCoopMeControlTransactionState,
  coopMeHandoffBattleStarted,
  coopMeHandoffBattleWaveValue,
  coopMeInteractionStartValue,
  materializeCoopMeCommittedTerminal,
  rebindCoopActiveMysteryControl,
  resetCoopActiveMysteryControl,
  restoreCoopActiveMysteryControl,
  restoreCoopActiveMysteryControlWithoutRebind,
  restoreCoopMeControlTransactionState,
  setCoopMeActivePresentation,
  setCoopMeInteractionStart,
  setCoopMeTerminalControl,
} from "#data/elite-redux/coop/coop-me-pin-state";
import { COOP_ME_BATTLE_HANDOFF, CoopMePump } from "#data/elite-redux/coop/coop-me-pump";
import { CoopMembershipController } from "#data/elite-redux/coop/coop-membership";
import type {
  CoopAbilityPickPayload,
  CoopAuthoritativeEnvelopeV1,
  CoopBargainPayload,
  CoopBiomePickPayload,
  CoopCatchFullPayload,
  CoopColosseumPayload,
  CoopCrossroadsPickPayload,
  CoopFaintSwitchPayload,
  CoopLearnMoveBatchPayload,
  CoopLearnMovePayload,
  CoopMeButtonPayload,
  CoopMePickPayload,
  CoopMePresentPayload,
  CoopMeSubPayload,
  CoopMeTerminalPayload,
  CoopQuizAnswerPayload,
  CoopRevivalPayload,
  CoopRewardActionPayload,
  CoopShopBuyPayload,
  CoopStormglassPayload,
  CoopWaveAdvancePayload,
} from "#data/elite-redux/coop/coop-operation-envelope";
import { parseCoopOperationId } from "#data/elite-redux/coop/coop-operation-envelope";
import { applyCoopOperationEpoch } from "#data/elite-redux/coop/coop-operation-epoch";
import {
  coopOperationDurabilityHooks,
  isCoopOperationJournalActive,
  registerCoopOperationLiveSink,
  resetCoopOperationJournalLog,
  setCoopOperationDurability,
} from "#data/elite-redux/coop/coop-operation-journal";
import {
  adoptCoopGlobalGuestRevision,
  type CoopRuntimeOpState,
  createCoopRuntimeOpState,
  getCoopGlobalGuestRevisionClock,
  resetCoopGlobalOperationOrder,
  setActiveCoopRuntimeOpState,
  setCoopGlobalOperationRevisionFloor,
  withActiveCoopRuntimeOpState,
} from "#data/elite-redux/coop/coop-operation-runtime";
import { CoopRendezvous } from "#data/elite-redux/coop/coop-rendezvous";
import {
  isCoopRevivalOperationEnabled,
  resetCoopRevivalOperationState,
  setCoopRevivalOperationRevisionFloor,
} from "#data/elite-redux/coop/coop-revival-operation";
import {
  armCoopRewardJournalMaterialization,
  COOP_REWARD_ACTION_STRIDE,
  isCoopRewardOperationEnabled,
  resetCoopRewardOperationState,
  setCoopRewardOperationRevisionFloor,
} from "#data/elite-redux/coop/coop-reward-operation";
import {
  COOP_BARGAIN_SEQ_BASE,
  COOP_BIOME_PICK_SEQ_BASE,
  COOP_BIOME_SHOP_CHOICE_KINDS,
  COOP_BIOME_TRANSITION_SEQ_BASE,
  COOP_COLOSSEUM_SEQ_BASE,
  COOP_CROSSROADS_SEQ_BASE,
  COOP_LEARN_MOVE_BATCH_FWD_SEQ_BASE,
  COOP_LEARN_MOVE_FWD_SEQ_BASE,
  COOP_MAX_REACHABLE_COUNTER,
  COOP_ME_PUMP_SEQ_BASE,
  COOP_ME_TERM_SEQ_BASE,
  COOP_REJOIN_SYNC_SEQ_BASE,
  COOP_REWARD_CHOICE_KINDS,
  COOP_STORMGLASS_SEQ,
} from "#data/elite-redux/coop/coop-seq-registry";
import { coopFieldIndexOf, coopInteractionOwnerSeat, coopOwnerOfFieldSlot } from "#data/elite-redux/coop/coop-session";
import type { CoopP33AuthenticatedContextV1 } from "#data/elite-redux/coop/coop-session-binding";
import { CoopSessionController } from "#data/elite-redux/coop/coop-session-controller";
import type {
  CoopSharedTerminalStart,
  CoopSharedTerminalSupervisor,
} from "#data/elite-redux/coop/coop-shared-terminal";
import {
  createCoopRuntimeSharedTerminal,
  hasBoundCoopSharedTerminal,
} from "#data/elite-redux/coop/coop-shared-terminal-runtime";
import { SpoofGuest } from "#data/elite-redux/coop/coop-spoof-guest";
import {
  isCoopStormglassOperationEnabled,
  resetCoopStormglassOperationState,
  setCoopStormglassOperationRevisionFloor,
} from "#data/elite-redux/coop/coop-stormglass-operation";
import type {
  CoopActiveControlSnapshotV1,
  CoopAuthoritativeBattleStateV1,
  CoopCapturePresentation,
  CoopFullBattleSnapshot,
  CoopInteractionOutcome,
  CoopNetcodeMode,
  CoopRole,
  CoopSerializedEnemy,
  CoopSessionKind,
  CoopSharedTerminalBoundary,
  CoopSharedTerminalReasonCode,
  CoopWaveOutcome,
} from "#data/elite-redux/coop/coop-transport";
import {
  COOP_PROTOCOL_VERSION,
  type CoopTransport,
  createLoopbackPair,
  type SerializedCommand,
} from "#data/elite-redux/coop/coop-transport";
import { setCoopLiveEmitter } from "#data/elite-redux/coop/coop-turn-recorder";
import { CoopUiMirror } from "#data/elite-redux/coop/coop-ui-mirror";
import { coopAuthorityContinuationSurface } from "#data/elite-redux/coop/coop-ui-registry";
import { resetCoopUiRelayTrace } from "#data/elite-redux/coop/coop-ui-relay-trace";
import {
  type CoopStagedWaveAdvanceTransaction,
  commitWaveAdvanceOwnerIntent,
  getCoopStagedWaveAdvanceTransaction,
  isCoopWaveAdvanceOperationEnabled,
  isCoopWaveAdvanceTransactionComplete,
  isValidCoopWaveAdvancePayload,
  markCoopWaveAdvanceBootstrapProjected,
  markCoopWaveAdvanceContinuationReady,
  markCoopWaveAdvanceDataApplied,
  resetCoopWaveAdvanceOperationState,
  resolveCoopBiomeBoundaryFlag,
  setCoopWaveAdvanceOperationRevisionFloor,
} from "#data/elite-redux/coop/coop-wave-operation";
import { setCoopGhostFetchSuppressed, setCoopGhostPool, setGhostPoolPublisher } from "#data/elite-redux/er-ghost-teams";
import {
  beginReplayRecording,
  clearReplayRecording,
  isReplayRecording,
  recordReplayCommand,
} from "#data/elite-redux/replay-recorder";
import type { ReplayCommandKind } from "#data/elite-redux/replay-trace";
import {
  disposePendingShowdownRelay,
  fireShowdownRejoinResend,
  getShowdownRelay,
} from "#data/elite-redux/showdown/showdown-battle-state";
import { ShowdownLifecycle } from "#data/elite-redux/showdown/showdown-lifecycle";
import { otherRole } from "#data/elite-redux/showdown/showdown-outcome";
import { ShowdownSpoof } from "#data/elite-redux/showdown/showdown-spoof";
import { BattleType } from "#enums/battle-type";
import { BattlerIndex } from "#enums/battler-index";
import { Command } from "#enums/command";
import { UiMode } from "#enums/ui-mode";
import { PokemonData } from "#system/pokemon-data";
import { compressToBase64, decompressFromBase64 } from "lz-string";

/**
 * Co-op ghost-pool sync (#633): the HOST broadcasts its server-fetched ghost-team
 * pool over the battle stream; the GUEST adopts it verbatim and skips its own fetch,
 * so `takeGhostForWave`'s seeded pick is deterministic on both clients (they otherwise
 * download divergent pools and field different ghost trainers = high-wave desync).
 * Gated on the LIVE controller role at send/receive time, so a pre-battle role
 * reconciliation is handled. Cleared in {@linkcode clearCoopRuntime}.
 */
function wireCoopGhostPoolSync(controller: CoopSessionController, battleStream: CoopBattleStreamer): void {
  setGhostPoolPublisher(pool => {
    if (controller.role === "host") {
      battleStream.sendGhostPool(pool);
    }
  });
  setCoopGhostFetchSuppressed(() => controller.role === "guest");
  battleStream.onGhostPool(pool => {
    if (controller.role === "guest") {
      setCoopGhostPool(pool);
    }
  });
}

/**
 * Co-op LIVE battle-event emitter (#633, animation layer): wire the host turn recorder so each visible
 * event (move / hp / faint / stat) is streamed the INSTANT it is recorded, with a per-turn monotonic
 * `seq`, instead of only batching at turn-end. The guest buffers them by `(turn, seq)` and replays them
 * in order (de-duping the turn-end batch) so it watches the fight with minimal lag. Gated on the LIVE
 * host role in the AUTHORITATIVE netcode at send time (a guest / solo / lockstep client never emits), so
 * the existing Phase-1 turn-end batch is unaffected for everyone else. Cleared in {@linkcode clearCoopRuntime}.
 */
function wireCoopLiveEvents(controller: CoopSessionController, battleStream: CoopBattleStreamer): void {
  setCoopLiveEmitter((turn, seq, event) => {
    if (controller.role !== "host" || getCoopNetcodeMode() !== "authoritative") {
      return;
    }
    if (isCoopDebug()) {
      coopLog("runtime", `ME-stream live-event host turn=${turn} seq=${seq} k=${event.k}`);
    }
    battleStream.emitEvent(controller.sessionEpoch, globalScene.currentBattle?.waveIndex ?? 0, turn, seq, event);
  });
}

/**
 * Co-op resync responder (#633, TRACK-2): the HOST answers a guest's `requestStateSync`
 * (sent when the guest's post-turn checksum disagreed with the host's) by serializing its
 * FULL authoritative battle state, lz-compressing it, and streaming it back stamped with
 * the request `seq`. The guest decompresses + adopts it field-by-field. Gated on the live
 * HOST role so a guest/solo client never answers. Best-effort + guarded - a serialize
 * failure never breaks the host's turn.
 */
function captureCoopActiveControl(runtime: CoopRuntime): CoopActiveControlSnapshotV1 {
  let phaseName = "unknown";
  try {
    phaseName = globalScene.phaseManager.getCurrentPhase()?.phaseName ?? "unknown";
  } catch {
    /* headless capture */
  }
  const interactionCounter = runtime.controller.interactionCounter();
  const capturedMystery = captureCoopActiveMysteryControl();
  // Retain a resolved leave through the immediately-following control revision (enough for a dropped
  // terminal/rejoin), then stop attaching that historical event to unrelated future snapshots.
  const activeMysteryEncounter =
    capturedMystery?.terminal === "leave" && interactionCounter > capturedMystery.interactionCounter + 1
      ? undefined
      : capturedMystery;
  return {
    version: 1,
    phaseName,
    interactionCounter,
    // `hostPhaseName` is diagnostic, not causal Mystery control. Do not append the current phase to the
    // retained statement at capture time: doing so would create different content at the same revision.
    ...(activeMysteryEncounter === undefined ? {} : { activeMysteryEncounter }),
    awaitedInteractions: runtime.interactionRelay.describeAwaitedInteractions().map(wait => ({
      seq: wait.seq,
      expectedKinds: [...wait.expectedKinds],
    })),
    barriers: runtime.rendezvous.describeArrivals(),
    pendingCommands: runtime.battleSync.describePendingRequests(),
  };
}

/** Stable digest over the CONTROL half of an atomic full snapshot. */
export function coopSnapshotControlDigest(
  snapshot: Pick<
    CoopFullBattleSnapshot,
    "checksum" | "sessionEpoch" | "membership" | "activeControl" | "journalHighWater"
  >,
): string {
  // Hash the JSON wire representation, not an in-memory object that may still contain explicit undefined
  // properties. JSON drops those keys; normalizing first keeps pre-send and post-parse digests identical.
  const wireControl = JSON.parse(
    JSON.stringify({
      checksum: snapshot.checksum,
      sessionEpoch: snapshot.sessionEpoch,
      membership: snapshot.membership,
      activeControl: snapshot.activeControl,
      journalHighWater: snapshot.journalHighWater ?? {},
    }),
  ) as unknown;
  return fnv1a64(canonicalize(wireControl));
}

function bindCoopSnapshotControl(snapshot: CoopFullBattleSnapshot): CoopFullBattleSnapshot {
  return { ...snapshot, controlDigest: coopSnapshotControlDigest(snapshot) };
}

function isValidCoopActiveControlSnapshot(
  control: CoopActiveControlSnapshotV1 | undefined,
): control is CoopActiveControlSnapshotV1 {
  return (
    control?.version === 1
    && typeof control.phaseName === "string"
    && Number.isSafeInteger(control.interactionCounter)
    && control.interactionCounter >= 0
    && Array.isArray(control.awaitedInteractions)
    && control.awaitedInteractions.every(
      wait =>
        Number.isSafeInteger(wait.seq)
        && wait.seq >= 0
        && Array.isArray(wait.expectedKinds)
        && wait.expectedKinds.every(kind => typeof kind === "string"),
    )
    && Array.isArray(control.barriers?.localArrived)
    && control.barriers.localArrived.every(value => typeof value === "string")
    && Array.isArray(control.barriers?.partnerArrived)
    && control.barriers.partnerArrived.every(value => typeof value === "string")
    && Array.isArray(control.barriers?.awaiting)
    && control.barriers.awaiting.every(value => typeof value === "string")
    && Array.isArray(control.pendingCommands)
    && control.pendingCommands.every(
      command =>
        Number.isSafeInteger(command.fieldIndex)
        && Number.isSafeInteger(command.turn)
        && Array.isArray(command.moveSlots)
        && command.moveSlots.every(Number.isSafeInteger)
        && (command.owner === "host" || command.owner === "guest")
        && command.address != null
        && Number.isSafeInteger(command.address.epoch)
        && Number.isSafeInteger(command.address.wave)
        && Number.isSafeInteger(command.address.pokemonId),
    )
  );
}

function preflightCoopAtomicSnapshot(runtime: CoopRuntime, snapshot: CoopFullBattleSnapshot): boolean {
  const control = snapshot.activeControl;
  const mystery = control?.activeMysteryEncounter;
  return (
    snapshot.sessionEpoch === runtime.controller.sessionEpoch
    && snapshot.checksum != null
    && snapshot.checksum !== COOP_CHECKSUM_SENTINEL
    && snapshot.membership != null
    && isValidCoopActiveControlSnapshot(control)
    && snapshot.membership.state === "active"
    && snapshot.membership.members.every(member => member.present)
    && runtime.membership.canAdopt(snapshot.membership)
    && runtime.controller.canAdoptAuthoritativeInteractionCounter(control.interactionCounter)
    && control.pendingCommands.every(
      command =>
        command.owner === runtime.controller.role
        && command.address?.epoch === snapshot.sessionEpoch
        && (snapshot.authoritativeState?.wave == null || command.address?.wave === snapshot.authoritativeState.wave),
    )
    && (coopMeInteractionStartValue() < 0 || mystery != null)
    && (mystery == null || canRestoreCoopActiveMysteryControl(mystery))
    && Object.values(snapshot.journalHighWater ?? {}).every(value => Number.isSafeInteger(value) && value >= 0)
    && typeof snapshot.controlDigest === "string"
    && snapshot.controlDigest === coopSnapshotControlDigest(snapshot)
  );
}

function wireCoopResyncResponder(runtime: CoopRuntime): void {
  runtime.battleStream.onStateSyncRequest((_turn, seq) => {
    coopLog("resync", `recv requestStateSync turn=${_turn} seq=${seq} role=${runtime.controller.role}`);
    if (runtime.controller.role !== "host") {
      coopLog("resync", `ignore requestStateSync seq=${seq} (not host, role=${runtime.controller.role})`);
      return;
    }
    try {
      const snapshot = captureCoopFullSnapshot();
      if (snapshot == null) {
        coopWarn("resync", `host has no live snapshot for requestStateSync seq=${seq} -> no reply`);
        return;
      }
      const stamped = bindCoopSnapshotControl({
        ...snapshot,
        sessionEpoch: runtime.controller.sessionEpoch,
        checksum: captureCoopChecksum(),
        membership: runtime.membership.snapshot(),
        activeControl: captureCoopActiveControl(runtime),
        journalHighWater: runtime.durability?.controlPlaneHighWater() ?? {},
      } satisfies CoopFullBattleSnapshot);
      if (
        runtime.durability != null
        && !runtime.durability.retainSnapshotFrontier(stamped.controlDigest!, stamped.journalHighWater ?? {})
      ) {
        coopWarn("resync", `host refused unretained stateSync frontier seq=${seq}`);
        return;
      }
      const blob = compressToBase64(JSON.stringify(stamped));
      coopLog("resync", `send stateSync seq=${seq} blob=${blob.length}b`);
      runtime.battleStream.sendStateSync(blob, seq);
    } catch (e) {
      /* a resync serialize/send failure must never break the host's turn */
      coopWarn("resync", `host stateSync send failed seq=${seq}`, e);
    }
  });
}

function activePublicSnapshotSurface(): "command" | "sharedInput" | null {
  try {
    return globalScene.ui.getHandler()?.active === true
      ? coopAuthorityContinuationSurface(globalScene.ui.getMode())
      : null;
  } catch {
    return null;
  }
}

/** Reconstruct every executable CONTROL surface before publishing the checksum-bound snapshot proof. */
function restoreCoopExecutableSnapshotControls(runtime: CoopRuntime, snapshot: CoopFullBattleSnapshot): boolean {
  const control = snapshot.activeControl;
  if (control == null) {
    return false;
  }
  const mystery = control.activeMysteryEncounter;
  if (mystery != null && !rebindCoopActiveMysteryControl(mystery)) {
    coopWarn("resync", "snapshot Mystery presentation could not be rebound");
    return false;
  }
  try {
    runtime.controller.emitAuthoritativeInteractionCounterAfterTransaction();
  } catch (error) {
    coopWarn("resync", "post-commit interaction-counter notification failed", error);
    return false;
  }
  if (!runtime.rendezvous.restorePeerControlSnapshot(control.barriers)) {
    return false;
  }
  if (
    !runtime.battleSync.restorePeerPendingRequests(
      control.pendingCommands,
      runtime.controller.sessionEpoch,
      snapshot.authoritativeState?.wave,
    )
  ) {
    return false;
  }
  return true;
}

const COOP_SNAPSHOT_CONTINUATION_DEADLINE_MS = 60_000;

interface PendingCoopSnapshotProof {
  snapshot: CoopFullBattleSnapshot;
  cancelDeadline: () => void;
}

const pendingCoopSnapshotProofs = new WeakMap<CoopRuntime, PendingCoopSnapshotProof>();

function snapshotContinuationReady(runtime: CoopRuntime, snapshot: CoopFullBattleSnapshot): boolean {
  const control = snapshot.activeControl;
  if (control == null) {
    return false;
  }
  if (control.activeMysteryEncounter != null) {
    return true; // the exact retained Mystery presentation was successfully rebound above
  }

  const surface = activePublicSnapshotSurface();
  let currentPhase = "unknown";
  let currentWave = -1;
  let currentTurn = -1;
  try {
    currentPhase = globalScene.phaseManager.getCurrentPhase()?.phaseName ?? "unknown";
    currentWave = globalScene.currentBattle?.waveIndex ?? -1;
    currentTurn = globalScene.currentBattle?.turn ?? -1;
  } catch {
    /* headless recovery remains unready until a real surface notification */
  }

  if (control.pendingCommands.length > 0) {
    const retained = runtime.battleSync.hasRetainedSnapshotCommand(control.pendingCommands);
    const addressedCommandUi =
      surface === "command"
      && control.pendingCommands.every(
        request => request.address?.wave === currentWave && request.turn === currentTurn,
      );
    if (!retained && !addressedCommandUi) {
      return false;
    }
  }
  if (control.awaitedInteractions.length > 0 && !(surface === "sharedInput" && currentPhase === control.phaseName)) {
    // Raw choices are not fully addressed. Only the same real public input surface can safely resume them.
    return false;
  }

  const arrivals = runtime.rendezvous.describeArrivals();
  const localArrived = new Set(arrivals.localArrived);
  if (arrivals.awaiting.length > 0 || control.barriers.awaiting.some(point => !localArrived.has(point))) {
    return false;
  }
  if (
    control.pendingCommands.length > 0
    || control.awaitedInteractions.length > 0
    || control.barriers.awaiting.length > 0
  ) {
    return true;
  }
  if (currentPhase === "GameOverPhase") {
    return true;
  }
  if (surface == null) {
    return false;
  }
  const snapshotWave = snapshot.authoritativeState?.wave;
  return snapshotWave == null || currentWave === snapshotWave || currentWave === snapshotWave + 1;
}

function clearPendingCoopSnapshotProof(runtime: CoopRuntime): void {
  const pending = pendingCoopSnapshotProofs.get(runtime);
  pending?.cancelDeadline();
  pendingCoopSnapshotProofs.delete(runtime);
}

function publishPendingCoopSnapshotProof(runtime: CoopRuntime): boolean {
  const pending = pendingCoopSnapshotProofs.get(runtime);
  if (pending == null || !snapshotContinuationReady(runtime, pending.snapshot)) {
    return false;
  }
  const snapshot = pending.snapshot;
  if (
    runtime.durability == null
    || !runtime.durability.ackSnapshotMarksAfterTransaction(snapshot.journalHighWater ?? {}, snapshot.controlDigest!)
  ) {
    return false;
  }
  clearPendingCoopSnapshotProof(runtime);
  coopLog("resync", `published continuation-ready snapshot proof control=${snapshot.controlDigest}`);
  return true;
}

function publishOrStageCoopSnapshotProof(runtime: CoopRuntime, snapshot: CoopFullBattleSnapshot): boolean {
  if (runtime.durability == null) {
    return true;
  }
  clearPendingCoopSnapshotProof(runtime);
  const timeout = setTimeout(() => {
    if (pendingCoopSnapshotProofs.get(runtime)?.snapshot !== snapshot) {
      return;
    }
    pendingCoopSnapshotProofs.delete(runtime);
    failCoopSharedSession("snapshot continuation surface did not open before the recovery deadline");
  }, COOP_SNAPSHOT_CONTINUATION_DEADLINE_MS);
  if (typeof timeout === "object" && timeout != null && "unref" in timeout) {
    (timeout as { unref: () => void }).unref();
  }
  pendingCoopSnapshotProofs.set(runtime, { snapshot, cancelDeadline: () => clearTimeout(timeout) });
  if (publishPendingCoopSnapshotProof(runtime)) {
    return true;
  }
  coopLog("resync", `retained snapshot proof until public continuation control=${snapshot.controlDigest}`);
  return true;
}

/** Fast-forward the durability receiver through every operation revision a full DATA snapshot subsumes. */
export function adoptCoopSnapshotHighWater(
  durability: CoopDurabilityManager | undefined,
  snapshot: Pick<CoopFullBattleSnapshot, "journalHighWater" | "sessionEpoch">,
): void {
  if (durability == null) {
    return;
  }
  for (const [cls, revision] of Object.entries(snapshot.journalHighWater ?? {})) {
    if (Number.isFinite(revision) && revision > 0) {
      durability.adoptSnapshot(cls, revision);
    }
  }
  const globalRevision = snapshot.journalHighWater?.["op:global"] ?? 0;
  if (globalRevision > 0 && snapshot.sessionEpoch != null) {
    adoptCoopGlobalGuestRevision(snapshot.sessionEpoch, globalRevision);
  }
}

/**
 * Commit the CONTROL half of a preflighted snapshot as a rollback-capable transaction. Durable ACKs
 * and the Mystery UI rebind are deliberately post-commit side effects: neither can create DATA-only
 * rollback or advertise an uncommitted control image.
 */
function commitCoopSnapshotControls(runtime: CoopRuntime, snapshot: CoopFullBattleSnapshot): boolean {
  if (snapshot.membership == null || snapshot.activeControl == null) {
    return false;
  }
  const priorMembership = runtime.membership.snapshot();
  const priorCounter = runtime.controller.interactionCounter();
  const priorMystery = captureCoopMeControlTransactionState();
  const priorAppliedMarks = runtime.durability?.appliedMarks() ?? {};
  const guestClock = getCoopGlobalGuestRevisionClock(runtime.controller.sessionEpoch, 0);
  const priorGlobalRevision = guestClock.revision;
  const mystery = snapshot.activeControl.activeMysteryEncounter;
  try {
    if (mystery != null && !restoreCoopActiveMysteryControlWithoutRebind(mystery)) {
      throw new Error("active Mystery control refused after preflight");
    }
    if (!runtime.membership.adopt(snapshot.membership)) {
      throw new Error("membership refused after preflight");
    }
    if (
      !runtime.controller.adoptAuthoritativeInteractionCounterForTransaction(snapshot.activeControl.interactionCounter)
    ) {
      throw new Error("interaction counter refused after preflight");
    }
    const globalRevision = snapshot.journalHighWater?.["op:global"] ?? 0;
    if (globalRevision > guestClock.revision) {
      guestClock.revision = globalRevision;
    }
    runtime.durability?.adoptSnapshotMarksForTransaction(snapshot.journalHighWater ?? {});
  } catch (error) {
    let rollbackFailed = false;
    for (const restore of [
      () => runtime.durability?.restoreAppliedMarksForTransaction(priorAppliedMarks),
      () => {
        guestClock.revision = priorGlobalRevision;
      },
      () => runtime.controller.restoreAuthoritativeInteractionCounterForTransaction(priorCounter),
      () => runtime.membership.restoreForTransaction(priorMembership),
      () => restoreCoopMeControlTransactionState(priorMystery),
    ]) {
      try {
        restore();
      } catch {
        rollbackFailed = true;
      }
    }
    coopWarn("resync", "atomic snapshot CONTROL commit rolled back", error);
    if (rollbackFailed) {
      failCoopSharedSession("atomic snapshot control rollback failed");
    }
    return false;
  }

  if (!restoreCoopExecutableSnapshotControls(runtime, snapshot)) {
    // DATA+CONTROL is already coherent. A failed executable-surface reconstruction is a terminal session/UI
    // failure, never a reason to roll only DATA back underneath the committed controller state.
    failCoopSharedSession("snapshot control committed but executable continuation restore failed");
    return true;
  }
  if (!publishOrStageCoopSnapshotProof(runtime, snapshot)) {
    failCoopSharedSession("snapshot control committed but durability snapshot proof was refused");
  }
  return true;
}

/** Adopt the optional checksum-bound Mystery control surface carried by a full snapshot. */
export function adoptCoopActiveMysterySnapshot(snapshot: Pick<CoopFullBattleSnapshot, "activeControl">): boolean {
  const mystery = snapshot.activeControl?.activeMysteryEncounter;
  if (mystery == null) {
    return true; // additive/backward-compatible snapshot
  }
  const adopted = restoreCoopActiveMysteryControl(mystery);
  if (!adopted) {
    coopWarn(
      "resync",
      `refused active Mystery control counter=${mystery.interactionCounter} terminal=${mystery.terminal}`,
    );
  }
  return adopted;
}

/**
 * An active CoopReplayMePhase is itself the safe boundary: it is parked in an exact network wait and
 * cannot end until Mystery control arrives. Applying the cheap scalar snapshot here avoids queueing the
 * recovery phase behind the very waiter it must rebind. Returns null when the normal queued path applies.
 */
function tryApplyCoopActiveMysterySnapshotInline(
  runtime: CoopRuntime,
  snapshot: CoopFullBattleSnapshot,
  label: string,
  onHealed?: (() => void) | undefined,
): boolean | null {
  const mystery = snapshot.activeControl?.activeMysteryEncounter;
  let phaseName = "unknown";
  try {
    phaseName = globalScene.phaseManager.getCurrentPhase()?.phaseName ?? "unknown";
  } catch {
    /* headless apply */
  }
  if (
    runtime.controller.role !== "guest"
    || mystery == null
    || (coopMeInteractionStartValue() !== mystery.interactionCounter && phaseName !== "CoopReplayMePhase")
  ) {
    return null;
  }
  if (!preflightCoopAtomicSnapshot(runtime, snapshot)) {
    return false;
  }
  const rollback = captureCoopFullSnapshot();
  if (rollback == null) {
    coopWarn("resync", `${label} active-ME inline snapshot refused: no transactional rollback image`);
    return false;
  }
  let controlsCommitted = false;
  try {
    applyCoopFullSnapshot(snapshot, true, /* suppressResummon */ true);
    const healed = captureCoopChecksum();
    if (healed !== snapshot.checksum) {
      applyCoopFullSnapshot(rollback, true, /* suppressResummon */ true);
      coopWarn(
        "resync",
        `${label} active-ME inline snapshot did not converge host=${snapshot.checksum} guest=${healed}; holding exact waits`,
      );
      return false;
    }
    controlsCommitted = commitCoopSnapshotControls(runtime, snapshot);
    if (!controlsCommitted) {
      applyCoopFullSnapshot(rollback, true, /* suppressResummon */ true);
      coopWarn("resync", `${label} active-ME material state healed but control adoption failed`);
      return false;
    }
    try {
      onHealed?.();
    } catch (error) {
      coopWarn("resync", `${label} post-commit notification failed`, error);
    }
    coopLog("resync", `${label} atomically applied inline at retained Mystery wait`);
    return true;
  } catch (error) {
    if (controlsCommitted) {
      failCoopSharedSession(`${label} failed after atomic DATA+CONTROL commit`);
      return false;
    }
    try {
      applyCoopFullSnapshot(rollback, true, /* suppressResummon */ true);
    } catch {
      failCoopSharedSession(`${label} rollback failed`);
    }
    coopWarn("resync", `${label} active-ME inline snapshot apply failed`, error);
    return false;
  }
}

/** Queue one DATA+CONTROL snapshot for safe-boundary apply; ACK control only after checksum convergence. */
export function queueCoopAtomicSnapshotApply(
  runtime: CoopRuntime,
  snapshot: CoopFullBattleSnapshot,
  label: string,
  onHealed?: (() => void) | undefined,
): boolean {
  const snapshotId = `snapshot:e${snapshot.sessionEpoch ?? 0}:tick${snapshot.authoritativeState?.tick ?? snapshot.tick ?? 0}:${snapshot.checksum ?? "missing"}`;
  if (!preflightCoopAtomicSnapshot(runtime, snapshot)) {
    recordCoopCausalEvent({
      domain: "snapshot",
      stage: "refused",
      causalId: snapshotId,
      role: runtime.controller.role,
      epoch: snapshot.sessionEpoch,
      wave: snapshot.authoritativeState?.wave,
      turn: snapshot.authoritativeState?.turn,
      detail: label,
    });
    coopWarn(
      "resync",
      `${label} refused epoch=${snapshot.sessionEpoch ?? "legacy"}/${runtime.controller.sessionEpoch} `
        + `checksum=${snapshot.checksum ?? "missing"} membership=${snapshot.membership?.revision ?? "missing"} `
        + `control=${snapshot.activeControl?.version ?? "missing"}`,
    );
    return false;
  }
  const inlineMysteryApply = tryApplyCoopActiveMysterySnapshotInline(runtime, snapshot, label, onHealed);
  if (inlineMysteryApply != null) {
    return inlineMysteryApply;
  }
  const snapshotTurn = snapshot.authoritativeState?.turn ?? globalScene.currentBattle?.turn ?? 0;
  recordCoopCausalEvent({
    domain: "snapshot",
    stage: "apply-queued",
    causalId: snapshotId,
    role: runtime.controller.role,
    epoch: snapshot.sessionEpoch,
    wave: snapshot.authoritativeState?.wave,
    turn: snapshotTurn,
    detail: label,
  });
  globalScene.phaseManager.pushNew(
    "CoopApplyResyncPhase",
    snapshot,
    snapshotTurn,
    snapshot.checksum ?? "",
    undefined,
    healed => {
      if (!healed) {
        recordCoopCausalEvent({
          domain: "snapshot",
          stage: "materialization-failed",
          causalId: snapshotId,
          role: runtime.controller.role,
          epoch: snapshot.sessionEpoch,
          wave: snapshot.authoritativeState?.wave,
          turn: snapshotTurn,
          detail: label,
        });
        coopWarn("resync", `${label} did not converge -> control marks withheld`);
        return true;
      }
      if (!commitCoopSnapshotControls(runtime, snapshot)) {
        recordCoopCausalEvent({
          domain: "snapshot",
          stage: "control-adoption-failed",
          causalId: snapshotId,
          role: runtime.controller.role,
          epoch: snapshot.sessionEpoch,
          wave: snapshot.authoritativeState?.wave,
          turn: snapshotTurn,
          detail: label,
        });
        coopWarn("resync", `${label} material state healed but control adoption failed -> marks withheld`);
        return false;
      }
      try {
        onHealed?.();
      } catch (error) {
        coopWarn("resync", `${label} post-commit notification failed`, error);
      }
      recordCoopCausalEvent({
        domain: "snapshot",
        stage: "applied",
        causalId: snapshotId,
        role: runtime.controller.role,
        epoch: snapshot.sessionEpoch,
        wave: snapshot.authoritativeState?.wave,
        turn: snapshotTurn,
        detail: label,
      });
      coopLog("resync", `${label} atomically applied`);
      return true;
    },
  );
  return true;
}

/** Host-side deep-gap escalation: push a heavy snapshot stamped at the evicted class's journal head. */
function sendCoopDurabilitySnapshot(
  runtime: CoopRuntime,
  cls: string,
  headRevision: number,
  controlHighWater: Record<string, number>,
): void {
  if (runtime.controller.role !== "host") {
    return;
  }
  try {
    const snapshot = captureCoopFullSnapshot();
    if (snapshot == null) {
      coopWarn("resync", `durability snapshot unavailable cls=${cls} head=${headRevision}`);
      return;
    }
    const stamped = bindCoopSnapshotControl({
      ...snapshot,
      sessionEpoch: runtime.controller.sessionEpoch,
      checksum: captureCoopChecksum(),
      membership: runtime.membership.snapshot(),
      activeControl: captureCoopActiveControl(runtime),
      journalHighWater: {
        ...controlHighWater,
        [cls]: Math.max(controlHighWater[cls] ?? 0, headRevision),
      },
    } satisfies CoopFullBattleSnapshot);
    if (
      runtime.durability != null
      && !runtime.durability.retainSnapshotFrontier(stamped.controlDigest!, stamped.journalHighWater ?? {})
    ) {
      coopWarn("resync", `durability snapshot frontier refused cls=${cls} head=${headRevision}`);
      return;
    }
    runtime.battleStream.sendDurabilitySnapshot(compressToBase64(JSON.stringify(stamped)));
  } catch (e) {
    coopWarn("resync", `durability snapshot send failed cls=${cls} head=${headRevision}`, e);
  }
}

/** Guest-side deep-gap application: mutate live state, then ACK exactly the revisions it subsumed. */
function wireCoopDurabilitySnapshotReceiver(runtime: CoopRuntime): void {
  runtime.battleStream.onDurabilitySnapshot(blob => {
    if (runtime.controller.role !== "guest") {
      return;
    }
    try {
      const snapshot = JSON.parse(decompressFromBase64(blob)) as CoopFullBattleSnapshot;
      queueCoopAtomicSnapshotApply(runtime, snapshot, `durability deep-gap snapshot blob=${blob.length}b`);
    } catch (e) {
      coopWarn("resync", "durability deep-gap snapshot apply failed", e);
    }
  });
}

/**
 * Co-op enemy-party RE-REQUEST fallback. The stream itself replays a retained carrier before this
 * callback runs. Reaching this callback therefore means EncounterPhase has not published the complete
 * carrier yet, so the only safe response is to wait for that publication. Re-serializing the live party
 * here used to omit the encounter descriptor; that incomplete response could win the wave-2 race and
 * permanently strand the guest even though the later complete carrier arrived.
 */
function wireCoopEnemyPartyResponder(controller: CoopSessionController, battleStream: CoopBattleStreamer): void {
  battleStream.onEnemyPartyRequest(wave => {
    coopLog("stream", `recv requestEnemyParty wave=${wave} role=${controller.role}`);
    if (controller.role !== "host") {
      coopLog("stream", `ignore requestEnemyParty wave=${wave} (not host, role=${controller.role})`);
      return;
    }
    coopLog("stream", `requestEnemyParty wave=${wave} awaits complete EncounterPhase carrier (none retained yet)`);
  });
}

/**
 * Co-op authoritative WAVE-ADVANCE handshake (#633): a one-shot pending outcome the GUEST
 * has been told the host RESOLVED, plus the last wave it already advanced past (the
 * double-advance guard). The guest is a pure renderer - it removes KOd enemies WITHOUT a
 * FaintPhase / AttemptCapturePhase, so it never gets the victory tail those phases queue and
 * would loop the won wave forever. {@linkcode wireCoopWaveResolved} sets `pendingWaveAdvance`
 * on receipt; {@linkcode consumeCoopPendingWaveAdvance} hands it to the guest's
 * `CoopReplayTurnPhase` at the next SAFE turn boundary (NEVER mid-replay) so it runs the tail.
 */
interface CoopPendingWaveAdvance {
  wave: number;
  outcome: CoopWaveOutcome;
  captureParty?: string[] | undefined;
  capturePresentation?: CoopCapturePresentation | undefined;
  /** The host's complete control statement. Present on current peers and journal recovery. */
  transition?: CoopWaveAdvancePayload | undefined;
}

let pendingWaveAdvance: CoopPendingWaveAdvance | null = null;
/** Complete host statement currently driving the guest's VictoryPhase tail, wave-keyed against stale reuse. */
let activeGuestWaveTransition: CoopWaveAdvancePayload | null = null;
/** The last wave the guest already ran the victory tail for (guards a duplicate `waveResolved`). */
let lastResolvedWave = -1;

/**
 * Co-op WAVE-END authoritative capture (#838): the host's COMPLETE post-exp authoritative battle state
 * for a wave the GUEST has not yet applied, plus the last wave it already applied (the double-apply
 * guard). The host streams `waveEndState` from its `BattleEndPhase` (after the exp/level/evolution chain
 * drained); the guest stores it here ({@linkcode wireCoopWaveEndState}) and CONSUMES it in its OWN
 * `BattleEndPhase` ({@linkcode consumeCoopPendingWaveEndState}) via a single id-based full-state apply -
 * the sole post-battle progression channel (the legacy per-slot exp-delta relay it superseded is gone).
 */
let pendingWaveEndState: { wave: number; state: CoopAuthoritativeBattleStateV1 } | null = null;
/** The last wave the guest already applied a wave-end authoritative snapshot for. */
let lastWaveEndStateWave = -1;

/** Host transition staged by the early raw waveResolved hint and completed only after BattleEnd settles. */
const pendingHostWaveTransitions = new Map<number, CoopWaveAdvancePayload>();
/** Settled host transactions retained by wave, including a terminal victory that supersedes GameOver's echo. */
const settledHostWaveTransitions = new Map<number, CoopWaveAdvancePayload>();
/** Presentation-only data from a raw hint; never sufficient to advance a retained P33 session. */
const pendingRawWavePresentations = new Map<number, CoopCapturePresentation>();
/** A retained guest BattleEnd waiting for its exact immutable DATA image to apply. */
let pendingSettledWaveBoundary: { wave: number; release: () => void; released: boolean } | null = null;

function usesRetainedCoopWaveTransaction(): boolean {
  return (
    isCoopWaveAdvanceOperationEnabled()
    && isCoopCapabilityNegotiated(COOP_CAP_OP_WAVE)
    && isCoopOperationJournalActive()
  );
}

function releaseCoopSettledWaveBoundary(wave: number): boolean {
  const boundary = pendingSettledWaveBoundary;
  if (boundary == null || boundary.wave !== wave || boundary.released) {
    return true;
  }
  try {
    boundary.release();
    boundary.released = true;
    if (pendingSettledWaveBoundary === boundary) {
      pendingSettledWaveBoundary = null;
    }
    return true;
  } catch (error) {
    coopWarn("progression", `retained WAVE_ADVANCE BattleEnd release threw wave=${wave}; retrying`, error);
    return false;
  }
}

/**
 * GUEST: take + clear any pending host wave-end authoritative snapshot (#838). Returns the host's
 * complete post-exp battle state to apply, or null when none is pending or this wave was already
 * applied. Called by the guest's `BattleEndPhase`. Bumps the double-apply guard so a duplicate
 * `waveEndState` for the same wave is a no-op.
 */
export function consumeCoopPendingWaveEndState(): CoopAuthoritativeBattleStateV1 | null {
  const pending = pendingWaveEndState;
  pendingWaveEndState = null;
  if (pending == null || pending.wave <= lastWaveEndStateWave) {
    return null;
  }
  lastWaveEndStateWave = pending.wave;
  coopLog("runtime", `consume waveEndState wave=${pending.wave} tick=${pending.state.tick}`);
  return pending.state;
}

/** Apply a defensive copy of the staged DATA exactly once at a safe post-battle boundary. */
function tryApplyCoopSettledWaveData(wave: number): boolean {
  const staged = getCoopStagedWaveAdvanceTransaction(wave);
  if (staged == null) {
    return false;
  }
  if (staged.dataApplied) {
    return releaseCoopSettledWaveBoundary(wave);
  }
  if (globalScene.currentBattle?.waveIndex !== wave) {
    coopWarn(
      "progression",
      `retained WAVE_ADVANCE DATA refused outside source wave expected=${wave} actual=${globalScene.currentBattle?.waveIndex ?? -1}`,
    );
    return false;
  }
  const immutableState = structuredClone(staged.envelope.authoritativeState);
  let applied = applyCoopAuthoritativeBattleState(immutableState, true);
  // The state applier admits its monotonic tick before its final renderer work. If that latter work throws,
  // retry the exact already-admitted image through the established reassert seam instead of converting an
  // idempotent retry into a permanent stale-tick wait.
  if (!applied && coopAppliedStateTick() === immutableState.tick) {
    applied = reapplyAcceptedCoopAuthoritativeBattleState(immutableState, true);
  }
  if (!applied || !markCoopWaveAdvanceDataApplied(wave)) {
    coopWarn("progression", `retained WAVE_ADVANCE DATA apply rejected wave=${wave}`);
    failCoopSharedSession(`Could not apply the complete retained state for wave ${wave}.`);
    return false;
  }
  coopLog(
    "progression",
    `retained WAVE_ADVANCE DATA applied wave=${wave} tick=${staged.envelope.authoritativeState.tick}`,
  );
  return releaseCoopSettledWaveBoundary(wave);
}

/**
 * BattleEndPhase calls this before running any guest-local post-battle mutations. When retained P33 is
 * active, the phase is held until the exact embedded state applies; the host-settled snapshot already
 * contains those mutations, so the guest then releases the queued continuation without dual-running them.
 */
export function awaitCoopSettledWaveAdvanceAtBattleEnd(release: () => void): boolean {
  if (!isCoopAuthoritativeGuest() || !usesRetainedCoopWaveTransaction()) {
    return false;
  }
  // A Mystery battle is the continuation of an already-retained ME terminal transaction. Its BattleEnd
  // returns through PostMysteryEncounterPhase and must never wait for (or synthesize) a second, colliding
  // WAVE_ADVANCE transaction for the same pinned wave. The ME surface remains the sole owner of this tail.
  if (globalScene.currentBattle?.isBattleMysteryEncounter?.()) {
    return false;
  }
  const wave = globalScene.currentBattle?.waveIndex ?? -1;
  if (!Number.isSafeInteger(wave) || wave < 0) {
    failCoopSharedSession("The retained post-battle boundary had no valid source wave.");
    return true;
  }
  pendingSettledWaveBoundary = { wave, release, released: false };
  tryApplyCoopSettledWaveData(wave);
  return true;
}

function retainedWaveContinuationIsPublic(staged: CoopStagedWaveAdvanceTransaction): boolean {
  if (!staged.dataApplied) {
    return false;
  }
  const payload = staged.envelope.pendingOperation?.payload as CoopWaveAdvancePayload;
  const phaseName = globalScene.phaseManager?.getCurrentPhase()?.phaseName;
  if (
    payload.outcome === "gameOver"
    || ((payload.outcome === "win" || payload.outcome === "capture") && payload.nextWave === payload.wave)
  ) {
    return phaseName === "GameOverPhase";
  }
  if (phaseName === "BattleEndPhase") {
    return false; // DATA release is not itself a continuation; the phase must actually hand off first.
  }
  try {
    const mode = globalScene.ui.getMode();
    const handlerActive = globalScene.ui.getHandler()?.active === true;
    const surface = handlerActive ? coopAuthorityContinuationSurface(mode) : null;
    const currentWave = globalScene.currentBattle?.waveIndex ?? -1;
    const currentTurn = globalScene.currentBattle?.turn ?? -1;
    if (surface === "sharedInput") {
      return currentWave === payload.wave || currentWave === payload.nextWave;
    }
    if (surface === "command") {
      return currentWave === payload.nextWave && currentTurn === 1;
    }
    // ER map is deliberately absent from the mode-only registry; its phase ownership plus active handler
    // is the exact transition proof for a host-stated biome boundary.
    return payload.biomeChange && phaseName === "SelectBiomePhase" && handlerActive;
  } catch {
    return false;
  }
}

function maybeMarkCoopWaveContinuationReady(wave: number): boolean {
  const staged = getCoopStagedWaveAdvanceTransaction(wave);
  if (staged == null) {
    return false;
  }
  if (!staged.continuationReady && retainedWaveContinuationIsPublic(staged)) {
    markCoopWaveAdvanceContinuationReady(wave);
    coopLog("progression", `retained WAVE_ADVANCE continuationReady wave=${wave}`);
  }
  return isCoopWaveAdvanceTransactionComplete(wave);
}

/**
 * GUEST: take + clear any pending wave-advance the host signaled (#633). Returns the
 * outcome to run the victory tail for, or null when none is pending or this wave was
 * already advanced past. Called by `CoopReplayTurnPhase` at a safe boundary. Bumps the
 * double-advance guard so a duplicate `waveResolved` for the same wave is a no-op.
 */
/**
 * PEEK (non-consuming, #698 softlock): whether a wave-advance is pending for a wave the guest has NOT
 * yet advanced past. The guest's finalize uses this to take the TERMINAL path (run the victory tail,
 * do NOT advance the turn) even when the win is consumed in the SAME turn it arrives - otherwise the
 * minimal turn-advance starts a phantom next turn the host already passed (the guest then awaits a
 * turn-N+1 resolution the host - now in the reward shop - never sends -> softlock after the battle).
 */
export function coopHasPendingWaveAdvance(): boolean {
  return pendingWaveAdvance != null && pendingWaveAdvance.wave > lastResolvedWave;
}

export function consumeCoopPendingWaveAdvance(): {
  wave: number;
  outcome: CoopWaveOutcome;
  captureParty?: string[] | undefined;
  capturePresentation?: CoopCapturePresentation | undefined;
  transition?: CoopWaveAdvancePayload | undefined;
} | null {
  const pending = pendingWaveAdvance;
  pendingWaveAdvance = null;
  if (pending == null || pending.wave <= lastResolvedWave) {
    if (isCoopDebug() && pending != null) {
      coopLog("runtime", `consume wave-advance SKIP wave=${pending.wave} <= lastResolved=${lastResolvedWave}`);
    }
    return null;
  }
  // Game-over has no BattleEndPhase. This consume runs only at the replay finalizer's safe phase boundary,
  // so apply its retained DATA here and refuse to expose GameOverPhase until that succeeds.
  if (
    pending.outcome === "gameOver"
    && pending.transition?.settledStateTick !== undefined
    && !tryApplyCoopSettledWaveData(pending.wave)
  ) {
    pendingWaveAdvance = pending;
    return null;
  }
  coopLog(
    "runtime",
    `consume wave-advance wave=${pending.wave} outcome=${pending.outcome} transition=${pending.transition == null ? "legacy" : `${pending.transition.nextLogicalPhase}/next${pending.transition.nextWave}/biome${Number(pending.transition.biomeChange)}/egg${Number(pending.transition.eggLapse)}/${pending.transition.victoryKind ?? "-"}`} (lastResolved ${lastResolvedWave} -> ${pending.wave})`,
  );
  activeGuestWaveTransition = pending.transition ?? null;
  lastResolvedWave = pending.wave;
  return pending;
}

/** The host statement that must control this guest wave's concrete VictoryPhase queue. */
export function getCoopActiveWaveTransition(wave: number): CoopWaveAdvancePayload | null {
  return activeGuestWaveTransition?.wave === wave ? activeGuestWaveTransition : null;
}

/** Choose the authority's preserved transition; derive only for an additive-legacy carrier that omitted it. */
export function resolveCoopPendingWaveTransition(
  pending: Pick<CoopPendingWaveAdvance, "transition">,
  legacyDerive: () => CoopWaveAdvancePayload,
): CoopWaveAdvancePayload {
  return pending.transition ?? legacyDerive();
}

/**
 * GUEST (#633/#698/#696/#697 post-battle softlock): whether `wave`'s authoritative WAVE-ADVANCE has
 * ALREADY been consumed/run (`lastResolvedWave >= wave`) - i.e. a prior finalize already queued this
 * wave's victory/flee/game-over tail. In that state the wave has ENDED on the host, so the guest must
 * NOT loop back into a new battle turn for it: a `turnResolution` for that wave's FINAL (post-KO) turn
 * that the guest replays AFTER the tail was queued must be TERMINAL (render the events + apply the
 * checkpoint, both already done by the finalize) and must NOT queue the guest's turn-end phases (whose
 * trailing `TurnEndPhase` increments the turn and loops into a phantom next `CommandPhase` for a turn
 * the host already passed -> the guest broadcasts a command + `awaitTurn` for turn N+1 the host never
 * resolves -> the deadlock).
 *
 * Deliberately checks ONLY the ALREADY-RUN guard (`lastResolvedWave`), NOT a still-PENDING signal: an
 * EARLIER turn of the wave can finalize while a `waveResolved` is merely pending (it consumes + runs the
 * tail itself), and that earlier turn's turn-end loop is legitimately needed to reach the wave's FINAL
 * (KO) turn - suppressing it there would skip rendering the KO turn. Only once the tail has actually run
 * (the guard is bumped) is a further same-wave finalize a post-resolution phantom to suppress.
 *
 * Read-only (no mutation, never bumps the guard). Hard-gated by the caller to the authoritative guest,
 * so host / solo / lockstep never reach it. Pure on its `wave` argument.
 */
export function coopWaveAdvanceSignaledFor(wave: number): boolean {
  return wave <= lastResolvedWave;
}

/**
 * Merge an incoming `waveResolved` into the existing pending one (#633 B1 fix). The latest signal for
 * a NEW (>=) wave wins, BUT a `captureParty` is PRESERVED across a SAME-WAVE supersession: a co-op
 * DOUBLE wild battle resolves ONE wave with BOTH a `"capture"` (carrying the caught party) AND a
 * `"win"` (carrying none) - they arrive back-to-back, and before this the later message (whichever
 * order) clobbered the captured party, so the caught mon never reached the guest. This keeps whichever
 * message carried the party. Returns the pending to store, or `null` to KEEP the existing later-wave
 * pending unchanged (a stale earlier-wave signal). Pure - exported for unit testing.
 */
export function mergeCoopPendingWaveAdvance(
  prev: CoopPendingWaveAdvance | null,
  wave: number,
  outcome: CoopWaveOutcome,
  captureParty: string[] | undefined,
  capturePresentation?: CoopCapturePresentation | undefined,
  transition?: CoopWaveAdvancePayload | undefined,
): CoopPendingWaveAdvance | null {
  if (prev != null && wave < prev.wave) {
    return null; // a stale earlier-wave signal: keep the existing later-wave pending.
  }
  // Carry forward a captureParty from the same wave's other message (either arrival order).
  const carriedCapture = captureParty ?? (prev != null && prev.wave === wave ? prev.captureParty : undefined);
  // Carry the cosmetic capturePresentation across a same-wave supersession EXACTLY like captureParty,
  // so a "win" arriving after the "capture" in a double battle does not drop the ball animation (#689).
  const carriedPresentation =
    capturePresentation ?? (prev != null && prev.wave === wave ? prev.capturePresentation : undefined);
  // A same-wave retransmission of the SAME terminal may omit the additive statement and safely inherit it.
  // Never carry a statement across a changed outcome (capture -> win in doubles): that would pair a stale
  // control statement with a newer terminal. Current peers include a fresh statement on every signal.
  const receivedTransition =
    isValidCoopWaveAdvancePayload(transition) && transition.wave === wave && transition.outcome === outcome
      ? transition
      : undefined;
  const carriedTransition =
    receivedTransition
    ?? (prev != null && prev.wave === wave && prev.outcome === outcome ? prev.transition : undefined);
  return {
    wave,
    outcome,
    captureParty: carriedCapture,
    capturePresentation: carriedPresentation,
    ...(carriedTransition === undefined ? {} : { transition: carriedTransition }),
  };
}

/**
 * Co-op authoritative wave-advance responder (#633): the GUEST records the host's
 * `waveResolved` signal as a one-shot pending flag (guarded against a double-advance by
 * wave number). It is consumed at the next safe turn boundary by `CoopReplayTurnPhase`
 * (NOT applied here mid-message) so an in-flight replay turn finishes first. Gated on the
 * live GUEST role in the AUTHORITATIVE netcode; a host / solo / lockstep client ignores it.
 */
function wireCoopWaveResolved(controller: CoopSessionController, battleStream: CoopBattleStreamer): void {
  battleStream.onWaveResolved((wave, outcome, captureParty, capturePresentation, transition) => {
    coopLog(
      "runtime",
      `recv waveResolved wave=${wave} outcome=${outcome} role=${controller.role} netcode=${getCoopNetcodeMode()}`,
    );
    if (controller.role !== "guest" || getCoopNetcodeMode() !== "authoritative") {
      coopLog("runtime", `ignore waveResolved wave=${wave} (not authoritative guest)`);
      return;
    }
    if (usesRetainedCoopWaveTransaction()) {
      // P33: this raw arm is presentation/legacy compatibility only. In particular it can arrive before,
      // after, twice, or never; none of those orders may expose a continuation without the retained state.
      if (capturePresentation != null) {
        pendingRawWavePresentations.set(wave, capturePresentation);
        if (pendingWaveAdvance?.wave === wave) {
          pendingWaveAdvance.capturePresentation ??= capturePresentation;
        }
      }
      coopLog(
        "runtime",
        `ignore raw waveResolved for correctness wave=${wave} outcome=${outcome}; awaiting retained transaction`,
      );
      return;
    }
    if (
      isCoopWaveAdvanceOperationEnabled()
      && isCoopCapabilityNegotiated(COOP_CAP_OP_WAVE)
      && !isValidCoopWaveAdvancePayload(transition)
    ) {
      coopWarn(
        "runtime",
        `reject waveResolved wave=${wave} outcome=${outcome}: missing/malformed host transition; awaiting durable op`,
      );
      return;
    }
    // Already advanced past this wave (a duplicate signal) -> ignore.
    if (wave <= lastResolvedWave) {
      coopLog("runtime", `ignore waveResolved wave=${wave} <= lastResolved=${lastResolvedWave} (duplicate)`);
      return;
    }
    // Latest signal wins (a later wave supersedes an unconsumed earlier one), but a captureParty is
    // PRESERVED across a same-wave supersession (see mergeCoopPendingWaveAdvance).
    const merged = mergeCoopPendingWaveAdvance(
      pendingWaveAdvance,
      wave,
      outcome,
      captureParty,
      capturePresentation,
      transition,
    );
    if (merged == null) {
      coopWarn("runtime", `waveResolved wave=${wave} stale vs pending=${pendingWaveAdvance?.wave} -> kept pending`);
    } else {
      coopLog(
        "runtime",
        `pend waveResolved wave=${wave} outcome=${outcome} transition=${merged.transition == null ? "legacy" : `${merged.transition.nextLogicalPhase}/next${merged.transition.nextWave}/biome${Number(merged.transition.biomeChange)}/egg${Number(merged.transition.eggLapse)}/${merged.transition.victoryKind ?? "-"}`}${merged.captureParty == null ? "" : ` captureParty=${merged.captureParty.length}`} (prevPending=${pendingWaveAdvance?.wave ?? "none"})`,
      );
      pendingWaveAdvance = merged;
    }
  });
}

/**
 * Showdown 1v1 PvP (C6): route a RECEIVED `showdownResult` / `showdownVoid` to THIS client's
 * terminal result phase so BOTH clients show the same outcome. The pure-renderer guest never runs
 * VictoryPhase, so without this it would never learn the match ended; the host receives the guest's
 * void the same way. Silent (does NOT re-emit -> no ping-pong) and idempotent (skips when the result
 * phase is already running). Versus-only; a co-op peer never sends these `t` values.
 */
function wireShowdownResult(transport: CoopTransport, controller: CoopSessionController): void {
  transport.onMessage(msg => {
    if (msg.t !== "showdownResult" && msg.t !== "showdownVoid") {
      return;
    }
    try {
      if (globalScene.phaseManager.getCurrentPhase()?.phaseName === "ShowdownResultPhase") {
        return; // already ending on this client
      }
      // AFK-guest (#7): if the guest's command menu is still open when the match ends, force it back to
      // MESSAGE first - otherwise the command menu owns input and the just-unshifted ShowdownResultPhase
      // parks behind it (the guest never sees the result). Task F1: the guest now uses the NORMAL
      // player-side COMMAND menu (its own team is its local player party). Best-effort; guarded.
      if (globalScene.ui.getMode() === UiMode.COMMAND) {
        globalScene.ui.setMode(UiMode.MESSAGE);
      }
      if (msg.t === "showdownVoid") {
        globalScene.phaseManager.unshiftNew("ShowdownResultPhase", false, msg.reason, true, true);
      } else {
        // The received `winner` is a role; this client won iff it matches its own role.
        const localWon = msg.winner === controller.role;
        globalScene.phaseManager.unshiftNew("ShowdownResultPhase", localWon, msg.reason, false, true);
      }
    } catch {
      /* routing the received result must never crash the receiver */
    }
  });
}

/**
 * Co-op WAVE-END authoritative capture responder (#838): the GUEST records the host's `waveEndState`
 * (the complete post-exp battle state) as a one-shot pending payload (guarded against a double-apply by
 * wave number). It is consumed in the guest's own `BattleEndPhase` (NOT applied here mid-message) so it
 * lands at a real phase boundary, AFTER the guest's VictoryPhase tail queues BattleEnd. Gated on the
 * live GUEST role in the AUTHORITATIVE netcode; host / solo / lockstep ignore.
 */
function wireCoopWaveEndState(controller: CoopSessionController, battleStream: CoopBattleStreamer): void {
  battleStream.onWaveEndState((wave, state) => {
    if (controller.role !== "guest" || getCoopNetcodeMode() !== "authoritative") {
      return;
    }
    if (usesRetainedCoopWaveTransaction()) {
      coopLog("runtime", `ignore raw waveEndState for correctness wave=${wave} tick=${state.tick}`);
      return;
    }
    // Already applied past this wave (a duplicate signal) -> ignore.
    if (wave <= lastWaveEndStateWave) {
      return;
    }
    // Latest wave's snapshot wins (a later wave supersedes an unconsumed earlier one).
    if (pendingWaveEndState == null || wave >= pendingWaveEndState.wave) {
      coopLog("runtime", `pend waveEndState wave=${wave} tick=${state.tick}`);
      pendingWaveEndState = { wave, state };
    }
  });
}

/**
 * Co-op ME-state self-check (#633, TRACK-2 Phase C): the WATCHER verifies the owner's
 * full-state checksum at a mystery-encounter boundary against its OWN. The ME pump replays
 * the owner's button stream into the watcher's own ME state - safe ONLY if that state is
 * identical. On a MISMATCH the watcher requests the authoritative `stateSync` and adopts it,
 * turning the pump's silent "identical state" assumption into detect-and-heal (reusing the
 * Phase A machinery). Additive: on a match nothing changes, so the working pump is intact.
 */
function wireCoopMeChecksumCheck(battleStream: CoopBattleStreamer): void {
  battleStream.onMeChecksum((seq, ownerChecksum) => {
    const ours = captureCoopChecksum();
    if (ownerChecksum === COOP_CHECKSUM_SENTINEL || ours === COOP_CHECKSUM_SENTINEL || ownerChecksum === ours) {
      coopLog("checksum", `recv meChecksum seq=${seq} MATCH owner=${ownerChecksum} watcher=${ours}`);
      return;
    }
    coopWarn("checksum", `me-entry MISMATCH seq=${seq} owner=${ownerChecksum} watcher=${ours} -> requesting stateSync`);
    coopLog("resync", `await stateSync start seq=${seq}`);
    const gen = coopSessionGeneration(); // #808: die if the session ends before the reply
    void battleStream.requestStateSync(seq).then(blob => {
      if (gen !== coopSessionGeneration()) {
        coopWarn("resync", `stateSync reply seq=${seq} arrived AFTER session teardown -> dropped (#808)`);
        return;
      }
      if (blob == null) {
        coopWarn("resync", `await stateSync TIMEOUT/null seq=${seq}`);
        return;
      }
      coopLog("resync", `await stateSync resolve seq=${seq} blob=${blob.length}b -> applying`);
      try {
        // #839: this heal fires MID-DIVERT - the stateSync reply resolves while the guest is diverting
        // into (or parked in) CoopReplayMePhase for this same ME. Run it with `suppressResummon=true` so
        // it stays a SAFE, advisory best-effort heal: it applies only the cheap per-mon scalar +
        // module-let state writes and NEVER runs the heavy field COMPOSITION re-summon
        // (reconcileCoopEnemyField / reconcileCoopPlayerField + per-mon initBattleInfo), which would tear
        // down and rebuild the field sprites out from under the in-flight ME presentation. applyCoopFullSnapshot
        // touches no phase queue and never cancels a relay waiter, so the ME divert proceeds regardless of
        // whether this early heal converges - the AUTHORITATIVE convergence is the ME terminal's
        // comprehensive meResync (applyCoopMeOutcome), which the guest still adopts. The still-diverged
        // path below is advisory by design (#839): it must never disrupt the encounter.
        const snapshot = JSON.parse(decompressFromBase64(blob)) as CoopFullBattleSnapshot;
        const liveRuntime = getCoopRuntime();
        if (liveRuntime == null) {
          return;
        }
        // One central preflight enforces epoch, checksum/sentinel, membership, control digest, monotonic
        // interaction counter, and Mystery revision before DATA is touched. Active replay applies inline
        // transactionally; every other phase queues the same atomic apply at a safe boundary.
        queueCoopAtomicSnapshotApply(liveRuntime, snapshot, `me-entry seq=${seq} comprehensive snapshot`);
      } catch (e) {
        /* a malformed resync blob must never crash the ME flow */
        coopWarn("resync", `me-entry seq=${seq} malformed resync blob (ignored)`, e);
      }
    });
  });
}

/**
 * Co-op AUTHORITATIVE move-learn forward listener (#633 BUG3+5). Unsubscribe handle for the
 * persistent transport listener that spawns the guest's {@linkcode CoopReplayLearnMovePhase}. Stored
 * module-scoped so {@linkcode clearCoopRuntime} can drop it (and the in-flight slot set) on teardown.
 */
let offLearnMoveForward: (() => void) | null = null;
/** Slots with a learn-move picker already spawned this session (prevents a duplicate-message re-open). */
const learnMoveForwardInFlight = new Set<number>();
/** #848: the BATCH move-learn forward listener teardown + its in-flight slot set (mirrors the per-move pair). */
let offLearnMoveBatchForward: (() => void) | null = null;
const learnMoveBatchForwardInFlight = new Set<number>();

/**
 * Install the persistent AUTHORITATIVE-GUEST move-learn forward listener (#633 BUG3+5). Covers the
 * LEVEL-UP case where the guest runs NO {@linkcode LearnMovePhase} (its engine is parked in
 * CoopReplayTurnPhase): when the host streams a `learnMoveForward` interactionOutcome, the guest spawns
 * a single {@linkcode CoopReplayLearnMovePhase} to render the move-forget picker and relay the human's
 * index back on the disjoint `9_100_000 + partySlot` seq. It is the SOLE renderer (the guest's own
 * Shroom-queued LearnMovePhase no-ops in authoritative mode), so the picker opens EXACTLY once per learn.
 *
 * Gated hard on {@linkcode isCoopAuthoritativeGuest} (false for solo / host / lockstep), so it is a
 * dead no-op outside an authoritative-guest run. An in-flight slot guard ignores a duplicate message
 * for a slot whose picker is still open. Cleared in {@linkcode clearCoopRuntime}.
 */
/**
 * #787: the learn-move picker opener, INJECTED by coop-replay-learn-move-phase at module load
 * (the phase registry imports it at boot). Runtime -> phase would be an import cycle, hence the
 * indirection. When set, `learnMoveForward` opens the picker INLINE over the current screen -
 * a phase queued behind a parked watcher phase can never run (the live TM Case circular stall).
 */
/**
 * #789 (found by the duo exploration probe): advance the alternating interaction from OUTSIDE the
 * reward shop. A CONTINUATION-class reward (Ability Capsule, TM, Learner's Shroom) deliberately
 * skips the shop's own advance (the item's picker phase owns the rest of the interaction) - but the
 * COMMIT paths never advanced at all, so the rotation stalled on the same owner every wave. Each
 * side calls this locally when ITS copy of the item flow commits (owner + watcher run the same
 * flow), so the counters stay lockstep with no extra wire traffic. Mirrors the shop's own guards:
 * no-op outside co-op, inside a mystery encounter (the ME owns the single advance), or with no
 * controller. Safe to call more than once per seq: advanceInteraction(from) is from-pinned.
 */
export function advanceCoopInteractionForContinuation(fromSeq: number): void {
  try {
    if (!globalScene.gameMode?.isCoop || fromSeq < 0 || coopMeInProgress()) {
      coopLog(
        "reward",
        `advanceCoopInteractionForContinuation SKIP (isCoop=${globalScene.gameMode?.isCoop === true} fromSeq=${fromSeq} meInProgress=${coopMeInProgress()})`,
      );
      return;
    }
    const controller = getCoopController();
    if (controller == null) {
      return;
    }
    const before = controller.interactionCounter();
    controller.advanceInteraction(fromSeq);
    coopLog(
      "reward",
      `advance interaction from CONTINUATION commit (role=${controller.role} from=${fromSeq} counter ${before} -> ${controller.interactionCounter()})`,
    );
  } catch (e) {
    /* the advance must never break the item flow */
    coopWarn("reward", "advanceCoopInteractionForContinuation threw (handled)", e);
  }
}

let learnMovePickerOpener: ((partySlot: number, moveId: number, maxMoveCount: number) => void) | null = null;

export function setCoopLearnMovePickerOpener(
  opener: (partySlot: number, moveId: number, maxMoveCount: number) => void,
): void {
  learnMovePickerOpener = opener;
}

/**
 * #848: the BATCH move-learn panel opener, injected by coop-replay-learn-move-batch at module load
 * (the phase registry imports it at boot). Runtime -> phase would be an import cycle, hence the
 * indirection. When the guest receives a `learnMoveBatchForward` present it opens the shared batch
 * Move Learn panel INLINE over the current screen (owner-drives if the guest owns the mon, else a
 * read-only watcher that mirrors the host's cursor + closes on the relayed terminal).
 */
let learnMoveBatchPickerOpener: ((partySlot: number, learnableIds: number[], ownerIsGuest: boolean) => void) | null =
  null;

export function setCoopLearnMoveBatchPickerOpener(
  opener: (partySlot: number, learnableIds: number[], ownerIsGuest: boolean) => void,
): void {
  learnMoveBatchPickerOpener = opener;
}

/** Co-op (#848): clear a slot's in-flight batch Move Learn panel mark once its panel closes. */
export function clearCoopLearnMoveBatchInFlight(partySlot: number): void {
  learnMoveBatchForwardInFlight.delete(partySlot);
}

// =============================================================================
// #794 shared acquisition: the HOST (sole engine) streams its dex / starter blob right after
// any acquisition event (wild catch, DexNav grant, ME-granted mon, shiny-variant unlock bits
// ride caughtAttr) so the partner's ACCOUNT is credited immediately - previously the blob only
// flowed at ME terminals, so a run without MEs never shared catches. Throttled (bursts like
// mid-run egg hatches coalesce into one trailing send); the apply side is merge-only (union),
// so the partner can only GAIN entries - a stale blob can never remove anything.
// =============================================================================

let dexSyncPending: { relay: CoopInteractionRelay; blob: string } | null = null;
let dexSyncTimerArmed = false;
/** Injectable for tests: 0 = flush on the next macrotask. */
let dexSyncDelayMs = 500;
export function setCoopDexSyncDelayMs(ms: number): void {
  dexSyncDelayMs = ms;
}

/**
 * Call after ANY acquisition write (chokepoint: gameData.setPokemonCaught). Safe anywhere.
 * The blob AND the sending relay are bound AT CALL TIME (the timer callback runs under
 * whatever client context is active - binding late would capture/send via the wrong client
 * in multi-client processes like the duo harness). A burst overwrites the pending blob
 * (capture-after-write means the latest capture reflects every write), one trailing send.
 */
export function coopBroadcastDexSync(): void {
  try {
    if (getCoopRuntime() == null || !globalScene.gameMode?.isCoop || isCoopAuthoritativeGuest()) {
      return;
    }
    const relay = getCoopInteractionRelay();
    if (relay == null) {
      return;
    }
    dexSyncPending = { relay, blob: captureCoopDexDelta() };
    if (dexSyncTimerArmed) {
      return;
    }
    dexSyncTimerArmed = true;
    setTimeout(() => {
      dexSyncTimerArmed = false;
      const pending = dexSyncPending;
      dexSyncPending = null;
      if (pending == null) {
        return;
      }
      try {
        pending.relay.sendInteractionOutcome(COOP_DEX_SYNC_SEQ, "dexSync", { k: "dexSync", dex: pending.blob });
        coopLog("runtime", "dexSync broadcast (acquisition -> partner account credited)");
      } catch {
        coopWarn("runtime", "dexSync broadcast threw (handled - next ME terminal still converges)");
      }
    }, dexSyncDelayMs);
  } catch {
    /* an acquisition write must never fail because of the sync hook */
  }
}

let offDexSync: (() => void) | null = null;
let offDisconnectReaction: (() => void) | null = null;

/**
 * Partner-disconnect reaction (#799): the transport DETECTS channel death (onStateChange fires
 * "disconnected") but nothing reacted - a dead partner left the survivor parked in a live shop /
 * picker / lockstep wait for the FULL default timeout (20 minutes) with zero feedback. On channel
 * death: cancel THIS runtime's pending relay waits (every wait takes its timeout path IMMEDIATELY -
 * shop watchers leave, faint pickers auto-resolve, the lockstep gate proceeds) and tell the player.
 * The waits themselves stay long for LIVE partners (a human slowly browsing a market is legitimate);
 * only a genuinely dead channel short-circuits them. The resync/backstop layers are untouched.
 */
/** #806 keepalive/deadlock-detection thresholds (standard netcode watchdog numbers). */
const COOP_STALL_TICK_MS = 5_000;
const COOP_STALL_REPORT_MS = 10_000;
const COOP_STALL_TRIGGER_MS = 20_000;
const COOP_STALL_RECOVERY_COOLDOWN_MS = 30_000;
let offStallWatchdog: (() => void) | null = null;

/**
 * #806 STALL WATCHDOG (standard technique: keepalive heartbeat + wait-for-cycle deadlock
 * detection). Each client that has been parked in a NETWORK wait for 10s+ tells its peer via a
 * tiny `stallBeat`. When BOTH sides report 20s+ simultaneously, neither can produce the other's
 * awaited message - a proven two-node wait cycle. Recovery: cancel the local parked waits (all
 * existing timeout/AI fallbacks fire immediately) and, on the authoritative guest, pull a fresh
 * full snapshot. A human browsing a shop never triggers this: the browsing side is in UI, not a
 * network wait. Converts every current AND FUTURE mutual-wait bug from a softlock into a
 * seconds-long self-healed hiccup with a loud log marker.
 */
/** #diagnostics: format a transport's last-inbound-frame age as a compact `<n>s` / `-` health token. */
function formatLastRx(transport: CoopTransport): string {
  const ms = transport.lastRxMs?.();
  return ms == null ? "-" : `${Math.round(ms / 1000)}s`;
}

/** Scene-independent coordinates for diagnostics that also run in transport-only tests/teardown. */
function readCoopBattlePoint(): { wave: number; turn: number } {
  try {
    return {
      wave: globalScene.currentBattle?.waveIndex ?? 0,
      turn: globalScene.currentBattle?.turn ?? 0,
    };
  } catch {
    return { wave: 0, turn: 0 };
  }
}

/**
 * W2b (contract doc §4): compact durability tokens for the health line + control-plane block -
 * `journal=<depth>/<unacked>` (committed ops retained / committed-but-unacked) and `queue=<n>[!]`
 * (outbound frames held while the channel is dark; `!` = the queue overflowed + owes a resync). `-`
 * when durability is off / the transport has no queue accessor (loopback).
 */
export function formatCoopDurabilityHealth(runtime: CoopRuntime, transport: CoopTransport): string {
  const d = runtime.durability;
  const journal = d == null ? "-" : `${d.journalDepth()}/${d.unackedCount()}`;
  const depth = transport.outboundQueueDepth?.() ?? 0;
  const owes = transport.outboundQueueNeedsResync?.() ? "!" : "";
  return `journal=${journal} queue=${depth}${owes}`;
}

/** Exact 8M/9M channels owned by the currently pinned Mystery encounter. */
export function isCoopActiveMysteryWaitSeq(seq: number): boolean {
  const pinned = coopMeInteractionStartValue();
  return pinned >= 0 && (seq === COOP_ME_PUMP_SEQ_BASE + pinned || seq === COOP_ME_TERM_SEQ_BASE + pinned);
}

export function wireCoopStallWatchdog(
  transport: CoopTransport,
  relay: CoopInteractionRelay,
  battleStream: CoopBattleStreamer,
  runtime: CoopRuntime,
): void {
  let peerBeat: { ms: number; at: number } | null = null;
  let lastRecoveryAt = 0;
  let compatibilityWarned = false;
  let lastHealthAt = 0;
  const offMsg = transport.onMessage(msg => {
    if (msg.t === "stallBeat") {
      peerBeat = { ms: msg.waitingMs, at: Date.now() };
    }
  });
  const timer = setInterval(() => {
    try {
      const point = readCoopBattlePoint();
      // #807 C one-shot: a protocol-version mismatch means a stale cached bundle - tell BOTH
      // players plainly (the top source of unreproducible ghost bugs in live sessions).
      if (
        !compatibilityWarned
        && (runtime.controller.versionMismatch || runtime.controller.functionalFingerprintMismatch)
        && getCoopRuntime() === runtime
      ) {
        compatibilityWarned = true;
        try {
          globalScene.ui.showText(
            runtime.controller.versionMismatch
              ? "Version mismatch with your partner. Both players should hard refresh (Ctrl+F5) and reconnect."
              : "Game data mismatch with your partner. Shared play was blocked; both players should update and hard refresh.",
            null,
            undefined,
            6000,
          );
        } catch {
          /* cosmetic */
        }
      }
      const localMs = Math.max(relay.oldestNetworkWaitMs(), battleStream.oldestNetworkWaitMs());
      // #808 HEALTH LINE: one compact self-describing line every ~30s so every log capture
      // carries a session-health timeline for free (zero extra timers).
      if (Date.now() - lastHealthAt >= 30_000) {
        lastHealthAt = Date.now();
        coopLog(
          "health",
          `tick=${coopSessionGeneration()}g turn=${point.turn || "-"} wave=${point.wave || "-"} counter=${runtime.controller.interactionCounter?.() ?? "-"} assertions=${getCoopChecksumAssertionCount()} wait=${localMs}ms peerBeat=${peerBeat ? `${Math.round((Date.now() - peerBeat.at) / 1000)}s` : "-"} lastRx=${formatLastRx(transport)} transport=${transport.state} ${formatCoopDurabilityHealth(runtime, transport)}`,
        );
      }
      // #806 faint-replacement suppression: a live human choosing (or the host awaiting) a faint
      // replacement legitimately parks BOTH engines in network waits. Do NOT keepalive-report that as a
      // stall and do NOT deadlock-recover during it - the reward shop gets this exemption for free (its
      // owner is in UI); the faint window needs it explicit because both sides ARE in network waits. The
      // faint-switch wait's own timeout still fires, so a genuinely-dead partner is never masked.
      if (isCoopFaintSwitchWindowOpen()) {
        return;
      }
      if (localMs >= COOP_STALL_REPORT_MS) {
        transport.send({ t: "stallBeat", waitingMs: localMs });
      }
      const peerFresh = peerBeat != null && Date.now() - peerBeat.at < COOP_STALL_TICK_MS * 2.5;
      if (
        localMs >= COOP_STALL_TRIGGER_MS
        && peerFresh
        && (peerBeat?.ms ?? 0) >= COOP_STALL_TRIGGER_MS
        && Date.now() - lastRecoveryAt > COOP_STALL_RECOVERY_COOLDOWN_MS
      ) {
        lastRecoveryAt = Date.now();
        const recoveryId = `stall:e${runtime.controller.sessionEpoch ?? 0}:g${coopSessionGeneration()}:w${point.wave}:t${point.turn}`;
        recordCoopCausalEvent({
          domain: "recovery",
          stage: "stall-detected",
          causalId: recoveryId,
          ...(runtime.controller.role == null ? {} : { role: runtime.controller.role }),
          epoch: runtime.controller.sessionEpoch ?? 0,
          wave: point.wave,
          turn: point.turn,
          detail: `local=${localMs}ms peer=${peerBeat?.ms ?? 0}ms`,
        });
        coopWarn(
          "runtime",
          `STALL WATCHDOG: mutual network wait (local=${Math.round(localMs / 1000)}s peer=${Math.round((peerBeat?.ms ?? 0) / 1000)}s) -> recovering (cancel orphan waits; preserve active Mystery${isCoopAuthoritativeGuest() ? " + full resync" : ""})`,
        );
        if (getCoopRuntime() === runtime) {
          try {
            globalScene.ui.showText("Connection stall detected. Resynchronizing...", null, undefined, 3000);
          } catch {
            /* cosmetic */
          }
        }
        try {
          // RESYNC RESCUE: cancel the parked waits so their timeout/AI fallbacks fire immediately - but
          // SPARE a pending faint-replacement pick (COOP_FAINT_SWITCH_SEQ_BASE band). A stateSync snapshot
          // never invalidates a replacement the human is still choosing; dropping it would insta-AI-pick and
          // kill the real pick (the live "let my attack go through after the switch-in" jank). The pick's own
          // getCoopFaintSwitchWaitMs timeout still bounds it, and a genuine DISCONNECT still cancels the band
          // (wireCoopDisconnectReaction cancels unconditionally). Band-wide: protects co-op AND versus, which
          // share this seq band.
          // Active Mystery waits are exact durable control surfaces, not generic timeout fallbacks. Sticky-
          // cancelling 8M/9M manufactures null, and null is not a host terminal. Preserve both channels;
          // the verified snapshot below rebinds the retained replay phase and the journal replays a dropped
          // terminal. Only an exact host terminal may leave/advance the event.
          relay.cancelWaiters(seq => !isCoopFaintSwitchSeq(seq) && !isCoopActiveMysteryWaitSeq(seq));
        } catch {
          /* recovery must never throw */
        }
        if (isCoopAuthoritativeGuest()) {
          const seq = COOP_REJOIN_SYNC_SEQ_BASE + (Date.now() % 100_000);
          const gen = coopSessionGeneration(); // #808
          recordCoopCausalEvent({
            domain: "snapshot",
            stage: "requested",
            causalId: `${recoveryId}:snapshot:${seq}`,
            parentId: recoveryId,
            role: "guest",
            epoch: runtime.controller.sessionEpoch ?? 0,
            wave: globalScene.currentBattle?.waveIndex ?? 0,
            turn: globalScene.currentBattle?.turn ?? 0,
          });
          void battleStream.requestStateSync(seq).then(blob => {
            if (gen !== coopSessionGeneration()) {
              return;
            }
            if (blob == null) {
              recordCoopCausalEvent({
                domain: "snapshot",
                stage: "timed-out",
                causalId: `${recoveryId}:snapshot:${seq}`,
                parentId: recoveryId,
                role: "guest",
              });
              coopWarn("resync", `stall-recovery stateSync TIMEOUT/null seq=${seq}`);
              return;
            }
            try {
              const snapshot = JSON.parse(decompressFromBase64(blob)) as CoopFullBattleSnapshot;
              recordCoopCausalEvent({
                domain: "snapshot",
                stage: "queued",
                causalId: `${recoveryId}:snapshot:${seq}`,
                parentId: recoveryId,
                role: "guest",
                epoch: snapshot.sessionEpoch,
                wave: readCoopBattlePoint().wave,
                turn: readCoopBattlePoint().turn,
                detail: `${blob.length}b`,
              });
              queueCoopAtomicSnapshotApply(
                runtime,
                snapshot,
                `stall-recovery snapshot seq=${seq} blob=${blob.length}b`,
              );
            } catch {
              recordCoopCausalEvent({
                domain: "snapshot",
                stage: "parse-failed",
                causalId: `${recoveryId}:snapshot:${seq}`,
                parentId: recoveryId,
                role: "guest",
              });
              coopWarn("resync", `stall-recovery snapshot apply FAILED seq=${seq}`);
            }
          });
        }
      }
    } catch {
      /* the watchdog itself must never crash the game loop */
    }
  }, COOP_STALL_TICK_MS);
  offStallWatchdog = () => {
    clearInterval(timer);
    offMsg();
  };
}

/**
 * Showdown 1v1 (D4): the PARTNER (opponent) dropped and did NOT reconnect within the 2-minute grace.
 * Resolve the abandoned match via {@linkcode ShowdownLifecycle} (turn < threshold -> void
 * earlyDisconnect; at/above -> the local SURVIVOR wins by timeout) and route to the ephemeral
 * {@linkcode ShowdownResultPhase}. Best-effort + fully guarded so an abandonment can never crash the
 * loop. Only called from the REAL-peer rejoin-FAILURE path (a genuine WebRTC drop), never over the
 * loopback/spoof path - so it can't fire during the two-engine harness's transport teardown.
 *
 * Exported so the PRE-BATTLE disconnect path (a drop during the wager window: no currentBattle -> turn 0
 * -> the void branch) is directly testable without staging a live WebRTC drop.
 */
export function routeShowdownAbandon(runtime: CoopRuntime): void {
  try {
    // A drop before the battle boots (during negotiate / the wager window) left a pre-battle relay
    // pending with no live match to adopt it; dispose it here so its transport listener doesn't leak.
    disposePendingShowdownRelay();
    const droppedRole = otherRole(runtime.controller.role); // the partner (opponent) is the one that dropped
    const turn = globalScene.currentBattle?.turn ?? 0;
    const lifecycle = new ShowdownLifecycle();
    lifecycle.setTurn(turn);
    lifecycle.disconnect(droppedRole, 0);
    const outcome = lifecycle.resolveOnAbandon(droppedRole, COOP_DISCONNECT_GRACE_MS + 1);
    if (outcome == null) {
      return;
    }
    globalScene.phaseManager.clearPhaseQueue();
    if (outcome.kind === "void") {
      globalScene.phaseManager.unshiftNew("ShowdownResultPhase", false, outcome.reason, true, false);
    } else {
      const localWon = outcome.winner === runtime.controller.role;
      globalScene.phaseManager.unshiftNew("ShowdownResultPhase", localWon, outcome.reason, false, false);
    }
    // Advance out of the (now un-continuable) battle phase into the queued result.
    globalScene.phaseManager.getCurrentPhase()?.end();
  } catch {
    /* abandonment routing must never crash the game loop */
  }
}

export interface CoopSharedSessionFailureBoundary {
  boundary?: CoopSharedTerminalBoundary;
  reasonCode?: CoopSharedTerminalReasonCode;
  wave?: number;
  turn?: number;
  boundaryRevision?: number;
}

function terminalCoordinate(value: number | undefined, fallback: number): number {
  if (value !== undefined && Number.isSafeInteger(value) && value >= 0) {
    return value;
  }
  return Number.isSafeInteger(fallback) && fallback >= 0 ? fallback : 0;
}

function terminalReason(reason: string): string {
  const normalized = [...reason]
    .map(character => {
      const codePoint = character.codePointAt(0) ?? 0;
      return codePoint <= 0x1f || codePoint === 0x7f ? " " : character;
    })
    .join("")
    .trim()
    .slice(0, 512);
  return normalized || "Shared co-op control could not continue safely.";
}

interface CoopTerminalPhaseManagerBridge {
  freezeForCoopTerminal?: (() => void) | undefined;
  releaseCoopTerminalFreeze?: (() => void) | undefined;
  clearAllPhases?: (() => void) | undefined;
  clearPhaseQueue?: (() => void) | undefined;
}

/**
 * Production owns the explicit PhaseManager fence. Engine-free harnesses intentionally inject a narrow
 * scene stub, so retain the historical queue-clear fallback there instead of treating a missing optional
 * test surface as a failed terminal preparation.
 */
function freezeCoopTerminalPhaseProgression(): boolean {
  const phaseManager = globalScene.phaseManager as unknown as CoopTerminalPhaseManagerBridge;
  if (typeof phaseManager.freezeForCoopTerminal === "function") {
    phaseManager.freezeForCoopTerminal();
    return true;
  }
  if (typeof phaseManager.clearAllPhases === "function") {
    phaseManager.clearAllPhases();
    return true;
  }
  if (typeof phaseManager.clearPhaseQueue === "function") {
    phaseManager.clearPhaseQueue();
    return true;
  }
  return false;
}

function releaseCoopTerminalPhaseProgression(): void {
  const phaseManager = globalScene.phaseManager as unknown as CoopTerminalPhaseManagerBridge;
  phaseManager.releaseCoopTerminalFreeze?.();
}

/**
 * Synchronously fence every gameplay continuation while preserving the transport listener used by the
 * retained terminal handshake. The flag and battle-command fence are installed before any null waiter is
 * released; promise continuations therefore cannot infer permission to simulate a local fallback.
 */
function prepareCoopSharedTerminal(runtime: CoopRuntime, reason: string): boolean {
  const state = sharedTerminalState(runtime);
  if (state.frozen) {
    return true;
  }
  state.frozen = true;
  state.reason = reason;
  let prepared = true;
  try {
    runtime.membership.terminate();
  } catch (error) {
    prepared = false;
    coopWarn("runtime", "shared terminal could not freeze membership", error);
  }
  try {
    // Load-bearing ordering: freezeForTerminal marks the relay before resolving any retained request.
    runtime.battleSync.freezeForTerminal();
  } catch (error) {
    prepared = false;
    coopWarn("runtime", "shared terminal could not freeze battle commands", error);
  }
  try {
    runtime.interactionRelay.cancelWaiters(() => true);
    getShowdownRelay()?.cancelPending();
  } catch (error) {
    coopWarn("runtime", "shared terminal waiter release partially failed", error);
  }
  if (active === runtime) {
    try {
      // Keep the current phase parked even if a released async waiter calls Phase.end(): the manager's
      // terminal fence blocks shiftPhase/turnStart until exactly-once finalization releases it.
      if (!freezeCoopTerminalPhaseProgression()) {
        throw new Error("phase manager has no terminal-freeze or queue-clear surface");
      }
    } catch (error) {
      prepared = false;
      coopWarn("runtime", "shared terminal could not freeze phase progression", error);
    }
    try {
      globalScene.ui.showText(
        "The shared battle could not be synchronized safely. Both players are leaving shared play safely.",
        null,
        undefined,
        6000,
      );
    } catch {
      /* cosmetic */
    }
  }
  return prepared;
}

/** Exactly-once terminal UI/control-plane teardown after quorum or the supervisor's absolute deadline. */
function finalizeCoopSharedTerminal(runtime: CoopRuntime, endAuthenticatedRun: boolean): void {
  const state = sharedTerminalState(runtime);
  if (state.finalized) {
    return;
  }
  state.finalized = true;
  if (endAuthenticatedRun) {
    // `end()` marks signaling stopped synchronously before its network promise yields. Capture it before
    // clearCoopRuntime closes the data channel; duplicate terminal frames cannot call it again.
    try {
      void runtime.p33Signaling?.end().catch(error => {
        coopWarn("runtime", "shared terminal signaling end failed", error);
      });
    } catch (error) {
      coopWarn("runtime", "shared terminal signaling end threw", error);
    }
  }
  if (active !== runtime) {
    // Only the active production runtime owns the scene. A two-engine harness can retain another runtime
    // in-process; its own driver disposes that control plane after observing this terminal state.
    return;
  }
  try {
    releaseCoopTerminalPhaseProgression();
    const interruptedPhase = globalScene.phaseManager.getCurrentPhase();
    clearCoopRuntime();
    globalScene.reset();
    globalScene.phaseManager.unshiftNew("TitlePhase");
    if (globalScene.phaseManager.getCurrentPhase() === interruptedPhase) {
      interruptedPhase?.end();
    }
  } catch {
    // Engine-free relay tests and pre-scene failures still terminate the runtime/control plane.
    clearCoopRuntime();
  }
}

/**
 * Fail one shared run closed after bounded recovery could not converge. A bound P33 run retains and
 * retransmits one addressed terminal until the peer enters it or the absolute deadline expires. Only an
 * unbound/legacy session uses the immediate local fallback because it has no authenticated seat axes with
 * which to address an ACK quorum.
 */
function failCoopRuntimeSharedSession(
  runtime: CoopRuntime,
  reason: string,
  failure: CoopSharedSessionFailureBoundary = {},
): void {
  const safeReason = terminalReason(reason);
  coopWarn("runtime", `shared session terminal requested: ${safeReason}`);
  const supervisor = sharedTerminalSupervisors.get(runtime);
  if (supervisor == null || !hasBoundCoopSharedTerminal(runtime.controller)) {
    prepareCoopSharedTerminal(runtime, safeReason);
    finalizeCoopSharedTerminal(runtime, false);
    return;
  }
  const point = readCoopBattlePoint();
  let defaultRevision = 0;
  try {
    defaultRevision = runtime.controller.interactionCounter();
  } catch {
    /* retain zero */
  }
  const start: CoopSharedTerminalStart = {
    boundary: failure.boundary ?? "recovery",
    reasonCode: failure.reasonCode ?? "recovery-exhausted",
    reason: safeReason,
    wave: terminalCoordinate(failure.wave, point.wave),
    turn: terminalCoordinate(failure.turn, point.turn),
    boundaryRevision: terminalCoordinate(failure.boundaryRevision, defaultRevision),
  };
  const terminalStartFailed = (error: unknown): void => {
    // The binding was checked immediately above; rejection is an internal adapter failure. Preserve the
    // no-AI invariant and terminate locally rather than allowing a partially failed supervisor to resume.
    coopWarn("runtime", "bound shared terminal could not begin", error);
    prepareCoopSharedTerminal(runtime, safeReason);
    finalizeCoopSharedTerminal(runtime, true);
  };
  // begin() calls onPrepare synchronously before returning. A promise is retained only for completion;
  // repeated local failures return that same transaction instead of inventing another terminal ID. The
  // transport send inside begin can also throw synchronously if the channel closes between binding proof
  // and first send, so fence both synchronous and asynchronous failures.
  try {
    void supervisor.begin(start).catch(terminalStartFailed);
  } catch (error) {
    terminalStartFailed(error);
  }
}

export function failCoopSharedSession(reason: string, failure: CoopSharedSessionFailureBoundary = {}): void {
  const runtime = getCoopRuntime();
  if (runtime != null) {
    failCoopRuntimeSharedSession(runtime, reason, failure);
  }
}

function wireCoopDisconnectReaction(transport: CoopTransport, runtime: CoopRuntime): void {
  let rejoining = false;
  const terminateSharedSession = (recoveryId: string): void => {
    const point = readCoopBattlePoint();
    recordCoopCausalEvent({
      domain: "recovery",
      stage: "terminated",
      causalId: recoveryId,
      role: runtime.controller.role,
      epoch: runtime.controller.sessionEpoch,
      wave: point.wave,
      turn: point.turn,
    });
    failCoopRuntimeSharedSession(runtime, "Your partner did not reconnect before the recovery deadline.", {
      boundary: "disconnect",
      reasonCode: "peer-lost",
      wave: point.wave,
      turn: point.turn,
    });
  };
  offDisconnectReaction = transport.onStateChange(state => {
    if (state !== "disconnected" && state !== "closed") {
      return;
    }
    if (isCoopSharedTerminalFrozen(runtime)) {
      // The winning terminal keeps only its own retained listener alive. Closing the gameplay channel
      // during finalization must never launch a competing hot-rejoin recovery loop.
      return;
    }
    const recoveryId = `rejoin:e${runtime.controller.sessionEpoch}:g${coopSessionGeneration()}:c${transport.connectionGeneration?.() ?? 0}`;
    const point = readCoopBattlePoint();
    recordCoopCausalEvent({
      domain: "recovery",
      stage: "channel-lost",
      causalId: recoveryId,
      role: runtime.controller.role,
      epoch: runtime.controller.sessionEpoch,
      wave: point.wave,
      turn: point.turn,
      detail: transport.disconnectReason?.() ?? state,
    });
    coopWarn("runtime", `partner channel ${state} -> entering membership recovery (shared waits retained)`);
    runtime.membership.peerDisconnected();
    // Only the ACTIVE runtime owns the screen (the duo harness assembles two in one process).
    const isActiveRuntime = getCoopRuntime() === runtime;
    // #857: a PROTOCOL-VERSION mismatch (one player on a stale cached build) can never be healed by
    // re-dialing - the fresh channel would just drop again on the same incompatibility, producing the
    // endless redial FLAP. Surface a clear, persistent instruction instead and do NOT enter the loop.
    if (runtime.controller.versionMismatch || runtime.controller.functionalFingerprintMismatch) {
      coopWarn("runtime", "channel dropped with an incompatible peer -> NOT redial-looping");
      if (isActiveRuntime) {
        try {
          globalScene.ui.showText(
            "Incompatible game build with your partner - both players update your client (hard refresh, Ctrl+F5) and reconnect.",
            null,
            undefined,
            10000,
          );
        } catch {
          /* cosmetic */
        }
      }
      failCoopRuntimeSharedSession(runtime, "The authenticated peer binding no longer matches this game build.", {
        boundary: "protocol",
        reasonCode: "binding-mismatch",
        wave: point.wave,
        turn: point.turn,
      });
      return;
    }
    // #805 HOT REJOIN: re-dial the same pairing code within the grace window and swap the fresh
    // channel into the live transport - the whole session survives in place. One loop at a time.
    if (runtime.rejoinDriver != null && !rejoining) {
      rejoining = true;
      const recoveryGeneration = coopSessionGeneration();
      recordCoopCausalEvent({
        domain: "recovery",
        stage: "redial-started",
        causalId: recoveryId,
        role: runtime.controller.role,
        epoch: runtime.controller.sessionEpoch,
      });
      if (isActiveRuntime) {
        try {
          // #857: carry the DROP REASON (the raw channel error, e.g. the SCTP abort text) into the
          // banner so a live capture shows WHY the channel died instead of a bare "connection lost".
          const reason = transport.disconnectReason?.();
          const banner = reason
            ? `Connection lost (${reason}). Trying to reconnect (up to 2 minutes)...`
            : "Connection lost. Trying to reconnect (up to 2 minutes)...";
          globalScene.ui.showText(banner, null, undefined, 4000);
        } catch {
          /* cosmetic */
        }
      }
      void runtime
        .rejoinDriver()
        .then(ok => {
          rejoining = false;
          if (recoveryGeneration !== coopSessionGeneration() || getCoopRuntime() !== runtime) {
            return;
          }
          if (!ok) {
            recordCoopCausalEvent({
              domain: "recovery",
              stage: "redial-failed",
              causalId: recoveryId,
              role: runtime.controller.role,
              epoch: runtime.controller.sessionEpoch,
            });
            coopWarn("runtime", "rejoin FAILED (grace expired) -> terminating shared session");
            // Showdown 1v1 (D4): a versus opponent that never reconnected ends the match - void (early)
            // or a survivor win (mid-match), routed to the ephemeral result. Ordinary co-op terminates
            // the shared session below because no authoritative membership-removal handoff exists yet.
            if (isActiveRuntime && isVersusSession()) {
              routeShowdownAbandon(runtime);
              return;
            }
            terminateSharedSession(recoveryId);
            return;
          }
          recordCoopCausalEvent({
            domain: "recovery",
            stage: "redial-succeeded",
            causalId: recoveryId,
            role: runtime.controller.role,
            epoch: runtime.controller.sessionEpoch,
            detail: `connectionGeneration=${transport.connectionGeneration?.() ?? 0}`,
          });
          coopLog("runtime", "rejoin SUCCESS -> channel re-established in place");
          runtime.membership.reconnected(transport.connectionGeneration?.());
          // B7 item 14b: the transport survived (replaceChannel), so the showdown pre-battle listeners
          // are still bound - but the frames sent while the channel was dark are LOST. In a versus session
          // fire every registered rejoin re-sender so the negotiation session + wager handler re-ship
          // their team/ready/offer/lock/arrival idempotently and a stranded pre-battle handshake completes.
          if (isActiveRuntime && isVersusSession()) {
            coopLog("runtime", "rejoin: firing showdown pre-battle re-senders (versus)");
            fireShowdownRejoinResend();
          }
          if (isActiveRuntime) {
            try {
              globalScene.ui.showText("Partner reconnected!", null, undefined, 3000);
            } catch {
              /* cosmetic */
            }
          }
          // Reconnect the durability state machine on BOTH roles. The host proactively resends every
          // committed/unacked tail; the guest requests every missing class. Active relay/rendezvous/battle
          // waiters stay alive and their own connected handlers reissue the exact pending surface.
          try {
            runtime.durability?.reconnect();
          } catch {
            /* the atomic full snapshot below is the guest's deep fallback */
          }
          // The GUEST missed DATA while dark: pull the host's full authoritative snapshot. A hot rejoin
          // keeps the SAME epoch and live surface, so do not purge its current arrivals/waiters; the WebRTC
          // transport's connection generation already rejects delayed frames from the superseded channel.
          if (runtime.controller.role === "guest") {
            // Same epoch: pre-drop operation ids stay valid and de-dupe. The atomic full snapshot is the
            // DATA backstop after retained surface waits and the durability control tail resume.
            const seq = COOP_REJOIN_SYNC_SEQ_BASE + (Date.now() % 100_000);
            coopLog("resync", `post-rejoin full resync request seq=${seq}`);
            const gen = coopSessionGeneration(); // #808
            const snapshotId = `${recoveryId}:snapshot:${seq}`;
            recordCoopCausalEvent({
              domain: "snapshot",
              stage: "requested",
              causalId: snapshotId,
              parentId: recoveryId,
              role: "guest",
              epoch: runtime.controller.sessionEpoch,
              wave: globalScene.currentBattle?.waveIndex ?? 0,
              turn: globalScene.currentBattle?.turn ?? 0,
            });
            void runtime.battleStream.requestStateSync(seq).then(blob => {
              if (gen !== coopSessionGeneration()) {
                return;
              }
              if (blob == null) {
                recordCoopCausalEvent({
                  domain: "snapshot",
                  stage: "timed-out",
                  causalId: snapshotId,
                  parentId: recoveryId,
                  role: "guest",
                });
                coopWarn("resync", `post-rejoin stateSync TIMEOUT/null seq=${seq} (checksum backstop heals next turn)`);
                return;
              }
              try {
                const snapshot = JSON.parse(decompressFromBase64(blob)) as CoopFullBattleSnapshot;
                recordCoopCausalEvent({
                  domain: "snapshot",
                  stage: "queued",
                  causalId: snapshotId,
                  parentId: recoveryId,
                  role: "guest",
                  epoch: snapshot.sessionEpoch,
                  wave: globalScene.currentBattle?.waveIndex ?? 0,
                  turn: globalScene.currentBattle?.turn ?? 0,
                  detail: `${blob.length}b`,
                });
                queueCoopAtomicSnapshotApply(runtime, snapshot, `post-rejoin snapshot seq=${seq} blob=${blob.length}b`);
              } catch {
                recordCoopCausalEvent({
                  domain: "snapshot",
                  stage: "parse-failed",
                  causalId: snapshotId,
                  parentId: recoveryId,
                  role: "guest",
                });
                coopWarn("resync", `post-rejoin snapshot apply FAILED seq=${seq} (checksum backstop heals next turn)`);
              }
            });
          }
        })
        .catch(() => {
          rejoining = false;
          if (recoveryGeneration !== coopSessionGeneration() || getCoopRuntime() !== runtime) {
            return;
          }
          if (isActiveRuntime && isVersusSession()) {
            routeShowdownAbandon(runtime);
            return;
          }
          terminateSharedSession(recoveryId);
        });
      return;
    }
    // Loopback/dev transports have no redial driver. They still fail closed: release their waits so tests
    // and local sessions do not strand, but never claim the binary shared run continued as a solo run.
    recordCoopCausalEvent({
      domain: "recovery",
      stage: "terminated-no-redial",
      causalId: recoveryId,
      role: runtime.controller.role,
      epoch: runtime.controller.sessionEpoch,
    });
    failCoopRuntimeSharedSession(runtime, "Your partner disconnected and no authenticated rejoin path is available.", {
      boundary: "disconnect",
      reasonCode: "peer-lost",
      wave: point.wave,
      turn: point.turn,
    });
  });
}

// #805 rejoin-resync seq band (#840: declared in coop-seq-registry, imported above).
function wireCoopDexSync(transport: CoopTransport): void {
  offDexSync = transport.onMessage(msg => {
    if (msg.t !== "interactionOutcome" || msg.outcome.k !== "dexSync") {
      return;
    }
    if (!isCoopAuthoritativeGuest()) {
      return;
    }
    coopLog("runtime", "recv dexSync -> merging partner acquisition credit onto local account");
    applyCoopDexDelta(msg.outcome.dex);
  });
}

function wireCoopLearnMoveForward(relay: CoopInteractionRelay): void {
  relay.onLearnMoveForward = outcome => {
    if (!isCoopAuthoritativeGuest()) {
      return;
    }
    const { partySlot, moveId, maxMoveCount } = outcome;
    if (learnMoveForwardInFlight.has(partySlot)) {
      coopLog("learnmove", `recv learnMoveForward slot=${partySlot} IGNORE (picker already in-flight)`);
      return;
    }
    coopLog(
      "learnmove",
      `recv learnMoveForward slot=${partySlot} moveId=${moveId} maxMoveCount=${maxMoveCount} -> open picker ${
        learnMovePickerOpener == null ? "via CoopReplayLearnMovePhase" : "INLINE"
      }`,
    );
    learnMoveForwardInFlight.add(partySlot);
    try {
      if (learnMovePickerOpener == null) {
        globalScene.phaseManager.unshiftNew("CoopReplayLearnMovePhase", partySlot, moveId, maxMoveCount);
      } else {
        // #787: INLINE over the current screen - immune to a parked phase queue (the TM Case
        // circular stall: the queued phase sat behind the shop watcher the host could not end
        // while awaiting this very pick).
        learnMovePickerOpener(partySlot, moveId, maxMoveCount);
      }
    } catch (e) {
      // A spawn failure must never hang the run: the host's own await times out to "keep current
      // moves". Drop the in-flight mark so a retry/resend can re-spawn.
      learnMoveForwardInFlight.delete(partySlot);
      coopWarn("learnmove", `learn-move picker open failed slot=${partySlot} (host await falls back)`, e);
    }
  };
  offLearnMoveForward = () => {
    relay.onLearnMoveForward = null;
  };
}

/** Co-op (#633 BUG3+5): clear a slot's in-flight learn-move picker mark once its phase ends. */
export function clearCoopLearnMoveForwardInFlight(partySlot: number): void {
  learnMoveForwardInFlight.delete(partySlot);
}

/**
 * Install the persistent AUTHORITATIVE-GUEST BATCH move-learn forward listener (#848). The ER batch
 * Move Learn panel is now the SHARED co-op level-up path: when the host's {@linkcode LearnMoveBatchPhase}
 * opens the panel it streams a `learnMoveBatchForward` present so the guest opens the SAME panel INLINE
 * (owner-drives if the guest owns the mon, else a read-only watcher). Gated hard on
 * {@linkcode isCoopAuthoritativeGuest} (a dead no-op for solo / host / lockstep). An in-flight slot guard
 * ignores a duplicate present for a slot whose panel is still open. Cleared in {@linkcode clearCoopRuntime}.
 */
function wireCoopLearnMoveBatchForward(relay: CoopInteractionRelay): void {
  relay.onLearnMoveBatchForward = outcome => {
    if (!isCoopAuthoritativeGuest()) {
      return;
    }
    const { partySlot, learnableIds, ownerIsGuest } = outcome;
    if (learnMoveBatchForwardInFlight.has(partySlot)) {
      coopLog("learnmove", `recv learnMoveBatchForward slot=${partySlot} IGNORE (panel already in-flight)`);
      return;
    }
    if (learnMoveBatchPickerOpener == null) {
      coopWarn(
        "learnmove",
        `recv learnMoveBatchForward slot=${partySlot} but no batch opener injected; host await falls back`,
      );
      return;
    }
    coopLog(
      "learnmove",
      `recv learnMoveBatchForward slot=${partySlot} learnable=${learnableIds.length} ownerIsGuest=${ownerIsGuest} -> open batch panel INLINE`,
    );
    learnMoveBatchForwardInFlight.add(partySlot);
    try {
      learnMoveBatchPickerOpener(partySlot, learnableIds, ownerIsGuest);
    } catch (e) {
      // A panel-open failure must never hang the run: the host's own await times out to "keep current
      // moves". Drop the in-flight mark so a retry/resend can re-open.
      learnMoveBatchForwardInFlight.delete(partySlot);
      coopWarn("learnmove", `batch panel open failed slot=${partySlot} (host await falls back)`, e);
    }
  };
  offLearnMoveBatchForward = () => {
    relay.onLearnMoveBatchForward = null;
  };
}

/**
 * Co-op (#843 soak TEARDOWN probe): whether the AUTHORITATIVE-guest learn-move-forward in-flight slot set
 * is EMPTY. It is a process-global {@linkcode learnMoveForwardInFlight} with no other read point, so the
 * soak's teardown invariant could not verify {@linkcode clearCoopRuntime} drained it (it calls
 * `learnMoveForwardInFlight.clear()` internally). This READ-ONLY getter closes that gap: after
 * clearCoopRuntime the soak asserts it returns true, so a leaked learn-move picker pin is detected instead
 * of silently surviving into the next run. Pure read, no mutation.
 */
export function isCoopLearnMoveForwardInFlightEmpty(): boolean {
  return learnMoveForwardInFlight.size === 0 && learnMoveBatchForwardInFlight.size === 0;
}

/**
 * Co-op (#835): mark a slot's move-forget picker as already in-flight from the GUEST side BEFORE the
 * host's `learnMoveForward` for that slot is processed, so {@linkcode wireCoopLearnMoveForward} sees the
 * guard SET and short-circuits its duplicate listener open. Used when the guest's OWN authoritative
 * {@linkcode LearnMovePhase} (queued by a shop-continuation TM / Shroom on a guest-owned FULL-moveset
 * mon) renders the picker itself as a queue-protected phase - it is the sole renderer, so the detached
 * listener overlay must NOT also open. The wire is ORDERED (the reward-pick relay that queues + runs the
 * guest LMP arrives before the host's `learnMoveForward`), so this mark is set synchronously first.
 * Returns whether the slot was newly marked (false = a picker for this slot was already in-flight).
 */
export function markCoopLearnMoveForwardInFlight(partySlot: number): boolean {
  if (learnMoveForwardInFlight.has(partySlot)) {
    return false;
  }
  learnMoveForwardInFlight.add(partySlot);
  return true;
}

/** Everything tied to one live co-op session. */
export interface CoopRuntime {
  /** The local player's session brain (host authority in the spoof/dev path). */
  controller: CoopSessionController;
  /** Revisioned two-seat membership and connection-generation state. */
  membership: CoopMembershipController;
  /** Relays the partner's in-battle command over the transport (#633, LIVE-C). */
  battleSync: CoopBattleSync;
  /** Host-authoritative battle stream: host->guest enemy party + per-turn checkpoints (#633, LIVE-D). */
  battleStream: CoopBattleStreamer;
  /** Owner->watcher relay for alternating reward/shop/ME interactions (#633). */
  interactionRelay: CoopInteractionRelay;
  /** Owner->watcher COSMETIC live-cursor mirror for shared interaction screens (#633). */
  uiMirror: CoopUiMirror;
  /** Owner->watcher AUTHORITATIVE input pump for whole mystery-encounter lockstep (#633). */
  mePump: CoopMePump;
  /** Reciprocal two-sided rendezvous barriers at pacing sync points (#839). */
  rendezvous: CoopRendezvous;
  /** The local client's transport endpoint. */
  localTransport: CoopTransport;
  /** The spoofed partner's transport endpoint (local dev only; absent for real peers). */
  partnerTransport?: CoopTransport;
  /** The stand-in player 2 (local dev only). */
  spoof?: SpoofGuest;
  /**
   * Showdown 1v1 (D0): the vs-CPU stand-in OPPONENT (local dev only; versus session kind). Speaks the
   * showdown wire (negotiate + friendly wager + enemy-command relay) so the friendly flow plays solo.
   */
  showdownSpoof?: ShowdownSpoof;
  /**
   * #805 hot rejoin: re-dials the SAME pairing code/role and swaps the fresh channel into the
   * LIVE transport (set by the real-peer connect entrypoints; absent over loopback/spoof).
   * Resolves true when the channel is re-established within the grace window.
   */
  rejoinDriver?: () => Promise<boolean>;
  /** Authenticated P33 signaling lifecycle. `end` is called only by the shared terminal supervisor. */
  p33Signaling?: {
    heartbeat: () => Promise<void>;
    leave: () => Promise<void>;
    end: () => Promise<void>;
    dispose: () => void;
  };
  /**
   * W2b APPLICATION-LEVEL DURABILITY (contract doc §4): the journal + ACK/resend + reconnect-from-revision
   * engine. Present when {@linkcode isCoopDurabilityEnabled} at assembly (flag-gated, §5). A passive
   * scaffold until Wave-2a's envelope commit path calls into it (`commit`/`extractKey`), but its
   * `reconnect()` is already wired into the #805 rejoin path and its depth/unacked feed the health line +
   * control-plane block. Disposed with the runtime.
   */
  durability?: CoopDurabilityManager | undefined;
  /**
   * PER-RUNTIME authoritative-operation state (the guest/host cursors, the shared revision clocks, and each
   * op-surface's per-client apply record). In production one runtime per process makes this identical to the
   * former module globals; in the two-engine harness it gives each client its own cursor so the surfaces no
   * longer bleed appliedIds/clock across the two in-process engines. Constructed at assembly
   * ({@linkcode createCoopRuntimeOpState}); installed as the active op-state by {@linkcode setCoopRuntime}.
   */
  opState: CoopRuntimeOpState;
}

let active: CoopRuntime | null = null;

interface CoopRuntimeSharedTerminalState {
  frozen: boolean;
  finalized: boolean;
  reason: string | null;
}

/** Runtime-owned P33 terminal supervisors and their synchronous gameplay fences. */
const sharedTerminalSupervisors = new WeakMap<CoopRuntime, CoopSharedTerminalSupervisor>();
const sharedTerminalStates = new WeakMap<CoopRuntime, CoopRuntimeSharedTerminalState>();

function sharedTerminalState(runtime: CoopRuntime): CoopRuntimeSharedTerminalState {
  let state = sharedTerminalStates.get(runtime);
  if (state == null) {
    state = { frozen: false, finalized: false, reason: null };
    sharedTerminalStates.set(runtime, state);
  }
  return state;
}

/** Whether this exact runtime has synchronously entered a shared terminal boundary. */
export function isCoopSharedTerminalFrozen(runtime: CoopRuntime | null = active): boolean {
  return runtime != null && sharedTerminalStates.get(runtime)?.frozen === true;
}

/** Read-only retained terminal commit for causal diagnostics and integration tests. */
export function getCoopSharedTerminalSupervisor(
  runtime: CoopRuntime | null = active,
): CoopSharedTerminalSupervisor | null {
  return runtime == null ? null : (sharedTerminalSupervisors.get(runtime) ?? null);
}

/**
 * #808 SESSION GENERATION (same pattern as the transport's wire generation): bumped when a
 * session is TORN DOWN. Async continuations capture it at scheduling and no-op if it moved -
 * a late resync/share/rejoin continuation can never mutate a scene the session left behind.
 * Deliberately NOT bumped by setCoopRuntime (the duo harness re-registers per context swap).
 */
let sessionGeneration = 0;
export function coopSessionGeneration(): number {
  return sessionGeneration;
}

/** Register the live co-op session (called when a co-op run is being set up). */
export function setCoopRuntime(runtime: CoopRuntime): void {
  active = runtime;
  // Wave-2e: point the operation journal at THIS runtime's durability manager. Load-bearing in the duo
  // harness, where two runtimes coexist in-process and `withClient` swaps the active one per pumped client -
  // the migrated adapters' commit path must journal into the ACTIVE client's manager, not a stale global.
  setCoopOperationDurability(runtime.durability ?? null);
  // Layer-B: install THIS runtime's per-surface op-state as the active one, so the migrated surfaces read
  // the pumped client's own cursors/clock (never the other engine's) across a `withClient` swap.
  setActiveCoopRuntimeOpState(runtime.opState);
  // Install the cycle-free authoritative-guest predicate (#633 B6) so `field/pokemon.ts` can gate the
  // Shedinja party-add without importing this module (which would close a value-level import cycle).
  setCoopAuthoritativeGuestPredicate(isCoopAuthoritativeGuest);
  // Install the cycle-free showdown-guest-flip predicate (C5) so the render layer (pokemon.ts /
  // battle-info panels) can consult the versus-guest perspective flip without importing this module.
  setShowdownGuestFlipPredicate(isShowdownGuestFlip);
}

/** The live co-op session, or null when not in a co-op run. */
export function getCoopRuntime(): CoopRuntime | null {
  return active;
}

/** Convenience: the live session controller, or null when not in a co-op run. */
export function getCoopController(): CoopSessionController | null {
  return active?.controller ?? null;
}

/**
 * W2b (contract doc §4): the co-op CONTROL-PLANE snapshot persisted into `SessionSaveData`. Carries the
 * interaction counter (so a COLD resume keeps alternating-owner parity + revision ordering CONTINUOUS
 * instead of resetting to base 0 - a resume from an odd counter no longer flips ownership) and the
 * durability journal high-water marks (so committed-op revisions continue monotonically across the save
 * boundary). Optional on the save; absent for every solo / pre-W2b save (fully backward-compatible).
 */
export interface CoopControlPlaneSaveData {
  /** The alternating-owner interaction counter at save time (§1.8). */
  interactionCounter: number;
  /** Per-class committed-op high-water marks at save time (§4.1); `{}` when nothing was committed. */
  journalHighWater: Record<string, number>;
}

/**
 * W2b: capture the live co-op control-plane snapshot for `getSessionSaveData()`, or `undefined` when there
 * is no live co-op run (so a solo save carries no field). Additive + guarded - never throws into the save.
 */
export function getCoopControlPlaneSaveData(): CoopControlPlaneSaveData | undefined {
  const runtime = active;
  if (runtime == null) {
    return;
  }
  try {
    return {
      // Wave-2e: the UNION of the committer's journal high-water and the receiver's applied marks, so the
      // host (committer) and guest (receiver) serialize the SAME converged value - a plain highWaterMarks()
      // is populated only on the host, so the saveDataDigest would diverge the moment it commits an op.
      interactionCounter: runtime.controller.interactionCounter(),
      journalHighWater: runtime.durability?.controlPlaneHighWater() ?? {},
    };
  } catch {
    return; // the control-plane snapshot must never break the save path
  }
}

/**
 * W2b: restore a persisted control-plane snapshot onto the live co-op runtime on a COLD resume (§4). Tolerant
 * of an absent field (older/solo save -> no-op, the prior base-0 behavior). A HOT rejoin never calls this
 * (the runtime + its live counter survive in place - Step 0 validated).
 */
export function applyCoopControlPlaneSaveData(data: CoopControlPlaneSaveData | undefined): void {
  if (data == null) {
    return;
  }
  const runtime = active;
  if (runtime == null) {
    return;
  }
  try {
    runtime.controller.restoreInteractionCounter(data.interactionCounter);
    // Wave-2e: restore the converged marks into BOTH the committer high-water AND the receiver applied
    // ledger, so a resumed guest neither re-applies an already-applied op nor diverges from the host on the
    // post-resume digest (both peers restore the identical value, §4.6).
    const marks = data.journalHighWater ?? {};
    const legacyGlobalFloor = Object.entries(marks)
      .filter(([cls]) => cls.startsWith("op:") && cls !== "op:global")
      .reduce((sum, [, revision]) => sum + (Number.isSafeInteger(revision) && revision > 0 ? revision : 0), 0);
    const globalFloor = marks["op:global"] ?? legacyGlobalFloor;
    setCoopGlobalOperationRevisionFloor(runtime.controller.sessionEpoch, globalFloor);
    const normalizedMarks = globalFloor > 0 ? { ...marks, "op:global": globalFloor } : marks;
    runtime.durability?.restore(normalizedMarks, normalizedMarks);
    // W2e-R P0-3: the durability RECEIVER ledger is restored to N above, but each surface's producer host is
    // recreated at revision 0 - so without this it would emit revision 1 and the restored receiver would drop
    // it as a stale duplicate (isDuplicate: 1 <= N). Floor each surface's producer + guests to its persisted
    // per-class high-water so the committed-op revision stream continues MONOTONICALLY at N+1 across the resume
    // (the epoch is unchanged, so the restored receiver marks stay valid; §1.4/§4.6 monotonic-continue contract).
    setCoopBiomeOperationRevisionFloor(marks["op:biome"] ?? 0);
    setCoopAbilityOperationRevisionFloor(marks["op:ability"] ?? 0);
    setCoopBargainOperationRevisionFloor(marks["op:bargain"] ?? 0);
    setCoopCatchFullOperationRevisionFloor(marks["op:catchFull"] ?? 0);
    setCoopColosseumOperationRevisionFloor(marks["op:colosseum"] ?? 0);
    setCoopFaintSwitchOperationRevisionFloor(marks["op:faintSwitch"] ?? 0);
    setCoopLearnMoveOperationRevisionFloor(marks["op:learnMove"] ?? 0);
    setCoopRevivalOperationRevisionFloor(marks["op:revival"] ?? 0);
    setCoopStormglassOperationRevisionFloor(marks["op:stormglass"] ?? 0);
    setCoopRewardOperationRevisionFloor(marks["op:reward"] ?? 0);
    setCoopMeOperationRevisionFloor(marks["op:me"] ?? 0);
    // Wave-2f KEYSTONE (W2e-R P0-3): floor the wave-advance producer + guest so a resumed run continues the
    // committed-op revision stream at N+1 and the restored receiver ledger accepts it.
    setCoopWaveAdvanceOperationRevisionFloor(marks["op:wave"] ?? 0);
  } catch {
    /* control-plane restore is best-effort; a resume must never hard-fail on it */
  }
}

/**
 * The active co-op netcode (#633, M6c: authoritative-ONLY), or `"lockstep"` when there is no
 * live session. Co-op has exactly one netcode since M3: a LIVE session is ALWAYS authoritative
 * (the guest renders, the host resolves), unconditionally - the old selectable toggle, the
 * controller's netcodeMode consultation, and the transient-read LATCH are all retired. The
 * "lockstep" return survives ONLY as the no-session sentinel every solo gate keys off
 * (`=== "authoritative"` is false -> solo is byte-for-byte unaffected). Deliberately does NOT
 * touch globalScene - it is a pure runtime read so the engine-free unit tests can call it.
 */
export function getCoopNetcodeMode(): CoopNetcodeMode {
  return active == null ? "lockstep" : "authoritative";
}

/**
 * Showdown 1v1 PvP (C1): the active session kind, or `"coop"` when there is no live session.
 * `"versus"` is a 1v1 showdown match on the co-op substrate. Deliberately does NOT touch
 * globalScene - a pure runtime read so the engine-free unit tests can call it.
 */
export function getCoopSessionKind(): CoopSessionKind {
  return active?.controller.sessionKind ?? "coop";
}

/**
 * Showdown 1v1 PvP (C1): whether THIS client is in a live 1v1 VERSUS (showdown) session.
 * Hard `false` for solo / classic co-op, so those paths are byte-for-byte unaffected.
 *
 * TWO VIEWS OF "SHOWDOWN", and when each is authoritative (predicate-alignment note, #6):
 *   - NETCODE view - `controller.sessionKind === "versus"` ({@linkcode isVersusSession}). The session
 *     role/kind is negotiated over the wire (host pins it, guest adopts it off `runConfig`); this is
 *     the source of truth for "am I in a VERSUS match" and distinguishes versus from classic co-op.
 *   - ENGINE view - `globalScene.gameMode.isShowdown` (consumed by {@linkcode isAuthoritativeBattleSession},
 *     which is `authoritative && (isCoop || isShowdown)`). This is the scene-side mode flag; it groups
 *     versus WITH co-op as "authoritative battle" so the SHARED host/guest battle seams (turn divert,
 *     state stream, enemy-command short-circuit) treat both alike.
 * For a live versus match BOTH are set (the mode is constructed SHOWDOWN and the runConfig kind is
 * "versus"), so they agree. The SHARED seams key off the ENGINE view (co-op + versus); the VERSUS-ONLY
 * seams (e.g. the host awaiting a relayed HUMAN enemy command, which a co-op host must NOT do - its
 * enemy is AI) key off the NETCODE view. Rule of thumb: reach for `isAuthoritativeBattleSession` when
 * the behavior is shared with co-op, and `isVersusSession` when it is versus-specific.
 */
export function isVersusSession(): boolean {
  return active != null && active.controller.isVersusSession();
}

/**
 * Whether THIS client is the GUEST of a live AUTHORITATIVE co-op session (#633). The single read
 * point for the "guest renders, host is authoritative" gates that must NOT mutate shared
 * host-owned state (e.g. the shared money pool). Hard `false` for solo / lockstep / the host, so
 * those paths are byte-for-byte unaffected. Netcode-only (does NOT read `gameMode`), so it is
 * ALSO true for a showdown-versus guest (versus rides the SAME authoritative substrate).
 */
export function isCoopAuthoritativeGuest(): boolean {
  return active != null && getCoopNetcodeMode() === "authoritative" && active.controller.role === "guest";
}

/**
 * Showdown 1v1 PvP (C3-C6): the SINGLE centralized predicate for the CORE-BATTLE authoritative
 * seams (turn-start divert / turn-end stream / command relay / engine capture+apply / enemy
 * command / victory routing). True when a live AUTHORITATIVE runtime exists AND the mode is a
 * co-op-STYLE battle (classic co-op OR 1v1 showdown-versus). This is what lets showdown ride the
 * co-op full-state stream/replay stack WITHOUT re-implementing it: co-op keeps
 * `gameMode.isCoop`, versus adds `gameMode.isShowdown`, both authoritative.
 *
 * Purely ADDITIVE for the existing seams: a classic co-op run is never `isShowdown` and solo has
 * no active runtime (so this is false) -> solo / co-op are byte-for-byte unaffected. Reads
 * `globalScene`, so it is an ENGINE-side predicate (unlike {@linkcode getCoopNetcodeMode}); the
 * `?? false` guards the rare pre-scene call. The ONLY sites converted to this are the ~dozen core-
 * battle gates - the shop / ME / biome / egg `.isCoop` sites stay co-op-only (do-not-drag-in).
 */
export function isAuthoritativeBattleSession(): boolean {
  if (active == null || getCoopNetcodeMode() !== "authoritative") {
    return false;
  }
  const mode = globalScene?.gameMode;
  return (mode?.isCoop ?? false) || (mode?.isShowdown ?? false);
}

/**
 * Showdown 1v1 PvP (C5): whether THIS client is the versus GUEST, i.e. whether the PRESENTATION
 * perspective flip is active. The guest's own team is authoritatively the ENEMY side (host-ordered);
 * the flip is a RENDER-ONLY side swap so the guest sees its team on the bottom. HARD `false` for
 * solo / co-op / the host (classic co-op guests share ONE player-side team and must NOT flip - this
 * is narrower than {@linkcode isCoopAuthoritativeGuest}, which is true for co-op guests too), so
 * every render site wrapped with this collapses to identity and is byte-for-byte unchanged off the
 * versus-guest path. Read-only at render; NEVER used to mutate authoritative order/state.
 */
export function isShowdownGuestFlip(): boolean {
  // Task F1 (2026-07-08): the DATA-LEVEL side swap. The failed presentation-level flip (~30 scattered
  // render gates with construction-vs-live sampling hazards) is REMOVED; the world is now re-oriented
  // ONCE at the guest's authoritative-ingress boundary (`showdown-side-swap.ts`), so the guest's own
  // team IS its local PLAYER party and all rendering is correct by construction. This predicate now
  // gates the DATA mappers (ingress side swap + egress checksum un-swap) plus the one legitimate
  // guest-only presentation choice left - the C7 opponent-trainer re-skin. HARD `false` for solo /
  // co-op / host (narrower than isCoopAuthoritativeGuest, which is true for co-op guests too).
  return isVersusSession() && getCoopController()?.role === "guest";
}

/** Convenience: the live battle-command relay, or null when not in a co-op run. */
export function getCoopBattleSync(): CoopBattleSync | null {
  return active?.battleSync ?? null;
}

/** Convenience: the host-authoritative battle stream, or null when not in a co-op run. */
export function getCoopBattleStreamer(): CoopBattleStreamer | null {
  return active?.battleStream ?? null;
}

/** Convenience: the alternating-interaction relay, or null when not in a co-op run. */
export function getCoopInteractionRelay(): CoopInteractionRelay | null {
  return active?.interactionRelay ?? null;
}

/** Convenience: the live-cursor UI mirror, or null when not in a co-op run. */
export function getCoopUiMirror(): CoopUiMirror | null {
  return active?.uiMirror ?? null;
}

/** Convenience: the mystery-encounter input pump, or null when not in a co-op run. */
export function getCoopMePump(): CoopMePump | null {
  return active?.mePump ?? null;
}

/** Convenience: the reciprocal rendezvous barriers (#839), or null when not in a co-op run. */
export function getCoopRendezvous(): CoopRendezvous | null {
  return active?.rendezvous ?? null;
}

/**
 * #861 SESSION-BOUNDARY PURGE: drop every BUFFERED relay + rendezvous arrival on the LIVE runtime without
 * tearing it down, so a prior session/epoch's stale buffered message can never satisfy a NEW epoch's await.
 * Call at every boundary where the SAME runtime is carried across a session/epoch change: a resume boot /
 * launch adopt onto a live runtime ({@linkcode GameData.applyCoopLaunchSession}) and a hot-rejoin
 * full-resync. A no-op outside a live session. `clearCoopRuntime` needs no call - its `dispose()` already
 * drops everything as the runtime is torn down.
 */
export function purgeCoopBufferedArrivals(reason: string): void {
  active?.interactionRelay.purgeBufferedArrivals(reason);
  active?.rendezvous.purgeBufferedArrivals(reason);
}

/** Whether a co-op session is currently active. */
export function isCoopRuntimeActive(): boolean {
  return active != null;
}

/**
 * N-ready field-slot ownership, engine adapter (#633, M5): resolve the owner of PLAYER field
 * slot `fieldIndex` from the mon actually in it ({@linkcode coopOwnerOfFieldSlot} reads the
 * persistent `coopOwner` tag; empty / untagged slots fall back to the fixed 2-player slot map).
 * `getPlayerField()` is index-aligned with field slots (the party's first `playerCapacity`
 * entries, unfiltered), so this is the single place engine code turns a slot into its owner -
 * every command / switch routing gate keys off it instead of assuming the launch layout.
 */
export function coopOwnerOfPlayerFieldSlot(fieldIndex: number): CoopRole {
  return coopOwnerOfFieldSlot(globalScene.getPlayerField(), fieldIndex);
}

/**
 * The PLAYER field slot the LOCAL client owns (#633, M5): the first slot whose resolved owner is
 * the local role. Falls back to the fixed 2-player slot map ({@linkcode coopFieldIndexOf}) when no
 * tagged slot matches (empty field / launch edge), so 2-player behavior is unchanged. In the
 * 2-player double each player owns exactly one slot, so "first" is exact.
 */
export function coopLocalOwnedPlayerFieldSlot(): number {
  const role = active?.controller.role ?? "guest";
  const field = globalScene.getPlayerField();
  for (let i = 0; i < field.length; i++) {
    if (field[i]?.coopOwner === role) {
      return i;
    }
  }
  return coopFieldIndexOf(role);
}

/**
 * Broadcast the LOCAL human's RESOLVED own-slot FIGHT command to the partner (#633).
 * Shared by {@linkcode CommandPhase} (moves with no target prompt) and
 * {@linkcode SelectTargetPhase} (the deferred broadcast once the human has actually
 * picked the target), so the partner applies the EXACT chosen target instead of
 * re-resolving a multi-candidate single-target move on a mon it does not control.
 *
 * Hard no-op unless we are in a live co-op run AND `fieldIndex` is the local player's
 * OWN slot (the partner slot is the one we AWAIT, never broadcast) - so the solo path
 * and the partner-slot path are byte-for-byte unaffected.
 */
export function broadcastCoopOwnSlotCommand(fieldIndex: number, command: SerializedCommand): void {
  if (!globalScene.gameMode.isCoop || active == null) {
    return;
  }
  const owner = coopOwnerOfPlayerFieldSlot(fieldIndex);
  if (owner !== active.controller.role) {
    if (isCoopDebug()) {
      coopLog("owner", `broadcast SKIP fi=${fieldIndex} owner=${owner} != role=${active.controller.role} (await slot)`);
    }
    return;
  }
  if (isCoopDebug()) {
    coopLog(
      "owner",
      `broadcast own-slot fi=${fieldIndex} turn=${globalScene.currentBattle.turn} role=${active.controller.role} cmd=${command.command}`,
    );
  }
  // Target-prompt moves commit here (SelectTargetPhase), not through CommandPhase's direct
  // broadcast helper. Keep the SAME full command address on both adapters: omitting it here made
  // the real UI emit a legacy command while the host awaited an epoch/wave/Pokemon-addressed
  // request. The low-level relay tests stayed green because they called broadcastLocalCommand
  // directly with an address, but every human-picked single-target move parked forever.
  active.battleSync.broadcastLocalCommand(fieldIndex, globalScene.currentBattle.turn, command, owner, {
    epoch: active.controller.sessionEpoch,
    wave: globalScene.currentBattle.waveIndex,
    pokemonId: globalScene.getPlayerField()[fieldIndex].id,
  });
  // #record-replay: capture the deferred-target FIGHT own-slot command (no-op unless recording).
  recordCoopOwnSlotCommand(fieldIndex, command);
}

// =============================================================================
// REPLAY RECORDER co-op enable + taps (#record-replay, Phase 2). The recorder is mode-agnostic + a
// PASSIVE OBSERVER (every record* is no-op unless recording); the ENABLE decision (begin on the
// authoritative HOST of a co-op run) + the wave/command mapping live HERE in the co-op layer, where
// globalScene is available. ZERO behavior change: these only read state + push to the recorder's
// ring buffer, never mutate the engine.
// =============================================================================

/**
 * BEGIN replay recording for THIS co-op run if not already recording (#record-replay). Gated to the
 * authoritative HOST (the sole engine that sees both slots' resolved commands + every committed
 * interaction). Idempotent (the recorder no-ops a same-seed re-call), so it is safe to call once per
 * EncounterPhase. Captures the header: seed + gameMode + the serialized merged roster + the CoopRunConfig
 * + a live-wave provider for interaction pruning. Hard no-op off the live co-op host. Best-effort.
 */
export function maybeBeginReplayRecording(): void {
  // Enable on the authoritative HOST of a CO-OP run OR a SHOWDOWN 1v1 (D5 telemetry: showdown is
  // deterministic - seed + both rosters + the ordered both-side commands replay it 1:1). Both ride the
  // same coop runtime + host role; the guest never records (its taps stay no-ops). Co-op is byte-identical
  // (its branch is unchanged); showdown is purely additive.
  if (
    (!globalScene.gameMode.isCoop && !globalScene.gameMode.isShowdown)
    || active == null
    || active.controller.role !== "host"
  ) {
    return;
  }
  if (isReplayRecording()) {
    return; // already recording this run (idempotent)
  }
  beginReplayRecording({
    seed: globalScene.seed,
    gameModeId: globalScene.gameMode.modeId,
    // The HOST's player-side party as serialized PokemonData (co-op: the merged party with coopOwner tags;
    // showdown: the host's own team). The enemy side (showdown opponent) is captured in the telemetry
    // payload's guestTeam manifest + the recorded enemy-command events - see the showdown replay follow-up.
    roster: globalScene.getPlayerParty().map(p => new PokemonData(p)),
    coopRunConfig: active.controller.runConfig() ?? undefined,
    currentWave: () => globalScene.currentBattle?.waveIndex ?? 0,
  });
}

/** Map a {@linkcode SerializedCommand} (the wire command) to a replay {@linkcode ReplayCommandKind}. */
function serializedCommandToReplayKind(command: SerializedCommand): ReplayCommandKind {
  switch (command.command) {
    case Command.BALL:
      return { kind: "ball", ballIndex: command.cursor };
    case Command.RUN:
      return { kind: "run" };
    case Command.POKEMON:
      return { kind: "switch", partyIndex: command.cursor };
    default:
      // FIGHT / TERA: cursor is the move slot; the first resolved target (if any).
      return command.targets != null && command.targets.length > 0
        ? { kind: "move", moveIndex: command.cursor, target: command.targets[0] }
        : { kind: "move", moveIndex: command.cursor };
  }
}

/**
 * RECORD one OWN-slot resolved command (#record-replay). Called from every own-slot broadcast site (the
 * one chokepoint set: the FIGHT/no-target + BALL/RUN/POKEMON paths in command-phase, and the deferred-
 * target FIGHT via {@linkcode broadcastCoopOwnSlotCommand}). No-op unless recording (host only). Reads the
 * live wave; shallow-copies the kept fields so it never aliases the sent command object.
 */
export function recordCoopOwnSlotCommand(fieldIndex: number, command: SerializedCommand): void {
  if (!isReplayRecording()) {
    return;
  }
  recordReplayCommand({
    type: "command",
    wave: globalScene.currentBattle?.waveIndex ?? 0,
    turn: globalScene.currentBattle?.turn ?? 0,
    slotFieldIndex: fieldIndex,
    command: serializedCommandToReplayKind(command),
  });
}

/**
 * RECORD the PARTNER-slot resolved command (#record-replay) - the command the HOST actually committed for
 * the awaited partner slot, whether RELAYED from the guest or the AI fallback (a null guest reply still
 * produces a real RNG-derived command that is part of the authoritative run). Read off the resolved
 * {@linkcode SerializedCommand}; no-op unless recording. Shallow.
 */
export function recordCoopPartnerSlotCommand(fieldIndex: number, command: SerializedCommand): void {
  if (!isReplayRecording()) {
    return;
  }
  recordReplayCommand({
    type: "command",
    wave: globalScene.currentBattle?.waveIndex ?? 0,
    turn: globalScene.currentBattle?.turn ?? 0,
    slotFieldIndex: fieldIndex,
    command: serializedCommandToReplayKind(command),
  });
}

/**
 * HOST -> GUEST (#633, authoritative wave-advance handshake): tell the guest the host
 * RESOLVED the current wave's battle end (`outcome` = why). The guest - a pure renderer that
 * removes KOd enemies WITHOUT a FaintPhase - runs the matching post-battle tail so it reaches
 * the next wave instead of looping the won wave forever (the HANG). Carries the current
 * `currentBattle.waveIndex`. Hard no-op unless we are in a live AUTHORITATIVE co-op run as the
 * HOST, so solo / non-host / lockstep play is byte-for-byte unaffected. Best-effort + guarded.
 */
/**
 * HOST: build the host-STATED complete wave-advance transition for the Wave-2f keystone operation
 * (§2.5 item 4). The host reads the fields off its own resolving battle state: the victory kind (the
 * battleType verdict, already host-authoritative per #867), the next logical phase (WAVE_VICTORY /
 * WAVE_FLEE / GAME_OVER, so the envelope makes logicalPhase host-authoritative), the biome-change (the
 * #863/#864 boundary), and the egg-lapse boundary. The guest ADOPTS this and constructs its tail FROM it
 * instead of deriving from the one-bit outcome. Pure over globalScene at the wave-end call site.
 */
export function buildCoopWaveAdvancePayload(outcome: CoopWaveOutcome, wave: number): CoopWaveAdvancePayload {
  const isVictory = outcome === "win" || outcome === "capture";
  const nextLogicalPhase = outcome === "gameOver" ? "GAME_OVER" : isVictory ? "WAVE_VICTORY" : "WAVE_FLEE";
  // DEFENSIVE scene reads (the guest finalize path maybeRunCoopWaveAdvance must NEVER throw building the
  // control statement - a missing / minimal scene must yield safe defaults so the outcome-driven tail STILL
  // builds). A biome boundary = random-biome mode or the engine says the next wave enters a new biome; an
  // egg-lapse fires on a non-final victory advance; the victory kind is the #867 host-authoritative battleType.
  let biomeChange = false;
  // Missing/minimal scene fallback preserves the historical non-terminal win path; a real game mode below
  // supplies the authoritative final-wave verdict.
  let victoryContinues = isVictory;
  let victoryKind: "wild" | "trainer" = "wild";
  try {
    const gameMode = globalScene.gameMode;
    victoryContinues = isVictory && ((gameMode?.isEndless ?? false) || !gameMode.isWaveFinal(wave));
    if (outcome === "flee" || victoryContinues) {
      biomeChange = resolveCoopBiomeBoundaryFlag(gameMode?.hasRandomBiomes, globalScene.isNewBiome());
    }
    victoryKind = globalScene.currentBattle.battleType === BattleType.TRAINER ? "trainer" : "wild";
  } catch {
    // minimal / stub scene: keep the safe defaults; the outcome-driven tail is unaffected.
  }
  const advancesWave = outcome === "flee" || victoryContinues;
  const payload: CoopWaveAdvancePayload = {
    wave,
    outcome,
    nextLogicalPhase,
    nextWave: advancesWave ? wave + 1 : wave,
    biomeChange,
    eggLapse: victoryContinues,
    meBoundary: "none", // an ME-spawned battle victory routes its OWN tail (queueCoopMeBattleVictoryTail).
  };
  return isVictory ? { ...payload, victoryKind } : payload;
}

export function broadcastCoopWaveResolved(outcome: CoopWaveOutcome, presentation?: CoopCapturePresentation): void {
  if (!globalScene.gameMode.isCoop || active == null || getCoopNetcodeMode() !== "authoritative") {
    return;
  }
  if (active.controller.role !== "host") {
    return;
  }
  const wave = globalScene.currentBattle.waveIndex;
  const alreadySettled = settledHostWaveTransitions.get(wave);
  if (alreadySettled != null) {
    if (outcome === "gameOver" && alreadySettled.nextWave === wave) {
      coopLog(
        "runtime",
        `suppress redundant gameOver WAVE_ADVANCE wave=${wave}; terminal ${alreadySettled.outcome} already retained`,
      );
      return;
    }
    failCoopSharedSession(`A second conflicting authoritative transition was raised for settled wave ${wave}.`);
    return;
  }
  const transition = buildCoopWaveAdvancePayload(outcome, wave);
  pendingHostWaveTransitions.set(wave, transition);
  // Normal win/capture/flee transitions settle later in BattleEnd. GameOver has no BattleEndPhase, so seal
  // its terminal DATA first; a throwing/dropped raw presentation carrier cannot suppress correctness.
  if (outcome === "gameOver") {
    commitCoopSettledWaveAdvance(wave, transition);
  }
  try {
    // Co-op (#633 B1/B2/B3): a CAPTURE grows/edits the host's party (the caught mon, and a party-full
    // release) that the guest's pure-renderer tail never reproduces. Carry the full post-catch party
    // so the guest can reconcile its bench + credit the catch. Other outcomes carry nothing (no-op).
    const captureParty = outcome === "capture" ? captureCoopCaptureParty() : undefined;
    coopLog(
      "runtime",
      `send waveResolved wave=${wave} outcome=${outcome}${captureParty == null ? "" : ` captureParty=${captureParty.length}`}${presentation == null ? "" : ` cap=sp${presentation.speciesId}`} (host)`,
    );
    active.battleStream.sendWaveResolved(wave, outcome, captureParty, presentation, transition);
  } catch (e) {
    /* a wave-resolved send failure must never break the host's post-battle flow */
    coopWarn("runtime", `send waveResolved failed wave=${wave} outcome=${outcome}`, e);
  }
}

/**
 * GUEST live-materialization sink for a JOURNAL-delivered WAVE_ADVANCE op (Wave-2f KEYSTONE, W2e-R P0-1).
 * This is the FIRST production live-mutation sink (the reviewer's central demand): when the legacy
 * `waveResolved` was LOST but the committed op arrived via the durability journal resend / reconnect tail,
 * the journal applier routes here and this feeds the SAME `pendingWaveAdvance` queue the relay path feeds -
 * so the guest's wave-advance tail (VictoryPhase / BattleEnd / NewBattle / GameOver) rebuilds at the next
 * SAFE turn boundary via `maybeRunCoopWaveAdvance`, not mid-message. Idempotent: the materialization is
 * deduped by `lastResolvedWave` (a wave already resolved is skipped), so a normal (relay-present) run never
 * double-builds. Guest-only + authoritative-only; a host / solo / lockstep client no-ops. Returns true iff
 * it enqueued the materialization. Best-effort - never throws into the durability handler.
 */
function materializeCoopWaveAdvanceFromOp(runtime: CoopRuntime, envelope: CoopAuthoritativeEnvelopeV1): boolean {
  try {
    if (runtime.controller.netcodeMode !== "authoritative" || runtime.controller.role !== "guest") {
      return false; // only the authoritative GUEST renders the tail; the host resolves it directly.
    }
    const operation = envelope.pendingOperation;
    if (operation?.kind !== "WAVE_ADVANCE" || !isValidCoopWaveAdvancePayload(operation.payload)) {
      return false;
    }
    const payload = operation.payload as CoopWaveAdvancePayload;
    const staged = getCoopStagedWaveAdvanceTransaction(payload.wave);
    if (staged == null || staged.operationId !== operation.id) {
      return false;
    }
    if (!staged.bootstrapProjected) {
      if (globalScene.currentBattle?.waveIndex !== payload.wave || payload.wave <= lastResolvedWave) {
        return false;
      }
      // This is only a deterministic bootstrap into Victory/BattleEnd. The operation remains unacknowledged
      // until BattleEnd applies DATA and a real public destination surface opens.
      const merged = mergeCoopPendingWaveAdvance(
        pendingWaveAdvance,
        payload.wave,
        payload.outcome,
        undefined,
        pendingRawWavePresentations.get(payload.wave),
        payload,
      );
      if (merged == null || !markCoopWaveAdvanceBootstrapProjected(payload.wave)) {
        return false;
      }
      pendingWaveAdvance = merged;
      pendingRawWavePresentations.delete(payload.wave);
      coopLog(
        "runtime",
        `wave-advance JOURNAL bootstrap wave=${payload.wave} outcome=${payload.outcome} (ACK withheld)`,
      );
    }
    if (
      globalScene.phaseManager?.getCurrentPhase()?.phaseName === "BattleEndPhase"
      && !tryApplyCoopSettledWaveData(payload.wave)
    ) {
      return false;
    }
    return maybeMarkCoopWaveContinuationReady(payload.wave);
  } catch (e) {
    coopWarn("runtime", "wave-advance JOURNAL materialize threw (handled)", e);
    return false;
  }
}

/**
 * Production biome live-materializer. Captures the RECEIVING runtime rather than consulting the ambient
 * singleton: transport delivery is asynchronous, and the two-engine harness may be driving the partner's
 * scene when this receiver callback runs. Real clients have one runtime, but keeping the dependency explicit
 * makes the production wiring correct under both topologies.
 */
function materializeCoopBiomeChoiceFromOp(runtime: CoopRuntime, envelope: CoopAuthoritativeEnvelopeV1): boolean {
  if (runtime.controller.netcodeMode !== "authoritative" || runtime.controller.role !== "guest") {
    return false;
  }
  const op = envelope.pendingOperation;
  const parsed = op == null ? null : parseCoopOperationId(op.id);
  const plan = preflightCoopBiomeJournalMaterialization(envelope);
  if (op == null || parsed == null || plan == null) {
    return false;
  }
  if (op.kind === "BIOME_PICK") {
    const payload = op.payload as CoopBiomePickPayload;
    const deterministicAddress =
      parsed.pinnedSeq === COOP_BIOME_TRANSITION_SEQ_BASE + envelope.wave
      && parsed.owner === 0
      && payload?.nodeIndex === -1;
    const interactivePinned = parsed.pinnedSeq - COOP_BIOME_PICK_SEQ_BASE;
    if (
      (!deterministicAddress
        && (interactivePinned < 0
          || interactivePinned > COOP_MAX_REACHABLE_COUNTER
          || parsed.pinnedSeq >= COOP_STORMGLASS_SEQ
          || parsed.owner !== coopInteractionOwnerSeat(interactivePinned)))
      || !Number.isSafeInteger(payload?.sourceBiomeId)
      || payload.sourceBiomeId < 0
      || !Number.isSafeInteger(payload?.biomeId)
      || payload.biomeId < 0
      || !Number.isSafeInteger(payload?.nodeIndex)
      || payload.nodeIndex < -1
      || !Number.isSafeInteger(payload?.nextWave)
      || payload.nextWave !== envelope.wave + 1
    ) {
      return false;
    }
    if (deterministicAddress) {
      // No interaction exists for a deterministic transition. Publish its exact receipt/permit directly;
      // buffering it in InteractionRelay would create a phantom owner/watcher action at this wave address.
      return publishCoopBiomeJournalMaterialization(plan);
    }
    try {
      runtime.interactionRelay.materializeCommittedInteractionChoice(parsed.pinnedSeq, "biomePick", payload.nodeIndex, [
        payload.biomeId,
      ]);
    } catch (e) {
      coopWarn("runtime", `biome committed relay materialization threw id=${op.id}; receipt remains unpublished`, e);
      return false;
    }
    return publishCoopBiomeJournalMaterialization(plan);
  }
  if (op.kind === "CROSSROADS_PICK") {
    const payload = op.payload as CoopCrossroadsPickPayload;
    if (
      parsed.pinnedSeq < COOP_CROSSROADS_SEQ_BASE
      || parsed.pinnedSeq >= COOP_BIOME_PICK_SEQ_BASE
      || !Number.isSafeInteger(payload?.optionIndex)
      || (payload.optionIndex !== 0 && payload.optionIndex !== 1)
    ) {
      return false;
    }
    try {
      runtime.interactionRelay.materializeCommittedInteractionChoice(
        parsed.pinnedSeq,
        "crossroads",
        payload.optionIndex,
      );
    } catch (e) {
      coopWarn(
        "runtime",
        `crossroads committed relay materialization threw id=${op.id}; receipt remains unpublished`,
        e,
      );
      return false;
    }
    return publishCoopBiomeJournalMaterialization(plan);
  }
  return false;
}

/** Feed one journal-led reward/market action into this receiver's existing safe FIFO apply loop. */
function materializeCoopRewardActionFromOp(runtime: CoopRuntime, envelope: CoopAuthoritativeEnvelopeV1): boolean {
  if (runtime.controller.netcodeMode !== "authoritative" || runtime.controller.role !== "guest") {
    return false;
  }
  const op = envelope.pendingOperation;
  const parsed = op == null ? null : parseCoopOperationId(op.id);
  if (op == null || parsed == null || parsed.pinnedSeq < 0) {
    return false;
  }
  const pinned = Math.floor(parsed.pinnedSeq / COOP_REWARD_ACTION_STRIDE);
  const ordinal = parsed.pinnedSeq % COOP_REWARD_ACTION_STRIDE;
  if (!Number.isSafeInteger(pinned) || !Number.isSafeInteger(ordinal) || ordinal < 0) {
    return false;
  }
  if (op.kind === "REWARD") {
    const payload = op.payload as CoopRewardActionPayload;
    if (
      typeof payload?.label !== "string"
      || !COOP_REWARD_CHOICE_KINDS.some(kind => kind === payload.label)
      || typeof payload.choice !== "number"
      || typeof payload.terminal !== "boolean"
      || (payload.data !== undefined && (!Array.isArray(payload.data) || !payload.data.every(Number.isFinite)))
    ) {
      return false;
    }
    runtime.interactionRelay.materializeCommittedInteractionChoice(
      pinned,
      payload.label,
      payload.choice,
      payload.data,
      op.id,
    );
    armCoopRewardJournalMaterialization(op.id, pinned);
    return true;
  }
  if (op.kind === "SHOP_BUY") {
    const payload = op.payload as CoopShopBuyPayload;
    if (
      typeof payload?.slot !== "number"
      || typeof payload.terminal !== "boolean"
      || (payload.data !== undefined && (!Array.isArray(payload.data) || !payload.data.every(Number.isFinite)))
    ) {
      return false;
    }
    runtime.interactionRelay.materializeCommittedInteractionChoice(
      coopBiomeShopSeq(pinned),
      COOP_BIOME_SHOP_CHOICE_KINDS[0],
      payload.slot,
      payload.data,
      op.id,
    );
    armCoopRewardJournalMaterialization(op.id, pinned);
    return true;
  }
  return false;
}

/** Feed a journal-delivered Giratina bargain terminal into the receiver's real outcome waiter. */
function materializeCoopBargainOutcomeFromOp(runtime: CoopRuntime, envelope: CoopAuthoritativeEnvelopeV1): boolean {
  if (runtime.controller.netcodeMode !== "authoritative" || runtime.controller.role !== "guest") {
    return false;
  }
  const op = envelope.pendingOperation;
  const parsed = op == null ? null : parseCoopOperationId(op.id);
  const payload = op?.payload as CoopBargainPayload | undefined;
  if (
    op?.kind !== "BARGAIN"
    || parsed == null
    || !Number.isSafeInteger(parsed.pinnedSeq)
    || parsed.pinnedSeq < 0
    || payload?.outcome?.k !== "meResync"
  ) {
    return false;
  }
  armCoopBargainJournalMaterialization(op.id);
  runtime.interactionRelay.materializeCommittedInteractionOutcome(
    COOP_BARGAIN_SEQ_BASE + parsed.pinnedSeq,
    payload.outcome,
  );
  return true;
}

/** Feed one journal-delivered ability outcome into the receiver's dedicated picker FIFO. */
function materializeCoopAbilityOutcomeFromOp(runtime: CoopRuntime, envelope: CoopAuthoritativeEnvelopeV1): boolean {
  if (runtime.controller.netcodeMode !== "authoritative" || runtime.controller.role !== "guest") {
    return false;
  }
  const operation = envelope.pendingOperation;
  const parsed = operation == null ? null : parseCoopOperationId(operation.id);
  const payload = operation?.payload as CoopAbilityPickPayload | undefined;
  if (
    operation?.kind !== "ABILITY_PICK"
    || parsed == null
    || payload == null
    || !Array.isArray(payload.data)
    || !payload.data.every(Number.isFinite)
  ) {
    return false;
  }
  if (operation.owner === 1) {
    return true; // guest owner already applied its own picker result; envelope is confirmation only.
  }
  const pinned = Math.floor(parsed.pinnedSeq / COOP_ABILITY_ACTION_STRIDE);
  if (!Number.isSafeInteger(pinned) || pinned < 0) {
    return false;
  }
  armCoopAbilityJournalMaterialization(operation.id);
  runtime.interactionRelay.materializeCommittedInteractionChoice(
    coopAbilityPickerSeq(pinned),
    COOP_ABILITY_KIND,
    COOP_ABILITY_OUTCOME,
    [...payload.data],
    operation.id,
  );
  return true;
}

/** Feed a journal-delivered Revival Blessing prompt into the guest's existing picker seam. */
function materializeCoopRevivalPromptFromOp(runtime: CoopRuntime, envelope: CoopAuthoritativeEnvelopeV1): boolean {
  if (runtime.controller.netcodeMode !== "authoritative" || runtime.controller.role !== "guest") {
    return false;
  }
  const operation = envelope.pendingOperation;
  const payload = operation?.payload as CoopRevivalPayload | undefined;
  if (operation?.kind !== "REVIVAL" || payload == null) {
    return false;
  }
  if (payload.type === "prompt") {
    runtime.interactionRelay.materializeCommittedRevivalPrompt(payload.fieldIndex, operation.id);
  }
  // A decision was already made by its owning picker and is materialized by the host's authoritative
  // result/state stream; the committed envelope is its durable confirmation.
  return true;
}

/** Feed a journal-delivered wild catch-full prompt into the guest's existing picker seam. */
function materializeCoopCatchFullPromptFromOp(runtime: CoopRuntime, envelope: CoopAuthoritativeEnvelopeV1): boolean {
  if (runtime.controller.netcodeMode !== "authoritative" || runtime.controller.role !== "guest") {
    return false;
  }
  const operation = envelope.pendingOperation;
  const payload = operation?.payload as CoopCatchFullPayload | undefined;
  if (operation?.kind !== "CATCH_FULL" || payload == null) {
    return false;
  }
  if (payload.type === "prompt") {
    runtime.interactionRelay.materializeCommittedCatchFullPrompt(payload.pokemonName, payload.speciesId, operation.id);
  }
  // Decisions are owner-local and converge through the host's authoritative capture state.
  return true;
}

/** Materialize/confirm a committed faint replacement before its durability ACK is allowed. */
function materializeCoopFaintSwitchFromOp(runtime: CoopRuntime, envelope: CoopAuthoritativeEnvelopeV1): boolean {
  if (runtime.controller.netcodeMode !== "authoritative" || runtime.controller.role !== "guest") {
    return false;
  }
  const operation = envelope.pendingOperation;
  const payload = operation?.payload as CoopFaintSwitchPayload | undefined;
  if (
    operation?.kind !== "FAINT_SWITCH"
    || payload == null
    || !Number.isSafeInteger(payload.fieldIndex)
    || payload.fieldIndex < 0
    || payload.fieldIndex > 3
    || !Number.isSafeInteger(payload.partySlot)
    || !Array.isArray(payload.data)
    || !payload.data.every(Number.isFinite)
  ) {
    return false;
  }
  // Guest-owned picks were already materialized by the local picker. Host-owned replacements are fed into
  // the same committed-choice FIFO used by the replacement phase, with the operation id for dedupe.
  if (operation.owner === 0) {
    runtime.interactionRelay.materializeCommittedInteractionChoice(
      COOP_FAINT_SWITCH_SEQ_BASE + payload.fieldIndex,
      "switch",
      payload.partySlot,
      [...payload.data],
      operation.id,
    );
  }
  return true;
}

/** Feed the host's committed one-time Stormglass choice into the guest watcher seam. */
function materializeCoopStormglassFromOp(runtime: CoopRuntime, envelope: CoopAuthoritativeEnvelopeV1): boolean {
  if (runtime.controller.netcodeMode !== "authoritative" || runtime.controller.role !== "guest") {
    return false;
  }
  const operation = envelope.pendingOperation;
  const payload = operation?.payload as CoopStormglassPayload | undefined;
  if (operation?.kind !== "STORMGLASS" || payload == null) {
    return false;
  }
  runtime.interactionRelay.materializeCommittedInteractionChoice(
    COOP_STORMGLASS_SEQ,
    "stormglass",
    payload.weatherIndex,
    undefined,
    operation.id,
  );
  return true;
}

/** Route journaled learn presentations/host terminals into the same relay seams as their raw carriers. */
function materializeCoopLearnMoveFromOp(runtime: CoopRuntime, envelope: CoopAuthoritativeEnvelopeV1): boolean {
  if (runtime.controller.netcodeMode !== "authoritative" || runtime.controller.role !== "guest") {
    return false;
  }
  const op = envelope.pendingOperation;
  if (op?.kind === "LEARN_MOVE") {
    const payload = op.payload as CoopLearnMovePayload;
    if (payload.type === "prompt") {
      runtime.interactionRelay.materializeCommittedInteractionOutcome(
        COOP_LEARN_MOVE_FWD_SEQ_BASE + payload.partySlot,
        {
          k: "learnMoveForward",
          partySlot: payload.partySlot,
          moveId: payload.moveId,
          maxMoveCount: payload.maxMoveCount,
        },
      );
    }
    return true;
  }
  if (op?.kind !== "LEARN_MOVE_BATCH") {
    return false;
  }
  const payload = op.payload as CoopLearnMoveBatchPayload;
  const seq = COOP_LEARN_MOVE_BATCH_FWD_SEQ_BASE + payload.partySlot;
  if (payload.type === "prompt") {
    runtime.interactionRelay.materializeCommittedInteractionOutcome(seq, {
      k: "learnMoveBatchForward",
      partySlot: payload.partySlot,
      learnableIds: [...payload.learnableIds],
      ownerIsGuest: payload.ownerIsGuest,
    });
    return true;
  }
  if (op.owner !== 0) {
    return true;
  }
  const data = payload.assignments.flat();
  runtime.interactionRelay.materializeCommittedInteractionChoice(
    seq,
    "learnMoveBatch",
    payload.fallback ? -1 : payload.assignments.length,
    data,
    op.id,
  );
  return true;
}

/** Feed one journal-delivered colosseum board/pick into the receiver's existing safe FIFOs. */
function materializeCoopColosseumActionFromOp(runtime: CoopRuntime, envelope: CoopAuthoritativeEnvelopeV1): boolean {
  if (runtime.controller.netcodeMode !== "authoritative" || runtime.controller.role !== "guest") {
    return false;
  }
  const op = envelope.pendingOperation;
  const parsed = op == null ? null : parseCoopOperationId(op.id);
  const payload = op?.payload as CoopColosseumPayload | undefined;
  if (op?.kind !== "COLO_PICK" || parsed == null || parsed.pinnedSeq < 0 || payload == null) {
    return false;
  }
  const pinned = Math.floor(parsed.pinnedSeq / COOP_COLOSSEUM_ACTION_STRIDE);
  const ordinal = parsed.pinnedSeq % COOP_COLOSSEUM_ACTION_STRIDE;
  if (!Number.isSafeInteger(pinned) || pinned < 0 || !Number.isSafeInteger(payload.round) || payload.round < 0) {
    return false;
  }
  const seq = COOP_COLOSSEUM_SEQ_BASE + pinned;
  if (
    payload.type === "board"
    && op.owner === 0
    && ordinal === payload.round * 2
    && Array.isArray(payload.labels)
    && payload.labels.every(label => typeof label === "string")
  ) {
    if (coopMeInteractionStartValue() !== pinned) {
      return false;
    }
    const presentation: Extract<CoopInteractionOutcome, { k: "mePresent" }> = {
      k: "mePresent",
      tokens: { coopColosseumRound: String(payload.round) },
      meetsReqs: [],
      labels: [],
      subPrompt: { kind: "secondary", labels: [...payload.labels] },
    };
    setCoopMeActivePresentation(presentation, true);
    runtime.interactionRelay.materializeCommittedInteractionOutcome(seq, presentation);
    return true;
  }
  if (payload.type === "decision" && ordinal === payload.round * 2 + 1 && Number.isSafeInteger(payload.index)) {
    // A guest-owned decision was already applied locally by its capture UI; its committed envelope only
    // confirms/cancels intent resend. Feeding it back into the same pinned FIFO would poison the next round.
    if (op.owner === 1) {
      return true;
    }
    runtime.interactionRelay.materializeCommittedInteractionChoice(
      seq,
      "coloPick",
      payload.index,
      [payload.round],
      op.id,
    );
    return true;
  }
  return false;
}

/** Per-session two-stage terminal receiver: retain DATA success until the exact destination executes. */
const coopMeTerminalTransactions = new CoopMeTerminalTransactionReceiver();

/** Materialize journal ME presentation and complete terminal transactions on the authoritative guest. */
function materializeCoopMeOperationFromOp(runtime: CoopRuntime, envelope: CoopAuthoritativeEnvelopeV1): boolean {
  if (runtime.controller.netcodeMode !== "authoritative" || runtime.controller.role !== "guest") {
    return false;
  }
  const op = envelope.pendingOperation;
  const parsed = op == null ? null : parseCoopOperationId(op.id);
  if (op == null || (op.owner !== 0 && op.owner !== 1) || parsed == null) {
    return false;
  }
  const seq = Math.floor(parsed.pinnedSeq / 8000);
  const kindTag = Math.floor((parsed.pinnedSeq % 8000) / 1000);
  if (op.kind === "ME_PRESENT") {
    const pinned = seq - COOP_ME_PUMP_SEQ_BASE;
    const payload = op.payload as CoopMePresentPayload;
    if (
      op.owner !== 0
      || kindTag !== 0
      || !Number.isSafeInteger(pinned)
      || pinned < 0
      || pinned >= 100_000
      || payload?.present !== true
      || payload.presentation?.k !== "mePresent"
    ) {
      return false;
    }
    if (coopMeInteractionStartValue() !== pinned) {
      return false;
    }
    setCoopMeActivePresentation(payload.presentation);
    const retained = captureCoopActiveMysteryControl();
    if (
      retained?.interactionCounter !== pinned
      || retained.terminal !== "pending"
      || JSON.stringify(retained.presentation) !== JSON.stringify(payload.presentation)
    ) {
      return false;
    }
    runtime.interactionRelay.materializeCommittedInteractionOutcome(seq, payload.presentation);
    return true;
  }
  if (op.kind === "ME_PICK") {
    const payload = op.payload as CoopMePickPayload;
    return kindTag === 1 && Number.isInteger(payload?.optionIndex);
  }
  if (op.kind === "ME_SUB") {
    const payload = op.payload as CoopMeSubPayload;
    return kindTag === 2 && Number.isInteger(payload?.value);
  }
  if (op.kind === "ME_BUTTON") {
    const payload = op.payload as CoopMeButtonPayload;
    return kindTag === 3 && Number.isInteger(payload?.button);
  }
  if (op.kind === "QUIZ_ANSWER") {
    const payload = op.payload as CoopQuizAnswerPayload;
    const valid =
      kindTag === 5
      && Number.isInteger(payload?.questionIndex)
      && payload.questionIndex >= 0
      && Number.isInteger(payload.choice);
    if (!valid) {
      return false;
    }
    runtime.interactionRelay.materializeCommittedInteractionChoice(seq, "quizAns", payload.choice, undefined, op.id);
    return true;
  }
  if (op.kind !== "ME_TERMINAL") {
    return false;
  }
  const pinned = seq - COOP_ME_TERM_SEQ_BASE;
  const payload = op.payload as CoopMeTerminalPayload;
  const step = parsed.pinnedSeq % 1000;
  if (
    op.owner !== 0
    || kindTag !== 4
    || !Number.isSafeInteger(pinned)
    || pinned < 0
    || pinned >= 100_000
    || !isCompleteCoopMeTerminalPayload(payload)
    || payload.outcome.authoritativeState?.wave !== envelope.wave
    || (payload.destination.kind === "continue" && payload.destination.nextWave !== envelope.wave + 1)
    || coopMeInteractionStartValue() !== pinned
  ) {
    return false;
  }
  const transaction = { operationId: op.id, pinned, step, payload };
  // Besides making a late replay phase retriable, this fences the two-engine harness's shared module
  // graph: an envelope delivered while the other client's scene is installed must not apply to it.
  if (!canMaterializeCoopMeCommittedTerminal(transaction)) {
    return false;
  }
  const receive = coopMeTerminalTransactions.receive(transaction, {
    applyMaterial: () => {
      if (applyCoopMeOutcome(payload.outcome)) {
        return true;
      }
      coopWarn("me", `journaled Mystery transaction DATA apply failed id=${op.id}`);
      if (consumeCoopMeOutcomeRollbackFatal()) {
        failCoopSharedSession(`Mystery outcome rollback failed for ${op.id}`);
      }
      return false;
    },
    executeDestination: () => {
      const hostTurn = payload.destination.kind === "battle" ? payload.destination.hostTurn : undefined;
      setCoopMeTerminalControl(payload.terminal, hostTurn, {
        operationId: op.id,
        step,
        choice: payload.terminal === "battle" ? COOP_ME_BATTLE_HANDOFF : COOP_INTERACTION_LEAVE,
      });
      const retainedControl = captureCoopActiveMysteryControl();
      if (
        retainedControl?.terminalOperationId !== op.id
        || retainedControl.terminal !== payload.terminal
        || retainedControl.terminalStep !== step
      ) {
        return false;
      }
      return materializeCoopMeCommittedTerminal({ operationId: op.id, pinned, step, payload });
    },
  });
  if (receive !== "executed" && receive !== "duplicate") {
    return false;
  }
  // Compatibility waiters (notably the detached Colosseum lease) may still be blocked on 9M. Wake them
  // only AFTER a leave transaction cleared its pin; their boundary fence then exits without mutating.
  // Battle control is never mirrored here because the live replay would otherwise execute it twice.
  if (payload.terminal === "leave") {
    runtime.interactionRelay.materializeCommittedInteractionChoice(
      seq,
      "meBtn",
      COOP_INTERACTION_LEAVE,
      undefined,
      op.id,
    );
  }
  return true;
}

/**
 * Co-op WAVE-END authoritative capture (#838): the HOST streams the COMPLETE post-exp authoritative
 * battle state (whole player + enemy party as serialized PokemonData, seating, arena, modifiers, money,
 * ER substrates), captured HERE in the host's `BattleEndPhase` AFTER the wave's exp/level/evolution
 * chain has DRAINED (the unshifted ExpPhase / LevelUpPhase / EvolutionPhase chain runs before the pushed
 * BattleEndPhase, so levels / exp / learned moves / evolved species are fully credited here). The guest
 * adopts it in its own BattleEndPhase via a single id-based full-state apply, so its progression converges
 * through the between-wave shop off the same wire the live turns use - the sole post-battle progression channel.
 * Hard no-op unless we are the HOST of a live AUTHORITATIVE co-op run, so solo / non-host / lockstep play is
 * byte-for-byte unaffected. Best-effort + guarded - a send failure never breaks the host's post-battle flow.
 */
function commitCoopSettledWaveAdvance(
  wave: number,
  transition: CoopWaveAdvancePayload,
  capturedState?: CoopAuthoritativeBattleStateV1,
): CoopAuthoritativeBattleStateV1 | null {
  if (active == null || active.controller.role !== "host") {
    return null;
  }
  const state = capturedState ?? captureCoopAuthoritativeBattleState(globalScene.currentBattle.turn);
  if (state == null || state.wave !== wave) {
    coopWarn("runtime", `settled WAVE_ADVANCE capture rejected wave=${wave}`);
    if (usesRetainedCoopWaveTransaction()) {
      failCoopSharedSession(`Could not capture the complete settled state for wave ${wave}.`);
    }
    return null;
  }
  const settledTransition: CoopWaveAdvancePayload = {
    ...transition,
    settledStateTick: state.tick,
  };
  const envelope = commitWaveAdvanceOwnerIntent({
    payload: settledTransition,
    authoritativeState: state,
    localRole: active.controller.role,
    wave,
    turn: state.turn,
  });
  if (usesRetainedCoopWaveTransaction() && envelope == null) {
    failCoopSharedSession(`Could not retain the complete authoritative transition for wave ${wave}.`);
    return null;
  }
  if (envelope != null) {
    settledHostWaveTransitions.set(wave, settledTransition);
  }
  coopLog(
    "runtime",
    `settled WAVE_ADVANCE committed wave=${wave} tick=${state.tick} next=${settledTransition.nextLogicalPhase}/wave${settledTransition.nextWave}`,
  );
  pendingHostWaveTransitions.delete(wave);
  return state;
}

/** BattleEnd destroys enemy presentation after capture; encode that completed projection explicitly. */
function normalizeCoopSettledPostBattleState(state: CoopAuthoritativeBattleStateV1): CoopAuthoritativeBattleStateV1 {
  return {
    ...state,
    field: state.field.map(seat => (seat.side === "enemy" ? { ...seat, presented: false } : seat)),
  };
}

export function broadcastCoopWaveEndState(isVictory?: boolean): void {
  if (!globalScene.gameMode.isCoop || active == null || getCoopNetcodeMode() !== "authoritative") {
    return;
  }
  if (active.controller.role !== "host") {
    return;
  }
  const wave = globalScene.currentBattle.waveIndex;
  let state: CoopAuthoritativeBattleStateV1;
  try {
    const capturedState = captureCoopAuthoritativeBattleState(globalScene.currentBattle.turn);
    if (capturedState == null) {
      coopWarn("runtime", `send waveEndState SKIP wave=${wave} (capture returned null)`);
      if (usesRetainedCoopWaveTransaction()) {
        failCoopSharedSession(`Could not capture the settled authoritative state for wave ${wave}.`);
      }
      return;
    }
    state = normalizeCoopSettledPostBattleState(capturedState);
    const stagedTransition = pendingHostWaveTransitions.get(wave);
    const gracefulEnd = globalScene.gameMode.isEndless && wave >= 5850;
    const mysteryBattle = globalScene.currentBattle.isBattleMysteryEncounter();
    if (usesRetainedCoopWaveTransaction() && stagedTransition == null && !gracefulEnd && !mysteryBattle) {
      failCoopSharedSession(`The authoritative transition for wave ${wave} was not staged before BattleEnd.`);
      return;
    }
    const transition = gracefulEnd
      ? buildCoopWaveAdvancePayload("gameOver", wave)
      : (stagedTransition
        ?? (!usesRetainedCoopWaveTransaction() && isVictory !== undefined
          ? buildCoopWaveAdvancePayload(isVictory ? "win" : "flee", wave)
          : null));
    if (
      transition != null
      && commitCoopSettledWaveAdvance(wave, transition, state) == null
      && usesRetainedCoopWaveTransaction()
    ) {
      return;
    }
    pendingHostWaveTransitions.delete(wave);
  } catch (e) {
    coopWarn("runtime", `seal settled WAVE_ADVANCE failed wave=${wave}`, e);
    if (usesRetainedCoopWaveTransaction()) {
      failCoopSharedSession(`Could not seal the retained authoritative transition for wave ${wave}.`);
    }
    return;
  }
  try {
    // Compatibility only. A retained peer ignores this raw carrier for correctness, so drop/reorder cannot
    // make it advance before the complete envelope above.
    coopLog("runtime", `send waveEndState wave=${wave} tick=${state.tick} (host)`);
    active.battleStream.sendWaveEndState(wave, state);
  } catch (e) {
    // Presentation/legacy compatibility failure after retention cannot invalidate the complete transaction.
    coopWarn("runtime", `send raw waveEndState failed after durable seal wave=${wave} (ignored)`, e);
  }
}

// =============================================================================
// Co-op AUTHORITATIVE mystery-encounter BATTLE HANDOFF (#633). An ME option can spawn a
// battle MID-wave; the interaction is owner-alternated but the spawned battle must be
// HOST-AUTHORITATIVE. At the single chokepoint every ME battle funnels through
// (`initBattleWithEnemyConfig`), the HOST streams the just-generated boss party keyed by
// the ME interaction; the GUEST discards its own locally-rolled party and adopts the
// host's verbatim. Both then flow through the existing host-drives / guest-replays battle
// path, so the boss is identical regardless of who OWNED the encounter. Hard no-op in
// solo / lockstep / non-coop.
// =============================================================================

/** The interaction-counter value the in-progress ME opened on (pinned by mystery-encounter-phases),
 *  or -1 when not in an ME. The ME battle handoff key is derived from it so both clients agree. */
let coopMeBattleInteractionCounter = -1;

/**
 * Co-op (#633 ME battle handoff): pin the interaction counter the current ME opened on, so a
 * battle the ME spawns can be keyed identically on both clients. Set by mystery-encounter-phases
 * at ME entry; reset (`-1`) at the ME terminal. Pure state - no transport, safe in solo.
 */
export function setCoopMeBattleInteractionCounter(counter: number): void {
  if (counter !== coopMeBattleInteractionCounter) {
    // State CHANGE: ME begin (counter>=0) / ME terminal (-1).
    coopLog(
      "me",
      `interaction-counter ${coopMeBattleInteractionCounter} -> ${counter} (${counter >= 0 ? "ME begin" : "ME end"})`,
    );
  }
  coopMeBattleInteractionCounter = counter;
}

/**
 * Read the ME-battle handoff interaction counter (`-1` when idle). Exists for the two-engine duo test
 * harness's per-client ME-state save/restore (this is a process-global module let NOT carried on the
 * `active` runtime, so a two-real-engine harness must capture/restore it per client). Production reads
 * the boolean {@linkcode coopMeInProgress} / {@linkcode coopMeHandoffActive} instead.
 */
export function getCoopMeBattleInteractionCounter(): number {
  return coopMeBattleInteractionCounter;
}

/**
 * Co-op (#633): whether a mystery encounter is currently in progress (the STABLE in-ME pin,
 * mirrored here from `mystery-encounter-phases` so `select-modifier-phase` can read it WITHOUT a
 * circular import). `coopMeBattleInteractionCounter` is set/reset on the exact same ME entry/terminal
 * lines as `coopMeInteractionStart`, so it is an equivalent phase-ordering-independent signal. The
 * embedded end-of-ME reward shop reads it to suppress its own alternation advance, so the ME's single
 * advance stays owned by PostMysteryEncounterPhase. `true` for solo MEs too (same as the old
 * `currentBattle.mysteryEncounter != null` guard), so solo / lockstep stay byte-identical.
 */
export function coopMeInProgress(): boolean {
  return coopMeBattleInteractionCounter >= 0;
}

/** Whether a co-op ME battle handoff applies right now (live AUTHORITATIVE session, inside an ME). */
function coopMeHandoffActive(): boolean {
  return (
    active != null
    && globalScene.gameMode.isCoop
    && getCoopNetcodeMode() === "authoritative"
    && coopMeBattleInteractionCounter >= 0
  );
}

/**
 * GUEST (#847, ME battle-handoff phantom-turn softlock): whether the SPAWNED ME battle has been WON by
 * the host and the guest must now run the ME victory tail instead of opening a phantom next command.
 *
 * THE GAP: the authoritative wave-advance handshake (`coopHasPendingWaveAdvance` / the `waveResolved`
 * message) is the guest's ONLY signal to stop looping a resolved battle - but the host NEVER broadcasts
 * it for an ME-spawned battle. `VictoryPhase` takes the `isMysteryEncounter` branch (handleMysteryEncounter
 * Victory + return) BEFORE `broadcastCoopWaveResolved("win")`, so no wave-advance is ever pending for the
 * ME battle. The guest, a pure renderer that never runs its own FaintPhase/VictoryPhase, finalizes the
 * winning turn with NO pending advance and falls into the turn-advance branch -> a phantom turn N+1 for a
 * battle the host already won + left for the reward shop (the berry-bush deadlock: both barriers then
 * wait at different points).
 *
 * THE SIGNAL: we are the authoritative GUEST inside a STARTED ME-handoff battle and every enemy is
 * fainted. `CoopFinalizeTurnPhase` applies the host's authoritative checkpoint BEFORE calling finishTurn,
 * so a fully-fainted enemy party is the host's REAL win (not a locally-chipped premature victory - the
 * BUG1 hazard the normal path guards against, which reads local chip damage, not the checkpoint). This is
 * deterministic (no dependency on the reward-options message having arrived), and it naturally handles a
 * multi-turn ME battle (false until the LAST turn KOs the field).
 */
export function coopMeHandoffBattleWon(): boolean {
  // #847 ROBUSTNESS (checked FIRST, throw-free): scope the win to the handoff's OWN battle. The handoff
  // flag records the wave the spawned battle started on; a stale flag (an ME whose terminal never cleared
  // it, or module state latched across a vitest `isolate:false` file boundary) must NOT misfire the
  // victory tail on an unrelated later battle. Read only waveIndex here (cheap, never throws on a partial
  // stub scene) so a mismatch returns BEFORE touching gameMode / the enemy party.
  const handoffWave = coopMeHandoffBattleWaveValue();
  if (handoffWave < 0 || globalScene.currentBattle?.waveIndex !== handoffWave) {
    return false;
  }
  if (!coopMeHandoffActive() || !coopMeHandoffBattleStarted() || active!.controller.role !== "guest") {
    return false;
  }
  const enemies = globalScene.getEnemyParty();
  return enemies.length > 0 && enemies.every(e => e == null || e.isFainted());
}

/**
 * GUEST (#847): queue the ME-spawned battle's VICTORY tail so the guest transitions to the ME reward
 * shop (as its counter-parity owner/watcher) instead of a phantom next command. `VictoryPhase`'s
 * `isMysteryEncounter` branch runs `handleMysteryEncounterVictory` -> `BattleEndPhase` ->
 * `MysteryEncounterRewardsPhase` -> the guest's own `SelectModifierPhase` (the reward watcher on a
 * host-owned ME), whose entry arrives at the shop rendezvous point so the host's shop-barrier resolves.
 * Addresses the last enemy by `id` (an off-field but present party member after the checkpoint), falling
 * back to the player lead when none remains, exactly like {@linkcode maybeRunCoopWaveAdvance}'s win arm.
 * Best-effort + guarded - a failure here must never hang the guest's run.
 */
export function queueCoopMeBattleVictoryTail(): void {
  try {
    const lastEnemy = globalScene.getEnemyParty().at(-1);
    const battlerArg = lastEnemy == null ? BattlerIndex.PLAYER : lastEnemy.id;
    coopLog(
      "me",
      `guest ME battle WON: queuing VictoryPhase (ME reward tail, NOT a phantom turn) battler=${battlerArg}`,
    );
    globalScene.phaseManager.pushNew("VictoryPhase", battlerArg);
  } catch (e) {
    /* the ME victory tail is best-effort; a failure here must never hang the guest's run */
    coopWarn("me", "queueCoopMeBattleVictoryTail threw (handled)", e);
  }
}

/**
 * HOST (#633 ME battle handoff): stream the just-generated ME-spawned-battle enemy party so the
 * guest adopts it verbatim, keyed by the ME interaction. Called from `initBattleWithEnemyConfig`
 * after the host built its boss party. Hard no-op unless we are the HOST of a live AUTHORITATIVE
 * session inside an ME. Best-effort + guarded - never breaks the host's encounter.
 */
export function coopHostStreamMeBattleParty(): void {
  if (!coopMeHandoffActive() || active!.controller.role !== "host") {
    return;
  }
  if (isCoopMeOperationEnabled() && isCoopOperationJournalActive()) {
    // P33 binds this party into the complete ME_TERMINAL outcome. Leaving a second unconsumed party
    // carrier buffered would be both redundant and a future stale-fallback hazard.
    return;
  }
  try {
    const key = meBattleHandoffKey(globalScene.currentBattle.waveIndex, coopMeBattleInteractionCounter);
    const enemies = captureCoopEnemies();
    // Protocol 29: a battle-spawning ME can change biome BEFORE generating its enemy party (for example
    // Teleporting Hijinks). The guest does not run the option callback, so carry the resulting arena on the
    // same fail-closed handoff manifest. The serialized Pokemon blob is an extensible JSON record; attaching
    // it to the first enemy keeps party delivery + arena adoption one atomic carrier and one replay key.
    if (enemies[0] != null) {
      enemies[0] = {
        ...enemies[0],
        data: { ...enemies[0].data, coopArenaBiomeId: globalScene.arena.biomeId },
      };
    }
    coopLog("me", `host stream ME-battle party key=${key} enemies=${enemies.length}`);
    active!.battleStream.sendMeBattleEnemyParty(key, enemies);
  } catch (e) {
    /* a serialize/send failure must never break the host's ME battle setup */
    coopWarn("me", "host stream ME-battle party failed", e);
  }
}

/**
 * GUEST (#633 ME battle handoff): await the host's authoritative ME-spawned-battle enemy party,
 * keyed by the ME interaction. Returns the host's serialized enemies for the caller to rebuild
 * `battle.enemyParty` from, or `null` only when this is not an active guest handoff. A live handoff
 * fails closed after its replay/reconnect ceiling; it never authorizes a locally rolled party.
 */
export async function coopGuestAwaitMeBattleParty(timeoutMs?: number): Promise<CoopSerializedEnemy[] | null> {
  if (!coopMeHandoffActive() || active!.controller.role !== "guest") {
    return null;
  }
  const key = meBattleHandoffKey(globalScene.currentBattle.waveIndex, coopMeBattleInteractionCounter);
  coopLog("me", `guest await ME-battle party start key=${key} timeout=${timeoutMs ?? "default"}`);
  try {
    const enemies = await active!.battleStream.awaitMeBattleEnemyParty(key, timeoutMs);
    if (enemies == null) {
      throw new Error(`Authoritative ME-battle party unavailable for ${key}; refusing local derivation`);
    }
    coopLog("me", `guest await ME-battle party resolve key=${key} enemies=${enemies.length}`);
    return enemies;
  } catch (e) {
    coopWarn("me", `guest await ME-battle party failed key=${key}`, e);
    throw e;
  }
}

/** Whether THIS client must await + adopt the host's ME-spawned-battle party (authoritative guest). */
export function coopGuestShouldAdoptMeBattleParty(): boolean {
  return coopMeHandoffActive() && active!.controller.role === "guest";
}

/**
 * HOST (#633, TRACK-2 Phase C, non-battle ME narration): stream one ME dialogue/text line to the
 * guest's CoopReplayMePhase so its screen matches the host-run encounter. Hard no-op off the live
 * AUTHORITATIVE host (solo / guest / lockstep never emit), so those paths are byte-for-byte
 * unaffected. Cosmetic - the reward alternation + the per-ME full-state snapshot carry the OUTCOME,
 * so a dropped/late line can only blank a narration line, never desync. Best-effort + guarded.
 */
export function coopHostStreamMeMessage(text: string): void {
  if (!globalScene.gameMode.isCoop || active == null || getCoopNetcodeMode() !== "authoritative") {
    return;
  }
  if (active.controller.role !== "host") {
    return;
  }
  try {
    if (isCoopDebug()) {
      coopLog("me", `host stream ME-message len=${text.length}`);
    }
    active.battleStream.sendMeMessage(text);
  } catch (e) {
    /* an ME narration send failure must never break the host's encounter */
    coopWarn("me", "host stream ME-message failed", e);
  }
}

/**
 * OWNER (#633 ME battle handoff): if THIS client owns the in-progress ME and its option just
 * spawned a battle, relay the BATTLE-HANDOFF sentinel so the WATCHER's pump ends WITHOUT leaving
 * the encounter (it then runs the spawned battle host-authoritatively). No-op when we are the
 * watcher / not in an ME pump session. Solo / lockstep keep their own pump behavior untouched
 * (this is only invoked on the authoritative handoff path). Best-effort + guarded.
 */
export async function coopMeOwnerRelayBattleHandoff(options?: {
  readonly encounterMode?: number | undefined;
  readonly disableSwitch?: boolean;
}): Promise<boolean> {
  if (active == null) {
    // Format/unit probes may flip the GameMode to co-op without assembling a network session. No pinned
    // ME means there is no peer boundary to commit; preserve ordinary battle setup. A pinned live ME with
    // no runtime remains fail-closed.
    return coopMeInteractionStartValue() < 0;
  }
  const runtime = active;
  const pump = runtime.mePump;
  const pinned = coopMeInteractionStartValue();
  // The initial battle closes the ME pump. A multi-battle event (Colosseum) can then generate another
  // battle while the same pin remains live; P33 commits each such handoff as the next retained terminal
  // step. Without a journal, preserve the rollback path's separately streamed boss + inactive-pump no-op.
  if (
    !pump.isSessionActive()
    && !(isCoopOperationJournalActive() && runtime.controller.role === "host" && pinned >= 0)
  ) {
    coopLog("me", `owner-relay battle-handoff SKIP (active=${pump.isSessionActive()})`);
    return true;
  }
  try {
    coopLog("me", "owner-relay battle-handoff sentinel (end pump, run spawned battle)");
    const scene = globalScene;
    const controller = runtime.controller;
    const generation = coopSessionGeneration();
    const wave = globalScene.currentBattle?.waveIndex ?? -1;
    const hostTurn = globalScene.currentBattle?.turn ?? -1;
    const encounterMode = options?.encounterMode ?? globalScene.currentBattle?.mysteryEncounter?.encounterMode;
    const disableSwitch = options?.disableSwitch ?? false;
    const priorControl = captureCoopActiveMysteryControl();
    const step =
      priorControl?.interactionCounter === pinned && priorControl.terminal === "battle"
        ? (priorControl.terminalStep ?? -1) + 1
        : priorControl == null || priorControl.terminal === "pending"
          ? 0
          : -1;
    if (
      controller.role !== "host"
      || pinned < 0
      || wave < 0
      || !Number.isSafeInteger(step)
      || step < 0
      || step >= 1_000
      || !Number.isSafeInteger(hostTurn)
      || hostTurn < 0
      || typeof encounterMode !== "number"
      || !Number.isSafeInteger(encounterMode)
      || encounterMode < 0
    ) {
      failCoopSharedSession("Mystery battle handoff had no complete host boundary");
      return false;
    }
    const payload = {
      terminal: "battle",
      outcome: captureCoopMeOutcome(),
      destination: {
        kind: "battle",
        hostTurn,
        encounterMode,
        disableSwitch,
      },
    } satisfies CoopMeTerminalPayload;
    const commit = (): string | null =>
      commitMeOwnerIntent({
        kind: "ME_TERMINAL",
        seq: COOP_ME_TERM_SEQ_BASE + pinned,
        pinned,
        step,
        payload,
        localRole: "host",
        wave,
        turn: hostTurn,
      });
    let operationId = commit();
    if (operationId == null && isCoopMeOperationEnabled()) {
      coopWarn("me", "owner-relay battle-handoff retention failed; retrying exact transaction after reconnect");
      runtime.durability?.reconnect();
      await new Promise<void>(resolve => setTimeout(resolve, 250));
      if (
        globalScene !== scene
        || active !== runtime
        || getCoopController() !== controller
        || coopSessionGeneration() !== generation
        || coopMeInteractionStartValue() !== pinned
        || (globalScene.currentBattle?.waveIndex ?? -1) !== wave
      ) {
        return false;
      }
      operationId = commit();
    }
    if (operationId == null && isCoopMeOperationEnabled()) {
      failCoopSharedSession("Mystery battle handoff terminal could not commit after exact retry");
      return false;
    }
    if (operationId != null) {
      setCoopMeTerminalControl("battle", hostTurn, {
        operationId,
        step,
        choice: COOP_ME_BATTLE_HANDOFF,
      });
    }
    pump.relayMeBattleHandoff(hostTurn, !isCoopOperationJournalActive());
    return true;
  } catch (e) {
    coopWarn("me", "owner-relay battle-handoff failed; stopping shared session before battle setup", e);
    failCoopSharedSession("Mystery battle handoff could not enter authoritative control");
    return false;
  }
}

/**
 * Set up a LOCAL co-op session: the human is the host, paired with a
 * {@linkcode SpoofGuest} stand-in player 2 over an in-process LoopbackTransport.
 * Registers it as the active runtime and sends the host's opening `hello`. This
 * is the dev/hotseat entry; the real-peer path (P6) builds the same controller
 * over a WebRTC transport instead. Any prior session is torn down first.
 */
export function startLocalCoopSession(
  opts: {
    username?: string | undefined;
    netcodeMode?: CoopNetcodeMode | undefined;
    kind?: CoopSessionKind | undefined;
  } = {},
): CoopRuntime {
  coopLog(
    "launch",
    `startLocalCoopSession username=${opts.username ?? "(default)"} netcode=${opts.netcodeMode ?? "authoritative"} kind=${opts.kind ?? "coop"}`,
  );
  clearCoopRuntime();
  const { host, guest } = createLoopbackPair();
  // #820 ONE FACTORY: the full runtime (objects + EVERY hook) comes from assembleCoopRuntime -
  // the same factory the live peer path and the duo harness use. Only the spoof partner and
  // the host-side netcode pin are dev-path extras.
  const runtime = assembleCoopRuntime(host, opts);
  runtime.controller.setNetcodeMode(opts.netcodeMode ?? "authoritative");
  runtime.partnerTransport = guest;
  runtime.spoof = new SpoofGuest(guest);
  // Showdown 1v1 (D0): a versus vs-CPU session also stands up the showdown-speaking spoof opponent on
  // the guest endpoint so negotiate + wager + the enemy-command relay play through solo.
  if ((opts.kind ?? "coop") === "versus") {
    runtime.showdownSpoof = new ShowdownSpoof(guest);
  }
  setCoopRuntime(runtime);
  coopLog(
    "launch",
    `local session ready role=${runtime.controller.role} netcode=${runtime.controller.netcodeMode} -> connecting`,
  );
  runtime.controller.connect();
  return runtime;
}

/**
 * Set up a co-op session over a REAL peer transport (#633, P6). Unlike
 * {@linkcode startLocalCoopSession} (which spoofs the guest in-process), this wires
 * the live {@linkcode CoopSessionController} to an already-connected transport
 * backed by a real WebRTC data channel (see `coop-webrtc-transport.ts`) - no spoof.
 * Registers it as the active runtime and sends our opening `hello`. Any prior
 * session is torn down first.
 */
export function connectCoopSession(
  transport: CoopTransport,
  opts: {
    username?: string | undefined;
    netcodeMode?: CoopNetcodeMode | undefined;
    kind?: CoopSessionKind | undefined;
    p33?: CoopP33AuthenticatedContextV1 | undefined;
  } = {},
): CoopRuntime {
  coopLog(
    "launch",
    `connectCoopSession role=${transport.role} state=${transport.state} username=${opts.username ?? "(default)"} netcode=${opts.netcodeMode ?? "authoritative"}`,
  );
  clearCoopRuntime();
  const runtime = assembleCoopRuntime(transport, opts);
  setCoopRuntime(runtime);
  coopLog(
    "launch",
    `peer session ready role=${runtime.controller.role} netcode=${runtime.controller.netcodeMode} -> connecting`,
  );
  runtime.controller.connect();
  return runtime;
}

/**
 * #896 W2e-R2: the co-op capability set THIS build ADVERTISES. A per-surface operation capability is
 * advertised only when the surface is locally ENABLED (its rollback flag is on), so a locally-disabled
 * surface is NOT advertised -> the peer's intersection drops it too and BOTH sides stay off (symmetric
 * fail-closed). The durability + renderer-allowlist-enforce capabilities are static build features.
 * Read at assembly time (pre-negotiation), so the getters return the raw local flag, not a negotiated
 * value. Both peers advertise -> the enforce/journal features become negotiable (the enforce FLIP still
 * gates separately on isCoopCapabilityNegotiated).
 */
function buildLocalCoopCapabilities(durabilityEnabled: boolean): CoopCapabilityKey[] {
  const caps: CoopCapabilityKey[] = [];
  if (isCoopAbilityOperationEnabled()) {
    caps.push(COOP_CAP_OP_ABILITY);
  }
  if (isCoopBiomeOperationEnabled()) {
    caps.push(COOP_CAP_OP_BIOME);
  }
  if (isCoopBargainOperationEnabled()) {
    caps.push(COOP_CAP_OP_BARGAIN);
  }
  if (isCoopCatchFullOperationEnabled()) {
    caps.push(COOP_CAP_OP_CATCH_FULL);
  }
  if (isCoopColosseumOperationEnabled()) {
    caps.push(COOP_CAP_OP_COLOSSEUM);
  }
  if (isCoopFaintSwitchOperationEnabled()) {
    caps.push(COOP_CAP_OP_FAINT_SWITCH);
  }
  if (isCoopLearnMoveOperationEnabled()) {
    caps.push(COOP_CAP_OP_LEARN_MOVE);
  }
  if (isCoopRevivalOperationEnabled()) {
    caps.push(COOP_CAP_OP_REVIVAL);
  }
  if (isCoopStormglassOperationEnabled()) {
    caps.push(COOP_CAP_OP_STORMGLASS);
  }
  if (isCoopMeOperationEnabled()) {
    caps.push(COOP_CAP_OP_ME);
  }
  if (isCoopRewardOperationEnabled()) {
    caps.push(COOP_CAP_OP_REWARD);
  }
  // Wave-2f KEYSTONE: advertise the post-battle wave-advance surface (§2.5 item 4). Read at assembly time
  // (pre-negotiation), so the capability gate is inert and this returns the raw local flag, exactly like the
  // other surfaces - so a mixed build never one-sided-activates it (the negotiated intersection gates it).
  if (isCoopWaveAdvanceOperationEnabled()) {
    caps.push(COOP_CAP_OP_WAVE);
  }
  // Advertise durability only when this assembly will actually install its manager. Protocol 31 requires
  // it, so disabling the manager makes compatibility fail closed instead of claiming a dead capability.
  if (durabilityEnabled) {
    caps.push(COOP_CAP_DURABILITY_JOURNAL);
  }
  caps.push(COOP_CAP_RENDERER_ALLOWLIST_ENFORCE);
  return caps;
}

/**
 * Assemble + WIRE one co-op runtime over `transport` WITHOUT tearing down any prior session and
 * WITHOUT registering it as the active runtime or sending `hello`. This is the additive seam
 * {@linkcode connectCoopSession} delegates to (it adds the clear / setCoopRuntime / connect around
 * this); it exists separately so a TWO-ENGINE in-process harness can stand up BOTH clients' runtimes
 * over a single {@linkcode createLoopbackPair} - `connectCoopSession`'s leading `clearCoopRuntime()`
 * (which CLOSES the live transport) would otherwise disconnect the loopback pair when the second
 * client is built. The caller selects the live runtime with {@linkcode setCoopRuntime} and drives
 * {@linkcode CoopSessionController.connect} on each. Production behaviour is unchanged: every prod
 * caller goes through `connectCoopSession` / `startLocalCoopSession`, which keep the clear+set+connect
 * wrapper intact.
 */
export function assembleCoopRuntime(
  transport: CoopTransport,
  opts: {
    username?: string | undefined;
    netcodeMode?: CoopNetcodeMode | undefined;
    kind?: CoopSessionKind | undefined;
    p33?: CoopP33AuthenticatedContextV1 | undefined;
  } = {},
): CoopRuntime {
  resetCoopGlobalOperationOrder();
  // Biome + ability + bargain + catch-full + faint-switch + stormglass + reward are per-runtime (layer-B):
  // their fresh records come from
  // createCoopRuntimeOpState below, so the old reset-at-assembly call sites are removed (a fresh runtime's
  // records ARE the reset; calling reset here would touch the PREVIOUS runtime's record, not this one's).
  resetCoopColosseumOperationState();
  resetCoopLearnMoveOperationState();
  resetCoopRevivalOperationState();
  // Wave-2c: the mystery-encounter operation surface shares the same fresh-control-plane discipline (§8
  // step 5) - drop any leftover ME op state so a new run's re-init-from-0 interaction counter can never
  // collide with a prior run's already-applied ME operationIds.
  resetCoopMeOperationState();
  resetCoopActiveMysteryControl();
  coopMeTerminalTransactions.reset();
  // Wave-2f: same fresh-control-plane reset for the post-battle wave-advance operation state (THE KEYSTONE) -
  // a new run's wave index restarts, so drop any leftover host/guest applier + last-applied wave pin.
  resetCoopWaveAdvanceOperationState();
  pendingHostWaveTransitions.clear();
  settledHostWaveTransitions.clear();
  pendingRawWavePresentations.clear();
  pendingSettledWaveBoundary = null;
  // #896 W2e-R2: a fresh assembly is a genuine RE-PAIR (new control plane), so drop any prior session's
  // negotiated capability set - the first hello of this session renegotiates it. A HOT rejoin does NOT
  // re-assemble (it pulls a snapshot in place), so this never clears a live negotiation on a flap.
  clearNegotiatedCoopCapabilities();
  const durabilityEnabled = isCoopDurabilityEnabled();
  const controller = new CoopSessionController(transport, {
    username: opts.username,
    version: COOP_PROTOCOL_VERSION,
    // #896 W2e-R2: advertise what THIS build supports+enables; the controller negotiates the effective
    // session set (intersection with the peer's) and stores it, and the surface adapters gate on it.
    localCapabilities: buildLocalCoopCapabilities(durabilityEnabled),
    // Protocol 31 removes every broad biome-tail escape hatch. Launching without these exact control and
    // delivery capabilities would strand SelectBiome by construction, so compatibility must fail closed.
    requiredCapabilities: [COOP_CAP_OP_BIOME, COOP_CAP_OP_ME, COOP_CAP_DURABILITY_JOURNAL],
    requireFunctionalFingerprint: true,
    onEpochNegotiated: applyCoopOperationEpoch,
    p33: opts.p33,
  });
  // Pin the chosen netcode (#633, selectable A/B). On the HOST this is the source of
  // truth that rides along in broadcastRunConfig; on the GUEST it is only the pre-
  // runConfig default (the host's value overwrites it on receipt). Default lockstep.
  controller.setNetcodeMode(opts.netcodeMode ?? "authoritative");
  // Showdown 1v1 PvP (C1): pin the session kind the same way. On the HOST it rides along
  // in broadcastRunConfig; on the GUEST it is only the pre-runConfig default (the host's
  // value overwrites it on receipt). Default "coop" so co-op stays byte-identical.
  controller.setSessionKind(opts.kind ?? "coop");
  let runtime: CoopRuntime;
  const battleSync = new CoopBattleSync(transport, {
    onCommandTimeout: (timeout: CoopCommandTimeout) => {
      failCoopRuntimeSharedSession(
        runtime,
        `Partner command exhausted at epoch ${timeout.epoch}, wave ${timeout.wave}, turn ${timeout.turn}, `
          + `owner ${timeout.owner}, field ${timeout.fieldIndex}, Pokemon ${timeout.pokemonId}.`,
        {
          boundary: "surface",
          reasonCode: "continuation-failed",
          wave: timeout.wave,
          turn: timeout.turn,
        },
      );
    },
  });
  const battleStream = new CoopBattleStreamer(transport, {
    authorityContext: () => ({
      epoch: controller.sessionEpoch,
      wave: globalScene.currentBattle?.waveIndex ?? 0,
      turn: globalScene.currentBattle?.turn ?? 0,
    }),
    onAuthorityTerminal: reason => failCoopSharedSession(reason),
  });
  // Showdown 1v1: the interaction relay disables its #829 seat-map forged-switch check in versus (the
  // guest legitimately relays faint-replacement picks for the host's enemy side). Live predicate so the
  // guest - whose kind flips "coop" -> "versus" only on runConfig receipt - is correct after adoption.
  const interactionRelay = new CoopInteractionRelay(transport, { isVersus: () => controller.isVersusSession() });
  const uiMirror = new CoopUiMirror(transport);
  const mePump = new CoopMePump(interactionRelay);
  const rendezvous = new CoopRendezvous(transport, { getEpoch: () => controller.sessionEpoch });
  const membership = new CoopMembershipController(() => controller.role);
  // W2b/W2e (§4/§5): the application-level durability engine, flag-gated. Wave-2e plugs the operation
  // envelope in via the journal bridge's extractKey/apply hooks, so a committed op is journaled + ACKed +
  // resendable end-to-end (no longer a passive scaffold). Its reconnect() is wired into the #805 rejoin
  // below and its journal depth/unacked feed the health line. Absent when the flag is OFF (legacy behavior).
  const operationDurabilityHooks = coopOperationDurabilityHooks();
  const durability = durabilityEnabled
    ? new CoopDurabilityManager(transport, {
        ...operationDurabilityHooks,
        // Scope every durability-delivered op APPLY to THIS runtime's per-runtime op-state (layer-B). The
        // in-process harness loopback delivers a peer's envelope synchronously during another client's drain
        // (or between withClient swaps with none installed), so the ACTIVE op-state at apply time is NOT
        // reliably this receiver's - a migrated surface (bargain) would then write its cursor/aux onto the
        // sender's record (or fail-loud throw when nothing is installed), and the receiver's watcher-adopt
        // reads its own empty record and never converges. Installing runtime.opState here lands the apply on
        // the receiver's own record. Production has one runtime, so active == runtime already => no-op there.
        apply: entry => withActiveCoopRuntimeOpState(runtime.opState, () => operationDurabilityHooks.apply?.(entry)),
        sendFullSnapshot: (cls, headRevision, controlHighWater) =>
          sendCoopDurabilitySnapshot(runtime, cls, headRevision, controlHighWater),
        onRecoveryExhausted: failure =>
          failCoopSharedSession(
            `Durable operation recovery exhausted for ${failure.cls} at ${failure.from} `
              + `(blocked ${failure.blockedSeq}, ${failure.attempts} attempts, ${failure.reason}).`,
          ),
      })
    : undefined;
  // Install the active manager so the migrated surface adapters' commit path journals into it (Wave-2e).
  // null when durability is OFF -> journalCoopCommittedEnvelope is a no-op (pure legacy dual-run).
  setCoopOperationDurability(durability ?? null);
  resetCoopOperationJournalLog();
  runtime = {
    controller,
    membership,
    battleSync,
    battleStream,
    interactionRelay,
    uiMirror,
    mePump,
    rendezvous,
    localTransport: transport,
    durability,
    // Per-runtime op-state (layer-B): fresh guest/host cursors + per-surface records for THIS runtime, so
    // the two-engine harness's clients no longer share module-global apply state. Installed active by
    // setCoopRuntime; the migrated surfaces (bargain/stormglass, more to follow) read it fail-loud.
    opState: createCoopRuntimeOpState(controller.role),
  };
  sharedTerminalStates.set(runtime, { frozen: false, finalized: false, reason: null });
  if (opts.p33 != null) {
    const terminal = createCoopRuntimeSharedTerminal(transport, controller, {
      onPrepare: commit => prepareCoopSharedTerminal(runtime, commit.reason),
      onFinalize: () => finalizeCoopSharedTerminal(runtime, true),
      onTrace: event => {
        const point = readCoopBattlePoint();
        recordCoopCausalEvent({
          domain: "recovery",
          stage: `terminal-${event.stage}`,
          causalId: event.terminalId ?? `terminal:unaddressed:${controller.role}`,
          role: controller.role,
          epoch: controller.sessionEpoch,
          wave: point.wave,
          turn: point.turn,
          ...(event.detail == null ? {} : { detail: event.detail }),
        });
      },
    });
    sharedTerminalSupervisors.set(runtime, terminal);
  }
  // A real public command/reward UI is stronger evidence than a retry timer. Let the battle stream retire
  // its own addressed continuation first, then immediately re-run any valid journal transaction waiting on
  // that same surface. Ambiguous phase-owned surfaces (notably ER_MAP) remain covered by deferred polling.
  const notifyContinuationSurface = battleStream.notifyContinuationSurface.bind(battleStream);
  battleStream.notifyContinuationSurface = surface => {
    const released = notifyContinuationSurface(surface);
    durability?.retryDeferred("op:global");
    publishPendingCoopSnapshotProof(runtime);
    return released;
  };
  // Per-runtime production sink: a journal-delivered biome op feeds this receiver's own relay. In a real
  // process there is one runtime; in the duo harness the final (guest) assembly intentionally owns the one
  // module-level sink, matching the sole receiver topology.
  registerCoopOperationLiveSink("op:biome", envelope => materializeCoopBiomeChoiceFromOp(runtime, envelope));
  registerCoopOperationLiveSink("op:ability", envelope => materializeCoopAbilityOutcomeFromOp(runtime, envelope));
  registerCoopOperationLiveSink("op:bargain", envelope => materializeCoopBargainOutcomeFromOp(runtime, envelope));
  registerCoopOperationLiveSink("op:colosseum", envelope => materializeCoopColosseumActionFromOp(runtime, envelope));
  registerCoopOperationLiveSink("op:reward", envelope => materializeCoopRewardActionFromOp(runtime, envelope));
  registerCoopOperationLiveSink("op:me", envelope => materializeCoopMeOperationFromOp(runtime, envelope));
  registerCoopOperationLiveSink("op:revival", envelope => materializeCoopRevivalPromptFromOp(runtime, envelope));
  registerCoopOperationLiveSink("op:catchFull", envelope => materializeCoopCatchFullPromptFromOp(runtime, envelope));
  registerCoopOperationLiveSink("op:stormglass", envelope => materializeCoopStormglassFromOp(runtime, envelope));
  registerCoopOperationLiveSink("op:learnMove", envelope => materializeCoopLearnMoveFromOp(runtime, envelope));
  registerCoopOperationLiveSink("op:faintSwitch", envelope => materializeCoopFaintSwitchFromOp(runtime, envelope));
  registerCoopOperationLiveSink("op:wave", envelope => {
    const operation = envelope.pendingOperation;
    return operation?.kind === "WAVE_ADVANCE" && materializeCoopWaveAdvanceFromOp(runtime, envelope);
  });
  wireCoopGhostPoolSync(controller, battleStream);
  wireCoopResyncResponder(runtime);
  wireCoopDurabilitySnapshotReceiver(runtime);
  wireCoopEnemyPartyResponder(controller, battleStream);
  wireCoopWaveResolved(controller, battleStream);
  wireCoopWaveEndState(controller, battleStream);
  wireCoopMeChecksumCheck(battleStream);
  wireCoopLiveEvents(controller, battleStream);
  wireCoopLearnMoveForward(interactionRelay);
  wireCoopLearnMoveBatchForward(interactionRelay);
  wireCoopDexSync(transport);
  wireShowdownResult(transport, controller);
  wireCoopDisconnectReaction(transport, runtime);
  wireCoopStallWatchdog(transport, interactionRelay, battleStream, runtime);
  // #812: ownership probe for pre-responder commandRequests (buffer own-slot, decline foreign).
  battleSync.setSlotOwnershipProbe(fieldIndex => {
    try {
      return coopOwnerOfPlayerFieldSlot(fieldIndex) === controller.role;
    } catch {
      return true; // unknown -> buffer (never wrongly decline a real player's slot)
    }
  });
  // #817/#820 cosmetic cursor mirror: the ME owner's option cursor lands on the WATCHER's
  // read-only selector. #820: this (plus the probe/watchdog/revival hooks) used to be wired
  // ONLY in startLocalCoopSession - the DEV factory - so the LIVE path silently lacked them
  // (the 16:38 capture: 13 meCursor rx, zero applies). ONE factory now wires everything.
  controller.onMeCursor = index => {
    try {
      if (controller.isLocalOwnerAtCounter(coopMeInteractionStartValue())) {
        return; // we drive this ME - our own cursor rules
      }
      const mode = globalScene.ui?.getMode();
      const handler = globalScene.ui?.getHandler();
      // #818: the cursor mirror now covers the ER mini-game (quiz/braille/footprints)
      // screen too - it renders on BOTH clients under UiMode.ER_QUIZ, so the owner's
      // option cursor lands on the watcher's read-only quiz exactly as it does for a ME.
      // The er-quiz handler's setCursor clamps a stale index, so it can never crash here.
      const mirrorable = mode === UiMode.MYSTERY_ENCOUNTER || mode === UiMode.ER_QUIZ;
      if (mirrorable && typeof handler?.setCursor === "function") {
        handler.setCursor(index);
        coopLog("me", `meCursor APPLIED index=${index} mode=${mode}`);
      } else {
        coopLog(
          "me",
          `meCursor SKIPPED index=${index} mode=${mode} hasSetCursor=${typeof handler?.setCursor === "function"}`,
        );
      }
    } catch (e) {
      coopWarn("me", "meCursor apply threw", e);
    }
  };
  // #809: the partner asked THIS client to pick a Revival Blessing target for its own mon.
  interactionRelay.onRevivalPrompt = fieldIndex => {
    if (getCoopRuntime() !== runtime || runtime.controller.role === "host") {
      return;
    }
    try {
      globalScene.phaseManager.unshiftNew("CoopGuestRevivalPhase", fieldIndex);
    } catch (e) {
      coopWarn("replay", `revivalPrompt fieldIndex=${fieldIndex} could not queue the picker (${e}) - host auto-picks`);
    }
  };
  // #856: the host asked THIS client - the CATCHER - to drive the full-party keep/release picker for a
  // wild catch it threw. Queue the guest picker (the host awaits its relayed slot); the guest never runs
  // AttemptCapturePhase, so this is the only place the recipient's picker opens.
  interactionRelay.onCatchFullPrompt = (pokemonName, speciesId) => {
    if (getCoopRuntime() !== runtime || runtime.controller.role === "host") {
      return;
    }
    try {
      globalScene.phaseManager.unshiftNew("CoopGuestCatchFullPhase", pokemonName, speciesId);
    } catch (e) {
      coopWarn("replay", `catchFullPrompt sp=${speciesId} could not queue the picker (${e}) - host declines the grant`);
    }
  };
  // #807: a fresh SESSION starts a fresh tick line (assembly-scoped, NOT setCoopRuntime -
  // the duo harness re-registers runtimes per context swap and must not reset mid-session).
  resetCoopStateTicks();
  return runtime;
}

/**
 * Re-install the LAST-WRITE-WINS process-global co-op hooks for `runtime` (#633 bounded-scope: two-engine
 * harness). Three of the co-op hooks are NOT per-runtime state - they are module-level process-globals that
 * whichever runtime wired LAST owns: the er-ghost-teams ghost-pool PUBLISHER + guest FETCH-SUPPRESSION
 * predicate ({@linkcode wireCoopGhostPoolSync}) and the host live-battle-event EMITTER
 * ({@linkcode wireCoopLiveEvents}). In production there is exactly ONE runtime, so last-write-wins is
 * correct and this is never called. In the TWO-ENGINE harness both a host and a guest runtime coexist, so
 * the hook the guest wired last would answer for BOTH engines (wrong role gate). The cooperative scheduler
 * calls this after {@linkcode setCoopRuntime} on every client swap so the ACTIVE runtime owns its role-gated
 * hooks. Additive + idempotent; unused in production; the real two-client WebRTC path is untouched.
 */
export function installCoopRuntimeProcessHooks(runtime: CoopRuntime): void {
  installCoopRuntimeGhostHooks(runtime);
  installCoopRuntimeLiveEmitter(runtime);
}

/**
 * Re-point ONLY the er-ghost-teams ghost-pool PUBLISHER + guest FETCH-SUPPRESSION process-globals at
 * `runtime`'s role-gated closures ({@linkcode wireCoopGhostPoolSync}). Split out from
 * {@linkcode installCoopRuntimeProcessHooks} so the two-engine harness can route the GHOST hooks per
 * client on EVERY swap (a correctness fix - the guest must own suppression, the host the publisher) while
 * installing the live-event emitter ONLY for the tests that exercise it. Additive + idempotent; unused in
 * production.
 */
export function installCoopRuntimeGhostHooks(runtime: CoopRuntime): void {
  wireCoopGhostPoolSync(runtime.controller, runtime.battleStream);
}

/**
 * Re-point ONLY the host live-battle-event EMITTER process-global at `runtime`'s role-gated closure
 * ({@linkcode wireCoopLiveEvents}). Split out so the two-engine harness enables the LIVE per-event stream
 * (host emits, guest applies) only for the tests that assert it - the emitter self-gates to a no-op on a
 * guest/solo runtime, so installing the host runtime's emitter during host pumps is what turns the stream
 * ON. Additive + idempotent; unused in production (production wires it once at assembly).
 */
export function installCoopRuntimeLiveEmitter(runtime: CoopRuntime): void {
  wireCoopLiveEvents(runtime.controller, runtime.battleStream);
}

/** Tear down and forget the live co-op session (closing its transport). */
export function clearCoopRuntime(): void {
  // UI -> relay -> operation diagnostics are SESSION evidence. Reset even when there is no active runtime:
  // every production start/connect path clears first, so a fresh pairing must never inherit prior-run edges.
  resetCoopUiRelayTrace();
  if (active == null) {
    return;
  }
  try {
    // Normal title/save teardown may supersede an in-flight terminal. Never leak its phase-manager fence
    // into the next solo or co-op runtime.
    releaseCoopTerminalPhaseProgression();
  } catch {
    /* engine-free/pre-scene teardown */
  }
  // #808: invalidate every in-flight async continuation scheduled under this session.
  sessionGeneration++;
  coopLog(
    "launch",
    `clearCoopRuntime role=${active.controller.role} netcode=${active.controller.netcodeMode} gen->${sessionGeneration}`,
  );
  const sharedTerminal = sharedTerminalSupervisors.get(active);
  sharedTerminal?.dispose();
  sharedTerminalSupervisors.delete(active);
  clearPendingCoopSnapshotProof(active);
  active.controller.dispose();
  active.battleSync.dispose();
  active.battleStream.dispose();
  active.interactionRelay.dispose();
  active.uiMirror.dispose();
  active.mePump.endSession();
  active.rendezvous.dispose();
  active.durability?.dispose();
  // Wave-2e: drop the active-manager reference so a post-teardown adapter commit does not journal into a
  // disposed manager, and clear the journal-applied proof log for the next session.
  setCoopOperationDurability(null);
  resetCoopOperationJournalLog();
  active.spoof?.dispose();
  active.showdownSpoof?.dispose();
  // Drop the persistent move-learn forward listener + its in-flight slot set (#633 BUG3+5) so a
  // subsequent solo / lockstep run has no listener and spawns no CoopReplayLearnMovePhase.
  offLearnMoveForward?.();
  offLearnMoveForward = null;
  offLearnMoveBatchForward?.();
  offLearnMoveBatchForward = null;
  offDexSync?.();
  offDexSync = null;
  offDisconnectReaction?.();
  offDisconnectReaction = null;
  offStallWatchdog?.();
  offStallWatchdog = null;
  // A session teardown mid-faint-pick (disconnect / GameOver while a picker was open) must not leave the
  // watchdog-suppression pin set for the NEXT session - reset the depth to 0 (the pin is per-client global).
  resetCoopFaintSwitchWindows();
  // Wave-2a: drop the biome-travel operation state (host/guest appliers + last-applied pin) so a new
  // session's interaction counter (which re-inits from base 0) never collides with a prior session's ops.
  resetCoopBiomeOperationState();
  resetCoopAbilityOperationState();
  resetCoopBargainOperationState();
  resetCoopCatchFullOperationState();
  resetCoopColosseumOperationState();
  resetCoopFaintSwitchOperationState();
  resetCoopLearnMoveOperationState();
  resetCoopRevivalOperationState();
  resetCoopStormglassOperationState();
  // Wave-2d: drop the reward-shop + biome-market operation state too (SURFACE 3).
  resetCoopRewardOperationState();
  // Wave-2c: same teardown for the mystery-encounter operation surface.
  resetCoopMeOperationState();
  coopMeTerminalTransactions.reset();
  // Wave-2f: same teardown for the post-battle wave-advance operation surface (THE KEYSTONE).
  resetCoopWaveAdvanceOperationState();
  learnMoveForwardInFlight.clear();
  learnMoveBatchForwardInFlight.clear();
  active.localTransport.close();
  // Clear the co-op ghost-pool hooks so a subsequent SOLO run fetches normally (#633).
  setGhostPoolPublisher(null);
  setCoopGhostFetchSuppressed(null);
  // Clear the live-event emitter so a subsequent solo / lockstep run never streams battle events (#633).
  setCoopLiveEmitter(null);
  // #834 (structural audit P1-1): a mid-ME GameOver reaches here with the ME pins still SET
  // (only the ME terminal cleared them). Stale pins mis-arm the pin-guarded detached listeners
  // and the ME gates at the NEXT run's first encounter - a cross-run desync. Reset the full pin
  // family (setCoopMeInteractionStart(-1) also auto-clears the handoff + bespoke flags) and the
  // adopted host presentation alongside the battle-counter reset that already lived here.
  setCoopMeInteractionStart(-1);
  resetCoopActiveMysteryControl();
  // Reset the authoritative wave-advance state so a subsequent run starts clean (#633).
  pendingWaveAdvance = null;
  activeGuestWaveTransition = null;
  lastResolvedWave = -1;
  // Reset the wave-end authoritative snapshot state so a subsequent run starts clean (#838).
  pendingWaveEndState = null;
  lastWaveEndStateWave = -1;
  pendingHostWaveTransitions.clear();
  settledHostWaveTransitions.clear();
  pendingRawWavePresentations.clear();
  pendingSettledWaveBoundary = null;
  // Reset the ME battle handoff counter so a subsequent run starts clean (#633).
  coopMeBattleInteractionCounter = -1;
  // Clear the cycle-free authoritative-guest predicate so a subsequent solo / lockstep run reads false.
  setCoopAuthoritativeGuestPredicate(null);
  setShowdownGuestFlipPredicate(null);
  // #record-replay: stop + drop the captured trace at run teardown so the next run records fresh.
  clearReplayRecording();
  // Layer-B: drop the active per-runtime op-state so a post-teardown migrated-surface access fails LOUD
  // (never silently falls back to a stale/global cursor).
  setActiveCoopRuntimeOpState(null);
  active = null;
}

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
import type { Phase } from "#app/phase";
import {
  type CoopCommandOpenMaterialV2,
  type CoopInteractionOpenMaterialV2,
  commandOpenMaterialMustWaitForPresentation,
  decodeControlOpenEntry,
} from "#data/elite-redux/coop/authority-v2/adapters/control-open";
import {
  decodeReplacementCommitMaterial,
  type ReplacementAuthorityCarrier,
} from "#data/elite-redux/coop/authority-v2/adapters/faint-replacement";
import type { TurnResolutionImage } from "#data/elite-redux/coop/authority-v2/adapters/turn-command";
import {
  type CoopTerminalMaterialV2,
  type CoopWaveAdvanceDestination,
  type CoopWaveTransitionMaterialV2,
  classifyWaveSettlementCursor,
  digestOfMaterial,
  isValidTerminalMaterial,
  isValidWaveTransitionMaterial,
} from "#data/elite-redux/coop/authority-v2/adapters/wave-terminal";
import {
  resolveCoopV2CommandFrontier,
  resolveCoopV2ShowdownCommandProof,
} from "#data/elite-redux/coop/authority-v2/command-frontier";
import type {
  CoopAuthoritativeMaterial,
  CoopAuthorityEntry,
  CoopCommandControlTarget,
  CoopControlInstallResult,
  CoopNextControl,
  CoopRuntimeContext,
} from "#data/elite-redux/coop/authority-v2/contract";
import {
  CoopV2ControlLedger,
  type CoopV2InteractionSurfaceObservation,
} from "#data/elite-redux/coop/authority-v2/control-ledger";
import { CoopV2ControlCutover } from "#data/elite-redux/coop/authority-v2/cutover-control";
import {
  bindCoopV2InteractionCutover,
  COOP_V2_INTERACTION_SURFACES,
  CoopV2InteractionCutover,
  clearActiveCoopV2InteractionCutover,
  decodeCoopV2InteractionEnvelope,
  isCoopV2InteractionCutoverActive,
  isCoopV2InteractionEnabled,
  requiresCoopV2InteractionTerminalProof,
  setActiveCoopV2InteractionCutover,
  unbindCoopV2InteractionCutover,
} from "#data/elite-redux/coop/authority-v2/cutover-interaction";
import {
  type CoopV2ReplacementBatchResult,
  CoopV2ReplacementCutover,
  clearActiveCoopV2ReplacementCutover,
  isCoopV2ReplacementEnabled,
  setActiveCoopV2ReplacementCutover,
} from "#data/elite-redux/coop/authority-v2/cutover-replacement";
import {
  CoopV2TurnCutover,
  clearActiveCoopV2TurnCutover,
  isCoopV2TurnEnabled,
  setActiveCoopV2TurnCutover,
} from "#data/elite-redux/coop/authority-v2/cutover-turn";
import {
  CoopV2WaveCutover,
  clearActiveCoopV2WaveCutover,
  isCoopV2WaveCutoverActive,
  isCoopV2WaveEnabled,
  setActiveCoopV2WaveCutover,
} from "#data/elite-redux/coop/authority-v2/cutover-wave";
import {
  type CoopV2InteractionProjectionPlan,
  projectionPlanOfCoopV2InteractionEntry,
} from "#data/elite-redux/coop/authority-v2/interaction-projection";
import {
  commandControlTargetId,
  commandTargetsOwnedBySeat,
  controlIdOf,
  controlsEqual,
  type ProjectableControl,
  successorWaitAllowsLocalPresentationInput,
  validateNextControl,
} from "#data/elite-redux/coop/authority-v2/next-control";
import type {
  CoopV2InteractionProposalLease,
  CoopV2ProposalLeaseArmResult,
} from "#data/elite-redux/coop/authority-v2/proposal-lease";
import {
  type CoopRecoveryFencePredicatesV2,
  isCoopV2RecoveryEnabled,
} from "#data/elite-redux/coop/authority-v2/recovery-channel";
import type { ApplyMaterialResult } from "#data/elite-redux/coop/authority-v2/replica";
import { resolveCoopV2SessionIdentity } from "#data/elite-redux/coop/authority-v2/session-identity";
import {
  CoopAuthorityV2Shadow,
  type CoopV2LiveRecoverySeams,
  type CoopV2LiveReplicaSeams,
  type CoopV2ShadowIdentity,
  clearActiveCoopV2Shadow,
  clearCoopV2ShadowInbound,
  isCoopV2ShadowEnabled,
  registerCoopV2ShadowInbound,
  setActiveCoopV2Shadow,
} from "#data/elite-redux/coop/authority-v2/shadow";
import {
  armCoopAbilityJournalMaterialization,
  COOP_ABILITY_ACTION_STRIDE,
  isCoopAbilityOperationEnabled,
  isCoopAbilityOperationSettled,
  resetCoopAbilityOperationState,
  setCoopAbilityOperationRevisionFloor,
} from "#data/elite-redux/coop/coop-ability-operation";
import {
  COOP_ABILITY_KIND,
  COOP_ABILITY_OUTCOME,
  coopAbilityPickerSeq,
} from "#data/elite-redux/coop/coop-ability-picker-relay";
import {
  type CoopShowdownSeatAuthority,
  setCoopAuthoritativeGuestPredicate,
  setShowdownGuestFlipPredicate,
  setShowdownSeatAuthorityResolver,
} from "#data/elite-redux/coop/coop-authoritative-gate";
import { isCompleteCoopOperationAuthorityState } from "#data/elite-redux/coop/coop-authority-state-validator";
import {
  armCoopBargainJournalMaterialization,
  COOP_BARGAIN_PRESENT_KIND,
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
  drainCoopApplyFailures,
  reapplyAcceptedCoopAuthoritativeBattleState,
  resetCoopStateTicks,
} from "#data/elite-redux/coop/coop-battle-engine";
import {
  CoopBattleStreamer,
  type CoopStateSyncFailure,
  type CoopStateSyncOutcome,
  type CoopStateSyncResult,
  hasCoopV2ImmediateCommandSuccessor,
} from "#data/elite-redux/coop/coop-battle-stream";
import { CoopBattleSync, type CoopCommandTimeout } from "#data/elite-redux/coop/coop-battle-sync";
import {
  isCoopBiomeOperationEnabled,
  preflightCoopBiomeJournalMaterialization,
  publishCoopBiomeJournalMaterialization,
  resetCoopBiomeOperationState,
  setCoopBiomeOperationRevisionFloor,
} from "#data/elite-redux/coop/coop-biome-operation";
import {
  COOP_CAP_AUTHORITY_V2_INTERACTION,
  COOP_CAP_AUTHORITY_V2_RECOVERY,
  COOP_CAP_AUTHORITY_V2_REPLACEMENT,
  COOP_CAP_AUTHORITY_V2_SHADOW,
  COOP_CAP_AUTHORITY_V2_TURN,
  COOP_CAP_AUTHORITY_V2_WAVE,
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
import { type CoopControlPlaneSaveData, isCoopControlPlaneSaveData } from "#data/elite-redux/coop/coop-control-plane";
import { coopLog, coopWarn, isCoopDebug } from "#data/elite-redux/coop/coop-debug";
import { CoopDurabilityManager, isCoopDurabilityEnabled } from "#data/elite-redux/coop/coop-durability";
import {
  isCoopFaintSwitchOperationEnabled,
  materializeCoopFaintSwitchPickerTerminal,
  materializeCoopV2ReplacementPickerTerminal,
  resetCoopFaintSwitchOperationState,
  setCoopFaintSwitchOperationRevisionFloor,
} from "#data/elite-redux/coop/coop-faint-switch-operation";
import {
  COOP_BIOME_STOCK_REROLL,
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
  commitMeOwnerIntent,
  isCompleteCoopMeTerminalPayload,
  isCoopMeOperationEnabled,
  isCoopMeQuizAnswerOperationId,
  receiveCoopMeTerminalTransactionFor,
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
import { isCompleteCoopMeResyncOutcome } from "#data/elite-redux/coop/coop-me-terminal-validator";
import { CoopMembershipController } from "#data/elite-redux/coop/coop-membership";
import type {
  CoopAbilityPickPayload,
  CoopAbilityPresentationPayload,
  CoopAuthoritativeEnvelopeV1,
  CoopBargainPayload,
  CoopBargainPresentationPayload,
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
  CoopMeRewardSurfaceProjection,
  CoopMeSubPayload,
  CoopMeTerminalPayload,
  CoopQuizAnswerPayload,
  CoopRevivalPayload,
  CoopRewardActionPayload,
  CoopRewardPresentationPayload,
  CoopShopBuyPayload,
  CoopStormglassPayload,
  CoopStormglassPresentationPayload,
  CoopWaveAdvancePayload,
} from "#data/elite-redux/coop/coop-operation-envelope";
import {
  COOP_ME_BATTLE_SETTLED_CHOICE,
  COOP_ME_REWARD_SETTLED_CHOICE,
  parseCoopOperationId,
} from "#data/elite-redux/coop/coop-operation-envelope";
import { applyCoopOperationEpoch } from "#data/elite-redux/coop/coop-operation-epoch";
import {
  applyCoopOperationEnvelopeThroughRegisteredApplier,
  coopOperationDurabilityHooks,
  coopOperationRegistrationStatus,
  isCoopOperationJournalActive,
  isCoopOperationJournalActiveFor,
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
  setCoopOperationAuthorityStateProvider,
  withActiveCoopRuntimeOpState,
} from "#data/elite-redux/coop/coop-operation-runtime";
import {
  type CoopOperationSurfaceClass,
  type CoopV2InteractionOperationKind,
  coopV2InteractionSourceSurface,
  coopV2InteractionUiProofContract,
} from "#data/elite-redux/coop/coop-operation-surface-registry";
import { CoopRendezvous } from "#data/elite-redux/coop/coop-rendezvous";
import {
  isCoopRevivalOperationEnabled,
  resetCoopRevivalOperationState,
  setCoopRevivalOperationRevisionFloor,
} from "#data/elite-redux/coop/coop-revival-operation";
import {
  armCoopRewardJournalMaterialization,
  COOP_REWARD_ACTION_STRIDE,
  COOP_REWARD_SURFACE_ACTION_STRIDE,
  commitCoopRewardOptionsPresentation,
  isCoopRewardOperationEnabled,
  isValidCoopRewardSurfaceIdentity,
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
  COOP_REVIVAL_SEQ_BASE,
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
  coopMachineWaitLabels,
  createCoopAsymmetricEscalator,
  oldestCoopAsymmetricMachineWaitMs,
  oldestCoopMachineWaitMs,
} from "#data/elite-redux/coop/coop-stall-probe";
import {
  isCoopStormglassOperationEnabled,
  isCoopStormglassOperationSettled,
  resetCoopStormglassOperationState,
  setCoopStormglassOperationRevisionFloor,
} from "#data/elite-redux/coop/coop-stormglass-operation";
import type {
  CoopActiveControlSnapshotV1,
  CoopAuthoritativeBattleStateV1,
  CoopBattleCheckpoint,
  CoopBattleEvent,
  CoopCapturePresentation,
  CoopFullBattleSnapshot,
  CoopFullMonSnapshot,
  CoopInteractionOutcome,
  CoopMessage,
  CoopNetcodeMode,
  CoopRecoveryAdmissionV1,
  CoopRecoveryReason,
  CoopRole,
  CoopSerializedEnemy,
  CoopSerializedRewardOption,
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
import { isCoopRecording, setCoopLiveEmitter } from "#data/elite-redux/coop/coop-turn-recorder";
import { CoopUiMirror } from "#data/elite-redux/coop/coop-ui-mirror";
import { coopAuthorityContinuationSurface } from "#data/elite-redux/coop/coop-ui-registry";
import { resetCoopUiRelayTrace } from "#data/elite-redux/coop/coop-ui-relay-trace";
import {
  type CoopStagedWaveAdvanceTransaction,
  type CoopWaveAdvanceOperationBinding,
  commitWaveAdvanceOwnerIntent,
  describeCoopWaveAdvanceOperationBinding,
  getCoopPendingWaveAdvanceBoundary,
  getCoopPendingWaveContinuationBoundary,
  getCoopStagedWaveAdvanceTransaction,
  isCoopWaveAdvanceOperationEnabled,
  isCoopWaveAdvanceTransactionComplete,
  isValidCoopWaveAdvancePayload,
  markCoopWaveAdvanceBootstrapProjected,
  markCoopWaveAdvanceContinuationReady,
  resetCoopWaveAdvanceOperationState,
  resolveCoopBiomeBoundaryFlag,
  setCoopWaveAdvanceOperationRevisionFloor,
  tryApplyCoopWaveAdvanceDataAtBoundary,
} from "#data/elite-redux/coop/coop-wave-operation";
import { BARGAIN_SIN_ORDER } from "#data/elite-redux/er-bargain-sins";
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
import { MysteryEncounterMode } from "#enums/mystery-encounter-mode";
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
  installCoopRuntimeGhostProcessHooks(controller, battleStream);
  battleStream.onGhostPool(pool => {
    if (controller.role === "guest") {
      setCoopGhostPool(pool);
    }
  });
}

/**
 * Install only the two last-write-wins process globals. Unlike the stream's
 * receive handler these genuinely must follow the active synthetic browser in
 * the in-process duo harness.
 */
function installCoopRuntimeGhostProcessHooks(
  controller: CoopSessionController,
  battleStream: CoopBattleStreamer,
): void {
  setGhostPoolPublisher(pool => {
    if (controller.role === "host") {
      battleStream.sendGhostPool(pool);
    }
  });
  setCoopGhostFetchSuppressed(() => controller.role === "guest");
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

/**
 * Once shared interactions cut over, every legacy operation-journal mark is outside mechanical truth.
 * Keep unrelated durability classes, but never persist, recover, digest, or ACK an `op:*` cursor as V2 state.
 */
function authorityRelevantDurabilityMarks(
  runtime: CoopRuntime,
  marks: Readonly<Record<string, number>>,
): Record<string, number> {
  if (!isCoopV2InteractionCutoverActive(runtime.durability)) {
    return { ...marks };
  }
  return Object.fromEntries(Object.entries(marks).filter(([cls]) => !cls.startsWith("op:")));
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

/**
 * Authority V2 recovery admits DATA and membership only. The legacy `activeControl` image is deliberately
 * outside this preflight: its interaction counter, raw relay waits, rendezvous barriers, and pending command
 * requests are not an alternate source of progression truth. The correlated Authority V2 bundle supplies
 * the sole successor control and the ordinary V2 projector supplies the sole executable-control proof.
 */
function preflightCoopV2SnapshotMaterial(runtime: CoopRuntime, snapshot: CoopFullBattleSnapshot): boolean {
  return (
    snapshot.sessionEpoch === runtime.controller.sessionEpoch
    && snapshot.checksum != null
    && snapshot.checksum !== COOP_CHECKSUM_SENTINEL
    && snapshot.authoritativeState != null
    && snapshot.membership != null
    && snapshot.membership.state === "active"
    && snapshot.membership.members.every(member => member.present)
    && runtime.membership.canAdopt(snapshot.membership)
    && snapshot.activeControl == null
    && snapshot.controlDigest == null
    && Object.entries(snapshot.journalHighWater ?? {}).every(
      ([cls, value]) => !cls.startsWith("op:") && Number.isSafeInteger(value) && value >= 0,
    )
  );
}

/**
 * Immutable admission proof carried into the deferred snapshot phase. Legacy recovery owns a stream ticket;
 * Authority V2 owns a pre-request fence and revalidates that exact transaction before and after material apply.
 */
export type CoopSnapshotApplyAdmission =
  | { readonly kind: "legacy"; readonly ticket: CoopRecoveryAdmissionV1 }
  | {
      readonly kind: "authority-v2";
      readonly isCurrent: () => boolean;
      /** Keep CoopApplyResyncPhase current until the V2 transaction reopens the fence. */
      readonly retainUntilReleased: (release: () => void) => void;
    };

/** One admission predicate shared by inline Mystery recovery and the queued safe-boundary phase. */
export function isCoopSnapshotApplyAdmissionCurrent(
  runtime: CoopRuntime,
  snapshot: CoopFullBattleSnapshot,
  admission: CoopSnapshotApplyAdmission,
): boolean {
  if (admission.kind === "legacy") {
    return runtime.battleStream.recoveryAdmissionIsCurrent(admission.ticket, snapshot);
  }
  try {
    return admission.isCurrent();
  } catch {
    return false;
  }
}

function wireCoopResyncResponder(runtime: CoopRuntime): void {
  runtime.battleStream.onStateSyncRequest(ticket => {
    coopLog("resync", `recv requestStateSync id=${ticket.requestId} role=${runtime.controller.role}`);
    if (runtime.controller.role !== "host") {
      coopLog("resync", `ignore requestStateSync id=${ticket.requestId} (not host, role=${runtime.controller.role})`);
      return;
    }
    try {
      const snapshot = captureCoopFullSnapshot();
      if (snapshot == null) {
        coopWarn("resync", `host has no live snapshot for requestStateSync id=${ticket.requestId}`);
        runtime.battleStream.sendStateSyncUnavailable(ticket, "unavailable");
        return;
      }
      const stamped = bindCoopSnapshotControl({
        ...snapshot,
        sessionEpoch: runtime.controller.sessionEpoch,
        checksum: captureCoopChecksum(),
        membership: runtime.membership.snapshot(),
        activeControl: captureCoopActiveControl(runtime),
        journalHighWater: authorityRelevantDurabilityMarks(runtime, runtime.durability?.controlPlaneHighWater() ?? {}),
      } satisfies CoopFullBattleSnapshot);
      if (
        runtime.durability != null
        && !runtime.durability.retainSnapshotFrontier(stamped.controlDigest!, stamped.journalHighWater ?? {})
      ) {
        coopWarn("resync", `host refused unretained stateSync frontier id=${ticket.requestId}`);
        runtime.battleStream.sendStateSyncUnavailable(ticket, "unavailable");
        return;
      }
      const state = stamped.authoritativeState;
      if (state == null || stamped.controlDigest == null) {
        runtime.battleStream.sendStateSyncUnavailable(ticket, "unavailable");
        return;
      }
      const blob = compressToBase64(JSON.stringify(stamped));
      coopLog("resync", `send stateSync id=${ticket.requestId} blob=${blob.length}b`);
      runtime.battleStream.sendStateSync(blob, ticket, {
        wave: state.wave,
        turn: state.turn,
        stateTick: state.tick,
        controlDigest: stamped.controlDigest,
      });
    } catch (e) {
      /* a resync serialize/send failure must never break the host's turn */
      runtime.battleStream.sendStateSyncUnavailable(ticket, "unavailable");
      coopWarn("resync", `host stateSync send failed id=${ticket.requestId}`, e);
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
    || !runtime.durability.ackSnapshotMarksAfterTransaction(
      authorityRelevantDurabilityMarks(runtime, snapshot.journalHighWater ?? {}),
      snapshot.controlDigest!,
    )
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
  pendingCoopSnapshotProofs.set(runtime, {
    snapshot,
    cancelDeadline: () => clearTimeout(timeout),
  });
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
  const marks = isCoopV2InteractionCutoverActive(durability)
    ? Object.fromEntries(Object.entries(snapshot.journalHighWater ?? {}).filter(([cls]) => !cls.startsWith("op:")))
    : (snapshot.journalHighWater ?? {});
  for (const [cls, revision] of Object.entries(marks)) {
    if (Number.isFinite(revision) && revision > 0) {
      durability.adoptSnapshot(cls, revision);
    }
  }
  const globalRevision = isCoopV2InteractionCutoverActive(durability)
    ? 0
    : (snapshot.journalHighWater?.["op:global"] ?? 0);
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
  const v2InteractionCutover = isCoopV2InteractionCutoverActive(runtime.durability);
  const priorAppliedMarks = authorityRelevantDurabilityMarks(runtime, runtime.durability?.appliedMarks() ?? {});
  const guestClock = v2InteractionCutover ? null : getCoopGlobalGuestRevisionClock(runtime.controller.sessionEpoch, 0);
  const priorGlobalRevision = guestClock?.revision ?? 0;
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
    const globalRevision = v2InteractionCutover ? 0 : (snapshot.journalHighWater?.["op:global"] ?? 0);
    if (guestClock != null && globalRevision > guestClock.revision) {
      guestClock.revision = globalRevision;
    }
    runtime.durability?.adoptSnapshotMarksForTransaction(
      authorityRelevantDurabilityMarks(runtime, snapshot.journalHighWater ?? {}),
    );
  } catch (error) {
    let rollbackFailed = false;
    for (const restore of [
      () => runtime.durability?.restoreAppliedMarksForTransaction(priorAppliedMarks),
      () => {
        if (guestClock != null) {
          guestClock.revision = priorGlobalRevision;
        }
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

/**
 * Commit only the non-mechanical metadata attached to an Authority V2 recovery image. In particular this
 * must never restore a legacy interaction counter, Mystery presentation, rendezvous wait, pending command,
 * operation revision cursor, continuation release, or legacy snapshot proof.
 */
function commitCoopV2SnapshotMetadata(runtime: CoopRuntime, snapshot: CoopFullBattleSnapshot): boolean {
  if (snapshot.membership == null || snapshot.activeControl != null || snapshot.controlDigest != null) {
    return false;
  }
  const priorMembership = runtime.membership.snapshot();
  const priorAppliedMarks = authorityRelevantDurabilityMarks(runtime, runtime.durability?.appliedMarks() ?? {});
  try {
    if (!runtime.membership.adopt(snapshot.membership)) {
      throw new Error("membership refused after Authority V2 material preflight");
    }
    runtime.durability?.adoptSnapshotMarksForTransaction(
      authorityRelevantDurabilityMarks(runtime, snapshot.journalHighWater ?? {}),
    );
    return true;
  } catch (error) {
    let rollbackFailed = false;
    for (const restore of [
      () => runtime.durability?.restoreAppliedMarksForTransaction(priorAppliedMarks),
      () => runtime.membership.restoreForTransaction(priorMembership),
    ]) {
      try {
        restore();
      } catch {
        rollbackFailed = true;
      }
    }
    coopWarn("v2-recovery", "Authority V2 snapshot metadata commit rolled back", error);
    if (rollbackFailed) {
      failCoopSharedSession("Authority V2 snapshot metadata rollback failed");
    }
    return false;
  }
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
  admission: CoopSnapshotApplyAdmission,
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
  if (
    !preflightCoopAtomicSnapshot(runtime, snapshot)
    || !isCoopSnapshotApplyAdmissionCurrent(runtime, snapshot, admission)
  ) {
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

/**
 * Queue one DATA+CONTROL snapshot for safe-boundary apply. `onCompleted` observes the actual transactional
 * result, not mere queue admission; Authority V2 awaits it before adopting any log frontier.
 */
function queueCoopSnapshotApplyWithAdmission(
  runtime: CoopRuntime,
  snapshot: CoopFullBattleSnapshot,
  admission: CoopSnapshotApplyAdmission,
  label: string,
  onHealed?: (() => void) | undefined,
  onCompleted?: ((applied: boolean) => void) | undefined,
): boolean {
  const authorityV2 = admission.kind === "authority-v2";
  let completed = false;
  const complete = (applied: boolean): void => {
    if (completed) {
      return;
    }
    completed = true;
    try {
      onCompleted?.(applied);
    } catch (error) {
      coopWarn("resync", `${label} completion observer threw`, error);
    }
  };
  const snapshotId = `snapshot:e${snapshot.sessionEpoch ?? 0}:tick${snapshot.authoritativeState?.tick ?? snapshot.tick ?? 0}:${snapshot.checksum ?? "missing"}`;
  if (
    !(authorityV2 ? preflightCoopV2SnapshotMaterial(runtime, snapshot) : preflightCoopAtomicSnapshot(runtime, snapshot))
    || !isCoopSnapshotApplyAdmissionCurrent(runtime, snapshot, admission)
  ) {
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
    complete(false);
    return false;
  }
  const inlineMysteryApply = authorityV2
    ? null
    : tryApplyCoopActiveMysterySnapshotInline(runtime, snapshot, admission, label, onHealed);
  if (inlineMysteryApply != null) {
    complete(inlineMysteryApply);
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
  const applyPhase = globalScene.phaseManager.create(
    "CoopApplyResyncPhase",
    snapshot,
    snapshotTurn,
    snapshot.checksum ?? "",
    undefined,
    admission,
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
        complete(false);
        return true;
      }
      const metadataCommitted = authorityV2
        ? commitCoopV2SnapshotMetadata(runtime, snapshot)
        : commitCoopSnapshotControls(runtime, snapshot);
      if (!metadataCommitted) {
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
        coopWarn(
          "resync",
          `${label} material state healed but ${authorityV2 ? "V2 metadata" : "legacy control"} adoption failed`,
        );
        complete(false);
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
      complete(true);
      return true;
    },
  );
  if (admission.kind === "authority-v2") {
    if (!globalScene.phaseManager.replaceWithCoopRecoveryPhase(applyPhase)) {
      coopWarn("resync", `${label} could not claim the fenced phase frontier`);
      complete(false);
      return false;
    }
  } else {
    globalScene.phaseManager.pushPhase(applyPhase);
  }
  return true;
}

/** Legacy V1 snapshot queue entrypoint. */
export function queueCoopAtomicSnapshotApply(
  runtime: CoopRuntime,
  snapshot: CoopFullBattleSnapshot,
  admission: CoopRecoveryAdmissionV1,
  label: string,
  onHealed?: (() => void) | undefined,
): boolean {
  return queueCoopSnapshotApplyWithAdmission(runtime, snapshot, { kind: "legacy", ticket: admission }, label, onHealed);
}

/**
 * Authority V2 material install. The promise resolves only after exact checksum convergence and CONTROL
 * adoption. The phase itself remains current until the recovery channel reports frontier/control/proof
 * completion and releases the fence.
 */
function queueCoopV2AtomicSnapshotApply(
  runtime: CoopRuntime,
  snapshot: CoopFullBattleSnapshot,
  isCurrent: () => boolean,
  retainUntilReleased: (release: () => void) => void,
): Promise<boolean> {
  if (!preflightCoopV2SnapshotMaterial(runtime, snapshot) || !isCurrent()) {
    return Promise.resolve(false);
  }
  // A real orphaned V1 interaction wait can sit at the head of the phase queue. Cancel only waits the
  // peer has provably advanced past, and preserve faint/Mystery terminals whose exact retained operations
  // are reconstructed by the snapshot. This happens only after full V2 preflight and under the fence.
  const controller = runtime.controller;
  runtime.interactionRelay.cancelWaiters(
    seq =>
      !isCoopFaintSwitchSeq(seq) && !isCoopActiveMysteryWaitSeq(seq) && controller.peerAdvancedPastInteraction(seq),
  );
  return new Promise(resolve => {
    queueCoopSnapshotApplyWithAdmission(
      runtime,
      snapshot,
      { kind: "authority-v2", isCurrent, retainUntilReleased },
      "Authority V2 correlated recovery",
      undefined,
      resolve,
    );
  });
}

const COOP_V2_RECOVERY_MATERIAL_KIND = "COOP_FULL_BATTLE_SNAPSHOT";
const COOP_V2_RECOVERY_MATERIAL_VERSION = 1;

interface CoopV2RecoveryMaterialPayload {
  readonly kind: typeof COOP_V2_RECOVERY_MATERIAL_KIND;
  readonly version: typeof COOP_V2_RECOVERY_MATERIAL_VERSION;
  readonly snapshot: CoopFullBattleSnapshot;
}

function coopV2RecoveryMaterialDigest(payload: CoopV2RecoveryMaterialPayload): string {
  return fnv1a64(canonicalize(payload));
}

function isCoopV2RecoveryMaterialPayload(value: unknown): value is CoopV2RecoveryMaterialPayload {
  if (value == null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const payload = value as Partial<CoopV2RecoveryMaterialPayload>;
  return (
    payload.kind === COOP_V2_RECOVERY_MATERIAL_KIND
    && payload.version === COOP_V2_RECOVERY_MATERIAL_VERSION
    && payload.snapshot != null
    && typeof payload.snapshot === "object"
    && !Array.isArray(payload.snapshot)
  );
}

/**
 * Recovery capture is allowed only at a real input/network wait. A stable checksum alone is insufficient:
 * an animation can be between two scheduled mutations while its instantaneous checksum is perfectly stable.
 */
function isCoopV2RecoveryCaptureBoundary(control: CoopActiveControlSnapshotV1): boolean {
  return (
    activePublicSnapshotSurface() != null
    || control.awaitedInteractions.length > 0
    || control.pendingCommands.length > 0
    || control.barriers.awaiting.length > 0
  );
}

/**
 * Authority-side all-in-one capture. DATA, membership, and non-operation durability marks are read twice
 * without an async boundary. Legacy executable CONTROL is used only as a local capture-boundary observation;
 * it is never serialized into the V2 material. The bundle's log frontier + nextControl are the only recovery
 * authority. Any movement or non-public boundary returns null, leaving the correlated request lease alive
 * for the next safe boundary.
 */
function captureCoopV2RecoveryMaterial(
  runtime: CoopRuntime,
  ctx: CoopRuntimeContext,
): CoopAuthoritativeMaterial | null {
  if (
    runtime.controller.authorityRole !== "authority"
    || ctx.localSeatId !== ctx.authoritySeatId
    || ctx.epoch !== runtime.controller.sessionEpoch
  ) {
    return null;
  }
  const checksumBefore = captureCoopChecksum();
  if (checksumBefore === COOP_CHECKSUM_SENTINEL) {
    return null;
  }
  const membership = runtime.membership.snapshot();
  const captureBoundary = captureCoopActiveControl(runtime);
  const journalHighWater = authorityRelevantDurabilityMarks(runtime, runtime.durability?.controlPlaneHighWater() ?? {});
  if (
    membership.revision !== ctx.membershipRevision
    || membership.state !== "active"
    || membership.members.some(member => !member.present)
    || !isCoopV2RecoveryCaptureBoundary(captureBoundary)
  ) {
    return null;
  }
  const snapshot = captureCoopFullSnapshot();
  if (snapshot?.authoritativeState == null) {
    return null;
  }
  const stamped = {
    ...snapshot,
    sessionEpoch: runtime.controller.sessionEpoch,
    checksum: checksumBefore,
    membership,
    activeControl: undefined,
    journalHighWater,
    controlDigest: undefined,
  } satisfies CoopFullBattleSnapshot;

  const checksumAfter = captureCoopChecksum();
  const boundaryAfter = captureCoopActiveControl(runtime);
  const membershipAfter = runtime.membership.snapshot();
  const journalAfter = authorityRelevantDurabilityMarks(runtime, runtime.durability?.controlPlaneHighWater() ?? {});
  if (
    checksumAfter === COOP_CHECKSUM_SENTINEL
    || checksumAfter !== checksumBefore
    || canonicalize(captureBoundary) !== canonicalize(boundaryAfter)
    || canonicalize(membership) !== canonicalize(membershipAfter)
    || canonicalize(journalHighWater) !== canonicalize(journalAfter)
  ) {
    return null;
  }

  // Normalize to the exact JSON wire shape before hashing. The digest therefore proves every full-snapshot
  // field and cannot differ merely because an optional property was `undefined` before serialization.
  const payload = JSON.parse(
    JSON.stringify({
      kind: COOP_V2_RECOVERY_MATERIAL_KIND,
      version: COOP_V2_RECOVERY_MATERIAL_VERSION,
      snapshot: stamped,
    }),
  ) as CoopV2RecoveryMaterialPayload;
  return {
    digest: coopV2RecoveryMaterialDigest(payload),
    payload,
  };
}

/** One queued recovery phase per runtime; populated only after exact DATA+CONTROL material convergence. */
const pendingCoopV2RecoveryPhaseReleases = new WeakMap<CoopRuntime, () => void>();

function retainCoopV2RecoveryPhase(runtime: CoopRuntime, release: () => void): void {
  if (pendingCoopV2RecoveryPhaseReleases.has(runtime)) {
    coopWarn("v2-recovery", "replaced an unexpected prior parked recovery-phase release");
  }
  pendingCoopV2RecoveryPhaseReleases.set(runtime, release);
}

function releaseCoopV2RecoveryPhase(runtime: CoopRuntime): boolean {
  const release = pendingCoopV2RecoveryPhaseReleases.get(runtime);
  if (release == null) {
    return true;
  }
  pendingCoopV2RecoveryPhaseReleases.delete(runtime);
  if (coopV2RecoveryFencePredicates(runtime)?.isProgressionFrozen() === true) {
    return globalScene.phaseManager.releaseCoopRecoveryControlPhase(release);
  }
  release();
  return true;
}

function abandonCoopV2RecoveryPhase(runtime: CoopRuntime): void {
  pendingCoopV2RecoveryPhaseReleases.delete(runtime);
}

/** Host-side deep-gap escalation: push a heavy snapshot stamped at the evicted class's journal head. */
function sendCoopDurabilitySnapshot(
  runtime: CoopRuntime,
  cls: string,
  headRevision: number,
  controlHighWater: Record<string, number>,
): boolean {
  if (runtime.controller.role !== "host") {
    coopWarn("resync", `durability snapshot sender invoked on ${runtime.controller.role} cls=${cls}`);
    return false;
  }
  try {
    const snapshot = captureCoopFullSnapshot();
    if (snapshot == null) {
      coopWarn("resync", `durability snapshot unavailable cls=${cls} head=${headRevision}`);
      return false;
    }
    const stamped = bindCoopSnapshotControl({
      ...snapshot,
      sessionEpoch: runtime.controller.sessionEpoch,
      checksum: captureCoopChecksum(),
      membership: runtime.membership.snapshot(),
      activeControl: captureCoopActiveControl(runtime),
      journalHighWater: authorityRelevantDurabilityMarks(runtime, {
        ...controlHighWater,
        [cls]: Math.max(controlHighWater[cls] ?? 0, headRevision),
      }),
    } satisfies CoopFullBattleSnapshot);
    if (
      runtime.durability != null
      && !runtime.durability.retainSnapshotFrontier(stamped.controlDigest!, stamped.journalHighWater ?? {})
    ) {
      coopWarn("resync", `durability snapshot frontier refused cls=${cls} head=${headRevision}`);
      return false;
    }
    const state = stamped.authoritativeState;
    if (state == null || stamped.controlDigest == null) {
      coopWarn("resync", `durability snapshot missing modern capture proof cls=${cls} head=${headRevision}`);
      return false;
    }
    return runtime.battleStream.sendDurabilitySnapshot(compressToBase64(JSON.stringify(stamped)), {
      wave: state.wave,
      turn: state.turn,
      stateTick: state.tick,
      controlDigest: stamped.controlDigest,
    });
  } catch (e) {
    coopWarn("resync", `durability snapshot send failed cls=${cls} head=${headRevision}`, e);
    return false;
  }
}

/** Guest-side deep-gap application: mutate live state, then ACK exactly the revisions it subsumed. */
function wireCoopDurabilitySnapshotReceiver(runtime: CoopRuntime): void {
  runtime.battleStream.onDurabilitySnapshot(({ blob, admission }) => {
    if (runtime.controller.role !== "guest") {
      failCoopRuntimeSharedSession(runtime, "A durability recovery snapshot reached the non-renderer peer.");
      return;
    }
    try {
      const snapshot = JSON.parse(decompressFromBase64(blob)) as CoopFullBattleSnapshot;
      if (
        !queueCoopAtomicSnapshotApply(runtime, snapshot, admission, `durability deep-gap snapshot blob=${blob.length}b`)
      ) {
        failCoopRuntimeSharedSession(runtime, "Durability deep-gap snapshot was not admissible at the live frontier.");
      }
    } catch (e) {
      coopWarn("resync", "durability deep-gap snapshot apply failed", e);
      failCoopRuntimeSharedSession(runtime, "Durability deep-gap snapshot could not be decoded or queued.");
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
  /** Authority turn whose terminal commit causally follows every live event for this wave. */
  settledTurn?: number | undefined;
  captureParty?: string[] | undefined;
  capturePresentation?: CoopCapturePresentation | undefined;
  /** The host's complete control statement. Present on current peers and journal recovery. */
  transition?: CoopWaveAdvancePayload | undefined;
}

let pendingWaveAdvance: CoopPendingWaveAdvance | null = null;
/** Engine-phase factory installed by coop-replay-phases without coupling this runtime module to phase classes. */
let coopWaveAdvanceBoundaryWakeFactory: (() => Phase) | null = null;
/** Replay-phase abort seam installed without introducing a runtime -> replay-turn-phase import cycle. */
let coopActiveReplayTurnAborter: ((reason: string, settledTurn: number) => boolean) | null = null;
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
let pendingWaveEndState: {
  wave: number;
  state: CoopAuthoritativeBattleStateV1;
} | null = null;
/** The last wave the guest already applied a wave-end authoritative snapshot for. */
let lastWaveEndStateWave = -1;

/** Host transition staged by the early raw waveResolved hint and completed only after BattleEnd settles. */
const pendingHostWaveTransitions = new Map<number, CoopWaveAdvancePayload>();
/** Settled host transactions retained by wave, including a terminal victory that supersedes GameOver's echo. */
const settledHostWaveTransitions = new Map<number, CoopWaveAdvancePayload>();
/**
 * A normal victory observed while its material battle turn is still recording. The transition is staged
 * immediately so BattleEnd can freeze its identity, but its raw compatibility hint cannot leave the host
 * until the immutable turn commit has been accepted for retention.
 */
const deferredHostWaveResolved = new Map<
  number,
  {
    outcome: CoopWaveOutcome;
    captureParty?: string[] | undefined;
    presentation?: CoopCapturePresentation | undefined;
    transition: CoopWaveAdvancePayload;
  }
>();
/**
 * One normal victory whose BattleEnd cleanup has completed but whose automatic post-victory children have
 * not drained yet. Runtime-keying is load-bearing in the two-engine harness: the host and guest coexist in
 * one process and may alternate the ambient runtime while their independent phase queues advance.
 */
const pendingAutomaticVictorySeals = new WeakMap<CoopRuntime, CoopPendingAutomaticVictorySeal>();
/** Presentation-only data from a raw hint; never sufficient to advance a retained P33 session. */
const pendingRawWavePresentations = new Map<number, CoopCapturePresentation>();
/** A retained guest BattleEnd waiting for its exact immutable DATA image to apply. */
let pendingSettledWaveBoundary: {
  wave: number;
  release: () => void;
  released: boolean;
} | null = null;

/** Immutable phase-owned identity for the automatic normal-victory settlement boundary. */
export interface CoopAutomaticVictorySealIdentity {
  readonly runtime: CoopRuntime;
  readonly binding: CoopWaveAdvanceOperationBinding;
  readonly wave: number;
  /** The host captures this at the resolving battle. The guest learns it from retained DATA at admission. */
  readonly turn: number | null;
}

interface CoopPendingAutomaticVictorySeal {
  readonly identity: CoopAutomaticVictorySealIdentity;
  readonly transition: CoopWaveAdvancePayload;
  /** BattleEnd may legitimately advance the ambient turn once; freeze that post-battle address for sealing. */
  readonly settlementTurn: number;
}

function usesRetainedCoopWaveTransaction(runtime: CoopRuntime | null = active): boolean {
  // Showdown-versus reuses the authoritative battle stream, but it has no co-op wave/reward tail:
  // a KO is settled by showdownResult instead of WAVE_ADVANCE. Admitting a versus runtime here
  // makes VictoryPhase wait for a transition that broadcastCoopWaveResolved deliberately never
  // creates outside GameModes.COOP, so the valid KO is misclassified as a missing source boundary
  // and both players are torn down before the result can be delivered.
  return (
    runtime != null
    && !runtime.controller.isVersusSession()
    && (coopV2WaveCutovers.has(runtime)
      || (isCoopWaveAdvanceOperationEnabled()
        && isCoopCapabilityNegotiated(COOP_CAP_OP_WAVE)
        && isCoopOperationJournalActiveFor(runtime.waveOperationBinding.durability)))
  );
}

/**
 * Capture the runtime and source address that a later automatic-victory seal phase must still own. The
 * host turn is available from the resolving battle. A retained guest may already present a speculative
 * next-wave Battle object when its host-stated VictoryPhase is materialized, so it deliberately defers the
 * turn read until the exact retained DATA envelope is admitted; mutable ambient state is never substituted.
 */
export function captureCoopAutomaticVictorySealIdentity(wave: number): CoopAutomaticVictorySealIdentity | null {
  const runtime = active;
  if (runtime == null || !usesRetainedCoopWaveTransaction(runtime)) {
    return null;
  }
  const binding = runtime.waveOperationBinding;
  let turn: number | null = null;
  if (runtime.controller.role === "host") {
    const staged = pendingHostWaveTransitions.get(wave);
    if (staged?.outcome === "capture") {
      return null;
    }
    const currentWave = globalScene.currentBattle?.waveIndex ?? -1;
    const currentTurn = globalScene.currentBattle?.turn ?? -1;
    if (staged?.outcome !== "win" || currentWave !== wave || !Number.isSafeInteger(currentTurn) || currentTurn < 0) {
      failCoopSharedSession(
        "The automatic victory boundary could not capture its source address "
          + `(requested ${wave}, ambient ${currentWave}:${currentTurn}, outcome ${staged?.outcome ?? "missing"}).`,
      );
      turn = -1;
    } else {
      turn = currentTurn;
    }
  } else {
    const transition = getCoopActiveWaveTransition(wave);
    if (transition?.outcome === "capture") {
      return null;
    }
    if (transition?.outcome !== "win" || transition.wave !== wave) {
      failCoopSharedSession(`The renderer could not capture the retained normal-victory boundary for wave ${wave}.`);
    }
  }
  return Object.freeze({ runtime, binding, wave, turn });
}

/** Capture queues VictoryPhase after it already announced CAPTURE; preserve its BattleEnd settlement path. */
export function isCoopHostCaptureTransitionPending(wave: number): boolean {
  return active?.controller.role === "host" && pendingHostWaveTransitions.get(wave)?.outcome === "capture";
}

/**
 * HOST BattleEnd handoff: defer only a normal retained WIN. Capture and flee retain their established
 * BattleEnd settlement, while legacy/non-journal sessions continue to publish immediately. Returning true
 * means BattleEnd must not call the legacy sealer even when validation failed—the shared terminal path is
 * already armed and publishing a partial image would violate the boundary.
 */
export function deferCoopAutomaticVictorySealAtBattleEnd(identity: CoopAutomaticVictorySealIdentity | null): boolean {
  if (identity == null) {
    return false;
  }
  const runtime = active;
  if (runtime == null || runtime !== identity.runtime || runtime.waveOperationBinding !== identity.binding) {
    failCoopSharedSession(`The automatic victory boundary for wave ${identity.wave} lost its owning runtime.`);
    return true;
  }
  if (!usesRetainedCoopWaveTransaction(runtime)) {
    failCoopSharedSession(`The automatic victory boundary for wave ${identity.wave} lost retained delivery.`);
    return true;
  }
  if (runtime.controller.role === "guest") {
    if (coopV2WaveCutovers.has(runtime)) {
      const staged = runtime.v2WaveTransactions.get(identity.wave);
      if (
        staged == null
        || staged.dataApplied !== true
        || staged.transition.outcome !== "win"
        || staged.transition.wave !== identity.wave
      ) {
        failCoopSharedSession(
          `The renderer reached BattleEnd before the Authority V2 victory state for wave ${identity.wave} `
            + `(applied ${staged?.dataApplied === true}).`,
        );
        return true;
      }
      coopLog("v2-wave", `GUEST automatic victory settlement deferred wave=${identity.wave}`);
      return true;
    }
    const staged = getCoopStagedWaveAdvanceTransaction(identity.wave, identity.binding);
    const payload = staged?.envelope.pendingOperation?.payload;
    if (
      staged == null
      || staged.dataApplied !== true
      || !isValidCoopWaveAdvancePayload(payload)
      || payload.outcome !== "win"
      || payload.wave !== identity.wave
    ) {
      failCoopSharedSession(
        `The renderer reached BattleEnd before the retained automatic victory state for wave ${identity.wave} `
          + `(applied ${staged?.dataApplied === true}).`,
      );
      return true;
    }
    // The complete host image has already been admitted. Skip the legacy/raw BattleEnd publisher and let
    // the queued CoopVictorySealPhase prove the same staged identity before any continuation surface opens.
    coopLog("progression", `GUEST automatic victory settlement deferred wave=${identity.wave}`);
    return true;
  }
  if (runtime.controller.role !== "host") {
    failCoopSharedSession(
      `An unknown co-op seat attempted to stage the automatic victory boundary for wave ${identity.wave}.`,
    );
    return true;
  }
  const transition = pendingHostWaveTransitions.get(identity.wave);
  const currentWave = globalScene.currentBattle?.waveIndex ?? -1;
  const currentTurn = globalScene.currentBattle?.turn ?? -1;
  if (
    transition?.outcome !== "win"
    || transition.wave !== identity.wave
    || identity.turn == null
    || identity.turn < 0
    || currentWave !== identity.wave
    || !Number.isSafeInteger(currentTurn)
    || currentTurn !== identity.turn + 1
  ) {
    failCoopSharedSession(
      "The automatic victory boundary did not match BattleEnd "
        + `(source ${identity.wave}:${identity.turn ?? "unresolved"}, ambient ${currentWave}:${currentTurn}, `
        + `outcome ${transition?.outcome ?? "missing"}).`,
    );
    return true;
  }
  if (pendingAutomaticVictorySeals.has(runtime)) {
    failCoopSharedSession(`A duplicate automatic victory boundary was staged for wave ${identity.wave}.`);
    return true;
  }
  pendingAutomaticVictorySeals.set(runtime, { identity, transition, settlementTurn: currentTurn });
  coopLog(
    "progression",
    `HOST automatic victory settlement deferred wave=${identity.wave} sourceTurn=${identity.turn} settlementTurn=${currentTurn}`,
  );
  return true;
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

/** Exact proof that the queued BattleEnd for `wave` currently owns retained DATA admission. */
export function isCoopSettledWaveBoundaryPending(wave: number): boolean {
  return pendingSettledWaveBoundary?.wave === wave && pendingSettledWaveBoundary.released === false;
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
function tryApplyCoopSettledWaveData(wave: number, binding: CoopWaveAdvanceOperationBinding): boolean {
  const runtime = active;
  if (runtime != null && coopV2WaveCutovers.has(runtime)) {
    const transaction = runtime.v2WaveTransactions.get(wave);
    if (transaction == null) {
      coopWarn("v2-wave", `retained DATA missing wave=${wave}`);
      return false;
    }
    if (!applyCoopV2WaveDataAtBoundary(runtime, transaction)) {
      return false;
    }
    return true;
  }
  const staged = getCoopStagedWaveAdvanceTransaction(wave, binding);
  if (staged == null) {
    const evidence = describeCoopWaveAdvanceOperationBinding(binding);
    coopWarn(
      "progression",
      `retained WAVE_ADVANCE DATA missing wave=${wave} bindingRole=${evidence.role ?? "unset"} `
        + `stagedWaves=[${evidence.stagedWaves.join(",")}] stagedIds=[${evidence.stagedOperationIds.join(",")}]`,
    );
    return false;
  }
  if (staged.dataApplied) {
    return releaseCoopSettledWaveBoundary(wave);
  }
  const outcome = tryApplyCoopWaveAdvanceDataAtBoundary(wave, binding);
  if (outcome === "rejected") {
    coopWarn("progression", `retained WAVE_ADVANCE DATA apply rejected wave=${wave}`);
    failCoopSharedSession(`Could not apply the complete retained state for wave ${wave}.`);
    return false;
  }
  if (outcome !== "applied") {
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
export function awaitCoopSettledWaveAdvanceAtBattleEnd(
  release: () => void,
  binding: CoopWaveAdvanceOperationBinding | null = active?.waveOperationBinding ?? null,
  sourceWave: number = globalScene.currentBattle?.waveIndex ?? -1,
): boolean {
  const runtime = active;
  if (runtime == null || binding == null || !isCoopAuthoritativeGuest() || !usesRetainedCoopWaveTransaction(runtime)) {
    return false;
  }
  const wave = sourceWave;
  if (!Number.isSafeInteger(wave) || wave < 0) {
    failCoopSharedSession("The retained post-battle boundary had no valid source wave.");
    return true;
  }
  const v2Staged = coopV2WaveCutovers.has(runtime) ? runtime.v2WaveTransactions.get(wave) : null;
  const staged = v2Staged == null ? getCoopStagedWaveAdvanceTransaction(wave, binding) : null;
  // A real Mystery battle is the continuation of an already-retained ME terminal transaction. Its
  // BattleEnd returns through PostMysteryEncounterPhase and must never synthesize a colliding WAVE_ADVANCE.
  // Ambient state is allowed to exempt this tail only when it still describes the exact source wave and
  // no addressed WAVE_ADVANCE exists. A speculative next-wave Mystery battle cannot steal ownership from
  // an already-staged ordinary victory (the wave-11 -> speculative ME wave-12 regression).
  const ambientBattle = globalScene.currentBattle;
  if (
    staged == null
    && v2Staged == null
    && ambientBattle?.waveIndex === wave
    && ambientBattle.isBattleMysteryEncounter?.()
  ) {
    return false;
  }
  pendingSettledWaveBoundary = { wave, release, released: false };
  tryApplyCoopSettledWaveData(wave, binding);
  return true;
}

type CoopPhaseOwnedWaveContinuationSurface = "biomeMarketWatcher" | "crossroads";

function phaseOwnedWaveContinuationIsPublic(
  staged: CoopStagedWaveAdvanceTransaction,
  surface: CoopPhaseOwnedWaveContinuationSurface,
): boolean {
  if (!staged.dataApplied) {
    return false;
  }
  const payload = staged.envelope.pendingOperation?.payload as CoopWaveAdvancePayload;
  try {
    switch (surface) {
      case "biomeMarketWatcher": {
        // The non-owner side of a biome market deliberately never opens BIOME_SHOP. Its executable
        // continuation is the SelectModifierPhase-owned watcher after authoritative stock has been
        // reconstructed and while the partner-facing MESSAGE handler is live. Keep this attestation
        // phase-, mode-, handler-, and address-bound so an arbitrary message screen cannot release a
        // retained victory.
        const currentWave = globalScene.currentBattle?.waveIndex ?? -1;
        const currentPhase = globalScene.phaseManager?.getCurrentPhase() as
          | { phaseName?: string; coopBiomeWatcherContinuationReady?: boolean }
          | undefined;
        return (
          currentPhase?.phaseName === "SelectModifierPhase"
          && currentPhase.coopBiomeWatcherContinuationReady === true
          && globalScene.ui.getMode() === UiMode.MESSAGE
          && globalScene.ui.getHandler()?.active === true
          && (currentWave === payload.wave || currentWave === payload.nextWave)
        );
      }
      case "crossroads": {
        // OPTION_SELECT is deliberately absent from the generic registry because many unrelated local and
        // account-only screens use it. Crossroads owns an explicit attestation after its real picker promise
        // has committed; accept only that exact phase + mode + active-handler tuple.
        const currentWave = globalScene.currentBattle?.waveIndex ?? -1;
        return (
          globalScene.phaseManager?.getCurrentPhase()?.phaseName === "ErCrossroadsPhase"
          && globalScene.ui.getMode() === UiMode.OPTION_SELECT
          && globalScene.ui.getHandler()?.active === true
          && (currentWave === payload.wave || currentWave === payload.nextWave)
        );
      }
    }
  } catch {
    return false;
  }
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

function retainedWaveContinuationAckProof(
  staged: CoopStagedWaveAdvanceTransaction,
  phaseOwnedSurface?: CoopPhaseOwnedWaveContinuationSurface,
): { surface: "command" | "sharedInput" | "terminal"; address: { epoch: number; wave: number; turn: number } } | null {
  const payload = staged.envelope.pendingOperation?.payload as CoopWaveAdvancePayload;
  const currentWave = globalScene.currentBattle?.waveIndex ?? -1;
  const currentTurn = globalScene.currentBattle?.turn ?? -1;
  if (!Number.isSafeInteger(currentWave) || currentWave < 0 || !Number.isSafeInteger(currentTurn) || currentTurn < 0) {
    return null;
  }
  let surface: "command" | "sharedInput" | "terminal" | null = null;
  if (
    payload.outcome === "gameOver"
    || ((payload.outcome === "win" || payload.outcome === "capture") && payload.nextWave === payload.wave)
  ) {
    surface = "terminal";
  } else if (
    phaseOwnedSurface != null
    || globalScene.phaseManager?.getCurrentPhase()?.phaseName === "SelectBiomePhase"
  ) {
    surface = "sharedInput";
  } else {
    try {
      surface = coopAuthorityContinuationSurface(globalScene.ui.getMode());
    } catch {
      return null;
    }
  }
  return surface == null
    ? null
    : {
        surface,
        address: { epoch: staged.envelope.sessionEpoch, wave: currentWave, turn: currentTurn },
      };
}

function maybeMarkCoopWaveContinuationReady(
  wave: number,
  binding: CoopWaveAdvanceOperationBinding,
  runtime: CoopRuntime,
  phaseOwnedSurface?: CoopPhaseOwnedWaveContinuationSurface,
): boolean {
  const staged = getCoopStagedWaveAdvanceTransaction(wave, binding);
  if (staged == null) {
    return false;
  }
  const publicSurface =
    phaseOwnedSurface == null
      ? retainedWaveContinuationIsPublic(staged)
      : phaseOwnedWaveContinuationIsPublic(staged, phaseOwnedSurface);
  if (!staged.continuationReady && publicSurface) {
    markCoopWaveAdvanceContinuationReady(wave, binding);
    coopLog("progression", `retained WAVE_ADVANCE continuationReady wave=${wave}`);
  }
  const complete = isCoopWaveAdvanceTransactionComplete(wave, binding);
  if (complete) {
    const proof = retainedWaveContinuationAckProof(staged, phaseOwnedSurface);
    if (proof != null) {
      const released =
        binding.durability?.completeRetainedWaveAdvance(staged.envelope, proof.surface, proof.address) === true;
      if (released) {
        // Replacement and WAVE_ADVANCE are independent retained transports. A replacement checkpoint can
        // arrive after the guest has already rendered that switch and admitted the later post-battle DATA.
        // The completed wave proof is then the only safe authority capable of retiring that late checkpoint.
        runtime.battleStream.acknowledgeReplacementsSubsumedByOperation(staged.envelope);
      }
    }
  }
  return complete;
}

/**
 * GUEST: publish the retained wave transaction's final readiness latch from a real, already-open public
 * continuation surface. The boundary DATA and UI surface are deliberately verified again here; merely
 * constructing a phase or receiving an envelope cannot mark the transaction ready. Idempotent and a hard
 * no-op outside the retained authoritative guest path.
 *
 * Reward/shop phases call this after their UI promise commits. WAVE_ADVANCE advances receive ordering at
 * staging but keeps the host's immutable journal entry retained; this engine-owned wake publishes its exact
 * DATA-applied + destination-continuation proof so a transaction can neither release early nor wait forever.
 */
export interface CoopRetainedWaveContinuationAddress {
  readonly wave: number;
  readonly turn: number;
}

export type CoopRetainedWaveContinuationIdentity =
  | { readonly kind: "ambient" }
  | { readonly kind: "retained"; readonly address: CoopRetainedWaveContinuationAddress }
  | { readonly kind: "invalid"; readonly reason: string };

/**
 * Resolve the immutable source identity for a retained guest continuation. A caller that is actually
 * opening the post-battle surface must never reinterpret `null` as permission to use mutable scene state:
 * zero candidates means the retained boundary was lost, while multiple candidates mean the continuation
 * is ambiguous. Both are deterministic shared-terminal conditions by default. A phase that independently
 * captures an immutable non-wave source may opt into ambient identity only when there are exactly zero
 * candidates; ambiguity remains invalid. Host, solo, lockstep and explicitly non-wave surfaces keep their
 * ambient behavior.
 */
export function resolveCoopRetainedWaveContinuationIdentity(
  requireWaveBoundary: boolean,
  allowMissingWaveBoundary = false,
): CoopRetainedWaveContinuationIdentity {
  const runtime = active;
  if (runtime == null || !isCoopAuthoritativeGuest() || !usesRetainedCoopWaveTransaction(runtime)) {
    return { kind: "ambient" };
  }
  if (!requireWaveBoundary) {
    return { kind: "ambient" };
  }
  if (coopV2WaveCutovers.has(runtime)) {
    const candidates = [...runtime.v2WaveTransactions.values()]
      .map(transaction => ({
        operationId: transaction.operationId,
        turn: transaction.authoritativeState.turn,
        wave: transaction.transition.wave,
      }))
      .sort((a, b) => a.wave - b.wave || a.turn - b.turn || a.operationId.localeCompare(b.operationId));
    if (candidates.length === 1) {
      return { kind: "retained", address: { wave: candidates[0].wave, turn: candidates[0].turn } };
    }
    if (allowMissingWaveBoundary && candidates.length === 0) {
      return { kind: "ambient" };
    }
    const classification = candidates.length === 0 ? "missing" : "ambiguous";
    return {
      kind: "invalid",
      reason:
        `[authority-v2] retained wave continuation identity ${classification}: `
        + `candidates=[${candidates.map(candidate => `${candidate.operationId}@${candidate.wave}:${candidate.turn}`).join(",")}]`,
    };
  }
  const address = getCoopPendingWaveContinuationBoundary(runtime.waveOperationBinding);
  if (address != null) {
    return { kind: "retained", address };
  }

  const binding = runtime.waveOperationBinding;
  const staged = describeCoopWaveAdvanceOperationBinding(binding);
  const candidates = staged.stagedWaves
    .map(wave => getCoopStagedWaveAdvanceTransaction(wave, binding))
    .filter(
      (transaction): transaction is CoopStagedWaveAdvanceTransaction =>
        transaction != null && !transaction.continuationReady,
    )
    .map(transaction => ({
      operationId: transaction.operationId,
      turn: transaction.envelope.authoritativeState.turn,
      wave: (transaction.envelope.pendingOperation?.payload as CoopWaveAdvancePayload | undefined)?.wave ?? -1,
    }))
    .sort((a, b) => a.wave - b.wave || a.turn - b.turn || a.operationId.localeCompare(b.operationId));
  // SelectBiomePhase is also entered by Crossroads, moves, abilities and Mystery Events after the previous
  // WAVE_ADVANCE has already reached continuationReady and released. Those callers capture their ambient
  // source synchronously at phase construction and may explicitly accept a truly absent wave candidate.
  // A reward/shop boundary never opts in, and one or more unresolved-but-unaddressable candidates remain
  // invalid for every caller, so ambiguity can never fall back to mutable scene state.
  if (allowMissingWaveBoundary && candidates.length === 0) {
    return { kind: "ambient" };
  }
  const classification = candidates.length === 0 ? "missing" : candidates.length > 1 ? "ambiguous" : "invalid";
  const reason =
    `[coop-op] retained wave continuation identity ${classification}: candidateCount=${candidates.length} `
    + `candidates=[${candidates.map(candidate => `${candidate.operationId}@${candidate.wave}:${candidate.turn}`).join(",")}] `
    + `stagedWaves=[${[...staged.stagedWaves].sort((a, b) => a - b).join(",")}] `
    + `stagedOperationIds=[${[...staged.stagedOperationIds].sort().join(",")}]`;
  return { kind: "invalid", reason };
}

/** Compatibility read for diagnostics that do not own a public continuation surface. */
export function getCoopRetainedWaveContinuationAddress(): CoopRetainedWaveContinuationAddress | null {
  const runtime = active;
  if (runtime == null || !isCoopAuthoritativeGuest() || !usesRetainedCoopWaveTransaction(runtime)) {
    return null;
  }
  if (coopV2WaveCutovers.has(runtime)) {
    const candidates = [...runtime.v2WaveTransactions.values()];
    return candidates.length === 1
      ? { wave: candidates[0].transition.wave, turn: candidates[0].authoritativeState.turn }
      : null;
  }
  return getCoopPendingWaveContinuationBoundary(runtime.waveOperationBinding);
}

/** Phase-construction proof for the exact retained wave whose BattleEnd is being queued. */
export function getCoopPendingRetainedWaveBoundary(
  runtime: CoopRuntime | null = active,
): { readonly wave: number; readonly victoryKind: CoopWaveAdvancePayload["victoryKind"] } | null {
  if (runtime == null || !usesRetainedCoopWaveTransaction(runtime)) {
    return null;
  }
  if (coopV2WaveCutovers.has(runtime)) {
    const candidates = [...runtime.v2WaveTransactions.values()].filter(transaction => !transaction.dataApplied);
    return candidates.length === 1
      ? {
          wave: candidates[0].transition.wave,
          victoryKind: candidates[0].transition.victoryKind,
        }
      : null;
  }
  return getCoopPendingWaveAdvanceBoundary(runtime.waveOperationBinding);
}

export function notifyCoopWaveContinuationSurfaceReady(
  sourceWave?: number,
  phaseOwnedSurface?: CoopPhaseOwnedWaveContinuationSurface,
): boolean {
  const runtime = active;
  if (runtime == null || !isCoopAuthoritativeGuest() || !usesRetainedCoopWaveTransaction(runtime)) {
    return false;
  }
  const wave = sourceWave ?? globalScene.currentBattle?.waveIndex ?? -1;
  if (!Number.isSafeInteger(wave) || wave < 0) {
    return false;
  }
  if (coopV2WaveCutovers.has(runtime)) {
    const transaction =
      runtime.v2WaveTransactions.get(wave)
      ?? [...runtime.v2WaveTransactions.values()].find(candidate => candidate.transition.nextWave === wave);
    if (transaction == null || !transaction.dataApplied) {
      return false;
    }
    // The phase calls this only after its real public handler is active. Retry the already-admitted V2 entry
    // NOW, while that exact surface and its pinned owner address are still current; waiting for the next
    // 250ms authority redelivery races fast public input and can observe the following interaction counter.
    // The replica ledger selects the safe resume stage, so DATA is never applied twice.
    runtime.battleStream.notifyContinuationSurface("sharedInput");
    const completed = coopV2ShadowHarnesses.get(runtime)?.retryPendingReplicaEntries() ?? 0;
    if (completed > 0) {
      coopLog("v2-wave", `real continuation surface completed ${completed} retained V2 entry`);
    }
    return true;
  }
  const ready = maybeMarkCoopWaveContinuationReady(wave, runtime.waveOperationBinding, runtime, phaseOwnedSurface);
  if (ready) {
    // Biome-market watchers and other phase-owned continuations deliberately do not open a normal
    // registry-backed UI mode. Their executable public/terminal loop is still the exact continuation
    // for the final turn commit on this old battle shell.
    runtime.battleStream.notifyContinuationSurface("sharedInput");
  }
  return ready;
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

/**
 * A retained GameOver commit replaces the turn-resolution frame the host never emits after entering
 * {@linkcode GameOverPhase}. The renderer may use this only after its ordered live-event buffer is empty:
 * the envelope is carried by the same ordered channel after those events, so admission is the causal fence
 * that makes an otherwise-permanent same-turn replay wait impossible rather than merely slow.
 */
export function coopRetainedGameOverSupersedesReplay(wave: number, turn: number): boolean {
  return (
    pendingWaveAdvance?.wave === wave
    && pendingWaveAdvance.outcome === "gameOver"
    && pendingWaveAdvance.settledTurn != null
    && turn >= pendingWaveAdvance.settledTurn
  );
}

/**
 * Install the engine-owned safe-boundary wake used when a retained WAVE_ADVANCE arrives after finalization.
 * The factory seam avoids a runtime -> replay-phase import cycle while still appending a real Phase instance.
 */
export function registerCoopWaveAdvanceBoundaryWakeFactory(factory: (() => Phase) | null): void {
  coopWaveAdvanceBoundaryWakeFactory = factory;
}

/**
 * Install the engine-owned aborter for a currently parked authoritative guest replay. A terminal retained
 * WAVE_ADVANCE can arrive after finalization opened a phantom next turn; waking that exact waiter lets the
 * already-appended safe-boundary finalizer run instead of sitting behind the parked phase indefinitely.
 */
export function registerCoopActiveReplayTurnAborter(
  aborter: ((reason: string, settledTurn: number) => boolean) | null,
): void {
  coopActiveReplayTurnAborter = aborter;
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
    && (active == null || !tryApplyCoopSettledWaveData(pending.wave, active.waveOperationBinding))
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
  settledTurn?: number | undefined,
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
  const carriedSettledTurn =
    settledTurn ?? (prev != null && prev.wave === wave && prev.outcome === outcome ? prev.settledTurn : undefined);
  return {
    wave,
    outcome,
    captureParty: carriedCapture,
    capturePresentation: carriedPresentation,
    ...(carriedTransition === undefined ? {} : { transition: carriedTransition }),
    ...(carriedSettledTurn === undefined ? {} : { settledTurn: carriedSettledTurn }),
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
type PendingShowdownResult = Extract<CoopMessage, { t: "showdownResult" | "showdownVoid" }>;

/**
 * A terminal belongs to its receiver runtime, not whichever process-global scene happened to be installed
 * when the transport callback ran. Production normally routes immediately; an in-process pair retains one
 * immutable terminal until `setCoopRuntime(receiver)` installs the destination context.
 */
const pendingShowdownResults = new WeakMap<CoopRuntime, PendingShowdownResult>();

function flushPendingShowdownResult(runtime: CoopRuntime): void {
  if (active !== runtime) {
    return;
  }
  const msg = pendingShowdownResults.get(runtime);
  if (msg == null) {
    return;
  }
  const scene = globalScene;
  try {
    if (scene.phaseManager.getCurrentPhase()?.phaseName === "ShowdownResultPhase") {
      pendingShowdownResults.delete(runtime);
      return;
    }
    // AFK-guest (#7): if the guest's command menu is still open when the match ends, force it back to
    // MESSAGE first - otherwise the command menu owns input and the just-unshifted ShowdownResultPhase
    // parks behind it. Best-effort; the retained terminal phase itself still queues synchronously.
    if (scene.ui.getMode() === UiMode.COMMAND) {
      void Promise.resolve(scene.ui.setMode(UiMode.MESSAGE)).catch(() => {});
    }
    if (msg.t === "showdownVoid") {
      scene.phaseManager.unshiftNew("ShowdownResultPhase", false, msg.reason, true, true);
    } else {
      // The received `winner` is a role; this client won iff it matches its own role.
      const localWon = msg.winner === runtime.controller.role;
      scene.phaseManager.unshiftNew("ShowdownResultPhase", localWon, msg.reason, false, true);
    }
    pendingShowdownResults.delete(runtime);
  } catch {
    // Keep the exact terminal pending. A later destination activation retries it instead of silently
    // dropping the match result or mutating another client's scene.
  }
}

function wireShowdownResult(transport: CoopTransport, runtime: CoopRuntime): void {
  transport.onMessage(msg => {
    if (msg.t !== "showdownResult" && msg.t !== "showdownVoid") {
      return;
    }
    // First terminal wins. Duplicates are idempotent; a conflicting late terminal cannot overwrite the
    // destination already chosen by the first accepted outcome.
    if (!pendingShowdownResults.has(runtime)) {
      pendingShowdownResults.set(runtime, msg);
    }
    flushPendingShowdownResult(runtime);
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
function wireCoopMeChecksumCheck(runtime: CoopRuntime, battleStream: CoopBattleStreamer): void {
  battleStream.onMeChecksum((seq, ownerChecksum) => {
    const ours = captureCoopChecksum();
    if (ownerChecksum === COOP_CHECKSUM_SENTINEL || ours === COOP_CHECKSUM_SENTINEL || ownerChecksum === ours) {
      coopLog("checksum", `recv meChecksum seq=${seq} MATCH owner=${ownerChecksum} watcher=${ours}`);
      return;
    }
    // An ordered delivery batch can contain this legacy checksum immediately before the retained
    // ME_PRESENT whose bound state explains it (multi-round encounters mutate party HP between screens).
    // Let that batch drain before treating the mismatch as recovery-worthy.
    queueMicrotask(() =>
      runWhenCoopRuntimeActive(runtime, () => {
        const settled = captureCoopChecksum();
        if (
          ownerChecksum === COOP_CHECKSUM_SENTINEL
          || settled === COOP_CHECKSUM_SENTINEL
          || ownerChecksum === settled
        ) {
          coopLog(
            "checksum",
            `recv meChecksum seq=${seq} MATCH after retained delivery owner=${ownerChecksum} watcher=${settled}`,
          );
          return;
        }
        coopWarn(
          "checksum",
          `me-entry MISMATCH seq=${seq} owner=${ownerChecksum} watcher=${settled} -> requesting stateSync`,
        );
        coopLog("resync", `await stateSync start seq=${seq}`);
        const gen = coopSessionGeneration(); // #808: die if the session ends before the reply
        void runCoopStateRecovery({
          runtime,
          reason: "mystery-checksum",
          label: `Mystery checksum seq=${seq}`,
          isCurrent: () => gen === coopSessionGeneration() && getCoopRuntime() === runtime,
          onSnapshot: ({ blob, admission }) => {
            coopLog("resync", `await stateSync resolve seq=${seq} blob=${blob.length}b -> applying`);
            // #839: this heal fires MID-DIVERT - the stateSync reply resolves while the guest is diverting
            // into (or parked in) CoopReplayMePhase for this same ME. Run it with `suppressResummon=true` so
            // it stays a SAFE, advisory best-effort heal: it applies only the cheap per-mon scalar +
            // module-let state writes and NEVER runs the heavy field COMPOSITION re-summon
            // (reconcileCoopEnemyField / reconcileCoopPlayerField + per-mon initBattleInfo), which would tear
            // down and rebuild the field sprites out from under the in-flight ME presentation. applyCoopFullSnapshot
            // touches no phase queue and never cancels a relay waiter. Protocol 38 still requires this
            // requested recovery to admit exactly; failure enters the shared terminal instead of letting an
            // already-proven divergence continue into the later ME terminal.
            const snapshot = JSON.parse(decompressFromBase64(blob)) as CoopFullBattleSnapshot;
            const liveRuntime = getCoopRuntime();
            if (liveRuntime == null) {
              return false;
            }
            // One central preflight enforces epoch, checksum/sentinel, membership, control digest, monotonic
            // interaction counter, and Mystery revision before DATA is touched. Active replay applies inline
            // transactionally; every other phase queues the same atomic apply at a safe boundary.
            return queueCoopAtomicSnapshotApply(
              liveRuntime,
              snapshot,
              admission,
              `me-entry seq=${seq} comprehensive snapshot`,
            );
          },
        });
      }),
    );
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
let learnMoveBatchPickerOpener:
  | ((partySlot: number, learnableIds: number[], ownerIsGuest: boolean, operationId?: string) => void)
  | null = null;

export function setCoopLearnMoveBatchPickerOpener(
  opener: (partySlot: number, learnableIds: number[], ownerIsGuest: boolean, operationId?: string) => void,
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
        pending.relay.sendInteractionOutcome(COOP_DEX_SYNC_SEQ, "dexSync", {
          k: "dexSync",
          dex: pending.blob,
        });
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
  const asymEscalator = createCoopAsymmetricEscalator({
    triggerMs: COOP_STALL_TRIGGER_MS,
    peerFreshWindowMs: COOP_STALL_TICK_MS * 2.5,
    recoveryCooldownMs: COOP_STALL_RECOVERY_COOLDOWN_MS,
  });
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
      const machineWaitMs = oldestCoopMachineWaitMs();
      const asymmetricMachineWaitMs = oldestCoopAsymmetricMachineWaitMs();
      const localMs = Math.max(relay.oldestNetworkWaitMs(), battleStream.oldestNetworkWaitMs(), machineWaitMs);
      // #808 HEALTH LINE: one compact self-describing line every ~30s so every log capture
      // carries a session-health timeline for free (zero extra timers).
      if (Date.now() - lastHealthAt >= 30_000) {
        lastHealthAt = Date.now();
        coopLog(
          "health",
          `tick=${coopSessionGeneration()}g turn=${point.turn || "-"} wave=${point.wave || "-"} counter=${runtime.controller.interactionCounter?.() ?? "-"} assertions=${getCoopChecksumAssertionCount()} wait=${localMs}ms machineWaits=${coopMachineWaitLabels().join(",") || "-"} peerBeat=${peerBeat ? `${Math.round((Date.now() - peerBeat.at) / 1000)}s` : "-"} lastRx=${formatLastRx(transport)} transport=${transport.state} ${formatCoopDurabilityHealth(runtime, transport)}`,
        );
      }
      // #806 faint-replacement suppression: a live human choosing (or the other replica awaiting) a faint
      // replacement legitimately parks BOTH engines in network/machine waits. Do NOT keepalive-report that
      // as a stall and do NOT deadlock-recover during it - the replacement's own 60s scheduler lease still
      // bounds a genuinely-dead owner.
      //
      // Under the complete Authority V2 cutover there need not be a legacy relay faint-window pin at all:
      // the non-owner installs the exact REPLACEMENT control as an ordered wait while the owner acts through
      // the public PARTY handler. Consulting only `isCoopFaintSwitchWindowOpen()` made that healthy V2 wait
      // look asymmetric after 20s and launched recovery in the middle of a real human pick. The globally
      // installed V2 control is the stronger proof and must grant the same deliberation lease on both seats.
      const activeV2Control = runtime.v2ControlLedger?.activeControl;
      if (isCoopFaintSwitchWindowOpen() || activeV2Control?.kind === "REPLACEMENT") {
        return;
      }
      if (localMs >= COOP_STALL_REPORT_MS) {
        transport.send({ t: "stallBeat", waitingMs: localMs });
      }
      const peerFresh = peerBeat != null && Date.now() - peerBeat.at < COOP_STALL_TICK_MS * 2.5;
      // ASYMMETRIC ESCALATION: the local side is stalled (network wait OR a registered machine wait like a
      // held resync / one-sided barrier) while the peer is provably NOT mutually stalled. Attempt the same
      // recovery a bounded number of times, then route BOTH clients into the shared terminal (never continue
      // unilaterally) so a dead-partner / non-converging hold can't park forever.
      const asymAction = asymEscalator.assess({
        // A plain one-sided NETWORK wait is normal: the other player may be browsing a shop,
        // choosing a move, or reading a modal. Only an explicitly registered MACHINE wait is
        // evidence that this side cannot advance without protocol progress. Feeding the folded
        // `localMs` here made every ordinary one-sided wait look asymmetric after 20 seconds.
        localMs: asymmetricMachineWaitMs,
        peerBeatMs: peerBeat?.ms ?? null,
        peerBeatAgeMs: peerBeat == null ? null : Date.now() - peerBeat.at,
        transportConnected: transport.state === "connected",
        now: Date.now(),
      });
      if (asymAction === "terminate") {
        failCoopRuntimeSharedSession(
          runtime,
          "Co-op stalled: your partner is not progressing. Leaving shared play safely.",
          {
            boundary: "recovery",
            reasonCode: "recovery-exhausted",
            wave: point.wave,
            turn: point.turn,
          },
        );
        return;
      }
      const mutualStall =
        localMs >= COOP_STALL_TRIGGER_MS
        && peerFresh
        && (peerBeat?.ms ?? 0) >= COOP_STALL_TRIGGER_MS
        && Date.now() - lastRecoveryAt > COOP_STALL_RECOVERY_COOLDOWN_MS;
      if (mutualStall || asymAction === "recover") {
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
          `STALL WATCHDOG: ${mutualStall ? "mutual" : "asymmetric"} wait (local=${Math.round(localMs / 1000)}s peer=${Math.round((peerBeat?.ms ?? 0) / 1000)}s) -> recovering (cancel orphan waits; preserve active Mystery${isCoopAuthoritativeGuest() ? " + full resync" : ""})`,
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
          void runCoopStateRecovery({
            runtime,
            reason: "stall",
            label: `Stall at wave ${point.wave} turn ${point.turn}`,
            isCurrent: () => gen === coopSessionGeneration() && getCoopRuntime() === runtime,
            onFailure: result => {
              recordCoopCausalEvent({
                domain: "snapshot",
                stage: "refused",
                causalId: `${recoveryId}:snapshot:${seq}`,
                parentId: recoveryId,
                role: "guest",
                detail: result.kind,
              });
            },
            onSnapshot: ({ blob, admission }) => {
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
              return queueCoopAtomicSnapshotApply(
                runtime,
                snapshot,
                admission,
                `stall-recovery snapshot seq=${seq} blob=${blob.length}b`,
              );
            },
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
      globalScene.ui.showText(coopSharedTerminalPlayerMessage(reason), null, undefined, 6000);
    } catch {
      /* cosmetic */
    }
  }
  return prepared;
}

/**
 * Player-facing text for a shared-terminal reason that has a CONCRETE player remedy. Live report
 * 2026-07-17 (coop-save/anon): a host whose five save slots were all occupied or unverifiable hit the
 * correct no-overwrite fail-closed abort, but only saw the generic "could not be synchronized" text
 * with no way to know the remedy was simply freeing a save slot. Presentation only - every terminal
 * decision and the fail-closed behavior itself are unchanged.
 */
function coopSharedTerminalPlayerMessage(reason: string): string {
  if (reason.includes("no verified empty local+cloud save slot")) {
    return (
      "A new co-op run needs one free save slot on the host's account, and none of the five slots "
      + "could be verified free. Free a save slot (Load Game, delete an old run), then reconnect and try again."
    );
  }
  return "The shared battle could not be synchronized safely. Both players are leaving shared play safely.";
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
    clearCoopRuntime();
    globalScene.reset();
    // A retained phase deliberately refuses end() once clearCoopRuntime invalidates its generation.
    // Terminal teardown owns progression now: discard every gameplay tail, install exactly one title,
    // and shift directly instead of asking stale phase-specific end hooks to advance the queue.
    // Production PhaseManager owns clearAllPhases. Narrow engine-free tests may expose only the queue
    // surface already cleared by prepareCoopSharedTerminal; do not abort title installation for that stub.
    (globalScene.phaseManager as unknown as CoopTerminalPhaseManagerBridge).clearAllPhases?.();
    globalScene.phaseManager.unshiftNew("TitlePhase");
    globalScene.phaseManager.shiftPhase();
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
    return;
  }

  // A phase can outlive an asynchronously torn-down runtime. That is still a fatal shared-session
  // boundary: silently returning here lets the orphaned phase resume through its solo/local path and
  // mutate mechanics without a peer. There is no authenticated control plane left with which to retain
  // or ACK a terminal, so use the same immediate local fallback as an unbound legacy session and install
  // exactly one title continuation. This is deliberately best-effort for engine-free tests/pre-scene
  // failures, but the caller must still return/park after invoking us.
  const safeReason = terminalReason(reason);
  coopWarn("runtime", `orphaned shared session terminal requested: ${safeReason}`);
  try {
    releaseCoopTerminalPhaseProgression();
    globalScene.reset();
    (globalScene.phaseManager as unknown as CoopTerminalPhaseManagerBridge).clearAllPhases?.();
    globalScene.phaseManager.unshiftNew("TitlePhase");
    globalScene.phaseManager.shiftPhase();
  } catch {
    // With no runtime there is no remaining control plane to dispose. The public-input caller still
    // refuses to advance, which preserves fail-closed mechanics in narrow harness/pre-scene contexts.
  }
}

/**
 * Close a recovery request that did not yield an exactly admitted snapshot. This helper is deliberately
 * side-effectful: callers must return when it reports a failure, and the synchronous shared-terminal
 * preparation freezes membership, battle commands, retained UI waits, and phase progression before any
 * released promise continuation can resume mechanics.
 */
export function failCoopRecoveryOutcome(
  runtime: CoopRuntime,
  outcome: CoopStateSyncOutcome,
  label: string,
): outcome is CoopStateSyncFailure {
  if (outcome.kind === "snapshot") {
    return false;
  }
  const point = readCoopBattlePoint();
  failCoopRuntimeSharedSession(
    runtime,
    `${label} recovery ended with ${outcome.kind} before an exact authoritative snapshot was admitted.`,
    {
      boundary: "recovery",
      reasonCode: "recovery-exhausted",
      wave: point.wave,
      turn: point.turn,
    },
  );
  return true;
}

export interface CoopStateRecoveryRequest {
  runtime: CoopRuntime;
  reason: Exclude<CoopRecoveryReason, "durability-gap">;
  label: string;
  /** A late result from a replaced session is stale evidence, not a failure of the new session. */
  isCurrent: () => boolean;
  /** Return true only after the exact snapshot was decoded and admitted to its atomic apply boundary. */
  onSnapshot: (result: CoopStateSyncResult) => boolean | Promise<boolean>;
  /** Optional evidence hook for the explicit non-snapshot outcome, before terminal preparation. */
  onFailure?: (failure: CoopStateSyncFailure) => void;
}

/**
 * Execute the complete machine-recovery call chain. Every live-session outcome is binary: an exact snapshot
 * is admitted, or the runtime enters the shared terminal synchronously. Call sites cannot accidentally log
 * a timeout/unavailable result and continue mechanics.
 */
export async function runCoopStateRecovery(
  request: CoopStateRecoveryRequest,
): Promise<"accepted" | "stale" | "terminal"> {
  const { runtime, reason, label, isCurrent, onSnapshot, onFailure } = request;
  if (isCoopV2RecoveryNegotiated()) {
    const shadow = getCoopV2Shadow(runtime);
    const recovery = shadow?.recover(reason) ?? null;
    if (recovery == null) {
      if (!isCurrent()) {
        return "stale";
      }
      failCoopRuntimeSharedSession(
        runtime,
        `${label} could not start the negotiated Authority V2 recovery transaction.`,
        { boundary: "recovery", reasonCode: "recovery-exhausted" },
      );
      return "terminal";
    }
    const result = await recovery;
    if (!isCurrent()) {
      return "stale";
    }
    return result === "recovered" ? "accepted" : "terminal";
  }
  let outcome: CoopStateSyncOutcome;
  try {
    outcome = await runtime.battleStream.requestStateSync(reason);
  } catch (error) {
    if (!isCurrent()) {
      return "stale";
    }
    coopWarn("resync", `${label} recovery request threw`, error);
    failCoopRuntimeSharedSession(runtime, `${label} recovery request failed before an exact snapshot arrived.`);
    return "terminal";
  }
  if (!isCurrent()) {
    return "stale";
  }
  if (outcome.kind !== "snapshot") {
    try {
      onFailure?.(outcome);
    } catch (error) {
      coopWarn("resync", `${label} failure evidence hook threw`, error);
    }
    failCoopRecoveryOutcome(runtime, outcome, label);
    return "terminal";
  }
  try {
    if (await onSnapshot(outcome)) {
      return "accepted";
    }
  } catch (error) {
    coopWarn("resync", `${label} snapshot decode/admission threw`, error);
  }
  failCoopRuntimeSharedSession(runtime, `${label} snapshot could not be decoded and admitted atomically.`);
  return "terminal";
}

interface CoopBattleRecoveryScene {
  currentBattle?: unknown | null;
  gameMode?: { isCoop?: boolean; isShowdown?: boolean } | null;
}

/**
 * A hot rejoin always restores the authenticated carrier and durability tail, but a full battle snapshot
 * exists only after an authoritative battle has started. Title/lobby, starter selection, save selection,
 * and showdown wager setup all legitimately have a runtime with no `currentBattle`; demanding a snapshot
 * there turns a successful rejoin into an impossible recovery and closes the healthy replacement channel.
 */
export function hasCoopBattleRecoverySurface(scene: CoopBattleRecoveryScene = globalScene): boolean {
  return scene.currentBattle != null && ((scene.gameMode?.isCoop ?? false) || (scene.gameMode?.isShowdown ?? false));
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
          if (runtime.controller.role === "guest" && hasCoopBattleRecoverySurface()) {
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
            void runCoopStateRecovery({
              runtime,
              reason: "rejoin",
              label: "Post-rejoin wave recovery",
              isCurrent: () => gen === coopSessionGeneration() && getCoopRuntime() === runtime,
              onFailure: result => {
                recordCoopCausalEvent({
                  domain: "snapshot",
                  stage: "refused",
                  causalId: snapshotId,
                  parentId: recoveryId,
                  role: "guest",
                  detail: result.kind,
                });
              },
              onSnapshot: ({ blob, admission }) => {
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
                return queueCoopAtomicSnapshotApply(
                  runtime,
                  snapshot,
                  admission,
                  `post-rejoin snapshot seq=${seq} blob=${blob.length}b`,
                );
              },
            });
          } else if (runtime.controller.role === "guest") {
            coopLog("resync", "post-rejoin battle snapshot skipped (no authoritative battle surface yet)");
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
  relay.onLearnMoveForward = (outcome, operationId) => {
    if (!isCoopAuthoritativeGuest()) {
      return;
    }
    const { partySlot, moveId, maxMoveCount } = outcome;
    const ownerIsGuest = outcome.ownerIsGuest !== false;
    if (learnMoveForwardInFlight.has(partySlot)) {
      const phase = globalScene.phaseManager?.getCurrentPhase() as
        | {
            phaseName?: string;
            installCoopV2LearnMovePresentation?: (
              operationId: string,
              partySlot: number,
              moveId: number,
              maxMoveCount: number,
              ownerIsGuest: boolean,
            ) => boolean;
          }
        | undefined;
      const installed =
        operationId != null
        && phase?.installCoopV2LearnMovePresentation?.(operationId, partySlot, moveId, maxMoveCount, ownerIsGuest)
          === true;
      coopLog(
        "learnmove",
        `recv learnMoveForward slot=${partySlot} picker already in-flight; exact presentation ${
          installed ? "installed" : operationId == null ? "was legacy" : "deferred"
        }`,
      );
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
      if (operationId != null || learnMovePickerOpener == null) {
        // V2 needs a queue-owned phase token carrying the exact immutable operation address. The legacy
        // detached overlay has neither and therefore can never prove controlInstalled or recovery.
        globalScene.phaseManager.unshiftNew(
          "CoopReplayLearnMovePhase",
          partySlot,
          moveId,
          maxMoveCount,
          operationId,
          ownerIsGuest,
        );
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
  relay.onLearnMoveBatchForward = (outcome, operationId) => {
    if (!isCoopAuthoritativeGuest()) {
      return;
    }
    const { partySlot, learnableIds, ownerIsGuest } = outcome;
    if (learnMoveBatchForwardInFlight.has(partySlot)) {
      const phase = globalScene.phaseManager?.getCurrentPhase() as
        | {
            phaseName?: string;
            installCoopV2LearnMoveBatchPresentation?: (
              operationId: string,
              partySlot: number,
              learnableIds: readonly number[],
              ownerIsGuest: boolean,
            ) => boolean;
          }
        | undefined;
      const installed =
        operationId != null
        && phase?.installCoopV2LearnMoveBatchPresentation?.(operationId, partySlot, learnableIds, ownerIsGuest)
          === true;
      coopLog(
        "learnmove",
        `recv learnMoveBatchForward slot=${partySlot} panel already in-flight; exact presentation ${
          installed ? "installed" : operationId == null ? "was legacy" : "deferred"
        }`,
      );
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
      learnMoveBatchPickerOpener(partySlot, learnableIds, ownerIsGuest, operationId);
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

interface CoopV2WaveLiveTransaction {
  readonly entryRevision: number;
  readonly operationId: string;
  readonly materialDigest: string;
  readonly transition: CoopWaveAdvancePayload;
  readonly authoritativeState: CoopAuthoritativeBattleStateV1;
  readonly terminalId: string | null;
  readonly nextControlId: string;
  bootstrapProjected: boolean;
  dataApplied: boolean;
  continuationReady: boolean;
}

/**
 * Read-only, authority-neutral evidence for one wave boundary.
 *
 * This is deliberately not a compatibility transaction and cannot ACK, resend, apply, or release anything.
 * Tests, diagnostics, and the public-driver soak use it so enabling Authority V2 does not make them inspect
 * the retired V1 operation journal and falsely report a softlock after the V2 log has already completed.
 */
export interface CoopWaveBoundaryStatus {
  readonly authority: "legacy" | "v2";
  readonly operationId: string;
  readonly transition: CoopWaveAdvancePayload;
  readonly dataApplied: boolean;
  readonly continuationReady: boolean;
  readonly entryRevision?: number;
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
  /** Stable wave-transaction selector captured from this runtime, including its exact durability owner. */
  readonly waveOperationBinding: CoopWaveAdvanceOperationBinding;
  /**
   * Address-exact COMMAND controls the REAL CommandPhase started in this runtime. Authority V2 may sign
   * controlInstalled only when the host-stated controlId is present here; projection requests themselves
   * never populate it.
   */
  readonly v2InstalledCommandTargets: Set<string>;
  /** CommandPhase starts parked until the exact ordered command-open entry is materially installed. */
  readonly v2DeferredCommandStarts: Map<
    string,
    {
      readonly epoch: number;
      readonly wave: number;
      readonly turn: number;
      readonly fieldIndex: number;
      readonly pokemonId: number;
      /**
       * Host-canonical target for a locally reflected Showdown CommandPhase. Classic co-op leaves this
       * absent because both clients share the canonical player-field orientation.
       */
      readonly authorityTarget?: CoopCommandControlTarget;
      resume: () => void;
    }
  >;
  /** Input phases parked before opening their handler until their exact ordered V2 control applies. */
  readonly v2DeferredInteractionStarts: Map<
    string,
    {
      readonly phaseToken: object;
      resume: () => void;
    }
  >;
  /**
   * Exact V2 REPLACEMENT frontiers installed by the ordered replica projector. This is a protocol
   * acceptance frontier, not a claim that a local picker exists: replacement choices are resolved before
   * the complete post-summon carrier is committed, so a chained control authorizes admission of the next
   * occurrence without manufacturing a second UI.
   */
  /** Exact interaction/ordered-wait controls proven by the public UI projector for this runtime. */
  readonly v2InstalledInteractionTargets: Set<string>;
  /** Complete interaction result images installed once per global operation ID. */
  readonly v2InteractionStateApplied: Set<string>;
  /** Result phases that consumed their exact operation and reached the real local terminal. */
  readonly v2SettledInteractionOperations: Set<string>;
  /** Address-exact interaction claims shared by ordinary delivery, authority-local control, and recovery. */
  readonly v2ControlLedger: CoopV2ControlLedger;
  /** Successor that may release a recovered ordered-wait phase only after its immutable material applies. */
  v2RecoveryWaitSuccessorOperationId: string | null;
  /** Exact control whose new engine generation was queued under the current correlated recovery fence. */
  v2RecoveryPreparedControlId: string | null;
  /**
   * Exact ordinary replacement generation queued from the immutable control. This is a duplicate-construction
   * guard only; the real PARTY handler must still publish address-exact controlInstalled proof.
   */
  v2ProjectedReplacementControlId: string | null;
  /**
   * Exact ordinary (non-recovery) shared-interaction generation installed directly from immutable V2
   * material. This closes the gap where a replica's obsolete predecessor phase never locally reaches the
   * successor the authority already committed (for example NextEncounterPhase waiting forever before an
   * ME_PRESENT). The value is only a duplicate-construction guard; public phase+handler proof still owns
   * controlInstalled.
   */
  v2ProjectedInteractionControlId: string | null;
  /** Runtime-owned V2 wave/terminal transactions awaiting safe DATA and real destination proof. */
  readonly v2WaveTransactions: Map<number, CoopV2WaveLiveTransaction>;
  /**
   * Bounded read-only completion evidence. Completed entries leave the live map as soon as their exact
   * public destination installs; retaining only their immutable status makes observability honest without
   * retaining a second authority or allowing an old boundary to affect gameplay.
   */
  readonly v2CompletedWaveTransactions: Map<number, CoopV2WaveLiveTransaction>;
}

let active: CoopRuntime | null = null;

/**
 * Production phase terminal proof for an authoritative interaction result. FIFO injection, a raw proposal,
 * and a queued phase may never call this; only the exact operation consumer calls it after ending/shifting
 * its local phase. The proof belongs to the runtime even before V2 negotiation: legacy journal fallback
 * uses the same live materializers and must be able to finish their deferred entry without inventing a
 * weaker completion rule. Only V2 retry/projection below remains cutover-gated.
 */
export function settleCoopV2InteractionOperation(operationId: string, runtime: CoopRuntime | null = active): boolean {
  if (runtime == null || operationId.length === 0) {
    return false;
  }
  runtime.v2SettledInteractionOperations.add(operationId);
  if (!coopV2InteractionCutovers.has(runtime)) {
    // A mixed-capability peer pair stays on the legacy retained journal. Its live sink deliberately
    // deferred until this exact phase terminal; retry now so the decision cancels owner resends and
    // advances the dense legacy cursor without waiting for a transport backoff.
    runtime.durability?.retryDeferred("op:global");
    return true;
  }
  // Pace the retained replica entry immediately from the real engine completion edge. Authority
  // redelivery remains the durability owner; this only avoids making correctness/liveness wait for its
  // next 250ms backoff when the phase terminal appeared one microtask after material injection.
  coopV2ShadowHarnesses.get(runtime)?.retryPendingReplicaEntries();
  const control = runtime.v2ControlLedger.latestControl;
  if (
    control != null
    && ((control.kind === "AWAIT_SUCCESSOR" && control.afterOperationId === operationId)
      || (control.kind === "SHARED_INTERACTION" && control.operationId === operationId))
    && runtime.v2ControlLedger.isMaterialApplied(control)
  ) {
    // The initial replica projector commonly runs in the same stack that only wakes an async phase
    // waiter, so the real phase terminal/actionable handler appears one microtask later. Retry from the
    // proof edge itself rather than relying on a network backoff redelivery to revisit this control.
    projectCoopV2InteractionControl(runtime, control);
  }
  return true;
}

/**
 * Async phase continuations captured by one runtime but resolved while the other in-process harness client
 * is ambient. Production has one runtime and executes immediately; the harness flushes the callback only
 * after installing the destination scene, durability manager, and operation state together.
 */
const pendingRuntimeActivations = new WeakMap<CoopRuntime, Set<() => void>>();
/** Last scene installed alongside each runtime; direct engine-free tests intentionally share one scene. */
const runtimeSceneBindings = new WeakMap<CoopRuntime, object>();

// ---------------------------------------------------------------------------
// authority-v2 SHADOW harness (src/data/elite-redux/coop/authority-v2/shadow.ts).
// Per-runtime, installed from BOTH negotiated-capability and authenticated-binding
// lifecycle edges. P33 capability negotiation intentionally precedes binding
// construction, so an identity that is not ready is a DEFER (retry at binding-ready),
// not a permanent build failure. Only a constructor fault is remembered to avoid
// retry-thrash. When the capability is off, getCoopV2Shadow returns null and every
// `getCoopV2Shadow()?.tapX(...)` short-circuits with zero side effect.
// ---------------------------------------------------------------------------
const coopV2ShadowHarnesses = new WeakMap<CoopRuntime, CoopAuthorityV2Shadow>();
const coopV2ShadowBuildFailed = new WeakSet<CoopRuntime>();
/** The live turn cutover controller per runtime (built alongside the harness when authority.v2turn is negotiated). */
const coopV2TurnCutovers = new WeakMap<CoopRuntime, CoopV2TurnCutover>();
/** The live replacement cutover controller per runtime. */
const coopV2ReplacementCutovers = new WeakMap<CoopRuntime, CoopV2ReplacementCutover>();
/** The live wave/terminal cutover controller per runtime. */
const coopV2WaveCutovers = new WeakMap<CoopRuntime, CoopV2WaveCutover>();
/** The live complete shared-interaction cutover controller per runtime. */
const coopV2InteractionCutovers = new WeakMap<CoopRuntime, CoopV2InteractionCutover>();
/** Explicit command-open boundary; present only for the complete turn/replacement/wave/interaction graph. */
const coopV2ControlCutovers = new WeakMap<CoopRuntime, CoopV2ControlCutover>();
/**
 * Coalesce proof-edge replica retries per runtime. A CommandPhase can start synchronously while the original
 * CONTROL_COMMIT applier is still on the stack; retrying inline would recursively re-enter that same entry
 * before its foundation materialApplied stage is recorded. One microtask preserves stage order while still
 * removing any dependency on the authority's later network-redelivery timer.
 */
const coopV2CommandProofRetryQueued = new WeakSet<CoopRuntime>();

function scheduleCoopV2CommandProofRetry(runtime: CoopRuntime): void {
  if (coopV2CommandProofRetryQueued.has(runtime)) {
    return;
  }
  coopV2CommandProofRetryQueued.add(runtime);
  queueMicrotask(() => {
    runWhenCoopRuntimeActive(runtime, () => {
      coopV2CommandProofRetryQueued.delete(runtime);
      const completed = coopV2ShadowHarnesses.get(runtime)?.retryPendingReplicaEntries() ?? 0;
      if (completed > 0) {
        coopLog("v2-control", `real command proof completed ${completed} retained V2 entry`);
      }
    });
  });
}

/**
 * Swap every cycle-free V2 selector with the active runtime. Production has one runtime; the two-engine
 * harness alternates two in one realm, so leaving these selectors on the last-built client can stage a host
 * replacement in the guest's log (or send a turn through the wrong frame context) while the test still
 * appears mechanically healthy.
 */
function activateCoopV2Runtime(runtime: CoopRuntime): void {
  const harness = coopV2ShadowHarnesses.get(runtime);
  if (harness == null) {
    clearActiveCoopV2Shadow();
  } else {
    setActiveCoopV2Shadow(harness);
  }
  const turn = coopV2TurnCutovers.get(runtime);
  if (turn == null) {
    clearActiveCoopV2TurnCutover();
  } else {
    setActiveCoopV2TurnCutover(turn);
  }
  const replacement = coopV2ReplacementCutovers.get(runtime);
  if (replacement == null) {
    clearActiveCoopV2ReplacementCutover();
  } else {
    setActiveCoopV2ReplacementCutover(replacement);
  }
  const wave = coopV2WaveCutovers.get(runtime);
  if (wave == null) {
    clearActiveCoopV2WaveCutover();
  } else {
    setActiveCoopV2WaveCutover(wave);
  }
  const interaction = coopV2InteractionCutovers.get(runtime);
  if (interaction == null) {
    clearActiveCoopV2InteractionCutover();
  } else {
    setActiveCoopV2InteractionCutover(interaction);
  }
}

/** Whether the turn/command surface is CUT OVER to v2 for `runtime` (authority.v2turn negotiated + harness present). */
function isCoopV2TurnNegotiated(): boolean {
  return isCoopCapabilityNegotiated(COOP_CAP_AUTHORITY_V2_TURN);
}

/**
 * Replacement resumes through the same aggregate COMMAND control installed by surface 1. Requiring both
 * capabilities prevents a replacement-only mixed build from partially owning COMMAND controls emitted by
 * shadow TURN entries.
 */
function isCoopV2ReplacementNegotiated(): boolean {
  return (
    isCoopCapabilityNegotiated(COOP_CAP_AUTHORITY_V2_REPLACEMENT)
    && isCoopCapabilityNegotiated(COOP_CAP_AUTHORITY_V2_TURN)
  );
}

/** Wave/terminal authority can cut over only after every in-battle predecessor lives in the same log. */
function isCoopV2WaveNegotiated(): boolean {
  return (
    isCoopCapabilityNegotiated(COOP_CAP_AUTHORITY_V2_WAVE)
    && isCoopV2TurnNegotiated()
    && isCoopV2ReplacementNegotiated()
  );
}

/**
 * Interaction cutover is all-or-nothing. Every migrated interaction capability and the complete-result
 * capture layer must be present before the old `op:global` authority can be retired.
 */
function isCoopV2InteractionNegotiated(): boolean {
  return (
    isCoopCapabilityNegotiated(COOP_CAP_AUTHORITY_V2_INTERACTION)
    && isCoopV2WaveNegotiated()
    && isCoopCapabilityNegotiated(COOP_CAP_DURABILITY_JOURNAL)
    && isCoopCapabilityNegotiated(COOP_CAP_OP_ABILITY)
    && isCoopCapabilityNegotiated(COOP_CAP_OP_BARGAIN)
    && isCoopCapabilityNegotiated(COOP_CAP_OP_BIOME)
    && isCoopCapabilityNegotiated(COOP_CAP_OP_CATCH_FULL)
    && isCoopCapabilityNegotiated(COOP_CAP_OP_COLOSSEUM)
    && isCoopCapabilityNegotiated(COOP_CAP_OP_LEARN_MOVE)
    && isCoopCapabilityNegotiated(COOP_CAP_OP_ME)
    && isCoopCapabilityNegotiated(COOP_CAP_OP_REVIVAL)
    && isCoopCapabilityNegotiated(COOP_CAP_OP_REWARD)
    && isCoopCapabilityNegotiated(COOP_CAP_OP_STORMGLASS)
  );
}

/** V2 recovery is valid only when the one log already owns every progression class. */
function isCoopV2RecoveryNegotiated(): boolean {
  return isCoopCapabilityNegotiated(COOP_CAP_AUTHORITY_V2_RECOVERY) && isCoopV2InteractionNegotiated();
}

/** Read the already-built recovery fence without lazily constructing or rebinding a V2 harness. */
function coopV2RecoveryFencePredicates(runtime: CoopRuntime | null = active): CoopRecoveryFencePredicatesV2 | null {
  return runtime == null ? null : (coopV2ShadowHarnesses.get(runtime)?.recoveryFencePredicates() ?? null);
}

/** Command/UI choke point: no new local decision is admissible while correlated recovery owns the frontier. */
export function isCoopV2CommandAdmissionFrozen(runtime: CoopRuntime | null = active): boolean {
  return coopV2RecoveryFencePredicates(runtime)?.isCommandAdmissionFrozen() === true;
}

/** Phase-start choke point: opens only for the exact post-snapshot control while the rest of the fence stays held. */
export function isCoopV2ControlSurfaceStartFrozen(runtime: CoopRuntime | null = active): boolean {
  const harness = runtime == null ? null : coopV2ShadowHarnesses.get(runtime);
  return harness?.recoveryControlSurfaceStartFrozen() === true;
}

/** Relay/battle/rendezvous choke point: no new authority wait may be created under the stale frontier. */
export function isCoopV2AuthorityWaitCreationFrozen(runtime: CoopRuntime | null = active): boolean {
  return coopV2RecoveryFencePredicates(runtime)?.isAuthorityWaitCreationFrozen() === true;
}

/**
 * Retry the ordered V2 replica ledger at a real engine safe boundary.
 *
 * TURN material is intentionally deferred until CoopFinalizeTurnPhase has applied and verified the full
 * authoritative image. Once that proof is recorded, retry immediately instead of waiting for a timer-based
 * redelivery: this retires the TURN entry and admits an already-buffered WAVE/REPLACEMENT successor before
 * the renderer can manufacture local control.
 */
export function retryCoopV2PendingAuthorityAtSafeBoundary(runtime: CoopRuntime | null = active): number {
  if (runtime == null || runtime !== active) {
    return 0;
  }
  return coopV2ShadowHarnesses.get(runtime)?.retryPendingReplicaEntries() ?? 0;
}

/**
 * Reconstruct the COMPLETE legacy `turnResolution` carrier from an enriched v2 TURN_COMMIT material image
 * (surface 1). Returns `null` when any cutover companion is missing/mistyped (a bare shadow-parity image or
 * an older host) - the caller then falls back to the checkpoint-only apply, byte-identical to the
 * pre-enrichment behaviour. The streamer re-validates the carrier strictly (hasCompleteAuthorityCompanions)
 * before admitting it, so this only assembles the message shape and screens the coarse field types.
 */
function reconstructCoopV2TurnResolution(
  payload: TurnResolutionImage,
): Extract<CoopMessage, { t: "turnResolution" }> | null {
  const { turnResolution, checkpoint, checksum, preimage, fullField, authoritativeState, epoch, wave, turn, revision } =
    payload;
  if (
    !Array.isArray(turnResolution)
    || checkpoint == null
    || typeof checkpoint !== "object"
    || typeof checksum !== "string"
    || typeof preimage !== "string"
    || !Array.isArray(fullField)
    || authoritativeState == null
    || typeof authoritativeState !== "object"
    || typeof epoch !== "number"
    || typeof wave !== "number"
    || typeof turn !== "number"
    || typeof revision !== "number"
  ) {
    return null;
  }
  return {
    t: "turnResolution",
    epoch,
    wave,
    turn,
    revision,
    events: turnResolution as CoopBattleEvent[],
    checkpoint: checkpoint as CoopBattleCheckpoint,
    checksum,
    preimage,
    fullField: fullField as CoopFullMonSnapshot[],
    authoritativeState: authoritativeState as CoopAuthoritativeBattleStateV1,
  };
}

/** Rebuild the compatibility envelope consumed by the real replacement replay transaction. */
function reconstructCoopV2ReplacementCheckpoint(
  entry: CoopAuthorityEntry,
): Extract<CoopMessage, { t: "battleCheckpoint" }> | null {
  const image = decodeReplacementCommitMaterial(entry);
  const carrier = image?.authorityCarrier;
  if (
    image == null
    || carrier == null
    || carrier.checkpoint == null
    || typeof carrier.checkpoint !== "object"
    || typeof carrier.checksum !== "string"
    || carrier.checksum.length === 0
    || typeof carrier.preimage !== "string"
    || carrier.preimage.length === 0
    || !Array.isArray(carrier.fullField)
    || carrier.authoritativeState == null
    || typeof carrier.authoritativeState !== "object"
    || typeof carrier.epoch !== "number"
    || typeof carrier.wave !== "number"
    || typeof carrier.turn !== "number"
  ) {
    return null;
  }
  const state = carrier.authoritativeState as CoopAuthoritativeBattleStateV1;
  if (
    !Number.isSafeInteger(carrier.epoch)
    || carrier.epoch <= 0
    || !Number.isSafeInteger(carrier.wave)
    || carrier.wave <= 0
    || !Number.isSafeInteger(carrier.turn)
    || carrier.turn <= 0
    || !Number.isSafeInteger(state.tick)
    || state.tick <= 0
    || state.wave !== carrier.wave
    || state.turn !== carrier.turn
  ) {
    return null;
  }
  return {
    t: "battleCheckpoint",
    reason: "replacement",
    epoch: carrier.epoch,
    wave: carrier.wave,
    turn: carrier.turn,
    // Keep the exact compatibility identity used by sendCheckpoint. The Authority V2 log revision remains
    // the retained ordering identity; the replay transaction's immutable carrier revision is the state tick.
    revision: state.tick,
    checkpoint: carrier.checkpoint as CoopBattleCheckpoint,
    checksum: carrier.checksum,
    fullField: carrier.fullField as CoopFullMonSnapshot[],
    authoritativeState: state,
  };
}

function decodeCoopV2WaveTransaction(entry: CoopAuthorityEntry): CoopV2WaveLiveTransaction | null {
  if (entry.kind !== "WAVE_ADVANCE" && entry.kind !== "TERMINAL_COMMIT") {
    return null;
  }
  const payload = entry.material.payload;
  let waveMaterial: CoopWaveTransitionMaterialV2 | null = null;
  let terminalMaterial: CoopTerminalMaterialV2 | null = null;
  if (entry.kind === "WAVE_ADVANCE") {
    if (!isValidWaveTransitionMaterial(payload)) {
      return null;
    }
    waveMaterial = payload;
  } else {
    if (!isValidTerminalMaterial(payload)) {
      return null;
    }
    terminalMaterial = payload;
  }
  const material = waveMaterial ?? terminalMaterial;
  if (material == null || digestOfMaterial(material) !== entry.material.digest || entry.nextControl == null) {
    return null;
  }
  const carrier = material.authorityCarrier;
  if (carrier == null || !isValidCoopWaveAdvancePayload(carrier.transition)) {
    return null;
  }
  const transition = structuredClone(carrier.transition);
  const authoritativeState = structuredClone(carrier.authoritativeState) as CoopAuthoritativeBattleStateV1;
  if (
    authoritativeState == null
    || typeof authoritativeState !== "object"
    || !Number.isSafeInteger(authoritativeState.wave)
    || !Number.isSafeInteger(authoritativeState.turn)
    || !Number.isSafeInteger(authoritativeState.tick)
    || authoritativeState.wave !== material.wave
    || authoritativeState.turn !== material.turn
    || transition.wave !== material.wave
    || transition.settledStateTick !== authoritativeState.tick
  ) {
    return null;
  }
  if (
    (waveMaterial != null
      && (transition.outcome === "gameOver"
        || transition.outcome !== waveMaterial.outcome
        || transition.nextWave !== waveMaterial.nextWave
        || transition.biomeChange !== waveMaterial.biomeChange
        || transition.eggLapse !== waveMaterial.eggLapse
        || transition.meBoundary !== waveMaterial.meBoundary
        || transition.victoryKind !== waveMaterial.victoryKind))
    || (terminalMaterial != null
      && ((terminalMaterial.reason === "game-over" && transition.outcome !== "gameOver")
        || (terminalMaterial.reason === "final-boss-credits"
          && !(
            (transition.outcome === "win" || transition.outcome === "capture")
            && transition.nextWave === transition.wave
          ))))
  ) {
    return null;
  }
  return {
    entryRevision: entry.revision,
    operationId: entry.operationId,
    materialDigest: entry.material.digest,
    transition,
    authoritativeState,
    terminalId: terminalMaterial?.terminalId ?? null,
    nextControlId: controlIdOf(entry.nextControl),
    bootstrapProjected: false,
    dataApplied: false,
    continuationReady: false,
  };
}

function matchingCoopV2WaveTransaction(
  runtime: CoopRuntime,
  control: NonNullable<CoopNextControl>,
): CoopV2WaveLiveTransaction | null {
  const controlId = controlIdOf(control as ProjectableControl);
  return [...runtime.v2WaveTransactions.values()].find(transaction => transaction.nextControlId === controlId) ?? null;
}

/**
 * Release the real turn finalizer parked by a null-successor TURN_COMMIT. The successor's live adapter must
 * call this only after installing its own phase wake or stream carrier, so Phaser can never fall through an
 * empty queue into a locally-derived command.
 */
function releaseCoopV2ParkedTurnBoundary(runtime: CoopRuntime, entry: CoopAuthorityEntry): boolean {
  if (active !== runtime || runtime.controller.authorityRole !== "replica") {
    return false;
  }
  const phase = globalScene.phaseManager?.getCurrentPhase() as
    | {
        releaseForCoopV2Control?: (successor: {
          sessionEpoch: number;
          revision: number;
          kind: CoopAuthorityEntry["kind"];
          operationId: string;
          nextControl: CoopNextControl;
        }) => boolean;
      }
    | undefined;
  return (
    phase?.releaseForCoopV2Control?.({
      sessionEpoch: entry.context.sessionEpoch,
      revision: entry.revision,
      kind: entry.kind,
      operationId: entry.operationId,
      nextControl: entry.nextControl,
    }) === true
  );
}

/**
 * MIGRATION: this is the one remaining ambient bridge for the existing Phaser wave-tail factory. The
 * transaction and destination runtime are captured before delivery; the callback runs only after
 * setCoopRuntime installs that runtime's scene/op selectors together.
 */
function bootstrapCoopV2WaveTransaction(runtime: CoopRuntime, transaction: CoopV2WaveLiveTransaction): boolean {
  if (transaction.bootstrapProjected) {
    return true;
  }
  if (active !== runtime || runtime.controller.authorityRole !== "replica") {
    return false;
  }
  const payload = transaction.transition;
  const currentWave = globalScene.currentBattle?.waveIndex ?? -1;
  if (payload.wave <= lastResolvedWave) {
    transaction.bootstrapProjected = true;
    return true;
  }
  if (currentWave !== payload.wave) {
    return false;
  }
  runtime.battleStream.noteWaveAdvanceAdmitted(runtime.controller.sessionEpoch, payload.wave);
  const merged = mergeCoopPendingWaveAdvance(
    pendingWaveAdvance,
    payload.wave,
    payload.outcome,
    undefined,
    pendingRawWavePresentations.get(payload.wave),
    payload,
    transaction.authoritativeState.turn,
  );
  if (merged == null) {
    return false;
  }
  pendingWaveAdvance = merged;
  pendingRawWavePresentations.delete(payload.wave);
  transaction.bootstrapProjected = true;

  if (coopWaveAdvanceBoundaryWakeFactory != null && coopHasPendingWaveAdvance()) {
    const wakeAlreadyQueued = globalScene.phaseManager?.getQueuedPhaseNames().includes("CoopFinalizeTurnPhase");
    if (!wakeAlreadyQueued) {
      globalScene.phaseManager.pushPhase(coopWaveAdvanceBoundaryWakeFactory());
    }
    const unparkedReplay =
      coopActiveReplayTurnAborter?.(
        `retained Authority V2 ${payload.outcome} wave=${payload.wave} settledTurn=${transaction.authoritativeState.turn}`,
        transaction.authoritativeState.turn,
      ) ?? false;
    coopLog(
      "v2-wave",
      `bootstrap wave=${payload.wave} outcome=${payload.outcome} wake=${Number(!wakeAlreadyQueued)} `
        + `unparkedReplay=${Number(unparkedReplay)}`,
    );
  }
  return true;
}

function applyCoopV2WaveDataAtBoundary(runtime: CoopRuntime, transaction: CoopV2WaveLiveTransaction): boolean {
  if (transaction.dataApplied) {
    return releaseCoopSettledWaveBoundary(transaction.transition.wave);
  }
  if (active !== runtime || runtime.controller.authorityRole !== "replica") {
    return false;
  }
  const sourceWave = transaction.transition.wave;
  const currentWave = globalScene.currentBattle?.waveIndex ?? -1;
  const phaseName = globalScene.phaseManager?.getCurrentPhase()?.phaseName;
  const exactQueuedBattleEnd =
    phaseName === "BattleEndPhase" && currentWave === sourceWave + 1 && isCoopSettledWaveBoundaryPending(sourceWave);
  const exactTerminalFinalizer =
    transaction.transition.outcome === "gameOver"
    && phaseName === "CoopFinalizeTurnPhase"
    && currentWave === sourceWave;
  if (
    (currentWave !== sourceWave && !exactQueuedBattleEnd)
    || (phaseName !== "BattleEndPhase" && !exactTerminalFinalizer)
  ) {
    return false;
  }

  const immutableState = structuredClone(transaction.authoritativeState);
  let applied = applyCoopAuthoritativeBattleState(immutableState, true);
  const appliedTick = coopAppliedStateTick();
  if (!applied && appliedTick > immutableState.tick) {
    applied = true;
    coopLog(
      "v2-wave",
      `DATA tick=${immutableState.tick} superseded by recovered tick=${appliedTick} wave=${sourceWave}`,
    );
  } else if (!applied && appliedTick === immutableState.tick) {
    applied = reapplyAcceptedCoopAuthoritativeBattleState(immutableState, true);
  }
  if (!applied) {
    return false;
  }
  if (!adoptCoopV2SettledWaveTurnCursor(transaction)) {
    return false;
  }
  transaction.dataApplied = true;
  coopLog("v2-wave", `DATA applied rev=${transaction.entryRevision} wave=${sourceWave} tick=${immutableState.tick}`);
  return releaseCoopSettledWaveBoundary(sourceWave);
}

/**
 * Adopt the ordered settlement cursor carried by WAVE_ADVANCE.
 *
 * The generic immutable state applier must remain counter-neutral: TURN_COMMIT, recovery, and interaction
 * snapshots cannot move control merely because their payload mentions a turn. This wave entry is different:
 * after its complete material image applies, the globally ordered log explicitly authorizes the source
 * battle's TurnEnd cursor. Reproduce only Battle.incrementTurn's structural reset (commands/seed), never
 * guest-local TurnEnd effects, and reject any jump larger than the one authenticated boundary.
 */
function adoptCoopV2SettledWaveTurnCursor(transaction: CoopV2WaveLiveTransaction): boolean {
  const battle = globalScene.currentBattle;
  if (battle == null) {
    return false;
  }
  const settledTurn = transaction.authoritativeState.turn;
  const action = classifyWaveSettlementCursor(
    transaction.transition.wave,
    settledTurn,
    transaction.transition.nextWave,
    battle.waveIndex,
    battle.turn,
  );
  switch (action) {
    case "already-settled":
    case "next-wave-ready":
      return true;
    case "advance-one": {
      const priorTurn = battle.turn;
      battle.incrementTurn();
      globalScene.phaseManager.dynamicQueueManager.clearLastTurnOrder();
      const adopted = battle.turn === settledTurn;
      coopLog(
        "v2-wave",
        `settlement cursor ${transaction.transition.wave}:${priorTurn}->${battle.waveIndex}:${battle.turn} `
          + `target=${transaction.transition.wave}:${settledTurn} adopted=${Number(adopted)}`,
      );
      return adopted;
    }
    case "invalid":
      coopWarn(
        "v2-wave",
        `settlement cursor refused source=${transaction.transition.wave}:${settledTurn} `
          + `nextWave=${transaction.transition.nextWave} live=${battle.waveIndex}:${battle.turn}`,
      );
      return false;
  }
}

function applyCoopV2WaveEntry(runtime: CoopRuntime, entry: CoopAuthorityEntry): ApplyMaterialResult {
  const decoded = decodeCoopV2WaveTransaction(entry);
  if (decoded == null) {
    return false;
  }
  const wave = decoded.transition.wave;
  const prior = runtime.v2WaveTransactions.get(wave);
  if (
    prior != null
    && (prior.entryRevision !== decoded.entryRevision
      || prior.operationId !== decoded.operationId
      || prior.materialDigest !== decoded.materialDigest)
  ) {
    return false;
  }
  const transaction = prior ?? decoded;
  if (prior == null) {
    runtime.v2WaveTransactions.set(wave, transaction);
  }
  if (!transaction.bootstrapProjected) {
    if (active === runtime) {
      bootstrapCoopV2WaveTransaction(runtime, transaction);
    } else {
      runWhenCoopRuntimeActive(runtime, () => {
        bootstrapCoopV2WaveTransaction(runtime, transaction);
      });
    }
  }
  // bootstrapCoopV2WaveTransaction appends the exact safe-boundary wake before this release. If the
  // TURN_COMMIT finalized before this entry arrived, dissolve that parked finalizer now so the wake is
  // next; if the wave was already buffered, finishTurn consumes it synchronously and this is a no-op.
  releaseCoopV2ParkedTurnBoundary(runtime, entry);
  if (transaction.bootstrapProjected && globalScene.phaseManager?.getCurrentPhase()?.phaseName === "BattleEndPhase") {
    applyCoopV2WaveDataAtBoundary(runtime, transaction);
  }
  return transaction.dataApplied ? true : "deferred";
}

function completeCoopV2WaveTransaction(runtime: CoopRuntime, transaction: CoopV2WaveLiveTransaction): void {
  transaction.continuationReady = true;
  runtime.v2CompletedWaveTransactions.set(transaction.transition.wave, transaction);
  runtime.v2WaveTransactions.delete(transaction.transition.wave);
  while (runtime.v2CompletedWaveTransactions.size > 32) {
    const oldestWave = runtime.v2CompletedWaveTransactions.keys().next().value;
    if (oldestWave == null) {
      break;
    }
    runtime.v2CompletedWaveTransactions.delete(oldestWave);
  }
}

/**
 * Prove that the current reward-like phase has actually opened its own executable handler.
 *
 * `handler.active` alone is insufficient: a freshly-current phase can inherit an active Title/Confirm/
 * Message handler from the phase it replaced. Accept only the mode owned by this exact phase. The biome
 * watcher is the one deliberate MESSAGE exception, and it publishes its phase-owned readiness latch only
 * after authoritative stock and the terminal-consumer loop are both live.
 */
function isCoopV2RewardContinuationSurfacePublic(phaseName: string | undefined): boolean {
  if (globalScene.ui.getHandler()?.active !== true) {
    return false;
  }
  const mode = globalScene.ui.getMode();
  switch (phaseName) {
    case "SelectModifierPhase": {
      // BiomeShopPhase deliberately inherits SelectModifierPhase.phaseName because the party/item
      // continuation machinery keys off it. Its non-owner never opens BIOME_SHOP: after reconstructing
      // authoritative stock it keeps an executable MESSAGE handler alive and sets this phase-owned latch.
      // Recognize that exact tuple here so the V2 WAVE_ADVANCE can install its REWARD control before the
      // following Crossroads interaction advances the owner counter and later entries become a permanent gap.
      const phase = globalScene.phaseManager?.getCurrentPhase() as
        | { coopBiomeWatcherContinuationReady?: boolean }
        | undefined;
      return (
        mode === UiMode.MODIFIER_SELECT
        || mode === UiMode.BIOME_SHOP
        || (mode === UiMode.MESSAGE && phase?.coopBiomeWatcherContinuationReady === true)
      );
    }
    case "TheBargainPhase":
      return mode === UiMode.ER_BARGAIN;
    case "ErCrossroadsPhase":
      return mode === UiMode.OPTION_SELECT;
    default:
      return false;
  }
}

function projectCoopV2WaveControl(
  runtime: CoopRuntime,
  control: NonNullable<CoopNextControl>,
): CoopControlInstallResult {
  const transaction = matchingCoopV2WaveTransaction(runtime, control);
  const controlId = controlIdOf(control as ProjectableControl);
  if (transaction == null) {
    return { kind: "rejected", reason: `no admitted V2 wave transaction owns ${controlId}` };
  }
  if (!transaction.dataApplied) {
    return { kind: "deferred", reason: `wave ${transaction.transition.wave} DATA has not reached BattleEnd` };
  }
  const phaseName = globalScene.phaseManager?.getCurrentPhase()?.phaseName;
  const handlerActive = globalScene.ui.getHandler()?.active === true;
  const currentWave = globalScene.currentBattle?.waveIndex ?? -1;
  const atTransactionWave =
    currentWave === transaction.transition.wave || currentWave === transaction.transition.nextWave;
  const installed = (): CoopControlInstallResult => {
    completeCoopV2WaveTransaction(runtime, transaction);
    return { kind: "installed", controlId };
  };
  switch (control.kind) {
    case "REWARD": {
      return atTransactionWave && isCoopV2RewardContinuationSurfacePublic(phaseName)
        ? installed()
        : { kind: "deferred", reason: `awaiting real reward surface for ${controlId}` };
    }
    case "BIOME": {
      return atTransactionWave && handlerActive && phaseName === "SelectBiomePhase"
        ? installed()
        : { kind: "deferred", reason: `awaiting real biome surface for ${controlId}` };
    }
    case "MYSTERY": {
      return atTransactionWave
        && handlerActive
        && (phaseName === "MysteryEncounterPhase"
          || phaseName === "CoopReplayMePhase"
          || phaseName === "PostMysteryEncounterPhase")
        ? installed()
        : { kind: "deferred", reason: `awaiting real Mystery surface for ${controlId}` };
    }
    case "TERMINAL":
      return (transaction.terminalId === control.terminalId && phaseName === "GameOverPhase")
        || isCoopSharedTerminalFrozen(runtime)
        ? installed()
        : { kind: "deferred", reason: `awaiting real terminal surface for ${controlId}` };
    default:
      return { kind: "rejected", reason: `${control.kind} is not a wave-owned continuation` };
  }
}

function projectCoopV2InteractionControl(
  runtime: CoopRuntime,
  control: Extract<ProjectableControl, { kind: "SHARED_INTERACTION" | "REPLACEMENT" | "AWAIT_SUCCESSOR" }>,
): CoopControlInstallResult {
  const controlId = controlIdOf(control);
  if (control.kind === "AWAIT_SUCCESSOR") {
    const result = runtime.v2ControlLedger.project(control, null, runtime.controller.localSeatId);
    if (result.kind === "installed" || result.kind === "already-installed") {
      runtime.v2InstalledInteractionTargets.add(result.controlId);
      const waveTransaction = matchingCoopV2WaveTransaction(runtime, control);
      if (waveTransaction != null && waveTransaction.dataApplied) {
        completeCoopV2WaveTransaction(runtime, waveTransaction);
      }
    }
    return result;
  }
  if (control.kind === "SHARED_INTERACTION") {
    const sourceEntry = runtime.v2ControlLedger.sourceEntryOf(control);
    const plan = sourceEntry == null ? null : projectionPlanOfCoopV2InteractionEntry(sourceEntry);
    if (plan == null) {
      return {
        kind: "rejected",
        reason: `shared interaction ${controlId} has no complete immutable projection capsule`,
      };
    }
    prepareCoopV2OrdinaryInteractionControlSurface(runtime, control, plan);
  } else if (runtime.controller.localSeatId === control.ownerSeatId) {
    prepareCoopV2OrdinaryReplacementControlSurface(runtime, control);
  }

  const contract = coopV2InteractionProofContract(control);
  const observation = observeCoopV2InteractionSurface(contract);
  const messageShopWatcherReady =
    control.kind === "REPLACEMENT"
    || observation?.uiMode !== UiMode.MESSAGE
    || ((control.operationKind === "SHOP_PRESENT" || control.operationKind === "SHOP_BUY")
      && runtime.controller.localSeatId !== control.ownerSeatId
      && (observation.phaseToken as { coopBiomeWatcherContinuationReady?: boolean }).coopBiomeWatcherContinuationReady
        === true);
  const publicSurface =
    (control.kind === "REPLACEMENT" && runtime.controller.localSeatId !== control.ownerSeatId)
    || (contract != null
      && observation != null
      && (contract.phaseNames as readonly string[]).includes(observation.phaseName)
      && (contract.uiModes as readonly number[]).includes(observation.uiMode)
      && messageShopWatcherReady);
  if (!publicSurface || (control.kind !== "REPLACEMENT" && observation == null)) {
    return {
      kind: "deferred",
      reason: `awaiting exact public interaction surface for ${controlId}`,
    };
  }
  const result = runtime.v2ControlLedger.project(
    control,
    control.kind === "REPLACEMENT" && runtime.controller.localSeatId !== control.ownerSeatId ? null : observation,
    runtime.controller.localSeatId,
  );
  if (result.kind === "installed" || result.kind === "already-installed") {
    runtime.v2InstalledInteractionTargets.add(result.controlId);
    const waveTransaction = matchingCoopV2WaveTransaction(runtime, control);
    if (waveTransaction != null && waveTransaction.dataApplied) {
      completeCoopV2WaveTransaction(runtime, waveTransaction);
    }
  }
  return result;
}

/**
 * Mark the exact globally-registered successor claim materially complete. applyEntry invokes every
 * projector only after this returns true, so no command, interaction, wave, terminal, or ordered-wait
 * receipt can be manufactured by a side set or by shadow bookkeeping.
 */
function markCoopV2ControlMaterialApplied(runtime: CoopRuntime, entry: CoopAuthorityEntry): boolean {
  if (!runtime.v2ControlLedger.markMaterialApplied(entry)) {
    return false;
  }
  if (entry.nextControl.kind === "REPLACEMENT" && releaseCoopV2DeferredInteractionStarts(runtime, entry.nextControl)) {
    // A replica can render a faint event before the authority reaches its settled TURN_COMMIT. Its
    // early picker deliberately retires without opening input and waits here. Reconstruct that exact
    // generation only after the immutable turn material is installed, then let ordinary projection
    // demand the real PARTY handler before signing controlInstalled.
    // The reconstructed picker is now immediately behind CoopFinalizeTurnPhase. Arm the exact
    // same-entry successor before that finalizer decides whether to park; if it already parked, this
    // releases it synchronously. Non-owners have no local picker and remain parked until the later
    // REPLACEMENT_COMMIT installs its authoritative checkpoint carrier.
    runtime.v2ProjectedReplacementControlId = controlIdOf(entry.nextControl);
    releaseCoopV2ParkedTurnBoundary(runtime, entry);
  }
  if (entry.kind !== "CONTROL_COMMIT" && entry.nextControl.kind === "COMMAND_FRONTIER") {
    // A replacement/wave/turn result can itself state the next command frontier. The real CommandPhase may
    // reach its admission gate while that result is still material-deferred (notably while a replacement
    // checkpoint is being applied). Once this exact ledger entry becomes materially complete, wake only
    // phases addressed by its immutable frontier. Waiting for another CONTROL_COMMIT is impossible because
    // this entry already owns command control; that missing wake was the post-replacement Showdown softlock.
    releaseCoopV2DeferredCommandStarts(runtime, entry.nextControl);
  }
  if (
    runtime.v2RecoveryWaitSuccessorOperationId === entry.operationId
    && entry.nextControl.kind !== "AWAIT_SUCCESSOR"
  ) {
    runtime.v2RecoveryWaitSuccessorOperationId = null;
    return releaseCoopV2RecoveryPhase(runtime);
  }
  return true;
}

/** Capture the exact current phase/handler generation; a keepalive or queued phase is never actionable proof. */
interface CoopV2InteractionProofContract {
  readonly phaseNames: readonly string[];
  readonly uiModes: readonly number[];
}

function coopV2InteractionProofContract(
  control: Extract<ProjectableControl, { kind: "SHARED_INTERACTION" | "REPLACEMENT" }>,
): CoopV2InteractionProofContract | null {
  return control.kind === "REPLACEMENT"
    ? {
        phaseNames: ["SwitchPhase", "CoopGuestFaintSwitchPhase", "ShowdownEnemyFaintSwitchPhase"],
        uiModes: [UiMode.PARTY],
      }
    : coopV2InteractionUiProofContract(control.surfaceClass, control.operationKind);
}

function observeCoopV2InteractionSurface(
  contract: CoopV2InteractionProofContract | null = null,
): CoopV2InteractionSurfaceObservation | null {
  try {
    const phase = globalScene.phaseManager?.getCurrentPhase();
    const handler = globalScene.ui?.getHandler() as
      | {
          active?: boolean;
          isCoopV2InputActionable?: () => boolean;
        }
      | undefined;
    if (phase == null || handler == null || typeof phase !== "object" || typeof handler !== "object") {
      return null;
    }
    const handlerActive = handler.active === true;
    const actionable =
      handlerActive && typeof handler.isCoopV2InputActionable === "function" && handler.isCoopV2InputActionable();
    const explicitProofName =
      typeof (phase as { coopV2ProofPhaseName?: unknown }).coopV2ProofPhaseName === "string"
        ? (phase as unknown as { coopV2ProofPhaseName: string }).coopV2ProofPhaseName
        : null;
    const concretePhaseName =
      contract?.phaseNames.find(
        phaseName =>
          phase.phaseName === phaseName
          || explicitProofName === phaseName
          || (typeof (phase as { is?: unknown }).is === "function"
            && (phase as unknown as { is: (candidate: string) => boolean }).is(phaseName)),
      ) ?? phase.phaseName;
    return {
      operationId:
        typeof (phase as { coopV2ControlOperationId?: unknown }).coopV2ControlOperationId === "string"
          ? (phase as unknown as { coopV2ControlOperationId: string }).coopV2ControlOperationId
          : null,
      // Markets deliberately inherit phaseName="SelectModifierPhase" for legacy mechanics. Their explicit
      // V2 identity binds the concrete registered subclass without changing that load-bearing legacy name.
      phaseName: concretePhaseName,
      uiMode: globalScene.ui.getMode(),
      phaseToken: phase,
      handlerToken: handler,
      handlerActive,
      actionable,
    };
  } catch {
    return null;
  }
}

/**
 * Physical UI input gate for the interaction cutover. Programmatic peer replay calls the handler directly
 * and bypasses this gate; a local human is authorized only by the exact active phase/handler generation.
 */
export function isCoopV2InteractionHumanInputFrozen(runtime: CoopRuntime | null = active): boolean {
  if (runtime == null || !coopV2ShadowHarnesses.has(runtime)) {
    return false;
  }
  const ledger = runtime.v2ControlLedger;
  const pending = ledger.latestControl;
  if (
    pending == null
    || (pending.kind !== "SHARED_INTERACTION" && pending.kind !== "REPLACEMENT" && pending.kind !== "AWAIT_SUCCESSOR")
  ) {
    // Until wave/reward/command controls share this ledger, an absence of an interaction claim is not proof
    // that the current screen belongs to the interaction domain. Once a claim exists, enforcement is strict.
    return false;
  }
  projectCoopV2InteractionControl(runtime, pending);
  if (pending.kind === "AWAIT_SUCCESSOR") {
    const activeControl = ledger.activeControl;
    const battle = globalScene.currentBattle;
    const phase = globalScene.phaseManager?.getCurrentPhase();
    const handler = globalScene.ui?.getHandler() as
      | {
          active?: boolean;
          isCoopV2InputActionable?: () => boolean;
        }
      | undefined;
    const messageHandlerActionable =
      globalScene.ui?.getMode() === UiMode.MESSAGE
      && handler?.active === true
      && typeof handler.isCoopV2InputActionable === "function"
      && handler.isCoopV2InputActionable();
    if (
      activeControl?.kind === "AWAIT_SUCCESSOR"
      && controlsEqual(activeControl, pending)
      && ledger.isMaterialApplied(pending)
      && battle != null
      && phase != null
      && successorWaitAllowsLocalPresentationInput(pending, {
        sessionEpoch: runtime.controller.sessionEpoch,
        wave: battle.waveIndex,
        turn: battle.turn,
        phaseName: phase.phaseName,
        messageHandlerActionable,
      })
    ) {
      return false;
    }
  }
  const contract = pending.kind === "AWAIT_SUCCESSOR" ? null : coopV2InteractionProofContract(pending);
  return !ledger.allowsHumanInput(runtime.controller.localSeatId, observeCoopV2InteractionSurface(contract));
}

/** Retry the exact retained interaction claim after a real phase reports that its public handler is active. */
export function notifyCoopV2InteractionSurfaceReady(runtime: CoopRuntime | null = active): boolean {
  if (runtime == null || !coopV2ShadowHarnesses.has(runtime)) {
    return false;
  }
  const control = runtime.v2ControlLedger.latestControl;
  if (control?.kind !== "SHARED_INTERACTION" && control?.kind !== "REPLACEMENT") {
    return false;
  }
  const projected = projectCoopV2InteractionControl(runtime, control);
  coopV2ShadowHarnesses.get(runtime)?.retryPendingReplicaEntries();
  return projected.kind === "installed" || projected.kind === "already-installed";
}

/** Read the exact unsuperseded shared-control address for a recovery-created public phase. */
export function getCoopV2ActiveSharedInteractionOperationId(
  surfaceClass: Exclude<CoopOperationSurfaceClass, "op:faintSwitch" | "op:wave">,
  operationKind: CoopV2InteractionOperationKind,
  runtime: CoopRuntime | null = active,
): string | null {
  const control = runtime?.v2ControlLedger.latestControl;
  return control?.kind === "SHARED_INTERACTION"
    && control.surfaceClass === surfaceClass
    && control.operationKind === operationKind
    ? control.operationId
    : null;
}

/** Reassert command-screen trainer chrome after a V2 state image installs on the authoritative guest. */
function ensureCoopV2CommandPresentation(runtime: CoopRuntime): void {
  if (
    runtime.controller.role !== "guest"
    || runtime.controller.netcodeMode !== "authoritative"
    || runtime.controller.sessionKind !== "coop"
  ) {
    return;
  }
  const repairedPlayerTrainer = globalScene.trainer.visible;
  globalScene.trainer.setVisible(false);
  if (repairedPlayerTrainer) {
    coopLog("renderer", "V2 command presentation hid stale player trainer");
  }
  const enemyTrainer = globalScene.currentBattle?.trainer;
  const repairedEnemyTrainer = enemyTrainer != null && (enemyTrainer.visible || enemyTrainer.alpha > 0);
  enemyTrainer?.setAlpha(0).setVisible(false);
  if (repairedEnemyTrainer) {
    coopLog("renderer", "V2 command presentation hid stale enemy trainer");
  }
}

/**
 * Build the LIVE replica seams (cutover surface 1). The guest applies a delivered TURN_COMMIT through the
 * REAL engine: the material applier reconstructs the COMPLETE legacy turn resolution from the enriched
 * material companions and feeds it through the streamer's admission path (so the guest's own non-suppressed
 * presentation flow CoopReplayTurnPhase -> CoopFinalizeTurnPhase -> CommandPhase resolves even when the
 * now-cosmetic legacy carrier is lost/raced). It reports materialApplied ONLY on a later redelivery after
 * that exact immutable revision completed the real checkpoint/full-state/checksum/finalize path; buffering
 * is admission, never application. The projector likewise waits for an address-exact CommandPhase proof
 * recorded by the real engine (it never signs merely because projection was requested). A
 * non-cutover kind / non-COMMAND control returns `null` so the harness falls through to pure shadow. Every
 * verb is guarded so an engine throw becomes a `false`/`null` (material rejected / fall-through), never a
 * crash into the frame handler.
 */
function buildCoopV2LiveSeams(
  runtime: CoopRuntime,
  surfaces: {
    readonly turn: boolean;
    readonly replacement: boolean;
    readonly wave: boolean;
    readonly interaction: boolean;
    readonly control: boolean;
  },
): CoopV2LiveReplicaSeams {
  const seams: CoopV2LiveReplicaSeams = {
    ownsEntry: entry =>
      (surfaces.turn && entry.kind === "TURN_COMMIT")
      || (surfaces.replacement && entry.kind === "REPLACEMENT_COMMIT")
      || (surfaces.wave && (entry.kind === "WAVE_ADVANCE" || entry.kind === "TERMINAL_COMMIT"))
      || (surfaces.interaction && entry.kind === "INTERACTION_COMMIT")
      || (surfaces.control && entry.kind === "CONTROL_COMMIT"),
    ownsControl: control =>
      ((surfaces.turn || surfaces.replacement || surfaces.wave || surfaces.interaction)
        && control.kind === "AWAIT_SUCCESSOR")
      || ((surfaces.turn || surfaces.control) && control.kind === "COMMAND_FRONTIER")
      || (surfaces.replacement && control.kind === "REPLACEMENT")
      || (surfaces.interaction && control.kind === "SHARED_INTERACTION")
      || (surfaces.wave
        && (control.kind === "REWARD"
          || control.kind === "BIOME"
          || control.kind === "MYSTERY"
          || control.kind === "TERMINAL")),
    prepareAuthorityEntry: (_ctx: CoopRuntimeContext, entry: CoopAuthorityEntry): (() => void) | null => {
      if (
        runtime.controller.authorityRole !== "authority"
        || !seams.ownsEntry(entry)
        || !seams.ownsControl(entry.nextControl)
      ) {
        return null;
      }
      // Result entries are not complete merely because the authority captured a post-action state image.
      // The exact local consumer must first prove that it finished the action/phase addressed by this
      // operation. This is the authority-side twin of the replica's pre-ACK settlement gate below.
      if (entry.kind === "INTERACTION_COMMIT") {
        const material = decodeCoopV2InteractionEnvelope(entry);
        if (
          material == null
          || (requiresCoopV2InteractionTerminalProof(material.surfaceClass, material.envelope)
            && !runtime.v2SettledInteractionOperations.has(entry.operationId))
        ) {
          return null;
        }
      }
      return runtime.v2ControlLedger.prepareAuthorityEntry(entry);
    },
    authorityEntryCommitted: (ctx: CoopRuntimeContext, entry: CoopAuthorityEntry): void => {
      if (entry.kind === "INTERACTION_COMMIT") {
        const material = decodeCoopV2InteractionEnvelope(entry);
        if (material == null) {
          failCoopRuntimeSharedSession(
            runtime,
            `Authority V2 committed malformed interaction material for ${entry.operationId}.`,
            {
              boundary: "protocol",
              reasonCode: "invalid-authority",
              wave: globalScene.currentBattle?.waveIndex ?? 0,
              turn: globalScene.currentBattle?.turn ?? 0,
            },
          );
          return;
        }
        // The authority authored this complete post-action image from its live state; no replica sink runs
        // locally. Record only the idempotency evidence after the log commit itself became durable.
        runtime.opState.materializedOperationKeys.add(`${material.surfaceClass}:${entry.operationId}`);
      }
      const projected =
        entry.nextControl.kind === "TERMINAL"
          ? runtime.v2ControlLedger.projectMechanical(entry.nextControl, () => {
              const phaseName = globalScene.phaseManager?.getCurrentPhase()?.phaseName;
              return phaseName === "GameOverPhase" || isCoopSharedTerminalFrozen(runtime)
                ? { kind: "installed", controlId: controlIdOf(entry.nextControl) }
                : {
                    kind: "deferred",
                    reason: `awaiting real authority terminal surface for ${controlIdOf(entry.nextControl)}`,
                  };
            })
          : seams.projectControl(ctx, entry.nextControl);
      if (projected == null || projected.kind === "rejected") {
        failCoopRuntimeSharedSession(
          runtime,
          `Authority V2 could not install its committed successor for ${entry.operationId}.`,
          {
            boundary: "protocol",
            reasonCode: "invalid-authority",
            wave: globalScene.currentBattle?.waveIndex ?? 0,
            turn: globalScene.currentBattle?.turn ?? 0,
          },
        );
        return;
      }
      if (projected.kind !== "installed" && projected.kind !== "already-installed") {
        return;
      }
      if (entry.nextControl.kind === "COMMAND_FRONTIER") {
        // An authority-side CommandPhase can have reached its V2 gate while a same-address interaction
        // still owned control. The later ordered command-open is the only event allowed to wake it.
        releaseCoopV2DeferredCommandStarts(runtime, entry.nextControl);
      } else if (
        entry.nextControl.kind === "AWAIT_SUCCESSOR"
        && entry.nextControl.allowedKinds.includes("CONTROL_COMMIT")
      ) {
        // A settled interaction decision installs AWAIT_SUCCESSOR before the authority is allowed to mint
        // the next command frontier. Retry one real parked CommandPhase under its captured runtime. Its
        // nested CONTROL_COMMIT releases any remaining same-address fields after the immutable aggregate
        // frontier has been accepted by the log.
        resumeOneCoopV2DeferredAuthorityCommandStart(runtime, entry.nextControl);
      }
    },
    admitEntry: (_ctx: CoopRuntimeContext, entry: CoopAuthorityEntry): boolean => {
      const releasesRecoveredWait = runtime.v2ControlLedger.activeControl?.kind === "AWAIT_SUCCESSOR";
      if (!runtime.v2ControlLedger.admitSuccessor(entry) || !runtime.v2ControlLedger.registerEntry(entry)) {
        return false;
      }
      // A recovered AWAIT_SUCCESSOR keeps its apply phase parked through mere admission. Only immutable
      // successor material may release it, immediately before the ordinary projector proves real control.
      if (releasesRecoveredWait) {
        runtime.v2RecoveryWaitSuccessorOperationId = entry.operationId;
      }
      return true;
    },
    releaseBlockedPredecessor: (_ctx: CoopRuntimeContext, entry: CoopAuthorityEntry): boolean | null => {
      if (entry.kind !== "REPLACEMENT_COMMIT" || !surfaces.replacement) {
        return null;
      }
      // Do not apply the post-summon carrier out of order. The only permitted early effect is consuming
      // the address-exact committed answer on the old picker that is preventing the prior TURN_COMMIT from
      // finalizing. The replacement entry remains a gap, sends no receipt, and will be fully applied only
      // after the predecessor advances the ordered ledger.
      const image = decodeReplacementCommitMaterial(entry);
      if (image == null) {
        return false;
      }
      return materializeCoopV2ReplacementPickerTerminal(image, runtime.controller.localSeatId, runtime.opState);
    },
    applyMaterial: (_ctx: CoopRuntimeContext, entry: CoopAuthorityEntry): ApplyMaterialResult | null => {
      if (
        (entry.kind !== "TURN_COMMIT" || !surfaces.turn)
        && (entry.kind !== "REPLACEMENT_COMMIT" || !surfaces.replacement)
        && ((entry.kind !== "WAVE_ADVANCE" && entry.kind !== "TERMINAL_COMMIT") || !surfaces.wave)
        && (entry.kind !== "INTERACTION_COMMIT" || !surfaces.interaction)
        && (entry.kind !== "CONTROL_COMMIT" || !surfaces.control)
      ) {
        return null;
      }
      // The turn AUTHORITY never REPLICATES its OWN committed turn. A proper peer transport delivers the
      // TURN_COMMIT to the OTHER seat's replica; but a self-loopback (a single-engine spoof peer / the
      // module-level inbound fallback when the peer transport exposes no per-instance v2 handler) routes the
      // authority's own frame back into its own replica pipeline. Re-applying the numeric checkpoint onto the
      // authority's OWN live scene reconstructs each mon's Status from the effect-only checkpoint, DROPPING
      // companions the effect number cannot carry (e.g. a freshly-settled Yawn sleep's sleepTurnsRemaining) -
      // corrupting live state the host already authored correctly. Fall through to pure shadow (in-memory
      // accounting only, no engine mutation): the authority owns the turn, it must not replicate it.
      if (runtime.controller.authorityRole === "authority") {
        return null;
      }
      try {
        if (entry.kind === "INTERACTION_COMMIT") {
          const material = decodeCoopV2InteractionEnvelope(entry);
          const operation = material?.envelope.pendingOperation;
          if (
            material == null
            || operation == null
            || !runtime.v2ControlLedger.registerEntry(entry)
            || !isCompleteCoopOperationAuthorityState(
              material.envelope.authoritativeState,
              material.envelope.wave,
              material.envelope.turn,
            )
          ) {
            return false;
          }
          const receiverScene = runtimeSceneBindings.get(runtime);
          if (receiverScene != null && receiverScene !== globalScene) {
            return "deferred";
          }
          const stateApplied = runtime.v2InteractionStateApplied.has(entry.operationId)
            ? reapplyAcceptedCoopAuthoritativeBattleState(material.envelope.authoritativeState, true)
            : applyCoopAuthoritativeBattleState(material.envelope.authoritativeState, true);
          if (!stateApplied) {
            const failures = drainCoopApplyFailures();
            coopWarn(
              "v2-interaction",
              `DATA state apply rejected rev=${entry.revision} class=${material.surfaceClass} op=${entry.operationId} `
                + `incomingTick=${material.envelope.authoritativeState.tick} acceptedTick=${coopAppliedStateTick()} `
                + `phase=${globalScene.phaseManager?.getCurrentPhase()?.constructor?.name ?? "none"} `
                + `failures=${JSON.stringify(failures)}`,
            );
            return false;
          }
          runtime.v2InteractionStateApplied.add(entry.operationId);
          const outcome = withActiveCoopRuntimeOpState(runtime.opState, () =>
            applyCoopOperationEnvelopeThroughRegisteredApplier(material.surfaceClass, material.envelope, {
              authority: "v2",
              revision: entry.revision,
              operationId: entry.operationId,
              sessionEpoch: entry.context.sessionEpoch,
            }),
          );
          if (outcome === "applied" || outcome === "duplicate") {
            if (
              requiresCoopV2InteractionTerminalProof(material.surfaceClass, material.envelope)
              && !runtime.v2SettledInteractionOperations.has(entry.operationId)
            ) {
              return "deferred";
            }
            if (!markCoopV2ControlMaterialApplied(runtime, entry)) {
              return false;
            }
            coopLog(
              "v2-interaction",
              `DATA applied rev=${entry.revision} class=${material.surfaceClass} op=${entry.operationId}`,
            );
            return true;
          }
          return outcome === "deferred" ? "deferred" : false;
        }
        if (entry.kind === "CONTROL_COMMIT") {
          const material = decodeControlOpenEntry(entry);
          if (material == null || !runtime.v2ControlLedger.registerEntry(entry)) {
            return false;
          }
          const receiverScene = runtimeSceneBindings.get(runtime);
          if (receiverScene != null && receiverScene !== globalScene) {
            return "deferred";
          }
          if (
            material.kind === "command-open"
            && commandOpenMaterialMustWaitForPresentation(globalScene.phaseManager?.getCurrentPhase()?.phaseName)
          ) {
            // Do not let the absolute command-state projector kill an encounter tween whose onComplete
            // callback is the only structural route to the real CommandPhase. The immutable entry stays
            // admitted and is retried from that CommandPhase's boundary below.
            coopLog(
              "v2-control",
              `deferred command-open rev=${entry.revision} until encounter presentation reaches CommandPhase`,
            );
            return "deferred";
          }
          const stateApplied =
            applyCoopAuthoritativeBattleState(material.authoritativeState, true)
            || reapplyAcceptedCoopAuthoritativeBattleState(material.authoritativeState, true);
          if (!stateApplied) {
            return false;
          }
          if (!markCoopV2ControlMaterialApplied(runtime, entry)) {
            return false;
          }
          if (material.kind === "interaction-open") {
            if (entry.nextControl.kind !== "SHARED_INTERACTION") {
              return false;
            }
            // The exact phase wake must be queued before a preceding AWAIT_SUCCESSOR turn is released.
            // A fast buffered entry may arm that release before the finalizer reaches its park decision;
            // CoopFinalizeTurnPhase retains the authenticated edge until then.
            if (releaseCoopV2DeferredInteractionStarts(runtime, entry.nextControl)) {
              releaseCoopV2ParkedTurnBoundary(runtime, entry);
            }
            return true;
          }
          ensureCoopV2CommandPresentation(runtime);
          if (entry.nextControl.kind !== "COMMAND_FRONTIER") {
            return false;
          }
          // A CONTROL_COMMIT is the ordered wake for a preceding TURN_COMMIT whose successor was
          // AWAIT_SUCCESSOR. Replacement and wave entries already dissolve that parked finalizer after
          // installing their carrier; command-open must do the same after its complete state image is
          // materialized. Otherwise the real TurnInit -> CommandPhase chain can never be created, while the
          // control projector correctly waits forever for proof from that nonexistent CommandPhase.
          //
          // Ending the finalizer here does not reintroduce queue-order authority: this exact authenticated
          // CONTROL_COMMIT, after materialApplied, is the sole event that permits the ordinary structural
          // chain to advance. The resulting CommandPhase must still cross its address-exact V2 boundary and
          // publish the real controlInstalled proof before the entry can retire.
          releaseCoopV2ParkedTurnBoundary(runtime, entry);
          releaseCoopV2DeferredCommandStarts(runtime, entry.nextControl);
          return true;
        }
        if (entry.kind === "WAVE_ADVANCE" || entry.kind === "TERMINAL_COMMIT") {
          if (!surfaces.wave) {
            return null;
          }
          const result = applyCoopV2WaveEntry(runtime, entry);
          return result === true && !markCoopV2ControlMaterialApplied(runtime, entry) ? false : result;
        }
        if (entry.kind === "REPLACEMENT_COMMIT") {
          const image = decodeReplacementCommitMaterial(entry);
          if (image == null || image.authorityCarrier == null) {
            return false;
          }
          // A timeout/fallback commit is also the authoritative close of the old owner picker. Do not
          // install the post-summon state under a still-open modal; redelivery retries after its bounded
          // MESSAGE transition reaches the exact source address.
          if (!materializeCoopV2ReplacementPickerTerminal(image, runtime.controller.localSeatId, runtime.opState)) {
            return "deferred";
          }
          const checkpoint = reconstructCoopV2ReplacementCheckpoint(entry);
          if (checkpoint == null) {
            return false;
          }
          if (runtime.battleStream.hasFinalizedAuthoritativeV2Replacement(checkpoint)) {
            return markCoopV2ControlMaterialApplied(runtime, entry);
          }
          runtime.battleStream.ingestAuthoritativeV2Replacement(checkpoint);
          // The checkpoint is now retained in the correct replica stream. Release a preceding
          // null-successor turn only after that carrier exists, allowing the normal TurnInit/replay path
          // to consume it without opening a phantom command first.
          releaseCoopV2ParkedTurnBoundary(runtime, entry);
          return "deferred";
        }
        const payload = entry.material.payload as TurnResolutionImage | undefined;
        const checkpoint = payload?.checkpoint;
        if (payload == null || checkpoint == null || typeof checkpoint !== "object") {
          return false; // malformed TURN material - refuse before signing materialApplied.
        }
        // Feed the guest's REAL progression: reconstruct the COMPLETE legacy turn resolution from the
        // enriched material companions and deliver it through the streamer's admission path - the SAME
        // seam the (now-cosmetic, unretained) legacy carrier uses. This resolves the guest's parked
        // CoopReplayTurnPhase pump -> CoopFinalizeTurnPhase (which applies checkpoint + authoritativeState
        // + fullField and verifies the checksum) -> CommandPhase, so a lost/raced cosmetic carrier can no
        // longer starve the guest (the soft-lock class) and the terrain/arenaTags/field companions the
        // numeric checkpoint omits converge (the wave-start drift class). Idempotent: the streamer classes
        // an identical redelivery as a re-ACK/ignore, so first delivery and every redelivery are equivalent.
        //
        // CONTEXT-BIND (never ambient): the authority log delivers the FIRST TURN_COMMIT SYNCHRONOUSLY on
        // commit, so in a single-realm (duo) session this seam runs under the HOST ambient while the entry
        // is destined for the GUEST replica. admit() then dedupes the backoff redeliveries, so this seam
        // runs at most once per entry. Reading the ambient getCoopBattleStreamer() would therefore wake the
        // HOST streamer's inbox and strand the guest's parked CoopReplayTurnPhase (which awaits THIS
        // runtime's streamer) forever. Ingest into runtime.battleStream directly so the correct replica
        // wakes regardless of which scene is ambient at synchronous-delivery time.
        const resolution = reconstructCoopV2TurnResolution(payload);
        if (resolution != null) {
          // Redelivery after the exact live finalize is the ONLY success proof. In particular, an entry
          // merely accepted into highestSeen/inbox is still only ADMITTED: signing materialApplied there
          // retired turns while CoopFinalizeTurnPhase could still fail its full-state/checksum install.
          if (runtime.battleStream.hasFinalizedAuthoritativeV2Turn(resolution)) {
            return markCoopV2ControlMaterialApplied(runtime, entry);
          }
          runtime.battleStream.ingestAuthoritativeV2Turn(resolution, entry.nextControl, entry.revision);
          return "deferred";
        }
        // A negotiated cutover peer must carry the complete companions. A numeric checkpoint alone cannot
        // prove moves/items/tags/terrain/arena state, so fail closed and retain for recovery instead of
        // emitting a false materialApplied receipt for a partial image.
        return false;
      } catch (error) {
        coopWarn("v2-turn", `live applyMaterial threw for rev=${entry.revision}`, error);
        return false;
      }
    },
    projectControl: (
      _ctx: CoopRuntimeContext,
      control: NonNullable<CoopNextControl>,
    ): CoopControlInstallResult | null => {
      if (
        control.kind === "AWAIT_SUCCESSOR"
        || (surfaces.replacement && control.kind === "REPLACEMENT")
        || (surfaces.interaction && control.kind === "SHARED_INTERACTION")
      ) {
        try {
          return projectCoopV2InteractionControl(runtime, control);
        } catch (error) {
          coopWarn("v2-interaction", "live interaction projectControl threw", error);
          return null;
        }
      }
      if (
        surfaces.wave
        && (control.kind === "REWARD"
          || control.kind === "BIOME"
          || control.kind === "MYSTERY"
          || control.kind === "TERMINAL")
      ) {
        try {
          return runtime.v2ControlLedger.projectMechanical(control, () => projectCoopV2WaveControl(runtime, control));
        } catch (error) {
          coopWarn("v2-wave", "live wave/terminal projectControl threw", error);
          return null;
        }
      }
      if (control.kind !== "COMMAND_FRONTIER") {
        return null;
      }
      try {
        const controlId = controlIdOf(control as ProjectableControl);
        // The entry states every human actor, while this authenticated replica proves only its numeric-seat
        // partition. Authority retirement requires every required peer's receipt, so the union is the complete
        // frontier; one renderer never fabricates another player's input phase. A seat controlling multiple
        // mons must still cross every one of its real CommandPhase chokepoints before it can sign.
        const localCommands = commandTargetsOwnedBySeat(control, _ctx.localSeatId);
        const missing = localCommands.filter(
          command =>
            !runtime.v2InstalledCommandTargets.has(
              commandControlTargetId(control.epoch, control.wave, control.turn, command),
            ),
        );
        return runtime.v2ControlLedger.projectMechanical(control, () => {
          if (missing.length > 0) {
            return {
              kind: "deferred",
              reason:
                `awaiting ${missing.length}/${localCommands.length} local-seat real CommandPhase proofs `
                + `(frontier=${control.commands.length}) for ${controlId}`,
            };
          }
          if (surfaces.wave) {
            const waveTransaction = matchingCoopV2WaveTransaction(runtime, control);
            if (waveTransaction != null && waveTransaction.dataApplied) {
              completeCoopV2WaveTransaction(runtime, waveTransaction);
            }
          }
          return { kind: "already-installed", controlId };
        });
      } catch (error) {
        coopWarn("v2-turn", "live projectControl threw", error);
        return null;
      }
    },
  };
  return seams;
}

function materializeCoopV2InteractionProjection(
  runtime: CoopRuntime,
  control: Extract<ProjectableControl, { kind: "SHARED_INTERACTION" }>,
  plan: CoopV2InteractionProjectionPlan,
): Phase | null {
  const phaseManager = globalScene.phaseManager;
  const ownerIsLocal = control.ownerSeatId === runtime.controller.localSeatId;
  switch (plan.kind) {
    case "ability": {
      const phase = phaseManager.create(
        plan.phaseName,
        plan.presentation.partyIndex,
        plan.presentation.pinned,
        !ownerIsLocal,
      ) as Phase & {
        installCoopV2AbilityPresentation(operationId: string, presentation: CoopAbilityPresentationPayload): boolean;
      };
      return phase.installCoopV2AbilityPresentation(plan.operationId, plan.presentation) ? phase : null;
    }
    case "bargain": {
      const indices = plan.sins.map(sin => BARGAIN_SIN_ORDER.indexOf(sin as (typeof BARGAIN_SIN_ORDER)[number]));
      if (indices.some(index => index < 0)) {
        return null;
      }
      runtime.interactionRelay.materializeCommittedInteractionChoice(
        COOP_BARGAIN_SEQ_BASE + plan.pinned,
        COOP_BARGAIN_PRESENT_KIND,
        0,
        indices,
        plan.operationId,
      );
      const phase = phaseManager.create("TheBargainPhase") as Phase & {
        installCoopV2BargainPresentation(operationId: string, pinned: number): boolean;
      };
      return phase.installCoopV2BargainPresentation(plan.operationId, plan.pinned) ? phase : null;
    }
    case "biome": {
      const phase = phaseManager.create("SelectBiomePhase", plan.sourceWave, control.turn) as Phase & {
        installCoopV2BiomeProjection(operationId: string, sourceWave: number, sourceTurn: number): boolean;
      };
      return phase.installCoopV2BiomeProjection(plan.operationId, plan.sourceWave, control.turn) ? phase : null;
    }
    case "crossroads": {
      const phase = phaseManager.create("ErCrossroadsPhase", plan.sourceWave, control.turn) as Phase & {
        installCoopV2CrossroadsProjection(operationId: string, sourceWave: number, sourceTurn: number): boolean;
      };
      return phase.installCoopV2CrossroadsProjection(plan.operationId, plan.sourceWave, control.turn) ? phase : null;
    }
    case "catch-full":
      return ownerIsLocal
        ? phaseManager.create("CoopGuestCatchFullPhase", plan.pokemonName, plan.speciesId, plan.operationId)
        : null;
    case "colosseum":
      return phaseManager.create(
        "CoopGuestColosseumChoicePhase",
        plan.labels,
        plan.round,
        ownerIsLocal,
        plan.operationId,
        () => undefined,
      );
    case "learn-move":
      return phaseManager.create(
        "CoopReplayLearnMovePhase",
        plan.partySlot,
        plan.moveId,
        plan.maxMoveCount,
        plan.operationId,
        ownerIsLocal,
      );
    case "learn-move-batch":
      return phaseManager.create(
        "CoopReplayLearnMoveBatchPhase",
        plan.partySlot,
        [...plan.learnableIds],
        plan.ownerIsGuest,
        plan.operationId,
      );
    case "mystery": {
      if (coopMeInteractionStartValue() !== plan.pinned) {
        return null;
      }
      setCoopMeActivePresentation(plan.presentation);
      runtime.interactionRelay.materializeCommittedInteractionOutcome(
        COOP_ME_PUMP_SEQ_BASE + plan.pinned,
        plan.presentation,
        plan.operationId,
      );
      const phase = phaseManager.create("CoopReplayMePhase", plan.pinned, undefined, plan.operationId) as Phase & {
        installCoopV2MePresentation(
          operationId: string,
          interactionCounter: number,
          presentation: Extract<CoopInteractionOutcome, { k: "mePresent" }>,
        ): boolean;
      };
      return phase.installCoopV2MePresentation(plan.operationId, plan.pinned, plan.presentation) ? phase : null;
    }
    case "revival":
      return phaseManager.create("CoopGuestRevivalPhase", plan.fieldIndex, plan.operationId, ownerIsLocal);
    case "reward": {
      runtime.interactionRelay.materializeCommittedRewardOptions(
        plan.projection.pinned,
        plan.projection.reroll,
        structuredClone(plan.projection.options) as CoopSerializedRewardOption[],
        plan.projection.rewardSurface,
        plan.operationId,
      );
      const phase = phaseManager.create(
        "SelectModifierPhase",
        plan.projection.reroll,
        undefined,
        undefined,
        false,
        {
          kind: "inherited",
          address: { wave: control.wave, turn: control.turn },
        },
        plan.projection.rewardSurface,
      ) as Phase & {
        installCoopV2RewardProjection(
          operationId: string,
          projection: Extract<CoopRewardPresentationPayload, { readonly surface: "reward" }>,
        ): boolean;
      };
      return phase.installCoopV2RewardProjection(plan.operationId, plan.projection) ? phase : null;
    }
    case "market": {
      runtime.interactionRelay.materializeCommittedRewardOptions(
        plan.projection.pinned,
        plan.projection.reroll,
        structuredClone(plan.projection.options) as CoopSerializedRewardOption[],
        plan.projection.rewardSurface,
        plan.operationId,
        {
          marketKind: plan.projection.marketKind,
          remainingStock: [...plan.projection.remainingStock],
        },
      );
      const phaseName =
        plan.projection.marketKind === "biome"
          ? "BiomeShopPhase"
          : plan.projection.marketKind === "exotic"
            ? "ExoticShopPhase"
            : plan.projection.marketKind === "black-market"
              ? "BlackMarketShopPhase"
              : "ImportBazaarShopPhase";
      const phase = phaseManager.create(phaseName, 0, undefined, undefined, false, {
        kind: "inherited",
        address: { wave: control.wave, turn: control.turn },
      }) as Phase & {
        installCoopV2MarketProjection(
          operationId: string,
          projection: Extract<CoopRewardPresentationPayload, { readonly surface: "market" }>,
        ): boolean;
      };
      return phase.installCoopV2MarketProjection(plan.operationId, plan.projection) ? phase : null;
    }
    case "stormglass": {
      const phase = phaseManager.create("ErStormglassPickerPhase") as Phase & {
        installCoopV2StormglassPresentation(
          operationId: string,
          presentation: CoopStormglassPresentationPayload,
        ): boolean;
      };
      return phase.installCoopV2StormglassPresentation(plan.operationId, plan.presentation) ? phase : null;
    }
  }
}

/**
 * Queue an ordinary owner replacement directly from its immutable V2 address when no cosmetic faint replay
 * produced the same wake. The current finalizer remains the causal fence until this exact phase is behind it;
 * PARTY handler readiness, not queue insertion, still owns controlInstalled.
 */
function prepareCoopV2OrdinaryReplacementControlSurface(
  runtime: CoopRuntime,
  control: Extract<ProjectableControl, { kind: "REPLACEMENT" }>,
): boolean {
  if (runtime.controller.authorityRole !== "replica" || runtime.controller.localSeatId !== control.ownerSeatId) {
    return false;
  }
  const sourceEntry = runtime.v2ControlLedger.sourceEntryOf(control);
  if (sourceEntry == null || !controlsEqual(sourceEntry.nextControl, control)) {
    return false;
  }
  const controlId = controlIdOf(control);
  if (runtime.v2ProjectedReplacementControlId === controlId || runtime.v2RecoveryPreparedControlId === controlId) {
    // A wake installed during receipt completion may have beaten finishTurn's park decision. Re-present
    // the same authenticated edge idempotently so either race order releases the exact finalizer.
    releaseCoopV2ParkedTurnBoundary(runtime, sourceEntry);
    return true;
  }
  const receiverScene = runtimeSceneBindings.get(runtime);
  if (receiverScene != null && receiverScene !== globalScene) {
    return false;
  }
  const phaseManager = globalScene.phaseManager;
  const current = phaseManager?.getCurrentPhase();
  if (current == null) {
    return false;
  }
  const currentOperationId =
    typeof (current as { coopV2ControlOperationId?: unknown }).coopV2ControlOperationId === "string"
      ? (current as unknown as { coopV2ControlOperationId: string }).coopV2ControlOperationId
      : null;
  if (current.is("CoopGuestFaintSwitchPhase") && currentOperationId === control.operationId) {
    runtime.v2ProjectedReplacementControlId = controlId;
    return true;
  }
  if (!current.is("CoopFinalizeTurnPhase")) {
    return false;
  }
  phaseManager.unshiftNew("CoopGuestFaintSwitchPhase", control.fieldIndex, {
    wave: control.wave,
    turn: control.turn,
    occurrence: control.occurrence,
  });
  runtime.v2ProjectedReplacementControlId = controlId;
  releaseCoopV2ParkedTurnBoundary(runtime, sourceEntry);
  coopLog("v2-control", `projected exact replacement generation for ${controlId} from immutable control`);
  return true;
}

/**
 * Install an ordinary replica's exact V2 successor when the obsolete local phase tree cannot reach it.
 *
 * Most interaction phases still arrive naturally at their committed successor and are proven in place. A
 * Mystery presentation is different: its immutable state can arrive while the replica is still inside the
 * previous wave's asynchronous NextEncounter tween. Waiting for that local tween to independently construct
 * MysteryEncounterPhase makes CPU/tween timing part of consensus and, in the observed browser failure, the
 * tween never completed after the authoritative state adoption. Only the authenticated ME_PRESENT capsule
 * may replace that predecessor with CoopReplayMePhase. DATA remains separate: this function runs from the
 * control projector after materialApplied, and the new phase must still open its real handler before
 * controlInstalled can be signed.
 */
function prepareCoopV2OrdinaryInteractionControlSurface(
  runtime: CoopRuntime,
  control: Extract<ProjectableControl, { kind: "SHARED_INTERACTION" }>,
  plan: CoopV2InteractionProjectionPlan,
): boolean {
  if (
    plan.kind !== "mystery"
    || runtime.controller.authorityRole === "authority"
    || runtime.controller.role !== "guest"
  ) {
    return false;
  }
  const controlId = controlIdOf(control);
  if (runtime.v2ProjectedInteractionControlId === controlId || runtime.v2RecoveryPreparedControlId === controlId) {
    return true;
  }
  const receiverScene = runtimeSceneBindings.get(runtime);
  if (receiverScene != null && receiverScene !== globalScene) {
    return false;
  }
  const phaseManager = globalScene.phaseManager;
  const current = phaseManager?.getCurrentPhase();
  if (current == null) {
    return false;
  }
  const currentOperationId =
    typeof (current as { coopV2ControlOperationId?: unknown }).coopV2ControlOperationId === "string"
      ? (current as unknown as { coopV2ControlOperationId: string }).coopV2ControlOperationId
      : null;
  if (current.is("CoopReplayMePhase") && currentOperationId === control.operationId) {
    runtime.v2ProjectedInteractionControlId = controlId;
    return true;
  }
  if (!current.is("NextEncounterPhase") && !current.is("MysteryEncounterPhase")) {
    return false;
  }
  const phase = materializeCoopV2InteractionProjection(runtime, control, plan);
  if (phase == null) {
    return false;
  }
  // The V2 entry is now the sole progression authority. Purge locally-derived siblings before ending the
  // obsolete predecessor; its async callback is identity-fenced and cannot mutate after the synchronous
  // shift. The exact replay phase then publishes readiness only after its real Mystery handler opens.
  phaseManager.clearPhaseQueue();
  phaseManager.pushPhase(phase);
  runtime.v2ProjectedInteractionControlId = controlId;
  current.end();
  coopLog("v2-interaction", `projected exact mystery generation for ${controlId} from ${current.phaseName}`);
  return true;
}

/**
 * Construct the exact engine generation recovery will subsequently prove.
 *
 * Recovery deliberately destroyed the obsolete phase tree under a held fence. Every executable shared
 * interaction is therefore reconstructed only from the retained immutable frontier entry through the same
 * closed projection-plan decoder ordinary control validation uses; no local RNG, queue inference, or stale
 * handler is permitted to choose the screen.
 */
function prepareCoopV2RecoveryControlSurface(runtime: CoopRuntime, control: NonNullable<CoopNextControl>): boolean {
  const controlId = controlIdOf(control as ProjectableControl);
  if (runtime.v2RecoveryPreparedControlId === controlId) {
    return true;
  }
  if (control.kind === "REPLACEMENT") {
    if (runtime.controller.localSeatId !== control.ownerSeatId) {
      runtime.v2RecoveryPreparedControlId = controlId;
      return true;
    }
    const battle = globalScene.currentBattle;
    if (
      battle == null
      || control.epoch !== runtime.controller.sessionEpoch
      || battle.waveIndex !== control.wave
      || battle.turn !== control.turn
    ) {
      return false;
    }
    globalScene.phaseManager.pushNew("CoopGuestFaintSwitchPhase", control.fieldIndex, {
      wave: control.wave,
      turn: control.turn,
      occurrence: control.occurrence,
    });
    runtime.v2RecoveryPreparedControlId = controlId;
    coopLog("v2-recovery", `queued exact replacement picker for ${controlId}`);
    return true;
  }
  if (control.kind === "SHARED_INTERACTION") {
    const sourceEntry = runtime.v2ControlLedger.sourceEntryOf(control);
    const plan = sourceEntry == null ? null : projectionPlanOfCoopV2InteractionEntry(sourceEntry);
    if (plan == null) {
      return false;
    }
    const phase = materializeCoopV2InteractionProjection(runtime, control, plan);
    if (phase == null) {
      return false;
    }
    globalScene.phaseManager.pushPhase(phase);
    runtime.v2RecoveryPreparedControlId = controlId;
    coopLog("v2-recovery", `queued exact ${plan.kind} generation for ${controlId}`);
    return true;
  }
  if (control.kind !== "COMMAND_FRONTIER") {
    runtime.v2RecoveryPreparedControlId = controlId;
    return true;
  }
  const battle = globalScene.currentBattle;
  if (
    battle == null
    || control.epoch !== runtime.controller.sessionEpoch
    || battle.waveIndex !== control.wave
    || battle.turn !== control.turn
  ) {
    return false;
  }
  const localCommands = commandTargetsOwnedBySeat(control, runtime.controller.localSeatId);
  const playerField = globalScene.getPlayerField();
  const localFieldIndices: number[] = [];
  for (const command of localCommands) {
    const localFieldIndex = playerField.findIndex(pokemon => pokemon?.id === command.pokemonId);
    if (localFieldIndex < 0) {
      return false;
    }
    localFieldIndices.push(localFieldIndex);
  }
  for (const fieldIndex of localFieldIndices) {
    globalScene.phaseManager.pushNew("CommandPhase", fieldIndex);
  }
  runtime.v2RecoveryPreparedControlId = controlId;
  coopLog("v2-recovery", `queued ${localFieldIndices.length} exact CommandPhase generation(s) for ${controlId}`);
  return true;
}

/**
 * Complete recovery integration over the same full snapshot transaction used by V1. Unlike ordinary entry
 * cutover, recovery projection may enqueue the authority-stated successor while the recovery phase is
 * deliberately current; that queued control cannot execute until the channel reopens the fence and invokes
 * onRecovered.
 */
function buildCoopV2LiveRecoverySeams(
  runtime: CoopRuntime,
  harness: () => CoopAuthorityV2Shadow,
  liveReplica: CoopV2LiveReplicaSeams,
): CoopV2LiveRecoverySeams {
  const fenceHeld = (): boolean => {
    const predicates = harness().recoveryFencePredicates();
    return predicates?.isProgressionFrozen() === true;
  };
  return {
    captureMaterial: ctx => captureCoopV2RecoveryMaterial(runtime, ctx),
    applyMaterial: (ctx, material) => {
      if (
        runtime.controller.authorityRole === "authority"
        || ctx.localSeatId === ctx.authoritySeatId
        || ctx.epoch !== runtime.controller.sessionEpoch
        || !fenceHeld()
        || !isCoopV2RecoveryMaterialPayload(material.payload)
        || material.digest !== coopV2RecoveryMaterialDigest(material.payload)
      ) {
        return false;
      }
      const snapshot = material.payload.snapshot;
      return queueCoopV2AtomicSnapshotApply(
        runtime,
        snapshot,
        () =>
          coopV2ShadowHarnesses.get(runtime) === harness()
          && runtime.controller.sessionEpoch === ctx.epoch
          && fenceHeld(),
        release => retainCoopV2RecoveryPhase(runtime, release),
      );
    },
    prepareControl: (ctx, bundle) => {
      if (
        coopV2ShadowHarnesses.get(runtime) !== harness()
        || runtime.controller.sessionEpoch !== ctx.epoch
        || !fenceHeld()
      ) {
        return false;
      }
      // replaceWithCoopRecoveryPhase destroyed every phase/handler generation. No command or interaction
      // side token from that old tree may satisfy the reconstructed frontier.
      runtime.v2InstalledCommandTargets.clear();
      runtime.v2DeferredCommandStarts.clear();
      runtime.v2DeferredInteractionStarts.clear();
      runtime.v2InstalledInteractionTargets.clear();
      runtime.v2RecoveryPreparedControlId = null;
      runtime.v2ProjectedReplacementControlId = null;
      runtime.v2ProjectedInteractionControlId = null;
      const finalEntry = bundle.requiredTail.at(-1) ?? null;
      const adopted =
        finalEntry == null
          ? bundle.frontier === 0
            ? bundle.nextControl == null && runtime.v2ControlLedger.adoptRecoveryFrontier(null)
            : false
          : finalEntry.revision === bundle.frontier
            && finalEntry.operationId === bundle.frontierOperationId
            && controlsEqual(finalEntry.nextControl, bundle.nextControl)
            && runtime.v2ControlLedger.adoptRecoveryFrontier(finalEntry);
      return (
        adopted && (bundle.nextControl == null || prepareCoopV2RecoveryControlSurface(runtime, bundle.nextControl))
      );
    },
    projectControl: (ctx, control) => {
      if (
        coopV2ShadowHarnesses.get(runtime) !== harness()
        || runtime.controller.sessionEpoch !== ctx.epoch
        || !fenceHeld()
      ) {
        return { kind: "rejected", reason: "Authority V2 recovery fence/runtime is no longer current" };
      }
      // Snapshot DATA is settled and the recovery fence has entered its narrow control-projection window.
      // Release only the parked recovery phase so the stated phase can actually start; command input,
      // unrelated progression, retained materialization, and new waits remain fenced until exact proof/ACK.
      if (control.kind !== "AWAIT_SUCCESSOR" && !releaseCoopV2RecoveryPhase(runtime)) {
        return { kind: "rejected", reason: "recovery phase did not shift to the stated control" };
      }
      const projected = liveReplica.projectControl(ctx, control);
      return (
        projected ?? {
          kind: "rejected",
          reason: `live Authority V2 projector does not own recovery control ${control.kind}`,
        }
      );
    },
    onRecovered: () => {
      runtime.v2RecoveryPreparedControlId = null;
      if (runtime.v2ControlLedger.activeControl?.kind !== "AWAIT_SUCCESSOR") {
        releaseCoopV2RecoveryPhase(runtime);
      }
    },
    onTerminal: reason => {
      runtime.v2RecoveryPreparedControlId = null;
      abandonCoopV2RecoveryPhase(runtime);
      const point = readCoopBattlePoint();
      failCoopRuntimeSharedSession(runtime, reason, {
        boundary: "recovery",
        reasonCode: "recovery-exhausted",
        wave: point.wave,
        turn: point.turn,
      });
    },
  };
}

/** Resolve the immutable v2 shadow identity from a runtime's session controller, or null if unavailable. */
function resolveCoopV2ShadowIdentity(runtime: CoopRuntime): CoopV2ShadowIdentity | null {
  const controller = runtime.controller;
  const binding = controller.authenticatedBinding;
  return resolveCoopV2SessionIdentity({
    hasAuthenticatedPairing: controller.hasAuthenticatedPairing,
    authenticatedBinding: binding,
    membership: binding == null ? null : controller.p33MembershipSnapshot(),
    localSeatId: controller.localSeatId,
    authoritySeatId: controller.authoritySeatId,
    runId: controller.runId,
    sessionEpoch: controller.sessionEpoch,
    connectionGeneration: runtime.localTransport.connectionGeneration?.() ?? 0,
  });
}

/**
 * The authority-v2 shadow harness for a runtime (default: the active runtime), or `null` when the
 * capability is not negotiated / the harness cannot be built. Builds lazily + memoizes. A pure-shadow
 * build failure remains telemetry-only; a negotiated live-cutover build failure terminalizes the shared
 * session before either peer can fall back to legacy correctness ownership. This is the ONLY entry point
 * the tap call sites use, so the capability-off path is a single null check with zero behavioural change.
 */
export function getCoopV2Shadow(runtime: CoopRuntime | null = active): CoopAuthorityV2Shadow | null {
  // Build the harness when EITHER the shadow OR the turn-cutover capability is negotiated - the cutover
  // reuses the SAME per-runtime log + frame channel. Off both => null, and every tap is a pure no-op.
  if (
    runtime == null
    || !(
      isCoopCapabilityNegotiated(COOP_CAP_AUTHORITY_V2_SHADOW)
      || isCoopV2TurnNegotiated()
      || isCoopV2ReplacementNegotiated()
      || isCoopV2WaveNegotiated()
      || isCoopV2InteractionNegotiated()
      || isCoopV2RecoveryNegotiated()
    )
  ) {
    return null;
  }
  const identity = resolveCoopV2ShadowIdentity(runtime);
  if (identity == null) {
    // An authenticated hot rejoin must re-prove its retained binding before V2 can mint any frame under the
    // replacement channel. Keep the existing log retained, but expose no newly resolved harness until the
    // binding-ready callback supplies the advanced membership/generation axes.
    return null;
  }
  const existing = coopV2ShadowHarnesses.get(runtime);
  if (existing != null) {
    try {
      existing.rebindIdentity(identity);
      activateCoopV2Runtime(runtime);
      return existing;
    } catch (error) {
      const point = readCoopBattlePoint();
      coopWarn("v2-recovery", "authenticated hot-rejoin binding could not rebind the retained V2 log", error);
      failCoopRuntimeSharedSession(
        runtime,
        "Authority V2 could not adopt the authenticated replacement channel without changing its session axes.",
        {
          boundary: "recovery",
          reasonCode: "binding-mismatch",
          wave: point.wave,
          turn: point.turn,
        },
      );
      return null;
    }
  }
  if (coopV2ShadowBuildFailed.has(runtime)) {
    return null;
  }
  const liveCutoverNegotiated =
    isCoopV2TurnNegotiated()
    || isCoopV2ReplacementNegotiated()
    || isCoopV2WaveNegotiated()
    || isCoopV2InteractionNegotiated()
    || isCoopV2RecoveryNegotiated();
  try {
    const localTransport = runtime.localTransport;
    // Cutover surface 1: inject the LIVE replica seams ONLY when authority.v2turn is negotiated. Absent, the
    // harness is pure shadow (byte-identical). Present, a delivered TURN_COMMIT applies against real engine
    // state + the real phase manager on the guest.
    const turnCutover = isCoopV2TurnNegotiated();
    const replacementCutover = isCoopV2ReplacementNegotiated();
    const waveCutover = isCoopV2WaveNegotiated();
    const interactionCutover = isCoopV2InteractionNegotiated();
    const controlCutover = turnCutover && replacementCutover && waveCutover && interactionCutover;
    const recoveryCutover = isCoopV2RecoveryNegotiated();
    let harness!: CoopAuthorityV2Shadow;
    const liveReplica =
      turnCutover || replacementCutover || waveCutover || interactionCutover || controlCutover
        ? buildCoopV2LiveSeams(runtime, {
            turn: turnCutover,
            replacement: replacementCutover,
            wave: waveCutover,
            interaction: interactionCutover,
            control: controlCutover,
          })
        : undefined;
    const liveRecovery =
      recoveryCutover && liveReplica != null
        ? buildCoopV2LiveRecoverySeams(runtime, () => harness, liveReplica)
        : undefined;
    harness = new CoopAuthorityV2Shadow({
      identity,
      scene: globalScene,
      transport: localTransport,
      send: frame => {
        // Wire boundary: v2 frames ride the SAME transport as legacy CoopMessages but are a distinct
        // envelope (v:2). The receive path intercepts v===2 BEFORE the legacy fan-out (coop-transport /
        // coop-webrtc-transport), so a v2 frame never reaches a legacy CoopMessage handler - this is the
        // send-side mirror of that receive-side wire boundary. `CoopFrameV2` is now an additive arm of the
        // `CoopMessage` union (contract change request 3), so this crosses the seam type-exact, no cast.
        localTransport.send(frame);
      },
      ...(liveReplica == null ? {} : { liveReplica }),
      ...(liveRecovery == null ? {} : { liveRecovery }),
      ...(turnCutover || replacementCutover || waveCutover || interactionCutover
        ? {
            onProtocolViolation: (violation: { frameType: string | null; issues: readonly string[] }) => {
              const point = readCoopBattlePoint();
              failCoopRuntimeSharedSession(
                runtime,
                `Invalid Authority V2 frame ${violation.frameType ?? "(unknown)"}: ${violation.issues.join(", ")}.`,
                {
                  boundary: "protocol",
                  reasonCode: "invalid-authority",
                  wave: point.wave,
                  turn: point.turn,
                },
              );
            },
          }
        : {}),
    });
    registerCoopV2ShadowInbound(frame => harness.handleInboundFrame(frame));
    setActiveCoopV2Shadow(harness);
    coopV2ShadowHarnesses.set(runtime, harness);
    // Cutover surface 1: when authority.v2turn is negotiated, install the live turn cutover so the legacy
    // turn seams (coop-battle-stream RE-SEND/requestTurnCommit, command-phase next-command barrier) suppress
    // themselves - the frozen "no second authority for a cut-over surface" rule.
    if (turnCutover) {
      const cutover = new CoopV2TurnCutover(harness);
      coopV2TurnCutovers.set(runtime, cutover);
      setActiveCoopV2TurnCutover(cutover);
      coopLog("v2-turn", `turn CUTOVER active role=${runtime.controller.authorityRole} session=${identity.sessionId}`);
    }
    if (replacementCutover) {
      const cutover = new CoopV2ReplacementCutover(harness);
      coopV2ReplacementCutovers.set(runtime, cutover);
      setActiveCoopV2ReplacementCutover(cutover);
      coopLog(
        "v2-replacement",
        `replacement CUTOVER active role=${runtime.controller.authorityRole} session=${identity.sessionId}`,
      );
    }
    if (waveCutover) {
      const cutover = new CoopV2WaveCutover(harness);
      coopV2WaveCutovers.set(runtime, cutover);
      setActiveCoopV2WaveCutover(cutover);
      coopLog(
        "v2-wave",
        `wave/terminal CUTOVER active role=${runtime.controller.authorityRole} session=${identity.sessionId}`,
      );
    }
    if (interactionCutover) {
      if (runtime.durability == null) {
        throw new Error("Authority V2 interaction cutover negotiated without a complete-result durability binding");
      }
      const missingRegistrations = COOP_V2_INTERACTION_SURFACES.map(coopOperationRegistrationStatus).filter(
        status => !status.applierRegistered || !status.liveSinkRegistered,
      );
      if (missingRegistrations.length > 0) {
        throw new Error(
          "Authority V2 interaction cutover registry incomplete: "
            + missingRegistrations
              .map(
                status =>
                  `${status.surfaceClass}(applier=${status.applierRegistered},sink=${status.liveSinkRegistered})`,
              )
              .join(","),
        );
      }
      const cutover = new CoopV2InteractionCutover(harness);
      coopV2InteractionCutovers.set(runtime, cutover);
      bindCoopV2InteractionCutover(runtime.durability, cutover);
      setActiveCoopV2InteractionCutover(cutover);
      coopLog(
        "v2-interaction",
        `shared-interaction CUTOVER active role=${runtime.controller.authorityRole} session=${identity.sessionId}`,
      );
    }
    if (controlCutover) {
      const cutover = new CoopV2ControlCutover(harness);
      coopV2ControlCutovers.set(runtime, cutover);
      coopLog(
        "v2-control",
        `explicit control-open CUTOVER active role=${runtime.controller.authorityRole} session=${identity.sessionId}`,
      );
    }
    coopLog(
      "v2-shadow",
      `harness built role=${runtime.controller.authorityRole} seat=${identity.localSeatId} session=${identity.sessionId}`,
    );
    return harness;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    coopWarn("v2-shadow", `harness build FAILED: ${reason}`);
    coopV2ShadowBuildFailed.add(runtime);
    if (liveCutoverNegotiated) {
      const point = readCoopBattlePoint();
      failCoopRuntimeSharedSession(runtime, `Authority V2 live cutover could not be installed: ${reason}`, {
        boundary: "protocol",
        reasonCode: "invalid-authority",
        wave: point.wave,
        turn: point.turn,
      });
    }
    return null;
  }
}

/**
 * Host-phase continuation barrier backed only by authenticated Authority V2 receipt quorum.
 *
 * This deliberately does not consult the retired V1 durability journal: interaction cutover suppresses that
 * journal, so an operation-id waiter there can never prove peer materialization.
 */
export function waitForCoopV2PeerMaterialApplied(
  operationId: string,
  runtime: CoopRuntime | null = active,
): Promise<boolean> {
  if (
    runtime == null
    || runtime.controller.authorityRole !== "authority"
    || runtime.controller.localSeatId !== runtime.controller.authoritySeatId
  ) {
    return Promise.resolve(false);
  }
  return (
    coopV2ShadowHarnesses.get(runtime)?.waitForAuthorityPeerStage(operationId, "materialApplied")
    ?? Promise.resolve(false)
  );
}

/**
 * Retain a non-authority interaction proposal until its exact immutable V2
 * result enters the ordered log. The lease is not an authority entry and can
 * neither allocate a revision nor release progression.
 */
export function retainCoopV2InteractionProposal(
  input: CoopV2InteractionProposalLease,
  runtime: CoopRuntime | null = active,
): CoopV2ProposalLeaseArmResult {
  if (
    runtime == null
    || !isCoopV2InteractionCutoverActive(runtime.durability)
    || runtime.controller.localSeatId === runtime.controller.authoritySeatId
  ) {
    return "invalid";
  }
  return coopV2ShadowHarnesses.get(runtime)?.retainInteractionProposal(input) ?? "invalid";
}

/**
 * HOST post-summon boundary: commit every staged faint at this complete carrier as Authority V2. `null`
 * means this runtime is not cut over; `no-pending` lets unrelated/legacy replacement checkpoints keep their
 * exact old path. A clean pre-commit failure can fall back to legacy; a partial result must terminalize,
 * because starting a second authority after one V2 entry committed would violate the frozen contract.
 */
export function commitCoopV2ReplacementAuthority(
  authorityCarrier: ReplacementAuthorityCarrier,
): CoopV2ReplacementBatchResult | null {
  const runtime = active;
  if (runtime == null || runtime.controller.authorityRole !== "authority") {
    return null;
  }
  const cutover = coopV2ReplacementCutovers.get(runtime);
  if (cutover == null) {
    return null;
  }
  const state = authorityCarrier.authoritativeState as CoopAuthoritativeBattleStateV1 | undefined;
  if (state == null || typeof state !== "object" || !Array.isArray(state.field)) {
    return { kind: "failed-clean" };
  }
  const hasImmediateCommand = hasCoopV2ImmediateCommandSuccessor(state);
  const commandFrontier = hasImmediateCommand ? resolveCoopV2CommandFrontier(state) : { commands: [], unresolved: [] };
  if (hasImmediateCommand && (commandFrontier.commands.length === 0 || commandFrontier.unresolved.length > 0)) {
    const unresolved = commandFrontier.unresolved
      .map(issue => `${issue.seat.side}:bi${issue.seat.bi}:pokemon${issue.seat.pokemonId}:${issue.reason}`)
      .join(",");
    coopWarn(
      "v2-replacement",
      `host refused incomplete replacement COMMAND frontier [${unresolved || "no-human-command-seat"}]`,
    );
    return { kind: "failed-clean" };
  }
  return cutover.commitStagedHostReplacements({ authorityCarrier, commands: commandFrontier.commands });
}

export type CoopV2CommandBoundaryVerdict = "ready" | "deferred" | "failed";
export type CoopV2InteractionBoundaryVerdict = "ready" | "deferred" | "failed";

/**
 * Gate an early replica faint picker behind the settled TURN_COMMIT that owns its exact replacement
 * address. Live-event replay may discover the faint before that commit arrives; it must not expose an
 * unlogged choice or keep the replay tree ahead of CoopFinalizeTurnPhase. The caller retires that early
 * phase when this returns `deferred`; `resume` reconstructs the same addressed picker after material apply.
 */
export function enterCoopV2ReplacementControlBoundary(input: {
  readonly operationId: string;
  readonly ownerSeatId: number;
  readonly wave: number;
  readonly turn: number;
  readonly occurrence: number;
  readonly fieldIndex: number;
  readonly phaseToken: object;
  readonly resume: () => void;
}): CoopV2InteractionBoundaryVerdict {
  const runtime = active;
  if (runtime == null || !coopV2ReplacementCutovers.has(runtime)) {
    return "ready";
  }
  const control: Extract<CoopNextControl, { kind: "REPLACEMENT" }> = {
    kind: "REPLACEMENT",
    operationId: input.operationId,
    ownerSeatId: input.ownerSeatId,
    epoch: runtime.controller.sessionEpoch,
    wave: input.wave,
    turn: input.turn,
    occurrence: input.occurrence,
    fieldIndex: input.fieldIndex,
  };
  const check = validateNextControl(control);
  if (!check.ok) {
    coopWarn("v2-control", `replacement refused malformed control: ${check.reason}`);
    return "failed";
  }
  if (runtime.controller.localSeatId !== input.ownerSeatId) {
    return "ready";
  }
  const current = runtime.v2ControlLedger.latestControl;
  if (current != null && controlsEqual(current, control) && runtime.v2ControlLedger.isMaterialApplied(current)) {
    return "ready";
  }
  if (runtime.controller.authorityRole === "authority" || current?.kind === "TERMINAL") {
    return "failed";
  }
  const controlId = controlIdOf(control);
  const existing = runtime.v2DeferredInteractionStarts.get(controlId);
  if (existing != null && existing.phaseToken !== input.phaseToken) {
    return "failed";
  }
  runtime.v2DeferredInteractionStarts.set(controlId, {
    phaseToken: input.phaseToken,
    resume: input.resume,
  });
  coopLog("v2-control", `retired early replacement picker until ordered control ${controlId}`);
  return "deferred";
}

/**
 * Park a deterministic Crossroads phase before it exposes input until the one global log explicitly opens
 * its exact result address. The authority authors a complete state + recovery capsule CONTROL_COMMIT; a
 * replica waits for that entry and resumes this same phase generation only after its material applies.
 */
export function enterCoopV2CrossroadsControlBoundary(input: {
  readonly operationId: string;
  readonly ownerSeatId: number;
  readonly sourceWave: number;
  readonly sourceTurn: number;
  readonly phaseToken: object;
  readonly resume: () => void;
}): CoopV2InteractionBoundaryVerdict {
  const runtime = active;
  const battle = globalScene.currentBattle;
  if (
    runtime == null
    || battle == null
    || !coopV2ControlCutovers.has(runtime)
    || !coopV2InteractionCutovers.has(runtime)
  ) {
    return "ready";
  }
  if (
    input.operationId.length === 0
    || !Number.isSafeInteger(input.ownerSeatId)
    || input.ownerSeatId < 0
    || !Number.isSafeInteger(input.sourceWave)
    || input.sourceWave <= 0
    || !Number.isSafeInteger(input.sourceTurn)
    || input.sourceTurn < 0
    || battle.waveIndex !== input.sourceWave
  ) {
    return "failed";
  }
  // Crossroads is enqueued by Victory at the exact post-BattleEnd settlement turn and starts only after
  // the terminal reward result has installed its wait at that same address. Its constructor-captured
  // coordinate is also used by the eventual result envelope, so open, result, recovery, and replay remain
  // one ordered w/t boundary instead of consulting a later speculative battle.
  const state = captureCoopAuthoritativeBattleState(input.sourceTurn);
  if (state == null || state.wave !== input.sourceWave || state.turn !== input.sourceTurn) {
    return "failed";
  }
  const control: Extract<CoopNextControl, { kind: "SHARED_INTERACTION" }> = {
    kind: "SHARED_INTERACTION",
    surfaceClass: "op:biome",
    operationId: input.operationId,
    ownerSeatId: input.ownerSeatId,
    epoch: runtime.controller.sessionEpoch,
    wave: state.wave,
    turn: state.turn,
    operationKind: "CROSSROADS_PICK",
    successor: {
      operationKinds: ["CROSSROADS_PICK"],
      operationIds: [input.operationId],
    },
  };
  const controlCheck = validateNextControl(control);
  if (!controlCheck.ok) {
    coopWarn("v2-control", `Crossroads refused malformed control: ${controlCheck.reason}`);
    return "failed";
  }
  const current = runtime.v2ControlLedger.latestControl;
  if (current != null && controlsEqual(current, control) && runtime.v2ControlLedger.isMaterialApplied(current)) {
    return "ready";
  }
  if (runtime.controller.authorityRole === "authority") {
    const cutover = coopV2ControlCutovers.get(runtime);
    const frontier = cutover?.authorityFrontier()?.nextControl ?? null;
    if (frontier != null && controlsEqual(frontier, control)) {
      return "ready";
    }
    if (cutover == null || frontier?.kind !== "AWAIT_SUCCESSOR" || !frontier.allowedKinds.includes("CONTROL_COMMIT")) {
      coopWarn(
        "v2-control",
        `Crossroads predecessor is ${frontier?.kind ?? "none"}, expected CONTROL_COMMIT-authorizing wait`,
      );
      return "failed";
    }
    const material: CoopInteractionOpenMaterialV2 = {
      kind: "interaction-open",
      wave: state.wave,
      turn: state.turn,
      authoritativeState: state,
      control,
      projection: {
        kind: "crossroads",
        sourceWave: input.sourceWave,
      },
    };
    const operationId = `V2/CONTROL/INTERACTION/${input.operationId}`;
    return cutover.commitHostInteractionOpen({ operationId, material }) == null ? "failed" : "ready";
  }

  if (current?.kind === "TERMINAL") {
    return "failed";
  }
  const controlId = controlIdOf(control);
  const existing = runtime.v2DeferredInteractionStarts.get(controlId);
  if (existing != null && existing.phaseToken !== input.phaseToken) {
    return "failed";
  }
  runtime.v2DeferredInteractionStarts.set(controlId, {
    phaseToken: input.phaseToken,
    resume: input.resume,
  });
  coopLog("v2-control", `parked Crossroads until ordered interaction-open ${controlId}`);
  return "deferred";
}

function commandStartKey(wave: number, turn: number, fieldIndex: number, pokemonId: number): string {
  return `${wave}:${turn}:${fieldIndex}:${pokemonId}`;
}

/**
 * Establish the ordered command frontier at the first real CommandPhase that survives every pre-command
 * engine effect (entry abilities, ambushes, forced replacement, and generated skips).
 *
 * Keeping creation before this phase accepts input is essential: if CONTROL_COMMIT were first authored by
 * actor 2's CommandPhase after actor 1 already
 * accepted input, the immutable frontier would require a proof from a phase generation that no longer
 * exists. The authority would then retain an un-installable control forever and correctly refuse every
 * later mechanical entry.
 *
 * Replacement/turn/wave entries may already state this exact frontier; in that case no new revision is
 * minted. Replicas do not author controls and wait for ordered delivery at their CommandPhase gate.
 */
export function establishCoopV2CommandControlFrontier(): CoopV2CommandBoundaryVerdict {
  const runtime = active;
  const battle = globalScene.currentBattle;
  if (runtime == null || battle == null || !coopV2ControlCutovers.has(runtime)) {
    return "ready";
  }
  if (runtime.controller.authorityRole !== "authority") {
    return "ready";
  }
  const state = captureCoopAuthoritativeBattleState(battle.turn);
  if (state == null || state.wave !== battle.waveIndex || state.turn !== battle.turn) {
    return "failed";
  }
  const frontier = resolveCoopV2CommandFrontier(state);
  if (frontier.commands.length === 0 || frontier.unresolved.length > 0) {
    const unresolved = frontier.unresolved
      .map(issue => `${issue.seat.side}:bi${issue.seat.bi}:pokemon${issue.seat.pokemonId}:${issue.reason}`)
      .join(",");
    coopWarn(
      "v2-control",
      `command-open refused incomplete frontier wave=${state.wave} turn=${state.turn} `
        + `commands=${frontier.commands.length} unresolved=[${unresolved}]`,
    );
    return "failed";
  }
  const command: Extract<CoopNextControl, { kind: "COMMAND_FRONTIER" }> = {
    kind: "COMMAND_FRONTIER",
    epoch: runtime.controller.sessionEpoch,
    wave: state.wave,
    turn: state.turn,
    commands: frontier.commands,
  };
  const cutover = coopV2ControlCutovers.get(runtime);
  if (cutover == null) {
    return "ready";
  }
  const current = cutover.authorityFrontier()?.nextControl ?? null;
  if (current != null && controlsEqual(current, command)) {
    return "ready";
  }
  if (current != null && current.kind !== "AWAIT_SUCCESSOR") {
    coopWarn(
      "v2-control",
      `command-open predecessor is ${current.kind}, expected AWAIT_SUCCESSOR at wave=${state.wave} turn=${state.turn}`,
    );
    return "failed";
  }
  if (current?.kind === "AWAIT_SUCCESSOR" && !current.allowedKinds.includes("CONTROL_COMMIT")) {
    coopWarn(
      "v2-control",
      `command-open predecessor does not authorize CONTROL_COMMIT after ${current.afterOperationId}`,
    );
    return "failed";
  }
  const material: CoopCommandOpenMaterialV2 = {
    kind: "command-open",
    wave: state.wave,
    turn: state.turn,
    authoritativeState: state,
  };
  const operationId = `V2/CONTROL/COMMAND/e${runtime.controller.sessionEpoch}/w${state.wave}/t${state.turn}/tick${state.tick}`;
  return cutover.commitHostCommandOpen({ operationId, material, command }) == null ? "failed" : "ready";
}

interface CoopV2ReplicaCommandClaim {
  readonly authorityTarget: CoopCommandControlTarget | null;
  readonly addressedByCurrent: boolean;
}

function resolveShowdownReplicaCommandClaim(
  runtime: CoopRuntime,
  current: ProjectableControl | null,
  wave: number,
  turn: number,
  fieldIndex: number,
  pokemonId: number,
  enemyOffset: number,
): CoopV2ReplicaCommandClaim | null {
  const seats = resolveShowdownSeatAuthority(runtime);
  if (seats == null) {
    return null;
  }
  const authorityTarget = resolveCoopV2ShowdownCommandProof({
    localRole: runtime.controller.role,
    localSide: "player",
    fieldIndex,
    pokemonId,
    enemyOffset,
    ...seats,
  });
  if (authorityTarget == null) {
    return null;
  }
  // A Showdown guest owns a reflected local player field. The immutable entry remains in host-canonical
  // coordinates, so comparing the guest's locally recaptured aggregate frontier against it deadlocks:
  // local f0 is canonical f<enemyOffset>. Authenticate the complete entry in the replica/log, then let
  // this real phase prove only the exact canonical target to which it maps. This is the same seat-scoped
  // partition rule used by the projector and scales to more than two participants.
  const addressedByCurrent =
    current?.kind === "COMMAND_FRONTIER"
    && current.epoch === runtime.controller.sessionEpoch
    && current.wave === wave
    && current.turn === turn
    && current.commands.some(
      command =>
        command.ownerSeatId === authorityTarget.ownerSeatId
        && command.fieldIndex === authorityTarget.fieldIndex
        && command.pokemonId === authorityTarget.pokemonId,
    );
  return { authorityTarget, addressedByCurrent };
}

function resolveClassicReplicaCommandClaim(
  runtime: CoopRuntime,
  current: ProjectableControl | null,
  state: NonNullable<ReturnType<typeof captureCoopAuthoritativeBattleState>>,
): CoopV2ReplicaCommandClaim | null {
  const frontier = resolveCoopV2CommandFrontier(state);
  if (frontier.commands.length === 0 || frontier.unresolved.length > 0) {
    coopWarn(
      "v2-control",
      `command-open refused incomplete frontier wave=${state.wave} turn=${state.turn} `
        + `commands=${frontier.commands.length} unresolved=${frontier.unresolved.length}`,
    );
    return null;
  }
  const command: Extract<CoopNextControl, { kind: "COMMAND_FRONTIER" }> = {
    kind: "COMMAND_FRONTIER",
    epoch: runtime.controller.sessionEpoch,
    wave: state.wave,
    turn: state.turn,
    commands: frontier.commands,
  };
  return {
    authorityTarget: null,
    addressedByCurrent: current != null && controlsEqual(current, command),
  };
}

/**
 * Gate a real CommandPhase behind the one ordered control graph.
 *
 * The authority commits CONTROL_COMMIT before this real phase can accept input, then records proof only
 * after the CommandPhase reaches its public-input chokepoint.
 * A replica that reaches its locally queued CommandPhase first parks it until
 * that exact entry's material is applied; it never opens input from queue order.
 */
export function enterCoopV2CommandControlBoundary(
  fieldIndex: number,
  pokemonId: number,
  resume: () => void,
): CoopV2CommandBoundaryVerdict {
  const runtime = active;
  const battle = globalScene.currentBattle;
  if (runtime == null || battle == null || !coopV2ControlCutovers.has(runtime)) {
    return "ready";
  }
  if (!Number.isSafeInteger(fieldIndex) || fieldIndex < 0 || !Number.isSafeInteger(pokemonId) || pokemonId <= 0) {
    return "failed";
  }
  const state = captureCoopAuthoritativeBattleState(battle.turn);
  if (state == null || state.wave !== battle.waveIndex || state.turn !== battle.turn) {
    return "failed";
  }
  const cutover = coopV2ControlCutovers.get(runtime);
  if (cutover == null) {
    return "ready";
  }

  if (runtime.controller.authorityRole === "authority") {
    const authorityControl = cutover.authorityFrontier()?.nextControl ?? null;
    if (
      authorityControl?.kind === "SHARED_INTERACTION"
      && authorityControl.epoch === runtime.controller.sessionEpoch
      && authorityControl.wave === state.wave
      && authorityControl.turn === state.turn
    ) {
      const key = commandStartKey(state.wave, state.turn, fieldIndex, pokemonId);
      runtime.v2DeferredCommandStarts.set(key, {
        epoch: runtime.controller.sessionEpoch,
        wave: state.wave,
        turn: state.turn,
        fieldIndex,
        pokemonId,
        resume,
      });
      coopLog(
        "v2-control",
        `parked authority CommandPhase behind ordered shared interaction ${authorityControl.operationId} key=${key}`,
      );
      return "deferred";
    }
    return establishCoopV2CommandControlFrontier();
  }

  const current = runtime.v2ControlLedger.latestControl;
  const claim = runtime.controller.isVersusSession()
    ? resolveShowdownReplicaCommandClaim(
        runtime,
        current,
        state.wave,
        state.turn,
        fieldIndex,
        pokemonId,
        battle.arrangement.enemyOffset,
      )
    : resolveClassicReplicaCommandClaim(runtime, current, state);
  if (claim == null) {
    return "failed";
  }
  if (claim.addressedByCurrent && current != null && runtime.v2ControlLedger.isMaterialApplied(current)) {
    return "ready";
  }
  if (current?.kind === "TERMINAL") {
    return "failed";
  }
  const key = commandStartKey(state.wave, state.turn, fieldIndex, pokemonId);
  runtime.v2DeferredCommandStarts.set(key, {
    epoch: runtime.controller.sessionEpoch,
    wave: state.wave,
    turn: state.turn,
    fieldIndex,
    pokemonId,
    ...(claim.authorityTarget == null ? {} : { authorityTarget: claim.authorityTarget }),
    resume,
  });
  coopLog("v2-control", `parked local CommandPhase until ordered command-open ${key}`);
  // The immutable entry can already be admitted but material-deferred because this replica was still in
  // EncounterPhase when it arrived. Retry from the real command boundary immediately; waiting for a
  // transport resend would make local CPU speed part of correctness and needlessly add several seconds.
  scheduleCoopV2CommandProofRetry(runtime);
  return "deferred";
}

/** Release only CommandPhase starts addressed by the applied immutable command frontier. */
function releaseCoopV2DeferredCommandStarts(
  runtime: CoopRuntime,
  control: Extract<CoopNextControl, { kind: "COMMAND_FRONTIER" }>,
): void {
  for (const [key, pending] of [...runtime.v2DeferredCommandStarts]) {
    const expected = pending.authorityTarget;
    const addressed = control.commands.some(
      command =>
        command.fieldIndex === (expected?.fieldIndex ?? pending.fieldIndex)
        && command.pokemonId === (expected?.pokemonId ?? pending.pokemonId)
        && (expected == null || command.ownerSeatId === expected.ownerSeatId)
        && control.epoch === pending.epoch
        && control.wave === pending.wave
        && control.turn === pending.turn,
    );
    if (!addressed) {
      continue;
    }
    runtime.v2DeferredCommandStarts.delete(key);
    try {
      pending.resume();
    } catch (error) {
      coopWarn("v2-control", `deferred CommandPhase resume threw key=${key}`, error);
    }
  }
}

/** Resume one real authority CommandPhase only after its same-address ordered successor wait is installed. */
function resumeOneCoopV2DeferredAuthorityCommandStart(
  runtime: CoopRuntime,
  wait: Extract<CoopNextControl, { kind: "AWAIT_SUCCESSOR" }>,
): void {
  if (runtime.controller.authorityRole !== "authority" || wait.epoch !== runtime.controller.sessionEpoch) {
    return;
  }
  const candidate = [...runtime.v2DeferredCommandStarts].find(
    ([, pending]) => pending.epoch === wait.epoch && pending.wave === wait.wave && pending.turn === wait.turn,
  );
  if (candidate == null) {
    return;
  }
  const [key, pending] = candidate;
  runtime.v2DeferredCommandStarts.delete(key);
  runWhenCoopRuntimeActive(runtime, () => {
    try {
      pending.resume();
    } catch (error) {
      coopWarn("v2-control", `authority deferred CommandPhase resume threw key=${key}`, error);
    }
  });
}

/** Release only the exact phase generation addressed by an applied shared-interaction control-open. */
function releaseCoopV2DeferredInteractionStarts(
  runtime: CoopRuntime,
  control: Extract<CoopNextControl, { kind: "SHARED_INTERACTION" | "REPLACEMENT" }>,
): boolean {
  const controlId = controlIdOf(control);
  const pending = runtime.v2DeferredInteractionStarts.get(controlId);
  if (pending == null) {
    return false;
  }
  runtime.v2DeferredInteractionStarts.delete(controlId);
  try {
    pending.resume();
    return true;
  } catch (error) {
    coopWarn("v2-control", `deferred shared-interaction resume threw control=${controlId}`, error);
    return false;
  }
}

/** Dispose + drop the shadow harness for a runtime (teardown). Idempotent. */
function disposeCoopV2Shadow(runtime: CoopRuntime): void {
  runtime.v2DeferredCommandStarts.clear();
  runtime.v2DeferredInteractionStarts.clear();
  const controlCutover = coopV2ControlCutovers.get(runtime);
  if (controlCutover != null) {
    controlCutover.dispose();
    coopV2ControlCutovers.delete(runtime);
  }
  const interactionCutover = coopV2InteractionCutovers.get(runtime);
  if (interactionCutover != null) {
    clearActiveCoopV2InteractionCutover(interactionCutover);
    if (runtime.durability != null) {
      unbindCoopV2InteractionCutover(runtime.durability, interactionCutover);
    }
    interactionCutover.dispose();
    coopV2InteractionCutovers.delete(runtime);
  }
  const waveCutover = coopV2WaveCutovers.get(runtime);
  if (waveCutover != null) {
    clearActiveCoopV2WaveCutover(waveCutover);
    waveCutover.dispose();
    coopV2WaveCutovers.delete(runtime);
  }
  const replacementCutover = coopV2ReplacementCutovers.get(runtime);
  if (replacementCutover != null) {
    clearActiveCoopV2ReplacementCutover(replacementCutover);
    replacementCutover.dispose();
    coopV2ReplacementCutovers.delete(runtime);
  }
  const cutover = coopV2TurnCutovers.get(runtime);
  if (cutover != null) {
    clearActiveCoopV2TurnCutover(cutover);
    cutover.dispose();
    coopV2TurnCutovers.delete(runtime);
  }
  const harness = coopV2ShadowHarnesses.get(runtime);
  if (harness != null) {
    clearActiveCoopV2Shadow(harness);
    harness.dispose("coop-runtime-teardown");
    coopV2ShadowHarnesses.delete(runtime);
  }
  coopV2ShadowBuildFailed.delete(runtime);
  runtime.v2WaveTransactions.clear();
}

export function runWhenCoopRuntimeActive(runtime: CoopRuntime, callback: () => void): () => void {
  let live = true;
  let queued: Set<() => void> | null = null;
  const invoke = (): void => {
    if (!live) {
      return;
    }
    live = false;
    queued?.delete(invoke);
    callback();
  };
  if (active === runtime) {
    invoke();
    return () => {};
  }
  queued = pendingRuntimeActivations.get(runtime) ?? new Set<() => void>();
  queued.add(invoke);
  pendingRuntimeActivations.set(runtime, queued);
  return () => {
    live = false;
    queued?.delete(invoke);
    if (queued?.size === 0) {
      pendingRuntimeActivations.delete(runtime);
    }
  };
}

function flushPendingRuntimeActivations(runtime: CoopRuntime): void {
  const callbacks = pendingRuntimeActivations.get(runtime);
  if (callbacks == null) {
    return;
  }
  pendingRuntimeActivations.delete(runtime);
  for (const callback of [...callbacks]) {
    try {
      callback();
    } catch (error) {
      coopWarn("runtime", "destination-runtime continuation threw after activation", error);
    }
  }
}

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
  activateCoopV2Runtime(runtime);
  runtimeSceneBindings.set(runtime, globalScene);
  globalScene?.phaseManager?.setCoopRecoveryProgressionFence?.(
    () => coopV2RecoveryFencePredicates(runtime)?.isProgressionFrozen() === true,
  );
  // Wave-2e: point the operation journal at THIS runtime's durability manager. Load-bearing in the duo
  // harness, where two runtimes coexist in-process and `withClient` swaps the active one per pumped client -
  // the migrated adapters' commit path must journal into the ACTIVE client's manager, not a stale global.
  setCoopOperationDurability(runtime.durability ?? null);
  // Layer-B: install THIS runtime's per-surface op-state as the active one, so the migrated surfaces read
  // the pumped client's own cursors/clock (never the other engine's) across a `withClient` swap.
  setActiveCoopRuntimeOpState(runtime.opState);
  // A receiver may have retained this exact global operation while the sender/no client was ambient. Apply
  // it now, under the destination scene + runtime, before any later client phase can publish a newer tick.
  if (!isCoopV2InteractionCutoverActive(runtime.durability)) {
    runtime.durability?.retryDeferred("op:global");
  }
  flushPendingRuntimeActivations(runtime);
  // Install the cycle-free authoritative-guest predicate (#633 B6) so `field/pokemon.ts` can gate the
  // Shedinja party-add without importing this module (which would close a value-level import cycle).
  setCoopAuthoritativeGuestPredicate(isCoopAuthoritativeGuest);
  // Install the cycle-free showdown-guest-flip predicate (C5) so the render layer (pokemon.ts /
  // battle-info panels) can consult the versus-guest perspective flip without importing this module.
  setShowdownGuestFlipPredicate(isShowdownGuestFlip);
  // Install the cycle-free host-canonical side -> authenticated seat resolver so authoritative capture
  // stamps Showdown's two human sides without battle-engine importing this runtime value graph.
  setShowdownSeatAuthorityResolver(resolveShowdownSeatAuthority);
  // A real browser receives under its own process-global scene. The two-engine harness can deliver while
  // the sender is active, so received terminal control is retained per runtime and routed only after this
  // destination runtime + scene are installed together.
  flushPendingShowdownResult(runtime);
}

/** The live co-op session, or null when not in a co-op run. */
export function getCoopRuntime(): CoopRuntime | null {
  return active;
}

/** Exact runtime-owned WAVE_ADVANCE state used by delayed phase, replay, save, and recovery callbacks. */
export function getCoopWaveAdvanceRuntimeBinding(
  runtime: CoopRuntime | null = active,
): CoopWaveAdvanceOperationBinding | null {
  return runtime?.waveOperationBinding ?? null;
}

/**
 * Observe the boundary owned by the negotiated authority for this runtime.
 *
 * V2 is consulted first because its cutover suppresses V1 creation. The completed V2 cache is diagnostic
 * evidence only; live code cannot replay it. A legacy status is returned only when no V2 transaction for
 * this wave exists, preserving explicit fallback-capability coverage.
 */
export function getCoopWaveBoundaryStatus(
  wave: number,
  runtime: CoopRuntime | null = active,
): CoopWaveBoundaryStatus | null {
  if (runtime == null) {
    return null;
  }
  const v2 = runtime.v2WaveTransactions.get(wave) ?? runtime.v2CompletedWaveTransactions.get(wave);
  if (v2 != null) {
    return {
      authority: "v2",
      operationId: v2.operationId,
      transition: v2.transition,
      dataApplied: v2.dataApplied,
      continuationReady: v2.continuationReady,
      entryRevision: v2.entryRevision,
    };
  }
  const legacy = getCoopStagedWaveAdvanceTransaction(wave, runtime.waveOperationBinding);
  const transition = legacy?.envelope.pendingOperation?.payload;
  return legacy == null || !isValidCoopWaveAdvancePayload(transition)
    ? null
    : {
        authority: "legacy",
        operationId: legacy.operationId,
        transition,
        dataApplied: legacy.dataApplied,
        continuationReady: legacy.continuationReady,
      };
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
export type { CoopControlPlaneSaveData } from "#data/elite-redux/coop/coop-control-plane";

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
    const snapshot = {
      // Wave-2e: the UNION of the committer's journal high-water and the receiver's applied marks, so the
      // host (committer) and guest (receiver) serialize the SAME converged value - a plain highWaterMarks()
      // is populated only on the host, so the saveDataDigest would diverge the moment it commits an op.
      interactionCounter: runtime.controller.interactionCounter(),
      journalHighWater: authorityRelevantDurabilityMarks(runtime, runtime.durability?.controlPlaneHighWater() ?? {}),
    };
    return isCoopControlPlaneSaveData(snapshot) ? snapshot : undefined;
  } catch (error) {
    coopWarn("control-plane snapshot capture failed", error);
    return;
  }
}

/**
 * W2b: restore a persisted control-plane snapshot onto the live co-op runtime on a COLD resume (§4). Tolerant
 * only of runtime restore exceptions after admission has proved a complete, valid co-op field; solo loads never call it.
 * A HOT rejoin never calls this (the runtime + its live counter survive in place - Step 0 validated).
 */
export function applyCoopControlPlaneSaveData(data: unknown): boolean {
  if (!isCoopControlPlaneSaveData(data)) {
    return false;
  }
  const runtime = active;
  if (runtime == null) {
    return false;
  }
  try {
    runtime.controller.restoreInteractionCounter(data.interactionCounter);
    // Wave-2e: restore the converged marks into BOTH the committer high-water AND the receiver applied
    // ledger, so a resumed guest neither re-applies an already-applied op nor diverges from the host on the
    // post-resume digest (both peers restore the identical value, §4.6).
    const v2InteractionCutover = isCoopV2InteractionCutoverActive(runtime.durability);
    const marks = v2InteractionCutover
      ? authorityRelevantDurabilityMarks(runtime, data.journalHighWater)
      : data.journalHighWater;
    const legacyGlobalFloor = v2InteractionCutover
      ? 0
      : Object.entries(marks)
          .filter(([cls]) => cls.startsWith("op:") && cls !== "op:global")
          .reduce((sum, [, revision]) => sum + (Number.isSafeInteger(revision) && revision > 0 ? revision : 0), 0);
    const globalFloor = v2InteractionCutover ? 0 : (marks["op:global"] ?? legacyGlobalFloor);
    if (!v2InteractionCutover) {
      setCoopGlobalOperationRevisionFloor(runtime.controller.sessionEpoch, globalFloor);
    }
    const normalizedMarks = !v2InteractionCutover && globalFloor > 0 ? { ...marks, "op:global": globalFloor } : marks;
    runtime.durability?.restore(normalizedMarks, normalizedMarks);
    // W2e-R P0-3: the durability RECEIVER ledger is restored to N above, but each surface's producer host is
    // recreated at revision 0 - so without this it would emit revision 1 and the restored receiver would drop
    // it as a stale duplicate (isDuplicate: 1 <= N). Floor each surface's producer + guests to its persisted
    // per-class high-water so the committed-op revision stream continues MONOTONICALLY at N+1 across the resume
    // (the epoch is unchanged, so the restored receiver marks stay valid; §1.4/§4.6 monotonic-continue contract).
    if (!v2InteractionCutover) {
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
      // Wave-2f KEYSTONE (W2e-R P0-3): floor the wave-advance producer + guest so a resumed legacy run
      // continues the committed-op revision stream at N+1 and the restored receiver ledger accepts it.
      setCoopWaveAdvanceOperationRevisionFloor(marks["op:wave"] ?? 0, runtime.waveOperationBinding);
    }
    return true;
  } catch (error) {
    coopWarn("control-plane restore failed", error);
    return false;
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

/**
 * Canonical Showdown ownership: the authority controls the host/player side and the one other bound seat
 * controls the guest/enemy side. Authenticated bindings must contain exactly one peer; only the unbound
 * two-seat compatibility path may use the historic 0/1 fallback.
 */
function resolveShowdownSeatAuthority(runtime: CoopRuntime | null = active): CoopShowdownSeatAuthority | null {
  const controller = runtime?.controller;
  if (controller == null || !controller.isVersusSession()) {
    return null;
  }
  const hostSeatId = controller.authoritySeatId;
  if (!Number.isSafeInteger(hostSeatId) || hostSeatId < 0) {
    return null;
  }
  const binding = controller.authenticatedBinding;
  if (binding == null) {
    return { hostSeatId, guestSeatId: hostSeatId === 0 ? 1 : 0 };
  }
  const peerSeatIds = binding.seatMap.seats
    .map(seat => seat.seatId)
    .filter(seatId => Number.isSafeInteger(seatId) && seatId >= 0 && seatId !== hostSeatId);
  if (peerSeatIds.length !== 1) {
    return null;
  }
  return { hostSeatId, guestSeatId: peerSeatIds[0] };
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
 * #861 SESSION-BOUNDARY PURGE: drop every BUFFERED relay, rendezvous, and battle-stream arrival on the LIVE runtime without
 * tearing it down, so a prior session/epoch's stale buffered message can never satisfy a NEW epoch's await.
 * Call at every boundary where the SAME runtime is carried across a session/epoch change: a resume boot /
 * launch adopt onto a live runtime ({@linkcode GameData.applyCoopLaunchSession}) and a hot-rejoin
 * full-resync. A no-op outside a live session. `clearCoopRuntime` needs no call - its `dispose()` already
 * drops everything as the runtime is torn down.
 */
export function purgeCoopBufferedArrivals(reason: string): void {
  active?.interactionRelay.purgeBufferedArrivals(reason);
  active?.rendezvous.purgeBufferedArrivals(reason);
  active?.battleStream.purgeSessionBoundaryState(reason);
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
 *
 * Runtime assembly can precede BattleScene construction in protocol-only/headless boots. In that
 * pre-scene window use the session module's fixed launch map (the same fallback used for an empty
 * field) instead of throwing from an inbound security predicate and silently turning a valid frame
 * into a timeout. Once a field exists its persistent owner tags remain authoritative.
 */
export function coopOwnerOfPlayerFieldSlot(fieldIndex: number): CoopRole {
  const scene = globalScene as typeof globalScene | undefined;
  return coopOwnerOfFieldSlot(scene?.getPlayerField?.() ?? [], fieldIndex);
}

/**
 * Authority V2 COMMAND control proof. Called from the real player/enemy command phase only after its
 * checkpoint funnel and field-index repair, so the recorded identity is mechanically active rather than a
 * requested projection. Showdown's local guest world is reflected back to host-canonical battler indices
 * before signing. Exact owner/address/Pokemon fields make another seat, turn, or actor unable to satisfy
 * the receipt. Hard no-op outside an active negotiated turn cutover.
 */
export function recordCoopV2CommandControlStarted(
  fieldIndex: number,
  pokemonId: number,
  localSide: "player" | "enemy" = "player",
): void {
  const runtime = active;
  const battle = globalScene.currentBattle;
  if (
    runtime == null
    || battle == null
    || !coopV2TurnCutovers.has(runtime)
    || !Number.isSafeInteger(fieldIndex)
    || fieldIndex < 0
    || !Number.isSafeInteger(pokemonId)
    || pokemonId <= 0
  ) {
    return;
  }
  let target: { ownerSeatId: number; pokemonId: number; fieldIndex: number };
  if (runtime.controller.isVersusSession()) {
    const seats = resolveShowdownSeatAuthority();
    if (seats == null) {
      return;
    }
    const showdownTarget = resolveCoopV2ShowdownCommandProof({
      localRole: runtime.controller.role,
      localSide,
      fieldIndex,
      pokemonId,
      enemyOffset: battle.arrangement.enemyOffset,
      ...seats,
    });
    if (showdownTarget == null) {
      return;
    }
    target = showdownTarget;
  } else {
    if (localSide !== "player") {
      return;
    }
    const owner = coopOwnerOfPlayerFieldSlot(fieldIndex);
    const commandPokemon = globalScene.getPlayerField()[fieldIndex] as { coopOwnerSeatId?: number } | undefined;
    // Prefer the stable numeric seat identity. The role fallback preserves current two-seat saves while
    // er-coop-41 introduces the numeric field; N-seat sessions must populate coopOwnerSeatId explicitly.
    const ownerSeatId =
      Number.isSafeInteger(commandPokemon?.coopOwnerSeatId) && (commandPokemon?.coopOwnerSeatId as number) >= 0
        ? (commandPokemon?.coopOwnerSeatId as number)
        : owner === "host"
          ? 0
          : 1;
    target = { ownerSeatId, pokemonId, fieldIndex };
  }
  const control: Extract<NonNullable<CoopNextControl>, { kind: "COMMAND_FRONTIER" }> = {
    kind: "COMMAND_FRONTIER",
    epoch: runtime.controller.sessionEpoch,
    wave: battle.waveIndex,
    turn: battle.turn,
    commands: [target],
  };
  const validation = validateNextControl(control);
  if (!validation.ok) {
    return;
  }
  runtime.v2InstalledCommandTargets.add(commandControlTargetId(control.epoch, control.wave, control.turn, target));
  const stated = runtime.v2ControlLedger.latestControl;
  if (
    stated?.kind === "COMMAND_FRONTIER"
    && stated.epoch === control.epoch
    && stated.wave === control.wave
    && stated.turn === control.turn
  ) {
    const localCommands = commandTargetsOwnedBySeat(stated, runtime.controller.localSeatId);
    const missing = localCommands.filter(
      command =>
        !runtime.v2InstalledCommandTargets.has(commandControlTargetId(stated.epoch, stated.wave, stated.turn, command)),
    );
    const projected = runtime.v2ControlLedger.projectMechanical(stated, () =>
      missing.length === 0
        ? { kind: "installed", controlId: controlIdOf(stated) }
        : {
            kind: "deferred",
            reason: `awaiting ${missing.length}/${localCommands.length} local command proofs`,
          },
    );
    if (missing.length === 0 && (projected.kind === "installed" || projected.kind === "already-installed")) {
      scheduleCoopV2CommandProofRetry(runtime);
    }
  }
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
        ? {
            kind: "move",
            moveIndex: command.cursor,
            target: command.targets[0],
          }
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

/**
 * authority-v2 SHADOW tap for the waveResolved broadcast + the game-over/terminal path. Builds the v2
 * WAVE_ADVANCE (win/capture/flee) or TERMINAL_COMMIT (gameOver) INDEPENDENTLY, commits it to the shadow
 * log (a full replica round-trip over the v2 frame channel), and logs one PARITY line vs the legacy
 * transition digest. A pure no-op when authority.v2shadow is not negotiated (getCoopV2Shadow -> null). The
 * harness guards its own taps, so this never throws into the host's post-battle flow.
 */
function tapCoopV2ShadowWaveBoundary(
  runtime: CoopRuntime,
  wave: number,
  outcome: CoopWaveOutcome,
  transition: CoopWaveAdvancePayload,
): void {
  // Live wave cutover commits only after the complete settled state exists. An early shadow entry here
  // would consume a global revision without the authority carrier and become a second, unapplyable boundary.
  if (isCoopV2WaveCutoverActive()) {
    return;
  }
  const shadow = getCoopV2Shadow(runtime);
  if (shadow == null) {
    return;
  }
  const turn = globalScene.currentBattle?.turn ?? 1;
  const legacyDigest = fnv1a64(canonicalize(transition));
  const ownerSeatId = runtime.controller.authoritySeatId;
  if (outcome === "gameOver") {
    const terminal: CoopTerminalMaterialV2 = {
      kind: "terminal",
      terminalId: `coop-v2-shadow-terminal:w${wave}`,
      reason: "game-over",
      wave,
      turn: Math.max(0, turn),
    };
    // Deliverable 3: fingerprint the LEGACY terminal image (the waveEndState the legacy path sealed, mapped
    // to the v2 terminal material the same way the entry is) through the terminal adapter's OWN digest, so
    // wave/terminal parity compares like-for-like (v2 entry digest vs v2-digest-of-legacy-image) instead of
    // the raw canonicalize(transition) token that is a different scheme and always diverges. Shadow only.
    shadow.tapTerminal({ operationId: `WSHADOW/TERM/w${wave}`, terminal, legacyImage: terminal, legacyDigest });
    return;
  }
  const meBoundary: "none" | "battle-victory" = transition.meBoundary === "battle-victory" ? "battle-victory" : "none";
  const base = {
    kind: "wave-advance" as const,
    wave,
    turn: Math.max(0, turn),
    nextWave: transition.nextWave,
    biomeChange: transition.biomeChange,
    eggLapse: transition.eggLapse,
    meBoundary,
  };
  // victoryKind is present IFF the outcome is a victory (win/capture); a flee carries none.
  const material: CoopWaveTransitionMaterialV2 =
    outcome === "flee"
      ? { ...base, outcome: "flee" }
      : { ...base, outcome, victoryKind: transition.victoryKind ?? "wild" };
  const destination: CoopWaveAdvanceDestination = {
    kind: "REWARD",
    operationId: `WSHADOW/REWARD/w${wave}`,
    ownerSeatId,
  };
  // Deliverable 3: fingerprint the LEGACY waveResolved image (the transition the host broadcast) through the
  // wave adapter's OWN digest so wave parity becomes JUDGEABLE-true - v2 entry digest vs v2-digest-of-legacy-
  // image, like-for-like. The raw canonicalize(transition) token stays as the fallback legacyDigest for the
  // log. Shadow only - no wave cutover; the wave surface stays legacy-authoritative.
  shadow.tapWaveAdvance({
    operationId: `WSHADOW/ADV/w${wave}`,
    transition: material,
    destination,
    legacyImage: material,
    legacyDigest,
  });
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
  // authority-v2 SHADOW: independently compute + compare the wave/terminal progression. Runs AFTER the
  // legacy transition is staged; never affects it (pure no-op unless authority.v2shadow is negotiated).
  tapCoopV2ShadowWaveBoundary(active, wave, outcome, transition);
  // Normal win/capture/flee transitions settle later in BattleEnd. GameOver has no BattleEndPhase, so seal
  // its terminal DATA first; a throwing/dropped raw presentation carrier cannot suppress correctness.
  if (outcome === "gameOver") {
    commitCoopSettledWaveAdvance(wave, transition);
  }
  const captureParty = outcome === "capture" ? captureCoopCaptureParty() : undefined;
  if (outcome === "win" && isCoopRecording()) {
    deferredHostWaveResolved.set(wave, { outcome, captureParty, presentation, transition });
    coopLog(
      "runtime",
      `defer raw waveResolved wave=${wave} outcome=${outcome} until its material turnResolution is retained`,
    );
    return;
  }
  sendCoopWaveResolvedCompatibility(wave, outcome, captureParty, presentation, transition);
}

function sendCoopWaveResolvedCompatibility(
  wave: number,
  outcome: CoopWaveOutcome,
  captureParty: string[] | undefined,
  presentation: CoopCapturePresentation | undefined,
  transition: CoopWaveAdvancePayload,
): void {
  if (active == null || active.controller.role !== "host") {
    return;
  }
  try {
    // Co-op (#633 B1/B2/B3): a CAPTURE grows/edits the host's party (the caught mon, and a party-full
    // release) that the guest's pure-renderer tail never reproduces. Carry the full post-catch party
    // so the guest can reconcile its bench + credit the catch. Other outcomes carry nothing (no-op).
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
 * Publish a staged normal-victory compatibility hint only after the exact final material turn has entered
 * immutable retention. If turn sealing fails, this is never called: both peers remain at the failing turn
 * address and the retained authorityFailure can terminate them symmetrically.
 */
export function flushCoopWaveResolvedAfterTurnCommit(wave: number): boolean {
  const deferred = deferredHostWaveResolved.get(wave);
  if (deferred == null) {
    return true;
  }
  const staged = pendingHostWaveTransitions.get(wave);
  if (
    active == null
    || active.controller.role !== "host"
    || staged == null
    || staged !== deferred.transition
    || staged.outcome !== deferred.outcome
  ) {
    failCoopSharedSession(`The deferred waveResolved compatibility hint for wave ${wave} lost its turn boundary.`);
    return false;
  }
  deferredHostWaveResolved.delete(wave);
  sendCoopWaveResolvedCompatibility(
    wave,
    deferred.outcome,
    deferred.captureParty,
    deferred.presentation,
    deferred.transition,
  );
  return true;
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
    const binding = runtime.waveOperationBinding;
    const staged = getCoopStagedWaveAdvanceTransaction(payload.wave, binding);
    if (staged == null || staged.operationId !== operation.id) {
      return false;
    }
    // CoopFinalizeTurnPhase may have registered a next-command continuation before this retained
    // terminal reached the guest. Admission of the exact staged WAVE_ADVANCE is the missing causal
    // proof that upgrades that prediction to the old-shell/next-wave shared boundary.
    runtime.battleStream.noteWaveAdvanceAdmitted(envelope.sessionEpoch, payload.wave);
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
        envelope.turn,
      );
      if (merged == null || !markCoopWaveAdvanceBootstrapProjected(payload.wave, binding)) {
        return false;
      }
      pendingWaveAdvance = merged;
      pendingRawWavePresentations.delete(payload.wave);
      coopLog(
        "runtime",
        `wave-advance JOURNAL bootstrap wave=${payload.wave} outcome=${payload.outcome} (ACK withheld)`,
      );
    }
    const getCurrentPhase = globalScene.phaseManager?.getCurrentPhase;
    const currentPhase =
      typeof getCurrentPhase === "function" ? getCurrentPhase.call(globalScene.phaseManager) : undefined;
    if (currentPhase?.phaseName === "BattleEndPhase" && !tryApplyCoopSettledWaveData(payload.wave, binding)) {
      return false;
    }
    const continuationReady = maybeMarkCoopWaveContinuationReady(payload.wave, binding, runtime);
    if (!continuationReady && coopHasPendingWaveAdvance() && coopWaveAdvanceBoundaryWakeFactory != null) {
      // The retained op may land AFTER CoopFinalizeTurnPhase already inspected pendingWaveAdvance. Appending
      // (never unshifting) a tail-only finalizer wake preserves presentation -> checkpoint ordering while ensuring
      // the queue cannot empty into a phantom next turn without consuming the host-stated transition.
      const wakeAlreadyQueued = globalScene.phaseManager?.getQueuedPhaseNames().includes("CoopFinalizeTurnPhase");
      if (!wakeAlreadyQueued) {
        globalScene.phaseManager.pushPhase(coopWaveAdvanceBoundaryWakeFactory());
      }
      // Run 29520815364: gameOver landed after the guest had already opened wave-N turn+1 and parked its
      // replay waiter. Queue the continuation FIRST, then dissolve that impossible waiter so end() shifts
      // directly into this boundary and the terminal DATA/continuation proof can complete on both peers.
      // Track R depth lane (run 29654429335): the SAME class fires for a WON wave, not just gameOver - a
      // mutual-KO double faint whose out-of-band replacement checkpoint (correctly deferred to the
      // complete field by cycle-8) lands AFTER the guest's final-turn finalize already parked the next
      // turn. The guest suppresses the phantom command (coop-replay-turn-phase) and holds that park; a WIN
      // WAVE_ADVANCE must dissolve it too, or it awaits a turn resolution the host - now advanced - never
      // sends, and THIS op's continuation deadline expires. abortIfRetainedTerminalSuperseded only wakes a
      // park at/after the settled turn awaiting authority, so a legitimate in-flight earlier turn is never
      // dropped; a normal won wave has no trailing park, so this is inert there.
      const unparkedReplay =
        coopActiveReplayTurnAborter?.(
          `retained ${payload.outcome} WAVE_ADVANCE wave=${payload.wave} settledTurn=${envelope.turn}`,
          envelope.turn,
        ) ?? false;
      coopLog(
        "runtime",
        `wave-advance JOURNAL ${wakeAlreadyQueued ? "retained" : "queued"} safe-boundary wake wave=${payload.wave} unparkedReplay=${Number(unparkedReplay)}`,
      );
    }
    return continuationReady;
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
  // Transport delivery can run while the sender is the ambient harness client. Bind both validation and
  // publication to the receiving runtime so an ACK can never outlive a receipt written into the wrong peer.
  const binding = {
    opState: runtime.opState,
    durability: runtime.durability ?? null,
  };
  const op = envelope.pendingOperation;
  const parsed = op == null ? null : parseCoopOperationId(op.id);
  const plan = preflightCoopBiomeJournalMaterialization(envelope, binding);
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
      return publishCoopBiomeJournalMaterialization(plan, binding);
    }
    try {
      runtime.interactionRelay.materializeCommittedInteractionChoice(parsed.pinnedSeq, "biomePick", payload.nodeIndex, [
        payload.biomeId,
      ]);
    } catch (e) {
      coopWarn("runtime", `biome committed relay materialization threw id=${op.id}; receipt remains unpublished`, e);
      return false;
    }
    return publishCoopBiomeJournalMaterialization(plan, binding);
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
    return publishCoopBiomeJournalMaterialization(plan, binding);
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
  if (op.kind === "REWARD_PRESENT" || op.kind === "SHOP_PRESENT") {
    const payload = op.payload as CoopRewardPresentationPayload;
    const expectedSurfaceBand = payload.rewardSurface == null ? 0 : payload.rewardSurface.ordinal + 1;
    if (
      (op.kind === "REWARD_PRESENT" && payload.surface !== "reward")
      || (op.kind === "SHOP_PRESENT" && payload.surface !== "market")
      || payload.pinned !== pinned
      || !Number.isSafeInteger(payload.reroll)
      || payload.reroll < 0
      || ordinal % COOP_REWARD_SURFACE_ACTION_STRIDE !== payload.reroll
      || Math.floor(ordinal / COOP_REWARD_SURFACE_ACTION_STRIDE) !== expectedSurfaceBand
      || !Array.isArray(payload.options)
      || payload.options.some(
        option =>
          typeof option?.id !== "string"
          || option.id.length === 0
          || !Number.isFinite(option.tier)
          || !Number.isFinite(option.upgradeCount)
          || !Number.isFinite(option.cost)
          || (option.pregenArgs !== undefined
            && (!Array.isArray(option.pregenArgs) || !option.pregenArgs.every(Number.isFinite))),
      )
      || (payload.surface === "market"
        && (!Array.isArray(payload.remainingStock)
          || payload.remainingStock.length !== payload.options.length
          || payload.remainingStock.some(stock => !Number.isSafeInteger(stock) || stock < 0)))
      || (payload.rewardSurface !== undefined && !isValidCoopRewardSurfaceIdentity(payload.rewardSurface))
    ) {
      return false;
    }
    runtime.interactionRelay.materializeCommittedRewardOptions(
      payload.pinned,
      payload.reroll,
      structuredClone(payload.options) as CoopSerializedRewardOption[],
      payload.rewardSurface,
      op.id,
      payload.surface === "market"
        ? {
            marketKind: payload.marketKind,
            remainingStock: [...payload.remainingStock],
          }
        : undefined,
    );
    return true;
  }
  if (op.kind === "REWARD") {
    const payload = op.payload as CoopRewardActionPayload;
    const expectedSurfaceBand = payload.rewardSurface == null ? 0 : payload.rewardSurface.ordinal + 1;
    if (
      typeof payload?.label !== "string"
      || !COOP_REWARD_CHOICE_KINDS.some(kind => kind === payload.label)
      || typeof payload.choice !== "number"
      || typeof payload.terminal !== "boolean"
      || typeof payload.result?.lockModifierTiers !== "boolean"
      || (payload.terminal === false
        && (payload.result.continuation?.surface !== "reward"
          || payload.result.continuation.pinned !== pinned
          || !Array.isArray(payload.result.continuation.options)))
      || (payload.rewardSurface !== undefined && !isValidCoopRewardSurfaceIdentity(payload.rewardSurface))
      || Math.floor(ordinal / COOP_REWARD_SURFACE_ACTION_STRIDE) !== expectedSurfaceBand
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
      payload.rewardSurface,
    );
    const continuation = payload.result.continuation;
    if (continuation != null) {
      runtime.interactionRelay.materializeCommittedRewardOptions(
        continuation.pinned,
        continuation.reroll,
        structuredClone(continuation.options) as CoopSerializedRewardOption[],
        continuation.rewardSurface,
        op.id,
      );
    }
    armCoopRewardJournalMaterialization(op.id, pinned);
    return true;
  }
  if (op.kind === "SHOP_BUY") {
    const payload = op.payload as CoopShopBuyPayload;
    if (
      typeof payload?.slot !== "number"
      || typeof payload.terminal !== "boolean"
      || !Array.isArray(payload.result?.remainingStock)
      || payload.result.remainingStock.some(stock => !Number.isSafeInteger(stock) || stock < 0)
      || (payload.terminal === false
        && (payload.result.continuation?.surface !== "market"
          || payload.result.continuation.pinned !== pinned
          || payload.result.continuation.remainingStock.length !== payload.result.continuation.options.length
          || JSON.stringify(payload.result.continuation.remainingStock)
            !== JSON.stringify(payload.result.remainingStock)))
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
      undefined,
      [...payload.result.remainingStock],
    );
    const continuation = payload.result.continuation;
    if (continuation != null) {
      runtime.interactionRelay.materializeCommittedRewardOptions(
        continuation.pinned,
        continuation.reroll,
        structuredClone(continuation.options) as CoopSerializedRewardOption[],
        continuation.rewardSurface,
        op.id,
        {
          marketKind: continuation.marketKind,
          remainingStock: [...continuation.remainingStock],
        },
      );
    }
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
  if (op?.kind === "BARGAIN_PRESENT") {
    const presentation = op.payload as CoopBargainPresentationPayload | undefined;
    if (
      parsed == null
      || presentation == null
      || presentation.pinned !== parsed.pinnedSeq
      || !Array.isArray(presentation.sins)
      || presentation.sins.length > 3
    ) {
      return false;
    }
    const indices = presentation.sins.map(sin => BARGAIN_SIN_ORDER.indexOf(sin as (typeof BARGAIN_SIN_ORDER)[number]));
    if (indices.some(index => index < 0)) {
      return false;
    }
    runtime.interactionRelay.materializeCommittedInteractionChoice(
      COOP_BARGAIN_SEQ_BASE + presentation.pinned,
      COOP_BARGAIN_PRESENT_KIND,
      0,
      indices,
      op.id,
    );
    return true;
  }
  const payload = op?.payload as CoopBargainPayload | undefined;
  if (
    op?.kind !== "BARGAIN"
    || parsed == null
    || !Number.isSafeInteger(parsed.pinnedSeq)
    || parsed.pinnedSeq < 0
    || !isCompleteCoopMeResyncOutcome(payload?.outcome)
  ) {
    return false;
  }
  // Materialization means the complete state transaction succeeded, not that a phase-local relay FIFO
  // accepted a blob. This call owns rollback on failure; returning false withholds the V2 receipt/journal
  // ACK so the same immutable entry remains retriable.
  if (
    !applyCoopMeOutcome(payload.outcome, {
      authoritativeStateAlreadyApplied: runtime.v2InteractionStateApplied.has(op.id),
    })
  ) {
    return false;
  }
  // A guest-owned Bargain already closed its local owner phase after sending the proposal. It still adopts
  // the host's final image above, but it has no watcher waiter to wake. A host-owned Bargain wakes the guest
  // watcher only after DATA is real, and the proof credit tells that phase not to apply the image twice.
  if (op.owner !== runtime.controller.localSeatId) {
    armCoopBargainJournalMaterialization(op.id);
    runtime.interactionRelay.materializeCommittedInteractionOutcome(
      COOP_BARGAIN_SEQ_BASE + parsed.pinnedSeq,
      payload.outcome,
    );
  }
  return true;
}

/** Feed one journal-delivered ability outcome into the receiver's dedicated picker FIFO. */
function materializeCoopAbilityOutcomeFromOp(runtime: CoopRuntime, envelope: CoopAuthoritativeEnvelopeV1): boolean {
  if (runtime.controller.netcodeMode !== "authoritative" || runtime.controller.role !== "guest") {
    return false;
  }
  const operation = envelope.pendingOperation;
  const parsed = operation == null ? null : parseCoopOperationId(operation.id);
  if (operation?.kind === "ABILITY_PRESENT") {
    const presentation = operation.payload as CoopAbilityPresentationPayload | undefined;
    const expectedPhaseName =
      presentation?.workflow === "capsule"
        ? "ErAbilityCapsulePhase"
        : presentation?.workflow === "greater-capsule"
          ? "ErGreaterAbilityCapsulePhase"
          : presentation?.workflow === "greater-randomizer"
            ? "ErGreaterAbilityRandomizerPhase"
            : null;
    if (
      parsed == null
      || presentation == null
      || expectedPhaseName == null
      || presentation.pinned !== parsed.pinnedSeq / COOP_ABILITY_ACTION_STRIDE
    ) {
      return false;
    }
    const phaseManager = globalScene.phaseManager;
    const current = phaseManager?.getCurrentPhase() as
      | {
          phaseName?: string;
          partyIndex?: number;
          coopSeq?: number;
          coopV2ControlOperationId?: string;
          installCoopV2AbilityPresentation?: (
            operationId: string,
            presentation: CoopAbilityPresentationPayload,
          ) => boolean;
        }
      | undefined;
    if (
      current?.phaseName === expectedPhaseName
      && current.partyIndex === presentation.partyIndex
      && current.coopSeq === presentation.pinned
      && typeof current.installCoopV2AbilityPresentation === "function"
    ) {
      return current.installCoopV2AbilityPresentation(operation.id, presentation);
    }
    if (
      current?.phaseName === "ErAbilityCapsulePhase"
      || current?.phaseName === "ErGreaterAbilityCapsulePhase"
      || current?.phaseName === "ErGreaterAbilityRandomizerPhase"
    ) {
      // A different live ability generation cannot inherit this address. Fail the shared session instead
      // of leaving a retained entry to retry forever or stacking two interactive phases.
      failCoopSharedSession(
        `Ability presentation ${operation.id} conflicts with live ${current.phaseName}`
          + ` slot=${current.partyIndex ?? "?"} seq=${current.coopSeq ?? "?"}`,
      );
      return false;
    }
    phaseManager.tryRemovePhase("ErAbilityCapsulePhase", phase => phase.coopSeq === presentation.pinned);
    phaseManager.tryRemovePhase("ErGreaterAbilityCapsulePhase", phase => phase.coopSeq === presentation.pinned);
    phaseManager.tryRemovePhase("ErGreaterAbilityRandomizerPhase", phase => phase.coopSeq === presentation.pinned);
    const watcher = operation.owner !== runtime.controller.localSeatId;
    const phase = phaseManager.create(expectedPhaseName, presentation.partyIndex, presentation.pinned, watcher) as {
      installCoopV2AbilityPresentation: (operationId: string, presentation: CoopAbilityPresentationPayload) => boolean;
    } & Phase;
    if (!phase.installCoopV2AbilityPresentation(operation.id, presentation) || !phaseManager.overridePhase(phase)) {
      return false;
    }
    return true;
  }
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
  if (isCoopAbilityOperationSettled(operation.id)) {
    return true;
  }
  if (operation.owner === runtime.controller.localSeatId) {
    // The local owner applies before proposing to the host, but it must also prove that its exact picker
    // phase ended. A raw proposal or merely absent phase is not material completion.
    return false;
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
  return false;
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
    return true;
  }
  if (runtime.v2SettledInteractionOperations.has(operation.id)) {
    // The exact owner/watcher phase, not relay delivery, is the result terminal. In particular a
    // host-owned Revival result first wakes the guest's read-only picker and returns deferred; its later
    // terminal proof must make the same retained entry materializable on redelivery.
    return true;
  }
  if (operation.owner === runtime.controller.localSeatId) {
    // The guest-owned picker already settled its own exact intent before the authority committed the
    // immutable result. If that proof is absent, the result is not complete and feeding it back into the
    // same FIFO could poison a later reuse of the relay band.
    return false;
  }
  runtime.interactionRelay.materializeCommittedInteractionChoice(
    COOP_REVIVAL_SEQ_BASE + payload.fieldIndex,
    "revival",
    payload.partySlot,
    [0, payload.speciesId],
    operation.id,
  );
  // The host-owned result is not complete until the queue-owned read-only watcher consumes this exact
  // carrier, closes the public phase, and publishes its address-exact settlement proof.
  return false;
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
    return true;
  }
  // Decisions are owner-local and converge through the host's authoritative capture state, but the
  // replica may not call that material completion until the exact keep/release picker generation ended.
  return runtime.v2SettledInteractionOperations.has(operation.id);
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
  if (operation.owner === 1) {
    // This synchronous consumer is the material boundary: a timeout fallback cannot ACK until the
    // exact old-address guest picker has been settled and its late callback disabled.
    return materializeCoopFaintSwitchPickerTerminal(envelope);
  }
  // Host-owned replacements are fed into the existing committed-choice watcher.
  runtime.interactionRelay.materializeCommittedInteractionChoice(
    COOP_FAINT_SWITCH_SEQ_BASE + payload.fieldIndex,
    "switch",
    payload.partySlot,
    [...payload.data],
    operation.id,
  );
  return true;
}

/** Feed the host's committed one-time Stormglass choice into the guest watcher seam. */
function materializeCoopStormglassFromOp(runtime: CoopRuntime, envelope: CoopAuthoritativeEnvelopeV1): boolean {
  if (runtime.controller.netcodeMode !== "authoritative" || runtime.controller.role !== "guest") {
    return false;
  }
  const operation = envelope.pendingOperation;
  if (operation?.kind === "STORMGLASS_PRESENT") {
    const presentation = operation.payload as CoopStormglassPresentationPayload;
    if (
      !Array.isArray(presentation?.options)
      || presentation.options.length === 0
      || presentation.options.some(
        option =>
          !Number.isSafeInteger(option.weatherIndex)
          || option.weatherIndex < 0
          || !Number.isSafeInteger(option.weather)
          || option.weather < 0,
      )
    ) {
      return false;
    }
    const phaseManager = globalScene.phaseManager;
    const current = phaseManager?.getCurrentPhase() as
      | {
          phaseName?: string;
          installCoopV2StormglassPresentation?: (
            operationId: string,
            presentation: CoopStormglassPresentationPayload,
          ) => boolean;
        }
      | undefined;
    if (
      current?.phaseName === "ErStormglassPickerPhase"
      && current.installCoopV2StormglassPresentation?.(operation.id, presentation) === true
    ) {
      return true;
    }
    if (current?.phaseName === "ErStormglassPickerPhase") {
      failCoopSharedSession(`Stormglass presentation ${operation.id} conflicts with the live picker generation`);
      return false;
    }
    phaseManager.tryRemovePhase("ErStormglassPickerPhase");
    const phase = phaseManager.create("ErStormglassPickerPhase");
    if (!phase.installCoopV2StormglassPresentation(operation.id, presentation) || !phaseManager.overridePhase(phase)) {
      return false;
    }
    return true;
  }
  const payload = operation?.payload as CoopStormglassPayload | undefined;
  if (operation?.kind !== "STORMGLASS" || payload == null) {
    return false;
  }
  if (
    isCoopStormglassOperationSettled(operation.id, {
      opState: runtime.opState,
      durability: runtime.durability ?? null,
    })
  ) {
    return true;
  }
  runtime.interactionRelay.materializeCommittedInteractionChoice(
    COOP_STORMGLASS_SEQ,
    "stormglass",
    payload.weatherIndex,
    undefined,
    operation.id,
  );
  return false;
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
          ownerIsGuest: op.owner === 1,
        },
        op.id,
      );
      return true;
    }
    if (op.owner === 0) {
      // The host-owned result closes the guest's exact read-only replay phase. The immutable state was
      // already applied above; this carrier is only the phase-terminal proof and carries the result ID.
      runtime.interactionRelay.materializeCommittedInteractionChoice(
        COOP_LEARN_MOVE_FWD_SEQ_BASE + payload.partySlot,
        "learnMove",
        payload.forgetSlot,
        undefined,
        op.id,
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
    runtime.interactionRelay.materializeCommittedInteractionOutcome(
      seq,
      {
        k: "learnMoveBatchForward",
        partySlot: payload.partySlot,
        learnableIds: [...payload.learnableIds],
        ownerIsGuest: payload.ownerIsGuest,
      },
      op.id,
    );
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
    && op.owner === coopInteractionOwnerSeat(pinned)
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
    runtime.interactionRelay.materializeCommittedInteractionOutcome(seq, presentation, op.id);
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
    const activePin = coopMeInteractionStartValue();
    if (activePin < 0) {
      if (runtime.controller.interactionCounter() !== pinned) {
        return false;
      }
    } else if (activePin !== pinned) {
      return false;
    }
    const immutableState = structuredClone(envelope.authoritativeState);
    let stateApplied = runtime.v2InteractionStateApplied.has(op.id);
    if (!stateApplied) {
      stateApplied = applyCoopAuthoritativeBattleState(immutableState, true);
      const appliedTick = coopAppliedStateTick();
      if (!stateApplied && appliedTick === immutableState.tick) {
        stateApplied = reapplyAcceptedCoopAuthoritativeBattleState(immutableState, true);
      } else if (!stateApplied && appliedTick > immutableState.tick) {
        // A later authenticated authority frame already subsumes this presentation; never roll it back.
        stateApplied = true;
      }
    }
    if (!stateApplied) {
      return false;
    }
    const priorMysteryControl = captureCoopMeControlTransactionState();
    if (activePin < 0) {
      // The authenticated global entry, not a locally rolled MysteryEncounterPhase, establishes this
      // replica's exact ME generation. Without this pin the immutable projection capsule cannot construct
      // CoopReplayMePhase when delivery races the previous wave's NextEncounter tween.
      setCoopMeInteractionStart(pinned);
    }
    setCoopMeActivePresentation(payload.presentation);
    const retained = captureCoopActiveMysteryControl();
    if (
      retained?.interactionCounter !== pinned
      || (retained.terminal !== "pending" && retained.terminal !== "battle-settled")
      || JSON.stringify(retained.presentation) !== JSON.stringify(payload.presentation)
    ) {
      restoreCoopMeControlTransactionState(priorMysteryControl);
      return false;
    }
    // DATA application deliberately does not require or install a phase. The ordered V2 control projector
    // reconstructs CoopReplayMePhase from this same immutable entry and separately proves its real handler.
    // This removes the former circular dependency (DATA waited for the phase; projection waited for DATA).
    runtime.interactionRelay.materializeCommittedInteractionOutcome(seq, payload.presentation, op.id);
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
    || (payload.destination.kind === "reward"
      && payload.destination.hostTurn !== payload.outcome.authoritativeState.turn)
    || (payload.destination.kind === "continue" && payload.destination.nextWave !== envelope.wave + 1)
    || coopMeInteractionStartValue() !== pinned
  ) {
    return false;
  }
  const outcomeState = payload.outcome.authoritativeState;
  if (outcomeState == null) {
    return false;
  }
  const transaction = { operationId: op.id, pinned, step, payload };
  // Besides making a late replay phase retriable, this fences the two-engine harness's shared module
  // graph: an envelope delivered while the other client's scene is installed must not apply to it.
  if (!canMaterializeCoopMeCommittedTerminal(transaction)) {
    return false;
  }
  const receive = receiveCoopMeTerminalTransactionFor(runtime.opState, transaction, {
    applyMaterial: () => {
      if (
        applyCoopMeOutcome(payload.outcome, {
          authoritativeStateAlreadyApplied: runtime.v2InteractionStateApplied.has(op.id),
        })
      ) {
        runtime.battleStream.retireEnemyPartyAuthorityThrough(outcomeState.wave, outcomeState.tick);
        return true;
      }
      coopWarn("me", `journaled Mystery transaction DATA apply failed id=${op.id}`);
      if (consumeCoopMeOutcomeRollbackFatal()) {
        failCoopSharedSession(`Mystery outcome rollback failed for ${op.id}`);
      }
      return false;
    },
    executeDestination: () => {
      const hostTurn =
        payload.destination.kind === "battle" || payload.destination.kind === "reward"
          ? payload.destination.hostTurn
          : undefined;
      setCoopMeTerminalControl(payload.terminal, hostTurn, {
        operationId: op.id,
        step,
        choice:
          payload.terminal === "battle"
            ? COOP_ME_BATTLE_HANDOFF
            : payload.terminal === "battle-settled"
              ? COOP_ME_BATTLE_SETTLED_CHOICE
              : payload.terminal === "reward-settled"
                ? COOP_ME_REWARD_SETTLED_CHOICE
                : COOP_INTERACTION_LEAVE,
      });
      const retainedControl = captureCoopActiveMysteryControl();
      if (
        retainedControl?.terminalOperationId !== op.id
        || retainedControl.terminal !== payload.terminal
        || retainedControl.terminalStep !== step
      ) {
        return false;
      }
      return materializeCoopMeCommittedTerminal({
        operationId: op.id,
        pinned,
        step,
        payload,
      });
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
  // The terminal receiver is the exact phase/destination proof for this operation: it returns
  // `executed` only after both the immutable DATA image and the typed destination have installed, and
  // `duplicate` only for that same already-executed receipt. Until this point the global V2 entry must
  // remain retained but unacknowledged.
  settleCoopV2InteractionOperation(op.id, runtime);
  return true;
}

type CoopV2InteractionLiveMaterializer = (runtime: CoopRuntime, envelope: CoopAuthoritativeEnvelopeV1) => boolean;

/**
 * Compile-time-complete interaction materialization registry. Surface-level sink registration is not enough:
 * one sink can silently forget a new operation kind. This table makes every closed V2 interaction kind name
 * an actual production materializer before the capability can be assembled.
 */
const COOP_V2_INTERACTION_LIVE_MATERIALIZERS = {
  ABILITY_PRESENT: materializeCoopAbilityOutcomeFromOp,
  ABILITY_PICK: materializeCoopAbilityOutcomeFromOp,
  BARGAIN_PRESENT: materializeCoopBargainOutcomeFromOp,
  BARGAIN: materializeCoopBargainOutcomeFromOp,
  BIOME_PICK: materializeCoopBiomeChoiceFromOp,
  CATCH_FULL: materializeCoopCatchFullPromptFromOp,
  COLO_PICK: materializeCoopColosseumActionFromOp,
  CROSSROADS_PICK: materializeCoopBiomeChoiceFromOp,
  LEARN_MOVE: materializeCoopLearnMoveFromOp,
  LEARN_MOVE_BATCH: materializeCoopLearnMoveFromOp,
  ME_BUTTON: materializeCoopMeOperationFromOp,
  ME_PICK: materializeCoopMeOperationFromOp,
  ME_PRESENT: materializeCoopMeOperationFromOp,
  ME_SUB: materializeCoopMeOperationFromOp,
  ME_TERMINAL: materializeCoopMeOperationFromOp,
  QUIZ_ANSWER: materializeCoopMeOperationFromOp,
  REVIVAL: materializeCoopRevivalPromptFromOp,
  REWARD: materializeCoopRewardActionFromOp,
  REWARD_PRESENT: materializeCoopRewardActionFromOp,
  SHOP_BUY: materializeCoopRewardActionFromOp,
  SHOP_PRESENT: materializeCoopRewardActionFromOp,
  STORMGLASS_PRESENT: materializeCoopStormglassFromOp,
  STORMGLASS: materializeCoopStormglassFromOp,
} as const satisfies Record<CoopV2InteractionOperationKind, CoopV2InteractionLiveMaterializer>;

function materializeCoopRegisteredInteractionFromOp(
  runtime: CoopRuntime,
  surfaceClass: Exclude<CoopOperationSurfaceClass, "op:faintSwitch" | "op:wave">,
  envelope: CoopAuthoritativeEnvelopeV1,
): boolean {
  const operation = envelope.pendingOperation;
  if (operation == null || operation.kind === "FAINT_SWITCH" || operation.kind === "WAVE_ADVANCE") {
    return false;
  }
  const operationKind = operation.kind as CoopV2InteractionOperationKind;
  if (coopV2InteractionSourceSurface(operationKind) !== surfaceClass) {
    return false;
  }
  return COOP_V2_INTERACTION_LIVE_MATERIALIZERS[operationKind](runtime, envelope);
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
  const runtime = active;
  if (runtime == null || runtime.controller.role !== "host") {
    return null;
  }
  const state = capturedState ?? captureCoopAuthoritativeBattleState(globalScene.currentBattle.turn);
  if (state == null || state.wave !== wave) {
    coopWarn("runtime", `settled WAVE_ADVANCE capture rejected wave=${wave}`);
    if (usesRetainedCoopWaveTransaction(runtime)) {
      failCoopSharedSession(`Could not capture the complete settled state for wave ${wave}.`);
    }
    return null;
  }
  const settledTransition: CoopWaveAdvancePayload = {
    ...transition,
    settledStateTick: state.tick,
  };
  if (isCoopV2WaveCutoverActive()) {
    if (!commitCoopV2SettledWaveAdvance(runtime, settledTransition, state)) {
      failCoopSharedSession(`Could not retain the complete Authority V2 transition for wave ${wave}.`);
      return null;
    }
    settledHostWaveTransitions.set(wave, settledTransition);
  } else {
    const envelope = commitWaveAdvanceOwnerIntent(
      {
        payload: settledTransition,
        authoritativeState: state,
        localRole: runtime.controller.role,
        wave,
        turn: state.turn,
      },
      runtime.waveOperationBinding,
    );
    if (usesRetainedCoopWaveTransaction(runtime) && envelope == null) {
      failCoopSharedSession(`Could not retain the complete authoritative transition for wave ${wave}.`);
      return null;
    }
    if (envelope != null) {
      settledHostWaveTransitions.set(wave, settledTransition);
    }
  }
  coopLog(
    "runtime",
    `settled WAVE_ADVANCE committed wave=${wave} tick=${state.tick} next=${settledTransition.nextLogicalPhase}/wave${settledTransition.nextWave}`,
  );
  pendingHostWaveTransitions.delete(wave);
  return state;
}

function commitCoopV2SettledWaveAdvance(
  runtime: CoopRuntime,
  transition: CoopWaveAdvancePayload,
  state: CoopAuthoritativeBattleStateV1,
): boolean {
  const cutover = coopV2WaveCutovers.get(runtime);
  if (
    cutover == null
    || runtime.controller.authorityRole !== "authority"
    || transition.wave !== state.wave
    || transition.settledStateTick !== state.tick
  ) {
    return false;
  }
  const authorityCarrier = {
    authoritativeState: structuredClone(state),
    transition: structuredClone(transition),
  };
  const terminal =
    transition.outcome === "gameOver"
    || ((transition.outcome === "win" || transition.outcome === "capture") && transition.nextWave === transition.wave);
  if (terminal) {
    const terminalId = `V2/TERMINAL/e${runtime.controller.sessionEpoch}/w${transition.wave}/tick${state.tick}`;
    const material: CoopTerminalMaterialV2 = {
      kind: "terminal",
      terminalId,
      reason: transition.outcome === "gameOver" ? "game-over" : "final-boss-credits",
      wave: transition.wave,
      turn: state.turn,
      authorityCarrier,
    };
    return (
      cutover.commitHostTerminal({
        operationId: terminalId,
        terminal: material,
        legacyImage: material,
        legacyDigest: digestOfMaterial(material),
      }) != null
    );
  }

  const base = {
    kind: "wave-advance" as const,
    wave: transition.wave,
    turn: state.turn,
    nextWave: transition.nextWave,
    biomeChange: transition.biomeChange,
    eggLapse: transition.eggLapse,
    meBoundary: transition.meBoundary,
    authorityCarrier,
  };
  const victoryKind = transition.victoryKind;
  if (transition.outcome !== "flee" && victoryKind == null) {
    coopWarn("v2-wave", `refused victory without an authoritative victoryKind wave=${transition.wave}`);
    return false;
  }
  const material: CoopWaveTransitionMaterialV2 =
    transition.outcome === "flee"
      ? { ...base, outcome: "flee" }
      : { ...base, outcome: transition.outcome, victoryKind: victoryKind as "wild" | "trainer" };
  const destinationSurface = resolveCoopV2SettledWaveDestination(transition);
  if (destinationSurface == null) {
    return false;
  }
  const operationId = `V2/WAVE/e${runtime.controller.sessionEpoch}/w${transition.wave}/tick${state.tick}`;
  let destination: CoopWaveAdvanceDestination;
  if (destinationSurface === "CROSSROADS_PICK") {
    // Crossroads has no preceding serialized PRESENT result. Its real option handler is opened by a
    // complete CONTROL_COMMIT capsule at the phase chokepoint.
    destination = {
      kind: "AWAIT_SUCCESSOR",
      afterOperationId: operationId,
      epoch: runtime.controller.sessionEpoch,
      wave: transition.wave,
      turn: state.turn,
      allowedKinds: ["CONTROL_COMMIT"],
      allowNextWaveStart: false,
      expectedOperationId: null,
    };
  } else if (
    destinationSurface === "REWARD_PRESENT"
    || destinationSurface === "SHOP_PRESENT"
    || destinationSurface === "MYSTERY_PRESENT"
    || destinationSurface === "BIOME_PICK"
    || destinationSurface === "BARGAIN"
  ) {
    destination = {
      kind: "AWAIT_SUCCESSOR",
      afterOperationId: operationId,
      epoch: runtime.controller.sessionEpoch,
      wave: transition.wave,
      turn: state.turn,
      allowedKinds: ["INTERACTION_COMMIT"],
      allowNextWaveStart: false,
      expectedOperationId: null,
    };
  } else {
    destination = {
      kind: "AWAIT_SUCCESSOR",
      afterOperationId: operationId,
      epoch: runtime.controller.sessionEpoch,
      wave: transition.nextWave,
      turn: 1,
      allowedKinds: ["CONTROL_COMMIT"],
      allowNextWaveStart: false,
      expectedOperationId: null,
    };
  }
  return (
    cutover.commitHostWave({
      operationId,
      transition: material,
      destination,
      legacyImage: material,
      legacyDigest: digestOfMaterial(material),
    }) != null
  );
}

type CoopV2SettledWaveDestinationSurface =
  | "REWARD_PRESENT"
  | "SHOP_PRESENT"
  | "MYSTERY_PRESENT"
  | "BIOME_PICK"
  | "CROSSROADS_PICK"
  | "BARGAIN"
  | "COMMAND_OPEN";

/**
 * The authority commits only after BattleEnd/CoopVictorySeal has queued the complete executable tail.
 * Read that host-authored queue and name its first real player/control boundary. This is deliberately not
 * recomputed from wave modulo, mode, biome, or Mystery RNG: those predicates already ran once when the
 * host built the tail, and duplicating them here would recreate the derived-tail split V2 removes.
 */
function resolveCoopV2SettledWaveDestination(
  transition: CoopWaveAdvancePayload,
): CoopV2SettledWaveDestinationSurface | null {
  if (transition.meBoundary === "battle-victory") {
    return "MYSTERY_PRESENT";
  }
  const queued = globalScene.phaseManager?.getQueuedPhaseNames?.() ?? [];
  for (const phaseName of queued) {
    switch (phaseName) {
      case "SelectModifierPhase":
        return "REWARD_PRESENT";
      case "BiomeShopPhase":
        return "SHOP_PRESENT";
      case "TheBargainPhase":
        return "BARGAIN";
      case "ErCrossroadsPhase":
        return "CROSSROADS_PICK";
      case "SelectBiomePhase":
        return "BIOME_PICK";
      case "MysteryEncounterPhase":
      case "CoopReplayMePhase":
        return "MYSTERY_PRESENT";
      case "NewBattlePhase":
      case "EncounterPhase":
      case "CommandPhase":
        return "COMMAND_OPEN";
    }
  }
  coopWarn("v2-wave", `refused wave=${transition.wave} without a stated executable tail; queued=[${queued.join(",")}]`);
  return null;
}

/** BattleEnd destroys enemy presentation after capture; encode that completed projection explicitly. */
function normalizeCoopSettledPostBattleState(state: CoopAuthoritativeBattleStateV1): CoopAuthoritativeBattleStateV1 {
  return {
    ...state,
    field: state.field.map(seat => (seat.side === "enemy" ? { ...seat, presented: false } : seat)),
  };
}

/** Raw carrier retained only for older peers and presentation diagnostics after the durable commit succeeds. */
function sendCoopWaveEndStateCompatibility(wave: number, state: CoopAuthoritativeBattleStateV1): void {
  try {
    coopLog("runtime", `send waveEndState wave=${wave} tick=${state.tick} (host)`);
    active?.battleStream.sendWaveEndState(wave, state);
  } catch (e) {
    coopWarn("runtime", `send raw waveEndState failed after durable seal wave=${wave} (ignored)`, e);
  }
}

/**
 * Execute the explicit post-victory seal after every queued automatic shared mutation drained. The host
 * commits the one complete image; the guest proves that BattleEnd admitted that exact image before it may
 * pass this tail into LLM/reward/market/map/new-battle continuation. Missing, duplicate, wrong-runtime and
 * wrong-address calls all enter the bounded shared terminal path instead of silently advancing one peer.
 */
export function sealCoopAutomaticVictoryBoundary(identity: CoopAutomaticVictorySealIdentity): boolean {
  const runtime = active;
  if (runtime == null || runtime !== identity.runtime || runtime.waveOperationBinding !== identity.binding) {
    failCoopSharedSession(`The automatic victory seal for wave ${identity.wave} lost its owning runtime.`);
    return false;
  }
  if (!usesRetainedCoopWaveTransaction(runtime)) {
    failCoopSharedSession(`The automatic victory seal for wave ${identity.wave} lost retained delivery.`);
    return false;
  }

  if (runtime.controller.role === "guest") {
    if (coopV2WaveCutovers.has(runtime)) {
      const staged = runtime.v2WaveTransactions.get(identity.wave);
      if (
        staged == null
        || staged.dataApplied !== true
        || staged.transition.outcome !== "win"
        || staged.transition.wave !== identity.wave
        || (identity.turn != null && identity.turn !== staged.authoritativeState.turn)
      ) {
        failCoopSharedSession(
          `The renderer reached an incomplete Authority V2 victory seal for wave ${identity.wave} `
            + `(turn ${staged?.authoritativeState.turn ?? "missing"}, applied ${staged?.dataApplied === true}).`,
        );
        return false;
      }
      coopLog(
        "v2-wave",
        `GUEST automatic victory settlement admitted wave=${identity.wave} turn=${staged.authoritativeState.turn}`,
      );
      return true;
    }
    const staged = getCoopStagedWaveAdvanceTransaction(identity.wave, identity.binding);
    const payload = staged?.envelope.pendingOperation?.payload;
    const retainedTurn = staged?.envelope.authoritativeState.turn;
    if (
      staged == null
      || staged.dataApplied !== true
      || !isValidCoopWaveAdvancePayload(payload)
      || payload.outcome !== "win"
      || payload.wave !== identity.wave
      || (identity.turn != null && identity.turn !== retainedTurn)
    ) {
      failCoopSharedSession(
        `The renderer reached an incomplete automatic victory seal for wave ${identity.wave} `
          + `(turn ${retainedTurn ?? "missing"}, applied ${staged?.dataApplied === true}).`,
      );
      return false;
    }
    coopLog("progression", `GUEST automatic victory settlement admitted wave=${identity.wave} turn=${retainedTurn}`);
    return true;
  }

  const pending = pendingAutomaticVictorySeals.get(runtime);
  if (pending == null) {
    failCoopSharedSession(`The automatic victory seal for wave ${identity.wave} was missing or already consumed.`);
    return false;
  }
  if (
    pending.identity !== identity
    || pending.identity.binding !== identity.binding
    || pending.identity.wave !== identity.wave
    || pending.identity.turn !== identity.turn
    || pending.transition.outcome !== "win"
  ) {
    failCoopSharedSession(`The automatic victory seal for wave ${identity.wave} did not match its staged boundary.`);
    return false;
  }
  const currentWave = globalScene.currentBattle?.waveIndex ?? -1;
  const currentTurn = globalScene.currentBattle?.turn ?? -1;
  if (
    identity.turn == null
    || identity.turn < 0
    || currentWave !== identity.wave
    || currentTurn !== pending.settlementTurn
  ) {
    failCoopSharedSession(
      `The automatic victory seal address drifted from source ${identity.wave}:${identity.turn ?? "unresolved"} `
        + `through settlement ${identity.wave}:${pending.settlementTurn} to ${currentWave}:${currentTurn}.`,
    );
    return false;
  }

  const capturedState = captureCoopAuthoritativeBattleState(pending.settlementTurn);
  if (capturedState == null || capturedState.wave !== identity.wave || capturedState.turn !== pending.settlementTurn) {
    failCoopSharedSession(`Could not capture the complete automatic victory state for wave ${identity.wave}.`);
    return false;
  }
  const state = normalizeCoopSettledPostBattleState(capturedState);
  if (commitCoopSettledWaveAdvance(identity.wave, pending.transition, state) == null) {
    failCoopSharedSession(`Could not retain the complete automatic victory state for wave ${identity.wave}.`);
    return false;
  }
  pendingAutomaticVictorySeals.delete(runtime);
  sendCoopWaveEndStateCompatibility(identity.wave, state);
  coopLog(
    "progression",
    `HOST automatic victory settlement sealed wave=${identity.wave} sourceTurn=${identity.turn} settlementTurn=${pending.settlementTurn} tick=${state.tick}`,
  );
  return true;
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
  // Compatibility only. A retained peer ignores this raw carrier for correctness, so drop/reorder cannot
  // make it advance before the complete envelope above.
  sendCoopWaveEndStateCompatibility(wave, state);
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
        data: {
          ...enemies[0].data,
          coopArenaBiomeId: globalScene.arena.biomeId,
        },
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
 * Host-side post-BattleEnd settlement for an ME-spawned battle. The initial battle terminal authorizes
 * only the battle and its renderer-owned entry into BattleEnd; this next retained step carries every
 * automatic post-battle mutation and the exact reward presentation. The final leave remains a later step.
 */
export interface CoopMeBattleSettlementPlan {
  readonly result: "victory" | "failure";
  readonly continuation: "rewards" | "encounter" | "none";
  readonly trainerVictory: boolean;
  readonly rewardSurfaces: readonly CoopMeRewardSurfaceProjection[];
  readonly eggLapse: boolean;
}

/** Whether the live authoritative ME transaction can move reward settlement out of BattleEnd. */
export function shouldDeferCoopMeBattleSettlementUntilRewardPreparation(): boolean {
  const runtime = active;
  const battle = globalScene.currentBattle;
  if (
    runtime == null
    || runtime.controller.role !== "host"
    || runtime.controller.netcodeMode !== "authoritative"
    || !isCoopMeOperationEnabled()
    || !isCoopOperationJournalActive()
    || battle == null
    || battle.mysteryEncounter == null
    || battle.mysteryEncounter?.encounterMode === MysteryEncounterMode.NO_BATTLE
  ) {
    return false;
  }
  const pinned = coopMeInteractionStartValue();
  const prior = captureCoopActiveMysteryControl();
  return pinned >= 0 && prior?.interactionCounter === pinned && prior.terminal === "battle";
}

export function commitCoopMeBattleSettlementAtBattleEnd(plan: CoopMeBattleSettlementPlan): boolean {
  const runtime = active;
  const battle = globalScene.currentBattle;
  if (
    runtime == null
    || runtime.controller.role !== "host"
    || runtime.controller.netcodeMode !== "authoritative"
    || !isCoopMeOperationEnabled()
    || !isCoopOperationJournalActive()
    || battle == null
    || battle.mysteryEncounter == null
    || battle.mysteryEncounter?.encounterMode === MysteryEncounterMode.NO_BATTLE
  ) {
    return false;
  }
  const pinned = coopMeInteractionStartValue();
  const prior = captureCoopActiveMysteryControl();
  if (pinned < 0 || prior?.interactionCounter !== pinned || prior.terminal !== "battle") {
    failCoopSharedSession("Mystery battle settlement had no retained battle handoff");
    return true;
  }
  const step = (prior.terminalStep ?? -1) + 1;
  const payload = {
    terminal: "battle-settled",
    outcome: captureCoopMeOutcome(),
    destination: {
      kind: "reward",
      hostTurn: battle.turn,
      ...plan,
    },
  } satisfies CoopMeTerminalPayload;
  const operationId = commitMeOwnerIntent({
    kind: "ME_TERMINAL",
    seq: COOP_ME_TERM_SEQ_BASE + pinned,
    pinned,
    step,
    payload,
    localRole: "host",
    wave: battle.waveIndex,
    turn: battle.turn,
    beforeAuthorityCommit: id => settleCoopV2InteractionOperation(id, runtime),
  });
  if (operationId == null) {
    runtime.durability?.reconnect();
    failCoopSharedSession("Mystery battle settlement could not be retained");
    return true;
  }
  setCoopMeTerminalControl("battle-settled", battle.turn, {
    operationId,
    step,
    choice: COOP_ME_BATTLE_SETTLED_CHOICE,
  });
  coopLog("me", `host retained post-BattleEnd settlement step=${step} id=${operationId}`);
  return true;
}

/**
 * Retain a no-battle ME's complete post-effect state before its standard reward UI is exposed. This is
 * deliberately a distinct lifecycle cursor from `battle-settled`: no BattleEnd exists to park or infer
 * from, and reconnect control must not enable the battle-handoff renderer exemption.
 */
export function commitCoopMeNoBattleRewardSettlementAfterPreparation(plan: CoopMeBattleSettlementPlan): boolean {
  const runtime = active;
  const battle = globalScene.currentBattle;
  if (
    runtime == null
    || runtime.controller.role !== "host"
    || runtime.controller.netcodeMode !== "authoritative"
    || !isCoopMeOperationEnabled()
    || !isCoopOperationJournalActive()
    || battle == null
    || battle.mysteryEncounter?.encounterMode !== MysteryEncounterMode.NO_BATTLE
  ) {
    return false;
  }
  const pinned = coopMeInteractionStartValue();
  const prior = captureCoopActiveMysteryControl();
  if (
    pinned < 0
    || prior?.interactionCounter !== pinned
    || prior.terminal !== "pending"
    || plan.continuation !== "rewards"
    || plan.trainerVictory
  ) {
    failCoopSharedSession("Mystery no-battle reward settlement had no retained pending encounter");
    return true;
  }
  const step = 0;
  const payload = {
    terminal: "reward-settled",
    outcome: captureCoopMeOutcome(),
    destination: {
      kind: "reward",
      hostTurn: battle.turn,
      ...plan,
    },
  } satisfies CoopMeTerminalPayload;
  const operationId = commitMeOwnerIntent({
    kind: "ME_TERMINAL",
    seq: COOP_ME_TERM_SEQ_BASE + pinned,
    pinned,
    step,
    payload,
    localRole: "host",
    wave: battle.waveIndex,
    turn: battle.turn,
    beforeAuthorityCommit: id => settleCoopV2InteractionOperation(id, runtime),
  });
  if (operationId == null) {
    runtime.durability?.reconnect();
    failCoopSharedSession("Mystery no-battle reward settlement could not be retained");
    return true;
  }
  setCoopMeTerminalControl("reward-settled", battle.turn, {
    operationId,
    step,
    choice: COOP_ME_REWARD_SETTLED_CHOICE,
  });
  coopLog("me", `host retained no-battle pre-reward settlement step=${step} id=${operationId}`);
  return true;
}

/** Hold the exact guest BattleEnd until the retained post-battle ME settlement is redelivered. */
export function holdForCoopMeBattleSettlementAtBattleEnd(): boolean {
  const runtime = active;
  const battle = globalScene.currentBattle;
  if (
    runtime == null
    || runtime.controller.role !== "guest"
    || runtime.controller.netcodeMode !== "authoritative"
    || !isCoopMeOperationEnabled()
    || !isCoopOperationJournalActive()
    || battle == null
    || !battle.isBattleMysteryEncounter?.()
  ) {
    return false;
  }
  const pinned = coopMeInteractionStartValue();
  const retained = captureCoopActiveMysteryControl();
  // A battle-handoff records the turn on which the battle started, so a multi-turn battle legitimately
  // reaches BattleEnd on a later cursor while the settlement operation is still in retriable delivery.
  // Once battle-settled itself is retained, its post-BattleEnd terminal turn must match exactly.
  const retainedTurnMatches =
    retained?.terminal === "battle" || (retained?.terminal === "battle-settled" && retained.hostTurn === battle.turn);
  if (
    pinned < 0
    || retained?.interactionCounter !== pinned
    || (retained.terminal !== "battle" && retained.terminal !== "battle-settled")
    || coopMeHandoffBattleWaveValue() !== battle.waveIndex
    || !retainedTurnMatches
    || !coopMeHandoffBattleStarted()
  ) {
    failCoopSharedSession(
      `Mystery BattleEnd had no exact retained battle terminal (wave=${battle.waveIndex}, turn=${battle.turn}).`,
    );
    return true;
  }
  coopLog("me", `guest BattleEnd holds for retained post-battle settlement wave=${battle.waveIndex}`);
  runtime.durability?.reconnect();
  return true;
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
      priorControl?.interactionCounter === pinned && priorControl.terminal === "battle-settled"
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
        beforeAuthorityCommit: id => settleCoopV2InteractionOperation(id, runtime),
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
  // authority-v2 SHADOW: advertise the shadow capability, gated by the build flag (default OFF - flip on
  // with env COOP_AUTHORITY_V2_SHADOW=on on BOTH peers). Two shadow-enabled builds negotiate it; a peer
  // with it off drops it from the intersection and BOTH sides stay off - the harness never builds, no v2
  // frame is ever sent. Default-off keeps a co-op session BYTE-IDENTICAL to the pre-shadow build. The
  // harness authorizes NOTHING (legacy owns all mechanics), so a parity failure never affects progression.
  if (isCoopV2ShadowEnabled()) {
    caps.push(COOP_CAP_AUTHORITY_V2_SHADOW);
  }
  // authority-v2 TURN/COMMAND CUTOVER (surface 1): advertise the cutover capability, gated by the build flag
  // (default OFF - flip on with env COOP_AUTHORITY_V2_TURN=on; CI enables it per-lane). Two cutover-enabled
  // builds negotiate it; a peer with it off drops it from the intersection and BOTH sides stay on legacy turn
  // authority. Default-off keeps a co-op session BYTE-IDENTICAL to the pre-cutover build. The cutover reuses
  // the shadow harness's log + frame channel, so it is only effective alongside the harness (which builds when
  // either capability is negotiated).
  if (isCoopV2TurnEnabled()) {
    caps.push(COOP_CAP_AUTHORITY_V2_TURN);
  }
  // Replacement reuses the turn surface's aggregate COMMAND projector, so advertise it only when this
  // build can advertise both. Negotiation still intersects each key independently and the runtime requires
  // both, making a mixed build fail closed to the complete legacy replacement path.
  if (isCoopV2ReplacementEnabled() && isCoopV2TurnEnabled()) {
    caps.push(COOP_CAP_AUTHORITY_V2_REPLACEMENT);
  }
  if (isCoopV2WaveEnabled() && isCoopV2ReplacementEnabled() && isCoopV2TurnEnabled()) {
    caps.push(COOP_CAP_AUTHORITY_V2_WAVE);
  }
  const completeInteractionCoverage =
    durabilityEnabled
    && [
      COOP_CAP_OP_ABILITY,
      COOP_CAP_OP_BARGAIN,
      COOP_CAP_OP_BIOME,
      COOP_CAP_OP_CATCH_FULL,
      COOP_CAP_OP_COLOSSEUM,
      COOP_CAP_OP_LEARN_MOVE,
      COOP_CAP_OP_ME,
      COOP_CAP_OP_REVIVAL,
      COOP_CAP_OP_REWARD,
      COOP_CAP_OP_STORMGLASS,
    ].every(capability => caps.includes(capability));
  // Interaction cutover is one capability, never a collection of partially migrated screens. Do not even
  // advertise it unless this build has every registered complete-result surface plus its durability binding.
  if (
    completeInteractionCoverage
    && isCoopV2InteractionEnabled()
    && isCoopV2WaveEnabled()
    && isCoopV2ReplacementEnabled()
    && isCoopV2TurnEnabled()
  ) {
    caps.push(COOP_CAP_AUTHORITY_V2_INTERACTION);
  }
  if (
    completeInteractionCoverage
    && isCoopV2RecoveryEnabled()
    && isCoopV2InteractionEnabled()
    && isCoopV2WaveEnabled()
    && isCoopV2ReplacementEnabled()
    && isCoopV2TurnEnabled()
  ) {
    caps.push(COOP_CAP_AUTHORITY_V2_RECOVERY);
  }
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
  // Biome + ability + bargain + catch-full + colosseum + faint-switch + learn-move + revival + stormglass + reward are per-runtime
  // (layer-B): their fresh records come from
  // createCoopRuntimeOpState below, so the old reset-at-assembly call sites are removed (a fresh runtime's
  // records ARE the reset; calling reset here would touch the PREVIOUS runtime's record, not this one's).
  // Mystery-operation state is per-runtime: createCoopRuntimeOpState below constructs the new run's fresh
  // receipt ledger/cursors. Resetting here would mutate the previously active runtime during duo assembly.
  resetCoopActiveMysteryControl();
  // Wave state follows the same rule: createCoopRuntimeOpState owns its fresh wave record. An ambient reset
  // here would erase whichever peer the two-engine harness most recently installed, not the runtime below.
  pendingHostWaveTransitions.clear();
  settledHostWaveTransitions.clear();
  deferredHostWaveResolved.clear();
  pendingRawWavePresentations.clear();
  pendingSettledWaveBoundary = null;
  // #896 W2e-R2: a fresh assembly is a genuine RE-PAIR (new control plane), so drop any prior session's
  // negotiated capability set - the first hello of this session renegotiates it. A HOT rejoin does NOT
  // re-assemble (it pulls a snapshot in place), so this never clears a live negotiation on a flap.
  clearNegotiatedCoopCapabilities();
  const durabilityEnabled = isCoopDurabilityEnabled();
  // Epoch negotiation is delivered after controller assembly and may run while the other in-process client
  // is ambient. Capture this receiver's stable ledger in the callback rather than using the ambient selector.
  // It is assigned from controller.role below (not transport.role: P33 authority follows stable seats).
  let opState!: CoopRuntimeOpState;
  let waveOperationBinding: CoopWaveAdvanceOperationBinding;
  let runtime!: CoopRuntime;
  let authorityV2Epoch: number | null = null;
  const applyOperationEpoch = (epoch: number): void => {
    // An epoch advance is an explicit hard control-plane boundary (cold resume/new run), not a hot
    // connection rebind. The retained V2 log belongs to exactly one immutable epoch, so retire it before
    // the controller can renegotiate capabilities or accept a replacement P33 binding. A same-epoch hot
    // rejoin deliberately keeps the log and flows through rebindIdentity instead.
    if (authorityV2Epoch != null && authorityV2Epoch !== epoch) {
      disposeCoopV2Shadow(runtime);
      runtime.v2InstalledCommandTargets.clear();
      runtime.v2DeferredCommandStarts.clear();
      runtime.v2DeferredInteractionStarts.clear();
      runtime.v2InstalledInteractionTargets.clear();
      runtime.v2InteractionStateApplied.clear();
      runtime.v2SettledInteractionOperations.clear();
      runtime.v2ControlLedger.clear();
      runtime.v2RecoveryWaitSuccessorOperationId = null;
      runtime.v2ProjectedReplacementControlId = null;
      runtime.v2ProjectedInteractionControlId = null;
      runtime.v2WaveTransactions.clear();
      coopLog("v2-recovery", `hard epoch boundary ${authorityV2Epoch}->${epoch}; retired prior authoritative log`);
    }
    authorityV2Epoch = epoch;
    withActiveCoopRuntimeOpState(opState, () => applyCoopOperationEpoch(epoch, waveOperationBinding));
  };
  const installAuthorityV2 = (): void => {
    try {
      getCoopV2Shadow(runtime);
    } catch (error) {
      coopWarn("v2-shadow", "eager harness build on session lifecycle threw", error);
    }
  };
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
    // The callback runs after assembly, on handshake/rejoin. Its stable binding cannot drift to the other
    // in-process engine while the peer's transport is being pumped.
    onEpochNegotiated: applyOperationEpoch,
    // authority-v2: EAGERLY build the shadow harness (and the turn cutover, when authority.v2turn is
    // negotiated) the moment capabilities are frozen, so the turn-surface cutover is ACTIVE before the first
    // turn commit - otherwise a lazy first-tap build would leave wave-1 turns on legacy authority (a window
    // of dual authority the frozen cutover rule forbids). A pure no-op when neither v2 capability negotiated
    // (getCoopV2Shadow returns null); guarded so a build failure never unwinds the negotiation callback.
    onCapabilitiesNegotiated: installAuthorityV2,
    // Public P33 negotiation fires before its authenticated frame axes exist. Retry at the exact later edge
    // where p33MembershipSnapshot/p33FrameContext become usable, so the replica installs its inbound V2
    // receiver before the authority can publish the first retained entry.
    onAuthenticatedBindingReady: installAuthorityV2,
    onPartnerInteractionRecoveryExhausted: failure => {
      const point = readCoopBattlePoint();
      failCoopRuntimeSharedSession(
        runtime,
        `Partner interaction counter recovery exhausted at ${failure.need} `
          + `(peer ${failure.peerSeen}, ${failure.attempts} attempts).`,
        {
          boundary: "surface",
          reasonCode: "continuation-failed",
          wave: point.wave,
          turn: point.turn,
          boundaryRevision: failure.need,
        },
      );
    },
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
  const battleSync = new CoopBattleSync(transport, {
    isAuthorityWaitCreationFrozen: () => isCoopV2AuthorityWaitCreationFrozen(runtime),
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
    recoveryBinding: () => {
      if (controller.hasAuthenticatedPairing) {
        return controller.p33FrameContext();
      }
      const runId = controller.runId || `epoch-${controller.sessionEpoch}`;
      return {
        sessionId: `legacy-recovery:${runId}`,
        sessionEpoch: controller.sessionEpoch,
        seatMapId: `legacy-seat-map:${runId}`,
        membershipRevision: runtime?.membership?.snapshot().revision ?? 0,
        fromSeatId: controller.localSeatId,
        connectionGeneration: transport.connectionGeneration?.() ?? 0,
      };
    },
    validatePeerRecoveryBinding: binding => {
      if (controller.hasAuthenticatedPairing) {
        return controller.validateP33PeerFrameContext(binding, binding.membershipRevision);
      }
      const runId = controller.runId || `epoch-${controller.sessionEpoch}`;
      return (
        binding.sessionId === `legacy-recovery:${runId}`
        && binding.sessionEpoch === controller.sessionEpoch
        && binding.seatMapId === `legacy-seat-map:${runId}`
        && binding.membershipRevision === (runtime?.membership?.snapshot().revision ?? 0)
        && binding.fromSeatId !== controller.localSeatId
        && binding.connectionGeneration === (transport.connectionGeneration?.() ?? 0)
      );
    },
    onAuthorityTerminal: reason => failCoopSharedSession(reason),
    onRecoveryTerminal: reason => failCoopRuntimeSharedSession(runtime, reason),
  });
  // Showdown 1v1: the interaction relay disables its #829 seat-map forged-switch check in versus (the
  // guest legitimately relays faint-replacement picks for the host's enemy side). Live predicate so the
  // guest - whose kind flips "coop" -> "versus" only on runConfig receipt - is correct after adoption.
  const interactionRelay = new CoopInteractionRelay(transport, {
    isVersus: () => controller.isVersusSession(),
    resolveFieldSlotOwner: coopOwnerOfPlayerFieldSlot,
    isAuthorityWaitCreationFrozen: () => isCoopV2AuthorityWaitCreationFrozen(runtime),
    isInteractionAuthorityV2: () => runtime != null && isCoopV2InteractionCutoverActive(runtime.durability),
    isLocalAuthority: () => controller.authorityRole === "authority",
    validateV2QuizAnswerObservation: ({ seq, choice, questionIndex, operationId }) => {
      const control = runtime?.v2ControlLedger.activeControl;
      if (
        control?.kind !== "SHARED_INTERACTION"
        || control.surfaceClass !== "op:me"
        || control.operationKind !== "QUIZ_ANSWER"
        || control.ownerSeatId !== controller.authoritySeatId
        || !Number.isSafeInteger(choice)
        || choice < 0
        || choice >= 64
      ) {
        return false;
      }
      const presentation = parseCoopOperationId(control.operationId);
      if (
        presentation == null
        || presentation.kind !== "ME_PRESENT"
        || presentation.owner !== controller.authoritySeatId
      ) {
        return false;
      }
      const presentationSeq = Math.floor(presentation.pinnedSeq / 8000);
      const pinned = presentationSeq - COOP_ME_PUMP_SEQ_BASE;
      return isCoopMeQuizAnswerOperationId({
        operationId,
        epoch: controller.sessionEpoch,
        pinned,
        questionIndex,
        seq,
      });
    },
    publishRewardOptions: (seq, reroll, options, rewardSurface, projection) => {
      if (runtime == null || controller.authorityRole !== "authority") {
        return null;
      }
      const wave = globalScene.currentBattle?.waveIndex ?? -1;
      const turn = globalScene.currentBattle?.turn ?? -1;
      if (!Number.isSafeInteger(wave) || wave < 0 || !Number.isSafeInteger(turn) || turn < 0) {
        return null;
      }
      return (
        commitCoopRewardOptionsPresentation(
          {
            surface: reroll === COOP_BIOME_STOCK_REROLL ? "market" : "reward",
            pinned: seq,
            reroll,
            options,
            ...(projection == null
              ? {}
              : {
                  marketKind: projection.marketKind,
                  remainingStock: projection.remainingStock,
                }),
            ...(rewardSurface == null ? {} : { rewardSurface }),
            localRole: "host",
            wave,
            turn,
          },
          { opState: runtime.opState, durability: runtime.durability ?? null },
        )?.operationId ?? null
      );
    },
  });
  const uiMirror = new CoopUiMirror(transport);
  const mePump = new CoopMePump(interactionRelay);
  const rendezvous = new CoopRendezvous(transport, {
    getEpoch: () => controller.sessionEpoch,
    isAuthorityWaitCreationFrozen: () => isCoopV2AuthorityWaitCreationFrozen(runtime),
    onRecoveryExhausted: failure => {
      const [, waveValue, turnValue] = failure.point.split(":", 3);
      const wave = Number(waveValue);
      const turn = Number(turnValue);
      failCoopRuntimeSharedSession(
        runtime,
        `Rendezvous recovery exhausted at ${failure.point} after ${failure.attempts} attempts `
          + `(${failure.kind}${failure.displacedPoint == null ? "" : `, displaced ${failure.displacedPoint}`}).`,
        {
          boundary: "surface",
          reasonCode: "continuation-failed",
          ...(Number.isSafeInteger(wave) && wave >= 0 ? { wave } : {}),
          ...(Number.isSafeInteger(turn) && turn >= 0 ? { turn } : {}),
        },
      );
    },
  });
  const membership = new CoopMembershipController(() => controller.role);
  // Operation adapters stay engine-free. Install their one narrow DATA capture seam only when a real
  // co-op runtime is assembled, so every V2 interaction commit carries the complete immutable state.
  setCoopOperationAuthorityStateProvider(turn => captureCoopAuthoritativeBattleState(turn));
  opState = createCoopRuntimeOpState(controller.role);
  // W2b/W2e (§4/§5): the application-level durability engine, flag-gated. Wave-2e plugs the operation
  // envelope in via the journal bridge's extractKey/apply hooks, so a committed op is journaled + ACKed +
  // resendable end-to-end (no longer a passive scaffold). Its reconnect() is wired into the #805 rejoin
  // below and its journal depth/unacked feed the health line. Absent when the flag is OFF (legacy behavior).
  const operationDurabilityHooks = coopOperationDurabilityHooks({
    suppressLegacyAuthority: () => runtime != null && isCoopV2InteractionCutoverActive(runtime.durability),
  });
  const durability = durabilityEnabled
    ? new CoopDurabilityManager(transport, {
        ...operationDurabilityHooks,
        // Scope every durability-delivered op APPLY to THIS runtime's per-runtime op-state (layer-B). The
        // in-process harness loopback delivers a peer's envelope synchronously during another client's drain
        // (or between withClient swaps with none installed), so the ACTIVE op-state at apply time is NOT
        // reliably this receiver's - a migrated surface (bargain) would then write its cursor/aux onto the
        // sender's record (or fail-loud throw when nothing is installed), and the receiver's watcher-adopt
        // reads its own empty record and never converges. Installing the assembly-owned opState here lands
        // the apply on the receiver's own record. Production has one runtime, so this scope is a no-op there.
        apply: entry => {
          const receiverScene = runtimeSceneBindings.get(runtime);
          // The in-process engine harness owns distinct scenes, so a known destination scene mismatch is a
          // valid deferred boundary. Engine-free operation tests intentionally share one scene (or never
          // install a receiver scene); their stable runtime bindings remain safe and synchronous.
          if (receiverScene != null && receiverScene !== globalScene) {
            return "deferred";
          }
          return withActiveCoopRuntimeOpState(opState, () => operationDurabilityHooks.apply?.(entry));
        },
        sendFullSnapshot: (cls, headRevision, controlHighWater) =>
          sendCoopDurabilitySnapshot(runtime, cls, headRevision, controlHighWater),
        onRecoveryExhausted: failure =>
          failCoopRuntimeSharedSession(
            runtime,
            `Durable operation recovery exhausted for ${failure.cls} at ${failure.from} `
              + `(blocked ${failure.blockedSeq}, ${failure.attempts} attempts, ${failure.reason}).`,
          ),
      })
    : undefined;
  waveOperationBinding = Object.freeze({
    opState,
    durability: durability ?? null,
  });
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
    opState,
    waveOperationBinding,
    v2InstalledCommandTargets: new Set<string>(),
    v2DeferredCommandStarts: new Map(),
    v2DeferredInteractionStarts: new Map(),
    v2InstalledInteractionTargets: new Set<string>(),
    v2InteractionStateApplied: new Set<string>(),
    v2SettledInteractionOperations: new Set<string>(),
    v2ControlLedger: new CoopV2ControlLedger(),
    v2RecoveryWaitSuccessorOperationId: null,
    v2RecoveryPreparedControlId: null,
    v2ProjectedReplacementControlId: null,
    v2ProjectedInteractionControlId: null,
    v2WaveTransactions: new Map<number, CoopV2WaveLiveTransaction>(),
    v2CompletedWaveTransactions: new Map<number, CoopV2WaveLiveTransaction>(),
  };
  sharedTerminalStates.set(runtime, {
    frozen: false,
    finalized: false,
    reason: null,
  });
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
    // WAVE_ADVANCE owns a separate retained DATA + continuation transaction from the battle stream's
    // turn/replacement carrier. A no-shop tail (notably a successful wild flee) crosses BattleEnd and
    // NewBattle without constructing a reward phase, so its first executable continuation is the next
    // wave's real COMMAND surface reported through this chokepoint. Game-over similarly reports its real
    // TERMINAL surface here after the ME hook confirms the run ended. Re-address the one exact unresolved
    // wave transaction and let the existing verifier prove DATA-applied + active command/terminal address;
    // never infer a source wave from the mutable scene and never release an ambiguous retained set.
    if (
      (surface === "command" || surface === "terminal")
      && active === runtime
      && isCoopAuthoritativeGuest()
      && usesRetainedCoopWaveTransaction(runtime)
    ) {
      if (coopV2WaveCutovers.has(runtime)) {
        // V2 suppresses creation of the legacy wave journal, so consulting only that journal here made the
        // real GameOver and no-shop next-COMMAND hooks permanent no-ops after cutover: DATA applied, but the
        // ordered entry could never publish controlInstalled. Select exactly one unfinished V2 transaction
        // and retry it while this real public surface is current. The projector still proves the immutable
        // destination's phase, wave, owner/actor, active handler, and terminal id; an unrelated or ambiguous
        // surface remains deferred and sends no receipt.
        const candidates = [...runtime.v2WaveTransactions.values()].filter(
          transaction => transaction.dataApplied && !transaction.continuationReady,
        );
        if (candidates.length === 1) {
          const completed = coopV2ShadowHarnesses.get(runtime)?.retryPendingReplicaEntries() ?? 0;
          if (completed > 0) {
            coopLog("v2-wave", `real ${surface} surface completed ${completed} retained V2 entry`);
          }
        }
      } else {
        const retainedWave = getCoopPendingWaveContinuationBoundary(runtime.waveOperationBinding);
        if (retainedWave != null) {
          maybeMarkCoopWaveContinuationReady(retainedWave.wave, runtime.waveOperationBinding, runtime);
        }
      }
    }
    if (!isCoopV2InteractionCutoverActive(durability)) {
      durability?.retryDeferred("op:global");
    }
    publishPendingCoopSnapshotProof(runtime);
    return released;
  };
  // Per-runtime production sink: a journal-delivered biome op feeds this receiver's own relay. In a real
  // process there is one runtime; in the duo harness the final (guest) assembly intentionally owns the one
  // module-level sink, matching the sole receiver topology.
  for (const surfaceClass of COOP_V2_INTERACTION_SURFACES) {
    registerCoopOperationLiveSink(surfaceClass, envelope =>
      materializeCoopRegisteredInteractionFromOp(runtime, surfaceClass, envelope),
    );
  }
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
  wireCoopMeChecksumCheck(runtime, battleStream);
  wireCoopLiveEvents(controller, battleStream);
  wireCoopLearnMoveForward(interactionRelay);
  wireCoopLearnMoveBatchForward(interactionRelay);
  wireCoopDexSync(transport);
  wireShowdownResult(transport, runtime);
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
  interactionRelay.onRevivalPrompt = (fieldIndex, operationId) => {
    if (getCoopRuntime() !== runtime || runtime.controller.role === "host") {
      return;
    }
    try {
      const parsedOperation = operationId == null ? null : parseCoopOperationId(operationId);
      const ownerIsGuest = parsedOperation == null || parsedOperation.owner === runtime.controller.localSeatId;
      const current = globalScene.phaseManager.getCurrentPhase();
      if (
        operationId != null
        && current.is("CoopGuestRevivalPhase")
        && current.installCoopV2RevivalPresentation(operationId, fieldIndex, ownerIsGuest)
      ) {
        return;
      }
      const phase = globalScene.phaseManager.create("CoopGuestRevivalPhase", fieldIndex, operationId, ownerIsGuest);
      if (!globalScene.phaseManager.overridePhase(phase)) {
        failCoopSharedSession(`Revival Blessing surface for slot ${fieldIndex} could not override the guest wait`);
      }
    } catch (e) {
      coopWarn("replay", `revivalPrompt fieldIndex=${fieldIndex} could not install its exact surface (${e})`);
      failCoopSharedSession(`Revival Blessing surface for slot ${fieldIndex} could not be installed`);
    }
  };
  // #856: the host asked THIS client - the CATCHER - to drive the full-party keep/release picker for a
  // wild catch it threw. Queue the guest picker (the host awaits its relayed slot); the guest never runs
  // AttemptCapturePhase, so this is the only place the recipient's picker opens.
  interactionRelay.onCatchFullPrompt = (pokemonName, speciesId, operationId) => {
    if (getCoopRuntime() !== runtime || runtime.controller.role === "host") {
      return;
    }
    try {
      globalScene.phaseManager.unshiftNew("CoopGuestCatchFullPhase", pokemonName, speciesId, operationId);
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
  // The battleStream receiver is runtime-owned and was registered once during
  // assembly. Re-registering it on every harness context swap only overwrote the
  // same handler and flooded captured logs; only the role-gated process globals
  // need to follow the active synthetic browser.
  installCoopRuntimeGhostProcessHooks(runtime.controller, runtime.battleStream);
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
    // A prior terminal path may have already nulled the runtime before the ordinary title teardown arrives.
    // Cycle-free predicates are process-global, so clear them even on that idempotent second teardown; a
    // later solo run must never inherit Showdown side ownership or renderer gating from the dead session.
    setCoopAuthoritativeGuestPredicate(null);
    setShowdownGuestFlipPredicate(null);
    setShowdownSeatAuthorityResolver(null);
    // Capability negotiation belongs to the runtime/control plane, not the process. A full teardown
    // (unlike a hot rejoin, which never calls this function) must remove the frozen intersection even
    // when another terminal path already cleared the active runtime.
    clearNegotiatedCoopCapabilities();
    // Drop any registered shadow inbound handler even when the active runtime was already cleared.
    clearCoopV2ShadowInbound();
    try {
      globalScene?.phaseManager?.setCoopRecoveryProgressionFence?.(null);
    } catch {
      /* engine-free/pre-scene teardown */
    }
    return;
  }
  try {
    globalScene?.phaseManager?.setCoopRecoveryProgressionFence?.(null);
  } catch {
    /* engine-free/pre-scene teardown */
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
  // authority-v2 shadow: dispose the harness (log timers + lifecycle + owned scheduler) BEFORE the
  // transport closes, and drop the module-level inbound routing handler so no v2 frame reaches a torn-down
  // harness. Zero leaked timers is the harness's own invariant (its dispose cancels every armed timer).
  disposeCoopV2Shadow(active);
  clearCoopV2ShadowInbound();
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
  // Wave-2f: same teardown for the post-battle wave-advance operation surface (THE KEYSTONE).
  resetCoopWaveAdvanceOperationState(active.waveOperationBinding);
  pendingAutomaticVictorySeals.delete(active);
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
  deferredHostWaveResolved.clear();
  pendingRawWavePresentations.clear();
  pendingSettledWaveBoundary = null;
  // Reset the ME battle handoff counter so a subsequent run starts clean (#633).
  coopMeBattleInteractionCounter = -1;
  // Clear the cycle-free authoritative-guest predicate so a subsequent solo / lockstep run reads false.
  setCoopAuthoritativeGuestPredicate(null);
  setShowdownGuestFlipPredicate(null);
  setShowdownSeatAuthorityResolver(null);
  // #record-replay: stop + drop the captured trace at run teardown so the next run records fresh.
  clearReplayRecording();
  // Layer-B: drop the active per-runtime op-state so a post-teardown migrated-surface access fails LOUD
  // (never silently falls back to a stale/global cursor).
  setActiveCoopRuntimeOpState(null);
  active = null;
  // Clear only after the old runtime and transport are fully disposed: close handlers still execute during
  // teardown and must observe the session's frozen capability set, not pre-handshake local-flag semantics.
  // Without this reset, the next solo/pre-handshake surface can inherit the departed peer's capability mask.
  clearNegotiatedCoopCapabilities();
}

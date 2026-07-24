/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { globalScene } from "#app/global-scene";
import { Phase } from "#app/phase";
import { terminateCoopAuthoritySession } from "#data/elite-redux/coop/coop-authority-terminal";
import { captureCoopAuthoritativeCarrier } from "#data/elite-redux/coop/coop-battle-engine";
import { coopWarn } from "#data/elite-redux/coop/coop-debug";
import {
  captureCoopDeferredWaveOutcomeForTurnCommit,
  coopSessionGeneration,
  failCoopSharedSession,
  flushCoopWaveResolvedAfterTurnCommit,
  getCoopRuntime,
  isAuthoritativeBattleSession,
} from "#data/elite-redux/coop/coop-runtime";
import { endCoopRecording } from "#data/elite-redux/coop/coop-turn-recorder";
import { StatusEffect } from "#enums/status-effect";

/**
 * Phases that materially mutate the authoritative battle snapshot and therefore may not
 * remain queued behind the immutable per-turn commit. TurnEndPhase queues this sentinel
 * as its last child; normally every earlier child (including children spawned by those
 * children) has drained before this phase starts. This list is a fail-closed tripwire for
 * a future phase that incorrectly defers material work outside that settled subtree.
 */
const UNSETTLED_TURN_MUTATORS = new Set([
  "FormChangePhase",
  "ObtainStatusEffectPhase",
  "PokemonHealPhase",
  "PostTurnStatusEffectPhase",
  "QuietFormChangePhase",
  "StatStageChangePhase",
]);

function unsettledTurnReason(): string | null {
  const pendingStatus = [...globalScene.getPlayerParty(), ...globalScene.getEnemyParty()].find(
    pokemon => pokemon.turnData.pendingStatus != null && pokemon.turnData.pendingStatus !== StatusEffect.NONE,
  );
  if (pendingStatus != null) {
    return `pokemon ${pendingStatus.id} still has pendingStatus=${pendingStatus.turnData.pendingStatus}`;
  }
  const queuedMutator = globalScene.phaseManager
    .getQueuedPhaseNames()
    .find(phaseName => UNSETTLED_TURN_MUTATORS.has(phaseName));
  return queuedMutator == null ? null : `material mutator ${queuedMutator} remains queued after TurnEnd`;
}

/**
 * Authoritative host commit boundary for one fully-settled turn.
 *
 * TurnEndPhase itself only *queues* several delayed mutations (Yawn sleep, orb status,
 * Leftovers/terrain healing, post-turn abilities and form changes). Capturing from inside
 * TurnEndPhase published a stale checkpoint before those phases ran. This sentinel is
 * queued last in TurnEndPhase's FIFO child level, so its recording, carrier and checksum
 * include every mutation spawned by TurnEnd before the immutable turnResolution is sent.
 */
export class CoopTurnCommitPhase extends Phase {
  public readonly phaseName = "CoopTurnCommitPhase";

  public override start(): void {
    super.start();
    const recording = endCoopRecording();
    const runtime = getCoopRuntime();
    const sharedMode = (globalScene.gameMode?.isCoop ?? false) || (globalScene.gameMode?.isShowdown ?? false);
    if (runtime == null) {
      if (sharedMode && recording.turn >= 0) {
        failCoopSharedSession(`Shared battle authority disappeared before turn ${recording.turn} could be committed.`, {
          boundary: "authority",
          reasonCode: "capture-failed",
          wave: globalScene.currentBattle?.waveIndex ?? 0,
          turn: recording.turn,
        });
        return;
      }
      this.end();
      return;
    }
    const controller = runtime.controller;
    if (controller.role !== "host" || !isAuthoritativeBattleSession()) {
      // Guests consume the host's retained entry; solo/legacy sessions do not author V2 turn commits.
      this.end();
      return;
    }
    const streamer = runtime.battleStream;
    const wave = globalScene.currentBattle?.waveIndex ?? 0;
    const turn = recording.turn >= 0 ? recording.turn : (globalScene.currentBattle?.turn ?? 0);
    const fatal = (reason: string, boundaryTurn = turn): void => {
      const generation = coopSessionGeneration();
      void streamer
        .broadcastAuthorityFailure({
          epoch: controller.sessionEpoch,
          wave,
          turn: boundaryTurn,
          boundary: "turnResolution",
          reason,
        })
        .then(() => {
          if (generation === coopSessionGeneration() && getCoopRuntime() === runtime) {
            terminateCoopAuthoritySession(reason);
          }
        });
    };
    if (recording.turn < 0) {
      const reason = `Host lost the authoritative turn recording at the commit boundary for wave ${wave}, turn ${turn}.`;
      coopWarn("checkpoint", reason);
      fatal(reason);
      return;
    }
    try {
      const unsettled = unsettledTurnReason();
      if (unsettled != null) {
        coopWarn("checkpoint", `host refused unsettled turnResolution turn=${recording.turn}: ${unsettled}`);
        fatal(`Host reached an unsettled turn commit for wave ${wave}, turn ${recording.turn}: ${unsettled}.`);
        return;
      }
      const carrier = captureCoopAuthoritativeCarrier(recording.turn, "turnResolution");
      if (carrier == null) {
        coopWarn("checkpoint", `host could not capture complete turnResolution turn=${recording.turn}`);
        fatal(`Host could not capture complete turn authority for wave ${wave}, turn ${recording.turn}.`);
        return;
      }
      const deferredWaveOutcome = captureCoopDeferredWaveOutcomeForTurnCommit(carrier.authoritativeState.wave);
      const retained = streamer.emitTurn(
        controller.sessionEpoch,
        carrier.authoritativeState.wave,
        recording.turn,
        recording.events,
        carrier.checkpoint,
        carrier.checksum,
        carrier.preimage,
        carrier.fullField,
        carrier.authoritativeState,
        {
          mysteryBattle: globalScene.currentBattle?.isBattleMysteryEncounter() === true,
          ...(deferredWaveOutcome == null ? {} : { deferredWaveOutcome }),
        },
      );
      if (!retained) {
        fatal(`Host could not retain complete turn authority for wave ${wave}, turn ${recording.turn}.`);
        return;
      }
      if (!flushCoopWaveResolvedAfterTurnCommit(carrier.authoritativeState.wave)) {
        return;
      }
    } catch (error) {
      coopWarn("checkpoint", `host failed to emit turnResolution turn=${recording.turn}`, error);
      fatal(`Host could not publish complete turn authority for wave ${wave}, turn ${recording.turn}.`);
      return;
    }
    this.end();
  }
}

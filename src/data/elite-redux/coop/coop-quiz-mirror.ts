/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Co-op QUIZ MIRRORING (#818) - the leaf glue that makes the 8 ErQuizPhase mini-game
// mystery encounters (Tracks in the Snow, Guessing Booth, Scrambled Pokedex, Sealed
// Door, Salvage Yard, Lake Spirit, Frozen Shapes, Dormant Guardian) show the SAME quiz
// on BOTH screens while only the ME OWNER answers.
//
// Mechanism: the run is host-authoritative (the HOST is the sole encounter engine), so
// the host STREAMS the whole question session down the ME `mePresent` sub-prompt channel
// (the exact same seq + sender the party / secondary sub-prompts already use). BOTH clients
// then run their own `ErQuizPhase` off that identical data. The ME OWNER's client is the
// "drive" side: each answer it commits relays out as a bare integer. The other client is the
// "follow" side: it feeds the relayed integer into its OWN `onAnswer`, so the follower never
// takes local input yet lands the identical result.
//
// A LEAF module by design: it may reach the co-op runtime getters, the ME pin state, the
// relay, and the debug log (all lower layers), and it reads `globalScene` for the isCoop flag
// exactly like the other co-op leaf modules (coop-runtime etc.). It MUST NOT import a phase or
// any UI - the ErQuizPhase hooks call INTO this module, never the reverse, so solo play (where
// every function short-circuits on a null side) is byte-identical.
// =============================================================================

import { globalScene } from "#app/global-scene";
import { isCoopV2InteractionCutoverActive } from "#data/elite-redux/coop/authority-v2/cutover-interaction";
import { coopLog, coopWarn } from "#data/elite-redux/coop/coop-debug";
import {
  commitMeOwnerIntent,
  isCoopMeOperationEnabled,
  nextCoopMePresentationStep,
} from "#data/elite-redux/coop/coop-me-operation";
import {
  coopMeHandoffBattleStarted,
  coopMeInProgress,
  coopMeInteractionStartValue,
  setCoopMeActivePresentation,
} from "#data/elite-redux/coop/coop-me-pin-state";
import { isCoopOperationJournalActive } from "#data/elite-redux/coop/coop-operation-journal";
import {
  coopSessionGeneration,
  failCoopSharedSession,
  getCoopController,
  getCoopInteractionRelay,
  getCoopRuntime,
} from "#data/elite-redux/coop/coop-runtime";
// #840: ME pump base + quiz base declared in coop-seq-registry (single source of truth). The pump
// base was previously re-declared locally in 4 files; all now import the one canonical value.
import {
  COOP_ME_PUMP_SEQ_BASE,
  COOP_ME_QUIZ_SEQ_BASE,
  COOP_QUIZ_CHOICE_KINDS,
  coopQuizAnswerSeq,
} from "#data/elite-redux/coop/coop-seq-registry";
import type { CoopInteractionOutcome, CoopQuizWireQuestion } from "#data/elite-redux/coop/coop-transport";

export { COOP_ME_QUIZ_SEQ_BASE, coopQuizAnswerSeq };

/**
 * Same ME sub-prompt seq base the pump / party / secondary relays key off
 * (`seq_me = BASE + coopMeInteractionStart`). Imported from the seq registry (#840). The host
 * streams the quiz SESSION on this exact channel so the guest's CoopReplayMePhase reads it right
 * where it already reads the party / secondary prompts.
 */

/**
 * Disconnect ceiling for the follower's wait on the owner's relayed answer (mirrors
 * `CoopReplayMePhase` / the interaction relay default). NOT a deliberation timer: the steady
 * state resolves the instant the owner answers; this only fires for a genuinely disconnected
 * partner (the follower then feeds a -1 sentinel into onAnswer = forfeit, never a hang).
 */
const COOP_QUIZ_WAIT_MS = 1_200_000;

/**
 * #818: base seq for the owner->follower per-QUESTION answer relay. Deliberately its OWN band
 * (8_500_000), disjoint from the 8_000_000 ME pump / present channel and below the 9_000_000
 * terminal seq family, so a quiz answer can never FIFO-collide with the session stream, the
 * party / secondary sub-picks, or the ME terminal.
 */

/**
 * Which side of a mirrored quiz THIS client is on:
 *  - "drive"  == this client OWNS the ME (its human answers; each answer relays out).
 *  - "follow" == the partner owns the ME (this client renders read-only, feeding relayed answers).
 *  - null     == not a mirrored quiz at all (solo, no live co-op ME, or the ME has handed off to a
 *                spawned battle) -> every hook below no-ops, so solo play is byte-identical.
 */
export type CoopQuizSide = "drive" | "follow" | null;

/**
 * Resolve the mirrored-quiz side for the CURRENT moment. Null (no mirroring) unless we are in a live
 * co-op run, a co-op ME is in progress, that ME has NOT yet handed off to a spawned battle, and a
 * controller exists. When mirroring is live, the ME OWNER (the local client owns the pinned
 * interaction counter) drives; the partner follows.
 */
export function coopQuizSide(): CoopQuizSide {
  const controller = getCoopController();
  if (!globalScene.gameMode?.isCoop || !coopMeInProgress() || coopMeHandoffBattleStarted() || controller == null) {
    return null;
  }
  return controller.isLocalOwnerAtCounter(coopMeInteractionStartValue()) ? "drive" : "follow";
}

/**
 * DRIVE side: relay the owner's answer to question `index` (a bare choice integer) to the follower.
 * No-op on the follow / null side. Keyed on the ME's pinned interaction counter so both clients agree
 * on the seq without any extra handshake.
 */
export function coopQuizPublishAnswer(index: number, choice: number): void {
  if (coopQuizSide() !== "drive") {
    return;
  }
  const counter = coopMeInteractionStartValue();
  const seq = coopQuizAnswerSeq(counter, index);
  coopLog("me", `quiz DRIVE publish answer index=${index} choice=${choice} seq=${seq} counter=${counter} (#818)`);
  // Wave-2c: DUAL-RUN - mint the typed QUIZ_ANSWER op (the ME owner's committed answer). The per-question
  // seq + index keep every answer a DISTINCT operationId (order-proof, #818). No-op when the flag is OFF;
  // the legacy quizAns relay above is the fallback and stays live either way. Never throws.
  const relay = getCoopInteractionRelay();
  const localRole = getCoopController()?.role ?? "guest";
  const operationId = commitMeOwnerIntent({
    kind: "QUIZ_ANSWER",
    seq,
    pinned: counter,
    step: index,
    payload: { questionIndex: index, choice },
    localRole,
    wave: globalScene?.currentBattle?.waveIndex ?? -1,
    turn: 0,
    resend:
      localRole === "guest" && relay != null ? () => relay.sendInteractionChoice(seq, "quizAns", choice) : undefined,
  });
  if (operationId == null && isCoopMeOperationEnabled()) {
    failCoopSharedSession(`Quiz answer ${index} could not enter authoritative control`);
    return;
  }
  const v2Cutover = isCoopV2InteractionCutoverActive(getCoopRuntime()?.durability ?? null);
  if (localRole === "host" && v2Cutover) {
    if (operationId == null || relay?.sendV2QuizAnswerObservation(seq, choice, index, operationId) !== true) {
      failCoopSharedSession(`Quiz answer ${index} could not reach the exact V2 presentation watcher`);
    }
    return;
  }
  // Guest-owned answers are proposals and must reach the host. Host-owned answers are journal-led;
  // do not let a raw frame outrun the committed envelope on the follower.
  if (localRole === "guest" || !isCoopMeOperationEnabled() || !isCoopOperationJournalActive()) {
    relay?.sendInteractionChoice(seq, "quizAns", choice);
  }
}

/**
 * FOLLOW side: arm a wait for the owner's relayed answer to question `index`, resolving to the chosen
 * integer (or -1 on a disconnect / null-timeout, which onAnswer treats as a forfeit). Returns null on
 * the drive / null side (the caller then takes local input as usual). The caller owns the double-fire
 * guard - a stale resolution must never answer a later question.
 */
export function coopQuizAwaitRemoteAnswer(index: number): Promise<number> | null {
  if (coopQuizSide() !== "follow") {
    return null;
  }
  const relay = getCoopInteractionRelay();
  if (relay == null) {
    return null;
  }
  const counter = coopMeInteractionStartValue();
  const seq = coopQuizAnswerSeq(counter, index);
  const scene = globalScene;
  const runtime = getCoopRuntime();
  const controller = getCoopController();
  const generation = coopSessionGeneration();
  coopLog("me", `quiz FOLLOW arm remote-answer wait index=${index} seq=${seq} counter=${counter} (#818)`);
  return relay.awaitInteractionChoice(seq, COOP_QUIZ_WAIT_MS, COOP_QUIZ_CHOICE_KINDS).then(a => {
    if (
      globalScene !== scene
      || getCoopRuntime() !== runtime
      || getCoopController() !== controller
      || coopSessionGeneration() !== generation
      || coopMeInteractionStartValue() !== counter
    ) {
      return new Promise<number>(() => undefined);
    }
    if (a == null || !Number.isSafeInteger(a.choice) || a.choice < 0) {
      coopWarn("me", `quiz FOLLOW missing/malformed answer index=${index}; retaining shared boundary`);
      getCoopRuntime()?.durability?.reconnect();
      failCoopSharedSession(`Quiz answer ${index} unavailable after bounded wait`);
      return new Promise<number>(() => undefined);
    }
    const choice = a.choice;
    if (getCoopController()?.role === "host") {
      const operationId = commitMeOwnerIntent({
        kind: "QUIZ_ANSWER",
        seq,
        pinned: counter,
        step: index,
        payload: { questionIndex: index, choice },
        localRole: "host",
        wave: globalScene.currentBattle?.waveIndex ?? -1,
        turn: 0,
      });
      if (operationId == null && isCoopMeOperationEnabled()) {
        failCoopSharedSession(`Quiz answer ${index} proposal could not commit`);
        return new Promise<number>(() => undefined);
      }
    } else if (isCoopOperationJournalActive() && a.operationId == null) {
      // A guest follower accepts only the journal materializer's causally tagged answer.
      getCoopRuntime()?.durability?.reconnect();
      failCoopSharedSession(`Quiz answer ${index} arrived without committed operation identity`);
      return new Promise<number>(() => undefined);
    }
    coopLog("me", `quiz FOLLOW remote-answer resolved index=${index} choice=${choice} seq=${seq} (#818)`);
    return choice;
  });
}

/**
 * HOST (sole engine): stream the whole quiz SESSION to the guest so BOTH clients run ErQuizPhase off
 * the identical questions. A no-op unless this client is the HOST role AND a mirrored quiz is live
 * (coopQuizSide() != null) - so it is safe for ErQuizPhase.start() to call unconditionally. Reuses the
 * EXACT sender the party / secondary sub-prompts use: a `mePresent` interactionOutcome on the ME pump
 * seq, carrying the session as a {kind:"quiz"} subPrompt.
 */
export function coopQuizHostStreamSession(questions: readonly unknown[], stopOnWrong: boolean): void {
  const controller = getCoopController();
  if (controller?.role !== "host" || coopQuizSide() === null) {
    return;
  }
  const seq = COOP_ME_PUMP_SEQ_BASE + coopMeInteractionStartValue();
  // The caller (ErQuizPhase) passes ErQuizQuestion[], which is structurally a CoopQuizWireQuestion[]
  // (kind is a subtype of string, every other field matches). The param is typed `unknown[]` only so
  // this leaf never imports the quiz engine; the assertion is the wire-boundary narrowing.
  const wireQuestions = questions as CoopQuizWireQuestion[];
  const outcome: CoopInteractionOutcome = {
    k: "mePresent",
    tokens: {},
    meetsReqs: [],
    labels: [],
    subPrompt: { kind: "quiz", questions: wireQuestions, stopOnWrong },
  };
  coopLog("me", `quiz HOST stream session count=${wireQuestions.length} stopOnWrong=${stopOnWrong} seq=${seq} (#818)`);
  const pinned = coopMeInteractionStartValue();
  const operationId = commitMeOwnerIntent({
    kind: "ME_PRESENT",
    seq,
    pinned,
    step: nextCoopMePresentationStep(pinned),
    payload: { present: true, presentation: outcome },
    localRole: getCoopController()?.role ?? "host",
    wave: globalScene.currentBattle?.waveIndex ?? -1,
    turn: 0,
  });
  if (operationId == null && isCoopMeOperationEnabled()) {
    failCoopSharedSession("Quiz presentation could not enter authoritative control");
    return;
  }
  // The committed envelope is the presentation carrier while durability is active. Legacy raw delivery
  // remains only for a negotiated fallback or a non-journal operation session, and always follows commit.
  if (isCoopMeOperationEnabled() && isCoopOperationJournalActive()) {
    setCoopMeActivePresentation(outcome);
  } else {
    getCoopInteractionRelay()?.sendInteractionOutcome(seq, "mePresent", outcome);
  }
}

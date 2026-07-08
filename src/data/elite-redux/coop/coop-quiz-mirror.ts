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
import { coopLog } from "#data/elite-redux/coop/coop-debug";
import {
  coopMeHandoffBattleStarted,
  coopMeInProgress,
  coopMeInteractionStartValue,
} from "#data/elite-redux/coop/coop-me-pin-state";
import { getCoopController, getCoopInteractionRelay } from "#data/elite-redux/coop/coop-runtime";
// #840: ME pump base + quiz base declared in coop-seq-registry (single source of truth). The pump
// base was previously re-declared locally in 4 files; all now import the one canonical value.
import {
  COOP_ME_PUMP_SEQ_BASE,
  COOP_ME_QUIZ_SEQ_BASE,
  COOP_QUIZ_CHOICE_KINDS,
} from "#data/elite-redux/coop/coop-seq-registry";
import type { CoopInteractionOutcome, CoopQuizWireQuestion } from "#data/elite-redux/coop/coop-transport";

export { COOP_ME_QUIZ_SEQ_BASE };

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
 * The relay seq for the answer to question `index` of the ME pinned on `counter`. PER-QUESTION
 * seqs (not one shared seq) make answer delivery ORDER-PROOF and collision-free: a stale answer for
 * an earlier question can never be mistaken for the current one, and each question's answer sits on
 * its own key. `counter % 2048` and `index % 16` bound the whole band well below the 9_000_000
 * terminal seq family (max offset 2048 * 16 = 32_768 -> 8_532_768 < 9_000_000).
 */
export function coopQuizAnswerSeq(counter: number, index: number): number {
  return COOP_ME_QUIZ_SEQ_BASE + (counter % 2048) * 16 + (index % 16);
}

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
  getCoopInteractionRelay()?.sendInteractionChoice(seq, "quizAns", choice);
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
  coopLog("me", `quiz FOLLOW arm remote-answer wait index=${index} seq=${seq} counter=${counter} (#818)`);
  return relay.awaitInteractionChoice(seq, COOP_QUIZ_WAIT_MS, COOP_QUIZ_CHOICE_KINDS).then(a => {
    const choice = a?.choice ?? -1;
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
  getCoopInteractionRelay()?.sendInteractionOutcome(seq, "mePresent", outcome);
}

/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Co-op COLOSSEUM between-rounds board relay (#829).
//
// The Colosseum (#439) is a multi-battle press-your-luck gauntlet mystery
// encounter: after each won round a CONTINUE / CASH-OUT board opens
// (`ColosseumChoicePhase`, `UiMode.COLOSSEUM`), and on CONTINUE the next round's
// battle starts. Each round's battle is a host-authoritative ME-battle handoff
// (`initBattleWithEnemyConfig` -> `coopHostStreamMeBattleParty` +
// `coopMeOwnerRelayBattleHandoff`), so between rounds the GUEST is a pure
// renderer that has already left `CoopReplayMePhase` (via `finishWithoutLeaving`).
//
// This module is the (ENGINE-FREE) wire protocol for the board decision, so the
// relay logic stays unit-testable headlessly over a `LoopbackTransport` exactly
// like every other co-op relay (`coop-me-pump`, the bespoke yes/no sub-prompt).
// It carries the board on a DEDICATED seq band (7_600_000 + pinned ME counter),
// disjoint from the ME pump (8M), ME terminal (9M), biome shop (7M), and bargain
// (7.5M) bands, so a board present / decision can never FIFO-collide with the
// per-round battle handoff (which rides the 8M/9M ME channels).
//
// #829 PART 2 (the GUEST between-rounds loop): it ALSO carries the guest-side driver
// (`runColosseumGuestRoundLoop` + the `CoopMeBattleEndDelegate` it registers). The
// wire helpers above stay engine-free; the driver is the engine-coupled half kept
// HERE (not in `coop-replay-me-phase`) so that phase never learns about the Colosseum -
// it consults a generic delegate, and this module self-gates it on the colosseum ME
// type. The driver's engine touches (adopt boss / boot battle / capture UI / leave)
// go through an injectable `CoopColosseumRoundOps` so its ROUND STATE MACHINE is
// unit-testable over a real relay pair with fakes, in the same headless style.
//
// OWNERSHIP: the whole gauntlet is ONE co-op interaction (one pinned counter), so
// the board OWNER = the ME owner (`isLocalOwnerAtCounter(coopMeInteractionStart)`),
// stable across every round. Host-owned: the host drives its real board and the
// guest WATCHES the streamed decision. Guest-owned: the guest DRIVES its board and
// relays the picked index; the host adopts it programmatically. Both directions
// ride the SAME `coopColosseumSeq` (host->guest present + host-owned decision, or
// guest->host owned decision), so a single seq is the whole board channel.
//
// SCOPE NOTE (#829): the HOST half lives here + in `ColosseumChoicePhase` (both in
// scope). The GUEST half - re-entering a board wait after each intermediate round
// and adopting the next round's battle - has no live execution surface within this
// module's scope: after round 1 the guest's ONLY post-round code is the detached
// terminal listener inside `CoopReplayMePhase.finishWithoutLeaving` (a file this
// change may not edit). Wiring the guest loop requires a small generic seam in
// that phase (see the report / `docs`), which then calls into the awaiters here.
// This module ships the tested wire protocol + the host senders so that seam is
// tiny; the awaiters (`coopColosseumAwaitDecision`) + ownership resolver are the
// exact primitives that seam consumes.
// =============================================================================

import { globalScene } from "#app/global-scene";
import {
  armCoopColosseumDecisionResend,
  type CoopColosseumOperationBinding,
  captureCoopColosseumOperationBinding,
  commitColosseumBoard,
  commitColosseumDecision,
  isCoopColosseumOperationEnabled,
} from "#data/elite-redux/coop/coop-colosseum-operation";
import { coopLog, coopWarn } from "#data/elite-redux/coop/coop-debug";
import { adoptCoopEnemiesStructural } from "#data/elite-redux/coop/coop-enemy-builder";
import { COOP_INTERACTION_LEAVE } from "#data/elite-redux/coop/coop-interaction-relay";
import { meBattleHandoffKey } from "#data/elite-redux/coop/coop-me-battle-handoff";
import { adoptMeWatcherChoice, isCoopMeOperationEnabled } from "#data/elite-redux/coop/coop-me-operation";
import {
  coopMeInProgress,
  coopMeInteractionStartValue,
  setCoopMeActivePresentation,
  setCoopMeColosseumControl,
} from "#data/elite-redux/coop/coop-me-pin-state";
import {
  isCoopOperationJournalActive,
  isCoopOperationJournalActiveFor,
} from "#data/elite-redux/coop/coop-operation-journal";
import {
  coopSessionGeneration,
  failCoopSharedSession,
  getCoopBattleStreamer,
  getCoopController,
  getCoopInteractionRelay,
  getCoopNetcodeMode,
  getCoopRuntime,
  isCoopAuthoritativeGuest,
} from "#data/elite-redux/coop/coop-runtime";
import {
  COOP_COLO_CHOICE_KINDS,
  COOP_COLOSSEUM_SEQ_BASE,
  COOP_ME_TERM_SEQ_BASE,
  COOP_ME_TERMINAL_CHOICE_KINDS,
} from "#data/elite-redux/coop/coop-seq-registry";
import type {
  CoopActiveMysteryEncounterSnapshotV1,
  CoopInteractionOutcome,
  CoopSerializedEnemy,
} from "#data/elite-redux/coop/coop-transport";
import { MysteryEncounterMode } from "#enums/mystery-encounter-mode";
import { MysteryEncounterType } from "#enums/mystery-encounter-type";
import { UiMode } from "#enums/ui-mode";
import { leaveEncounterWithoutBattle } from "#mystery-encounters/encounter-phase-utils";
import type { CoopMeBattleEndDelegate } from "#phases/coop-replay-me-phase";
import { setCoopMeBattleEndDelegate, setCoopMeSnapshotRebindDelegate } from "#phases/coop-replay-me-phase";
import { COLOSSEUM_CASH_OUT, COLOSSEUM_CONTINUE } from "#ui/colosseum-ui-handler";
import { hideCoopControllerTag, showCoopControllerTagFor } from "#ui/coop-controller-tag";
import type { OptionSelectConfig } from "#ui/handlers/abstract-option-select-ui-handler";
import i18next from "i18next";

/**
 * #829: DEDICATED seq band for the Colosseum board decision, keyed by the pinned ME
 * interaction counter. Sits in the free gap between the bargain band (7.5M + counter)
 * and the ME pump band (8M + counter); the ME interaction counter is small (< thousands)
 * so `7_600_000 + counter` can never reach either neighbour. Disjoint from every other
 * relay band (6M ability, 7M biome, 7.5M bargain, 8M ME pump, 9M ME term, 9.1M learn,
 * 9.2M dex), so a board present / decision never cross-consumes another channel.
 */
// #840: COOP_COLOSSEUM_SEQ_BASE declared in coop-seq-registry (single source of truth), re-exported here.
export { COOP_COLOSSEUM_SEQ_BASE };

/** #829: routing tag for the host's streamed board present (outcome inbox). */
const COOP_COLOSSEUM_BOARD_KIND = "coloBoard";
/** #829: routing tag for the owner's relayed board decision index (choice inbox). */
const COOP_COLOSSEUM_PICK_KIND = "coloPick";
const COOP_COLOSSEUM_ROUND_TOKEN = "coopColosseumRound";
const activeBoardRoundByPin = new Map<number, number>();

/**
 * #829: the board seq for the pinned ME interaction counter. Both clients derive it from the
 * SAME pinned counter (`coopMeInteractionStartValue`, stable for the whole gauntlet), so they
 * agree on the channel with zero extra handshake. `Math.max(0, ...)` guards the not-in-ME (-1)
 * read so a stray call can never land on a negative / colliding seq.
 */
export function coopColosseumSeq(pinnedCounter: number): number {
  return COOP_COLOSSEUM_SEQ_BASE + Math.max(0, pinnedCounter);
}

/**
 * #829: whether a live authoritative co-op session is mid mystery-encounter (the board only ever
 * exists inside the Colosseum ME). `getCoopNetcodeMode() === "authoritative"` is true only for a
 * live session; solo / lockstep return "lockstep" so every sender below is a hard no-op there and
 * solo play is byte-identical.
 */
function coopColosseumActiveInMe(): boolean {
  return getCoopNetcodeMode() === "authoritative" && coopMeInProgress();
}

/**
 * #829: does the LOCAL client OWN the Colosseum board decision? The whole gauntlet is one pinned
 * interaction, so board ownership == ME ownership (the pinned-counter parity rule). Host-owned:
 * the host drives its real board. Guest-owned: the guest drives + relays; the host adopts. Returns
 * false with no controller (solo / not in a session).
 */
export function coopColosseumBoardOwnedLocally(): boolean {
  const controller = getCoopController();
  if (controller == null) {
    return false;
  }
  return controller.isLocalOwnerAtCounter(coopMeInteractionStartValue());
}

/**
 * #829 HOST: stream the board's two decision LABELS (CONTINUE ... / CASH OUT ...) as a
 * `{ kind: "secondary", labels }` sub-prompt on the board seq - REUSING the frozen `mePresent`
 * wire shape (no new transport union member), exactly like the bespoke yes/no relay
 * (`coopHostStreamSecondaryAwaitIndex`). FIRE-AND-FORGET (no await), so it can never freeze the
 * host regardless of whether the guest is currently able to render it. Hard no-op off the live
 * authoritative host / outside an ME, so solo / lockstep / guest are byte-identical. The guest's
 * between-rounds board wait (the deferred seam, see the header) reads these labels off the board
 * seq's OUTCOME inbox and opens a real local OPTION_SELECT capture (the proven template).
 */
export function coopColosseumStreamBoard(labels: string[], roundOverride?: number): boolean {
  if (!coopColosseumActiveInMe() || getCoopController()?.role !== "host") {
    return true;
  }
  const operationEnabled = isCoopColosseumOperationEnabled();
  const operationBinding = operationEnabled ? captureCoopColosseumOperationBinding("host") : null;
  const pinned = coopMeInteractionStartValue();
  const seq = coopColosseumSeq(pinned);
  const controller = getCoopController();
  const committed =
    controller == null
      ? null
      : commitColosseumBoard(
          {
            pinned,
            round: roundOverride,
            labels,
            localRole: controller.role,
            wave: globalScene?.currentBattle?.waveIndex ?? 0,
            turn: globalScene?.currentBattle?.turn ?? 0,
          },
          operationBinding,
        );
  if (committed == null || (operationEnabled && committed.operationId == null)) {
    failCoopSharedSession(`Colosseum board ${seq} could not enter authoritative control`);
    return false;
  }
  activeBoardRoundByPin.set(pinned, committed.round);
  if (!setCoopMeColosseumControl(pinned, { expectedRound: committed.round, boardRound: committed.round })) {
    failCoopSharedSession(`Colosseum board ${seq}/${committed.round} could not retain recovery control`);
    return false;
  }
  const present: CoopInteractionOutcome = {
    k: "mePresent",
    tokens: { [COOP_COLOSSEUM_ROUND_TOKEN]: String(committed.round) },
    meetsReqs: [],
    labels: [],
    subPrompt: { kind: "secondary", labels },
  };
  coopLog("me", "colosseum: host streams board present (#829)", { seq, labels: labels.length });
  if (operationEnabled && isCoopOperationJournalActiveFor(operationBinding?.durability ?? null)) {
    setCoopMeActivePresentation(present, true);
  } else {
    getCoopInteractionRelay()?.sendInteractionOutcome(seq, COOP_COLOSSEUM_BOARD_KIND, present);
  }
  return true;
}

/**
 * #829: send the board OWNER's resolved decision index on the board seq. Used by BOTH directions:
 * the host streams its own pick on a HOST-owned board (the guest watcher adopts it), and the guest
 * relays its pick on a GUEST-owned board (the host adopts it) - it is the same "one index on the
 * board seq" either way, so one sender serves both. FIRE-AND-FORGET; hard no-op outside a live
 * authoritative ME (solo byte-identical). `COLOSSEUM_CONTINUE` (0) / `COLOSSEUM_CASH_OUT` (1) are
 * the only in-range values the receiver maps back onto the board.
 */
export function coopColosseumSendDecision(index: number, roundOverride?: number): boolean {
  if (!coopColosseumActiveInMe()) {
    return true;
  }
  const pinned = coopMeInteractionStartValue();
  const seq = coopColosseumSeq(pinned);
  const controller = getCoopController();
  const round = roundOverride ?? activeBoardRoundByPin.get(pinned);
  if (controller == null || round == null) {
    failCoopSharedSession(`Colosseum decision ${seq} has no committed board round`);
    return false;
  }
  const operationEnabled = isCoopColosseumOperationEnabled();
  const operationBinding = operationEnabled ? captureCoopColosseumOperationBinding(controller.role) : null;
  if (operationEnabled) {
    const committed = commitColosseumDecision(
      {
        pinned,
        round,
        index,
        localRole: controller.role,
        wave: globalScene?.currentBattle?.waveIndex ?? 0,
        turn: globalScene?.currentBattle?.turn ?? 0,
      },
      operationBinding,
    );
    if (committed.kind === "failed") {
      failCoopSharedSession(`Colosseum decision ${seq}/${round} could not enter authoritative control`);
      return false;
    }
    if (committed.kind === "duplicate") {
      return true;
    }
    if (
      controller.role === "host"
      && !setCoopMeColosseumControl(pinned, {
        expectedRound: round,
        boardRound: round,
        decision: { round, index, operationId: committed.operationId },
      })
    ) {
      failCoopSharedSession(`Colosseum decision ${seq}/${round} could not retain recovery control`);
      return false;
    }
  }
  coopLog("me", "colosseum: relay board decision (#829)", { seq, index });
  if (
    controller.role === "guest"
    || !operationEnabled
    || !isCoopOperationJournalActiveFor(operationBinding?.durability ?? null)
  ) {
    getCoopInteractionRelay()?.sendInteractionChoice(seq, COOP_COLOSSEUM_PICK_KIND, index, [round]);
  }
  if (controller.role === "guest") {
    const relay = getCoopInteractionRelay();
    if (relay != null) {
      armCoopColosseumDecisionResend(
        pinned,
        round,
        index,
        () => {
          relay.sendInteractionChoice(seq, COOP_COLOSSEUM_PICK_KIND, index, [round]);
        },
        operationBinding,
      );
    }
  }
  return true;
}

/**
 * #829: await the board OWNER's relayed decision index on the board seq (the disconnect-ceiling
 * default matches every other ME await). Consumed by the deferred guest-loop seam in two roles:
 * the HOST awaiting a GUEST-owned board's relayed pick, and the guest WATCHER awaiting a host-owned
 * board's streamed pick. Resolves to the index, or `null` on a genuinely disconnected partner (the
 * caller then falls back so neither client hangs). No relay (not in a session) resolves `null`.
 */
export async function coopColosseumAwaitDecision(
  timeoutMs?: number,
  expectedRound?: number,
  relayOverride?: NonNullable<ReturnType<typeof getCoopInteractionRelay>>,
): Promise<number | null> {
  const relay = relayOverride ?? getCoopInteractionRelay();
  if (relay == null) {
    return null;
  }
  const pinned = coopMeInteractionStartValue();
  const seq = coopColosseumSeq(pinned);
  const round = expectedRound ?? activeBoardRoundByPin.get(pinned);
  if (round == null) {
    return null;
  }
  const operationEnabled = isCoopColosseumOperationEnabled();
  const controller = getCoopController();
  if (operationEnabled && controller == null) {
    failCoopSharedSession(`Colosseum decision ${seq}/${round} has no bound controller`);
    return null;
  }
  const operationBinding: CoopColosseumOperationBinding | null =
    operationEnabled && controller != null ? captureCoopColosseumOperationBinding(controller.role) : null;
  // This await can outlive the ambient scene/runtime in the two-engine harness and can outlive the whole
  // production session after a disconnect. Address the retained decision from the scheduling boundary,
  // never from whichever scene happens to be active when the relay promise resumes.
  const generation = coopSessionGeneration();
  const wave = globalScene?.currentBattle?.waveIndex ?? 0;
  const turn = globalScene?.currentBattle?.turn ?? 0;
  coopLog("me", "colosseum: await board decision (#829)", { seq, timeoutMs: timeoutMs ?? "default" });
  while (coopMeInteractionStartValue() === pinned) {
    const pick = await relay.awaitInteractionChoice(seq, timeoutMs, COOP_COLO_CHOICE_KINDS);
    if (pick == null) {
      return null;
    }
    if (coopSessionGeneration() !== generation) {
      return null;
    }
    const index = pick.choice;
    if (operationEnabled) {
      const carriedRound = pick.data?.[0];
      if (!Number.isSafeInteger(carriedRound) || (carriedRound as number) < 0) {
        failCoopSharedSession(`Colosseum decision ${seq} carried no exact round`);
        return null;
      }
      if (controller?.role === "host") {
        if ((carriedRound as number) > round) {
          failCoopSharedSession(`Colosseum decision ${seq} carried future round ${String(carriedRound)}/${round}`);
          return null;
        }
        const committed = commitColosseumDecision(
          {
            pinned,
            round: carriedRound as number,
            index,
            localRole: controller.role,
            wave,
            turn,
          },
          operationBinding,
        );
        if (committed.kind === "duplicate") {
          // A retransmitted exact-round decision is already authoritative and must unblock this waiter.
          // Only an older round is noise that should keep the current-round wait alive.
          if ((carriedRound as number) === round) {
            return index;
          }
          continue;
        }
        if ((carriedRound as number) !== round) {
          failCoopSharedSession(
            `Colosseum decision ${seq} carried future/foreign round ${String(carriedRound)}/${round}`,
          );
          return null;
        }
        if (committed.kind !== "committed") {
          failCoopSharedSession(`Colosseum decision ${seq}/${round} could not commit`);
          return null;
        }
      } else if (
        (carriedRound as number) !== round
        || (isCoopOperationJournalActiveFor(operationBinding?.durability ?? null) && pick.operationId == null)
      ) {
        failCoopSharedSession(`Colosseum decision ${seq}/${round} was not journal-led`);
        return null;
      }
    }
    return index;
  }
  return null;
}

/**
 * #829: is a board decision a LIVE co-op decision (vs solo)? True only for a live authoritative session
 * mid-ME. The HOST's `ColosseumChoicePhase` keys off this to decide whether to drive the board off local
 * input (host-owned / solo) or AWAIT the partner's relayed pick (guest-owned). Solo returns false (netcode
 * is "lockstep"), so solo drives locally and is byte-identical.
 */
export function coopColosseumBoardIsCoop(): boolean {
  return coopColosseumActiveInMe();
}

// =============================================================================
// #829 PART 2: the GUEST between-rounds ROUND LOOP.
//
// After round 1's host-authoritative ME-battle handoff the guest boots the round-1 battle in
// `CoopReplayMePhase.finishWithoutLeaving`, then that phase ends. Mid-gauntlet the host sends NO 9M
// LEAVE (it only fires at the WHOLE gauntlet's end), so the phase's default detached 9M-await never
// resolves and the guest strands in the completed round-1 battle. This driver claims that terminal (via
// the `CoopMeBattleEndDelegate` seam) and runs the loop:
//   per round: race [board present (7.6M) vs the true ME-end LEAVE (9M)] ->
//     - LEAVE wins (final round auto-EX / host stall)            -> leave + advance ONCE, done.
//     - board present wins -> drive the board:
//         host-owned board -> WATCH the host's relayed pick (coopColosseumAwaitDecision).
//         guest-owned board -> DRIVE a local CONTINUE/CASH-OUT capture UI + relay the pick.
//       -> CONTINUE : await the host's re-streamed boss (me:wave:counter), adopt it, boot the round's
//                     MysteryEncounterBattlePhase, loop (await the NEXT round's board).
//       -> CASH OUT : await the host's true 9M LEAVE (fired after its reward flow), then leave + advance.
//       -> null / disconnect : leave + advance defensively (never a strand).
// Every await is bounded (COOP_COLOSSEUM_WAIT_MS) with a leave+advance fallback, and a party WIPE
// (no VictoryPhase -> no board, no LEAVE) can only park the detached loop harmlessly: the GameOver runs
// on the phase queue independently, and the loop's eventual bounded timeout leave is pin-guarded to a
// no-op once the run ended. The engine touches go through `CoopColosseumRoundOps` so the loop is testable.
// =============================================================================

/**
 * #829: the DISCONNECT ceiling for every between-rounds await (matches `CoopReplayMePhase` /
 * the interaction relay default). NOT a deliberation timer - steady state resolves on the relayed
 * board / boss / LEAVE; this only fires for a genuinely disconnected partner so the guest never hangs.
 */
const COOP_COLOSSEUM_WAIT_MS = 1_200_000;

/**
 * #829: the engine-coupled operations the guest colosseum round loop performs, injected so the loop's
 * ROUND STATE MACHINE stays headlessly testable over a real relay pair (the wire tests' style) and so
 * `coop-replay-me-phase` never learns about the Colosseum. The real implementation is
 * {@linkcode makeRealColosseumRoundOps}; tests pass fakes.
 */
export interface CoopColosseumRoundOps {
  /** Whether the LOCAL guest OWNS the board decision (drives it) vs watches it (pinned-counter parity). */
  boardOwnedLocally(): boolean;
  /** GUEST-OWNED board: open the local CONTINUE/CASH-OUT capture UI, relay the pick, resolve its index. */
  driveBoard(labels: string[], round: number): Promise<number>;
  /** Await the host's re-streamed boss party for the NEXT round (keyed `me:wave:counter`). */
  awaitBoss(timeoutMs: number): Promise<CoopSerializedEnemy[] | null>;
  /** CONTINUE: purge the stale battle loop, adopt the host's boss, boot the round's ME battle. */
  bootRoundBattle(enemies: CoopSerializedEnemy[]): boolean;
  /** Terminal: leave the encounter locally + advance the alternation ONCE (leaveDefensive semantics). */
  leaveAndAdvance(): boolean;
  /** Cosmetic controller tag: green (you drive this board) / amber (partner drives). */
  showTag(local: boolean): void;
  /** Drop the controller tag (at the terminal / while a round battle runs). */
  hideTag(): void;
}

/** #829: is THIS ME still the pinned one? (a wipe / true end clears the pin; the loop then bails.) */
function coopColosseumStillPinned(counter: number): boolean {
  return coopMeInteractionStartValue() === counter;
}

export interface CoopColosseumLoopLease {
  readonly accepted: boolean;
  isLive(): boolean;
  release(): void;
}

/** Replaceable lease keyed by the complete runtime/channel identity, not merely a reused ME counter. */
export class CoopColosseumLoopLeaseRegistry {
  private readonly active = new Map<number, { identity: readonly unknown[]; token: symbol }>();

  public acquire(counter: number, identity: readonly unknown[]): CoopColosseumLoopLease {
    const prior = this.active.get(counter);
    if (
      prior != null
      && prior.identity.length === identity.length
      && prior.identity.every((value, index) => Object.is(value, identity[index]))
    ) {
      return { accepted: false, isLive: () => this.active.get(counter) === prior, release: () => {} };
    }
    const entry = { identity: [...identity], token: Symbol(`colosseum:${counter}`) };
    this.active.set(counter, entry);
    return {
      accepted: true,
      isLive: () => this.active.get(counter) === entry,
      release: () => {
        if (this.active.get(counter) === entry) {
          this.active.delete(counter);
        }
      },
    };
  }
}

/** A detached gauntlet remains resumable across its retained battle-handoff terminal. */
export function canRebindColosseumGuestLoop(snapshot: CoopActiveMysteryEncounterSnapshotV1): boolean {
  return (
    (snapshot.terminal === "pending" || snapshot.terminal === "battle" || snapshot.terminal === "battle-settled")
    && snapshot.colosseum != null
  );
}

/**
 * #829: drive the guest's between-rounds ROUND LOOP for a colosseum gauntlet. Pure over `relay` + `ops`
 * (no direct engine calls), so it runs headlessly against a `LoopbackTransport` with fakes. `seqTerm` is
 * the 9M ME-terminal seq (the TRUE ME-end LEAVE); the per-round board rides `coopColosseumSeq(counter)`.
 * Detached (voided by the delegate); never throws out (all engine touches are guarded inside `ops`).
 */
export async function runColosseumGuestRoundLoop(
  counter: number,
  seqTerm: number,
  relay: NonNullable<ReturnType<typeof getCoopInteractionRelay>>,
  ops: CoopColosseumRoundOps,
  resume?: {
    expectedRound: number;
    presentation?: Extract<CoopInteractionOutcome, { k: "mePresent" }> | undefined;
    decision?: { round: number; index: number; operationId: string } | undefined;
  },
  isLeaseLive: () => boolean = () => true,
): Promise<void> {
  const boardSeq = coopColosseumSeq(counter);
  coopLog("me", "colosseum guest ROUND LOOP armed (#829)", { counter, boardSeq, seqTerm });
  // ONE terminal arm reused across EVERY round: a fast host's already-buffered LEAVE (final round /
  // post-cash-out) must never be lost to a fresh await on an emptied 9M inbox (the #818/#831 latent-race
  // lesson). Created BEFORE the first board await so the waiter is registered the instant we claim.
  const terminalArm = relay
    .awaitInteractionChoice(seqTerm, COOP_COLOSSEUM_WAIT_MS, COOP_ME_TERMINAL_CHOICE_KINDS)
    .then(action => ({ tag: "term" as const, action }));

  let expectedRound: number | null = resume?.expectedRound ?? null;
  let resumedPresentation = resume?.presentation;
  let resumedDecision = resume?.decision;
  const boundaryLive = (): boolean => isLeaseLive() && coopColosseumStillPinned(counter);
  while (boundaryLive()) {
    // Race the next board present (an intermediate decision point) against the true ME-end LEAVE (the
    // final round streams NO board - it goes straight to endColosseum -> leave). Board present is raced
    // FIRST so it wins a (never-expected) both-buffered tie, exactly like awaitOutcomeThenTerminal.
    const winner =
      resumedPresentation == null
        ? await Promise.race([
            relay
              .awaitInteractionOutcome(boardSeq, COOP_COLOSSEUM_WAIT_MS)
              .then(present => ({ tag: "board" as const, present })),
            terminalArm,
          ])
        : ({ tag: "board" as const, present: resumedPresentation } as const);
    if (!boundaryLive()) {
      return;
    }
    resumedPresentation = undefined;
    if (winner.tag === "term") {
      const rollbackCarrierAllowed = !isCoopMeOperationEnabled() || !isCoopOperationJournalActive();
      const exactLeave =
        winner.action?.choice === COOP_INTERACTION_LEAVE
        && (rollbackCarrierAllowed
          || (winner.action.operationId != null
            && adoptMeWatcherChoice({
              kind: "ME_TERMINAL",
              seq: seqTerm,
              pinned: counter,
              step: 1,
              res: {
                choice: winner.action.choice,
                data: winner.action.data,
                operationId: winner.action.operationId,
              },
              terminal: "leave",
              localRole: "guest",
              wave: globalScene.currentBattle?.waveIndex ?? -1,
              turn: 0,
            }).adopt));
      if (!exactLeave) {
        getCoopRuntime()?.durability?.reconnect();
        failCoopSharedSession(`Colosseum terminal ${seqTerm} was null, malformed, or not journal-led`);
        return;
      }
      coopLog("me", "colosseum loop: exact journal-led ME leave accepted", { counter });
      ops.hideTag();
      if (!ops.leaveAndAdvance()) {
        failCoopSharedSession(`Colosseum terminal could not leave/advance for ${counter}`);
      }
      return;
    }

    const present = winner.present;
    const labels =
      present != null && present.k === "mePresent" && present.subPrompt?.kind === "secondary"
        ? present.subPrompt.labels
        : null;
    const round =
      present?.k === "mePresent" && Number.isSafeInteger(Number(present.tokens[COOP_COLOSSEUM_ROUND_TOKEN]))
        ? Number(present.tokens[COOP_COLOSSEUM_ROUND_TOKEN])
        : -1;
    if (
      labels == null
      || labels.length !== 2
      || !labels.every(label => typeof label === "string")
      || round < 0
      || (expectedRound != null && round !== expectedRound)
    ) {
      coopWarn("me", "colosseum loop: board present null/malformed - retaining shared boundary", { counter });
      ops.hideTag();
      getCoopRuntime()?.durability?.reconnect();
      failCoopSharedSession(`Colosseum board ${boardSeq} unavailable or malformed`);
      return;
    }

    // Drive the decision: the OWNER drives its local capture UI + relays; the WATCHER adopts the host's
    // relayed pick. Either way `decision` is COLOSSEUM_CONTINUE (0) / COLOSSEUM_CASH_OUT (1) / null.
    let decision: number | null;
    if (resumedDecision?.round === round) {
      decision = resumedDecision.index;
      resumedDecision = undefined;
    } else if (ops.boardOwnedLocally()) {
      ops.showTag(true);
      decision = await ops.driveBoard(labels, round);
    } else {
      ops.showTag(false);
      decision = await coopColosseumAwaitDecision(COOP_COLOSSEUM_WAIT_MS, round, relay);
    }
    if (!boundaryLive()) {
      return;
    }
    coopLog("me", "colosseum loop: board decision resolved (#829)", {
      counter,
      owned: ops.boardOwnedLocally(),
      decision: decision ?? "null",
    });

    if (decision !== COLOSSEUM_CONTINUE && decision !== COLOSSEUM_CASH_OUT) {
      ops.hideTag();
      getCoopRuntime()?.durability?.reconnect();
      failCoopSharedSession(`Colosseum decision ${String(decision)} is not an exact committed choice`);
      return;
    }
    if (decision === COLOSSEUM_CASH_OUT) {
      // CASH OUT (or a cancel index): the host runs its reward flow, THEN sends the true 9M LEAVE. Wait
      // for it (the SAME reused terminal arm) so the guest advances IN STEP with the host, not early.
      coopLog("me", "colosseum loop: CASH OUT - awaiting the host's true ME-end LEAVE (#829)", { counter });
      ops.hideTag();
      const terminal = await terminalArm;
      if (!boundaryLive()) {
        return;
      }
      const rollbackCarrierAllowed = !isCoopMeOperationEnabled() || !isCoopOperationJournalActive();
      const exactLeave =
        terminal.action?.choice === COOP_INTERACTION_LEAVE
        && (rollbackCarrierAllowed
          || (terminal.action.operationId != null
            && adoptMeWatcherChoice({
              kind: "ME_TERMINAL",
              seq: seqTerm,
              pinned: counter,
              step: 1,
              res: {
                choice: terminal.action.choice,
                data: terminal.action.data,
                operationId: terminal.action.operationId,
              },
              terminal: "leave",
              localRole: "guest",
              wave: globalScene.currentBattle?.waveIndex ?? -1,
              turn: 0,
            }).adopt));
      if (exactLeave) {
        if (!ops.leaveAndAdvance()) {
          failCoopSharedSession(`Colosseum cash-out could not leave/advance for ${counter}`);
        }
      } else {
        failCoopSharedSession(`Colosseum cash-out terminal ${seqTerm} was not exact/journal-led`);
      }
      return;
    }
    expectedRound = round + 1;

    if (isCoopMeOperationEnabled() && isCoopOperationJournalActive()) {
      // P33 carries every continued round as the next complete retained ME_TERMINAL battle transaction.
      // Its live sink adopts the authoritative state and boots the exact battle directly; this detached
      // board loop merely advances its recovery cursor and waits for the next board. Consuming the old
      // boss side channel here would reintroduce the split state/control race P33 removes.
      ops.hideTag();
      if (coopColosseumStillPinned(counter) && !setCoopMeColosseumControl(counter, { expectedRound })) {
        failCoopSharedSession(`Colosseum next-round retained control could not advance for ${counter}`);
        return;
      }
      continue;
    }

    // CONTINUE: adopt the host's re-streamed boss for the next round and boot that round's battle. The
    // boss is streamed AFTER the decision (in startNextColosseumBattle), so we AWAIT it (a synchronous
    // consume would race the host's still-in-flight stream). Null retains/fails the shared boundary.
    ops.hideTag();
    const enemies = await ops.awaitBoss(COOP_COLOSSEUM_WAIT_MS);
    if (!boundaryLive()) {
      return;
    }
    if (enemies == null || enemies.length === 0) {
      coopWarn("me", "colosseum loop: no re-streamed boss on CONTINUE - retaining boundary", { counter });
      getCoopRuntime()?.durability?.reconnect();
      failCoopSharedSession(`Colosseum next-round boss missing for ${counter}`);
      return;
    }
    if (!ops.bootRoundBattle(enemies)) {
      failCoopSharedSession(`Colosseum next-round battle could not boot for ${counter}`);
      return;
    }
    if (coopColosseumStillPinned(counter) && !setCoopMeColosseumControl(counter, { expectedRound })) {
      failCoopSharedSession(`Colosseum next-round control could not advance for ${counter}`);
      return;
    }
    // Loop: the next `boardArm` parks until the host streams the board AFTER this round's battle.
  }
  // The pin cleared mid-loop (a wipe / the true end already tore it down): stop WITHOUT leaving - there
  // is nothing to advance, and leaving here could fight a GameOver/terminal that already ran.
  coopLog("me", "colosseum loop: pin cleared - stopping without leaving (#829)", { counter });
}

/**
 * #829: the REAL engine-coupled {@linkcode CoopColosseumRoundOps} for a live guest. Every touch mirrors
 * the round-1 boot in `CoopReplayMePhase.finishWithoutLeaving` (the #824 stale-battle purge, the same
 * `me:wave:counter` boss key + `adoptCoopEnemiesStructural`, the same BOSS/WILD encounterMode derivation),
 * plus the leaveDefensive leave+advance duties and the secondary-capture-pattern board UI. Best-effort +
 * guarded - a UI/engine failure must never break the run.
 */
function makeRealColosseumRoundOps(counter: number): CoopColosseumRoundOps {
  return {
    boardOwnedLocally(): boolean {
      return coopColosseumBoardOwnedLocally();
    },

    driveBoard(labels: string[], round: number): Promise<number> {
      // GUEST-OWNED board: the guest's own encounter.misc.gauntlet is empty (it never ran the engine), so
      // it cannot render the full COLOSSEUM standings board - it opens the SECONDARY-capture OPTION_SELECT
      // pattern (the ME sub-pick template) over the HOST-streamed labels, captures the index, and relays it
      // via coopColosseumSendDecision (the host adopts it). A CANCEL maps to CASH OUT (the safe exit).
      const generation = coopSessionGeneration();
      const runtime = getCoopRuntime();
      const live = (): boolean =>
        coopSessionGeneration() === generation
        && getCoopRuntime() === runtime
        && coopColosseumStillPinned(counter)
        && isCoopAuthoritativeGuest();
      return new Promise<number>(resolve => {
        let finished = false;
        const finish = (index: number): void => {
          if (finished || !live()) {
            return;
          }
          // UI handlers can fire twice in one frame (confirm + cancel, or a stale pointer callback). Claim
          // this board before touching UI/transport so one round can publish at most one semantic choice.
          finished = true;
          try {
            globalScene.ui.clearText();
          } catch {
            /* clearing the message box must not block the relay */
          }
          if (coopColosseumSendDecision(index, round)) {
            resolve(index);
          }
        };
        void globalScene.ui.setModeBoundedWhen(UiMode.MESSAGE, 2_000, live).then(opened => {
          if (opened === "superseded" || !live()) {
            failCoopSharedSession(`Colosseum UI could not bind to live session ${counter}`);
            return;
          }
          const options = labels.map((label, idx) => ({
            label,
            handler: () => {
              finish(idx);
              return true;
            },
          }));
          options.push({
            label: i18next.t("menu:cancel"),
            handler: () => {
              finish(COLOSSEUM_CASH_OUT);
              return true;
            },
          });
          const config: OptionSelectConfig = { options, maxOptions: 7, yOffset: 0 };
          void globalScene.ui.setModeBoundedWhen(UiMode.OPTION_SELECT, 2_000, live, config, null, true).then(ok => {
            if (ok === "superseded" && live()) {
              failCoopSharedSession(`Colosseum option UI could not bind to live session ${counter}`);
            }
          });
        });
      });
    },

    awaitBoss(timeoutMs: number): Promise<CoopSerializedEnemy[] | null> {
      const key = meBattleHandoffKey(globalScene.currentBattle.waveIndex, counter);
      const streamer = getCoopBattleStreamer();
      if (streamer == null) {
        return Promise.resolve(null);
      }
      return streamer.awaitMeBattleEnemyParty(key, timeoutMs);
    },

    bootRoundBattle(enemies: CoopSerializedEnemy[]): boolean {
      try {
        // #824 purge: the guest is stuck in the just-completed round's battle loop. Clear those stale
        // phases so booting the next round's MysteryEncounterBattlePhase drives a clean summon chain.
        let purged = 0;
        for (const stale of [
          "TurnInitPhase",
          "CommandPhase",
          "TurnStartPhase",
          "TurnEndPhase",
          "CoopReplayTurnPhase",
          "CoopInertPhase",
          "BattleEndPhase",
          "NewBattlePhase",
        ] as const) {
          while (globalScene.phaseManager.tryRemovePhase(stale)) {
            purged++;
          }
        }
        adoptCoopEnemiesStructural(enemies);
        // encounterMode is a HOST-engine write (initBattleWithEnemyConfig) the guest never ran, so derive
        // it from the adopted party exactly like the round-1 boot: any multi-bar mon -> BOSS, else WILD
        // (they differ only in bgm; a TRAINER-mode encounter is left as-is).
        const meRef = globalScene.currentBattle.mysteryEncounter;
        if (meRef != null && meRef.encounterMode !== MysteryEncounterMode.TRAINER_BATTLE) {
          const anyBoss = globalScene.getEnemyParty().some(e => e.isBoss());
          meRef.encounterMode = anyBoss ? MysteryEncounterMode.BOSS_BATTLE : MysteryEncounterMode.WILD_BATTLE;
        }
        globalScene.phaseManager.unshiftNew("MysteryEncounterBattlePhase", false);
        coopLog("me", "colosseum loop: booted the next round's ME battle (#829)", {
          counter,
          purged,
          adopted: enemies.length,
        });
        return true;
      } catch (e) {
        coopWarn("me", "colosseum loop: round battle boot failed; shared session must stop (#829)", e);
        return false;
      }
    },

    leaveAndAdvance(): boolean {
      hideCoopControllerTag();
      // Leave the encounter locally (guarded on the pin, like the detached #822 listener) and advance the
      // single alternation turn idempotently (keyed to this ME's start counter). The host already resolved
      // the encounter + its rewards through its own streams; the next per-turn checksum re-syncs residual
      // numeric drift, so this never desyncs and never hangs.
      try {
        if (coopColosseumStillPinned(counter)) {
          leaveEncounterWithoutBattle();
        }
        const controller = getCoopController();
        if (controller == null) {
          throw new Error("shared controller unavailable");
        }
        controller.advanceInteraction(counter);
        return true;
      } catch (error) {
        coopWarn("me", "colosseum loop: leave/advance failed; shared session must stop (#829)", error);
        return false;
      }
    },

    showTag(local: boolean): void {
      showCoopControllerTagFor(local);
    },

    hideTag(): void {
      hideCoopControllerTag();
    },
  };
}

/**
 * #829: the guest-side between-rounds delegate registered into `CoopReplayMePhase` (below). Consulted at
 * EVERY ME battle-handoff on the guest; SELF-GATED to the live authoritative GUEST inside the COLOSSEUM
 * ME, so it can never engage for any other battle-spawning ME (that guarantees "never leaks into other
 * MEs" even though the registration is permanent - see the registration note). When it engages it arms
 * the round loop and returns TRUE, so `CoopReplayMePhase.finishWithoutLeaving` skips its default detached
 * leave+advance arm (which mid-gauntlet would never resolve). Returns FALSE for every non-colosseum ME,
 * leaving that phase's behaviour byte-identical.
 */
const activeColosseumGuestLoops = new CoopColosseumLoopLeaseRegistry();

function startColosseumGuestLoop(
  interactionCounter: number,
  seqTerm: number,
  relay: NonNullable<ReturnType<typeof getCoopInteractionRelay>>,
  resume?: Parameters<typeof runColosseumGuestRoundLoop>[4],
): void {
  const runtime = getCoopRuntime();
  const controller = getCoopController();
  const generation = coopSessionGeneration();
  const lease = activeColosseumGuestLoops.acquire(interactionCounter, [runtime, controller, generation, relay]);
  if (!lease.accepted) {
    return;
  }
  void runColosseumGuestRoundLoop(
    interactionCounter,
    seqTerm,
    relay,
    makeRealColosseumRoundOps(interactionCounter),
    resume,
    () =>
      lease.isLive()
      && getCoopRuntime() === runtime
      && getCoopController() === controller
      && coopSessionGeneration() === generation
      && getCoopInteractionRelay() === relay,
  ).finally(lease.release);
}

const coopColosseumBattleEndDelegate: CoopMeBattleEndDelegate = ({ interactionCounter, seqTerm, relay }) => {
  if (!isCoopAuthoritativeGuest()) {
    return false;
  }
  if (globalScene.currentBattle?.mysteryEncounter?.encounterType !== MysteryEncounterType.COLOSSEUM) {
    return false;
  }
  coopLog("me", "colosseum: guest claims the between-rounds terminal (#829)", { interactionCounter, seqTerm });
  startColosseumGuestLoop(interactionCounter, seqTerm, relay);
  return true;
};

/** Re-arm an interrupted between-round loop from the checksum-verified host control statement. */
function rebindColosseumGuestLoop(snapshot: CoopActiveMysteryEncounterSnapshotV1): boolean {
  if (!isCoopAuthoritativeGuest() || !canRebindColosseumGuestLoop(snapshot)) {
    return false;
  }
  const relay = getCoopInteractionRelay();
  if (relay == null || coopMeInteractionStartValue() !== snapshot.interactionCounter) {
    return false;
  }
  const colosseum = snapshot.colosseum;
  if (colosseum == null) {
    return false;
  }
  const presentation =
    colosseum.boardRound === colosseum.expectedRound && snapshot.presentation?.subPrompt?.kind === "secondary"
      ? snapshot.presentation
      : undefined;
  startColosseumGuestLoop(snapshot.interactionCounter, COOP_ME_TERM_SEQ_BASE + snapshot.interactionCounter, relay, {
    expectedRound: colosseum.expectedRound,
    presentation,
    decision: colosseum.decision,
  });
  return true;
}

// #829 REGISTRATION: install the delegate once at module load. `coop-colosseum` is eagerly imported by
// the phase registry (phase-manager -> ColosseumChoicePhase -> here), so this runs on BOTH clients at
// startup, but it is INERT until a real colosseum battle-handoff on the guest (the delegate self-gates on
// the authoritative-guest + colosseum-encounter checks above). A permanent, self-gated registration is
// chosen over scoped null-clearing because: (a) the only guest-side colosseum entry is CoopReplayMePhase,
// which must stay colosseum-agnostic (so it cannot register a scoped delegate); (b) self-gating already
// delivers the "never leaks into other MEs" guarantee the pin-scoped clear was after; and (c) it is
// robust across runs (a new gauntlet needs no re-arm). The internal loop still tears down per gauntlet
// (it exits on the terminal / a cleared pin). Solo + every non-colosseum ME see the delegate return false,
// so their behaviour is byte-identical.
setCoopMeBattleEndDelegate(coopColosseumBattleEndDelegate);
setCoopMeSnapshotRebindDelegate(rebindColosseumGuestLoop);

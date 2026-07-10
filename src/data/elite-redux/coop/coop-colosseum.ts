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
  commitColosseumBoard,
  commitColosseumDecision,
} from "#data/elite-redux/coop/coop-colosseum-operation";
import { coopLog, coopWarn } from "#data/elite-redux/coop/coop-debug";
import { adoptCoopEnemiesStructural } from "#data/elite-redux/coop/coop-enemy-builder";
import { meBattleHandoffKey } from "#data/elite-redux/coop/coop-me-battle-handoff";
import { coopMeInProgress, coopMeInteractionStartValue } from "#data/elite-redux/coop/coop-me-pin-state";
import {
  getCoopBattleStreamer,
  getCoopController,
  getCoopInteractionRelay,
  getCoopNetcodeMode,
  isCoopAuthoritativeGuest,
} from "#data/elite-redux/coop/coop-runtime";
import {
  COOP_COLO_CHOICE_KINDS,
  COOP_COLOSSEUM_SEQ_BASE,
  COOP_ME_CHOICE_KINDS,
} from "#data/elite-redux/coop/coop-seq-registry";
import type { CoopInteractionOutcome, CoopSerializedEnemy } from "#data/elite-redux/coop/coop-transport";
import { MysteryEncounterMode } from "#enums/mystery-encounter-mode";
import { MysteryEncounterType } from "#enums/mystery-encounter-type";
import { UiMode } from "#enums/ui-mode";
import { leaveEncounterWithoutBattle } from "#mystery-encounters/encounter-phase-utils";
import type { CoopMeBattleEndDelegate } from "#phases/coop-replay-me-phase";
import { setCoopMeBattleEndDelegate } from "#phases/coop-replay-me-phase";
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
export function coopColosseumStreamBoard(labels: string[]): void {
  if (!coopColosseumActiveInMe() || getCoopController()?.role !== "host") {
    return;
  }
  const seq = coopColosseumSeq(coopMeInteractionStartValue());
  const present: CoopInteractionOutcome = {
    k: "mePresent",
    tokens: {},
    meetsReqs: [],
    labels: [],
    subPrompt: { kind: "secondary", labels },
  };
  const controller = getCoopController();
  if (controller != null) {
    commitColosseumBoard({
      pinned: coopMeInteractionStartValue(),
      labels,
      localRole: controller.role,
      wave: globalScene?.currentBattle?.waveIndex ?? 0,
      turn: globalScene?.currentBattle?.turn ?? 0,
    });
  }
  coopLog("me", "colosseum: host streams board present (#829)", { seq, labels: labels.length });
  getCoopInteractionRelay()?.sendInteractionOutcome(seq, COOP_COLOSSEUM_BOARD_KIND, present);
}

/**
 * #829: send the board OWNER's resolved decision index on the board seq. Used by BOTH directions:
 * the host streams its own pick on a HOST-owned board (the guest watcher adopts it), and the guest
 * relays its pick on a GUEST-owned board (the host adopts it) - it is the same "one index on the
 * board seq" either way, so one sender serves both. FIRE-AND-FORGET; hard no-op outside a live
 * authoritative ME (solo byte-identical). `COLOSSEUM_CONTINUE` (0) / `COLOSSEUM_CASH_OUT` (1) are
 * the only in-range values the receiver maps back onto the board.
 */
export function coopColosseumSendDecision(index: number): void {
  if (!coopColosseumActiveInMe()) {
    return;
  }
  const seq = coopColosseumSeq(coopMeInteractionStartValue());
  const controller = getCoopController();
  if (controller != null) {
    commitColosseumDecision({
      pinned: coopMeInteractionStartValue(),
      index,
      localRole: controller.role,
      wave: globalScene?.currentBattle?.waveIndex ?? 0,
      turn: globalScene?.currentBattle?.turn ?? 0,
    });
  }
  coopLog("me", "colosseum: relay board decision (#829)", { seq, index });
  getCoopInteractionRelay()?.sendInteractionChoice(seq, COOP_COLOSSEUM_PICK_KIND, index);
}

/**
 * #829: await the board OWNER's relayed decision index on the board seq (the disconnect-ceiling
 * default matches every other ME await). Consumed by the deferred guest-loop seam in two roles:
 * the HOST awaiting a GUEST-owned board's relayed pick, and the guest WATCHER awaiting a host-owned
 * board's streamed pick. Resolves to the index, or `null` on a genuinely disconnected partner (the
 * caller then falls back so neither client hangs). No relay (not in a session) resolves `null`.
 */
export function coopColosseumAwaitDecision(timeoutMs?: number): Promise<number | null> {
  const relay = getCoopInteractionRelay();
  if (relay == null) {
    return Promise.resolve(null);
  }
  const seq = coopColosseumSeq(coopMeInteractionStartValue());
  coopLog("me", "colosseum: await board decision (#829)", { seq, timeoutMs: timeoutMs ?? "default" });
  return relay.awaitInteractionChoice(seq, timeoutMs, COOP_COLO_CHOICE_KINDS).then(pick => {
    const index = pick?.choice ?? null;
    const controller = getCoopController();
    if (index != null && controller?.role === "host") {
      commitColosseumDecision({
        pinned: coopMeInteractionStartValue(),
        index,
        localRole: controller.role,
        wave: globalScene?.currentBattle?.waveIndex ?? 0,
        turn: globalScene?.currentBattle?.turn ?? 0,
      });
    }
    return index;
  });
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
  driveBoard(labels: string[]): Promise<number>;
  /** Await the host's re-streamed boss party for the NEXT round (keyed `me:wave:counter`). */
  awaitBoss(timeoutMs: number): Promise<CoopSerializedEnemy[] | null>;
  /** CONTINUE: purge the stale battle loop, adopt the host's boss, boot the round's ME battle. */
  bootRoundBattle(enemies: CoopSerializedEnemy[]): void;
  /** Terminal: leave the encounter locally + advance the alternation ONCE (leaveDefensive semantics). */
  leaveAndAdvance(): void;
  /** Cosmetic controller tag: green (you drive this board) / amber (partner drives). */
  showTag(local: boolean): void;
  /** Drop the controller tag (at the terminal / while a round battle runs). */
  hideTag(): void;
}

/** #829: is THIS ME still the pinned one? (a wipe / true end clears the pin; the loop then bails.) */
function coopColosseumStillPinned(counter: number): boolean {
  return coopMeInteractionStartValue() === counter;
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
): Promise<void> {
  const boardSeq = coopColosseumSeq(counter);
  coopLog("me", "colosseum guest ROUND LOOP armed (#829)", { counter, boardSeq, seqTerm });
  // ONE terminal arm reused across EVERY round: a fast host's already-buffered LEAVE (final round /
  // post-cash-out) must never be lost to a fresh await on an emptied 9M inbox (the #818/#831 latent-race
  // lesson). Created BEFORE the first board await so the waiter is registered the instant we claim.
  const terminalArm = relay
    .awaitInteractionChoice(seqTerm, COOP_COLOSSEUM_WAIT_MS, COOP_ME_CHOICE_KINDS)
    .then(action => ({ tag: "term" as const, action }));

  while (coopColosseumStillPinned(counter)) {
    // Race the next board present (an intermediate decision point) against the true ME-end LEAVE (the
    // final round streams NO board - it goes straight to endColosseum -> leave). Board present is raced
    // FIRST so it wins a (never-expected) both-buffered tie, exactly like awaitOutcomeThenTerminal.
    const boardArm = relay
      .awaitInteractionOutcome(boardSeq, COOP_COLOSSEUM_WAIT_MS)
      .then(present => ({ tag: "board" as const, present }));
    const winner = await Promise.race([boardArm, terminalArm]);
    if (winner.tag === "term") {
      coopLog("me", "colosseum loop: true ME-end LEAVE won the race - leaving + advancing (#829)", {
        counter,
        action: winner.action == null ? "null" : winner.action.choice,
      });
      ops.hideTag();
      ops.leaveAndAdvance();
      return;
    }

    const present = winner.present;
    const labels =
      present != null && present.k === "mePresent" && present.subPrompt?.kind === "secondary"
        ? present.subPrompt.labels
        : null;
    if (labels == null) {
      // A null / malformed board (a genuinely disconnected host on the bounded wait): defensively
      // leave + advance so the guest never strands on a board that will never arrive.
      coopWarn("me", "colosseum loop: board present null/malformed - defensive leave (#829)", { counter });
      ops.hideTag();
      ops.leaveAndAdvance();
      return;
    }

    // Drive the decision: the OWNER drives its local capture UI + relays; the WATCHER adopts the host's
    // relayed pick. Either way `decision` is COLOSSEUM_CONTINUE (0) / COLOSSEUM_CASH_OUT (1) / null.
    let decision: number | null;
    if (ops.boardOwnedLocally()) {
      ops.showTag(true);
      decision = await ops.driveBoard(labels);
    } else {
      ops.showTag(false);
      decision = await relay
        .awaitInteractionChoice(boardSeq, COOP_COLOSSEUM_WAIT_MS, COOP_COLO_CHOICE_KINDS)
        .then(p => p?.choice ?? null);
    }
    coopLog("me", "colosseum loop: board decision resolved (#829)", {
      counter,
      owned: ops.boardOwnedLocally(),
      decision: decision ?? "null",
    });

    if (decision == null) {
      // Disconnected partner: leave + advance directly (do NOT wait on the terminal - it will not come).
      ops.hideTag();
      ops.leaveAndAdvance();
      return;
    }
    if (decision !== COLOSSEUM_CONTINUE) {
      // CASH OUT (or a cancel index): the host runs its reward flow, THEN sends the true 9M LEAVE. Wait
      // for it (the SAME reused terminal arm) so the guest advances IN STEP with the host, not early.
      coopLog("me", "colosseum loop: CASH OUT - awaiting the host's true ME-end LEAVE (#829)", { counter });
      ops.hideTag();
      await terminalArm;
      ops.leaveAndAdvance();
      return;
    }

    // CONTINUE: adopt the host's re-streamed boss for the next round and boot that round's battle. The
    // boss is streamed AFTER the decision (in startNextColosseumBattle), so we AWAIT it (a synchronous
    // consume would race the host's still-in-flight stream). Null (host stall) -> defensive leave.
    ops.hideTag();
    const enemies = await ops.awaitBoss(COOP_COLOSSEUM_WAIT_MS);
    if (enemies == null || enemies.length === 0) {
      coopWarn("me", "colosseum loop: no re-streamed boss on CONTINUE - defensive leave (#829)", { counter });
      ops.leaveAndAdvance();
      return;
    }
    ops.bootRoundBattle(enemies);
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

    driveBoard(labels: string[]): Promise<number> {
      // GUEST-OWNED board: the guest's own encounter.misc.gauntlet is empty (it never ran the engine), so
      // it cannot render the full COLOSSEUM standings board - it opens the SECONDARY-capture OPTION_SELECT
      // pattern (the ME sub-pick template) over the HOST-streamed labels, captures the index, and relays it
      // via coopColosseumSendDecision (the host adopts it). A CANCEL maps to CASH OUT (the safe exit).
      return new Promise<number>(resolve => {
        const finish = (index: number): void => {
          try {
            globalScene.ui.clearText();
          } catch {
            /* clearing the message box must not block the relay */
          }
          coopColosseumSendDecision(index);
          resolve(index);
        };
        void globalScene.ui.setMode(UiMode.MESSAGE).then(() => {
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
          void globalScene.ui.setModeWithoutClear(UiMode.OPTION_SELECT, config, null, true);
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

    bootRoundBattle(enemies: CoopSerializedEnemy[]): void {
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
      } catch (e) {
        coopWarn("me", "colosseum loop: round battle boot failed (guarded) (#829)", e);
      }
    },

    leaveAndAdvance(): void {
      hideCoopControllerTag();
      // Leave the encounter locally (guarded on the pin, like the detached #822 listener) and advance the
      // single alternation turn idempotently (keyed to this ME's start counter). The host already resolved
      // the encounter + its rewards through its own streams; the next per-turn checksum re-syncs residual
      // numeric drift, so this never desyncs and never hangs.
      if (coopColosseumStillPinned(counter)) {
        try {
          leaveEncounterWithoutBattle();
        } catch {
          coopWarn("me", "colosseum loop: leaveEncounterWithoutBattle threw (handled) (#829)", { counter });
        }
      }
      try {
        getCoopController()?.advanceInteraction(counter);
      } catch {
        coopWarn("me", "colosseum loop: advanceInteraction threw (handled, idempotent) (#829)", { counter });
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
const coopColosseumBattleEndDelegate: CoopMeBattleEndDelegate = ({ interactionCounter, seqTerm, relay }) => {
  if (!isCoopAuthoritativeGuest()) {
    return false;
  }
  if (globalScene.currentBattle?.mysteryEncounter?.encounterType !== MysteryEncounterType.COLOSSEUM) {
    return false;
  }
  coopLog("me", "colosseum: guest claims the between-rounds terminal (#829)", { interactionCounter, seqTerm });
  void runColosseumGuestRoundLoop(interactionCounter, seqTerm, relay, makeRealColosseumRoundOps(interactionCounter));
  return true;
};

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

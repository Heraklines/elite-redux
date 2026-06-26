/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Co-op GUEST per-turn PRESENTATION SEQUENCER (#633, near-real-time replay).
//
// The guest's real phase queue stays PARKED on CoopReplayTurnPhase for the whole turn.
// This sequencer runs on the Phaser SCENE CLOCK (tweens / time / ui.showText keep ticking
// while the queue is frozen - phase.ts only pumps on end()) and plays the host's live events
// ONE AT A TIME, in CONTIGUOUS ascending seq order: TEXT -> move anim -> hp drain -> faint ->
// TEXT, each completing before the next starts, at a watchable pace. The move TEXT renders
// LIVE and in order WITH the animation + hp (the whole point) - driven DIRECTLY via
// globalScene.ui.showText, because a queued MessagePhase cannot run while the queue is parked.
//
// PRESENTATION ONLY (I2): it NEVER durably mutates mon.hp / status / field / checksum-d state.
// The end-of-turn CoopFinalizeTurnPhase checkpoint is the sole state mutator and runs AFTER this
// sequencer drains every received event (I1). renderedSeqs is the SOLE exactly-once authority
// shared with the batch (I3). A per-cosmetic watchdog + an overall turn deadline force-DRAIN the
// sequencer if events stop arriving; the EXISTING awaitTurn ceiling (finishTurnNoStream) is what
// closes the sequencer when the host never sends the turn-end batch (I4 - see CORRECTION 2 below).
// =============================================================================

import { globalScene } from "#app/global-scene";
import { coopLog, coopWarn, isCoopDebug } from "#data/elite-redux/coop/coop-debug";
import type { CoopBattleEvent } from "#data/elite-redux/coop/coop-transport";
import {
  playCoopFaintCosmetic,
  playCoopHpDrainCosmetic,
  playCoopMoveAnimCosmetic,
  playCoopStatTweenCosmetic,
  playCoopStatusCosmetic,
} from "#phases/coop-replay-cosmetics";

/** Per-cosmetic watchdog: a cosmetic whose completion callback never fires is force-advanced. */
const COOP_SEQ_COSMETIC_WATCHDOG_MS = 6000;
/**
 * Overall turn deadline: after this with no progress AND the batch already awaited, the sequencer
 * self-DRAINS so the finalize can render the gap + run. This only force-drains a stuck-mid-stream
 * sequencer; it does NOT (and cannot) replace the awaitTurn ceiling when the host never sends the
 * batch at all (CORRECTION 2 / I4) - see the coopWarn in forceDrain documenting the honest limit.
 */
const COOP_SEQ_TURN_DEADLINE_MS = 30000;
/**
 * Post-type DWELL the SEQUENCER owns between a text line finishing its type-on and the next event
 * (~1000ms, a touch snappier than the normal non-prompt MessagePhase 1500ms). This is driven by a
 * sequencer-owned globalScene.time.delayedCall - NOT a MessageUiHandler callbackDelay - because a
 * callbackDelay's timer is cancelled the instant the next showText starts (message-ui-handler.ts:131
 * remove + 133 re-fire), so every line would otherwise SNAP. The 20ms/char type-on is kept (delay=null).
 */
const COOP_SEQ_TEXT_DWELL_MS = 1000;

export class CoopTurnSequencer {
  public readonly turn: number;

  /** THE exactly-once authority (I3): every seq the sequencer OR the batch has presented. */
  public readonly renderedSeqs = new Set<number>();

  /** Buffered events awaiting their contiguous turn, keyed by seq (out-of-order tolerant). */
  private readonly pending = new Map<number, CoopBattleEvent>();
  /** Contiguous-drain cursor: the next seq to play. A gap parks here until it arrives. */
  private nextSeq = 0;
  /** Running per-mon DISPLAY hp so multi-hit drains chain (hit1 from->h1, hit2 h1->h2). Never durable. */
  private readonly fromHpByBi = new Map<number, number>();

  /** True while a cosmetic is mid-flight (the one-at-a-time serializer). */
  private playing = false;
  /** Set once the turn is closed (drained / deadlined / finalized): further offers are dropped. */
  private closed = false;

  /** The batch length the replay phase waits to see fully drained; -1 until it calls drained(). */
  private targetLen = -1;
  /** Resolver for the drained() promise (the replay phase awaits it before finalizing). */
  private drainResolve: (() => void) | null = null;

  private cosmeticWatchdog: Phaser.Time.TimerEvent | undefined;
  private textDwell: Phaser.Time.TimerEvent | undefined;
  private turnDeadline: Phaser.Time.TimerEvent | undefined;

  constructor(turn: number, field: ReadonlyArray<{ hp: number } | null>) {
    this.turn = turn;
    // Seed the running DISPLAY hp from the PRE-turn field ONCE, before any drain plays, so a drain's
    // "from" is the pre-turn value (display-only) and never a live-mutated mon.hp (I2). hp events carry
    // {bi,hp,maxHp} with NO "from" (coop-transport.ts), so the from-value must come from here.
    field.forEach((m, bi) => {
      if (m != null) {
        this.fromHpByBi.set(bi, m.hp);
      }
    });
  }

  /** Kick the sequencer (called by CoopReplayTurnPhase.start). Arms the overall turn deadline. */
  public kick(): void {
    if (isCoopDebug()) {
      coopLog("replay", `seq turn=${this.turn}: kick (nextSeq=${this.nextSeq})`);
    }
    this.turnDeadline = globalScene.time.delayedCall(COOP_SEQ_TURN_DEADLINE_MS, () => this.forceDrain("deadline"));
    this.pump();
  }

  /**
   * Offer a live event. De-dupes against renderedSeqs / pending / the cursor, buffers by seq, then
   * pumps the contiguous drain. Out-of-order arrival is fine: a gap parks the cursor until filled.
   */
  public offer(seq: number, event: CoopBattleEvent): void {
    if (this.closed || this.renderedSeqs.has(seq) || this.pending.has(seq) || seq < this.nextSeq) {
      return; // already played, already buffered, or behind the cursor -> drop (exactly-once, I3)
    }
    this.pending.set(seq, event);
    this.pump();
  }

  /**
   * Drive the contiguous drain: while the next seq is buffered AND no cosmetic is in flight, mark it
   * rendered (BEFORE playing - synchronous, single JS thread) and play it. Each cosmetic's onDone
   * re-enters pump() for the next (the one-at-a-time chain). A missing seq parks the cursor here.
   */
  private pump(): void {
    if (this.playing || this.closed) {
      return;
    }
    const ev = this.pending.get(this.nextSeq);
    if (ev === undefined) {
      this.maybeResolveDrain(); // caught up to everything received; check the batch target
      return;
    }
    this.pending.delete(this.nextSeq);
    this.renderedSeqs.add(this.nextSeq); // mark rendered BEFORE play -> the batch will skip it (I3)
    this.playing = true;
    const playedSeq = this.nextSeq;
    this.nextSeq++;
    if (isCoopDebug()) {
      coopLog("replay", `seq turn=${this.turn}: play seq=${playedSeq} k=${ev.k}`);
    }
    this.playOne(ev, () => {
      this.playing = false;
      this.clearCosmeticWatchdog();
      this.pump(); // chain: each completion triggers the next
    });
  }

  /**
   * Play ONE event's cosmetic on the scene clock, then call onDone. Every branch is wrapped + watchdog-
   * backed so a thrown / garbled / never-calling-back cosmetic force-advances (I4). PRESENTATION ONLY
   * (I2): the cosmetic cores are called with their commit* flag FALSE on this live path - no durable
   * mon.hp / status / field write here or in the cores.
   */
  private playOne(event: CoopBattleEvent, onDone: () => void): void {
    let done = false;
    const finish = () => {
      if (done) {
        return;
      }
      done = true;
      onDone();
    };
    this.cosmeticWatchdog = globalScene.time.delayedCall(COOP_SEQ_COSMETIC_WATCHDOG_MS, () => {
      coopWarn("replay", `seq turn=${this.turn}: cosmetic watchdog k=${event.k} -> force advance`);
      finish();
    });
    try {
      switch (event.k) {
        case "message":
          // The WHOLE POINT: drive the move/faint TEXT DIRECTLY on the scene clock so it renders LIVE,
          // in order, paced WITH the anim + hp. A queued MessagePhase can't run while the queue is
          // parked, so we call ui.showText ourselves - the SAME handler + render path the batch
          // MessagePhase uses (ui.ts showText -> getMessageHandler() -> message-ui-handler.ts), so the
          // message box renders identically. delay=null keeps the ~20ms/char type-on; callbackDelay=null
          // so our callback fires the instant the type-on completes; prompt=false so it is NOT a tap gate.
          // The dwell is OWNED by the sequencer (a delayedCall in onTextTyped), never a callbackDelay (a
          // callbackDelay timer is cancelled when the next showText starts, which would snap every line).
          globalScene.ui.showText(event.text, null, () => this.onTextTyped(finish), null, false);
          break;
        case "moveUsed":
          playCoopMoveAnimCosmetic(event.bi, event.moveId, event.targets[0] ?? event.bi, finish);
          break;
        case "hp": {
          const from = this.fromHpByBi.get(event.bi) ?? event.hp;
          this.fromHpByBi.set(event.bi, event.hp); // chain multi-hit; display-only running value
          playCoopHpDrainCosmetic(event.bi, from, event.hp, event.maxHp, /* commitHp */ false, finish);
          break;
        }
        case "statStage":
          playCoopStatTweenCosmetic(event.bi, event.stat, event.value, /* commitStage */ false, finish);
          break;
        case "status":
          playCoopStatusCosmetic(event.bi, event.status, finish);
          break;
        case "faint":
          playCoopFaintCosmetic(event.bi, /* commitRemoval */ false, finish);
          break;
        default:
          // weather / terrain / switch ride the checkpoint, not the sequencer.
          finish();
          break;
      }
    } catch {
      coopWarn("replay", `seq turn=${this.turn}: garbled event k=${event.k} skipped`);
      finish();
    }
  }

  /**
   * A text line finished typing on. Hold a SEQUENCER-OWNED dwell (so the line is legible) then advance
   * (CORRECTION 1). The dwell is a delayedCall, not a MessageUiHandler callbackDelay, so the next line
   * does not cancel it. closed/clearTextDwell cancel it cleanly if the turn finalizes mid-dwell.
   */
  private onTextTyped(finish: () => void): void {
    this.clearTextDwell();
    if (this.closed) {
      finish();
      return;
    }
    this.textDwell = globalScene.time.delayedCall(COOP_SEQ_TEXT_DWELL_MS, () => {
      this.textDwell = undefined;
      finish();
    });
  }

  /**
   * Promise the replay phase awaits: resolves when the contiguous cursor has reached `uptoLen` (the
   * batch length) AND nothing is mid-flight, OR when the turn deadline force-resolves it (I4). If
   * already satisfied, resolves immediately.
   */
  public drained(uptoLen: number): Promise<void> {
    this.targetLen = uptoLen;
    return new Promise<void>(resolve => {
      this.drainResolve = resolve;
      this.maybeResolveDrain();
    });
  }

  /**
   * Resolve drained() iff EITHER (a) the cursor has reached the batch target AND nothing is mid-flight
   * AND no immediately-playable event remains, OR (b) the sequencer is already CLOSED (the turn deadline
   * fired, or finishTurnNoStream closed it) and nothing is mid-flight.
   *
   * Case (b) is the BLOCKING fix: forceDrain / close set `closed=true` and call resolveDrain, but if that
   * happens BEFORE drained() is ever awaited (e.g. the 30s deadline fires at T+30s but the host's batch
   * only arrives at T+60s), drainResolve is still null at that point so the resolve is a no-op, and the
   * deadline is one-shot - it never re-arms. When drained() is finally awaited after a close, a true gap
   * (nextSeq < targetLen, a dropped live seq) would otherwise NEVER satisfy clause (a) and the await would
   * hang forever, stranding the checkpoint. A closed sequencer plays nothing more, so there is nothing
   * left to wait for: resolve immediately and let renderUnrendered fill the gap from the batch (I3/I4).
   */
  private maybeResolveDrain(): void {
    if (this.drainResolve == null || this.playing) {
      return;
    }
    if (this.closed) {
      this.resolveDrain();
      return;
    }
    const noMorePending = !this.pending.has(this.nextSeq);
    if (this.targetLen >= 0 && this.nextSeq >= this.targetLen && noMorePending) {
      this.resolveDrain();
    }
  }

  private resolveDrain(): void {
    if (this.drainResolve == null) {
      return;
    }
    const r = this.drainResolve;
    this.drainResolve = null;
    if (isCoopDebug()) {
      coopLog("replay", `seq turn=${this.turn}: drained (nextSeq=${this.nextSeq} target=${this.targetLen})`);
    }
    r();
  }

  /**
   * Force the sequencer to stop and release the drained() promise (overall deadline, I4). Any un-played
   * seq is left OUT of renderedSeqs, so the batch renders it (the visible result is still complete - the
   * gap renders as a phase in the finalize burst, just not live-paced).
   *
   * CORRECTION 2 (honest I4 limit): this 30s deadline only helps once the batch has ALREADY arrived and
   * a single seq is stuck mid-stream - drained() is only AWAITED inside CoopReplayTurnPhase's
   * awaitTurn(...).then continuation, which never runs until the host sends the turn-end batch. If the
   * host NEVER sends the batch, this deadline fires into a null drainResolve (harmless), and the turn
   * finalizes via the EXISTING awaitTurn ceiling -> finishTurnNoStream (which also closes this sequencer).
   */
  private forceDrain(reason: string): void {
    coopWarn(
      "replay",
      `seq turn=${this.turn}: forceDrain (${reason}) at nextSeq=${this.nextSeq}`
        + " - note: if no batch arrived this is a no-op; awaitTurn->finishTurnNoStream is the real ceiling",
    );
    this.closed = true;
    this.playing = false;
    this.clearCosmeticWatchdog();
    this.clearTextDwell();
    this.resolveDrain();
  }

  /**
   * Close the sequencer (no further offers play). Called both after the finalize burst is enqueued AND
   * from the awaitTurn null/stall -> finishTurnNoStream path (CORRECTION 2 / I4): stops pending cosmetics
   * + clears every timer so a no-batch turn finalizes via the existing mechanism, no worse than today.
   */
  public close(): void {
    this.closed = true;
    this.playing = false;
    this.clearCosmeticWatchdog();
    this.clearTextDwell();
    this.turnDeadline?.remove();
    this.turnDeadline = undefined;
    // Release any dangling drained() awaiter (defensive): a closed sequencer plays nothing more, so an
    // outstanding drained() promise must never be left hanging (BLOCKING fix). On the normal success path
    // drained() already resolved (drainResolve null -> no-op); this guards every other close path.
    this.resolveDrain();
  }

  private clearCosmeticWatchdog(): void {
    this.cosmeticWatchdog?.remove();
    this.cosmeticWatchdog = undefined;
  }

  private clearTextDwell(): void {
    this.textDwell?.remove();
    this.textDwell = undefined;
  }
}

// --- Module registry: the live-event handler (coop-runtime) and the replay phase share ONE instance.
let active: CoopTurnSequencer | null = null;

export function registerCoopTurnSequencer(
  turn: number,
  field: ReadonlyArray<{ hp: number } | null>,
): CoopTurnSequencer {
  active = new CoopTurnSequencer(turn, field);
  return active;
}

export function getCoopTurnSequencer(turn: number): CoopTurnSequencer | null {
  return active?.turn === turn ? active : null;
}

export function clearCoopTurnSequencer(turn: number): void {
  if (active?.turn === turn) {
    active = null;
  }
}

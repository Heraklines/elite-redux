/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Co-op MYSTERY-ENCOUNTER input pump (#633). A whole-ME authoritative input
// lockstep: the OWNER drives the encounter and relays every MEANINGFUL button; the
// WATCHER's local input is blocked and its encounter is DRIVEN by replaying the
// owner's exact button stream into its real handlers.
//
// Why this is safe-by-construction (Oracle-validated): both clients hold byte-
// identical, RNG-deterministic (executeWithSeedOffset), INPUT-GATED ME state. So
// replaying the identical button sequence reproduces the identical flow - option
// pick, sub-choices, quiz answers, pick-a-mon, number inputs, dialogue, rewards -
// with ZERO per-encounter hooks (there are ~50 MEs). Unlike the cosmetic
// {@linkcode CoopUiMirror} (which DROPS on mode-mismatch because the choice-commit is
// the truth there), here the button stream IS the truth, so it must NEVER drop: it
// rides the reliable, FIFO-per-seq {@linkcode CoopInteractionRelay} and the watcher
// blocks-and-buffers, never drops.
//
// Two correctness rules keep the advance-count in lockstep without losing a press:
//   1. OWNER relays a button ONLY when its handler was READY to consume it (a menu,
//      or a message whose text has finished + prompt is up) - never a scroll-skip.
//      Scroll-skips stay owner-local cosmetic speed-ups.
//   2. WATCHER applies each relayed button ONLY once its own handler is READY (waits
//      out its text scroll). So both sides perform exactly one ADVANCE per relayed
//      press; a press is never consumed-then-discarded.
//
// Embedded ME battles + the end-of-ME reward shop are EXCLUDED by the caller (a
// phase-allowlist gate in ui.ts), so those keep their existing co-op owners (the
// battle command relay / the shop relay). The pump is suspended for them.
//
// Failure handling: a watcher timeout / partner-gone resolves the await null; the
// pump ends and invokes `onDegrade` (the caller skips the ME to a safe terminal), so
// the run continues to the next wave rather than freezing. Truth degrades to "this ME
// didn't sync, both moved on" - never a corrupted or hung run.
//
// Engine-FREE (a tiny injected surface), so the FIFO / readiness / lockstep logic is
// unit-testable headlessly over a LoopbackTransport, exactly like the other co-op relays.
// =============================================================================

import { COOP_INTERACTION_LEAVE, type CoopInteractionRelay } from "#data/elite-redux/coop/coop-interaction-relay";

/** The live-engine surface the watcher needs, injected so the module stays unit-testable. */
export interface CoopMePumpEngine {
  /** Replay one relayed owner button into the LOCAL active handler (watcher side). */
  applyButton(button: number): void;
  /** Whether the active handler can CONSUME a button NOW (text done scrolling, prompt up). */
  isReady(): boolean;
}

type PumpRole = "owner" | "watcher";

/**
 * The watcher's terminal callbacks (#633 ME battle handoff). The pump can reach TWO distinct
 * terminals, which the watcher must handle DIFFERENTLY:
 *  - {@linkcode onLeave}: the owner left a NON-battle ME (the normal LEAVE sentinel, a timeout,
 *    or a gone partner). The watcher fast-forwards / skips to the next wave (no battle to run).
 *  - {@linkcode onBattleHandoff}: the owner's option spawned a BATTLE. The watcher must NOT leave
 *    the encounter - it ends the pump and lets the spawned battle run host-authoritatively (the
 *    host streams the boss, the guest adopts it; both flow through the normal battle path).
 */
export interface CoopMeWatcherCallbacks {
  onLeave: () => void;
  onBattleHandoff: () => void;
}

/** Routing tag for relayed ME buttons (distinguishes them on the wire / in logs). */
const ME_PUMP_KIND = "meBtn";
/**
 * Sentinel the OWNER relays when its option spawned a BATTLE (#633 ME battle handoff): tells the
 * watcher to END the pump WITHOUT leaving the encounter, so the spawned battle runs (the host
 * drives it + streams the boss; the guest adopts + replays). Distinct from {@linkcode
 * COOP_INTERACTION_LEAVE} (which means "the ME ended, skip to the next wave"). Negative so it can
 * never collide with a real button code, and distinct from the other interaction sentinels.
 */
export const COOP_ME_BATTLE_HANDOFF = -1000;
/**
 * Co-op authoritative non-battle ME (#633 MAJOR-1): the HOST->GUEST terminal / battle-handoff
 * sentinel rides a DEDICATED seq `COOP_ME_TERM_SEQ_BASE + coopMeInteractionStart` so it can never
 * FIFO-collide with the guest->host option/sub-pick relay (which stays on `COOP_ME_PUMP_SEQ_BASE +
 * start`). Three disjoint seq channels: `8_000_000 + start` (guest->host picks + host present /
 * resync outcomes), `9_000_000 + start` (host->guest terminal / handoff), RAW `start` (reward shop).
 */
export const COOP_ME_TERM_SEQ_BASE = 9_000_000;
/** Default watcher wait for the owner's next button before degrading (20min: "wait for the
 *  human" - a slow owner reading dialogue must never trip the watcher's safe-skip). */
const DEFAULT_ME_WAIT_MS = 1_200_000;
/** Readiness poll cadence + bound (the watcher waits out its own text scroll before applying). */
const READY_TICK_MS = 16;
const READY_MAX_TICKS = 900; // ~14s ceiling, then apply best-effort rather than wait forever

/**
 * Rides a {@linkcode CoopInteractionRelay} to relay/replay the owner's authoritative
 * button stream for one mystery encounter. One instance per client. The phase opens a
 * session with {@linkcode beginOwner}/{@linkcode beginWatcher} and closes it with
 * {@linkcode endOwner} (owner) / the LEAVE sentinel (watcher loop); the UI layer calls
 * {@linkcode relayOwnerButton} (owner) and feeds replays via the injected engine (watcher).
 */
export class CoopMePump {
  private readonly relay: CoopInteractionRelay;
  private readonly waitMs: number;
  /** Async tick used to wait out the watcher's text scroll (injectable for tests). */
  private readonly tick: () => Promise<void>;
  private engine: CoopMePumpEngine | null = null;

  private role: PumpRole | null = null;
  private seq = -1;
  /**
   * Seq the OWNER sends its TERMINAL sentinels (LEAVE / battle-handoff) on (#633 MAJOR-1 / B-1).
   * In LOCKSTEP this stays == {@linkcode seq} (8M), so the watcher loop - which awaits the owner's
   * button stream AND its terminal on the SAME seq - keeps catching the terminal byte-identically.
   * In AUTHORITATIVE mode the host passes a DEDICATED `COOP_ME_TERM_SEQ_BASE + start` (9M) so the
   * terminal rides a channel disjoint from the guest->host pick/sub-pick relay (which stays on 8M),
   * matching where the authoritative guest's `CoopReplayMePhase.awaitHostTerminal` listens. Without
   * this split the host's LEAVE/HANDOFF buffered on 8M forever and the 9M guest waiter only resolved
   * via the ~20-min disconnect timeout (every authoritative non-battle ME hung the guest).
   */
  private termSeq = -1;
  private ended = true;
  private loopRunning = false;
  /** Watcher terminal: the owner left a NON-battle ME (LEAVE / timeout / gone) -> skip to next wave. */
  private onLeave: (() => void) | null = null;
  /** Watcher terminal: the owner's option spawned a BATTLE -> end the pump, let the battle run (#633). */
  private onBattleHandoff: (() => void) | null = null;

  constructor(relay: CoopInteractionRelay, opts: { waitMs?: number; tick?: () => Promise<void> } = {}) {
    this.relay = relay;
    this.waitMs = opts.waitMs ?? DEFAULT_ME_WAIT_MS;
    this.tick = opts.tick ?? (() => new Promise<void>(resolve => setTimeout(resolve, READY_TICK_MS)));
  }

  /** Inject the live engine surface (called once by the UI layer). */
  attach(engine: CoopMePumpEngine): void {
    this.engine = engine;
  }

  /**
   * OWNER: begin relaying our buttons for ME interaction `seq`. Idempotent on an
   * already-active same-seq session (a nested option-select re-enters here).
   *
   * `termSeq` (#633 MAJOR-1 / B-1) is the seq the OWNER sends its TERMINAL sentinels
   * (LEAVE / battle-handoff) on. Defaults to `seq` so LOCKSTEP stays byte-identical (the watcher
   * loop catches the terminal on the same seq as the buttons). The AUTHORITATIVE host passes
   * `COOP_ME_TERM_SEQ_BASE + start` so the terminal reaches the guest's `CoopReplayMePhase`
   * (which awaits the terminal on the dedicated 9M seq, disjoint from the 8M pick relay).
   */
  beginOwner(seq: number, termSeq: number = seq): void {
    if (this.role === "owner" && this.seq === seq && !this.ended) {
      // Keep the terminal seq in sync on a nested re-entry (the start counter is stable, so this
      // is the same value, but never let a re-entry leave a stale termSeq behind).
      this.termSeq = termSeq;
      return;
    }
    this.role = "owner";
    this.seq = seq;
    this.termSeq = termSeq;
    this.ended = false;
  }

  /**
   * WATCHER: begin replaying the owner's buttons for ME interaction `seq`, and start the
   * (single) replay loop. Idempotent on an already-active same-seq session (nested
   * option-selects re-enter here and must NOT spawn a second loop).
   *
   * `callbacks` carries the two distinct terminals (#633 ME battle handoff):
   *  - `onLeave` (the safe-skip): a LEAVE sentinel / timeout / gone partner -> the run never hangs.
   *  - `onBattleHandoff`: the owner's option spawned a battle -> end the pump WITHOUT leaving the
   *    encounter so the spawned battle runs host-authoritatively.
   * A bare function is accepted as the legacy `onLeave`-only form (lockstep callers / unit tests),
   * with `onBattleHandoff` defaulting to a no-op.
   */
  beginWatcher(seq: number, callbacks: CoopMeWatcherCallbacks | (() => void)): void {
    const onLeave = typeof callbacks === "function" ? callbacks : callbacks.onLeave;
    const onBattleHandoff = typeof callbacks === "function" ? () => {} : callbacks.onBattleHandoff;
    if (this.role === "watcher" && this.seq === seq && !this.ended) {
      return;
    }
    this.role = "watcher";
    this.seq = seq;
    this.termSeq = seq;
    this.ended = false;
    this.onLeave = onLeave;
    this.onBattleHandoff = onBattleHandoff;
    if (!this.loopRunning) {
      this.loopRunning = true;
      void this.runWatcherLoop(seq);
    }
  }

  /** Whether a pump session is open (the caller still gates this on the ME-interactive phase). */
  isSessionActive(): boolean {
    return this.role != null && !this.ended;
  }

  /** Whether the local player is the WATCHER (its local input is blocked during the ME). */
  isWatcher(): boolean {
    return this.role === "watcher";
  }

  /**
   * OWNER: relay one button the local human just pressed. The UI layer calls this ONLY
   * when the handler was READY to consume it (never a scroll-skip), so the watcher's
   * advance-count stays in lockstep. No-op unless we own an active session.
   */
  relayOwnerButton(button: number): void {
    if (this.role !== "owner" || this.ended) {
      return;
    }
    this.relay.sendInteractionChoice(this.seq, ME_PUMP_KIND, button);
  }

  /**
   * OWNER (#633 ME battle handoff): the option just spawned a BATTLE. Relay the battle-handoff
   * sentinel so the watcher ENDS the pump WITHOUT leaving the encounter, then end our own
   * session. The spawned battle then runs host-authoritatively on BOTH clients (the host streams
   * the boss, the guest adopts it; both flow through the normal host-drives / guest-replays
   * path). Unlike {@linkcode endOwner}, this does NOT mean the ME is over - the battle + its
   * reward shop still run; the interaction-counter advance happens at the TRUE ME terminal.
   */
  relayMeBattleHandoff(): void {
    if (this.role === "owner" && !this.ended) {
      // Terminal sentinel rides `termSeq` (#633 MAJOR-1 / B-1): == seq in lockstep (watcher loop),
      // the dedicated 9M terminal seq in authoritative mode (CoopReplayMePhase.awaitHostTerminal).
      this.relay.sendInteractionChoice(this.termSeq, ME_PUMP_KIND, COOP_ME_BATTLE_HANDOFF);
    }
    this.endSession();
  }

  /** OWNER: the ME reached its terminal - send the leave sentinel so the watcher loop ends. */
  endOwner(): void {
    if (this.role === "owner" && !this.ended) {
      // Terminal sentinel rides `termSeq` (#633 MAJOR-1 / B-1): == seq in lockstep (watcher loop),
      // the dedicated 9M terminal seq in authoritative mode (CoopReplayMePhase.awaitHostTerminal).
      this.relay.sendInteractionChoice(this.termSeq, ME_PUMP_KIND, COOP_INTERACTION_LEAVE);
    }
    this.endSession();
  }

  /** Close the session (terminal / disconnect). The watcher loop unwinds on its next pass. */
  endSession(): void {
    this.ended = true;
    this.role = null;
    this.termSeq = -1;
    this.onLeave = null;
    this.onBattleHandoff = null;
  }

  private async runWatcherLoop(seq: number): Promise<void> {
    try {
      for (;;) {
        if (this.ended || this.seq !== seq) {
          return;
        }
        const action = await this.relay.awaitInteractionChoice(seq, this.waitMs);
        if (this.ended || this.seq !== seq) {
          return;
        }
        // A BATTLE-HANDOFF sentinel (#633): the owner's option spawned a battle. End the pump
        // but do NOT leave the encounter - the spawned battle must run (host-authoritative on
        // both clients). The watcher's input gate auto-suspends for the battle phase, so once
        // we end here the battle command relay takes over normally.
        if (action != null && action.choice === COOP_ME_BATTLE_HANDOFF) {
          const onHandoff = this.onBattleHandoff;
          this.endSession();
          onHandoff?.();
          return;
        }
        // A leave sentinel (owner reached the encounter terminal) OR a null (timeout / partner
        // gone) both mean "stop watching": end + let the caller reconcile to where the run now
        // is (fast-forward the encounter to the next wave if we are still in it - the rewards
        // were already applied by the relayed picks; only the final outro is skipped).
        if (action == null || action.choice === COOP_INTERACTION_LEAVE) {
          const onEnd = this.onLeave;
          this.endSession();
          onEnd?.();
          return;
        }
        const engine = this.engine;
        if (engine != null) {
          // Wait out our own text scroll so the replayed press lands as an ADVANCE, never
          // a discarded press (bounded so a stuck handler can't hang the loop forever).
          let guard = 0;
          while (!engine.isReady() && guard < READY_MAX_TICKS && !this.ended) {
            guard++;
            await this.tick();
          }
          if (!this.ended) {
            engine.applyButton(action.choice);
          }
        }
      }
    } finally {
      this.loopRunning = false;
    }
  }
}

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

/** Routing tag for relayed ME buttons (distinguishes them on the wire / in logs). */
const ME_PUMP_KIND = "meBtn";
/** Default watcher wait for the owner's next button before degrading (generous: a human reads). */
const DEFAULT_ME_WAIT_MS = 300_000;
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
  private ended = true;
  private loopRunning = false;
  private onDegrade: (() => void) | null = null;

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
   */
  beginOwner(seq: number): void {
    if (this.role === "owner" && this.seq === seq && !this.ended) {
      return;
    }
    this.role = "owner";
    this.seq = seq;
    this.ended = false;
  }

  /**
   * WATCHER: begin replaying the owner's buttons for ME interaction `seq`, and start the
   * (single) replay loop. Idempotent on an already-active same-seq session (nested
   * option-selects re-enter here and must NOT spawn a second loop). `onDegrade` is the
   * safe-skip the loop calls on timeout / partner-gone so the run never hangs.
   */
  beginWatcher(seq: number, onDegrade: () => void): void {
    if (this.role === "watcher" && this.seq === seq && !this.ended) {
      return;
    }
    this.role = "watcher";
    this.seq = seq;
    this.ended = false;
    this.onDegrade = onDegrade;
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

  /** OWNER: the ME reached its terminal - send the leave sentinel so the watcher loop ends. */
  endOwner(): void {
    if (this.role === "owner" && !this.ended) {
      this.relay.sendInteractionChoice(this.seq, ME_PUMP_KIND, COOP_INTERACTION_LEAVE);
    }
    this.endSession();
  }

  /** Close the session (terminal / disconnect). The watcher loop unwinds on its next pass. */
  endSession(): void {
    this.ended = true;
    this.role = null;
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
        if (action == null) {
          // Timeout / partner gone: end + let the caller skip this ME to a safe terminal.
          const degrade = this.onDegrade;
          this.endSession();
          degrade?.();
          return;
        }
        if (action.choice === COOP_INTERACTION_LEAVE) {
          this.endSession();
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

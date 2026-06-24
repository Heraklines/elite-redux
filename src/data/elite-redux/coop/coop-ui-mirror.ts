/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Co-op LIVE-CURSOR mirror (#633). A COSMETIC layer over the shared interaction
// screens (reward shop / move-learn / ...): the OWNER drives the real menu and
// relays each button; the WATCHER opens the SAME screen (identical state, same
// seed) and replays those buttons so the partner sees the cursor move / panels
// open in real time. Only the owner controls it; the watcher's local input is
// blocked (by the UI layer).
//
// CRITICAL design rule (so this is safe to ship without two-client testing): the
// relayed input stream is VISUAL ONLY. The authoritative outcome of every screen
// is still the existing `interactionChoice` commit (CoopInteractionRelay) applied
// against the identical pool. So a dropped / late / out-of-order `uiInput` can at
// worst stutter the cursor - it can NEVER change the run state. Truth = the
// choice-commit; this module is just the projector.
//
// Engine-FREE (transport + a tiny injected surface), so the FIFO / barrier / dedup
// logic is unit-testable headlessly over a LoopbackTransport, exactly like the
// other co-op relays.
// =============================================================================

import type { CoopMessage, CoopTransport } from "#data/elite-redux/coop/coop-transport";

/** The live-engine surface the watcher needs, injected so the module stays unit-testable. */
export interface CoopUiMirrorEngine {
  /** The currently-active UiMode (a `UiMode` enum int). */
  getMode(): number;
  /** Replay one relayed owner button into the LOCAL active handler (watcher side). */
  applyButton(button: number): void;
}

type MirrorRole = "owner" | "watcher";

interface MirrorSession {
  role: MirrorRole;
  /** The UiMode this session is bound to; the mirror is inert once the UI leaves it. */
  mode: number;
  /** Shared-screen id (the interaction-counter); distinguishes sessions on the wire. */
  seq: number;
  /** Owner: next outbound index. Watcher: next index to apply (FIFO). */
  n: number;
}

/** Hard cap on buffered pre-session / future-session cursor buttons (cosmetic; oldest dropped). */
const EARLY_BUFFER_CAP = 512;

/**
 * Rides a {@linkcode CoopTransport} to relay/replay cosmetic cursor input for a
 * shared interaction screen. One instance per client. A phase opens a session with
 * {@linkcode beginSession} (it knows whether the local player owns the screen) and
 * closes it with {@linkcode endSession}; the UI layer calls {@linkcode relayOwnerButton}
 * (owner) and feeds replays via the injected engine (watcher).
 */
export class CoopUiMirror {
  private readonly transport: CoopTransport;
  private engine: CoopUiMirrorEngine | null = null;
  private session: MirrorSession | null = null;
  /** Watcher: in-order inbox for the ACTIVE session, keyed by index `n`. */
  private readonly inbox = new Map<number, { button: number; mode: number }>();
  /** Buttons that arrived before our session began (or for a not-yet-active seq). */
  private early: { seq: number; n: number; button: number; mode: number }[] = [];
  private readonly offMessage: () => void;

  constructor(transport: CoopTransport) {
    this.transport = transport;
    this.offMessage = transport.onMessage(msg => this.handle(msg));
  }

  /** Inject the live engine surface (called once by the UI layer). */
  attach(engine: CoopUiMirrorEngine): void {
    this.engine = engine;
  }

  /** Open a shared-screen mirror session. `mode` binds it; `seq` ids it on the wire. */
  beginSession(role: MirrorRole, mode: number, seq: number): void {
    this.session = { role, mode, seq, n: 0 };
    this.inbox.clear();
    if (role === "watcher") {
      // Adopt anything that arrived before we opened, then drain in order.
      for (const e of this.early) {
        if (e.seq === seq) {
          this.inbox.set(e.n, { button: e.button, mode: e.mode });
        }
      }
      this.early = this.early.filter(e => e.seq !== seq);
      this.drain();
    }
  }

  /** Close the active session (selection committed / screen left / disconnect). */
  endSession(): void {
    this.session = null;
    this.inbox.clear();
  }

  /** Whether the mirror governs input for `currentMode` (false unless bound + matching). */
  isActive(currentMode: number): boolean {
    return this.session != null && this.session.mode === currentMode;
  }

  /** Whether the local player is the WATCHER of the active session (blocks local input). */
  isWatcher(): boolean {
    return this.session?.role === "watcher";
  }

  /**
   * OWNER: relay a button the local human just pressed (already processed by the
   * handler). `modeBefore` is the UiMode sampled BEFORE the handler processed it
   * (the watcher's resync barrier). No-op unless we own the active session.
   */
  relayOwnerButton(button: number, modeBefore: number): void {
    const s = this.session;
    if (s == null || s.role !== "owner") {
      return;
    }
    this.transport.send({ t: "uiInput", seq: s.seq, n: s.n++, button, mode: modeBefore });
  }

  /** Stop listening and clear all state. */
  dispose(): void {
    this.offMessage();
    this.session = null;
    this.inbox.clear();
    this.early = [];
    this.engine = null;
  }

  private handle(msg: CoopMessage): void {
    if (msg.t !== "uiInput") {
      return;
    }
    const s = this.session;
    if (s != null && s.role === "watcher" && msg.seq === s.seq) {
      this.inbox.set(msg.n, { button: msg.button, mode: msg.mode });
      this.drain();
      return;
    }
    // Not our active session yet (we may open it momentarily) - buffer, bounded.
    this.early.push({ seq: msg.seq, n: msg.n, button: msg.button, mode: msg.mode });
    if (this.early.length > EARLY_BUFFER_CAP) {
      this.early.shift();
    }
  }

  private drain(): void {
    const s = this.session;
    const engine = this.engine;
    if (s == null || s.role !== "watcher" || engine == null) {
      return;
    }
    for (;;) {
      const next = this.inbox.get(s.n);
      if (next === undefined) {
        break; // gap or empty -> wait for the missing index
      }
      this.inbox.delete(s.n);
      s.n += 1;
      // Resync barrier: only replay if the watcher's screen is still where the owner
      // was when they pressed it. If it drifted, drop the visual; the authoritative
      // choice-commit will snap the screen to the correct result.
      if (engine.getMode() === next.mode) {
        engine.applyButton(next.button);
      }
    }
  }
}

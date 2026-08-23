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

import { coopLog, coopWarn, isCoopDebug } from "#data/elite-redux/coop/coop-debug";
import type { CoopMessage, CoopTransport } from "#data/elite-redux/coop/coop-transport";

/** The live-engine surface the watcher needs, injected so the module stays unit-testable. */
export interface CoopUiMirrorEngine {
  /** The currently-active UiMode (a `UiMode` enum int). */
  getMode(): number;
  /**
   * Replay one relayed owner button into the LOCAL active handler (watcher side).
   * Returning `false` means the exact handler is present but not actionable yet; the
   * mirror retains the FIFO entry and retries it after the renderer becomes ready.
   * `void` remains accepted for engine-free compatibility surfaces that always apply.
   */
  applyButton(button: number): boolean | void;
  /** Capture the active handler's absolute cosmetic state, when that handler supports it. */
  captureState?(): readonly number[] | null;
  /** Install an absolute cosmetic state on the watcher. `false` means the handler is not ready yet. */
  applyState?(state: readonly number[]): boolean | void;
}

/** Reserved `uiInput.button` value for an absolute cosmetic-state checkpoint. */
export const COOP_UI_MIRROR_STATE = -1;

interface MirrorInput {
  button: number;
  mode: number;
  state: readonly number[] | undefined;
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
/** Renderer-ready retry cadence for an exact, mode-bound cosmetic input. */
const WATCHER_READY_RETRY_MS = 50;
/** Owner-side retry cadence while a freshly reopened handler is still animating. */
const OWNER_STATE_READY_RETRY_MS = 50;

/**
 * Rides a {@linkcode CoopTransport} to relay/replay cosmetic cursor input for a
 * shared interaction screen. One instance per client. A phase opens a session with
 * {@linkcode beginSession} (it knows whether the local player owns the screen) and
 * closes it with {@linkcode endSession}; the UI layer calls {@linkcode relayOwnerButton}
 * (owner) and feeds replays via the injected engine (watcher).
 */
/**
 * #789: session lifecycle hook for the CONTROLLER NAME TAG. Injected by the UI layer
 * (src/ui/coop-controller-tag.ts) so this engine-free module never imports UI code.
 * `role` is the LOCAL player's role in the mirrored screen ("owner" = we control it).
 * N-way ready: the tag derives the controlling player's NAME from the session controller,
 * so 3/6-player seats work unchanged once the controller maps seats to names.
 */
let uiMirrorSessionHook: ((active: boolean, role: MirrorRole) => void) | null = null;

export function setCoopUiMirrorSessionHook(hook: (active: boolean, role: MirrorRole) => void): void {
  uiMirrorSessionHook = hook;
}

export class CoopUiMirror {
  private readonly transport: CoopTransport;
  private engine: CoopUiMirrorEngine | null = null;
  private session: MirrorSession | null = null;
  /** Watcher: in-order inbox for the ACTIVE session, keyed by index `n`. */
  private readonly inbox = new Map<number, MirrorInput>();
  /** Buttons that arrived before our session began (or for a not-yet-active seq). */
  private early: ({ seq: number; n: number } & MirrorInput)[] = [];
  private readonly offMessage: () => void;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private ownerStateRetryTimer: ReturnType<typeof setTimeout> | null = null;
  private deferredInputKey: string | null = null;

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
    // A continuing shop result can reopen/rebind the same logical reward screen on only one peer. The wire
    // sequence still denotes the same cosmetic session, so restarting its local `n` at zero would make the
    // other peer discard every post-purchase cursor input as a duplicate until the old high-water mark was
    // reached. Treat an identical begin as a resume; a genuinely new interaction/reroll has a different seq.
    if (this.session?.role === role && this.session.mode === mode && this.session.seq === seq) {
      coopLog("interaction", `uiMirror resumeSession role=${role} mode=${mode} seq=${seq} n=${this.session.n}`);
      if (role === "watcher") {
        this.drain();
      }
      return;
    }
    this.clearRetryTimer();
    this.clearOwnerStateRetryTimer();
    try {
      uiMirrorSessionHook?.(true, role);
    } catch {
      /* the tag is cosmetic - never break a session over it */
    }
    coopLog("interaction", `uiMirror beginSession role=${role} mode=${mode} seq=${seq} early=${this.early.length}`);
    this.session = { role, mode, seq, n: 0 };
    this.inbox.clear();
    if (role === "watcher") {
      // Adopt anything that arrived before we opened, then drain in order.
      for (const e of this.early) {
        if (e.seq === seq) {
          this.inbox.set(e.n, { button: e.button, mode: e.mode, state: e.state });
        }
      }
      this.early = this.early.filter(e => e.seq !== seq);
      this.drain();
    }
  }

  /** Close the active session (selection committed / screen left / disconnect). */
  endSession(): void {
    try {
      uiMirrorSessionHook?.(false, "owner");
    } catch {
      /* cosmetic */
    }
    this.session = null;
    this.inbox.clear();
    this.deferredInputKey = null;
    this.clearRetryTimer();
    this.clearOwnerStateRetryTimer();
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
    // HOT (per owner button) - guard the string build. Past the owner-session fence.
    if (isCoopDebug()) {
      coopLog("interaction", `uiMirror OWNER send seq=${s.seq} n=${s.n} button=${button} modeBefore=${modeBefore}`);
    }
    this.transport.send({ t: "uiInput", seq: s.seq, n: s.n++, button, mode: modeBefore });
  }

  /**
   * OWNER: checkpoint the exact cursor state after a shared handler is (re)installed.
   * Relative button replay cannot recover from different per-account cursor preferences or
   * an owner-only nested screen; this ordered, cosmetic snapshot makes the next button start
   * from the same visible location without becoming a mechanical authority path.
   */
  relayOwnerState(modeBefore: number): void {
    const s = this.session;
    if (s == null || s.role !== "owner") {
      return;
    }
    const state = this.engine?.captureState?.();
    if (state == null) {
      this.clearOwnerStateRetryTimer();
      this.ownerStateRetryTimer = setTimeout(() => {
        this.ownerStateRetryTimer = null;
        if (this.session === s && this.engine?.getMode() === modeBefore) {
          this.relayOwnerState(modeBefore);
        }
      }, OWNER_STATE_READY_RETRY_MS);
      return;
    }
    this.clearOwnerStateRetryTimer();
    if (isCoopDebug()) {
      coopLog(
        "interaction",
        `uiMirror OWNER state seq=${s.seq} n=${s.n} mode=${modeBefore} state=[${state.join(",")}]`,
      );
    }
    this.transport.send({
      t: "uiInput",
      seq: s.seq,
      n: s.n++,
      button: COOP_UI_MIRROR_STATE,
      mode: modeBefore,
      state: [...state],
    });
  }

  /** Stop listening and clear all state. */
  dispose(): void {
    this.offMessage();
    this.session = null;
    this.inbox.clear();
    this.early = [];
    this.engine = null;
    this.deferredInputKey = null;
    this.clearRetryTimer();
    this.clearOwnerStateRetryTimer();
  }

  private handle(msg: CoopMessage): void {
    if (msg.t !== "uiInput") {
      return;
    }
    const s = this.session;
    if (s != null && s.role === "watcher" && msg.seq === s.seq) {
      this.inbox.set(msg.n, { button: msg.button, mode: msg.mode, state: msg.state });
      this.drain();
      return;
    }
    // Not our active session yet (we may open it momentarily) - buffer, bounded.
    this.early.push({ seq: msg.seq, n: msg.n, button: msg.button, mode: msg.mode, state: msg.state });
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
      // Resync barrier: only replay if the watcher's screen is still where the owner
      // was when they pressed it. If it drifted, drop the visual; the authoritative
      // choice-commit will snap the screen to the correct result.
      const liveMode = engine.getMode();
      if (liveMode === next.mode) {
        // DEFENSE-IN-DEPTH (#852): the mirror is COSMETIC (see the module header) - the
        // authoritative outcome is the choice-commit. A render/handler error while replaying a
        // relayed cursor button (e.g. a UI reader touching an unbuilt object) must NEVER kill the
        // watcher client: swallow it LOUDLY and keep the session alive. The screen continues with a
        // degraded (frozen-cursor) mirror; the choice-commit + anti-hang machinery heal the rest.
        try {
          const applied =
            next.button === COOP_UI_MIRROR_STATE && next.state != null
              ? engine.applyState?.(next.state)
              : engine.applyButton(next.button);
          if (applied === false) {
            // The owner can become actionable before a CPU-dilated watcher finishes the same reward
            // animation. Consuming this FIFO entry here permanently freezes the watcher's cursor.
            // Retain the exact entry and retry only while this same mode-bound session remains live.
            const deferredInputKey = `${s.seq}:${s.n}`;
            if (isCoopDebug() && this.deferredInputKey !== deferredInputKey) {
              coopLog("interaction", `uiMirror WATCHER DEFER n=${s.n} button=${next.button} mode=${next.mode}`);
            }
            this.deferredInputKey = deferredInputKey;
            this.scheduleDrainRetry();
            break;
          }
          this.inbox.delete(s.n);
          s.n += 1;
          this.deferredInputKey = null;
          if (isCoopDebug()) {
            coopLog("interaction", `uiMirror WATCHER apply n=${s.n - 1} button=${next.button} mode=${next.mode}`);
          }
          if (this.session !== s) {
            break;
          }
        } catch (e) {
          this.inbox.delete(s.n);
          s.n += 1;
          this.deferredInputKey = null;
          coopWarn(
            "interaction",
            `uiMirror WATCHER applyButton threw (handled, session kept alive) n=${s.n - 1} button=${next.button} mode=${next.mode}`,
            e,
          );
        }
      } else if (isCoopDebug()) {
        this.inbox.delete(s.n);
        s.n += 1;
        this.deferredInputKey = null;
        // Cosmetic drift drop (harmless; the choice-commit heals the screen) - still log it.
        coopLog(
          "interaction",
          `uiMirror WATCHER DROP n=${s.n - 1} button=${next.button} ownerMode=${next.mode} liveMode=${liveMode} (cursor drift)`,
        );
      } else {
        this.inbox.delete(s.n);
        s.n += 1;
        this.deferredInputKey = null;
      }
    }
  }

  private scheduleDrainRetry(): void {
    if (this.retryTimer != null) {
      return;
    }
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      this.drain();
    }, WATCHER_READY_RETRY_MS);
  }

  private clearRetryTimer(): void {
    if (this.retryTimer == null) {
      return;
    }
    clearTimeout(this.retryTimer);
    this.retryTimer = null;
  }

  private clearOwnerStateRetryTimer(): void {
    if (this.ownerStateRetryTimer != null) {
      clearTimeout(this.ownerStateRetryTimer);
      this.ownerStateRetryTimer = null;
    }
  }
}

/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Active co-op session registry (#633, co-op mode - phase P1).
//
// A module-level singleton holding the in-progress co-op session for the current
// run. Lives here (NOT as a field on BattleScene) so the mode-entry menu, the
// starter-select phase, and later the battle phases can all reach the session
// without threading it through `globalScene` - and so co-op stays a self-contained
// module that never edits the shared battle-scene file.
//
// During local development the session is host + a SpoofGuest over a
// LoopbackTransport (a stand-in player 2); at phase P6 the same `controller` is
// constructed over a real WebRTC transport instead and nothing here changes.
// =============================================================================

import { globalScene } from "#app/global-scene";
import { setCoopAuthoritativeGuestPredicate } from "#data/elite-redux/coop/coop-authoritative-gate";
import { COOP_CHECKSUM_SENTINEL } from "#data/elite-redux/coop/coop-battle-checksum";
import {
  applyCoopFullSnapshot,
  captureCoopCaptureParty,
  captureCoopChecksum,
  captureCoopEnemies,
  captureCoopExpDeltas,
  captureCoopFullSnapshot,
} from "#data/elite-redux/coop/coop-battle-engine";
import { CoopBattleStreamer } from "#data/elite-redux/coop/coop-battle-stream";
import { CoopBattleSync } from "#data/elite-redux/coop/coop-battle-sync";
import { coopLog, coopWarn, isCoopDebug } from "#data/elite-redux/coop/coop-debug";
import { CoopInteractionRelay } from "#data/elite-redux/coop/coop-interaction-relay";
import { meBattleHandoffKey } from "#data/elite-redux/coop/coop-me-battle-handoff";
import { CoopMePump } from "#data/elite-redux/coop/coop-me-pump";
import { coopOwnerOfFieldIndex } from "#data/elite-redux/coop/coop-session";
import { CoopSessionController } from "#data/elite-redux/coop/coop-session-controller";
import { SpoofGuest } from "#data/elite-redux/coop/coop-spoof-guest";
import type {
  CoopCapturePresentation,
  CoopExpDelta,
  CoopFullBattleSnapshot,
  CoopNetcodeMode,
  CoopSerializedEnemy,
  CoopWaveOutcome,
} from "#data/elite-redux/coop/coop-transport";
import { type CoopTransport, createLoopbackPair, type SerializedCommand } from "#data/elite-redux/coop/coop-transport";
import { setCoopLiveEmitter } from "#data/elite-redux/coop/coop-turn-recorder";
import { CoopUiMirror } from "#data/elite-redux/coop/coop-ui-mirror";
import { setCoopGhostFetchSuppressed, setCoopGhostPool, setGhostPoolPublisher } from "#data/elite-redux/er-ghost-teams";
import { compressToBase64, decompressFromBase64 } from "lz-string";

/**
 * Co-op ghost-pool sync (#633): the HOST broadcasts its server-fetched ghost-team
 * pool over the battle stream; the GUEST adopts it verbatim and skips its own fetch,
 * so `takeGhostForWave`'s seeded pick is deterministic on both clients (they otherwise
 * download divergent pools and field different ghost trainers = high-wave desync).
 * Gated on the LIVE controller role at send/receive time, so a pre-battle role
 * reconciliation is handled. Cleared in {@linkcode clearCoopRuntime}.
 */
function wireCoopGhostPoolSync(controller: CoopSessionController, battleStream: CoopBattleStreamer): void {
  setGhostPoolPublisher(pool => {
    if (controller.role === "host") {
      battleStream.sendGhostPool(pool);
    }
  });
  setCoopGhostFetchSuppressed(() => controller.role === "guest");
  battleStream.onGhostPool(pool => {
    if (controller.role === "guest") {
      setCoopGhostPool(pool);
    }
  });
}

/**
 * Co-op LIVE battle-event emitter (#633, animation layer): wire the host turn recorder so each visible
 * event (move / hp / faint / stat) is streamed the INSTANT it is recorded, with a per-turn monotonic
 * `seq`, instead of only batching at turn-end. The guest buffers them by `(turn, seq)` and replays them
 * in order (de-duping the turn-end batch) so it watches the fight with minimal lag. Gated on the LIVE
 * host role in the AUTHORITATIVE netcode at send time (a guest / solo / lockstep client never emits), so
 * the existing Phase-1 turn-end batch is unaffected for everyone else. Cleared in {@linkcode clearCoopRuntime}.
 */
function wireCoopLiveEvents(controller: CoopSessionController, battleStream: CoopBattleStreamer): void {
  setCoopLiveEmitter((turn, seq, event) => {
    if (controller.role !== "host" || getCoopNetcodeMode() !== "authoritative") {
      return;
    }
    if (isCoopDebug()) {
      coopLog("runtime", `ME-stream live-event host turn=${turn} seq=${seq} k=${event.k}`);
    }
    battleStream.emitEvent(turn, seq, event);
  });
}

/**
 * Co-op resync responder (#633, TRACK-2): the HOST answers a guest's `requestStateSync`
 * (sent when the guest's post-turn checksum disagreed with the host's) by serializing its
 * FULL authoritative battle state, lz-compressing it, and streaming it back stamped with
 * the request `seq`. The guest decompresses + adopts it field-by-field. Gated on the live
 * HOST role so a guest/solo client never answers. Best-effort + guarded - a serialize
 * failure never breaks the host's turn.
 */
function wireCoopResyncResponder(controller: CoopSessionController, battleStream: CoopBattleStreamer): void {
  battleStream.onStateSyncRequest((_turn, seq) => {
    coopLog("resync", `recv requestStateSync turn=${_turn} seq=${seq} role=${controller.role}`);
    if (controller.role !== "host") {
      coopLog("resync", `ignore requestStateSync seq=${seq} (not host, role=${controller.role})`);
      return;
    }
    try {
      const snapshot = captureCoopFullSnapshot();
      if (snapshot == null) {
        coopWarn("resync", `host has no live snapshot for requestStateSync seq=${seq} -> no reply`);
        return;
      }
      const blob = compressToBase64(JSON.stringify(snapshot));
      coopLog("resync", `send stateSync seq=${seq} blob=${blob.length}b`);
      battleStream.sendStateSync(blob, seq);
    } catch (e) {
      /* a resync serialize/send failure must never break the host's turn */
      coopWarn("resync", `host stateSync send failed seq=${seq}`, e);
    }
  });
}

/**
 * Co-op enemy-party RE-REQUEST responder (#633/#698, handoff robustness): the HOST answers a
 * guest's `requestEnemyParty` by RE-broadcasting its enemy party for that wave - but ONLY when
 * the host has actually generated it (its live `currentBattle.waveIndex` matches AND the enemy
 * party is non-empty). Before that, the request is a harmless no-op: the host has not reached
 * its one-shot `broadcastCoopEnemyParty` in EncounterPhase yet, and when it does the guest's
 * parked waiter consumes it. This is the recovery arm for a LOST original `enemyPartySync` (or a
 * guest that reached its await first) so the guest pulls the party on demand instead of hard-
 * blocking the 120s ceiling. Gated on the live HOST role; a guest/solo client never answers.
 * Best-effort + guarded - a serialize/send failure never breaks the host's encounter.
 */
function wireCoopEnemyPartyResponder(controller: CoopSessionController, battleStream: CoopBattleStreamer): void {
  battleStream.onEnemyPartyRequest(wave => {
    coopLog("stream", `recv requestEnemyParty wave=${wave} role=${controller.role}`);
    if (controller.role !== "host") {
      coopLog("stream", `ignore requestEnemyParty wave=${wave} (not host, role=${controller.role})`);
      return;
    }
    const battle = globalScene.currentBattle;
    if (battle == null || battle.waveIndex !== wave) {
      coopLog(
        "stream",
        `requestEnemyParty wave=${wave} no-op (host wave=${battle?.waveIndex ?? "none"} not yet at this encounter)`,
      );
      return;
    }
    try {
      const enemies = captureCoopEnemies();
      if (enemies.length === 0) {
        coopLog("stream", `requestEnemyParty wave=${wave} no-op (host enemy party not generated yet)`);
        return;
      }
      coopLog("stream", `re-broadcast enemyPartySync wave=${wave} count=${enemies.length} (host, on guest request)`);
      battleStream.sendEnemyParty(wave, enemies);
    } catch (e) {
      /* a re-broadcast serialize/send failure must never break the host's encounter */
      coopWarn("stream", `host re-broadcast enemyPartySync failed wave=${wave}`, e);
    }
  });
}

/**
 * Co-op authoritative WAVE-ADVANCE handshake (#633): a one-shot pending outcome the GUEST
 * has been told the host RESOLVED, plus the last wave it already advanced past (the
 * double-advance guard). The guest is a pure renderer - it removes KOd enemies WITHOUT a
 * FaintPhase / AttemptCapturePhase, so it never gets the victory tail those phases queue and
 * would loop the won wave forever. {@linkcode wireCoopWaveResolved} sets `pendingWaveAdvance`
 * on receipt; {@linkcode consumeCoopPendingWaveAdvance} hands it to the guest's
 * `CoopReplayTurnPhase` at the next SAFE turn boundary (NEVER mid-replay) so it runs the tail.
 */
let pendingWaveAdvance: {
  wave: number;
  outcome: CoopWaveOutcome;
  captureParty?: string[] | undefined;
  capturePresentation?: CoopCapturePresentation | undefined;
} | null = null;
/** The last wave the guest already ran the victory tail for (guards a duplicate `waveResolved`). */
let lastResolvedWave = -1;

/**
 * Co-op authoritative EXP (#633 B5): the host's settled per-slot exp / level / moveset for a wave the
 * GUEST has not yet applied, plus the last wave it already applied (the double-apply guard). The host
 * streams `expResolved` from its `BattleEndPhase` (after the exp chain drained); the guest stores it
 * here ({@linkcode wireCoopExpResolved}) and CONSUMES it in its OWN `BattleEndPhase`
 * ({@linkcode consumeCoopPendingExpDeltas}). Kept SEPARATE from the wave-advance handshake so that
 * proven path is byte-identical; this is an orthogonal, idempotent, additive exp-only channel.
 */
let pendingExpDeltas: { wave: number; deltas: CoopExpDelta[] } | null = null;
/** The last wave the guest already applied exp deltas for (guards a duplicate `expResolved`). */
let lastExpResolvedWave = -1;

/**
 * GUEST: take + clear any pending host exp deltas (#633 B5). Returns the host's settled per-slot
 * exp / level / moveset to apply, or null when none is pending or this wave was already applied.
 * Called by the guest's `BattleEndPhase`. Bumps the double-apply guard so a duplicate `expResolved`
 * for the same wave is a no-op.
 */
export function consumeCoopPendingExpDeltas(): CoopExpDelta[] | null {
  const pending = pendingExpDeltas;
  pendingExpDeltas = null;
  if (pending == null || pending.wave <= lastExpResolvedWave) {
    return null;
  }
  lastExpResolvedWave = pending.wave;
  coopLog("runtime", `consume expResolved wave=${pending.wave} deltas=${pending.deltas.length}`);
  return pending.deltas;
}

/**
 * GUEST: take + clear any pending wave-advance the host signaled (#633). Returns the
 * outcome to run the victory tail for, or null when none is pending or this wave was
 * already advanced past. Called by `CoopReplayTurnPhase` at a safe boundary. Bumps the
 * double-advance guard so a duplicate `waveResolved` for the same wave is a no-op.
 */
/**
 * PEEK (non-consuming, #698 softlock): whether a wave-advance is pending for a wave the guest has NOT
 * yet advanced past. The guest's finalize uses this to take the TERMINAL path (run the victory tail,
 * do NOT advance the turn) even when the win is consumed in the SAME turn it arrives - otherwise the
 * minimal turn-advance starts a phantom next turn the host already passed (the guest then awaits a
 * turn-N+1 resolution the host - now in the reward shop - never sends -> softlock after the battle).
 */
export function coopHasPendingWaveAdvance(): boolean {
  return pendingWaveAdvance != null && pendingWaveAdvance.wave > lastResolvedWave;
}

export function consumeCoopPendingWaveAdvance(): {
  wave: number;
  outcome: CoopWaveOutcome;
  captureParty?: string[] | undefined;
  capturePresentation?: CoopCapturePresentation | undefined;
} | null {
  const pending = pendingWaveAdvance;
  pendingWaveAdvance = null;
  if (pending == null || pending.wave <= lastResolvedWave) {
    if (isCoopDebug() && pending != null) {
      coopLog("runtime", `consume wave-advance SKIP wave=${pending.wave} <= lastResolved=${lastResolvedWave}`);
    }
    return null;
  }
  coopLog(
    "runtime",
    `consume wave-advance wave=${pending.wave} outcome=${pending.outcome} (lastResolved ${lastResolvedWave} -> ${pending.wave})`,
  );
  lastResolvedWave = pending.wave;
  return pending;
}

/**
 * GUEST (#633/#698/#696/#697 post-battle softlock): whether `wave`'s authoritative WAVE-ADVANCE has
 * ALREADY been consumed/run (`lastResolvedWave >= wave`) - i.e. a prior finalize already queued this
 * wave's victory/flee/game-over tail. In that state the wave has ENDED on the host, so the guest must
 * NOT loop back into a new battle turn for it: a `turnResolution` for that wave's FINAL (post-KO) turn
 * that the guest replays AFTER the tail was queued must be TERMINAL (render the events + apply the
 * checkpoint, both already done by the finalize) and must NOT queue the guest's turn-end phases (whose
 * trailing `TurnEndPhase` increments the turn and loops into a phantom next `CommandPhase` for a turn
 * the host already passed -> the guest broadcasts a command + `awaitTurn` for turn N+1 the host never
 * resolves -> the deadlock).
 *
 * Deliberately checks ONLY the ALREADY-RUN guard (`lastResolvedWave`), NOT a still-PENDING signal: an
 * EARLIER turn of the wave can finalize while a `waveResolved` is merely pending (it consumes + runs the
 * tail itself), and that earlier turn's turn-end loop is legitimately needed to reach the wave's FINAL
 * (KO) turn - suppressing it there would skip rendering the KO turn. Only once the tail has actually run
 * (the guard is bumped) is a further same-wave finalize a post-resolution phantom to suppress.
 *
 * Read-only (no mutation, never bumps the guard). Hard-gated by the caller to the authoritative guest,
 * so host / solo / lockstep never reach it. Pure on its `wave` argument.
 */
export function coopWaveAdvanceSignaledFor(wave: number): boolean {
  return wave <= lastResolvedWave;
}

/**
 * Merge an incoming `waveResolved` into the existing pending one (#633 B1 fix). The latest signal for
 * a NEW (>=) wave wins, BUT a `captureParty` is PRESERVED across a SAME-WAVE supersession: a co-op
 * DOUBLE wild battle resolves ONE wave with BOTH a `"capture"` (carrying the caught party) AND a
 * `"win"` (carrying none) - they arrive back-to-back, and before this the later message (whichever
 * order) clobbered the captured party, so the caught mon never reached the guest. This keeps whichever
 * message carried the party. Returns the pending to store, or `null` to KEEP the existing later-wave
 * pending unchanged (a stale earlier-wave signal). Pure - exported for unit testing.
 */
export function mergeCoopPendingWaveAdvance(
  prev: {
    wave: number;
    outcome: CoopWaveOutcome;
    captureParty?: string[] | undefined;
    capturePresentation?: CoopCapturePresentation | undefined;
  } | null,
  wave: number,
  outcome: CoopWaveOutcome,
  captureParty: string[] | undefined,
  capturePresentation?: CoopCapturePresentation | undefined,
): {
  wave: number;
  outcome: CoopWaveOutcome;
  captureParty?: string[] | undefined;
  capturePresentation?: CoopCapturePresentation | undefined;
} | null {
  if (prev != null && wave < prev.wave) {
    return null; // a stale earlier-wave signal: keep the existing later-wave pending.
  }
  // Carry forward a captureParty from the same wave's other message (either arrival order).
  const carriedCapture = captureParty ?? (prev != null && prev.wave === wave ? prev.captureParty : undefined);
  // Carry the cosmetic capturePresentation across a same-wave supersession EXACTLY like captureParty,
  // so a "win" arriving after the "capture" in a double battle does not drop the ball animation (#689).
  const carriedPresentation =
    capturePresentation ?? (prev != null && prev.wave === wave ? prev.capturePresentation : undefined);
  return { wave, outcome, captureParty: carriedCapture, capturePresentation: carriedPresentation };
}

/**
 * Co-op authoritative wave-advance responder (#633): the GUEST records the host's
 * `waveResolved` signal as a one-shot pending flag (guarded against a double-advance by
 * wave number). It is consumed at the next safe turn boundary by `CoopReplayTurnPhase`
 * (NOT applied here mid-message) so an in-flight replay turn finishes first. Gated on the
 * live GUEST role in the AUTHORITATIVE netcode; a host / solo / lockstep client ignores it.
 */
function wireCoopWaveResolved(controller: CoopSessionController, battleStream: CoopBattleStreamer): void {
  battleStream.onWaveResolved((wave, outcome, captureParty, capturePresentation) => {
    coopLog(
      "runtime",
      `recv waveResolved wave=${wave} outcome=${outcome} role=${controller.role} netcode=${getCoopNetcodeMode()}`,
    );
    if (controller.role !== "guest" || getCoopNetcodeMode() !== "authoritative") {
      coopLog("runtime", `ignore waveResolved wave=${wave} (not authoritative guest)`);
      return;
    }
    // Already advanced past this wave (a duplicate signal) -> ignore.
    if (wave <= lastResolvedWave) {
      coopLog("runtime", `ignore waveResolved wave=${wave} <= lastResolved=${lastResolvedWave} (duplicate)`);
      return;
    }
    // Latest signal wins (a later wave supersedes an unconsumed earlier one), but a captureParty is
    // PRESERVED across a same-wave supersession (see mergeCoopPendingWaveAdvance).
    const merged = mergeCoopPendingWaveAdvance(pendingWaveAdvance, wave, outcome, captureParty, capturePresentation);
    if (merged == null) {
      coopWarn("runtime", `waveResolved wave=${wave} stale vs pending=${pendingWaveAdvance?.wave} -> kept pending`);
    } else {
      coopLog(
        "runtime",
        `pend waveResolved wave=${wave} outcome=${outcome}${merged.captureParty == null ? "" : ` captureParty=${merged.captureParty.length}`} (prevPending=${pendingWaveAdvance?.wave ?? "none"})`,
      );
      pendingWaveAdvance = merged;
    }
  });
}

/**
 * Co-op authoritative EXP responder (#633 B5): the GUEST records the host's `expResolved` (the
 * settled per-slot exp / level / moveset) as a one-shot pending payload (guarded against a
 * double-apply by wave number). It is consumed in the guest's own `BattleEndPhase` (NOT applied here
 * mid-message) so it lands at a real phase boundary, AFTER the guest's VictoryPhase tail queues
 * BattleEnd. Gated on the live GUEST role in the AUTHORITATIVE netcode; host / solo / lockstep ignore.
 */
function wireCoopExpResolved(controller: CoopSessionController, battleStream: CoopBattleStreamer): void {
  battleStream.onExpResolved((wave, deltas) => {
    if (controller.role !== "guest" || getCoopNetcodeMode() !== "authoritative") {
      return;
    }
    // Already applied past this wave (a duplicate signal) -> ignore.
    if (wave <= lastExpResolvedWave) {
      return;
    }
    // Latest wave's deltas win (a later wave supersedes an unconsumed earlier one).
    if (pendingExpDeltas == null || wave >= pendingExpDeltas.wave) {
      coopLog("runtime", `pend expResolved wave=${wave} deltas=${deltas.length}`);
      pendingExpDeltas = { wave, deltas };
    }
  });
}

/**
 * Co-op ME-state self-check (#633, TRACK-2 Phase C): the WATCHER verifies the owner's
 * full-state checksum at a mystery-encounter boundary against its OWN. The ME pump replays
 * the owner's button stream into the watcher's own ME state - safe ONLY if that state is
 * identical. On a MISMATCH the watcher requests the authoritative `stateSync` and adopts it,
 * turning the pump's silent "identical state" assumption into detect-and-heal (reusing the
 * Phase A machinery). Additive: on a match nothing changes, so the working pump is intact.
 */
function wireCoopMeChecksumCheck(battleStream: CoopBattleStreamer): void {
  battleStream.onMeChecksum((seq, ownerChecksum) => {
    const ours = captureCoopChecksum();
    if (ownerChecksum === COOP_CHECKSUM_SENTINEL || ours === COOP_CHECKSUM_SENTINEL || ownerChecksum === ours) {
      coopLog("checksum", `recv meChecksum seq=${seq} MATCH owner=${ownerChecksum} watcher=${ours}`);
      return;
    }
    coopWarn("checksum", `me-entry MISMATCH seq=${seq} owner=${ownerChecksum} watcher=${ours} -> requesting stateSync`);
    coopLog("resync", `await stateSync start seq=${seq}`);
    void battleStream.requestStateSync(seq).then(blob => {
      if (blob == null) {
        coopWarn("resync", `await stateSync TIMEOUT/null seq=${seq}`);
        return;
      }
      coopLog("resync", `await stateSync resolve seq=${seq} blob=${blob.length}b -> applying`);
      try {
        applyCoopFullSnapshot(
          JSON.parse(decompressFromBase64(blob)) as CoopFullBattleSnapshot,
          isCoopAuthoritativeGuest(),
        );
        const healed = captureCoopChecksum();
        if (healed === ownerChecksum) {
          coopLog("resync", `me-entry seq=${seq} ok (healed=${healed})`);
        } else {
          coopWarn("resync", `me-entry seq=${seq} still-diverged owner=${ownerChecksum} watcher=${healed}`);
        }
      } catch (e) {
        /* a malformed resync blob must never crash the ME flow */
        coopWarn("resync", `me-entry seq=${seq} malformed resync blob (ignored)`, e);
      }
    });
  });
}

/**
 * Co-op AUTHORITATIVE move-learn forward listener (#633 BUG3+5). Unsubscribe handle for the
 * persistent transport listener that spawns the guest's {@linkcode CoopReplayLearnMovePhase}. Stored
 * module-scoped so {@linkcode clearCoopRuntime} can drop it (and the in-flight slot set) on teardown.
 */
let offLearnMoveForward: (() => void) | null = null;
/** Slots with a learn-move picker already spawned this session (prevents a duplicate-message re-open). */
const learnMoveForwardInFlight = new Set<number>();

/**
 * Install the persistent AUTHORITATIVE-GUEST move-learn forward listener (#633 BUG3+5). Covers the
 * LEVEL-UP case where the guest runs NO {@linkcode LearnMovePhase} (its engine is parked in
 * CoopReplayTurnPhase): when the host streams a `learnMoveForward` interactionOutcome, the guest spawns
 * a single {@linkcode CoopReplayLearnMovePhase} to render the move-forget picker and relay the human's
 * index back on the disjoint `9_100_000 + partySlot` seq. It is the SOLE renderer (the guest's own
 * Shroom-queued LearnMovePhase no-ops in authoritative mode), so the picker opens EXACTLY once per learn.
 *
 * Gated hard on {@linkcode isCoopAuthoritativeGuest} (false for solo / host / lockstep), so it is a
 * dead no-op outside an authoritative-guest run. An in-flight slot guard ignores a duplicate message
 * for a slot whose picker is still open. Cleared in {@linkcode clearCoopRuntime}.
 */
function wireCoopLearnMoveForward(transport: CoopTransport): void {
  offLearnMoveForward = transport.onMessage(msg => {
    if (msg.t !== "interactionOutcome" || msg.outcome.k !== "learnMoveForward") {
      return;
    }
    if (!isCoopAuthoritativeGuest()) {
      return;
    }
    const { partySlot, moveId, maxMoveCount } = msg.outcome;
    if (learnMoveForwardInFlight.has(partySlot)) {
      coopLog("learnmove", `recv learnMoveForward slot=${partySlot} IGNORE (picker already in-flight)`);
      return;
    }
    coopLog(
      "learnmove",
      `recv learnMoveForward slot=${partySlot} moveId=${moveId} maxMoveCount=${maxMoveCount} -> spawn CoopReplayLearnMovePhase`,
    );
    learnMoveForwardInFlight.add(partySlot);
    try {
      globalScene.phaseManager.unshiftNew("CoopReplayLearnMovePhase", partySlot, moveId, maxMoveCount);
    } catch (e) {
      // A spawn failure must never hang the run: the host's own await times out to "keep current
      // moves". Drop the in-flight mark so a retry/resend can re-spawn.
      learnMoveForwardInFlight.delete(partySlot);
      coopWarn("learnmove", `spawn CoopReplayLearnMovePhase failed slot=${partySlot} (host await falls back)`, e);
    }
  });
}

/** Co-op (#633 BUG3+5): clear a slot's in-flight learn-move picker mark once its phase ends. */
export function clearCoopLearnMoveForwardInFlight(partySlot: number): void {
  learnMoveForwardInFlight.delete(partySlot);
}

/** Everything tied to one live co-op session. */
export interface CoopRuntime {
  /** The local player's session brain (host authority in the spoof/dev path). */
  controller: CoopSessionController;
  /** Relays the partner's in-battle command over the transport (#633, LIVE-C). */
  battleSync: CoopBattleSync;
  /** Host-authoritative battle stream: host->guest enemy party + per-turn checkpoints (#633, LIVE-D). */
  battleStream: CoopBattleStreamer;
  /** Owner->watcher relay for alternating reward/shop/ME interactions (#633). */
  interactionRelay: CoopInteractionRelay;
  /** Owner->watcher COSMETIC live-cursor mirror for shared interaction screens (#633). */
  uiMirror: CoopUiMirror;
  /** Owner->watcher AUTHORITATIVE input pump for whole mystery-encounter lockstep (#633). */
  mePump: CoopMePump;
  /** The local client's transport endpoint. */
  localTransport: CoopTransport;
  /** The spoofed partner's transport endpoint (local dev only; absent for real peers). */
  partnerTransport?: CoopTransport;
  /** The stand-in player 2 (local dev only). */
  spoof?: SpoofGuest;
}

let active: CoopRuntime | null = null;

/**
 * Authoritative LATCH (#633 trainer-victory deadlock): once an active co-op session has been
 * observed in "authoritative" netcode, an active session STAYS authoritative for the rest of
 * the run. Guards the guest from silently falling back to "lockstep" mid-run (e.g. a transient
 * read where the controller's `_netcodeMode` had not yet adopted the host's runConfig, or a
 * controller re-read race) - which would make TurnStartPhase NOT divert to CoopReplayTurnPhase
 * and the guest run its OWN engine + the waveResolved tail (a double-advance / desync). Reset in
 * {@linkcode clearCoopRuntime} so a subsequent run (incl. a solo / lockstep one) starts clean.
 */
let authoritativeLatched = false;

/** Register the live co-op session (called when a co-op run is being set up). */
export function setCoopRuntime(runtime: CoopRuntime): void {
  active = runtime;
  // Install the cycle-free authoritative-guest predicate (#633 B6) so `field/pokemon.ts` can gate the
  // Shedinja party-add without importing this module (which would close a value-level import cycle).
  setCoopAuthoritativeGuestPredicate(isCoopAuthoritativeGuest);
}

/** The live co-op session, or null when not in a co-op run. */
export function getCoopRuntime(): CoopRuntime | null {
  return active;
}

/** Convenience: the live session controller, or null when not in a co-op run. */
export function getCoopController(): CoopSessionController | null {
  return active?.controller ?? null;
}

/**
 * The active co-op netcode (#633, selectable A/B), or `"lockstep"` when there is no
 * live session. This is the SINGLE read point every co-op gate uses to decide
 * between the lockstep (both engines resolve) and authoritative (guest renders)
 * implementations. Deliberately does NOT touch globalScene - it is a pure controller
 * read so the engine-free unit tests can call it.
 */
export function getCoopNetcodeMode(): CoopNetcodeMode {
  // No live session -> lockstep (solo / non-coop / lockstep run, byte-for-byte unchanged).
  if (active == null) {
    return "lockstep";
  }
  const mode = active.controller.netcodeMode;
  // Latch authoritative (#633 trainer-victory deadlock): once an active session is authoritative,
  // keep returning it for the rest of the run so a transient controller read (pre-runConfig, a
  // re-read race) can NEVER flip the guest back to "lockstep" and make it run its own engine.
  if (mode === "authoritative") {
    if (!authoritativeLatched) {
      // State CHANGE: log the one-time latch flip (NOT on every hot read).
      coopLog("runtime", `netcode LATCH authoritative role=${active.controller.role} (was unlatched)`);
    }
    authoritativeLatched = true;
    return "authoritative";
  }
  if (authoritativeLatched && isCoopDebug()) {
    // Controller momentarily reads lockstep but the latch holds authoritative (re-read race / pre-runConfig).
    coopWarn(
      "runtime",
      `netcode read=${mode} but latched authoritative role=${active.controller.role} -> authoritative`,
    );
  }
  return authoritativeLatched ? "authoritative" : mode;
}

/**
 * Whether THIS client is the GUEST of a live AUTHORITATIVE co-op session (#633). The single read
 * point for the "guest renders, host is authoritative" gates that must NOT mutate shared
 * host-owned state (e.g. the shared money pool). Hard `false` for solo / lockstep / the host, so
 * those paths are byte-for-byte unaffected.
 */
export function isCoopAuthoritativeGuest(): boolean {
  return active != null && getCoopNetcodeMode() === "authoritative" && active.controller.role === "guest";
}

/** Convenience: the live battle-command relay, or null when not in a co-op run. */
export function getCoopBattleSync(): CoopBattleSync | null {
  return active?.battleSync ?? null;
}

/** Convenience: the host-authoritative battle stream, or null when not in a co-op run. */
export function getCoopBattleStreamer(): CoopBattleStreamer | null {
  return active?.battleStream ?? null;
}

/** Convenience: the alternating-interaction relay, or null when not in a co-op run. */
export function getCoopInteractionRelay(): CoopInteractionRelay | null {
  return active?.interactionRelay ?? null;
}

/** Convenience: the live-cursor UI mirror, or null when not in a co-op run. */
export function getCoopUiMirror(): CoopUiMirror | null {
  return active?.uiMirror ?? null;
}

/** Convenience: the mystery-encounter input pump, or null when not in a co-op run. */
export function getCoopMePump(): CoopMePump | null {
  return active?.mePump ?? null;
}

/** Whether a co-op session is currently active. */
export function isCoopRuntimeActive(): boolean {
  return active != null;
}

/**
 * Broadcast the LOCAL human's RESOLVED own-slot FIGHT command to the partner (#633).
 * Shared by {@linkcode CommandPhase} (moves with no target prompt) and
 * {@linkcode SelectTargetPhase} (the deferred broadcast once the human has actually
 * picked the target), so the partner applies the EXACT chosen target instead of
 * re-resolving a multi-candidate single-target move on a mon it does not control.
 *
 * Hard no-op unless we are in a live co-op run AND `fieldIndex` is the local player's
 * OWN slot (the partner slot is the one we AWAIT, never broadcast) - so the solo path
 * and the partner-slot path are byte-for-byte unaffected.
 */
export function broadcastCoopOwnSlotCommand(fieldIndex: number, command: SerializedCommand): void {
  if (!globalScene.gameMode.isCoop || active == null) {
    return;
  }
  const owner = coopOwnerOfFieldIndex(fieldIndex);
  if (owner !== active.controller.role) {
    if (isCoopDebug()) {
      coopLog("owner", `broadcast SKIP fi=${fieldIndex} owner=${owner} != role=${active.controller.role} (await slot)`);
    }
    return;
  }
  if (isCoopDebug()) {
    coopLog(
      "owner",
      `broadcast own-slot fi=${fieldIndex} turn=${globalScene.currentBattle.turn} role=${active.controller.role} cmd=${command.command}`,
    );
  }
  active.battleSync.broadcastLocalCommand(fieldIndex, globalScene.currentBattle.turn, command);
}

/**
 * HOST -> GUEST (#633, authoritative wave-advance handshake): tell the guest the host
 * RESOLVED the current wave's battle end (`outcome` = why). The guest - a pure renderer that
 * removes KOd enemies WITHOUT a FaintPhase - runs the matching post-battle tail so it reaches
 * the next wave instead of looping the won wave forever (the HANG). Carries the current
 * `currentBattle.waveIndex`. Hard no-op unless we are in a live AUTHORITATIVE co-op run as the
 * HOST, so solo / non-host / lockstep play is byte-for-byte unaffected. Best-effort + guarded.
 */
export function broadcastCoopWaveResolved(outcome: CoopWaveOutcome, presentation?: CoopCapturePresentation): void {
  if (!globalScene.gameMode.isCoop || active == null || getCoopNetcodeMode() !== "authoritative") {
    return;
  }
  if (active.controller.role !== "host") {
    return;
  }
  const wave = globalScene.currentBattle.waveIndex;
  try {
    // Co-op (#633 B1/B2/B3): a CAPTURE grows/edits the host's party (the caught mon, and a party-full
    // release) that the guest's pure-renderer tail never reproduces. Carry the full post-catch party
    // so the guest can reconcile its bench + credit the catch. Other outcomes carry nothing (no-op).
    const captureParty = outcome === "capture" ? captureCoopCaptureParty() : undefined;
    coopLog(
      "runtime",
      `send waveResolved wave=${wave} outcome=${outcome}${captureParty == null ? "" : ` captureParty=${captureParty.length}`}${presentation == null ? "" : ` cap=sp${presentation.speciesId}`} (host)`,
    );
    active.battleStream.sendWaveResolved(wave, outcome, captureParty, presentation);
  } catch (e) {
    /* a wave-resolved send failure must never break the host's post-battle flow */
    coopWarn("runtime", `send waveResolved failed wave=${wave} outcome=${outcome}`, e);
  }
}

/**
 * HOST -> GUEST (#633 B5, authoritative EXP): stream the host's SETTLED per-slot exp / level / moveset
 * after the wave's exp/level/evolution chain has DRAINED. Emitted from the host's `BattleEndPhase`
 * (the unshifted ExpPhase / LevelUpPhase / EvolutionPhase chain runs before the pushed BattleEndPhase,
 * so the values are fully credited here - NOT at the pre-exp `waveResolved` win-broadcast). The guest
 * adopts them in its own BattleEndPhase so its progression converges. Hard no-op unless we are the
 * HOST of a live AUTHORITATIVE co-op run, so solo / non-host / lockstep play is byte-for-byte
 * unaffected. Best-effort + guarded - a send failure never breaks the host's post-battle flow.
 */
export function broadcastCoopExpResolved(): void {
  if (!globalScene.gameMode.isCoop || active == null || getCoopNetcodeMode() !== "authoritative") {
    return;
  }
  if (active.controller.role !== "host") {
    return;
  }
  const wave = globalScene.currentBattle.waveIndex;
  try {
    const deltas = captureCoopExpDeltas();
    coopLog("runtime", `send expResolved wave=${wave} deltas=${deltas.length} (host)`);
    active.battleStream.sendExpResolved(wave, deltas);
  } catch (e) {
    /* an exp-resolved send failure must never break the host's post-battle flow */
    coopWarn("runtime", `send expResolved failed wave=${wave}`, e);
  }
}

// =============================================================================
// Co-op AUTHORITATIVE mystery-encounter BATTLE HANDOFF (#633). An ME option can spawn a
// battle MID-wave; the interaction is owner-alternated but the spawned battle must be
// HOST-AUTHORITATIVE. At the single chokepoint every ME battle funnels through
// (`initBattleWithEnemyConfig`), the HOST streams the just-generated boss party keyed by
// the ME interaction; the GUEST discards its own locally-rolled party and adopts the
// host's verbatim. Both then flow through the existing host-drives / guest-replays battle
// path, so the boss is identical regardless of who OWNED the encounter. Hard no-op in
// solo / lockstep / non-coop.
// =============================================================================

/** The interaction-counter value the in-progress ME opened on (pinned by mystery-encounter-phases),
 *  or -1 when not in an ME. The ME battle handoff key is derived from it so both clients agree. */
let coopMeBattleInteractionCounter = -1;

/**
 * Co-op (#633 ME battle handoff): pin the interaction counter the current ME opened on, so a
 * battle the ME spawns can be keyed identically on both clients. Set by mystery-encounter-phases
 * at ME entry; reset (`-1`) at the ME terminal. Pure state - no transport, safe in solo.
 */
export function setCoopMeBattleInteractionCounter(counter: number): void {
  if (counter !== coopMeBattleInteractionCounter) {
    // State CHANGE: ME begin (counter>=0) / ME terminal (-1).
    coopLog(
      "me",
      `interaction-counter ${coopMeBattleInteractionCounter} -> ${counter} (${counter >= 0 ? "ME begin" : "ME end"})`,
    );
  }
  coopMeBattleInteractionCounter = counter;
}

/**
 * Co-op (#633): whether a mystery encounter is currently in progress (the STABLE in-ME pin,
 * mirrored here from `mystery-encounter-phases` so `select-modifier-phase` can read it WITHOUT a
 * circular import). `coopMeBattleInteractionCounter` is set/reset on the exact same ME entry/terminal
 * lines as `coopMeInteractionStart`, so it is an equivalent phase-ordering-independent signal. The
 * embedded end-of-ME reward shop reads it to suppress its own alternation advance, so the ME's single
 * advance stays owned by PostMysteryEncounterPhase. `true` for solo MEs too (same as the old
 * `currentBattle.mysteryEncounter != null` guard), so solo / lockstep stay byte-identical.
 */
export function coopMeInProgress(): boolean {
  return coopMeBattleInteractionCounter >= 0;
}

/** Whether a co-op ME battle handoff applies right now (live AUTHORITATIVE session, inside an ME). */
function coopMeHandoffActive(): boolean {
  return (
    active != null
    && globalScene.gameMode.isCoop
    && getCoopNetcodeMode() === "authoritative"
    && coopMeBattleInteractionCounter >= 0
  );
}

/**
 * HOST (#633 ME battle handoff): stream the just-generated ME-spawned-battle enemy party so the
 * guest adopts it verbatim, keyed by the ME interaction. Called from `initBattleWithEnemyConfig`
 * after the host built its boss party. Hard no-op unless we are the HOST of a live AUTHORITATIVE
 * session inside an ME. Best-effort + guarded - never breaks the host's encounter.
 */
export function coopHostStreamMeBattleParty(): void {
  if (!coopMeHandoffActive() || active!.controller.role !== "host") {
    return;
  }
  try {
    const key = meBattleHandoffKey(globalScene.currentBattle.waveIndex, coopMeBattleInteractionCounter);
    const enemies = captureCoopEnemies();
    coopLog("me", `host stream ME-battle party key=${key} enemies=${enemies.length}`);
    active!.battleStream.sendMeBattleEnemyParty(key, enemies);
  } catch (e) {
    /* a serialize/send failure must never break the host's ME battle setup */
    coopWarn("me", "host stream ME-battle party failed", e);
  }
}

/**
 * GUEST (#633 ME battle handoff): await the host's authoritative ME-spawned-battle enemy party,
 * keyed by the ME interaction. Returns the host's serialized enemies for the caller to rebuild
 * `battle.enemyParty` from, or `null` when not applicable / on timeout (the guest then keeps its
 * own locally-rolled party - divergent but never a hang). Called from `initBattleWithEnemyConfig`.
 */
export async function coopGuestAwaitMeBattleParty(timeoutMs?: number): Promise<CoopSerializedEnemy[] | null> {
  if (!coopMeHandoffActive() || active!.controller.role !== "guest") {
    return null;
  }
  const key = meBattleHandoffKey(globalScene.currentBattle.waveIndex, coopMeBattleInteractionCounter);
  coopLog("me", `guest await ME-battle party start key=${key} timeout=${timeoutMs ?? "default"}`);
  try {
    const enemies = await active!.battleStream.awaitMeBattleEnemyParty(key, timeoutMs);
    if (enemies == null) {
      coopWarn("me", `guest await ME-battle party TIMEOUT key=${key} -> keeping local party`);
    } else {
      coopLog("me", `guest await ME-battle party resolve key=${key} enemies=${enemies.length}`);
    }
    return enemies;
  } catch (e) {
    coopWarn("me", `guest await ME-battle party failed key=${key}`, e);
    return null;
  }
}

/** Whether THIS client must await + adopt the host's ME-spawned-battle party (authoritative guest). */
export function coopGuestShouldAdoptMeBattleParty(): boolean {
  return coopMeHandoffActive() && active!.controller.role === "guest";
}

/**
 * HOST (#633, TRACK-2 Phase C, non-battle ME narration): stream one ME dialogue/text line to the
 * guest's CoopReplayMePhase so its screen matches the host-run encounter. Hard no-op off the live
 * AUTHORITATIVE host (solo / guest / lockstep never emit), so those paths are byte-for-byte
 * unaffected. Cosmetic - the reward alternation + the per-ME full-state snapshot carry the OUTCOME,
 * so a dropped/late line can only blank a narration line, never desync. Best-effort + guarded.
 */
export function coopHostStreamMeMessage(text: string): void {
  if (!globalScene.gameMode.isCoop || active == null || getCoopNetcodeMode() !== "authoritative") {
    return;
  }
  if (active.controller.role !== "host") {
    return;
  }
  try {
    if (isCoopDebug()) {
      coopLog("me", `host stream ME-message len=${text.length}`);
    }
    active.battleStream.sendMeMessage(text);
  } catch (e) {
    /* an ME narration send failure must never break the host's encounter */
    coopWarn("me", "host stream ME-message failed", e);
  }
}

/**
 * OWNER (#633 ME battle handoff): if THIS client owns the in-progress ME and its option just
 * spawned a battle, relay the BATTLE-HANDOFF sentinel so the WATCHER's pump ends WITHOUT leaving
 * the encounter (it then runs the spawned battle host-authoritatively). No-op when we are the
 * watcher / not in an ME pump session. Solo / lockstep keep their own pump behavior untouched
 * (this is only invoked on the authoritative handoff path). Best-effort + guarded.
 */
export function coopMeOwnerRelayBattleHandoff(): void {
  if (active == null) {
    return;
  }
  const pump = active.mePump;
  // Only the OWNER of an active pump session relays the sentinel; the watcher receives it.
  if (!pump.isSessionActive() || pump.isWatcher()) {
    coopLog("me", `owner-relay battle-handoff SKIP (active=${pump.isSessionActive()} watcher=${pump.isWatcher()})`);
    return;
  }
  try {
    coopLog("me", "owner-relay battle-handoff sentinel (end pump, run spawned battle)");
    pump.relayMeBattleHandoff();
  } catch (e) {
    /* a relay failure must never break the owner's ME battle setup */
    coopWarn("me", "owner-relay battle-handoff failed", e);
  }
}

/**
 * Set up a LOCAL co-op session: the human is the host, paired with a
 * {@linkcode SpoofGuest} stand-in player 2 over an in-process LoopbackTransport.
 * Registers it as the active runtime and sends the host's opening `hello`. This
 * is the dev/hotseat entry; the real-peer path (P6) builds the same controller
 * over a WebRTC transport instead. Any prior session is torn down first.
 */
export function startLocalCoopSession(
  opts: { username?: string | undefined; netcodeMode?: CoopNetcodeMode | undefined } = {},
): CoopRuntime {
  coopLog(
    "launch",
    `startLocalCoopSession username=${opts.username ?? "(default)"} netcode=${opts.netcodeMode ?? "lockstep"}`,
  );
  clearCoopRuntime();
  const { host, guest } = createLoopbackPair();
  const controller = new CoopSessionController(host, { username: opts.username });
  // This client is the HOST here; pin the chosen netcode (#633, selectable A/B) so
  // it rides along in broadcastRunConfig and the guest adopts it. Default lockstep.
  controller.setNetcodeMode(opts.netcodeMode ?? "lockstep");
  const battleSync = new CoopBattleSync(host);
  const battleStream = new CoopBattleStreamer(host);
  const interactionRelay = new CoopInteractionRelay(host);
  const uiMirror = new CoopUiMirror(host);
  const mePump = new CoopMePump(interactionRelay);
  const spoof = new SpoofGuest(guest);
  const runtime: CoopRuntime = {
    controller,
    battleSync,
    battleStream,
    interactionRelay,
    uiMirror,
    mePump,
    localTransport: host,
    partnerTransport: guest,
    spoof,
  };
  wireCoopGhostPoolSync(controller, battleStream);
  wireCoopResyncResponder(controller, battleStream);
  wireCoopEnemyPartyResponder(controller, battleStream);
  wireCoopWaveResolved(controller, battleStream);
  wireCoopExpResolved(controller, battleStream);
  wireCoopMeChecksumCheck(battleStream);
  wireCoopLiveEvents(controller, battleStream);
  wireCoopLearnMoveForward(host);
  setCoopRuntime(runtime);
  coopLog("launch", `local session ready role=${controller.role} netcode=${controller.netcodeMode} -> connecting`);
  controller.connect();
  return runtime;
}

/**
 * Set up a co-op session over a REAL peer transport (#633, P6). Unlike
 * {@linkcode startLocalCoopSession} (which spoofs the guest in-process), this wires
 * the live {@linkcode CoopSessionController} to an already-connected transport
 * backed by a real WebRTC data channel (see `coop-webrtc-transport.ts`) - no spoof.
 * Registers it as the active runtime and sends our opening `hello`. Any prior
 * session is torn down first.
 */
export function connectCoopSession(
  transport: CoopTransport,
  opts: { username?: string | undefined; netcodeMode?: CoopNetcodeMode | undefined } = {},
): CoopRuntime {
  coopLog(
    "launch",
    `connectCoopSession role=${transport.role} state=${transport.state} username=${opts.username ?? "(default)"} netcode=${opts.netcodeMode ?? "lockstep"}`,
  );
  clearCoopRuntime();
  const controller = new CoopSessionController(transport, { username: opts.username });
  // Pin the chosen netcode (#633, selectable A/B). On the HOST this is the source of
  // truth that rides along in broadcastRunConfig; on the GUEST it is only the pre-
  // runConfig default (the host's value overwrites it on receipt). Default lockstep.
  controller.setNetcodeMode(opts.netcodeMode ?? "lockstep");
  const battleSync = new CoopBattleSync(transport);
  const battleStream = new CoopBattleStreamer(transport);
  const interactionRelay = new CoopInteractionRelay(transport);
  const uiMirror = new CoopUiMirror(transport);
  const mePump = new CoopMePump(interactionRelay);
  const runtime: CoopRuntime = {
    controller,
    battleSync,
    battleStream,
    interactionRelay,
    uiMirror,
    mePump,
    localTransport: transport,
  };
  wireCoopGhostPoolSync(controller, battleStream);
  wireCoopResyncResponder(controller, battleStream);
  wireCoopEnemyPartyResponder(controller, battleStream);
  wireCoopWaveResolved(controller, battleStream);
  wireCoopExpResolved(controller, battleStream);
  wireCoopMeChecksumCheck(battleStream);
  wireCoopLiveEvents(controller, battleStream);
  wireCoopLearnMoveForward(transport);
  setCoopRuntime(runtime);
  coopLog("launch", `peer session ready role=${controller.role} netcode=${controller.netcodeMode} -> connecting`);
  controller.connect();
  return runtime;
}

/** Tear down and forget the live co-op session (closing its transport). */
export function clearCoopRuntime(): void {
  if (active == null) {
    return;
  }
  coopLog("launch", `clearCoopRuntime role=${active.controller.role} netcode=${active.controller.netcodeMode}`);
  active.controller.dispose();
  active.battleSync.dispose();
  active.battleStream.dispose();
  active.interactionRelay.dispose();
  active.uiMirror.dispose();
  active.mePump.endSession();
  active.spoof?.dispose();
  // Drop the persistent move-learn forward listener + its in-flight slot set (#633 BUG3+5) so a
  // subsequent solo / lockstep run has no listener and spawns no CoopReplayLearnMovePhase.
  offLearnMoveForward?.();
  offLearnMoveForward = null;
  learnMoveForwardInFlight.clear();
  active.localTransport.close();
  // Clear the co-op ghost-pool hooks so a subsequent SOLO run fetches normally (#633).
  setGhostPoolPublisher(null);
  setCoopGhostFetchSuppressed(null);
  // Clear the live-event emitter so a subsequent solo / lockstep run never streams battle events (#633).
  setCoopLiveEmitter(null);
  // Reset the authoritative wave-advance state so a subsequent run starts clean (#633).
  pendingWaveAdvance = null;
  lastResolvedWave = -1;
  // Reset the authoritative EXP delta state so a subsequent run starts clean (#633 B5).
  pendingExpDeltas = null;
  lastExpResolvedWave = -1;
  // Reset the ME battle handoff counter so a subsequent run starts clean (#633).
  coopMeBattleInteractionCounter = -1;
  // Drop the authoritative latch so a subsequent solo / lockstep run is not forced authoritative.
  authoritativeLatched = false;
  // Clear the cycle-free authoritative-guest predicate so a subsequent solo / lockstep run reads false.
  setCoopAuthoritativeGuestPredicate(null);
  active = null;
}

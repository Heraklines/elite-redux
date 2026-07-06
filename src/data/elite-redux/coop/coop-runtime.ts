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
import {
  setCoopAuthoritativeGuestPredicate,
  setShowdownGuestFlipPredicate,
} from "#data/elite-redux/coop/coop-authoritative-gate";
import { COOP_CHECKSUM_SENTINEL } from "#data/elite-redux/coop/coop-battle-checksum";
import {
  applyCoopDexDelta,
  applyCoopFullSnapshot,
  captureCoopAuthoritativeBattleState,
  captureCoopCaptureParty,
  captureCoopChecksum,
  captureCoopDexDelta,
  captureCoopEnemies,
  captureCoopFullSnapshot,
  resetCoopStateTicks,
} from "#data/elite-redux/coop/coop-battle-engine";
import { CoopBattleStreamer } from "#data/elite-redux/coop/coop-battle-stream";
import { CoopBattleSync } from "#data/elite-redux/coop/coop-battle-sync";
import { getCoopChecksumAssertionCount } from "#data/elite-redux/coop/coop-checksum-assert";
import { coopLog, coopWarn, isCoopDebug } from "#data/elite-redux/coop/coop-debug";
import { COOP_DEX_SYNC_SEQ, CoopInteractionRelay } from "#data/elite-redux/coop/coop-interaction-relay";
import { meBattleHandoffKey } from "#data/elite-redux/coop/coop-me-battle-handoff";
import {
  coopMeHandoffBattleStarted,
  coopMeHandoffBattleWaveValue,
  coopMeInteractionStartValue,
  setCoopMeInteractionStart,
} from "#data/elite-redux/coop/coop-me-pin-state";
import { CoopMePump } from "#data/elite-redux/coop/coop-me-pump";
import { CoopRendezvous } from "#data/elite-redux/coop/coop-rendezvous";
import { COOP_REJOIN_SYNC_SEQ_BASE } from "#data/elite-redux/coop/coop-seq-registry";
import { coopFieldIndexOf, coopOwnerOfFieldSlot } from "#data/elite-redux/coop/coop-session";
import { CoopSessionController } from "#data/elite-redux/coop/coop-session-controller";
import { SpoofGuest } from "#data/elite-redux/coop/coop-spoof-guest";
import type {
  CoopAuthoritativeBattleStateV1,
  CoopCapturePresentation,
  CoopFullBattleSnapshot,
  CoopNetcodeMode,
  CoopRole,
  CoopSerializedEnemy,
  CoopSessionKind,
  CoopWaveOutcome,
} from "#data/elite-redux/coop/coop-transport";
import {
  COOP_PROTOCOL_VERSION,
  type CoopTransport,
  createLoopbackPair,
  type SerializedCommand,
} from "#data/elite-redux/coop/coop-transport";
import { setCoopLiveEmitter } from "#data/elite-redux/coop/coop-turn-recorder";
import { CoopUiMirror } from "#data/elite-redux/coop/coop-ui-mirror";
import { setCoopGhostFetchSuppressed, setCoopGhostPool, setGhostPoolPublisher } from "#data/elite-redux/er-ghost-teams";
import {
  beginReplayRecording,
  clearReplayRecording,
  isReplayRecording,
  recordReplayCommand,
} from "#data/elite-redux/replay-recorder";
import type { ReplayCommandKind } from "#data/elite-redux/replay-trace";
import { BattlerIndex } from "#enums/battler-index";
import { Command } from "#enums/command";
import { UiMode } from "#enums/ui-mode";
import { PokemonData } from "#system/pokemon-data";
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
 * Co-op WAVE-END authoritative capture (#838): the host's COMPLETE post-exp authoritative battle state
 * for a wave the GUEST has not yet applied, plus the last wave it already applied (the double-apply
 * guard). The host streams `waveEndState` from its `BattleEndPhase` (after the exp/level/evolution chain
 * drained); the guest stores it here ({@linkcode wireCoopWaveEndState}) and CONSUMES it in its OWN
 * `BattleEndPhase` ({@linkcode consumeCoopPendingWaveEndState}) via a single id-based full-state apply -
 * the sole post-battle progression channel (the legacy per-slot exp-delta relay it superseded is gone).
 */
let pendingWaveEndState: { wave: number; state: CoopAuthoritativeBattleStateV1 } | null = null;
/** The last wave the guest already applied a wave-end authoritative snapshot for. */
let lastWaveEndStateWave = -1;

/**
 * GUEST: take + clear any pending host wave-end authoritative snapshot (#838). Returns the host's
 * complete post-exp battle state to apply, or null when none is pending or this wave was already
 * applied. Called by the guest's `BattleEndPhase`. Bumps the double-apply guard so a duplicate
 * `waveEndState` for the same wave is a no-op.
 */
export function consumeCoopPendingWaveEndState(): CoopAuthoritativeBattleStateV1 | null {
  const pending = pendingWaveEndState;
  pendingWaveEndState = null;
  if (pending == null || pending.wave <= lastWaveEndStateWave) {
    return null;
  }
  lastWaveEndStateWave = pending.wave;
  coopLog("runtime", `consume waveEndState wave=${pending.wave} tick=${pending.state.tick}`);
  return pending.state;
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
 * Showdown 1v1 PvP (C6): route a RECEIVED `showdownResult` / `showdownVoid` to THIS client's
 * terminal result phase so BOTH clients show the same outcome. The pure-renderer guest never runs
 * VictoryPhase, so without this it would never learn the match ended; the host receives the guest's
 * void the same way. Silent (does NOT re-emit -> no ping-pong) and idempotent (skips when the result
 * phase is already running). Versus-only; a co-op peer never sends these `t` values.
 */
function wireShowdownResult(transport: CoopTransport, controller: CoopSessionController): void {
  transport.onMessage(msg => {
    if (msg.t !== "showdownResult" && msg.t !== "showdownVoid") {
      return;
    }
    try {
      if (globalScene.phaseManager.getCurrentPhase()?.phaseName === "ShowdownResultPhase") {
        return; // already ending on this client
      }
      if (msg.t === "showdownVoid") {
        globalScene.phaseManager.unshiftNew("ShowdownResultPhase", false, msg.reason, true, true);
      } else {
        // The received `winner` is a role; this client won iff it matches its own role.
        const localWon = msg.winner === controller.role;
        globalScene.phaseManager.unshiftNew("ShowdownResultPhase", localWon, msg.reason, false, true);
      }
    } catch {
      /* routing the received result must never crash the receiver */
    }
  });
}

/**
 * Co-op WAVE-END authoritative capture responder (#838): the GUEST records the host's `waveEndState`
 * (the complete post-exp battle state) as a one-shot pending payload (guarded against a double-apply by
 * wave number). It is consumed in the guest's own `BattleEndPhase` (NOT applied here mid-message) so it
 * lands at a real phase boundary, AFTER the guest's VictoryPhase tail queues BattleEnd. Gated on the
 * live GUEST role in the AUTHORITATIVE netcode; host / solo / lockstep ignore.
 */
function wireCoopWaveEndState(controller: CoopSessionController, battleStream: CoopBattleStreamer): void {
  battleStream.onWaveEndState((wave, state) => {
    if (controller.role !== "guest" || getCoopNetcodeMode() !== "authoritative") {
      return;
    }
    // Already applied past this wave (a duplicate signal) -> ignore.
    if (wave <= lastWaveEndStateWave) {
      return;
    }
    // Latest wave's snapshot wins (a later wave supersedes an unconsumed earlier one).
    if (pendingWaveEndState == null || wave >= pendingWaveEndState.wave) {
      coopLog("runtime", `pend waveEndState wave=${wave} tick=${state.tick}`);
      pendingWaveEndState = { wave, state };
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
    const gen = coopSessionGeneration(); // #808: die if the session ends before the reply
    void battleStream.requestStateSync(seq).then(blob => {
      if (gen !== coopSessionGeneration()) {
        coopWarn("resync", `stateSync reply seq=${seq} arrived AFTER session teardown -> dropped (#808)`);
        return;
      }
      if (blob == null) {
        coopWarn("resync", `await stateSync TIMEOUT/null seq=${seq}`);
        return;
      }
      coopLog("resync", `await stateSync resolve seq=${seq} blob=${blob.length}b -> applying`);
      try {
        // #839: this heal fires MID-DIVERT - the stateSync reply resolves while the guest is diverting
        // into (or parked in) CoopReplayMePhase for this same ME. Run it with `suppressResummon=true` so
        // it stays a SAFE, advisory best-effort heal: it applies only the cheap per-mon scalar +
        // module-let state writes and NEVER runs the heavy field COMPOSITION re-summon
        // (reconcileCoopEnemyField / reconcileCoopPlayerField + per-mon initBattleInfo), which would tear
        // down and rebuild the field sprites out from under the in-flight ME presentation. applyCoopFullSnapshot
        // touches no phase queue and never cancels a relay waiter, so the ME divert proceeds regardless of
        // whether this early heal converges - the AUTHORITATIVE convergence is the ME terminal's
        // comprehensive meResync (applyCoopMeOutcome), which the guest still adopts. The still-diverged
        // path below is advisory by design (#839): it must never disrupt the encounter.
        applyCoopFullSnapshot(
          JSON.parse(decompressFromBase64(blob)) as CoopFullBattleSnapshot,
          isCoopAuthoritativeGuest(),
          /* suppressResummon */ true,
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
/** #848: the BATCH move-learn forward listener teardown + its in-flight slot set (mirrors the per-move pair). */
let offLearnMoveBatchForward: (() => void) | null = null;
const learnMoveBatchForwardInFlight = new Set<number>();

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
/**
 * #787: the learn-move picker opener, INJECTED by coop-replay-learn-move-phase at module load
 * (the phase registry imports it at boot). Runtime -> phase would be an import cycle, hence the
 * indirection. When set, `learnMoveForward` opens the picker INLINE over the current screen -
 * a phase queued behind a parked watcher phase can never run (the live TM Case circular stall).
 */
/**
 * #789 (found by the duo exploration probe): advance the alternating interaction from OUTSIDE the
 * reward shop. A CONTINUATION-class reward (Ability Capsule, TM, Learner's Shroom) deliberately
 * skips the shop's own advance (the item's picker phase owns the rest of the interaction) - but the
 * COMMIT paths never advanced at all, so the rotation stalled on the same owner every wave. Each
 * side calls this locally when ITS copy of the item flow commits (owner + watcher run the same
 * flow), so the counters stay lockstep with no extra wire traffic. Mirrors the shop's own guards:
 * no-op outside co-op, inside a mystery encounter (the ME owns the single advance), or with no
 * controller. Safe to call more than once per seq: advanceInteraction(from) is from-pinned.
 */
export function advanceCoopInteractionForContinuation(fromSeq: number): void {
  try {
    if (!globalScene.gameMode?.isCoop || fromSeq < 0 || coopMeInProgress()) {
      coopLog(
        "reward",
        `advanceCoopInteractionForContinuation SKIP (isCoop=${globalScene.gameMode?.isCoop === true} fromSeq=${fromSeq} meInProgress=${coopMeInProgress()})`,
      );
      return;
    }
    const controller = getCoopController();
    if (controller == null) {
      return;
    }
    const before = controller.interactionCounter();
    controller.advanceInteraction(fromSeq);
    coopLog(
      "reward",
      `advance interaction from CONTINUATION commit (role=${controller.role} from=${fromSeq} counter ${before} -> ${controller.interactionCounter()})`,
    );
  } catch (e) {
    /* the advance must never break the item flow */
    coopWarn("reward", "advanceCoopInteractionForContinuation threw (handled)", e);
  }
}

let learnMovePickerOpener: ((partySlot: number, moveId: number, maxMoveCount: number) => void) | null = null;

export function setCoopLearnMovePickerOpener(
  opener: (partySlot: number, moveId: number, maxMoveCount: number) => void,
): void {
  learnMovePickerOpener = opener;
}

/**
 * #848: the BATCH move-learn panel opener, injected by coop-replay-learn-move-batch at module load
 * (the phase registry imports it at boot). Runtime -> phase would be an import cycle, hence the
 * indirection. When the guest receives a `learnMoveBatchForward` present it opens the shared batch
 * Move Learn panel INLINE over the current screen (owner-drives if the guest owns the mon, else a
 * read-only watcher that mirrors the host's cursor + closes on the relayed terminal).
 */
let learnMoveBatchPickerOpener: ((partySlot: number, learnableIds: number[], ownerIsGuest: boolean) => void) | null =
  null;

export function setCoopLearnMoveBatchPickerOpener(
  opener: (partySlot: number, learnableIds: number[], ownerIsGuest: boolean) => void,
): void {
  learnMoveBatchPickerOpener = opener;
}

/** Co-op (#848): clear a slot's in-flight batch Move Learn panel mark once its panel closes. */
export function clearCoopLearnMoveBatchInFlight(partySlot: number): void {
  learnMoveBatchForwardInFlight.delete(partySlot);
}

// =============================================================================
// #794 shared acquisition: the HOST (sole engine) streams its dex / starter blob right after
// any acquisition event (wild catch, DexNav grant, ME-granted mon, shiny-variant unlock bits
// ride caughtAttr) so the partner's ACCOUNT is credited immediately - previously the blob only
// flowed at ME terminals, so a run without MEs never shared catches. Throttled (bursts like
// mid-run egg hatches coalesce into one trailing send); the apply side is merge-only (union),
// so the partner can only GAIN entries - a stale blob can never remove anything.
// =============================================================================

let dexSyncPending: { relay: CoopInteractionRelay; blob: string } | null = null;
let dexSyncTimerArmed = false;
/** Injectable for tests: 0 = flush on the next macrotask. */
let dexSyncDelayMs = 500;
export function setCoopDexSyncDelayMs(ms: number): void {
  dexSyncDelayMs = ms;
}

/**
 * Call after ANY acquisition write (chokepoint: gameData.setPokemonCaught). Safe anywhere.
 * The blob AND the sending relay are bound AT CALL TIME (the timer callback runs under
 * whatever client context is active - binding late would capture/send via the wrong client
 * in multi-client processes like the duo harness). A burst overwrites the pending blob
 * (capture-after-write means the latest capture reflects every write), one trailing send.
 */
export function coopBroadcastDexSync(): void {
  try {
    if (getCoopRuntime() == null || !globalScene.gameMode?.isCoop || isCoopAuthoritativeGuest()) {
      return;
    }
    const relay = getCoopInteractionRelay();
    if (relay == null) {
      return;
    }
    dexSyncPending = { relay, blob: captureCoopDexDelta() };
    if (dexSyncTimerArmed) {
      return;
    }
    dexSyncTimerArmed = true;
    setTimeout(() => {
      dexSyncTimerArmed = false;
      const pending = dexSyncPending;
      dexSyncPending = null;
      if (pending == null) {
        return;
      }
      try {
        pending.relay.sendInteractionOutcome(COOP_DEX_SYNC_SEQ, "dexSync", { k: "dexSync", dex: pending.blob });
        coopLog("runtime", "dexSync broadcast (acquisition -> partner account credited)");
      } catch {
        coopWarn("runtime", "dexSync broadcast threw (handled - next ME terminal still converges)");
      }
    }, dexSyncDelayMs);
  } catch {
    /* an acquisition write must never fail because of the sync hook */
  }
}

let offDexSync: (() => void) | null = null;
let offDisconnectReaction: (() => void) | null = null;

/**
 * Partner-disconnect reaction (#799): the transport DETECTS channel death (onStateChange fires
 * "disconnected") but nothing reacted - a dead partner left the survivor parked in a live shop /
 * picker / lockstep wait for the FULL default timeout (20 minutes) with zero feedback. On channel
 * death: cancel THIS runtime's pending relay waits (every wait takes its timeout path IMMEDIATELY -
 * shop watchers leave, faint pickers auto-resolve, the lockstep gate proceeds) and tell the player.
 * The waits themselves stay long for LIVE partners (a human slowly browsing a market is legitimate);
 * only a genuinely dead channel short-circuits them. The resync/backstop layers are untouched.
 */
/** #806 keepalive/deadlock-detection thresholds (standard netcode watchdog numbers). */
const COOP_STALL_TICK_MS = 5_000;
const COOP_STALL_REPORT_MS = 10_000;
const COOP_STALL_TRIGGER_MS = 20_000;
const COOP_STALL_RECOVERY_COOLDOWN_MS = 30_000;
let offStallWatchdog: (() => void) | null = null;

/**
 * #806 STALL WATCHDOG (standard technique: keepalive heartbeat + wait-for-cycle deadlock
 * detection). Each client that has been parked in a NETWORK wait for 10s+ tells its peer via a
 * tiny `stallBeat`. When BOTH sides report 20s+ simultaneously, neither can produce the other's
 * awaited message - a proven two-node wait cycle. Recovery: cancel the local parked waits (all
 * existing timeout/AI fallbacks fire immediately) and, on the authoritative guest, pull a fresh
 * full snapshot. A human browsing a shop never triggers this: the browsing side is in UI, not a
 * network wait. Converts every current AND FUTURE mutual-wait bug from a softlock into a
 * seconds-long self-healed hiccup with a loud log marker.
 */
export function wireCoopStallWatchdog(
  transport: CoopTransport,
  relay: CoopInteractionRelay,
  battleStream: CoopBattleStreamer,
  runtime: CoopRuntime,
): void {
  let peerBeat: { ms: number; at: number } | null = null;
  let lastRecoveryAt = 0;
  let versionWarned = false;
  let lastHealthAt = 0;
  const offMsg = transport.onMessage(msg => {
    if (msg.t === "stallBeat") {
      peerBeat = { ms: msg.waitingMs, at: Date.now() };
    }
  });
  const timer = setInterval(() => {
    try {
      // #807 C one-shot: a protocol-version mismatch means a stale cached bundle - tell BOTH
      // players plainly (the top source of unreproducible ghost bugs in live sessions).
      if (!versionWarned && runtime.controller.versionMismatch && getCoopRuntime() === runtime) {
        versionWarned = true;
        try {
          globalScene.ui.showText(
            "Version mismatch with your partner. Both players should hard refresh (Ctrl+F5) and reconnect.",
            null,
            undefined,
            6000,
          );
        } catch {
          /* cosmetic */
        }
      }
      const localMs = Math.max(relay.oldestNetworkWaitMs(), battleStream.oldestNetworkWaitMs());
      // #808 HEALTH LINE: one compact self-describing line every ~30s so every log capture
      // carries a session-health timeline for free (zero extra timers).
      if (Date.now() - lastHealthAt >= 30_000) {
        lastHealthAt = Date.now();
        coopLog(
          "health",
          `tick=${coopSessionGeneration()}g turn=${globalScene.currentBattle?.turn ?? "-"} wave=${globalScene.currentBattle?.waveIndex ?? "-"} counter=${runtime.controller.interactionCounter?.() ?? "-"} assertions=${getCoopChecksumAssertionCount()} wait=${localMs}ms peerBeat=${peerBeat ? `${Math.round((Date.now() - peerBeat.at) / 1000)}s` : "-"} transport=${transport.state}`,
        );
      }
      if (localMs >= COOP_STALL_REPORT_MS) {
        transport.send({ t: "stallBeat", waitingMs: localMs });
      }
      const peerFresh = peerBeat != null && Date.now() - peerBeat.at < COOP_STALL_TICK_MS * 2.5;
      if (
        localMs >= COOP_STALL_TRIGGER_MS
        && peerFresh
        && (peerBeat?.ms ?? 0) >= COOP_STALL_TRIGGER_MS
        && Date.now() - lastRecoveryAt > COOP_STALL_RECOVERY_COOLDOWN_MS
      ) {
        lastRecoveryAt = Date.now();
        coopWarn(
          "runtime",
          `STALL WATCHDOG: mutual network wait (local=${Math.round(localMs / 1000)}s peer=${Math.round((peerBeat?.ms ?? 0) / 1000)}s) -> recovering (cancel waits${isCoopAuthoritativeGuest() ? " + full resync" : ""})`,
        );
        if (getCoopRuntime() === runtime) {
          try {
            globalScene.ui.showText("Connection stall detected. Resynchronizing...", null, undefined, 3000);
          } catch {
            /* cosmetic */
          }
        }
        try {
          relay.cancelWaiters(() => true);
        } catch {
          /* recovery must never throw */
        }
        if (isCoopAuthoritativeGuest()) {
          const seq = COOP_REJOIN_SYNC_SEQ_BASE + (Date.now() % 100_000);
          const gen = coopSessionGeneration(); // #808
          void battleStream.requestStateSync(seq).then(blob => {
            if (gen !== coopSessionGeneration()) {
              return;
            }
            if (blob == null) {
              coopWarn("resync", `stall-recovery stateSync TIMEOUT/null seq=${seq}`);
              return;
            }
            try {
              applyCoopFullSnapshot(
                JSON.parse(decompressFromBase64(blob)) as CoopFullBattleSnapshot,
                isCoopAuthoritativeGuest(),
              );
              coopLog("resync", `stall-recovery snapshot applied seq=${seq} blob=${blob.length}b`);
            } catch {
              coopWarn("resync", `stall-recovery snapshot apply FAILED seq=${seq}`);
            }
          });
        }
      }
    } catch {
      /* the watchdog itself must never crash the game loop */
    }
  }, COOP_STALL_TICK_MS);
  offStallWatchdog = () => {
    clearInterval(timer);
    offMsg();
  };
}

function wireCoopDisconnectReaction(transport: CoopTransport, relay: CoopInteractionRelay, runtime: CoopRuntime): void {
  let rejoining = false;
  offDisconnectReaction = transport.onStateChange(state => {
    if (state !== "disconnected" && state !== "closed") {
      return;
    }
    coopWarn("runtime", `partner channel ${state} -> cancelling pending co-op waits (no 20-minute strand)`);
    try {
      relay.cancelWaiters(() => true);
    } catch {
      /* cancel failure must not cascade */
    }
    // Only the ACTIVE runtime owns the screen (the duo harness assembles two in one process).
    const isActiveRuntime = getCoopRuntime() === runtime;
    // #805 HOT REJOIN: re-dial the same pairing code within the grace window and swap the fresh
    // channel into the live transport - the whole session survives in place. One loop at a time.
    if (runtime.rejoinDriver != null && !rejoining) {
      rejoining = true;
      if (isActiveRuntime) {
        try {
          globalScene.ui.showText("Connection lost. Trying to reconnect (up to 2 minutes)...", null, undefined, 4000);
        } catch {
          /* cosmetic */
        }
      }
      void runtime
        .rejoinDriver()
        .then(ok => {
          rejoining = false;
          if (!ok) {
            coopWarn("runtime", "rejoin FAILED (grace expired) -> continuing without the partner");
            if (isActiveRuntime) {
              try {
                globalScene.ui.showText(
                  "Your partner didn't reconnect. Continuing without waiting...",
                  null,
                  undefined,
                  4000,
                );
              } catch {
                /* cosmetic */
              }
            }
            return;
          }
          coopLog("runtime", "rejoin SUCCESS -> channel re-established in place");
          if (isActiveRuntime) {
            try {
              globalScene.ui.showText("Partner reconnected!", null, undefined, 3000);
            } catch {
              /* cosmetic */
            }
          }
          // The GUEST missed events while dark: pull the host's full authoritative snapshot.
          if (isCoopAuthoritativeGuest()) {
            const seq = COOP_REJOIN_SYNC_SEQ_BASE + (Date.now() % 100_000);
            coopLog("resync", `post-rejoin full resync request seq=${seq}`);
            const gen = coopSessionGeneration(); // #808
            void runtime.battleStream.requestStateSync(seq).then(blob => {
              if (gen !== coopSessionGeneration()) {
                return;
              }
              if (blob == null) {
                coopWarn("resync", `post-rejoin stateSync TIMEOUT/null seq=${seq} (checksum backstop heals next turn)`);
                return;
              }
              try {
                applyCoopFullSnapshot(
                  JSON.parse(decompressFromBase64(blob)) as CoopFullBattleSnapshot,
                  isCoopAuthoritativeGuest(),
                );
                coopLog("resync", `post-rejoin snapshot applied seq=${seq} blob=${blob.length}b`);
              } catch {
                coopWarn("resync", `post-rejoin snapshot apply FAILED seq=${seq} (checksum backstop heals next turn)`);
              }
            });
          }
        })
        .catch(() => {
          rejoining = false;
        });
      return;
    }
    if (isActiveRuntime) {
      try {
        globalScene.ui.showText("Your partner disconnected. Continuing without waiting...", null, undefined, 3000);
      } catch {
        /* cosmetic */
      }
    }
  });
}

// #805 rejoin-resync seq band (#840: declared in coop-seq-registry, imported above).
function wireCoopDexSync(transport: CoopTransport): void {
  offDexSync = transport.onMessage(msg => {
    if (msg.t !== "interactionOutcome" || msg.outcome.k !== "dexSync") {
      return;
    }
    if (!isCoopAuthoritativeGuest()) {
      return;
    }
    coopLog("runtime", "recv dexSync -> merging partner acquisition credit onto local account");
    applyCoopDexDelta(msg.outcome.dex);
  });
}

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
      `recv learnMoveForward slot=${partySlot} moveId=${moveId} maxMoveCount=${maxMoveCount} -> open picker ${
        learnMovePickerOpener == null ? "via CoopReplayLearnMovePhase" : "INLINE"
      }`,
    );
    learnMoveForwardInFlight.add(partySlot);
    try {
      if (learnMovePickerOpener == null) {
        globalScene.phaseManager.unshiftNew("CoopReplayLearnMovePhase", partySlot, moveId, maxMoveCount);
      } else {
        // #787: INLINE over the current screen - immune to a parked phase queue (the TM Case
        // circular stall: the queued phase sat behind the shop watcher the host could not end
        // while awaiting this very pick).
        learnMovePickerOpener(partySlot, moveId, maxMoveCount);
      }
    } catch (e) {
      // A spawn failure must never hang the run: the host's own await times out to "keep current
      // moves". Drop the in-flight mark so a retry/resend can re-spawn.
      learnMoveForwardInFlight.delete(partySlot);
      coopWarn("learnmove", `learn-move picker open failed slot=${partySlot} (host await falls back)`, e);
    }
  });
}

/** Co-op (#633 BUG3+5): clear a slot's in-flight learn-move picker mark once its phase ends. */
export function clearCoopLearnMoveForwardInFlight(partySlot: number): void {
  learnMoveForwardInFlight.delete(partySlot);
}

/**
 * Install the persistent AUTHORITATIVE-GUEST BATCH move-learn forward listener (#848). The ER batch
 * Move Learn panel is now the SHARED co-op level-up path: when the host's {@linkcode LearnMoveBatchPhase}
 * opens the panel it streams a `learnMoveBatchForward` present so the guest opens the SAME panel INLINE
 * (owner-drives if the guest owns the mon, else a read-only watcher). Gated hard on
 * {@linkcode isCoopAuthoritativeGuest} (a dead no-op for solo / host / lockstep). An in-flight slot guard
 * ignores a duplicate present for a slot whose panel is still open. Cleared in {@linkcode clearCoopRuntime}.
 */
function wireCoopLearnMoveBatchForward(transport: CoopTransport): void {
  offLearnMoveBatchForward = transport.onMessage(msg => {
    if (msg.t !== "interactionOutcome" || msg.outcome.k !== "learnMoveBatchForward") {
      return;
    }
    if (!isCoopAuthoritativeGuest()) {
      return;
    }
    const { partySlot, learnableIds, ownerIsGuest } = msg.outcome;
    if (learnMoveBatchForwardInFlight.has(partySlot)) {
      coopLog("learnmove", `recv learnMoveBatchForward slot=${partySlot} IGNORE (panel already in-flight)`);
      return;
    }
    if (learnMoveBatchPickerOpener == null) {
      coopWarn(
        "learnmove",
        `recv learnMoveBatchForward slot=${partySlot} but no batch opener injected; host await falls back`,
      );
      return;
    }
    coopLog(
      "learnmove",
      `recv learnMoveBatchForward slot=${partySlot} learnable=${learnableIds.length} ownerIsGuest=${ownerIsGuest} -> open batch panel INLINE`,
    );
    learnMoveBatchForwardInFlight.add(partySlot);
    try {
      learnMoveBatchPickerOpener(partySlot, learnableIds, ownerIsGuest);
    } catch (e) {
      // A panel-open failure must never hang the run: the host's own await times out to "keep current
      // moves". Drop the in-flight mark so a retry/resend can re-open.
      learnMoveBatchForwardInFlight.delete(partySlot);
      coopWarn("learnmove", `batch panel open failed slot=${partySlot} (host await falls back)`, e);
    }
  });
}

/**
 * Co-op (#843 soak TEARDOWN probe): whether the AUTHORITATIVE-guest learn-move-forward in-flight slot set
 * is EMPTY. It is a process-global {@linkcode learnMoveForwardInFlight} with no other read point, so the
 * soak's teardown invariant could not verify {@linkcode clearCoopRuntime} drained it (it calls
 * `learnMoveForwardInFlight.clear()` internally). This READ-ONLY getter closes that gap: after
 * clearCoopRuntime the soak asserts it returns true, so a leaked learn-move picker pin is detected instead
 * of silently surviving into the next run. Pure read, no mutation.
 */
export function isCoopLearnMoveForwardInFlightEmpty(): boolean {
  return learnMoveForwardInFlight.size === 0 && learnMoveBatchForwardInFlight.size === 0;
}

/**
 * Co-op (#835): mark a slot's move-forget picker as already in-flight from the GUEST side BEFORE the
 * host's `learnMoveForward` for that slot is processed, so {@linkcode wireCoopLearnMoveForward} sees the
 * guard SET and short-circuits its duplicate listener open. Used when the guest's OWN authoritative
 * {@linkcode LearnMovePhase} (queued by a shop-continuation TM / Shroom on a guest-owned FULL-moveset
 * mon) renders the picker itself as a queue-protected phase - it is the sole renderer, so the detached
 * listener overlay must NOT also open. The wire is ORDERED (the reward-pick relay that queues + runs the
 * guest LMP arrives before the host's `learnMoveForward`), so this mark is set synchronously first.
 * Returns whether the slot was newly marked (false = a picker for this slot was already in-flight).
 */
export function markCoopLearnMoveForwardInFlight(partySlot: number): boolean {
  if (learnMoveForwardInFlight.has(partySlot)) {
    return false;
  }
  learnMoveForwardInFlight.add(partySlot);
  return true;
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
  /** Reciprocal two-sided rendezvous barriers at pacing sync points (#839). */
  rendezvous: CoopRendezvous;
  /** The local client's transport endpoint. */
  localTransport: CoopTransport;
  /** The spoofed partner's transport endpoint (local dev only; absent for real peers). */
  partnerTransport?: CoopTransport;
  /** The stand-in player 2 (local dev only). */
  spoof?: SpoofGuest;
  /**
   * #805 hot rejoin: re-dials the SAME pairing code/role and swaps the fresh channel into the
   * LIVE transport (set by the real-peer connect entrypoints; absent over loopback/spoof).
   * Resolves true when the channel is re-established within the grace window.
   */
  rejoinDriver?: () => Promise<boolean>;
}

let active: CoopRuntime | null = null;

/**
 * #808 SESSION GENERATION (same pattern as the transport's wire generation): bumped when a
 * session is TORN DOWN. Async continuations capture it at scheduling and no-op if it moved -
 * a late resync/share/rejoin continuation can never mutate a scene the session left behind.
 * Deliberately NOT bumped by setCoopRuntime (the duo harness re-registers per context swap).
 */
let sessionGeneration = 0;
export function coopSessionGeneration(): number {
  return sessionGeneration;
}

/** Register the live co-op session (called when a co-op run is being set up). */
export function setCoopRuntime(runtime: CoopRuntime): void {
  active = runtime;
  // Install the cycle-free authoritative-guest predicate (#633 B6) so `field/pokemon.ts` can gate the
  // Shedinja party-add without importing this module (which would close a value-level import cycle).
  setCoopAuthoritativeGuestPredicate(isCoopAuthoritativeGuest);
  // Install the cycle-free showdown-guest-flip predicate (C5) so the render layer (pokemon.ts /
  // battle-info panels) can consult the versus-guest perspective flip without importing this module.
  setShowdownGuestFlipPredicate(isShowdownGuestFlip);
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
 * The active co-op netcode (#633, M6c: authoritative-ONLY), or `"lockstep"` when there is no
 * live session. Co-op has exactly one netcode since M3: a LIVE session is ALWAYS authoritative
 * (the guest renders, the host resolves), unconditionally - the old selectable toggle, the
 * controller's netcodeMode consultation, and the transient-read LATCH are all retired. The
 * "lockstep" return survives ONLY as the no-session sentinel every solo gate keys off
 * (`=== "authoritative"` is false -> solo is byte-for-byte unaffected). Deliberately does NOT
 * touch globalScene - it is a pure runtime read so the engine-free unit tests can call it.
 */
export function getCoopNetcodeMode(): CoopNetcodeMode {
  return active == null ? "lockstep" : "authoritative";
}

/**
 * Showdown 1v1 PvP (C1): the active session kind, or `"coop"` when there is no live session.
 * `"versus"` is a 1v1 showdown match on the co-op substrate. Deliberately does NOT touch
 * globalScene - a pure runtime read so the engine-free unit tests can call it.
 */
export function getCoopSessionKind(): CoopSessionKind {
  return active?.controller.sessionKind ?? "coop";
}

/**
 * Showdown 1v1 PvP (C1): whether THIS client is in a live 1v1 VERSUS (showdown) session.
 * Hard `false` for solo / classic co-op, so those paths are byte-for-byte unaffected.
 */
export function isVersusSession(): boolean {
  return active != null && active.controller.isVersusSession();
}

/**
 * Whether THIS client is the GUEST of a live AUTHORITATIVE co-op session (#633). The single read
 * point for the "guest renders, host is authoritative" gates that must NOT mutate shared
 * host-owned state (e.g. the shared money pool). Hard `false` for solo / lockstep / the host, so
 * those paths are byte-for-byte unaffected. Netcode-only (does NOT read `gameMode`), so it is
 * ALSO true for a showdown-versus guest (versus rides the SAME authoritative substrate).
 */
export function isCoopAuthoritativeGuest(): boolean {
  return active != null && getCoopNetcodeMode() === "authoritative" && active.controller.role === "guest";
}

/**
 * Showdown 1v1 PvP (C3-C6): the SINGLE centralized predicate for the CORE-BATTLE authoritative
 * seams (turn-start divert / turn-end stream / command relay / engine capture+apply / enemy
 * command / victory routing). True when a live AUTHORITATIVE runtime exists AND the mode is a
 * co-op-STYLE battle (classic co-op OR 1v1 showdown-versus). This is what lets showdown ride the
 * co-op full-state stream/replay stack WITHOUT re-implementing it: co-op keeps
 * `gameMode.isCoop`, versus adds `gameMode.isShowdown`, both authoritative.
 *
 * Purely ADDITIVE for the existing seams: a classic co-op run is never `isShowdown` and solo has
 * no active runtime (so this is false) -> solo / co-op are byte-for-byte unaffected. Reads
 * `globalScene`, so it is an ENGINE-side predicate (unlike {@linkcode getCoopNetcodeMode}); the
 * `?? false` guards the rare pre-scene call. The ONLY sites converted to this are the ~dozen core-
 * battle gates - the shop / ME / biome / egg `.isCoop` sites stay co-op-only (do-not-drag-in).
 */
export function isAuthoritativeBattleSession(): boolean {
  if (active == null || getCoopNetcodeMode() !== "authoritative") {
    return false;
  }
  const mode = globalScene?.gameMode;
  return (mode?.isCoop ?? false) || (mode?.isShowdown ?? false);
}

/**
 * Showdown 1v1 PvP (C5): whether THIS client is the versus GUEST, i.e. whether the PRESENTATION
 * perspective flip is active. The guest's own team is authoritatively the ENEMY side (host-ordered);
 * the flip is a RENDER-ONLY side swap so the guest sees its team on the bottom. HARD `false` for
 * solo / co-op / the host (classic co-op guests share ONE player-side team and must NOT flip - this
 * is narrower than {@linkcode isCoopAuthoritativeGuest}, which is true for co-op guests too), so
 * every render site wrapped with this collapses to identity and is byte-for-byte unchanged off the
 * versus-guest path. Read-only at render; NEVER used to mutate authoritative order/state.
 */
export function isShowdownGuestFlip(): boolean {
  return isVersusSession() && getCoopController()?.role === "guest";
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

/** Convenience: the reciprocal rendezvous barriers (#839), or null when not in a co-op run. */
export function getCoopRendezvous(): CoopRendezvous | null {
  return active?.rendezvous ?? null;
}

/** Whether a co-op session is currently active. */
export function isCoopRuntimeActive(): boolean {
  return active != null;
}

/**
 * N-ready field-slot ownership, engine adapter (#633, M5): resolve the owner of PLAYER field
 * slot `fieldIndex` from the mon actually in it ({@linkcode coopOwnerOfFieldSlot} reads the
 * persistent `coopOwner` tag; empty / untagged slots fall back to the fixed 2-player slot map).
 * `getPlayerField()` is index-aligned with field slots (the party's first `playerCapacity`
 * entries, unfiltered), so this is the single place engine code turns a slot into its owner -
 * every command / switch routing gate keys off it instead of assuming the launch layout.
 */
export function coopOwnerOfPlayerFieldSlot(fieldIndex: number): CoopRole {
  return coopOwnerOfFieldSlot(globalScene.getPlayerField(), fieldIndex);
}

/**
 * The PLAYER field slot the LOCAL client owns (#633, M5): the first slot whose resolved owner is
 * the local role. Falls back to the fixed 2-player slot map ({@linkcode coopFieldIndexOf}) when no
 * tagged slot matches (empty field / launch edge), so 2-player behavior is unchanged. In the
 * 2-player double each player owns exactly one slot, so "first" is exact.
 */
export function coopLocalOwnedPlayerFieldSlot(): number {
  const role = active?.controller.role ?? "guest";
  const field = globalScene.getPlayerField();
  for (let i = 0; i < field.length; i++) {
    if (field[i]?.coopOwner === role) {
      return i;
    }
  }
  return coopFieldIndexOf(role);
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
  const owner = coopOwnerOfPlayerFieldSlot(fieldIndex);
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
  // #851: stamp the resolved owner (== active.controller.role past the guard above) so the peer's
  // partner-slot await matches by owner even when a post-half-wipe recenter skews the field index.
  active.battleSync.broadcastLocalCommand(fieldIndex, globalScene.currentBattle.turn, command, owner);
  // #record-replay: capture the deferred-target FIGHT own-slot command (no-op unless recording).
  recordCoopOwnSlotCommand(fieldIndex, command);
}

// =============================================================================
// REPLAY RECORDER co-op enable + taps (#record-replay, Phase 2). The recorder is mode-agnostic + a
// PASSIVE OBSERVER (every record* is no-op unless recording); the ENABLE decision (begin on the
// authoritative HOST of a co-op run) + the wave/command mapping live HERE in the co-op layer, where
// globalScene is available. ZERO behavior change: these only read state + push to the recorder's
// ring buffer, never mutate the engine.
// =============================================================================

/**
 * BEGIN replay recording for THIS co-op run if not already recording (#record-replay). Gated to the
 * authoritative HOST (the sole engine that sees both slots' resolved commands + every committed
 * interaction). Idempotent (the recorder no-ops a same-seed re-call), so it is safe to call once per
 * EncounterPhase. Captures the header: seed + gameMode + the serialized merged roster + the CoopRunConfig
 * + a live-wave provider for interaction pruning. Hard no-op off the live co-op host. Best-effort.
 */
export function maybeBeginReplayRecording(): void {
  if (!globalScene.gameMode.isCoop || active == null || active.controller.role !== "host") {
    return;
  }
  if (isReplayRecording()) {
    return; // already recording this run (idempotent)
  }
  beginReplayRecording({
    seed: globalScene.seed,
    gameModeId: globalScene.gameMode.modeId,
    // The MERGED co-op party as serialized PokemonData (each mon already carries its coopOwner tag).
    roster: globalScene.getPlayerParty().map(p => new PokemonData(p)),
    coopRunConfig: active.controller.runConfig() ?? undefined,
    currentWave: () => globalScene.currentBattle?.waveIndex ?? 0,
  });
}

/** Map a {@linkcode SerializedCommand} (the wire command) to a replay {@linkcode ReplayCommandKind}. */
function serializedCommandToReplayKind(command: SerializedCommand): ReplayCommandKind {
  switch (command.command) {
    case Command.BALL:
      return { kind: "ball", ballIndex: command.cursor };
    case Command.RUN:
      return { kind: "run" };
    case Command.POKEMON:
      return { kind: "switch", partyIndex: command.cursor };
    default:
      // FIGHT / TERA: cursor is the move slot; the first resolved target (if any).
      return command.targets != null && command.targets.length > 0
        ? { kind: "move", moveIndex: command.cursor, target: command.targets[0] }
        : { kind: "move", moveIndex: command.cursor };
  }
}

/**
 * RECORD one OWN-slot resolved command (#record-replay). Called from every own-slot broadcast site (the
 * one chokepoint set: the FIGHT/no-target + BALL/RUN/POKEMON paths in command-phase, and the deferred-
 * target FIGHT via {@linkcode broadcastCoopOwnSlotCommand}). No-op unless recording (host only). Reads the
 * live wave; shallow-copies the kept fields so it never aliases the sent command object.
 */
export function recordCoopOwnSlotCommand(fieldIndex: number, command: SerializedCommand): void {
  if (!isReplayRecording()) {
    return;
  }
  recordReplayCommand({
    type: "command",
    wave: globalScene.currentBattle?.waveIndex ?? 0,
    turn: globalScene.currentBattle?.turn ?? 0,
    slotFieldIndex: fieldIndex,
    command: serializedCommandToReplayKind(command),
  });
}

/**
 * RECORD the PARTNER-slot resolved command (#record-replay) - the command the HOST actually committed for
 * the awaited partner slot, whether RELAYED from the guest or the AI fallback (a null guest reply still
 * produces a real RNG-derived command that is part of the authoritative run). Read off the resolved
 * {@linkcode SerializedCommand}; no-op unless recording. Shallow.
 */
export function recordCoopPartnerSlotCommand(fieldIndex: number, command: SerializedCommand): void {
  if (!isReplayRecording()) {
    return;
  }
  recordReplayCommand({
    type: "command",
    wave: globalScene.currentBattle?.waveIndex ?? 0,
    turn: globalScene.currentBattle?.turn ?? 0,
    slotFieldIndex: fieldIndex,
    command: serializedCommandToReplayKind(command),
  });
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
 * Co-op WAVE-END authoritative capture (#838): the HOST streams the COMPLETE post-exp authoritative
 * battle state (whole player + enemy party as serialized PokemonData, seating, arena, modifiers, money,
 * ER substrates), captured HERE in the host's `BattleEndPhase` AFTER the wave's exp/level/evolution
 * chain has DRAINED (the unshifted ExpPhase / LevelUpPhase / EvolutionPhase chain runs before the pushed
 * BattleEndPhase, so levels / exp / learned moves / evolved species are fully credited here). The guest
 * adopts it in its own BattleEndPhase via a single id-based full-state apply, so its progression converges
 * through the between-wave shop off the same wire the live turns use - the sole post-battle progression channel.
 * Hard no-op unless we are the HOST of a live AUTHORITATIVE co-op run, so solo / non-host / lockstep play is
 * byte-for-byte unaffected. Best-effort + guarded - a send failure never breaks the host's post-battle flow.
 */
export function broadcastCoopWaveEndState(): void {
  if (!globalScene.gameMode.isCoop || active == null || getCoopNetcodeMode() !== "authoritative") {
    return;
  }
  if (active.controller.role !== "host") {
    return;
  }
  const wave = globalScene.currentBattle.waveIndex;
  try {
    const state = captureCoopAuthoritativeBattleState(globalScene.currentBattle.turn);
    if (state == null) {
      coopWarn("runtime", `send waveEndState SKIP wave=${wave} (capture returned null)`);
      return;
    }
    coopLog("runtime", `send waveEndState wave=${wave} tick=${state.tick} (host)`);
    active.battleStream.sendWaveEndState(wave, state);
  } catch (e) {
    /* a wave-end-state send failure must never break the host's post-battle flow */
    coopWarn("runtime", `send waveEndState failed wave=${wave}`, e);
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
 * Read the ME-battle handoff interaction counter (`-1` when idle). Exists for the two-engine duo test
 * harness's per-client ME-state save/restore (this is a process-global module let NOT carried on the
 * `active` runtime, so a two-real-engine harness must capture/restore it per client). Production reads
 * the boolean {@linkcode coopMeInProgress} / {@linkcode coopMeHandoffActive} instead.
 */
export function getCoopMeBattleInteractionCounter(): number {
  return coopMeBattleInteractionCounter;
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
 * GUEST (#847, ME battle-handoff phantom-turn softlock): whether the SPAWNED ME battle has been WON by
 * the host and the guest must now run the ME victory tail instead of opening a phantom next command.
 *
 * THE GAP: the authoritative wave-advance handshake (`coopHasPendingWaveAdvance` / the `waveResolved`
 * message) is the guest's ONLY signal to stop looping a resolved battle - but the host NEVER broadcasts
 * it for an ME-spawned battle. `VictoryPhase` takes the `isMysteryEncounter` branch (handleMysteryEncounter
 * Victory + return) BEFORE `broadcastCoopWaveResolved("win")`, so no wave-advance is ever pending for the
 * ME battle. The guest, a pure renderer that never runs its own FaintPhase/VictoryPhase, finalizes the
 * winning turn with NO pending advance and falls into the turn-advance branch -> a phantom turn N+1 for a
 * battle the host already won + left for the reward shop (the berry-bush deadlock: both barriers then
 * wait at different points).
 *
 * THE SIGNAL: we are the authoritative GUEST inside a STARTED ME-handoff battle and every enemy is
 * fainted. `CoopFinalizeTurnPhase` applies the host's authoritative checkpoint BEFORE calling finishTurn,
 * so a fully-fainted enemy party is the host's REAL win (not a locally-chipped premature victory - the
 * BUG1 hazard the normal path guards against, which reads local chip damage, not the checkpoint). This is
 * deterministic (no dependency on the reward-options message having arrived), and it naturally handles a
 * multi-turn ME battle (false until the LAST turn KOs the field).
 */
export function coopMeHandoffBattleWon(): boolean {
  // #847 ROBUSTNESS (checked FIRST, throw-free): scope the win to the handoff's OWN battle. The handoff
  // flag records the wave the spawned battle started on; a stale flag (an ME whose terminal never cleared
  // it, or module state latched across a vitest `isolate:false` file boundary) must NOT misfire the
  // victory tail on an unrelated later battle. Read only waveIndex here (cheap, never throws on a partial
  // stub scene) so a mismatch returns BEFORE touching gameMode / the enemy party.
  const handoffWave = coopMeHandoffBattleWaveValue();
  if (handoffWave < 0 || globalScene.currentBattle?.waveIndex !== handoffWave) {
    return false;
  }
  if (!coopMeHandoffActive() || !coopMeHandoffBattleStarted() || active!.controller.role !== "guest") {
    return false;
  }
  const enemies = globalScene.getEnemyParty();
  return enemies.length > 0 && enemies.every(e => e == null || e.isFainted());
}

/**
 * GUEST (#847): queue the ME-spawned battle's VICTORY tail so the guest transitions to the ME reward
 * shop (as its counter-parity owner/watcher) instead of a phantom next command. `VictoryPhase`'s
 * `isMysteryEncounter` branch runs `handleMysteryEncounterVictory` -> `BattleEndPhase` ->
 * `MysteryEncounterRewardsPhase` -> the guest's own `SelectModifierPhase` (the reward watcher on a
 * host-owned ME), whose entry arrives at the shop rendezvous point so the host's shop-barrier resolves.
 * Addresses the last enemy by `id` (an off-field but present party member after the checkpoint), falling
 * back to the player lead when none remains, exactly like {@linkcode maybeRunCoopWaveAdvance}'s win arm.
 * Best-effort + guarded - a failure here must never hang the guest's run.
 */
export function queueCoopMeBattleVictoryTail(): void {
  try {
    const lastEnemy = globalScene.getEnemyParty().at(-1);
    const battlerArg = lastEnemy == null ? BattlerIndex.PLAYER : lastEnemy.id;
    coopLog(
      "me",
      `guest ME battle WON: queuing VictoryPhase (ME reward tail, NOT a phantom turn) battler=${battlerArg}`,
    );
    globalScene.phaseManager.pushNew("VictoryPhase", battlerArg);
  } catch (e) {
    /* the ME victory tail is best-effort; a failure here must never hang the guest's run */
    coopWarn("me", "queueCoopMeBattleVictoryTail threw (handled)", e);
  }
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
  // Only an active pump session relays the sentinel. Co-op is authoritative-only (#633 M6): the
  // pump is always OWNER-side (the host); the retired watcher never held a session.
  if (!pump.isSessionActive()) {
    coopLog("me", `owner-relay battle-handoff SKIP (active=${pump.isSessionActive()})`);
    return;
  }
  try {
    coopLog("me", "owner-relay battle-handoff sentinel (end pump, run spawned battle)");
    pump.relayMeBattleHandoff(globalScene.currentBattle?.turn);
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
  opts: {
    username?: string | undefined;
    netcodeMode?: CoopNetcodeMode | undefined;
    kind?: CoopSessionKind | undefined;
  } = {},
): CoopRuntime {
  coopLog(
    "launch",
    `startLocalCoopSession username=${opts.username ?? "(default)"} netcode=${opts.netcodeMode ?? "authoritative"} kind=${opts.kind ?? "coop"}`,
  );
  clearCoopRuntime();
  const { host, guest } = createLoopbackPair();
  // #820 ONE FACTORY: the full runtime (objects + EVERY hook) comes from assembleCoopRuntime -
  // the same factory the live peer path and the duo harness use. Only the spoof partner and
  // the host-side netcode pin are dev-path extras.
  const runtime = assembleCoopRuntime(host, opts);
  runtime.controller.setNetcodeMode(opts.netcodeMode ?? "authoritative");
  runtime.partnerTransport = guest;
  runtime.spoof = new SpoofGuest(guest);
  setCoopRuntime(runtime);
  coopLog(
    "launch",
    `local session ready role=${runtime.controller.role} netcode=${runtime.controller.netcodeMode} -> connecting`,
  );
  runtime.controller.connect();
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
  opts: {
    username?: string | undefined;
    netcodeMode?: CoopNetcodeMode | undefined;
    kind?: CoopSessionKind | undefined;
  } = {},
): CoopRuntime {
  coopLog(
    "launch",
    `connectCoopSession role=${transport.role} state=${transport.state} username=${opts.username ?? "(default)"} netcode=${opts.netcodeMode ?? "authoritative"}`,
  );
  clearCoopRuntime();
  const runtime = assembleCoopRuntime(transport, opts);
  setCoopRuntime(runtime);
  coopLog(
    "launch",
    `peer session ready role=${runtime.controller.role} netcode=${runtime.controller.netcodeMode} -> connecting`,
  );
  runtime.controller.connect();
  return runtime;
}

/**
 * Assemble + WIRE one co-op runtime over `transport` WITHOUT tearing down any prior session and
 * WITHOUT registering it as the active runtime or sending `hello`. This is the additive seam
 * {@linkcode connectCoopSession} delegates to (it adds the clear / setCoopRuntime / connect around
 * this); it exists separately so a TWO-ENGINE in-process harness can stand up BOTH clients' runtimes
 * over a single {@linkcode createLoopbackPair} - `connectCoopSession`'s leading `clearCoopRuntime()`
 * (which CLOSES the live transport) would otherwise disconnect the loopback pair when the second
 * client is built. The caller selects the live runtime with {@linkcode setCoopRuntime} and drives
 * {@linkcode CoopSessionController.connect} on each. Production behaviour is unchanged: every prod
 * caller goes through `connectCoopSession` / `startLocalCoopSession`, which keep the clear+set+connect
 * wrapper intact.
 */
export function assembleCoopRuntime(
  transport: CoopTransport,
  opts: {
    username?: string | undefined;
    netcodeMode?: CoopNetcodeMode | undefined;
    kind?: CoopSessionKind | undefined;
  } = {},
): CoopRuntime {
  const controller = new CoopSessionController(transport, { username: opts.username, version: COOP_PROTOCOL_VERSION });
  // Pin the chosen netcode (#633, selectable A/B). On the HOST this is the source of
  // truth that rides along in broadcastRunConfig; on the GUEST it is only the pre-
  // runConfig default (the host's value overwrites it on receipt). Default lockstep.
  controller.setNetcodeMode(opts.netcodeMode ?? "authoritative");
  // Showdown 1v1 PvP (C1): pin the session kind the same way. On the HOST it rides along
  // in broadcastRunConfig; on the GUEST it is only the pre-runConfig default (the host's
  // value overwrites it on receipt). Default "coop" so co-op stays byte-identical.
  controller.setSessionKind(opts.kind ?? "coop");
  const battleSync = new CoopBattleSync(transport);
  const battleStream = new CoopBattleStreamer(transport);
  const interactionRelay = new CoopInteractionRelay(transport);
  const uiMirror = new CoopUiMirror(transport);
  const mePump = new CoopMePump(interactionRelay);
  const rendezvous = new CoopRendezvous(transport);
  const runtime: CoopRuntime = {
    controller,
    battleSync,
    battleStream,
    interactionRelay,
    uiMirror,
    mePump,
    rendezvous,
    localTransport: transport,
  };
  wireCoopGhostPoolSync(controller, battleStream);
  wireCoopResyncResponder(controller, battleStream);
  wireCoopEnemyPartyResponder(controller, battleStream);
  wireCoopWaveResolved(controller, battleStream);
  wireCoopWaveEndState(controller, battleStream);
  wireCoopMeChecksumCheck(battleStream);
  wireCoopLiveEvents(controller, battleStream);
  wireCoopLearnMoveForward(transport);
  wireCoopLearnMoveBatchForward(transport);
  wireCoopDexSync(transport);
  wireShowdownResult(transport, controller);
  wireCoopDisconnectReaction(transport, interactionRelay, runtime);
  wireCoopStallWatchdog(transport, interactionRelay, battleStream, runtime);
  // #812: ownership probe for pre-responder commandRequests (buffer own-slot, decline foreign).
  battleSync.setSlotOwnershipProbe(fieldIndex => {
    try {
      return coopOwnerOfPlayerFieldSlot(fieldIndex) === controller.role;
    } catch {
      return true; // unknown -> buffer (never wrongly decline a real player's slot)
    }
  });
  // #817/#820 cosmetic cursor mirror: the ME owner's option cursor lands on the WATCHER's
  // read-only selector. #820: this (plus the probe/watchdog/revival hooks) used to be wired
  // ONLY in startLocalCoopSession - the DEV factory - so the LIVE path silently lacked them
  // (the 16:38 capture: 13 meCursor rx, zero applies). ONE factory now wires everything.
  controller.onMeCursor = index => {
    try {
      if (controller.isLocalOwnerAtCounter(coopMeInteractionStartValue())) {
        return; // we drive this ME - our own cursor rules
      }
      const mode = globalScene.ui?.getMode();
      const handler = globalScene.ui?.getHandler();
      // #818: the cursor mirror now covers the ER mini-game (quiz/braille/footprints)
      // screen too - it renders on BOTH clients under UiMode.ER_QUIZ, so the owner's
      // option cursor lands on the watcher's read-only quiz exactly as it does for a ME.
      // The er-quiz handler's setCursor clamps a stale index, so it can never crash here.
      const mirrorable = mode === UiMode.MYSTERY_ENCOUNTER || mode === UiMode.ER_QUIZ;
      if (mirrorable && typeof handler?.setCursor === "function") {
        handler.setCursor(index);
        coopLog("me", `meCursor APPLIED index=${index} mode=${mode}`);
      } else {
        coopLog(
          "me",
          `meCursor SKIPPED index=${index} mode=${mode} hasSetCursor=${typeof handler?.setCursor === "function"}`,
        );
      }
    } catch (e) {
      coopWarn("me", "meCursor apply threw", e);
    }
  };
  // #809: the partner asked THIS client to pick a Revival Blessing target for its own mon.
  interactionRelay.onRevivalPrompt = fieldIndex => {
    if (getCoopRuntime() !== runtime || runtime.controller.role === "host") {
      return;
    }
    try {
      globalScene.phaseManager.unshiftNew("CoopGuestRevivalPhase", fieldIndex);
    } catch (e) {
      coopWarn("replay", `revivalPrompt fieldIndex=${fieldIndex} could not queue the picker (${e}) - host auto-picks`);
    }
  };
  // #807: a fresh SESSION starts a fresh tick line (assembly-scoped, NOT setCoopRuntime -
  // the duo harness re-registers runtimes per context swap and must not reset mid-session).
  resetCoopStateTicks();
  return runtime;
}

/**
 * Re-install the LAST-WRITE-WINS process-global co-op hooks for `runtime` (#633 bounded-scope: two-engine
 * harness). Three of the co-op hooks are NOT per-runtime state - they are module-level process-globals that
 * whichever runtime wired LAST owns: the er-ghost-teams ghost-pool PUBLISHER + guest FETCH-SUPPRESSION
 * predicate ({@linkcode wireCoopGhostPoolSync}) and the host live-battle-event EMITTER
 * ({@linkcode wireCoopLiveEvents}). In production there is exactly ONE runtime, so last-write-wins is
 * correct and this is never called. In the TWO-ENGINE harness both a host and a guest runtime coexist, so
 * the hook the guest wired last would answer for BOTH engines (wrong role gate). The cooperative scheduler
 * calls this after {@linkcode setCoopRuntime} on every client swap so the ACTIVE runtime owns its role-gated
 * hooks. Additive + idempotent; unused in production; the real two-client WebRTC path is untouched.
 */
export function installCoopRuntimeProcessHooks(runtime: CoopRuntime): void {
  installCoopRuntimeGhostHooks(runtime);
  installCoopRuntimeLiveEmitter(runtime);
}

/**
 * Re-point ONLY the er-ghost-teams ghost-pool PUBLISHER + guest FETCH-SUPPRESSION process-globals at
 * `runtime`'s role-gated closures ({@linkcode wireCoopGhostPoolSync}). Split out from
 * {@linkcode installCoopRuntimeProcessHooks} so the two-engine harness can route the GHOST hooks per
 * client on EVERY swap (a correctness fix - the guest must own suppression, the host the publisher) while
 * installing the live-event emitter ONLY for the tests that exercise it. Additive + idempotent; unused in
 * production.
 */
export function installCoopRuntimeGhostHooks(runtime: CoopRuntime): void {
  wireCoopGhostPoolSync(runtime.controller, runtime.battleStream);
}

/**
 * Re-point ONLY the host live-battle-event EMITTER process-global at `runtime`'s role-gated closure
 * ({@linkcode wireCoopLiveEvents}). Split out so the two-engine harness enables the LIVE per-event stream
 * (host emits, guest applies) only for the tests that assert it - the emitter self-gates to a no-op on a
 * guest/solo runtime, so installing the host runtime's emitter during host pumps is what turns the stream
 * ON. Additive + idempotent; unused in production (production wires it once at assembly).
 */
export function installCoopRuntimeLiveEmitter(runtime: CoopRuntime): void {
  wireCoopLiveEvents(runtime.controller, runtime.battleStream);
}

/** Tear down and forget the live co-op session (closing its transport). */
export function clearCoopRuntime(): void {
  if (active == null) {
    return;
  }
  // #808: invalidate every in-flight async continuation scheduled under this session.
  sessionGeneration++;
  coopLog(
    "launch",
    `clearCoopRuntime role=${active.controller.role} netcode=${active.controller.netcodeMode} gen->${sessionGeneration}`,
  );
  active.controller.dispose();
  active.battleSync.dispose();
  active.battleStream.dispose();
  active.interactionRelay.dispose();
  active.uiMirror.dispose();
  active.mePump.endSession();
  active.rendezvous.dispose();
  active.spoof?.dispose();
  // Drop the persistent move-learn forward listener + its in-flight slot set (#633 BUG3+5) so a
  // subsequent solo / lockstep run has no listener and spawns no CoopReplayLearnMovePhase.
  offLearnMoveForward?.();
  offLearnMoveForward = null;
  offLearnMoveBatchForward?.();
  offLearnMoveBatchForward = null;
  offDexSync?.();
  offDexSync = null;
  offDisconnectReaction?.();
  offDisconnectReaction = null;
  offStallWatchdog?.();
  offStallWatchdog = null;
  learnMoveForwardInFlight.clear();
  learnMoveBatchForwardInFlight.clear();
  active.localTransport.close();
  // Clear the co-op ghost-pool hooks so a subsequent SOLO run fetches normally (#633).
  setGhostPoolPublisher(null);
  setCoopGhostFetchSuppressed(null);
  // Clear the live-event emitter so a subsequent solo / lockstep run never streams battle events (#633).
  setCoopLiveEmitter(null);
  // #834 (structural audit P1-1): a mid-ME GameOver reaches here with the ME pins still SET
  // (only the ME terminal cleared them). Stale pins mis-arm the pin-guarded detached listeners
  // and the ME gates at the NEXT run's first encounter - a cross-run desync. Reset the full pin
  // family (setCoopMeInteractionStart(-1) also auto-clears the handoff + bespoke flags) and the
  // adopted host presentation alongside the battle-counter reset that already lived here.
  setCoopMeInteractionStart(-1);
  // Reset the authoritative wave-advance state so a subsequent run starts clean (#633).
  pendingWaveAdvance = null;
  lastResolvedWave = -1;
  // Reset the wave-end authoritative snapshot state so a subsequent run starts clean (#838).
  pendingWaveEndState = null;
  lastWaveEndStateWave = -1;
  // Reset the ME battle handoff counter so a subsequent run starts clean (#633).
  coopMeBattleInteractionCounter = -1;
  // Clear the cycle-free authoritative-guest predicate so a subsequent solo / lockstep run reads false.
  setCoopAuthoritativeGuestPredicate(null);
  setShowdownGuestFlipPredicate(null);
  // #record-replay: stop + drop the captured trace at run teardown so the next run records fresh.
  clearReplayRecording();
  active = null;
}

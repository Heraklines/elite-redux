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
import { COOP_CHECKSUM_SENTINEL } from "#data/elite-redux/coop/coop-battle-checksum";
import {
  applyCoopFullSnapshot,
  captureCoopChecksum,
  captureCoopFullSnapshot,
} from "#data/elite-redux/coop/coop-battle-engine";
import { CoopBattleStreamer } from "#data/elite-redux/coop/coop-battle-stream";
import { CoopBattleSync } from "#data/elite-redux/coop/coop-battle-sync";
import { CoopInteractionRelay } from "#data/elite-redux/coop/coop-interaction-relay";
import { CoopMePump } from "#data/elite-redux/coop/coop-me-pump";
import { coopOwnerOfFieldIndex } from "#data/elite-redux/coop/coop-session";
import { CoopSessionController } from "#data/elite-redux/coop/coop-session-controller";
import { SpoofGuest } from "#data/elite-redux/coop/coop-spoof-guest";
import type { CoopFullBattleSnapshot, CoopNetcodeMode, CoopWaveOutcome } from "#data/elite-redux/coop/coop-transport";
import { type CoopTransport, createLoopbackPair, type SerializedCommand } from "#data/elite-redux/coop/coop-transport";
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
 * Co-op resync responder (#633, TRACK-2): the HOST answers a guest's `requestStateSync`
 * (sent when the guest's post-turn checksum disagreed with the host's) by serializing its
 * FULL authoritative battle state, lz-compressing it, and streaming it back stamped with
 * the request `seq`. The guest decompresses + adopts it field-by-field. Gated on the live
 * HOST role so a guest/solo client never answers. Best-effort + guarded - a serialize
 * failure never breaks the host's turn.
 */
function wireCoopResyncResponder(controller: CoopSessionController, battleStream: CoopBattleStreamer): void {
  battleStream.onStateSyncRequest((_turn, seq) => {
    if (controller.role !== "host") {
      return;
    }
    try {
      const snapshot = captureCoopFullSnapshot();
      if (snapshot == null) {
        return;
      }
      battleStream.sendStateSync(compressToBase64(JSON.stringify(snapshot)), seq);
    } catch {
      /* a resync serialize/send failure must never break the host's turn */
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
let pendingWaveAdvance: { wave: number; outcome: CoopWaveOutcome } | null = null;
/** The last wave the guest already ran the victory tail for (guards a duplicate `waveResolved`). */
let lastResolvedWave = -1;

/**
 * GUEST: take + clear any pending wave-advance the host signaled (#633). Returns the
 * outcome to run the victory tail for, or null when none is pending or this wave was
 * already advanced past. Called by `CoopReplayTurnPhase` at a safe boundary. Bumps the
 * double-advance guard so a duplicate `waveResolved` for the same wave is a no-op.
 */
export function consumeCoopPendingWaveAdvance(): { wave: number; outcome: CoopWaveOutcome } | null {
  const pending = pendingWaveAdvance;
  pendingWaveAdvance = null;
  if (pending == null || pending.wave <= lastResolvedWave) {
    return null;
  }
  lastResolvedWave = pending.wave;
  return pending;
}

/**
 * Co-op authoritative wave-advance responder (#633): the GUEST records the host's
 * `waveResolved` signal as a one-shot pending flag (guarded against a double-advance by
 * wave number). It is consumed at the next safe turn boundary by `CoopReplayTurnPhase`
 * (NOT applied here mid-message) so an in-flight replay turn finishes first. Gated on the
 * live GUEST role in the AUTHORITATIVE netcode; a host / solo / lockstep client ignores it.
 */
function wireCoopWaveResolved(controller: CoopSessionController, battleStream: CoopBattleStreamer): void {
  battleStream.onWaveResolved((wave, outcome) => {
    if (controller.role !== "guest" || getCoopNetcodeMode() !== "authoritative") {
      return;
    }
    // Already advanced past this wave (a duplicate signal) -> ignore.
    if (wave <= lastResolvedWave) {
      return;
    }
    // Latest signal wins (a later wave supersedes an unconsumed earlier one).
    if (pendingWaveAdvance == null || wave >= pendingWaveAdvance.wave) {
      pendingWaveAdvance = { wave, outcome };
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
      return;
    }
    console.warn(`[coop-desync] me-entry seq=${seq} owner=${ownerChecksum} watcher=${ours}`);
    void battleStream.requestStateSync(seq).then(blob => {
      if (blob == null) {
        return;
      }
      try {
        applyCoopFullSnapshot(JSON.parse(decompressFromBase64(blob)) as CoopFullBattleSnapshot);
        const healed = captureCoopChecksum();
        console.info(
          healed === ownerChecksum
            ? `[coop-resync] me-entry seq=${seq} ok`
            : `[coop-resync] me-entry seq=${seq} still-diverged owner=${ownerChecksum} watcher=${healed}`,
        );
      } catch {
        /* a malformed resync blob must never crash the ME flow */
      }
    });
  });
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
    authoritativeLatched = true;
    return "authoritative";
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
  if (coopOwnerOfFieldIndex(fieldIndex) !== active.controller.role) {
    return;
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
export function broadcastCoopWaveResolved(outcome: CoopWaveOutcome): void {
  if (!globalScene.gameMode.isCoop || active == null || getCoopNetcodeMode() !== "authoritative") {
    return;
  }
  if (active.controller.role !== "host") {
    return;
  }
  try {
    active.battleStream.sendWaveResolved(globalScene.currentBattle.waveIndex, outcome);
  } catch {
    /* a wave-resolved send failure must never break the host's post-battle flow */
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
  wireCoopWaveResolved(controller, battleStream);
  wireCoopMeChecksumCheck(battleStream);
  setCoopRuntime(runtime);
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
  wireCoopWaveResolved(controller, battleStream);
  wireCoopMeChecksumCheck(battleStream);
  setCoopRuntime(runtime);
  controller.connect();
  return runtime;
}

/** Tear down and forget the live co-op session (closing its transport). */
export function clearCoopRuntime(): void {
  if (active == null) {
    return;
  }
  active.controller.dispose();
  active.battleSync.dispose();
  active.battleStream.dispose();
  active.interactionRelay.dispose();
  active.uiMirror.dispose();
  active.mePump.endSession();
  active.spoof?.dispose();
  active.localTransport.close();
  // Clear the co-op ghost-pool hooks so a subsequent SOLO run fetches normally (#633).
  setGhostPoolPublisher(null);
  setCoopGhostFetchSuppressed(null);
  // Reset the authoritative wave-advance state so a subsequent run starts clean (#633).
  pendingWaveAdvance = null;
  lastResolvedWave = -1;
  // Drop the authoritative latch so a subsequent solo / lockstep run is not forced authoritative.
  authoritativeLatched = false;
  active = null;
}

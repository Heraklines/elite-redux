/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Showdown 1v1 PvP (C3): the live per-MATCH battle state, stashed process-wide so the
// battle machinery (battle-scene enemy-trainer construction, the enemy-command relay, the
// result phase) can read the negotiated teams WITHOUT threading them through every phase
// constructor. Set once the C2 negotiation resolves (both teams validated + both ready),
// cleared when the match ends. Engine-free (holds plain manifests + the transport relay).
//
//   - `ownManifest`     : THIS client's team (the player party; the guest's own, host's own).
//   - `opponentManifest`: the OPPONENT's validated team - the HOST builds its ENEMY party from
//                         this; the guest sees it as the enemy side (streamed) / flipped to top.
//   - `relay`           : the enemy-command relay (C4), or null for a host-solo bootstrap test.
// =============================================================================

import type { GhostTrainerProfile } from "#data/elite-redux/er-ghost-profile";
import type { ShowdownCommandRelay } from "#data/elite-redux/showdown/showdown-command-relay";
import type { ShowdownBattleFormat, ShowdownSession } from "#data/elite-redux/showdown/showdown-session";
import type { ShowdownMonManifest } from "#data/elite-redux/showdown/showdown-team";
import type { Starter } from "#types/save-data";

interface ShowdownBattleState {
  ownManifest: ShowdownMonManifest[];
  opponentManifest: ShowdownMonManifest[];
  relay: ShowdownCommandRelay | null;
  /**
   * The AGREED field-width format for this match (both clients validated equal in the negotiate
   * handshake). "singles" for a plain 1v1; "doubles"/"triples" for a tournament match. The HOST's
   * battle bootstrap (`BattleScene.checkIsDouble`/`resolveBattleFormat`) reads this to build the
   * field to the negotiated width; the guest adopts the host's format from the launch snapshot.
   */
  battleFormat: ShowdownBattleFormat;
  /**
   * Task C7: the OPPONENT's authored ghost-trainer presentation (already sanitized on receipt),
   * or null when the opponent authored none. The host applies it to the enemy trainer; the guest
   * applies it to the flipped-top trainer; the result phase reads its win/lose dialogue lines.
   */
  opponentProfile: GhostTrainerProfile | null;
  /**
   * Task D1/D2: the escrow server's match id for a STAKED match, or null for a FRIENDLY match
   * (no escrow). The result phase reports the outcome + applies settlement only when this is set;
   * the `showdownResult` / `showdownVoid` wire messages carry it verbatim.
   */
  matchId: string | null;
  /**
   * Ranked ladder: set when BOTH players opted into ranked at the wager screen, else null (casual).
   * The result phase reports the decisive outcome to /showdown/rank/result (dual attestation) when
   * this is present and the match is NOT voided. Orthogonal to `matchId` (ranked works for a friendly).
   */
  ranked: ShowdownRankedContext | null;
}

/** The identity a ranked result is reported against (shared, agreed by both clients at wager commit). */
export interface ShowdownRankedContext {
  /** The ranked-match id both clients report against (the escrow id when staked, else a host-minted id). */
  rankedMatchId: string;
  /** The HOST-role player's account username. */
  hostUid: string;
  /** The GUEST-role player's account username. */
  guestUid: string;
}

let state: ShowdownBattleState | null = null;

/**
 * A relay created during the PRE-BATTLE flow (negotiate -> wager) but not yet handed to a live match.
 * Held here so an abort / disconnect BEFORE the wager commit can dispose it - giving the relay a
 * lifetime symmetric with the {@linkcode ShowdownSession} (which every non-commit exit already disposes).
 * {@linkcode beginShowdownBattle} adopts it into the live state (clearing this slot without disposing);
 * {@linkcode disposePendingShowdownRelay} tears down a still-pending relay on any non-commit exit.
 */
let pendingRelay: ShowdownCommandRelay | null = null;

/**
 * Stash the pre-battle relay so a pre-commit abort can dispose it. Disposes any prior pending relay we
 * are replacing (a fresh flow supersedes an old one). Pass null to simply clear the slot.
 */
export function setPendingShowdownRelay(relay: ShowdownCommandRelay | null): void {
  if (pendingRelay != null && pendingRelay !== relay) {
    pendingRelay.dispose();
  }
  pendingRelay = relay;
}

/** Dispose + clear a still-pending pre-battle relay (a non-commit exit: negotiate fail / wager abandon). */
export function disposePendingShowdownRelay(): void {
  pendingRelay?.dispose();
  pendingRelay = null;
}

/**
 * B7 item 8: the {@linkcode ShowdownSession} created at showdown-flow START - BEFORE starter select
 * opens - so its transport listener is live and BUFFERS the opponent's `showdownTeam`/`showdownReady`
 * even when the peer confirms its team FIRST (otherwise those messages arrive with no session listener
 * and are dropped forever, stranding negotiate until it times out -> the "dead-ends to title" bug).
 * Held here (like {@linkcode pendingRelay}) so EVERY exit - negotiate resolve/reject, abort, OR backing
 * out of starter select - can dispose the listener.
 */
let pendingSession: ShowdownSession | null = null;

/**
 * Stash the pre-negotiate session so any exit can dispose its transport listener. Disposes any prior
 * pending session we are replacing (a fresh flow supersedes an old one). Pass null to clear the slot.
 */
export function setPendingShowdownSession(session: ShowdownSession | null): void {
  if (pendingSession != null && pendingSession !== session) {
    pendingSession.dispose();
  }
  pendingSession = session;
}

/** Dispose + clear a still-pending pre-negotiate session (negotiate done / abort / starter-select back-out). */
export function disposePendingShowdownSession(): void {
  pendingSession?.dispose();
  pendingSession = null;
}

/**
 * B7 item 14b: rejoin re-senders. A WebRTC drop is healed by {@linkcode WebRtcTransport.replaceChannel}
 * (the transport instance + its listeners SURVIVE - only the inner channel is swapped), so the pre-battle
 * components stay bound. What is LOST are the frames sent while the channel was dark. Each surviving
 * pre-battle component (the negotiation {@linkcode ShowdownSession}, the wager handler) registers an
 * IDEMPOTENT re-sender of its current state; on a versus rejoin the coop runtime fires them all, so the
 * peer that missed a team/ready/offer/arrival in the dark window gets it again and the handshake completes
 * instead of one client stranding on the wager while the other never leaves teambuild.
 */
const rejoinResenders = new Set<() => void>();

/** Register an idempotent rejoin re-sender. Returns an unregister fn (call on the component's teardown). */
export function addShowdownRejoinResender(resend: () => void): () => void {
  rejoinResenders.add(resend);
  return () => {
    rejoinResenders.delete(resend);
  };
}

/** Fire every registered rejoin re-sender (called by the coop runtime after a versus rejoin succeeds). */
export function fireShowdownRejoinResend(): void {
  for (const resend of [...rejoinResenders]) {
    try {
      resend();
    } catch (err) {
      console.warn("[showdown-rejoin] a rejoin re-sender threw (ignored)", err);
    }
  }
}

/**
 * Team Menu (Phase D): the pre-built preset the player chose to enter the lobby with, reconstructed
 * into engine {@linkcode Starter}s (via `manifestToStarter`). Set by the Team Menu's enter-lobby
 * callback BEFORE pairing; CONSUMED by `SelectStarterPhase.startShowdownSelect`, which then SKIPS the
 * interactive grid+editor teambuild and feeds these straight into the existing negotiate/wager pipeline.
 * Absent (null) = the legacy in-lobby build path (kept code-tolerant, unreachable from the new flow).
 * Single-use: consuming clears it, so a subsequent match never inherits a stale preset.
 */
let pendingPresetStarters: Starter[] | null = null;

/** Stash the chosen preset's reconstructed starters for the next showdown launch (Team Menu -> lobby). */
export function setPendingShowdownPresetStarters(starters: Starter[] | null): void {
  pendingPresetStarters = starters;
}

/** Consume (read + clear) the pending preset starters. Returns null when the legacy build path applies. */
export function consumePendingShowdownPresetStarters(): Starter[] | null {
  const starters = pendingPresetStarters;
  pendingPresetStarters = null;
  return starters;
}

/**
 * Begin a showdown match: stash both teams (+ the optional enemy-command relay + the opponent's
 * sanitized presentation). Idempotent overwrite (a rematch replaces the prior state). `relay` is
 * null for a host-solo bootstrap; `opponentProfile` is null when the opponent authored no profile.
 */
export function beginShowdownBattle(
  ownManifest: ShowdownMonManifest[],
  opponentManifest: ShowdownMonManifest[],
  relay: ShowdownCommandRelay | null = null,
  opponentProfile: GhostTrainerProfile | null = null,
  matchId: string | null = null,
  ranked: ShowdownRankedContext | null = null,
  battleFormat: ShowdownBattleFormat = "singles",
): void {
  // Adopt the pre-battle relay into the live state: clear the pending slot WITHOUT disposing the
  // adopted relay (endShowdownBattle owns its teardown now). Dispose a stale, non-adopted pending relay.
  if (pendingRelay != null && pendingRelay !== relay) {
    pendingRelay.dispose();
  }
  pendingRelay = null;
  state = { ownManifest, opponentManifest, relay, opponentProfile, matchId, ranked, battleFormat };
}

/** The live match state, or null when no showdown match is active. */
export function getShowdownBattleState(): Readonly<ShowdownBattleState> | null {
  return state;
}

/** The OPPONENT's team (the host's enemy party is built from this), or null. */
export function getShowdownOpponentManifest(): ShowdownMonManifest[] | null {
  return state?.opponentManifest ?? null;
}

/** THIS client's own team, or null. */
export function getShowdownOwnManifest(): ShowdownMonManifest[] | null {
  return state?.ownManifest ?? null;
}

/**
 * Task C7: the OPPONENT's sanitized ghost-trainer presentation (sprite/class/name/title/dialogue/FX),
 * or null when no match is active / the opponent authored none. The battle bootstrap applies it to the
 * enemy trainer (host) / flipped-top trainer (guest); the result phase reads its win/lose dialogue.
 */
export function getShowdownOpponentProfile(): GhostTrainerProfile | null {
  return state?.opponentProfile ?? null;
}

/** The enemy-command relay (C4), or null (host-solo bootstrap / no match). */
export function getShowdownRelay(): ShowdownCommandRelay | null {
  return state?.relay ?? null;
}

/**
 * The negotiated field-width format of the active match ("singles"/"doubles"/"triples"), or null when
 * no showdown match is active. The HOST's battle bootstrap reads this to build the field to the agreed
 * width; a plain (non-tournament) match is always "singles".
 */
export function getShowdownBattleFormat(): ShowdownBattleFormat | null {
  return state?.battleFormat ?? null;
}

/** Task D1/D2: the escrow match id for a STAKED match, or null for a friendly (no escrow). */
export function getShowdownMatchId(): string | null {
  return state?.matchId ?? null;
}

/** Ranked ladder: the ranked reporting context when both players opted in, else null (casual). */
export function getShowdownRankedContext(): ShowdownRankedContext | null {
  return state?.ranked ?? null;
}

/** Whether a showdown match is active (both teams stashed). */
export function isShowdownBattleActive(): boolean {
  return state != null;
}

/** End the match: drop the stashed state (+ dispose the relay). Idempotent. */
export function endShowdownBattle(): void {
  state?.relay?.dispose();
  state = null;
}

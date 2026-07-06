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

import type { ShowdownCommandRelay } from "#data/elite-redux/showdown/showdown-command-relay";
import type { ShowdownMonManifest } from "#data/elite-redux/showdown/showdown-team";

interface ShowdownBattleState {
  ownManifest: ShowdownMonManifest[];
  opponentManifest: ShowdownMonManifest[];
  relay: ShowdownCommandRelay | null;
}

let state: ShowdownBattleState | null = null;

/**
 * Begin a showdown match: stash both teams (+ the optional enemy-command relay). Idempotent
 * overwrite (a rematch replaces the prior state). `relay` is null for a host-solo bootstrap.
 */
export function beginShowdownBattle(
  ownManifest: ShowdownMonManifest[],
  opponentManifest: ShowdownMonManifest[],
  relay: ShowdownCommandRelay | null = null,
): void {
  state = { ownManifest, opponentManifest, relay };
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

/** The enemy-command relay (C4), or null (host-solo bootstrap / no match). */
export function getShowdownRelay(): ShowdownCommandRelay | null {
  return state?.relay ?? null;
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

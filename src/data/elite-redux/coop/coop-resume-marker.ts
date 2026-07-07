/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Co-op RESUME MARKER (#810, made symmetric + identity-gated per the maintainer
// directive): the lobby's memory that "I have a saved run with THIS partner".
//
// WHY THIS EXISTS / WHAT WAS BROKEN LIVE: the run's SAVE lives in each client's
// own local slot (both the host and the guest write it - `saveAll` has no guest
// early-return). But the marker used to be recorded ONLY by the host and read
// ONLY by the host, while the lobby re-decides "host" every connect (the ACCEPTOR
// of the join request becomes host - `respondToRequest`). So the player who saved
// the run (last session's host) is only THIS session's host if they happen to
// accept; when the ex-guest accepts and becomes host, it looked up a marker it
// never wrote -> no offer -> the flow silently started a NEW game. Fix: BOTH
// clients record the marker, keyed on the EXACT player-account PAIR (self +
// partner stable identities), and BOTH read it on connect - so whichever client
// becomes host this session finds its own local marker + slot to resume from, and
// a save is never offered to the wrong partner (or the wrong local account).
//
// The marker is a pointer, not a save - the session itself lives in the normal
// save slot, and loading it still goes through the #807 resume gate (which passes
// because the offer only fires while a live connection to the matching partner
// exists).
// =============================================================================

import { coopLog, coopWarn } from "#data/elite-redux/coop/coop-debug";

const COOP_RESUME_MARKER_KEY = "er-coop-resume";

export interface CoopResumeMarker {
  /** The save slot holding the co-op session (this client's own auto-picked slot). */
  slot: number;
  /** The LOCAL player's account identity at save time (the run's participant, self). */
  self: string;
  /** The partner's account identity at save time (matched on reconnect). */
  partner: string;
  /** Wave the run was on when saved (shown in the Resume offer). */
  wave: number;
  /** Save timestamp (freshness display / future expiry). */
  ts: number;
}

/**
 * Record/refresh the marker on every co-op session save. Called by BOTH clients
 * (host and guest each hold their own local save slot), so whichever client is
 * assigned host on the next lobby connect can find its own resume memory.
 * `self` + `partner` are the two players' stable account identities (the same
 * `loggedInUser?.username`-derived names the lobby matches on).
 */
export function recordCoopResumeMarker(slot: number, self: string, partner: string, wave: number): void {
  if (slot < 0 || !self || !partner) {
    return;
  }
  try {
    const marker: CoopResumeMarker = { slot, self, partner, wave, ts: Date.now() };
    localStorage.setItem(COOP_RESUME_MARKER_KEY, JSON.stringify(marker));
    coopLog("launch", `resume marker recorded slot=${slot} self=${self} partner=${partner} wave=${wave} (#810)`);
  } catch {
    /* storage full/unavailable is non-fatal - resume just won't be offered */
  }
}

/**
 * Read the marker only if it matches the EXACT participant pair (both identities,
 * case-insensitive); null otherwise. Matching `self` too prevents offering account
 * A's saved run after a different account logs in on the same browser; matching
 * `partner` is the identity gate the maintainer requires - a save is never offered
 * with a different partner.
 */
export function readCoopResumeMarker(self: string | null, partner: string | null): CoopResumeMarker | null {
  if (!self || !partner) {
    return null;
  }
  try {
    const raw = localStorage.getItem(COOP_RESUME_MARKER_KEY);
    if (raw == null) {
      return null;
    }
    const marker = JSON.parse(raw) as CoopResumeMarker;
    if (
      typeof marker?.slot !== "number"
      || marker.slot < 0
      || typeof marker.self !== "string"
      || typeof marker.partner !== "string"
      || typeof marker.wave !== "number"
    ) {
      clearCoopResumeMarker();
      return null;
    }
    if (marker.self.toLowerCase() !== self.toLowerCase() || marker.partner.toLowerCase() !== partner.toLowerCase()) {
      return null;
    }
    return marker;
  } catch (e) {
    coopWarn("launch", `resume marker unreadable (${e}) -> cleared`);
    clearCoopResumeMarker();
    return null;
  }
}

/** Clear the marker (run ended, or it went stale/corrupt). */
export function clearCoopResumeMarker(): void {
  try {
    localStorage.removeItem(COOP_RESUME_MARKER_KEY);
  } catch {
    /* ignore */
  }
}

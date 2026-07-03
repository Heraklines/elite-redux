/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Co-op RESUME MARKER (#810): the lobby's memory that "I have a saved run with
// THIS partner". The HOST records it on every co-op session save; on the next
// lobby connect with the same partner, the marker drives the Resume offer.
// The marker is a pointer, not a save - the session itself lives in the normal
// save slot, and loading it still goes through the #807 resume gate (which
// passes because the offer only fires while a live connection exists).
// =============================================================================

import { coopLog, coopWarn } from "#data/elite-redux/coop/coop-debug";

const COOP_RESUME_MARKER_KEY = "er-coop-resume";

export interface CoopResumeMarker {
  /** The save slot holding the co-op session (the host's auto-picked slot). */
  slot: number;
  /** The partner's account name at save time (matched on reconnect). */
  partner: string;
  /** Wave the run was on when saved (shown in the Resume offer). */
  wave: number;
  /** Save timestamp (freshness display / future expiry). */
  ts: number;
}

/** HOST: record/refresh the marker on every co-op session save. */
export function recordCoopResumeMarker(slot: number, partner: string, wave: number): void {
  if (slot < 0 || !partner) {
    return;
  }
  try {
    const marker: CoopResumeMarker = { slot, partner, wave, ts: Date.now() };
    localStorage.setItem(COOP_RESUME_MARKER_KEY, JSON.stringify(marker));
    coopLog("launch", `resume marker recorded slot=${slot} partner=${partner} wave=${wave} (#810)`);
  } catch {
    /* storage full/unavailable is non-fatal - resume just won't be offered */
  }
}

/** Read the marker if it matches `partner` (case-insensitive); null otherwise. */
export function readCoopResumeMarker(partner: string | null): CoopResumeMarker | null {
  if (!partner) {
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
      || typeof marker.partner !== "string"
      || typeof marker.wave !== "number"
    ) {
      clearCoopResumeMarker();
      return null;
    }
    if (marker.partner.toLowerCase() !== partner.toLowerCase()) {
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

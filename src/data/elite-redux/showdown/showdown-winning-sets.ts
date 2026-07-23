/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Showdown teambuilder - the player's OWN recent WINNING sets, in localStorage (P3, the flagship's
// honest-full-set half).
//
// 🔴 WHY THIS EXISTS: telemetry stores only mon FINGERPRINTS (species/form/ITEM/shiny) - NOT
// movesets/abilities/natures - so the community route can suggest a popular ITEM but never a full
// moveset. To offer a genuine FULL "suggested set" (moves + ability + nature + item) the editor draws
// on the player's OWN winning teams, recorded HERE at match result. Every set stored is a real set the
// player actually WON with. Nothing is fabricated.
//
// Recorded on a WIN (both clients, from `getShowdownOwnManifest()`), keyed by the line ROOT, stored as
// the PS-format codec text (same format as the named per-species sets) so a suggested set flows back
// through the SAME importer + apply path the editor's Load uses.
//
// The envelope MUTATORS + SANITIZER are PURE (no localStorage) so they unit-test with no browser; the
// thin load/save I/O wraps them with a guarded localStorage (headless / storage-full is a safe no-op).
// =============================================================================

import { exportShowdownSet } from "#data/elite-redux/showdown/showdown-set-codec";
import type { ShowdownMonManifest } from "#data/elite-redux/showdown/showdown-team";

/** Bump when the on-disk envelope shape changes so a future migration can branch on it. */
export const SHOWDOWN_WINNING_SETS_VERSION = 1;
/** localStorage key prefix; the full key is `${PREFIX}${rootSpeciesId}`. */
export const SHOWDOWN_WINNING_SETS_PREFIX = "er:showdown:winsets:";
/** Hard cap on winning sets kept per species (newest-first; oldest dropped). */
export const MAX_WINNING_SETS = 8;

/** The versioned per-species envelope stored under `er:showdown:winsets:<rootSpeciesId>`. */
export interface ShowdownWinningSets {
  version: number;
  /** PS-format set texts, NEWEST FIRST. */
  sets: string[];
}

/** A fresh empty envelope. */
export function emptyWinningSets(): ShowdownWinningSets {
  return { version: SHOWDOWN_WINNING_SETS_VERSION, sets: [] };
}

/**
 * DEFENSIVE load sanitizer (localStorage is untrusted). Drops any structurally-invalid field rather
 * than throwing, always returning a well-formed, capped envelope.
 */
export function sanitizeWinningSets(raw: unknown): ShowdownWinningSets {
  if (typeof raw !== "object" || raw === null) {
    return emptyWinningSets();
  }
  const r = raw as Record<string, unknown>;
  const sets: string[] = [];
  if (Array.isArray(r.sets)) {
    for (const entry of r.sets) {
      if (typeof entry === "string" && entry.length > 0) {
        sets.push(entry);
      }
      if (sets.length >= MAX_WINNING_SETS) {
        break;
      }
    }
  }
  return {
    version: typeof r.version === "number" && Number.isInteger(r.version) ? r.version : SHOWDOWN_WINNING_SETS_VERSION,
    sets,
  };
}

/**
 * PURE: prepend a winning set text (newest-first), de-duplicating an identical set (moved to the front)
 * and capping the list. Returns a NEW envelope (never mutates the input).
 */
export function withWinningSet(env: ShowdownWinningSets, text: string): ShowdownWinningSets {
  if (text.length === 0) {
    return { ...env, sets: env.sets.slice() };
  }
  const deduped = env.sets.filter(s => s !== text);
  const sets = [text, ...deduped].slice(0, MAX_WINNING_SETS);
  return { ...env, sets };
}

// ---- localStorage I/O (guarded; headless / storage-full is a safe no-op) ----------------------

function keyFor(rootSpeciesId: number): string {
  return `${SHOWDOWN_WINNING_SETS_PREFIX}${rootSpeciesId}`;
}

/** Load + sanitize the per-species winning-sets envelope (empty on miss / corrupt / no-storage). */
export function loadWinningSets(rootSpeciesId: number): ShowdownWinningSets {
  try {
    const raw = localStorage.getItem(keyFor(rootSpeciesId));
    if (raw == null) {
      return emptyWinningSets();
    }
    return sanitizeWinningSets(JSON.parse(raw));
  } catch {
    return emptyWinningSets();
  }
}

/** Persist the envelope (best-effort; a storage-full/unavailable write is swallowed). */
export function saveWinningSets(rootSpeciesId: number, env: ShowdownWinningSets): void {
  try {
    localStorage.setItem(keyFor(rootSpeciesId), JSON.stringify(env));
  } catch {
    /* storage full / unavailable is non-fatal - the win just isn't remembered locally */
  }
}

/** This species' recorded winning set texts (newest-first). */
export function listWinningSets(rootSpeciesId: number): string[] {
  return loadWinningSets(rootSpeciesId).sets;
}

/** Record ONE winning set for a species (prepend, dedupe, cap), persisting it. */
export function recordWinningSet(rootSpeciesId: number, text: string): void {
  saveWinningSets(rootSpeciesId, withWinningSet(loadWinningSets(rootSpeciesId), text));
}

/**
 * Record a whole WINNING team: each mon's full set (PS text via the codec) is stored under its line
 * ROOT. Fully guarded - a codec/storage failure for one mon can never strand the caller (this runs from
 * the guarded result observer). Called on a decisive WIN from the local player's own manifests.
 */
export function recordShowdownWinningTeam(manifests: ShowdownMonManifest[] | null | undefined): void {
  if (!manifests || manifests.length === 0) {
    return;
  }
  for (const mon of manifests) {
    try {
      recordWinningSet(mon.rootSpeciesId, exportShowdownSet(mon));
    } catch {
      /* one mon failing to serialize must not stop the rest / affect the result flow */
    }
  }
}

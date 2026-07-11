/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Showdown 1v1 - PER-SPECIES saved sets (+ auto-remembered last-used), in localStorage.
//
// The locked storage decision (design 2026-07-10): TEAM presets live in the ACCOUNT SAVE (they must
// never be lost), but per-species SETS are a local convenience and live in localStorage under
// `er:showdown:sets:<rootSpeciesId>` behind a VERSIONED envelope (so a future migration can branch on
// the version). The set BODY is the PS-format codec text - the codec IS the storage format, so a saved
// set is a shareable paste and a loaded set flows back through the same importer the editor's Import uses.
//
// Two features ride on this:
//   - AUTO-REMEMBER: confirming a mon in the Set Editor stamps its set as that species' `lastUsed`; the
//     next time the player picks that species the editor PRE-FILLS from it.
//   - NAMED SETS: "Save set..." / "Load set..." in the editor keep a small list of named sets per species.
//
// The envelope MUTATORS + SANITIZER are PURE (no localStorage) so they unit-test with no browser; the
// thin load/save I/O wraps them with a guarded `localStorage` (headless / storage-full is a safe no-op).
// =============================================================================

/** Bump when the on-disk envelope shape changes so a future migration can branch on it. */
export const SHOWDOWN_SPECIES_SETS_VERSION = 1;
/** localStorage key prefix; the full key is `${PREFIX}${rootSpeciesId}`. */
export const SHOWDOWN_SPECIES_SETS_PREFIX = "er:showdown:sets:";
/** Hard cap on named sets kept per species (defensive; the editor list never needs more). */
export const MAX_NAMED_SPECIES_SETS = 20;
/** Max set-name length (mirrors the editor/preset text-input maxLength). */
export const MAX_SET_NAME_LEN = 24;

/** A named saved set: the display name + the PS-format codec text (the storage format). */
export interface ShowdownNamedSet {
  name: string;
  text: string;
}

/** The versioned per-species envelope stored under `er:showdown:sets:<rootSpeciesId>`. */
export interface ShowdownSpeciesSets {
  version: number;
  /** The auto-remembered last-confirmed set as PS text, or null when none has been confirmed yet. */
  lastUsed: string | null;
  /** The named sets the player explicitly saved (capped, newest-last). */
  named: ShowdownNamedSet[];
}

/** A fresh empty envelope. */
export function emptySpeciesSets(): ShowdownSpeciesSets {
  return { version: SHOWDOWN_SPECIES_SETS_VERSION, lastUsed: null, named: [] };
}

/** Trim + clamp a proposed set name to a sane, non-empty display string. */
export function normalizeSetName(name: string): string {
  const trimmed = (name ?? "").trim();
  return trimmed.length === 0 ? "Set" : trimmed.slice(0, MAX_SET_NAME_LEN);
}

/**
 * DEFENSIVE load sanitizer (localStorage is untrusted - a hand-edited value, a partial write). Drops any
 * structurally-invalid field rather than throwing, always returning a well-formed envelope.
 */
export function sanitizeSpeciesSets(raw: unknown): ShowdownSpeciesSets {
  if (typeof raw !== "object" || raw === null) {
    return emptySpeciesSets();
  }
  const r = raw as Record<string, unknown>;
  const named: ShowdownNamedSet[] = [];
  if (Array.isArray(r.named)) {
    for (const entry of r.named) {
      if (typeof entry === "object" && entry !== null) {
        const e = entry as Record<string, unknown>;
        if (typeof e.text === "string" && e.text.length > 0) {
          named.push({ name: normalizeSetName(typeof e.name === "string" ? e.name : ""), text: e.text });
        }
      }
      if (named.length >= MAX_NAMED_SPECIES_SETS) {
        break;
      }
    }
  }
  return {
    version: typeof r.version === "number" && Number.isInteger(r.version) ? r.version : SHOWDOWN_SPECIES_SETS_VERSION,
    lastUsed: typeof r.lastUsed === "string" && r.lastUsed.length > 0 ? r.lastUsed : null,
    named,
  };
}

/** Stamp the auto-remembered last-used set. Returns a NEW envelope (never mutates the input). */
export function withLastUsed(sets: ShowdownSpeciesSets, text: string): ShowdownSpeciesSets {
  return { ...sets, lastUsed: text };
}

/**
 * Upsert a NAMED set. A same-name entry (case-insensitive) is REPLACED in place; otherwise the set is
 * appended and the list capped at {@linkcode MAX_NAMED_SPECIES_SETS} (oldest dropped). Returns a new envelope.
 */
export function withNamedSet(sets: ShowdownSpeciesSets, name: string, text: string): ShowdownSpeciesSets {
  const cleanName = normalizeSetName(name);
  const next = sets.named.slice();
  const idx = next.findIndex(s => s.name.toLowerCase() === cleanName.toLowerCase());
  if (idx >= 0) {
    next[idx] = { name: cleanName, text };
  } else {
    next.push({ name: cleanName, text });
    if (next.length > MAX_NAMED_SPECIES_SETS) {
      next.splice(0, next.length - MAX_NAMED_SPECIES_SETS);
    }
  }
  return { ...sets, named: next };
}

/** Remove the named set at `index`. Returns a new envelope; a bad index is a no-op copy. */
export function withoutNamedSet(sets: ShowdownSpeciesSets, index: number): ShowdownSpeciesSets {
  if (index < 0 || index >= sets.named.length) {
    return { ...sets, named: sets.named.slice() };
  }
  const next = sets.named.slice();
  next.splice(index, 1);
  return { ...sets, named: next };
}

// ---- localStorage I/O (guarded; headless / storage-full is a safe no-op) ----------------------

function keyFor(rootSpeciesId: number): string {
  return `${SHOWDOWN_SPECIES_SETS_PREFIX}${rootSpeciesId}`;
}

/** Load + sanitize the per-species envelope (an empty envelope on miss / corrupt / no-storage). */
export function loadSpeciesSets(rootSpeciesId: number): ShowdownSpeciesSets {
  try {
    const raw = localStorage.getItem(keyFor(rootSpeciesId));
    if (raw == null) {
      return emptySpeciesSets();
    }
    return sanitizeSpeciesSets(JSON.parse(raw));
  } catch {
    return emptySpeciesSets();
  }
}

/** Persist the envelope (best-effort; a storage-full/unavailable write is swallowed). */
export function saveSpeciesSets(rootSpeciesId: number, sets: ShowdownSpeciesSets): void {
  try {
    localStorage.setItem(keyFor(rootSpeciesId), JSON.stringify(sets));
  } catch {
    /* storage full / unavailable is non-fatal - the set just isn't remembered locally */
  }
}

// ---- convenience wrappers (the editor calls these) --------------------------------------------

/** Auto-remember: stamp the just-confirmed set as this species' last-used. */
export function rememberLastUsedSet(rootSpeciesId: number, text: string): void {
  saveSpeciesSets(rootSpeciesId, withLastUsed(loadSpeciesSets(rootSpeciesId), text));
}

/** The species' auto-remembered last-used set text (or null when none). */
export function getLastUsedSet(rootSpeciesId: number): string | null {
  return loadSpeciesSets(rootSpeciesId).lastUsed;
}

/** Save a NAMED set for this species (upsert by name). */
export function saveNamedSpeciesSet(rootSpeciesId: number, name: string, text: string): void {
  saveSpeciesSets(rootSpeciesId, withNamedSet(loadSpeciesSets(rootSpeciesId), name, text));
}

/** Delete the named set at `index` for this species. */
export function deleteNamedSpeciesSet(rootSpeciesId: number, index: number): void {
  saveSpeciesSets(rootSpeciesId, withoutNamedSet(loadSpeciesSets(rootSpeciesId), index));
}

/** This species' named sets (newest-last). */
export function listNamedSpeciesSets(rootSpeciesId: number): ShowdownNamedSet[] {
  return loadSpeciesSets(rootSpeciesId).named;
}

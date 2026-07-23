/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Showdown 1v1 - NAMED TEAM PRESETS, serialized in the ACCOUNT SAVE.
//
// The addendum (2026-07-11) inverts the showdown entry flow: teams are built and
// selected BEFORE pairing, in the Team Menu. A preset is a named list of the wire
// {@linkcode ShowdownMonManifest}s (the canonical team shape both clients hash), so a
// saved team can be fed straight into the negotiate/anti-tamper/wager pipeline at lobby
// entry with no re-build.
//
// These presets live in {@linkcode SystemSaveData} (the account/cloud save), NOT
// localStorage - they must survive a device change and never be lost (superseding the
// earlier local-only v1 decision for TEAM presets). Persistence follows the exact
// precedent of `showdownAppliedSettlements`: an OPTIONAL, migration-safe field that is
// absent on older saves (treated as []) and sanitized on load so a corrupt/hostile blob
// can never crash the loader.
//
// This module is PURE (no engine / Phaser imports) so it is unit-testable and the CRUD
// helpers can round-trip through the save serializer in a test. `GameData` wraps them
// with persistence (see game-data.ts).
// =============================================================================

import type { ShowdownMonManifest } from "#data/elite-redux/showdown/showdown-team";
import { normalizeFolderName } from "#data/elite-redux/showdown/showdown-team-folders";

/** Bump when the on-disk preset shape changes so a future migration can branch on it. */
export const SHOWDOWN_TEAM_PRESET_VERSION = 1;

/** Hard cap on how many presets an account keeps (defensive; the menu never needs more). */
export const MAX_SHOWDOWN_TEAM_PRESETS = 60;

/** Max preset name length (mirrors the editor's text-input maxLength). */
export const MAX_PRESET_NAME_LEN = 24;

/** A showdown 6v6 team a mon count may run 1-6 (partial teams are legal, per B7 item 10). */
const MAX_PRESET_MONS = 6;

/**
 * A named team preset: the display name + the wire manifests, exactly as the negotiate
 * pipeline consumes them. `version` lets a later migration reshape stored presets.
 */
export interface ShowdownTeamPreset {
  version: number;
  name: string;
  mons: ShowdownMonManifest[];
  /**
   * OPTIONAL folder (P3): a named, collapsible group in the Team Menu. Additive/migration-safe -
   * an older save has no folder (treated as ungrouped), and the field is OMITTED when absent so a
   * preset never carries an empty/undefined folder key.
   */
  folder?: string;
}

/** Trim + clamp a proposed preset name to a sane, non-empty display string. */
export function normalizePresetName(name: string): string {
  const trimmed = (name ?? "").trim();
  if (trimmed.length === 0) {
    return "Team";
  }
  return trimmed.slice(0, MAX_PRESET_NAME_LEN);
}

/**
 * Build a fresh preset from a name + a team's manifests. The manifests are DEEP-CLONED
 * through JSON so the stored preset never aliases live editor/flow state (and a stored
 * mon carries only JSON-safe wire fields, matching the transport-canonical shape - an
 * `undefined`-valued optional field is dropped, so the preset hashes like the wire).
 */
export function makeShowdownTeamPreset(name: string, mons: ShowdownMonManifest[], folder?: string): ShowdownTeamPreset {
  const preset: ShowdownTeamPreset = {
    version: SHOWDOWN_TEAM_PRESET_VERSION,
    name: normalizePresetName(name),
    mons: cloneManifests(mons),
  };
  // OMIT-WHEN-ABSENT: a folder key rides only when a non-empty name is given.
  const cleanFolder = normalizeFolderName(folder ?? "");
  if (cleanFolder) {
    preset.folder = cleanFolder;
  }
  return preset;
}

/**
 * Assign (or CLEAR) the folder of the preset at `index`. An empty/whitespace name clears it (the key is
 * removed so an ungrouped preset never carries an empty folder). Returns a NEW array; a bad index is a
 * no-op copy.
 */
export function setPresetFolder(list: ShowdownTeamPreset[], index: number, folder: string): ShowdownTeamPreset[] {
  const next = list.slice();
  if (index < 0 || index >= next.length) {
    return next;
  }
  const cleanFolder = normalizeFolderName(folder);
  const { folder: _drop, ...rest } = next[index];
  next[index] = cleanFolder ? { ...rest, folder: cleanFolder } : rest;
  return next;
}

/** Deep-clone manifests via JSON (drops undefined-valued optionals, matching the wire). */
function cloneManifests(mons: ShowdownMonManifest[]): ShowdownMonManifest[] {
  return JSON.parse(JSON.stringify(mons ?? [])) as ShowdownMonManifest[];
}

/**
 * Insert a new preset, or REPLACE the one at `index` when a valid index is given (the
 * edit-in-place path). Returns a NEW array (never mutates the input); the list is capped
 * at {@linkcode MAX_SHOWDOWN_TEAM_PRESETS} (oldest dropped) on insert.
 */
export function upsertPreset(
  list: ShowdownTeamPreset[],
  preset: ShowdownTeamPreset,
  index?: number,
): ShowdownTeamPreset[] {
  const next = list.slice();
  if (index !== undefined && index >= 0 && index < next.length) {
    next[index] = preset;
    return next;
  }
  next.push(preset);
  if (next.length > MAX_SHOWDOWN_TEAM_PRESETS) {
    next.splice(0, next.length - MAX_SHOWDOWN_TEAM_PRESETS);
  }
  return next;
}

/** Rename the preset at `index`. Returns a new array; a bad index is a no-op copy. */
export function renamePreset(list: ShowdownTeamPreset[], index: number, newName: string): ShowdownTeamPreset[] {
  const next = list.slice();
  if (index >= 0 && index < next.length) {
    next[index] = { ...next[index], name: normalizePresetName(newName) };
  }
  return next;
}

/** Delete the preset at `index`. Returns a new array; a bad index is a no-op copy. */
export function deletePreset(list: ShowdownTeamPreset[], index: number): ShowdownTeamPreset[] {
  if (index < 0 || index >= list.length) {
    return list.slice();
  }
  const next = list.slice();
  next.splice(index, 1);
  return next;
}

const isInt = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v);

/**
 * DEFENSIVE load sanitizer (mirrors the `showdownAppliedSettlements` precedent). The
 * persisted blob is untrusted (a hand-edited save, a corrupt cloud round-trip): drop any
 * structurally-invalid preset or mon rather than throwing in the loader. A preset survives
 * only if it has a usable name and 1-6 structurally-plausible mons; deeper legality
 * (collection ownership, format rules) is re-checked at MENU RENDER by the shared rule
 * engine, not here - a preset that references a since-released mon is KEPT (and flagged
 * invalid in the menu), never silently dropped.
 */
export function sanitizeShowdownTeamPresets(raw: unknown): ShowdownTeamPreset[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const out: ShowdownTeamPreset[] = [];
  for (const entry of raw) {
    const preset = sanitizePreset(entry);
    if (preset != null) {
      out.push(preset);
    }
    if (out.length >= MAX_SHOWDOWN_TEAM_PRESETS) {
      break;
    }
  }
  return out;
}

function sanitizePreset(entry: unknown): ShowdownTeamPreset | null {
  if (typeof entry !== "object" || entry === null) {
    return null;
  }
  const e = entry as Record<string, unknown>;
  if (!Array.isArray(e.mons) || e.mons.length === 0 || e.mons.length > MAX_PRESET_MONS) {
    return null;
  }
  const mons: ShowdownMonManifest[] = [];
  for (const m of e.mons) {
    const mon = sanitizeManifest(m);
    if (mon == null) {
      return null;
    }
    mons.push(mon);
  }
  const preset: ShowdownTeamPreset = {
    version: isInt(e.version) ? (e.version as number) : SHOWDOWN_TEAM_PRESET_VERSION,
    name: normalizePresetName(typeof e.name === "string" ? e.name : ""),
    mons,
  };
  // OMIT-WHEN-ABSENT: keep a folder only when it is a non-empty string (a corrupt/absent one drops).
  const folder = typeof e.folder === "string" ? normalizeFolderName(e.folder) : "";
  if (folder) {
    preset.folder = folder;
  }
  return preset;
}

/**
 * Structural guard for one stored manifest. Deliberately shallow - it mirrors the wire
 * shape (`starterToManifest`) and keeps only the JSON-safe fields, re-omitting absent
 * optionals so a loaded preset hashes identically to a freshly built team. It does NOT
 * validate legality; that is the menu's job via `validateShowdownTeam`.
 */
function sanitizeManifest(m: unknown): ShowdownMonManifest | null {
  if (typeof m !== "object" || m === null) {
    return null;
  }
  const r = m as Record<string, unknown>;
  if (
    !isInt(r.speciesId)
    || !isInt(r.formIndex)
    || typeof r.level !== "number"
    || typeof r.shiny !== "boolean"
    || !isInt(r.variant)
    || !isInt(r.abilityIndex)
    || typeof r.item !== "string"
    || !Array.isArray(r.ivs)
    || !Array.isArray(r.moveset)
    || !isInt(r.rootSpeciesId)
    || typeof r.erBlackShiny !== "boolean"
    || !isInt(r.baseCost)
  ) {
    return null;
  }
  const mon: ShowdownMonManifest = {
    speciesId: r.speciesId as number,
    formIndex: r.formIndex as number,
    level: r.level as number,
    shiny: r.shiny as boolean,
    variant: r.variant as number,
    abilityIndex: r.abilityIndex as number,
    ivs: (r.ivs as unknown[]).filter(isInt) as number[],
    moveset: (r.moveset as unknown[]).filter(isInt) as number[],
    item: r.item as string,
    rootSpeciesId: r.rootSpeciesId as number,
    erBlackShiny: r.erBlackShiny as boolean,
    baseCost: r.baseCost as number,
  };
  // OMIT-WHEN-ABSENT discipline: the two optional fields are added only when present +
  // well-typed, so a preset never carries an `undefined`-valued key onto the wire hash.
  if (isInt(r.nature)) {
    mon.nature = r.nature as number;
  }
  if (Array.isArray(r.erShinyLab) && (r.erShinyLab as unknown[]).every(isInt)) {
    mon.erShinyLab = (r.erShinyLab as number[]).slice();
  }
  return mon;
}

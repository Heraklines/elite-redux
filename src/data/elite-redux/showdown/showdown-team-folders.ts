/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Showdown Team Menu - FOLDERS (P3): named, collapsible groups over the saved team presets.
//
// A preset carries an OPTIONAL `folder` (additive/migration-safe on the account save, following the
// showdownTeamPresets precedent). The menu turns the flat preset list into a display-ROW model here:
// ungrouped presets first (NO header - so an account with no folders renders BYTE-IDENTICALLY to
// before), then each folder as a collapsible HEADER row followed (unless collapsed) by its presets,
// and finally the trailing "+ Create" row.
//
// PURE (no engine / Phaser) so the grouping + collapse logic is unit-tested with no boot; the handler
// consumes `buildTeamMenuRows` for its cursor + render model.
// =============================================================================

/** Max folder-name length (mirrors the preset-name cap). */
export const MAX_FOLDER_NAME_LEN = 24;

/** Trim + clamp a proposed folder name; an empty/whitespace name means "no folder" (returns ""). */
export function normalizeFolderName(name: string): string {
  return (name ?? "").trim().slice(0, MAX_FOLDER_NAME_LEN);
}

export type TeamMenuRowKind = "header" | "preset" | "create";

/** One display row in the Team Menu list. */
export interface TeamMenuRow {
  kind: TeamMenuRowKind;
  /** For a "preset" row: index into the flat `presets` array. */
  presetIndex?: number;
  /** For a "header" row: the folder name. */
  folder?: string;
  /** For a "header" row: whether the folder is currently collapsed. */
  collapsed?: boolean;
  /** For a "header" row: how many presets it contains. */
  count?: number;
}

/** The only field of a preset this module reads. */
interface FolderedPreset {
  folder?: string;
}

/**
 * Build the Team Menu's display rows from the flat preset list + the set of collapsed folder names.
 *
 * Order: ungrouped presets first (no header), then folders in FIRST-APPEARANCE order (each a header
 * row + its presets unless collapsed), then the trailing create row. When NO preset carries a folder
 * the result is `[preset0, preset1, ..., create]` - identical to the pre-folders flat model.
 */
export function buildTeamMenuRows(presets: FolderedPreset[], collapsed: ReadonlySet<string>): TeamMenuRow[] {
  const rows: TeamMenuRow[] = [];

  // Ungrouped presets first, headerless (back-compat).
  presets.forEach((preset, index) => {
    if (!normalizeFolderName(preset.folder ?? "")) {
      rows.push({ kind: "preset", presetIndex: index });
    }
  });

  // Distinct folders in first-appearance order.
  const order: string[] = [];
  const seen = new Set<string>();
  for (const preset of presets) {
    const folder = normalizeFolderName(preset.folder ?? "");
    if (folder && !seen.has(folder)) {
      seen.add(folder);
      order.push(folder);
    }
  }

  for (const folder of order) {
    const members: number[] = [];
    presets.forEach((preset, index) => {
      if (normalizeFolderName(preset.folder ?? "") === folder) {
        members.push(index);
      }
    });
    const isCollapsed = collapsed.has(folder);
    rows.push({ kind: "header", folder, collapsed: isCollapsed, count: members.length });
    if (!isCollapsed) {
      for (const index of members) {
        rows.push({ kind: "preset", presetIndex: index });
      }
    }
  }

  rows.push({ kind: "create" });
  return rows;
}

/** True when at least one preset carries a folder (the menu shows headers only then). */
export function hasAnyFolder(presets: FolderedPreset[]): boolean {
  return presets.some(preset => normalizeFolderName(preset.folder ?? "").length > 0);
}

/** The distinct folder names present, in first-appearance order (for a "move to folder" picker). */
export function listFolders(presets: FolderedPreset[]): string[] {
  const order: string[] = [];
  const seen = new Set<string>();
  for (const preset of presets) {
    const folder = normalizeFolderName(preset.folder ?? "");
    if (folder && !seen.has(folder)) {
      seen.add(folder);
      order.push(folder);
    }
  }
  return order;
}

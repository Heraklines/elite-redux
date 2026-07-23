/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Showdown 1v1 - the Team Menu FLOW glue (engine-light, so it is unit-testable).
//
// Two pieces the title-phase wiring composes:
//   - `buildTeamMenuPresetViews`: turn the saved account presets into the menu's view data,
//     RE-VALIDATING each against the LIVE collection at render (a mon released / an unlock
//     changed / a format rule broken since save -> the box shows an invalid marker + reason,
//     same wording as the editor's rules). This is the addendum's "validate at menu render".
//   - `runShowdownPresetBuild`: the OFFLINE create/edit orchestrator. It drives the existing
//     starter-select + Set Editor teambuild with NO live session, then names + saves the built
//     team as a preset (new, or in place when editing). The interactive surfaces are injected
//     as SEAMS so the orchestration is testable without booting the grid/editor UI: production
//     passes the real starter-select + name-modal; the flow test passes fakes.
// =============================================================================

import { isMegaStage } from "#data/elite-redux/showdown/showdown-evolutions";
import type { ShowdownUnlockGameData } from "#data/elite-redux/showdown/showdown-manifest";
import { buildUnlockSnapshot } from "#data/elite-redux/showdown/showdown-manifest";
import { type ShowdownMonManifest, validateShowdownTeam } from "#data/elite-redux/showdown/showdown-team";
import type { ShowdownTeamPreset } from "#data/elite-redux/showdown/showdown-team-preset";
import type { Starter } from "#types/save-data";
import type { ShowdownTeamMenuPresetView } from "#ui/showdown-team-menu-ui-handler";

/** The slice of GameData the flow reads (structurally satisfied by the real `gameData`). */
export interface ShowdownTeamMenuGameData extends ShowdownUnlockGameData {
  listShowdownTeamPresets(): ShowdownTeamPreset[];
}

/**
 * Map the saved account presets to menu view data, re-validating EACH against the live collection +
 * format rules with the shared {@linkcode validateShowdownTeam} engine (the same call the editor's
 * Done-time re-validation makes). The first violation's message becomes the box's invalid reason;
 * a legal team's reason is null.
 */
export function buildTeamMenuPresetViews(gameData: ShowdownTeamMenuGameData): ShowdownTeamMenuPresetView[] {
  const snapshot = buildUnlockSnapshot(gameData);
  return gameData.listShowdownTeamPresets().map(preset => {
    const violations = validateShowdownTeam(preset.mons, snapshot, isMegaStage);
    const view: ShowdownTeamMenuPresetView = {
      name: preset.name,
      mons: preset.mons,
      invalidReason: violations.length > 0 ? violations[0].message : null,
    };
    // P3 folders: carry the optional folder through so the menu can group by it (omitted when absent).
    if (preset.folder) {
      view.folder = preset.folder;
    }
    return view;
  });
}

/**
 * The injected surfaces of the offline build. Production wires the real starter-select + name modal +
 * the account-save CRUD; the flow test wires fakes.
 */
export interface ShowdownPresetBuildDeps {
  /**
   * Open the teambuild (starter-select + editor). Calls `onLockIn` with the built team on confirm, or
   * `onCancel` when the player backs out of the grid at the top level (the offline build returns to the
   * Team Menu, not the title). `seedStarters` pre-seeds the grid party when EDITING an existing preset
   * (each reconstructed with its saved stage/shiny/item/moves/nature/ability); empty for CREATE.
   */
  openStarterSelect: (onLockIn: (starters: Starter[]) => void, onCancel: () => void, seedStarters: Starter[]) => void;
  /** Prompt for a team name. Calls `onName` with the entered name, or `null` when cancelled. */
  promptName: (defaultName: string, onName: (name: string | null) => void) => void;
  /** Map a built {@linkcode Starter} to its wire manifest (production: `starterToManifest`). */
  toManifest: (starter: Starter) => ShowdownMonManifest;
  /** Persist the named team (a defined `index` edits that preset IN PLACE; undefined appends). */
  save: (name: string, mons: ShowdownMonManifest[], index?: number) => void;
  /** Called when the flow settles (saved OR cancelled) - production reopens the Team Menu. */
  onSettled: () => void;
}

/**
 * Offline create/edit orchestration. On a confirmed build: map to manifests, prompt for a name, and
 * SAVE (new when `editIndex` is undefined; IN PLACE at `editIndex` when editing). A cancelled name
 * prompt (or an empty build) settles WITHOUT saving; BACKING OUT of the grid (`onCancel`) likewise
 * settles without saving. Every path ends in `onSettled` so the caller always returns to the menu
 * (and restores the borrowed gameMode). `seedStarters` is forwarded to the teambuild for EDIT.
 */
export function runShowdownPresetBuild(
  editIndex: number | undefined,
  defaultName: string,
  deps: ShowdownPresetBuildDeps,
  seedStarters: Starter[] = [],
): void {
  deps.openStarterSelect(
    starters => {
      if (starters.length === 0) {
        deps.onSettled();
        return;
      }
      const mons = starters.map(deps.toManifest);
      deps.promptName(defaultName, name => {
        if (name != null && name.trim().length > 0) {
          deps.save(name, mons, editIndex);
        }
        deps.onSettled();
      });
    },
    // Grid back-out: settle WITHOUT saving (returns to the menu, restores the gameMode) - same terminal
    // as an empty/cancelled build, so create-cancel and edit-cancel both land cleanly on the Team Menu.
    () => deps.onSettled(),
    seedStarters,
  );
}

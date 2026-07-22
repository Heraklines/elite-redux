/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Showdown 1v1 - the TEAM PRESET MENU (the new pre-pairing entry screen).
//
// The addendum (2026-07-11) inverts the showdown entry flow: teams are built + selected
// BEFORE pairing. Clicking Showdown at the title now opens THIS menu, not the lobby.
//
// Layout (logical 320x180, x6 to screen) - mirrors the Set Editor's chrome language (a dark
// composed screen, nine-slice section windows, a gold-accent focus rule, a key-glyph hotkey
// bar):
//   - HEADER BAND (top): the "SHOWDOWN TEAMS" title + the preset count.
//   - HOTKEY LEGEND BAR: real key glyphs for the menu's functions (Confirm / Edit / Rename /
//     Delete), mirroring the editor's legend bar.
//   - LEFT LIST (~55%): each saved preset as a STYLISH encapsulated box - the team name, a
//     validity marker, and the six mini icons. A trailing "+ Create" box always closes the
//     list. The hovered team's box is gold-framed; the hovered MON within it gets a gold ring.
//     Empty state (no presets): one large "Create your first team" affordance box.
//   - RIGHT PREVIEW (~45%): the hovered mon's FULL sprite + name/types + active ability + the
//     three innates + held item + the four moves - the same data vocabulary as the editor.
//
// Cursor model (addendum): defaults to the FIRST mon of the FIRST box. LEFT/RIGHT cycle mons
// WITHIN the hovered team; UP/DOWN switch teams (incl. onto the trailing create box).
//
// The handler consumes a plain {@linkcode ShowdownTeamMenuConfig} (presets as pure view data +
// callbacks), so it is fully render-harness testable with no live session - the flow wiring
// (title-phase) builds the config from `gameData.showdownTeamPresets` + the live validator.
// =============================================================================

import { globalScene } from "#app/global-scene";
import { allAbilities, allMoves, modifierTypes } from "#data/data-lists";
import { isMegaStage } from "#data/elite-redux/showdown/showdown-evolutions";
import type { ShowdownItemKey } from "#data/elite-redux/showdown/showdown-item-pool";
import { fetchMyShowdownRank, isRankServerConfigured } from "#data/elite-redux/showdown/showdown-rank-client";
import type { ShowdownRankState } from "#data/elite-redux/showdown/showdown-rank-types";
import { exportShowdownTeam, importShowdownTeam } from "#data/elite-redux/showdown/showdown-set-codec";
import {
  MEGA_STONE_ITEM,
  type ShowdownMonManifest,
  type ShowdownRuleViolation,
} from "#data/elite-redux/showdown/showdown-team";
import {
  buildTeamMenuRows,
  normalizeFolderName,
  type TeamMenuRow,
} from "#data/elite-redux/showdown/showdown-team-folders";
import { Button } from "#enums/buttons";
import { MoveCategory } from "#enums/move-category";
import { PokemonType } from "#enums/pokemon-type";
import { SpeciesId } from "#enums/species-id";
import { TextStyle } from "#enums/text-style";
import { UiMode } from "#enums/ui-mode";
import type { Variant } from "#sprites/variant";
import { SettingKeyboard } from "#system/settings-keyboard";
import {
  buildShowdownRankChip,
  SHOWDOWN_RANK_CHIP_HEIGHT,
  showdownRankChipWidth,
} from "#ui/handlers/showdown-rank-card";
import type { ShowdownEditorTextInput } from "#ui/showdown-set-editor-ui-handler";
import { addTextObject } from "#ui/text";
import { UiHandler } from "#ui/ui-handler";
import { addWindow } from "#ui/ui-theme";
import { getLocalizedSpriteKey } from "#utils/common";
import { getModifierType } from "#utils/modifier-utils";
import { getPokemonSpecies } from "#utils/pokemon-utils";

// ---- public config ----------------------------------------------------------------------------

/** One preset as pure view data: the name, its wire manifests, + a live-validated invalid reason. */
export interface ShowdownTeamMenuPresetView {
  name: string;
  mons: ShowdownMonManifest[];
  /** OPTIONAL folder (P3): groups the preset under a collapsible header in the menu. */
  folder?: string;
  /**
   * Non-null when the preset is currently INVALID against the live collection / format rules
   * (mon released, unlock changed, rule broken). The menu shows an invalid marker + this reason,
   * and CONFIRM on such a box explains it instead of entering the lobby. The flow computes it via
   * the shared `validateShowdownTeam` rule engine at render.
   */
  invalidReason: string | null;
}

/** The whole Team Menu config. Plain data + callbacks, so the flow wiring is trivial + testable. */
export interface ShowdownTeamMenuConfig {
  /** The saved presets (may be empty - the empty-state affordance renders then). */
  presets: ShowdownTeamMenuPresetView[];
  /** Deterministic initial team cursor (for recipes / restore). */
  initialTeam?: number;
  /** Deterministic initial mon cursor within the hovered team (for recipes). */
  initialMon?: number;
  /** Deterministic initial rename-overlay state (for the rename-prompt render recipe). */
  initialRenaming?: boolean;
  /** Deterministic initial confirm-question banner text (for the enter-lobby / delete prompt render recipe). */
  initialPromptText?: string;
  /** Deterministic initial IMPORT paste-modal state (for the import-modal render recipe). */
  initialImporting?: boolean;
  /** Deterministic initial paste buffer shown in the import modal (for the render recipe). */
  initialImportBuffer?: string;
  /** Deterministic initial import ERROR list (for the import-error render recipe); non-null shows the list. */
  initialImportErrors?: string[] | null;
  /** Deterministic initial EXPORT confirmation banner (for the export-confirmation render recipe). */
  initialExportNotice?: string;
  /**
   * Deterministic rank state for the header chip (render recipes). When DEFINED the live async fetch is
   * skipped and this exact state (or null = unranked) is shown; when undefined the handler fetches live.
   */
  initialRankState?: ShowdownRankState | null;
  /** Deterministic override for whether the rank chip is shown (recipes); live uses `isRankServerConfigured()`. */
  rankAvailable?: boolean;
  /** CONFIRM on the create box: enter the offline team-build flow (Phase C). */
  onCreate?: () => void;
  /** Edit (E) a saved preset: re-enter the build flow seeded with it (Phase C). */
  onEdit?: (index: number) => void;
  /** CONFIRM on a valid saved preset: enter the pairing lobby carrying it (Phase D). */
  onEnterLobby?: (index: number) => void;
  /** Rename (R) a saved preset - the flow persists it. The handler updates its own view live. */
  onRename?: (index: number, newName: string) => void;
  /** Delete (N) a saved preset - the flow persists it. The handler updates its own view live. */
  onDelete?: (index: number) => void;
  /** Set/clear (G) a preset's FOLDER (P3) - the flow persists it. The handler updates its own view live. */
  onSetFolder?: (index: number, folder: string) => void;
  /** Deterministic initial set of COLLAPSED folder names (P3 render recipes). */
  initialCollapsedFolders?: string[];
  /** Deterministic initial FOLDER-rename overlay state (P3 set-folder render recipe). */
  initialFoldering?: boolean;
  /** Back out (Esc / B) to the title. */
  onExit?: () => void;
  /** EXPORT (V): copy the given PS-format team text to the clipboard (production wires navigator.clipboard). */
  copyToClipboard?: (text: string) => void;
  /**
   * IMPORT validation: run the shared rule engine over a set of parsed manifests (production wires
   * `validateShowdownTeam` + the live `buildUnlockSnapshot`). Absent in the render recipes.
   */
  validateTeam?: (mons: ShowdownMonManifest[]) => ShowdownRuleViolation[];
  /**
   * IMPORT save: persist the imported manifests as a NEW named preset (production wires
   * `gameData.saveShowdownTeamPreset`). The handler appends its own view + moves the cursor to it.
   */
  onImportSave?: (name: string, mons: ShowdownMonManifest[]) => void;
}

// ---- layout constants (logical px) ------------------------------------------------------------

const SCREEN_W = 320;
const SCREEN_H = 180;
const MARGIN = 3;

const HEADER_H = 13;
const HOTKEY_Y = HEADER_H + 1; // 14
const HOTKEY_H = 11;
const BODY_Y = HOTKEY_Y + HOTKEY_H + 2; // 27

const LEFT_X = MARGIN; // 3
const LEFT_W = 176;
const RIGHT_X = LEFT_X + LEFT_W + MARGIN; // 182
const RIGHT_W = SCREEN_W - RIGHT_X - MARGIN; // 135

const LIST_H = SCREEN_H - BODY_Y - 2; // 151
const BOX_H = 33;
const BOX_GAP = 3;
/** Compact height of a collapsible folder HEADER row (P3). */
const HEADER_ROW_H = 13;

// Shared palette with the Set Editor (dark composed chrome + gold accent).
const ACCENT = 0x3d5a80;
const HEADER_BAND = 0x18233b;
const CELL_DIM = 0x16223d;
const BAR_BG = 0x0e1626;
const SLOT_BG = 0x1c2740;
const GOLD = 0xffd447;
const GREEN_EDGE = 0x2f6d4a;
const RED_EDGE = 0x8a3030;

// Font sizes (the addTextObject default is a huge 96; dense screens run ~22-52).
const FONT_HDR = 34;
const FONT_NAME = 40;
const FONT_TINY = 22;
const FONT_TITLE = 52;

export class ShowdownTeamMenuUiHandler extends UiHandler {
  private container: Phaser.GameObjects.Container;
  private dynamic: Phaser.GameObjects.GameObject[] = [];

  private config: ShowdownTeamMenuConfig | null = null;
  /** 0..rows-1, where the last row is the trailing "+ Create" box. */
  private teamCursor = 0;
  /** 0..(hovered team's mon count - 1); which mon feeds the right preview. */
  private monCursor = 0;
  /** First list row drawn (scroll offset). */
  private scroll = 0;
  /** In-handler rename overlay state (backed by the same DOM input seam as the editor search). */
  private renaming = false;
  private renameBuffer = "";
  /** Whether the active text overlay is renaming the TEAM or setting its FOLDER (P3). */
  private renameMode: "name" | "folder" = "name";
  /** Collapsed folder names (P3); a collapsed folder hides its presets under its header. */
  private collapsedFolders = new Set<string>();
  /** A transient explain/notice banner (e.g. confirming an invalid team) - cleared on next input. */
  private notice: string | null = null;
  /**
   * The QUESTION shown while a Yes/No CONFIRM overlay is up (enter-lobby / delete). The CONFIRM handler
   * only draws the bare Yes/No buttons; a plain `ui.showText` routes to the battle message box that this
   * full-screen menu paints OVER, so the question was invisible ("it just says yes or no" - maintainer).
   * We render it as our OWN banner BEFORE opening the overlay (the menu container stays visible beneath a
   * setOverlayMode), so the player reads what they are agreeing to.
   */
  private promptText: string | null = null;
  private textInput: ShowdownEditorTextInput | null = null;
  /** The MULTILINE paste capture (separate from the single-line rename input) for the import modal. */
  private pasteInput: ShowdownEditorTextInput | null = null;
  /** IMPORT paste-modal open: the off-screen multiline capture drives `importBuffer`, the handler draws it. */
  private importing = false;
  private importBuffer = "";
  /** The per-mon import ERROR list (parse + validation), or null when not showing it. */
  private importErrors: string[] | null = null;
  /** The valid manifests to keep on a "drop invalid & save" fix-up (computed when the error list is raised). */
  private importValidMons: ShowdownMonManifest[] = [];
  /** A transient EXPORT confirmation banner ("Copied 'X' to clipboard"); cleared on next input. */
  private exportNotice: string | null = null;
  private requestedSpriteKeys = new Set<string>();
  /** Ranked ladder: this player's rank for the card (fetched at show; null = offline/unranked). */
  private myRank: ShowdownRankState | null = null;
  /** Whether the ranked server is configured (the rank card is shown only then). */
  private rankAvailable = false;

  constructor() {
    super(UiMode.SHOWDOWN_TEAM_MENU);
  }

  /** The flow injects the mobile hidden-input bridge (reused from the editor; keyboard needs none). */
  setTextInput(input: ShowdownEditorTextInput | null): void {
    this.textInput = input;
  }

  /** The flow injects the MULTILINE paste bridge for the import modal (a `DomShowdownPasteInput`). */
  setPasteInput(input: ShowdownEditorTextInput | null): void {
    this.pasteInput = input;
  }

  setup(): void {
    const ui = this.getUi();
    this.container = globalScene.add.container(0, -globalScene.scaledCanvas.height).setName("showdown-team-menu");
    this.container.setVisible(false);
    ui.add(this.container);
  }

  override show(args: any[]): boolean {
    super.show(args);
    const config = (args?.[0] ?? null) as ShowdownTeamMenuConfig | null;
    if (config == null) {
      return false;
    }
    this.config = config;
    this.collapsedFolders = new Set((config.initialCollapsedFolders ?? []).map(normalizeFolderName).filter(Boolean));
    this.teamCursor = Math.min(config.initialTeam ?? 0, this.rowCount() - 1);
    this.monCursor = config.initialMon ?? 0;
    this.clampMonCursor();
    this.scroll = 0;
    this.ensureRowVisible();
    this.renameMode = config.initialFoldering ? "folder" : "name";
    this.renaming = (config.initialRenaming ?? false) || (config.initialFoldering ?? false);
    this.renameBuffer = this.renaming
      ? this.renameMode === "folder"
        ? (this.hoveredPreset()?.folder ?? "")
        : (this.hoveredPreset()?.name ?? "")
      : "";
    this.notice = null;
    this.promptText = config.initialPromptText ?? null;
    this.importing = config.initialImporting ?? false;
    this.importBuffer = config.initialImportBuffer ?? "";
    this.importErrors = config.initialImportErrors ?? null;
    this.importValidMons = [];
    this.exportNotice = config.initialExportNotice ?? null;
    this.rankAvailable = config.rankAvailable ?? isRankServerConfigured();
    this.myRank = config.initialRankState ?? null;
    // Live path only: fetch the rank when the recipe did NOT pin it (deterministic recipes pass a state).
    if (this.rankAvailable && config.initialRankState === undefined) {
      // Best-effort async fetch for the rank chip; re-render when it lands.
      void fetchMyShowdownRank().then(rank => {
        this.myRank = rank;
        if (this.config != null) {
          this.render();
        }
      });
    }
    this.container.setVisible(true);
    this.render();
    return true;
  }

  // ---- derived state --------------------------------------------------------------------------

  /**
   * The display ROWS (P3 folders): ungrouped presets first (headerless), then each folder as a
   * collapsible header + its presets, then the trailing create row. With no folders this is exactly
   * `[preset0, ..., create]` - identical to the pre-folders flat model, so the cursor + render are
   * byte-identical for an account that never made a folder.
   */
  private rowsList(): TeamMenuRow[] {
    return buildTeamMenuRows(this.config?.presets ?? [], this.collapsedFolders);
  }

  /** Total list rows (presets + folder headers + trailing create). */
  private rowCount(): number {
    return this.rowsList().length;
  }

  private currentRow(): TeamMenuRow | null {
    return this.rowsList()[this.teamCursor] ?? null;
  }

  private get onCreateRow(): boolean {
    return this.currentRow()?.kind === "create";
  }

  /** True when the cursor sits on a collapsible folder HEADER row. */
  private get onHeaderRow(): boolean {
    return this.currentRow()?.kind === "header";
  }

  /** The flat preset index the cursor points at, or -1 on a header / create row. */
  private currentPresetIndex(): number {
    const row = this.currentRow();
    return row?.kind === "preset" ? (row.presetIndex ?? -1) : -1;
  }

  private hoveredPreset(): ShowdownTeamMenuPresetView | null {
    const idx = this.currentPresetIndex();
    return idx < 0 ? null : (this.config?.presets[idx] ?? null);
  }

  private hoveredMon(): ShowdownMonManifest | null {
    const preset = this.hoveredPreset();
    if (preset == null || preset.mons.length === 0) {
      return null;
    }
    return preset.mons[Math.min(this.monCursor, preset.mons.length - 1)] ?? null;
  }

  private clampMonCursor(): void {
    const mons = this.hoveredPreset()?.mons.length ?? 0;
    this.monCursor = mons === 0 ? 0 : Math.min(this.monCursor, mons - 1);
  }

  /** Per-row drawn height (a folder header is compact; presets + create box are full-height). */
  private rowHeight(row: TeamMenuRow): number {
    return row.kind === "header" ? HEADER_ROW_H : BOX_H;
  }

  /**
   * Keep the cursor row visible, honoring VARIABLE row heights (folder headers are shorter). Scrolls up
   * to reveal a row above the window, or advances the scroll one row at a time until the cursor row fits
   * within the list viewport from the new scroll offset. With uniform heights (no folders) this reduces
   * to the old fixed-pitch behavior, so scrolling is unchanged for a folderless account.
   */
  private ensureRowVisible(): void {
    const rows = this.rowsList();
    if (this.teamCursor < this.scroll) {
      this.scroll = this.teamCursor;
      return;
    }
    while (this.scroll < this.teamCursor) {
      let y = 0;
      let fits = false;
      for (let i = this.scroll; i <= this.teamCursor; i++) {
        const h = this.rowHeight(rows[i]);
        if (i === this.teamCursor) {
          fits = y + h <= LIST_H;
          break;
        }
        y += h + BOX_GAP;
      }
      if (fits) {
        break;
      }
      this.scroll++;
    }
  }

  // ---- input ----------------------------------------------------------------------------------

  processInput(button: Button): boolean {
    if (this.config == null) {
      return false;
    }
    if (this.renaming) {
      return this.processRenameInput(button);
    }
    // The IMPORT sub-flow captures input while its paste modal / error list is up.
    if (this.importing) {
      return this.processImportInput(button);
    }
    if (this.importErrors != null) {
      return this.processImportErrorInput(button);
    }
    // Any live input clears a transient explain notice / export banner first.
    if ((this.notice != null || this.exportNotice != null) && button !== Button.CANCEL && button !== Button.MENU) {
      this.notice = null;
      this.exportNotice = null;
      this.render();
    }
    let handled = false;
    switch (button) {
      case Button.UP:
        handled = this.moveTeam(-1);
        break;
      case Button.DOWN:
        handled = this.moveTeam(1);
        break;
      case Button.LEFT:
        handled = this.moveMon(-1);
        break;
      case Button.RIGHT:
        handled = this.moveMon(1);
        break;
      case Button.ACTION:
      case Button.SUBMIT:
        handled = this.confirmRow();
        break;
      case Button.CYCLE_ABILITY:
        handled = this.beginEdit();
        break;
      case Button.CYCLE_SHINY:
        handled = this.beginRename();
        break;
      case Button.CYCLE_NATURE:
        handled = this.requestDelete();
        break;
      case Button.CYCLE_GENDER:
        // G: set/clear the hovered team's FOLDER (P3).
        handled = this.beginSetFolder();
        break;
      case Button.CYCLE_FORM:
        // F: IMPORT a team from pasted PS text (reachable in the empty state too - import your first team).
        handled = this.beginImport();
        break;
      case Button.CYCLE_TERA:
        // V: EXPORT the hovered team to the clipboard.
        handled = this.doExport();
        break;
      case Button.CANCEL:
      case Button.MENU:
        this.config.onExit?.();
        handled = true;
        break;
    }
    if (handled) {
      this.getUi().playSelect();
    }
    return handled;
  }

  private moveTeam(dir: number): boolean {
    const rows = this.rowCount();
    this.teamCursor = (this.teamCursor + dir + rows) % rows;
    this.monCursor = 0;
    this.clampMonCursor();
    this.ensureRowVisible();
    this.render();
    return true;
  }

  private moveMon(dir: number): boolean {
    const mons = this.hoveredPreset()?.mons.length ?? 0;
    if (mons <= 1) {
      return false;
    }
    this.monCursor = (this.monCursor + dir + mons) % mons;
    this.render();
    return true;
  }

  /** CONFIRM: create (create box) / explain (invalid team) / enter-lobby prompt (valid team). */
  private confirmRow(): boolean {
    const cfg = this.config!;
    // A folder HEADER row toggles its collapse (P3).
    const row = this.currentRow();
    if (row?.kind === "header" && row.folder) {
      this.toggleFolder(row.folder);
      return true;
    }
    if (this.onCreateRow) {
      // Maintainer (live, 2026-07-10): NO yes/no prompt on create - confirm goes STRAIGHT into the
      // build flow. This also removes the revertMode()-race the prompt introduced (the unawaited
      // overlay teardown swallowed the build flow's MESSAGE bounce, stranding the player back here).
      cfg.onCreate?.();
      return true;
    }
    const preset = this.hoveredPreset();
    if (preset == null) {
      return true;
    }
    if (preset.invalidReason != null) {
      // Explain instead of entering the lobby (addendum).
      this.notice = preset.invalidReason;
      this.getUi().playError();
      this.render();
      return true;
    }
    const idx = this.currentPresetIndex();
    this.prompt("Enter the lobby with this team?", () => cfg.onEnterLobby?.(idx));
    return true;
  }

  private beginEdit(): boolean {
    const idx = this.currentPresetIndex();
    if (idx < 0) {
      return false;
    }
    this.config!.onEdit?.(idx);
    return true;
  }

  private requestDelete(): boolean {
    const idx = this.currentPresetIndex();
    if (idx < 0) {
      return false;
    }
    const name = this.hoveredPreset()?.name ?? "this team";
    this.prompt(`Delete "${name}"?`, () => this.doDelete(idx));
    return true;
  }

  private doDelete(idx: number): void {
    const cfg = this.config!;
    cfg.onDelete?.(idx);
    // Update the local view immediately so the screen reflects the delete without a mode round-trip.
    cfg.presets.splice(idx, 1);
    this.teamCursor = Math.min(this.teamCursor, this.rowCount() - 1);
    this.monCursor = 0;
    this.clampMonCursor();
    this.ensureRowVisible();
    this.render();
  }

  /** A Yes/No CONFIRM overlay, with the QUESTION painted into the menu so it is visible over the strip. */
  private prompt(_message: string, onYes: () => void): void {
    const ui = globalScene.ui;
    if (typeof ui?.setOverlayMode !== "function") {
      onYes();
      return;
    }
    // Paint the question as our own banner FIRST (it stays visible beneath the non-clearing CONFIRM
    // overlay), then clear it on either resolution.
    this.promptText = _message;
    this.render();
    const clearPrompt = () => {
      this.promptText = null;
      this.render();
    };
    ui.showText(_message, null, () => {
      ui.setOverlayMode(
        UiMode.CONFIRM,
        () => ui.revertMode().then(() => (clearPrompt(), onYes())),
        () => ui.revertMode().then(clearPrompt),
      );
    });
  }

  // ---- rename overlay (same DOM-input seam as the editor search) --------------------------------

  private beginRename(): boolean {
    if (this.currentPresetIndex() < 0) {
      return false;
    }
    this.renameMode = "name";
    this.renaming = true;
    this.renameBuffer = this.hoveredPreset()?.name ?? "";
    this.textInput?.open(this.renameBuffer, value => {
      this.renameBuffer = value;
      this.render();
    });
    this.render();
    return true;
  }

  /** G: open the FOLDER text overlay for the hovered preset (empty submit clears the folder). P3. */
  private beginSetFolder(): boolean {
    if (this.currentPresetIndex() < 0) {
      return false;
    }
    this.renameMode = "folder";
    this.renaming = true;
    this.renameBuffer = this.hoveredPreset()?.folder ?? "";
    this.textInput?.open(this.renameBuffer, value => {
      this.renameBuffer = value;
      this.render();
    });
    this.render();
    return true;
  }

  /** Toggle a folder's collapsed state, keeping the cursor on its header row. P3. */
  private toggleFolder(folder: string): void {
    if (this.collapsedFolders.has(folder)) {
      this.collapsedFolders.delete(folder);
    } else {
      this.collapsedFolders.add(folder);
    }
    // Re-clamp the cursor onto the (still-present) header row for this folder.
    const rows = this.rowsList();
    const headerRow = rows.findIndex(r => r.kind === "header" && r.folder === folder);
    if (headerRow >= 0) {
      this.teamCursor = headerRow;
    }
    this.teamCursor = Math.min(this.teamCursor, this.rowCount() - 1);
    this.monCursor = 0;
    this.ensureRowVisible();
    this.render();
  }

  private processRenameInput(button: Button): boolean {
    switch (button) {
      case Button.ACTION:
      case Button.SUBMIT:
        // Enter commits the rename.
        this.commitRename();
        this.getUi().playSelect();
        return true;
      case Button.CANCEL:
        // Backspace maps to CANCEL by default. INSIDE the rename overlay that is "delete a character",
        // NEVER "leave the menu": while there is text AND the DOM input is driving the buffer, consume
        // it and let the native input edit the buffer (mirrors the Set Editor search's back = delete).
        // It must never bubble to the menu's own CANCEL -> onExit -> title (the maintainer's "back yanks
        // me to the title" report). With an empty buffer (or no DOM bridge) there is nothing to delete,
        // so close JUST the overlay back to the menu - the menu itself stays put.
        if (this.renameBuffer.length > 0 && this.textInput != null) {
          return true; // consumed; the DOM input handles the character delete
        }
        this.cancelRename();
        return true;
      case Button.MENU:
        // Esc closes JUST the rename overlay (back to the menu), never the menu itself.
        this.cancelRename();
        return true;
      default:
        return true; // swallow navigation while the rename overlay is up
    }
  }

  private commitRename(): void {
    const idx = this.currentPresetIndex();
    if (idx < 0) {
      this.closeRename();
      return;
    }
    if (this.renameMode === "folder") {
      // Empty submit CLEARS the folder (ungroups the team).
      const folder = normalizeFolderName(this.renameBuffer);
      this.config!.onSetFolder?.(idx, folder);
      const preset = this.config!.presets[idx];
      if (preset != null) {
        // The VIEW is ephemeral (never hashed/persisted); the SAVE path omits the key via setPresetFolder.
        preset.folder = folder ? folder : undefined;
      }
      // Keep the cursor on the moved team so the preview does not jump.
      const rows = this.rowsList();
      const to = rows.findIndex(r => r.kind === "preset" && r.presetIndex === idx);
      if (to >= 0) {
        this.teamCursor = to;
      }
      this.ensureRowVisible();
      this.closeRename();
      return;
    }
    const name = this.renameBuffer.trim();
    if (name.length > 0) {
      this.config!.onRename?.(idx, name);
      const preset = this.config!.presets[idx];
      if (preset != null) {
        preset.name = name.slice(0, 24);
      }
    }
    this.closeRename();
  }

  private cancelRename(): void {
    this.closeRename();
  }

  /**
   * Live fix #4 (2026-07-10, the REAL create-button root cause): this handler had NO clear()
   * override, so the menu's container was NEVER hidden - once shown it stayed painted OVER every
   * mode that followed. setMode(STARTER_SELECT) succeeded (both breadcrumbs logged), the grid was
   * open and receiving input UNDERNEATH, and the player just kept seeing the frozen team menu.
   * Headless tests asserted the MODE switched (true) but never that the old screen actually left.
   */
  clear(): void {
    super.clear();
    this.textInput?.close();
    this.pasteInput?.close();
    this.renaming = false;
    this.importing = false;
    this.importErrors = null;
    this.notice = null;
    this.exportNotice = null;
    this.container.setVisible(false);
  }

  private closeRename(): void {
    this.renaming = false;
    this.renameMode = "name";
    this.textInput?.close();
    this.render();
  }

  // ---- EXPORT (V) -----------------------------------------------------------------------------

  /** Copy the hovered team's PS-format text to the clipboard and flash a brief confirmation banner. */
  private doExport(): boolean {
    const preset = this.hoveredPreset();
    if (preset == null || preset.mons.length === 0) {
      return false; // nothing to export on the create row / an empty box
    }
    const text = exportShowdownTeam(preset.mons);
    this.config!.copyToClipboard?.(text);
    this.exportNotice = `Copied "${preset.name}" to clipboard (${preset.mons.length} Pokemon).`;
    this.render();
    return true;
  }

  // ---- IMPORT (F): paste modal -> parse + validate -> save or per-mon error list ----------------

  /** Open the multiline paste modal (off-screen capture; the modal draws the buffer). */
  private beginImport(): boolean {
    this.importing = true;
    this.importBuffer = "";
    this.importErrors = null;
    this.exportNotice = null;
    this.pasteInput?.open("", value => {
      this.importBuffer = value;
      this.render();
    });
    this.render();
    return true;
  }

  private processImportInput(button: Button): boolean {
    switch (button) {
      case Button.ACTION:
      case Button.SUBMIT:
        this.submitImport();
        this.getUi().playSelect();
        return true;
      case Button.CANCEL:
        // Backspace = delete a character while there is text (the native input edits the buffer); never
        // bubble to the menu's own CANCEL. An empty buffer closes JUST the modal back to the menu.
        if (this.importBuffer.length > 0 && this.pasteInput != null) {
          return true;
        }
        this.closeImport();
        return true;
      case Button.MENU:
        this.closeImport();
        return true;
      default:
        return true; // swallow navigation while the paste modal is up
    }
  }

  private closeImport(): void {
    this.importing = false;
    this.pasteInput?.close();
    this.render();
  }

  /**
   * Parse the pasted text (tolerant codec), VALIDATE the parsed mons against the live collection + rules,
   * and either SAVE a clean team as a new preset, or raise the per-mon error list with a fix-up choice.
   */
  private submitImport(): void {
    const parsed = importShowdownTeam(this.importBuffer);
    // Precise parse errors (unknown species / move / item / ...), each already carrying its line number.
    const errors: string[] = parsed.errors.map(e => e.message);

    // Per-mon collection/format validation of the mons that DID parse, keeping only the individually-legal
    // ones for the fix-up save (team-wide issues surface via the menu's own re-validation after save).
    const valid: ShowdownMonManifest[] = [];
    parsed.manifests.forEach((mon, i) => {
      const violations = this.config!.validateTeam?.([mon]) ?? [];
      if (violations.length === 0) {
        valid.push(mon);
      } else {
        const label = this.monLabel(mon);
        errors.push(`Pokemon ${i + 1} (${label}): ${violations[0].message}`);
      }
    });

    this.pasteInput?.close();
    this.importing = false;

    if (parsed.manifests.length === 0 && errors.length === 0) {
      // Empty / blank paste - nothing to import.
      this.importErrors = null;
      this.notice = "No Pokemon found in the pasted text.";
      this.getUi().playError();
      this.render();
      return;
    }

    if (errors.length === 0) {
      // Fully clean import: save straight away.
      this.saveImported(parsed.manifests);
      return;
    }

    // Some mons are broken: show the error list; the player chooses drop-invalid-and-save or cancel.
    this.importValidMons = valid;
    this.importErrors = errors;
    this.getUi().playError();
    this.render();
  }

  private processImportErrorInput(button: Button): boolean {
    switch (button) {
      case Button.ACTION:
      case Button.SUBMIT:
        // Drop invalid & save the valid remainder (if any).
        if (this.importValidMons.length > 0) {
          const mons = this.importValidMons;
          this.importErrors = null;
          this.importValidMons = [];
          this.saveImported(mons);
          this.getUi().playSelect();
        } else {
          this.getUi().playError();
        }
        return true;
      case Button.CANCEL:
      case Button.MENU:
        this.importErrors = null;
        this.importValidMons = [];
        this.render();
        return true;
      default:
        return true; // swallow navigation while the error list is up
    }
  }

  /** Persist the imported mons as a NEW preset, then append the view locally + hover it. */
  private saveImported(mons: ShowdownMonManifest[]): void {
    const cfg = this.config!;
    const name = "Imported Team";
    cfg.onImportSave?.(name, mons.slice(0, 6));
    const saved = mons.slice(0, 6);
    const violations = cfg.validateTeam?.(saved) ?? [];
    cfg.presets.push({ name, mons: saved, invalidReason: violations.length > 0 ? violations[0].message : null });
    this.teamCursor = cfg.presets.length - 1;
    this.monCursor = 0;
    this.clampMonCursor();
    this.ensureRowVisible();
    this.notice = null;
    this.render();
  }

  /** A short species label for a mon (for the import error list). */
  private monLabel(mon: ShowdownMonManifest): string {
    return getPokemonSpecies(mon.speciesId as SpeciesId)?.name ?? `#${mon.speciesId}`;
  }

  // ---- render ---------------------------------------------------------------------------------

  private add<T extends Phaser.GameObjects.GameObject>(obj: T): T {
    this.container.add(obj);
    this.dynamic.push(obj);
    return obj;
  }

  private text(
    x: number,
    y: number,
    content: string,
    style: TextStyle,
    originX = 0,
    fontSize = FONT_TINY,
  ): Phaser.GameObjects.Text {
    const t = addTextObject(x, y, content, style, { fontSize: `${fontSize}px` });
    t.setOrigin(originX, 0);
    return this.add(t);
  }

  private fill(x: number, y: number, w: number, h: number, color: number, alpha = 1): void {
    this.add(globalScene.add.rectangle(x, y, w, h, color, alpha).setOrigin(0, 0));
  }

  private outline(x: number, y: number, w: number, h: number, color: number): void {
    this.fill(x, y, w, 1, color, 1);
    this.fill(x, y + h - 1, w, 1, color, 1);
    this.fill(x, y, 1, h, color, 1);
    this.fill(x + w - 1, y, 1, h, color, 1);
  }

  private clip(s: string, max: number): string {
    return s.length > max ? `${s.slice(0, max - 2)}..` : s;
  }

  private clearDynamic(): void {
    for (const obj of this.dynamic) {
      obj.destroy();
    }
    this.dynamic = [];
  }

  private render(): void {
    if (this.config == null) {
      return;
    }
    this.clearDynamic();
    this.fill(0, 0, SCREEN_W, SCREEN_H, 0x05070f, 1);
    this.renderHeader();
    this.renderHotkeyBar();
    this.renderList();
    this.renderPreview();
    if (this.notice != null) {
      this.renderNoticeBanner();
    }
    if (this.promptText != null) {
      this.renderPromptBanner();
    }
    if (this.exportNotice != null) {
      this.renderExportNotice();
    }
    if (this.renaming) {
      this.renderRenameOverlay();
    }
    if (this.importing) {
      this.renderImportModal();
    }
    if (this.importErrors != null) {
      this.renderImportErrorList();
    }
  }

  /** The brief EXPORT confirmation banner (green, top of the body) - copied to clipboard. */
  private renderExportNotice(): void {
    const bh = 12;
    const by = BODY_Y + 2;
    this.fill(MARGIN, by, SCREEN_W - 2 * MARGIN, bh, 0x0d2a1c, 0.98);
    this.outline(MARGIN, by, SCREEN_W - 2 * MARGIN, bh, GREEN_EDGE);
    this.fill(MARGIN + 3, by + 4, 3, 3, 0x4bd08a, 1);
    this.text(MARGIN + 9, by + 2, this.clip(this.exportNotice ?? "", 92), TextStyle.SUMMARY_GREEN, 0, FONT_TINY);
  }

  /** The IMPORT paste modal: a focused off-screen multiline capture; the modal draws the buffer + hints. */
  private renderImportModal(): void {
    const bw = 240;
    const bh = 96;
    const bx = (SCREEN_W - bw) / 2;
    const by = (SCREEN_H - bh) / 2;
    this.fill(0, 0, SCREEN_W, SCREEN_H, 0x000000, 0.6);
    this.add(addWindow(bx, by, bw, bh));
    this.fill(bx + 2, by + 2, bw - 4, bh - 4, 0x0d1524, 1);
    this.text(bx + 8, by + 5, "IMPORT TEAM", TextStyle.SUMMARY_GOLD, 0, FONT_NAME);
    this.text(
      bx + 8,
      by + 14,
      "Paste a Showdown team (blank line between sets).",
      TextStyle.SUMMARY_GRAY,
      0,
      FONT_TINY,
    );
    // The captured buffer, first lines shown; a blinking-style caret at the end.
    const fieldY = by + 24;
    const fieldH = bh - 24 - 12;
    this.fill(bx + 8, fieldY, bw - 16, fieldH, CELL_DIM, 1);
    this.outline(bx + 8, fieldY, bw - 16, fieldH, GOLD);
    const lines = (this.importBuffer.length > 0 ? this.importBuffer : "(paste here)").split("\n");
    const shownLines = lines.slice(0, 7);
    shownLines.forEach((ln, i) => {
      const style = this.importBuffer.length > 0 ? TextStyle.WINDOW : TextStyle.SHADOW_TEXT;
      const caret = this.importBuffer.length > 0 && i === shownLines.length - 1 ? "_" : "";
      this.text(bx + 11, fieldY + 2 + i * 7, this.clip(`${ln}${caret}`, 74), style, 0, FONT_TINY);
    });
    if (lines.length > 7) {
      this.text(bx + bw - 12, fieldY + fieldH - 7, `+${lines.length - 7}`, TextStyle.SUMMARY_GRAY, 1, FONT_TINY);
    }
    this.text(bx + 8, by + bh - 9, "Enter: import    Esc: cancel", TextStyle.SUMMARY_GRAY, 0, FONT_TINY);
  }

  /**
   * The IMPORT ERROR list: the precise per-mon parse + validation errors, with the fix-up choice
   * (Enter = drop the invalid mons and save the rest; Esc = cancel the whole import).
   */
  private renderImportErrorList(): void {
    const errors = this.importErrors ?? [];
    const bw = 260;
    const bh = 110;
    const bx = (SCREEN_W - bw) / 2;
    const by = (SCREEN_H - bh) / 2;
    this.fill(0, 0, SCREEN_W, SCREEN_H, 0x000000, 0.6);
    this.add(addWindow(bx, by, bw, bh));
    this.fill(bx + 2, by + 2, bw - 4, bh - 4, 0x1a1012, 1);
    this.fill(bx + 2, by + 2, bw - 4, 11, 0x3a0d12, 1);
    this.text(bx + 8, by + 3, "IMPORT PROBLEMS", TextStyle.SUMMARY_RED, 0, FONT_NAME);
    const savable = this.importValidMons.length;
    this.text(bx + bw - 8, by + 4, `${savable} ok`, TextStyle.SUMMARY_GREEN, 1, FONT_TINY);
    const listY = by + 15;
    const shown = errors.slice(0, 8);
    shown.forEach((msg, i) => {
      this.fill(bx + 6, listY + 3 + i * 9, 2, 2, 0xe86464, 1);
      this.text(bx + 11, listY + i * 9, this.clip(msg, 82), TextStyle.SUMMARY_GRAY, 0, FONT_TINY);
    });
    if (errors.length > 8) {
      this.text(bx + 11, listY + 8 * 9, `...and ${errors.length - 8} more`, TextStyle.SUMMARY_GRAY, 0, FONT_TINY);
    }
    const footer =
      savable > 0 ? `Enter: drop invalid, save ${savable}    Esc: cancel` : "Nothing importable.    Esc: cancel";
    this.text(bx + 8, by + bh - 9, footer, savable > 0 ? TextStyle.SUMMARY_GOLD : TextStyle.SUMMARY_GRAY, 0, FONT_TINY);
  }

  /** The question banner shown beneath the Yes/No CONFIRM overlay (enter-lobby / delete), so the player
   *  sees WHAT they are confirming. Neutral gold-accented styling (the notice banner is red for errors). */
  private renderPromptBanner(): void {
    const bh = 20;
    const by = BODY_Y + 10;
    this.fill(0, by - 3, SCREEN_W, bh + 6, 0x000000, 0.55);
    this.fill(MARGIN, by, SCREEN_W - 2 * MARGIN, bh, 0x102038, 0.98);
    this.outline(MARGIN, by, SCREEN_W - 2 * MARGIN, bh, GOLD);
    this.text(SCREEN_W / 2, by + 4, this.clip(this.promptText ?? "", 60), TextStyle.SUMMARY_GOLD, 0.5, FONT_NAME);
    this.text(SCREEN_W / 2, by + 13, "Yes / No", TextStyle.SUMMARY_GRAY, 0.5, FONT_TINY);
  }

  private renderHeader(): void {
    this.fill(0, 0, SCREEN_W, HEADER_H, BAR_BG, 1);
    this.fill(0, 0, SCREEN_W, 1, 0x2a3a5c, 1);
    this.fill(0, HEADER_H - 1, SCREEN_W, 1, 0x1a2740, 1);
    this.text(MARGIN + 3, 3, "SHOWDOWN TEAMS", TextStyle.SUMMARY_GOLD, 0, FONT_NAME);

    // The ranked rank CHIP lives INSIDE the header band (right side) - a compact one-line ball + tier
    // pill. The full rank card used to be pinned bottom-right of the preview column, where it covered the
    // moveset (maintainer: "the unranked thing is blocking the movesets ... too big"). The header is the
    // natural home for a per-player status chip and cannot collide with the preview content.
    let countRightX = SCREEN_W - MARGIN - 3;
    if (this.rankAvailable) {
      const chipW = showdownRankChipWidth(this.myRank);
      const chipX = SCREEN_W - MARGIN - 3 - chipW;
      const chipY = Math.floor((HEADER_H - SHOWDOWN_RANK_CHIP_HEIGHT) / 2);
      this.add(buildShowdownRankChip(this.myRank, chipX, chipY));
      countRightX = chipX - 5; // the team count sits just left of the chip
    }

    const count = this.config!.presets.length;
    this.text(countRightX, 4, `${count} ${count === 1 ? "team" : "teams"}`, TextStyle.SUMMARY_GRAY, 1, FONT_TINY);
  }

  private renderHotkeyBar(): void {
    this.fill(0, HOTKEY_Y, SCREEN_W, HOTKEY_H, BAR_BG, 1);
    this.fill(0, HOTKEY_Y, SCREEN_W, 1, 0x1a2740, 1);
    const onSaved = this.currentPresetIndex() >= 0;
    const spaceLabel = this.onCreateRow ? "Create" : this.onHeaderRow ? "Expand/Collapse" : "Enter Lobby";
    let x = 4;
    x = this.hotkey(x, null, "SPACE.png", spaceLabel);
    if (onSaved) {
      x = this.hotkey(x, SettingKeyboard.BUTTON_CYCLE_ABILITY, "E.png", "Edit");
      x = this.hotkey(x, SettingKeyboard.BUTTON_CYCLE_SHINY, "R.png", "Rename");
      x = this.hotkey(x, SettingKeyboard.BUTTON_CYCLE_NATURE, "DEL.png", "Delete");
      x = this.hotkey(x, SettingKeyboard.BUTTON_CYCLE_GENDER, "G.png", "Folder");
      x = this.hotkey(x, SettingKeyboard.BUTTON_CYCLE_TERA, "V.png", "Export");
    }
    // Import is reachable everywhere (incl. the empty state - paste in your first team).
    this.hotkey(x, SettingKeyboard.BUTTON_CYCLE_FORM, "F.png", "Import");
    this.hotkeyRight(SCREEN_W - 3, "ESC.png", "Back", "Back".length * 3.0 + 22);
  }

  private hotkey(x: number, setting: SettingKeyboard | null, defaultFrame: string, label: string): number {
    const frame = setting == null ? defaultFrame : this.keyFrame(setting, defaultFrame);
    const glyph = globalScene.add
      .sprite(x, HOTKEY_Y + 6, "keyboard", frame)
      .setOrigin(0, 0.5)
      .setScale(0.5);
    this.add(glyph);
    this.text(x + 12, HOTKEY_Y + 3, label, TextStyle.INSTRUCTIONS_TEXT, 0, FONT_TINY);
    return x + 12 + label.length * 3.0 + 8;
  }

  private hotkeyRight(rightX: number, defaultFrame: string, label: string, width: number): void {
    const x = rightX - width;
    const glyph = globalScene.add
      .sprite(x, HOTKEY_Y + 6, "keyboard", defaultFrame)
      .setOrigin(0, 0.5)
      .setScale(0.5);
    this.add(glyph);
    this.text(x + 16, HOTKEY_Y + 3, label, TextStyle.INSTRUCTIONS_TEXT, 0, FONT_TINY);
  }

  private keyFrame(setting: SettingKeyboard, defaultFrame: string): string {
    try {
      const icon = (globalScene as any).inputController?.getIconForLatestInputRecorded?.(setting);
      if (typeof icon === "string" && globalScene.textures.get("keyboard")?.has?.(icon)) {
        return icon;
      }
    } catch {
      // headless / no controller - deterministic default frame.
    }
    return defaultFrame;
  }

  // -- left list of preset boxes ----------------------------------------------------------------

  private renderList(): void {
    const cfg = this.config!;
    // Empty state: no saved presets - a single large "create your first team" affordance.
    if (cfg.presets.length === 0) {
      this.renderEmptyState();
      return;
    }
    const rows = this.rowsList();
    let y = BODY_Y;
    let lastDrawn = this.scroll - 1;
    for (let row = this.scroll; row < rows.length; row++) {
      const r = rows[row];
      const h = this.rowHeight(r);
      if (y + h > BODY_Y + LIST_H) {
        break;
      }
      const focused = row === this.teamCursor;
      if (r.kind === "create") {
        this.renderCreateBox(y, BOX_H, focused, false);
      } else if (r.kind === "header") {
        this.renderFolderHeader(r, y, focused);
      } else {
        this.renderPresetBox(cfg.presets[r.presetIndex ?? 0], y, focused);
      }
      lastDrawn = row;
      y += h + BOX_GAP;
    }
    // Scroll affordance arrows when the list overflows.
    if (this.scroll > 0) {
      this.text(LEFT_X + LEFT_W / 2, BODY_Y - 4, "▲", TextStyle.SUMMARY_GRAY, 0.5, FONT_TINY);
    }
    if (lastDrawn < rows.length - 1) {
      this.text(LEFT_X + LEFT_W / 2, SCREEN_H - 5, "▼", TextStyle.SUMMARY_GRAY, 0.5, FONT_TINY);
    }
  }

  /** A compact collapsible folder HEADER row: a chevron, the folder name, and the preset count. P3. */
  private renderFolderHeader(row: TeamMenuRow, y: number, focused: boolean): void {
    const folder = row.folder ?? "";
    this.fill(LEFT_X, y, LEFT_W, HEADER_ROW_H, focused ? ACCENT : HEADER_BAND, focused ? 0.95 : 0.9);
    this.outline(LEFT_X, y, LEFT_W, HEADER_ROW_H, focused ? GOLD : 0x2b3a5c);
    // Chevron: ▾ expanded / ▸ collapsed.
    this.text(LEFT_X + 5, y + 2, row.collapsed ? "▸" : "▾", TextStyle.SUMMARY_GOLD, 0, FONT_TINY);
    this.text(
      LEFT_X + 13,
      y + 2,
      this.clip(folder, 20),
      focused ? TextStyle.SUMMARY_GOLD : TextStyle.WINDOW,
      0,
      FONT_TINY,
    );
    this.text(LEFT_X + LEFT_W - 6, y + 2, `${row.count ?? 0}`, TextStyle.SUMMARY_GRAY, 1, FONT_TINY);
  }

  private renderEmptyState(): void {
    const y = BODY_Y + 20;
    const h = 70;
    this.add(addWindow(LEFT_X, y, LEFT_W, h));
    const focused = this.teamCursor === 0;
    this.fill(LEFT_X + 4, y + 4, LEFT_W - 8, h - 8, focused ? ACCENT : CELL_DIM, 1);
    this.outline(LEFT_X + 4, y + 4, LEFT_W - 8, h - 8, focused ? GOLD : 0x33436a);
    this.text(LEFT_X + LEFT_W / 2, y + 18, "+", TextStyle.SUMMARY_GOLD, 0.5, FONT_TITLE);
    this.text(LEFT_X + LEFT_W / 2, y + 38, "Create your first team", TextStyle.SUMMARY_GOLD, 0.5, FONT_NAME);
    this.text(
      LEFT_X + LEFT_W / 2,
      y + 48,
      "Build a 1v1 squad, then head to the lobby.",
      TextStyle.SUMMARY_GRAY,
      0.5,
      FONT_TINY,
    );
  }

  private renderPresetBox(preset: ShowdownTeamMenuPresetView, y: number, focused: boolean): void {
    const invalid = preset.invalidReason != null;
    // Box shell: nine-slice window + a colored inset that reads focused / valid / invalid.
    this.add(addWindow(LEFT_X, y, LEFT_W, BOX_H));
    this.fill(LEFT_X + 3, y + 3, LEFT_W - 6, BOX_H - 6, focused ? ACCENT : SLOT_BG, focused ? 0.9 : 0.65);
    this.outline(LEFT_X + 3, y + 3, LEFT_W - 6, BOX_H - 6, focused ? GOLD : invalid ? RED_EDGE : 0x33436a);

    // Name (clipped) + a validity marker pill on the right of the name row.
    this.text(
      LEFT_X + 8,
      y + 5,
      this.clip(preset.name, 22),
      focused ? TextStyle.SUMMARY_GOLD : TextStyle.WINDOW,
      0,
      FONT_NAME,
    );
    this.renderValidityMarker(LEFT_X + LEFT_W - 8, y + 5, invalid);

    // Six mini icons, gold-ringed on the hovered mon of the hovered team.
    const iconY = y + 16;
    const startX = LEFT_X + 12;
    const step = 26;
    for (let i = 0; i < 6; i++) {
      const cx = startX + i * step;
      const mon = preset.mons[i] ?? null;
      const hovered = focused && i === this.monCursor && mon != null;
      // Icon seat: a small framed inset so empty vs filled slots read cleanly.
      this.fill(cx - 9, iconY - 1, 18, 15, hovered ? 0x243456 : CELL_DIM, 1);
      this.outline(cx - 9, iconY - 1, 18, 15, hovered ? GOLD : 0x2b3a5c);
      if (mon == null) {
        this.text(cx, iconY + 3, "·", TextStyle.SUMMARY_GRAY, 0.5, FONT_HDR);
        continue;
      }
      this.renderMiniIcon(mon, cx, iconY);
    }
  }

  private renderCreateBox(y: number, h: number, focused: boolean, _large: boolean): void {
    this.add(addWindow(LEFT_X, y, LEFT_W, h));
    this.fill(LEFT_X + 3, y + 3, LEFT_W - 6, h - 6, focused ? ACCENT : CELL_DIM, focused ? 0.9 : 0.55);
    this.outline(LEFT_X + 3, y + 3, LEFT_W - 6, h - 6, focused ? GOLD : 0x33436a);
    this.text(LEFT_X + 14, y + 10, "+", TextStyle.SUMMARY_GOLD, 0.5, FONT_NAME);
    this.text(
      LEFT_X + 26,
      y + 12,
      "Create new team",
      focused ? TextStyle.SUMMARY_GOLD : TextStyle.SUMMARY_GRAY,
      0,
      FONT_NAME,
    );
  }

  private renderValidityMarker(rightX: number, y: number, invalid: boolean): void {
    const label = invalid ? "INVALID" : "READY";
    const w = label.length * 3.0 + 12;
    const x = rightX - w;
    this.fill(x, y, w, 9, HEADER_BAND, 1);
    this.outline(x, y, w, 9, invalid ? RED_EDGE : GREEN_EDGE);
    this.fill(x + 3, y + 3, 3, 3, invalid ? 0xe86464 : 0x4bd08a, 1);
    this.text(x + 8, y + 1, label, invalid ? TextStyle.SUMMARY_RED : TextStyle.SUMMARY_GREEN, 0, FONT_TINY);
  }

  private renderMiniIcon(mon: ShowdownMonManifest, cx: number, y: number): void {
    const species = getPokemonSpecies(mon.speciesId as SpeciesId);
    if (species == null) {
      return;
    }
    const wantId = species.getIconId(false, mon.formIndex, mon.shiny, mon.variant);
    const icon = globalScene.add
      .sprite(cx, y, species.getIconAtlasKey(mon.formIndex, mon.shiny, mon.variant))
      .setOrigin(0.5, 0)
      .setScale(0.42);
    icon.setFrame(wantId);
    if (icon.frame.name !== wantId) {
      const baseId = species.getIconId(false, 0, false, 0);
      if (icon.texture.has(baseId)) {
        icon.setFrame(baseId);
      }
    }
    this.add(icon);

    // Held-item mini-icon at the icon's bottom-right, mirroring the wager screen's per-mon overlay (same
    // "items" atlas + small-scale language). A mega slot's stone is implied by the form, so it carries no
    // item chip (matching the wager). Scale/offset are tuned to the box's 18x15 icon seat + 0.42 sprite.
    if (mon.item !== MEGA_STONE_ITEM && !isMegaStage(mon.speciesId, mon.formIndex)) {
      const modType = modifierTypes[mon.item as ShowdownItemKey];
      const iconImage = modType == null ? undefined : getModifierType(modType).iconImage;
      if (iconImage) {
        const itemIcon = globalScene.add
          .sprite(cx + 7, y + 11, "items", iconImage)
          .setOrigin(0.5, 0.5)
          .setScale(0.28);
        this.add(itemIcon);
      }
    }
  }

  // -- right preview panel ----------------------------------------------------------------------

  private renderPreview(): void {
    const panelH = SCREEN_H - BODY_Y - 2;
    this.add(addWindow(RIGHT_X, BODY_Y, RIGHT_W, panelH));
    // Dark interior so the preview reads as composed dark chrome (the nine-slice base renders light
    // in the headless harness; the game's themed window is dark - fill so both look right).
    this.fill(RIGHT_X + 2, BODY_Y + 2, RIGHT_W - 4, panelH - 4, 0x0d1524, 1);
    const mon = this.hoveredMon();
    if (mon == null) {
      this.renderPreviewPlaceholder();
      return;
    }
    const sp = getPokemonSpecies(mon.speciesId as SpeciesId);
    // Header band: fielded species NAME.
    this.fill(RIGHT_X + 2, BODY_Y + 2, RIGHT_W - 4, 13, HEADER_BAND, 1);
    this.fill(RIGHT_X + 2, BODY_Y + 14, RIGHT_W - 4, 1, 0x4a5a80, 1);
    this.text(RIGHT_X + 6, BODY_Y + 3, this.clip(sp?.name ?? "-", 16), TextStyle.SUMMARY_GOLD, 0, FONT_NAME);

    const spriteCx = RIGHT_X + RIGHT_W / 2;
    this.renderFullSprite(mon, spriteCx, BODY_Y + 33);
    this.renderTypeChips(mon, spriteCx, BODY_Y + 50);

    // Ability (active) + the three innates, then item, then the four moves.
    let py = BODY_Y + 57;
    py = this.renderPreviewAbilities(mon, py);
    py = this.renderPreviewItem(mon, py);
    this.renderPreviewMoves(mon, py);
  }

  private renderPreviewPlaceholder(): void {
    this.text(RIGHT_X + RIGHT_W / 2, BODY_Y + 40, "No team selected", TextStyle.SUMMARY_GRAY, 0.5, FONT_NAME);
    this.text(RIGHT_X + RIGHT_W / 2, BODY_Y + 54, "Confirm here to build one.", TextStyle.SUMMARY_GRAY, 0.5, FONT_TINY);
  }

  private renderFullSprite(mon: ShowdownMonManifest, cx: number, cy: number): void {
    const sp = getPokemonSpecies(mon.speciesId as SpeciesId);
    if (sp == null) {
      return;
    }
    const shiny = mon.shiny;
    const variant = mon.variant as Variant;
    const key = sp.getSpriteKey(false, mon.formIndex, shiny, variant);
    const atlasPath = sp.getSpriteAtlasPath(false, mon.formIndex, shiny, variant);
    if (!globalScene.textures.exists(key) && !this.requestedSpriteKeys.has(key)) {
      this.requestedSpriteKeys.add(key);
      globalScene.loadPokemonAtlas(key, atlasPath);
      void sp
        .loadAssets(false, mon.formIndex, shiny, variant, true, false, true)
        .then(() => {
          this.requestedSpriteKeys.delete(key);
          if (this.config != null) {
            this.render();
          }
        })
        .catch(() => this.requestedSpriteKeys.delete(key));
    }
    if (globalScene.textures.exists(key)) {
      const spr = globalScene.add.sprite(cx, cy, key).setOrigin(0.5, 0.5).setScale(0.34);
      const frames = globalScene.textures.get(key).getFrameNames();
      if (frames.length > 0) {
        spr.setFrame(frames.slice().sort()[0]);
      }
      this.add(spr);
      return;
    }
    // Fallback while the atlas loads: the always-loaded icon, enlarged.
    const wantId = sp.getIconId(false, mon.formIndex, shiny, variant);
    const icon = globalScene.add
      .sprite(cx, cy, sp.getIconAtlasKey(mon.formIndex, shiny, variant))
      .setOrigin(0.5, 0.5)
      .setScale(1.3);
    icon.setFrame(wantId);
    if (icon.frame.name !== wantId && icon.texture.has(sp.getIconId(false, 0, false, 0))) {
      icon.setFrame(sp.getIconId(false, 0, false, 0));
    }
    this.add(icon);
  }

  private renderTypeChips(mon: ShowdownMonManifest, cx: number, y: number): void {
    const sp = getPokemonSpecies(mon.speciesId as SpeciesId);
    const types = sp == null ? [] : [sp.type1, sp.type2].filter((t): t is PokemonType => t != null);
    const startX = cx - (types.length * 15) / 2;
    types.forEach((t, i) => {
      const chip = globalScene.add
        .sprite(startX + i * 15 + 7, y, getLocalizedSpriteKey("types"), PokemonType[t].toLowerCase())
        .setOrigin(0.5, 0)
        .setScale(0.42);
      this.add(chip);
    });
  }

  private renderPreviewAbilities(mon: ShowdownMonManifest, y: number): number {
    const sp = getPokemonSpecies(mon.speciesId as SpeciesId);
    if (sp == null) {
      return y;
    }
    this.text(RIGHT_X + 6, y, "ABILITY", TextStyle.SUMMARY_HEADER, 0, FONT_HDR);
    const actives = [sp.ability1, sp.ability2, sp.abilityHidden];
    const active = allAbilities[actives[mon.abilityIndex] ?? actives[0]];
    this.fill(RIGHT_X + 5, y + 7, RIGHT_W - 10, 8, CELL_DIM, 1);
    this.fill(RIGHT_X + 5, y + 7, 2, 8, 0x4bd08a, 1);
    this.text(RIGHT_X + 10, y + 8, this.clip(active?.name ?? "-", 24), TextStyle.SUMMARY_GOLD, 0, FONT_TINY);

    const innates = [...sp.getPassiveAbilities(mon.formIndex)];
    let iy = y + 17;
    innates.forEach(id => {
      const ability = allAbilities[id];
      if (ability == null) {
        return;
      }
      this.fill(RIGHT_X + 7, iy + 2, 2, 2, 0xc78ce0, 1);
      this.text(RIGHT_X + 11, iy, this.clip(ability.name, 26), TextStyle.SUMMARY_PINK, 0, FONT_TINY);
      iy += 5;
    });
    return iy + 2;
  }

  private renderPreviewItem(mon: ShowdownMonManifest, y: number): number {
    this.text(RIGHT_X + 6, y, "ITEM", TextStyle.SUMMARY_HEADER, 0, FONT_HDR);
    this.fill(RIGHT_X + 5, y + 7, RIGHT_W - 10, 11, CELL_DIM, 1);
    if (mon.item === MEGA_STONE_ITEM || isMegaStage(mon.speciesId, mon.formIndex)) {
      this.text(RIGHT_X + 10, y + 9, "Mega Stone", TextStyle.SUMMARY_PINK, 0, FONT_TINY);
      return y + 21;
    }
    const modType = modifierTypes[mon.item as ShowdownItemKey];
    const resolved = modType == null ? null : getModifierType(modType);
    if (resolved?.iconImage) {
      const icon = globalScene.add
        .sprite(RIGHT_X + 12, y + 12, "items", resolved.iconImage)
        .setOrigin(0.5, 0.5)
        .setScale(0.4);
      this.add(icon);
    }
    this.text(RIGHT_X + 20, y + 9, this.clip(resolved?.name ?? mon.item, 24), TextStyle.SUMMARY_GOLD, 0, FONT_TINY);
    return y + 21;
  }

  private renderPreviewMoves(mon: ShowdownMonManifest, y: number): void {
    this.text(RIGHT_X + 6, y, "MOVES", TextStyle.SUMMARY_HEADER, 0, FONT_HDR);
    let my = y + 8;
    const rowH = 8;
    for (let i = 0; i < 4; i++) {
      const moveId = mon.moveset[i];
      this.fill(RIGHT_X + 5, my, RIGHT_W - 10, rowH - 1, CELL_DIM, 1);
      if (moveId == null) {
        this.text(RIGHT_X + 9, my + 1, "-- empty --", TextStyle.SUMMARY_GRAY, 0, FONT_TINY);
        my += rowH;
        continue;
      }
      const move = allMoves[moveId];
      if (move != null) {
        const tSpr = globalScene.add
          .sprite(RIGHT_X + 11, my + 4, getLocalizedSpriteKey("types"), PokemonType[move.type].toLowerCase())
          .setOrigin(0.5, 0.5)
          .setScale(0.3);
        this.add(tSpr);
        const cSpr = globalScene.add
          .sprite(RIGHT_X + 25, my + 4, "categories", MoveCategory[move.category].toLowerCase())
          .setOrigin(0.5, 0.5)
          .setScale(0.4);
        this.add(cSpr);
      }
      this.text(RIGHT_X + 33, my + 1, this.clip(move?.name ?? "-", 18), TextStyle.SUMMARY_GOLD, 0, FONT_TINY);
      const bp = move != null && move.power > 0 ? String(move.power) : "-";
      this.text(RIGHT_X + RIGHT_W - 8, my + 1, `BP ${bp}`, TextStyle.SUMMARY_GRAY, 1, FONT_TINY);
      my += rowH;
    }
  }

  // -- overlays ---------------------------------------------------------------------------------

  private renderNoticeBanner(): void {
    const bh = 16;
    const by = (SCREEN_H - bh) / 2;
    this.fill(0, by - 2, SCREEN_W, bh + 4, 0x000000, 0.55);
    this.fill(MARGIN, by, SCREEN_W - 2 * MARGIN, bh, 0x3a0d12, 0.98);
    this.outline(MARGIN, by, SCREEN_W - 2 * MARGIN, bh, 0xe86464);
    this.text(SCREEN_W / 2, by + 2, "Can't enter the lobby", TextStyle.SUMMARY_RED, 0.5, FONT_TINY);
    this.text(SCREEN_W / 2, by + 9, this.clip(this.notice ?? "", 100), TextStyle.SUMMARY_GRAY, 0.5, FONT_TINY);
  }

  private renderRenameOverlay(): void {
    const bw = 200;
    const bh = 40;
    const bx = (SCREEN_W - bw) / 2;
    const by = (SCREEN_H - bh) / 2;
    this.fill(0, 0, SCREEN_W, SCREEN_H, 0x000000, 0.55);
    this.add(addWindow(bx, by, bw, bh));
    this.fill(bx + 2, by + 2, bw - 4, bh - 4, 0x0d1524, 1);
    const folderMode = this.renameMode === "folder";
    this.text(bx + 8, by + 5, folderMode ? "SET FOLDER" : "RENAME TEAM", TextStyle.SUMMARY_GOLD, 0, FONT_NAME);
    // The live text field.
    this.fill(bx + 8, by + 16, bw - 16, 12, CELL_DIM, 1);
    this.outline(bx + 8, by + 16, bw - 16, 12, GOLD);
    const placeholder = folderMode ? "(none)" : "Team";
    const shown = this.renameBuffer.length > 0 ? this.renameBuffer : placeholder;
    this.text(bx + 12, by + 18, `${this.clip(shown, 30)}_`, TextStyle.SUMMARY_GOLD, 0, FONT_NAME);
    this.text(
      bx + 8,
      by + 30,
      folderMode ? "Enter: save    Esc: cancel    (empty = ungroup)" : "Enter: save    Esc: cancel",
      TextStyle.SUMMARY_GRAY,
      0,
      FONT_TINY,
    );
  }
}

// ---- render-harness demo config ---------------------------------------------------------------

/** A wire manifest for one demo mon. */
function demoMon(
  speciesId: SpeciesId,
  formIndex: number,
  abilityIndex: number,
  item: string,
  moveset: number[],
  over: Partial<ShowdownMonManifest> = {},
): ShowdownMonManifest {
  return {
    speciesId,
    formIndex,
    level: 100,
    shiny: false,
    variant: 0,
    abilityIndex,
    ivs: [31, 31, 31, 31, 31, 31],
    moveset,
    item,
    rootSpeciesId: speciesId,
    erBlackShiny: false,
    baseCost: 5,
    ...over,
  };
}

/**
 * A self-contained honest demo config for the render harness (two real teams + an invalid one).
 * Options override the initial cursor / rename-overlay for the per-state recipes. Empty state is a
 * separate recipe passing `presets: []`.
 */
export function buildShowdownTeamMenuDemoConfig(
  overrides: Partial<ShowdownTeamMenuConfig> = {},
): ShowdownTeamMenuConfig {
  const presets: ShowdownTeamMenuPresetView[] = [
    {
      name: "Sand Rush",
      invalidReason: null,
      mons: [
        demoMon(SpeciesId.GARCHOMP, 0, 0, "LEFTOVERS", [89, 200, 14, 444]),
        demoMon(SpeciesId.TYRANITAR, 0, 0, "CHOICE_BAND", [246, 8, 89, 442]),
        demoMon(SpeciesId.EXCADRILL, 0, 0, "LIFE_ORB", [529, 89, 400, 14]),
        demoMon(SpeciesId.ROTOM, 4, 0, "SHELL_BELL", [521, 85, 435, 247]),
      ],
    },
    {
      name: "Rain Dance",
      invalidReason: null,
      mons: [
        demoMon(SpeciesId.PELIPPER, 0, 0, "DAMP_ROCK", [503, 542, 314, 469]),
        demoMon(SpeciesId.BLASTOISE, 0, 0, "LEFTOVERS", [57, 58, 258, 156]),
        demoMon(SpeciesId.LUDICOLO, 0, 0, "LIFE_ORB", [503, 402, 331, 147]),
      ],
    },
    {
      name: "Legacy Squad",
      invalidReason: "Ability 2 is not unlocked (slot 0).",
      mons: [
        demoMon(SpeciesId.DRAGONITE, 0, 1, "LEFTOVERS", [349, 89, 63, 245]),
        demoMon(SpeciesId.SNORLAX, 0, 0, "CHOICE_BAND", [37, 89, 174, 34]),
      ],
    },
  ];
  return {
    presets,
    initialTeam: 0,
    initialMon: 0,
    ...overrides,
  };
}

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
import { MEGA_STONE_ITEM, type ShowdownMonManifest } from "#data/elite-redux/showdown/showdown-team";
import { Button } from "#enums/buttons";
import { MoveCategory } from "#enums/move-category";
import { PokemonType } from "#enums/pokemon-type";
import { SpeciesId } from "#enums/species-id";
import { TextStyle } from "#enums/text-style";
import { UiMode } from "#enums/ui-mode";
import type { Variant } from "#sprites/variant";
import { SettingKeyboard } from "#system/settings-keyboard";
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
  /** Back out (Esc / B) to the title. */
  onExit?: () => void;
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
const BOX_PITCH = BOX_H + BOX_GAP; // 36
const VISIBLE_BOXES = Math.floor(LIST_H / BOX_PITCH); // 4

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
  /** A transient explain/notice banner (e.g. confirming an invalid team) - cleared on next input. */
  private notice: string | null = null;
  private textInput: ShowdownEditorTextInput | null = null;
  private requestedSpriteKeys = new Set<string>();

  constructor() {
    super(UiMode.SHOWDOWN_TEAM_MENU);
  }

  /** The flow injects the mobile hidden-input bridge (reused from the editor; keyboard needs none). */
  setTextInput(input: ShowdownEditorTextInput | null): void {
    this.textInput = input;
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
    this.teamCursor = Math.min(config.initialTeam ?? 0, this.rowCount() - 1);
    this.monCursor = config.initialMon ?? 0;
    this.clampMonCursor();
    this.scroll = 0;
    this.ensureRowVisible();
    this.renaming = config.initialRenaming ?? false;
    this.renameBuffer = this.renaming ? (this.hoveredPreset()?.name ?? "") : "";
    this.notice = null;
    this.container.setVisible(true);
    this.render();
    return true;
  }

  // ---- derived state --------------------------------------------------------------------------

  /** Total list rows = saved presets + 1 trailing create box. */
  private rowCount(): number {
    return (this.config?.presets.length ?? 0) + 1;
  }

  private get onCreateRow(): boolean {
    return this.teamCursor === (this.config?.presets.length ?? 0);
  }

  private hoveredPreset(): ShowdownTeamMenuPresetView | null {
    if (this.config == null || this.onCreateRow) {
      return null;
    }
    return this.config.presets[this.teamCursor] ?? null;
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

  private ensureRowVisible(): void {
    if (this.teamCursor < this.scroll) {
      this.scroll = this.teamCursor;
    } else if (this.teamCursor >= this.scroll + VISIBLE_BOXES) {
      this.scroll = this.teamCursor - VISIBLE_BOXES + 1;
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
    // Any live input clears a transient explain notice first.
    if (this.notice != null && button !== Button.CANCEL && button !== Button.MENU) {
      this.notice = null;
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
    if (this.onCreateRow) {
      this.prompt("Create a new team?", () => cfg.onCreate?.());
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
    const idx = this.teamCursor;
    this.prompt("Enter the lobby with this team?", () => cfg.onEnterLobby?.(idx));
    return true;
  }

  private beginEdit(): boolean {
    if (this.onCreateRow) {
      return false;
    }
    this.config!.onEdit?.(this.teamCursor);
    return true;
  }

  private requestDelete(): boolean {
    if (this.onCreateRow) {
      return false;
    }
    const idx = this.teamCursor;
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

  /** A Yes/No CONFIRM overlay. Live-only (headless render recipes never press into it). */
  private prompt(_message: string, onYes: () => void): void {
    const ui = globalScene.ui;
    if (typeof ui?.setOverlayMode !== "function") {
      onYes();
      return;
    }
    ui.showText(_message, null, () => {
      ui.setOverlayMode(
        UiMode.CONFIRM,
        () => ui.revertMode().then(() => onYes()),
        () => ui.revertMode(),
      );
    });
  }

  // ---- rename overlay (same DOM-input seam as the editor search) --------------------------------

  private beginRename(): boolean {
    if (this.onCreateRow) {
      return false;
    }
    this.renaming = true;
    this.renameBuffer = this.hoveredPreset()?.name ?? "";
    this.textInput?.open(this.renameBuffer, value => {
      this.renameBuffer = value;
      this.render();
    });
    this.render();
    return true;
  }

  private processRenameInput(button: Button): boolean {
    switch (button) {
      case Button.ACTION:
      case Button.SUBMIT:
        this.commitRename();
        this.getUi().playSelect();
        return true;
      case Button.CANCEL:
      case Button.MENU:
        this.cancelRename();
        return true;
      default:
        return true; // swallow navigation while the rename overlay is up
    }
  }

  private commitRename(): void {
    const idx = this.teamCursor;
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

  private closeRename(): void {
    this.renaming = false;
    this.textInput?.close();
    this.render();
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
    if (this.renaming) {
      this.renderRenameOverlay();
    }
  }

  private renderHeader(): void {
    this.fill(0, 0, SCREEN_W, HEADER_H, BAR_BG, 1);
    this.fill(0, 0, SCREEN_W, 1, 0x2a3a5c, 1);
    this.fill(0, HEADER_H - 1, SCREEN_W, 1, 0x1a2740, 1);
    this.text(MARGIN + 3, 3, "SHOWDOWN TEAMS", TextStyle.SUMMARY_GOLD, 0, FONT_NAME);
    const count = this.config!.presets.length;
    this.text(
      SCREEN_W - MARGIN - 3,
      4,
      `${count} ${count === 1 ? "team" : "teams"}`,
      TextStyle.SUMMARY_GRAY,
      1,
      FONT_TINY,
    );
  }

  private renderHotkeyBar(): void {
    this.fill(0, HOTKEY_Y, SCREEN_W, HOTKEY_H, BAR_BG, 1);
    this.fill(0, HOTKEY_Y, SCREEN_W, 1, 0x1a2740, 1);
    const onSaved = !this.onCreateRow && this.config!.presets.length > 0;
    let x = 4;
    x = this.hotkey(x, null, "SPACE.png", this.onCreateRow ? "Create" : "Enter Lobby");
    if (onSaved) {
      x = this.hotkey(x, SettingKeyboard.BUTTON_CYCLE_ABILITY, "E.png", "Edit");
      x = this.hotkey(x, SettingKeyboard.BUTTON_CYCLE_SHINY, "R.png", "Rename");
      this.hotkey(x, SettingKeyboard.BUTTON_CYCLE_NATURE, "DEL.png", "Delete");
    }
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
    const rows = this.rowCount();
    for (let vi = 0; vi < VISIBLE_BOXES; vi++) {
      const row = this.scroll + vi;
      if (row >= rows) {
        break;
      }
      const y = BODY_Y + vi * BOX_PITCH;
      if (row === cfg.presets.length) {
        this.renderCreateBox(y, BOX_H, row === this.teamCursor, false);
      } else {
        this.renderPresetBox(cfg.presets[row], y, row === this.teamCursor);
      }
    }
    // Scroll affordance arrows when the list overflows.
    if (this.scroll > 0) {
      this.text(LEFT_X + LEFT_W / 2, BODY_Y - 4, "▲", TextStyle.SUMMARY_GRAY, 0.5, FONT_TINY);
    }
    if (this.scroll + VISIBLE_BOXES < rows) {
      this.text(LEFT_X + LEFT_W / 2, SCREEN_H - 5, "▼", TextStyle.SUMMARY_GRAY, 0.5, FONT_TINY);
    }
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
    this.text(bx + 8, by + 5, "RENAME TEAM", TextStyle.SUMMARY_GOLD, 0, FONT_NAME);
    // The live text field.
    this.fill(bx + 8, by + 16, bw - 16, 12, CELL_DIM, 1);
    this.outline(bx + 8, by + 16, bw - 16, 12, GOLD);
    const shown = this.renameBuffer.length > 0 ? this.renameBuffer : "Team";
    this.text(bx + 12, by + 18, `${this.clip(shown, 30)}_`, TextStyle.SUMMARY_GOLD, 0, FONT_NAME);
    this.text(bx + 8, by + 30, "Enter: save    Esc: cancel", TextStyle.SUMMARY_GRAY, 0, FONT_TINY);
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

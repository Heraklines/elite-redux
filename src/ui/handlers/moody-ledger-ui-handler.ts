/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Fun Mode "Moody Mode" - the LEDGER: the permanent five-tab management screen.
//
// Tabs: OVERVIEW (curse + build + next draft), BINDINGS (party map of every
// attachment class), PROGRESS (persistent counters), HISTORY (chronological
// acquisition/upgrade record), CODEX (all 100 lines + curses with rarity/scope
// filters and discovered/undiscovered markers).
//
// LEFT/RIGHT switch tabs, UP/DOWN scroll the list, CYCLE_ABILITY (F) cycles the
// codex rarity filter, CYCLE_FORM cycles the codex scope filter, ACTION opens
// the effect inspector drawer on the focused boon row, CANCEL closes. Touch:
// tap a row to focus, tap the detail pane to page.
//
// Pure presentation over moody-state.ts; this screen never mutates run state.
// =============================================================================

import { globalScene } from "#app/global-scene";
import { getMoodyModeState } from "#data/elite-redux/moody/moody-state";
import type { MoodyRarity, MoodyTargetKind } from "#data/elite-redux/moody/moody-types";
import { Button } from "#enums/buttons";
import { TextStyle } from "#enums/text-style";
import { UiMode } from "#enums/ui-mode";
import { createMoodyEffectInspector, type MoodyEffectInspectorComponent } from "#ui/moody/moody-effect-inspector";
import {
  buildMoodyBindingRows,
  buildMoodyCodexRows,
  buildMoodyHistoryRows,
  buildMoodyOverviewRows,
  buildMoodyProgressRows,
  MOODY_LEDGER_TABS,
  MOODY_RARITY_TINT,
  type MoodyCodexFilter,
  type MoodyLedgerRow,
} from "#ui/moody/moody-presentation";
import { addTextObject } from "#ui/text";
import { UiHandler } from "#ui/ui-handler";
import { addWindow } from "#ui/ui-theme";

const ROW_STEP = 13;
const LIST_X = 8;
const LIST_Y = 34;
const LIST_W = 196;
const LIST_H = 136;
const LIST_VISIBLE = 9;
const DETAIL_X = 210;
const DETAIL_Y = 34;
const DETAIL_W = 102;
const DETAIL_H = 136;
const DETAIL_TEXT_H = DETAIL_H - 12;

const CODEX_RARITIES: readonly (MoodyRarity | undefined)[] = [undefined, "great", "ultra", "rogue", "master"];
const CODEX_SCOPES: readonly (MoodyTargetKind | undefined)[] = [
  undefined,
  "slot",
  "pokemon",
  "pokemon-pair",
  "move",
  "item-stack",
  "pokemon-type",
  "team",
  "field",
];

export class MoodyLedgerUiHandler extends UiHandler {
  private container: Phaser.GameObjects.Container;
  private tabTexts: Phaser.GameObjects.Text[] = [];
  private filterText: Phaser.GameObjects.Text;
  private rows: Phaser.GameObjects.Text[] = [];
  private detailText: Phaser.GameObjects.Text;
  private pageLabel: Phaser.GameObjects.Text;
  private cursorObj: Phaser.GameObjects.NineSlice;
  private upArrow: Phaser.GameObjects.Image;
  private downArrow: Phaser.GameObjects.Image;
  private emptyText: Phaser.GameObjects.Text;
  private inspector: MoodyEffectInspectorComponent;

  private tab = 0;
  private entries: MoodyLedgerRow[] = [];
  private scrollTop = 0;
  private detailPage = 0;
  private detailPageCount = 1;
  private rarityFilterIndex = 0;
  private scopeFilterIndex = 0;
  private inspectorOpen = false;

  constructor() {
    super(UiMode.MOODY_LEDGER);
  }

  setup(): void {
    const ui = this.getUi();
    const w = globalScene.scaledCanvas.width;
    const h = globalScene.scaledCanvas.height;

    this.container = globalScene.add.container(0, -h);
    this.container.setVisible(false);
    ui.add(this.container);

    const bg = globalScene.add.rectangle(0, 0, w, h, 0x14101c, 1).setOrigin(0);
    this.container.add(bg);
    const header = addTextObject(w / 2, 3, "MOODY LEDGER", TextStyle.HEADER_LABEL, { fontSize: "42px" });
    header.setOrigin(0.5, 0);
    this.container.add(header);

    // Tab strip.
    for (let tab = 0; tab < MOODY_LEDGER_TABS.length; tab++) {
      const tabText = addTextObject(14 + tab * 60, 15, MOODY_LEDGER_TABS[tab], TextStyle.SETTINGS_LABEL, {
        fontSize: "32px",
      });
      tabText.setOrigin(0, 0);
      const tabIndex = tab;
      tabText.setInteractive({ useHandCursor: true });
      tabText.on("pointerdown", () => {
        if (!this.active || this.tab === tabIndex) {
          return;
        }
        this.tab = tabIndex;
        this.rebuild();
        this.getUi().playSelect();
      });
      this.container.add(tabText);
      this.tabTexts.push(tabText);
    }
    this.filterText = addTextObject(w - 8, 15, "", TextStyle.SETTINGS_LABEL, { fontSize: "28px" });
    this.filterText.setOrigin(1, 0).setAlpha(0.8);
    this.container.add(this.filterText);

    const footer = addTextObject(
      w / 2,
      h - 2,
      "◀ ▶ tab   ↑ ↓ scroll   Z inspect   F rarity   R scope   X close",
      TextStyle.SETTINGS_LABEL,
      { fontSize: "40px" },
    );
    footer.setOrigin(0.5, 1).setAlpha(0.8);
    this.container.add(footer);

    this.container.add(addWindow(LIST_X, LIST_Y, LIST_W, LIST_H));
    this.container.add(addWindow(DETAIL_X, DETAIL_Y, DETAIL_W, DETAIL_H));

    for (let slot = 0; slot < LIST_VISIBLE; slot++) {
      const row = addTextObject(LIST_X + 12, LIST_Y + 6 + slot * ROW_STEP, "", TextStyle.SETTINGS_LABEL, {
        fontSize: "36px",
      });
      row.setOrigin(0, 0);
      this.container.add(row);
      this.rows.push(row);
    }

    this.detailText = addTextObject(DETAIL_X + 6, DETAIL_Y + 5, "", TextStyle.WINDOW, {
      fontSize: "34px",
      wordWrap: { width: (DETAIL_W - 12) * 6, useAdvancedWrap: true },
    });
    this.detailText.setOrigin(0, 0);
    const detailMask = globalScene.make.graphics();
    detailMask.fillStyle(0xffffff);
    detailMask.fillRect(DETAIL_X, DETAIL_Y + 2, DETAIL_W, DETAIL_TEXT_H);
    detailMask.setScale(6);
    this.detailText.setMask(detailMask.createGeometryMask());
    this.container.add(this.detailText);
    this.pageLabel = addTextObject(DETAIL_X + DETAIL_W - 6, DETAIL_Y + DETAIL_H - 11, "", TextStyle.SETTINGS_LABEL, {
      fontSize: "30px",
    });
    this.pageLabel.setOrigin(1, 0).setAlpha(0.8);
    this.container.add(this.pageLabel);

    this.emptyText = addTextObject(
      LIST_X + LIST_W / 2,
      LIST_Y + LIST_H / 2,
      "No boons or curses yet.\nBoss drafts are recorded here.",
      TextStyle.SETTINGS_LABEL,
      { fontSize: "40px", align: "center" },
    );
    this.emptyText.setOrigin(0.5, 0.5).setAlpha(0.75).setVisible(false);
    this.container.add(this.emptyText);

    this.cursorObj = globalScene.add
      .nineslice(0, 0, "summary_moves_cursor", undefined, LIST_W - 8, ROW_STEP, 1, 1, 1, 1)
      .setOrigin(0)
      .setVisible(false);
    this.container.add(this.cursorObj);
    this.upArrow = globalScene.add
      .image(LIST_X + LIST_W - 8, LIST_Y + 8, "cursor")
      .setScale(0.45)
      .setAngle(-90)
      .setAlpha(0.8)
      .setVisible(false);
    this.downArrow = globalScene.add
      .image(LIST_X + LIST_W - 8, LIST_Y + LIST_H - 8, "cursor")
      .setScale(0.45)
      .setAngle(90)
      .setAlpha(0.8)
      .setVisible(false);
    this.container.add([this.upArrow, this.downArrow]);

    // Inspector drawer slides over the detail pane when inspecting a boon row.
    this.inspector = createMoodyEffectInspector(DETAIL_X, DETAIL_Y, DETAIL_W, DETAIL_H);
    this.container.add(this.inspector.container);

    // Click/touch on a list row moves the cursor.
    const listHit = globalScene.add.zone(LIST_X, LIST_Y + 4, LIST_W, LIST_VISIBLE * ROW_STEP + 4).setOrigin(0);
    listHit.setInteractive({ useHandCursor: true });
    listHit.on("pointerdown", (pointer: Phaser.Input.Pointer) => {
      if (!this.active) {
        return;
      }
      const localY = pointer.y / 6 - (LIST_Y + 4);
      const slot = Math.max(0, Math.min(LIST_VISIBLE - 1, Math.floor(localY / ROW_STEP)));
      const index = this.scrollTop + slot;
      if (index < this.entries.length) {
        this.setCursor(index);
        this.getUi().playSelect();
      }
      pointer.event?.stopPropagation?.();
    });
    this.container.add(listHit);
  }

  show(_args: any[]): boolean {
    if (!super.show(_args)) {
      return false;
    }
    this.tab = 0;
    this.rarityFilterIndex = 0;
    this.scopeFilterIndex = 0;
    this.inspectorOpen = false;
    this.inspector.setVisible(false);
    this.rebuild();
    this.container.setVisible(true);
    this.getUi().moveTo(this.container, this.getUi().length - 1);
    this.getUi().hideTooltip();
    return true;
  }

  /** Rebuild the current tab's rows from live state. */
  private rebuild(): void {
    const state = getMoodyModeState();
    const waveIndex = globalScene.currentBattle?.waveIndex ?? 0;
    switch (MOODY_LEDGER_TABS[this.tab]) {
      case "OVERVIEW":
        this.entries = state == null ? [] : buildMoodyOverviewRows(state, waveIndex);
        break;
      case "BINDINGS":
        this.entries = state == null ? [] : buildMoodyBindingRows(state);
        break;
      case "PROGRESS":
        this.entries = state == null ? [] : buildMoodyProgressRows(state);
        break;
      case "HISTORY":
        this.entries = state == null ? [] : buildMoodyHistoryRows(state);
        break;
      case "CODEX": {
        const filter: MoodyCodexFilter = {
          ...(CODEX_RARITIES[this.rarityFilterIndex] == null
            ? {}
            : { rarity: CODEX_RARITIES[this.rarityFilterIndex]! }),
          ...(CODEX_SCOPES[this.scopeFilterIndex] == null ? {} : { targetKind: CODEX_SCOPES[this.scopeFilterIndex]! }),
        };
        this.entries = buildMoodyCodexRows(state, filter);
        break;
      }
    }
    this.scrollTop = 0;
    this.detailPage = 0;
    this.setCursor(0);
    this.refresh();
  }

  private refresh(): void {
    const count = this.entries.length;
    if (this.cursor < this.scrollTop) {
      this.scrollTop = this.cursor;
    } else if (this.cursor >= this.scrollTop + LIST_VISIBLE) {
      this.scrollTop = this.cursor - LIST_VISIBLE + 1;
    }
    this.scrollTop = Math.max(0, Math.min(this.scrollTop, Math.max(0, count - LIST_VISIBLE)));

    for (let tab = 0; tab < this.tabTexts.length; tab++) {
      this.tabTexts[tab].setColor(tab === this.tab ? "#f8d038" : "#f8f8f8");
      this.tabTexts[tab].setAlpha(tab === this.tab ? 1 : 0.65);
    }
    const codex = MOODY_LEDGER_TABS[this.tab] === "CODEX";
    const rarity = CODEX_RARITIES[this.rarityFilterIndex];
    const scope = CODEX_SCOPES[this.scopeFilterIndex];
    this.filterText.setVisible(codex);
    if (codex) {
      this.filterText.setText(`F:${rarity ?? "all"}  R:${scope ?? "all"}`);
      if (rarity == null) {
        this.filterText.setColor("#f8f8f8");
      } else {
        this.filterText.setColor(Phaser.Display.Color.IntegerToColor(MOODY_RARITY_TINT[rarity]).rgba);
      }
    }

    this.emptyText.setVisible(count === 0);
    for (let slot = 0; slot < LIST_VISIBLE; slot++) {
      const index = this.scrollTop + slot;
      const row = this.rows[slot];
      if (index >= count) {
        row.setText("");
        continue;
      }
      const entry = this.entries[index];
      const prefix = entry.kind === "header" ? "" : "  ";
      row.setText(`${prefix}${entry.label}`);
      row.setColor(Phaser.Display.Color.IntegerToColor(entry.tint).rgba);
      row.setAlpha(entry.kind === "header" ? 0.8 : 1);
    }

    const focused = this.entries[this.cursor];
    const selectable = focused != null && focused.kind !== "header";
    this.cursorObj
      .setVisible(count > 0)
      .setPosition(LIST_X + 4, LIST_Y + 6 + (this.cursor - this.scrollTop) * ROW_STEP - 1)
      .setSize(LIST_W - 8, ROW_STEP);
    this.upArrow.setVisible(this.scrollTop > 0);
    this.downArrow.setVisible(this.scrollTop + LIST_VISIBLE < count);

    this.detailText.setText(selectable ? focused.detail : "");
    this.detailPageCount = selectable ? Math.max(1, Math.ceil(this.detailText.displayHeight / DETAIL_TEXT_H)) : 1;
    this.detailPage = 0;
    this.applyDetailPage();
  }

  private applyDetailPage(): void {
    this.detailPage = Math.max(0, Math.min(this.detailPage, this.detailPageCount - 1));
    this.detailText.y = DETAIL_Y + 5 - this.detailPage * DETAIL_TEXT_H;
    this.pageLabel.setText(this.detailPageCount > 1 ? `${this.detailPage + 1}/${this.detailPageCount}` : "");
  }

  /** Open the inspector on the focused row when it maps to an owned boon. */
  private inspectFocused(): boolean {
    const state = getMoodyModeState();
    if (state == null || this.inspectorOpen) {
      return false;
    }
    const focused = this.entries[this.cursor];
    if (focused == null || focused.kind !== "entry") {
      return false;
    }
    // The row label starts with the boon name after the rarity/discovered glyph;
    // match by name prefix against owned instances.
    const instance = state.boons.find(
      boon => focused.label.includes(boon.boonId.split("-").join(" ")) || focused.label.includes(nameOf(boon.boonId)),
    );
    if (instance == null) {
      return false;
    }
    this.inspector.inspect(instance);
    this.inspector.setVisible(true);
    this.inspectorOpen = true;
    return true;
  }

  processInput(button: Button): boolean {
    if (!this.active) {
      return false;
    }
    // Inspector drawer captures input while open.
    if (this.inspectorOpen) {
      switch (button) {
        case Button.UP:
        case Button.LEFT:
          if (this.inspector.getPage() > 0) {
            this.inspector.setPage(this.inspector.getPage() - 1);
            this.getUi().playSelect();
            return true;
          }
          return false;
        case Button.DOWN:
        case Button.RIGHT:
          if (this.inspector.getPage() < this.inspector.getPageCount() - 1) {
            this.inspector.setPage(this.inspector.getPage() + 1);
            this.getUi().playSelect();
            return true;
          }
          return false;
        case Button.CANCEL:
        case Button.ACTION:
        case Button.SUBMIT:
          this.inspector.setVisible(false);
          this.inspectorOpen = false;
          return true;
        default:
          return false;
      }
    }

    const count = this.entries.length;
    switch (button) {
      case Button.UP:
        if (count > 0 && this.setCursor(this.cursor === 0 ? count - 1 : this.cursor - 1)) {
          this.getUi().playSelect();
          return true;
        }
        return false;
      case Button.DOWN:
        if (count > 0 && this.setCursor(this.cursor === count - 1 ? 0 : this.cursor + 1)) {
          this.getUi().playSelect();
          return true;
        }
        return false;
      case Button.LEFT:
        if (this.detailPage > 0) {
          this.detailPage--;
          this.applyDetailPage();
          this.getUi().playSelect();
          return true;
        }
        if (this.setTab(this.tab === 0 ? MOODY_LEDGER_TABS.length - 1 : this.tab - 1)) {
          this.getUi().playSelect();
          return true;
        }
        return false;
      case Button.RIGHT:
        if (this.detailPage < this.detailPageCount - 1) {
          this.detailPage++;
          this.applyDetailPage();
          this.getUi().playSelect();
          return true;
        }
        if (this.setTab(this.tab === MOODY_LEDGER_TABS.length - 1 ? 0 : this.tab + 1)) {
          this.getUi().playSelect();
          return true;
        }
        return false;
      case Button.CYCLE_ABILITY:
        if (MOODY_LEDGER_TABS[this.tab] === "CODEX") {
          this.rarityFilterIndex = (this.rarityFilterIndex + 1) % CODEX_RARITIES.length;
          this.rebuild();
          this.getUi().playSelect();
          return true;
        }
        return false;
      case Button.CYCLE_FORM:
        if (MOODY_LEDGER_TABS[this.tab] === "CODEX") {
          this.scopeFilterIndex = (this.scopeFilterIndex + 1) % CODEX_SCOPES.length;
          this.rebuild();
          this.getUi().playSelect();
          return true;
        }
        return false;
      case Button.ACTION:
      case Button.SUBMIT:
        if (this.inspectFocused()) {
          this.getUi().playSelect();
          return true;
        }
        return false;
      case Button.CANCEL:
        this.getUi().revertMode();
        return true;
      default:
        return false;
    }
  }

  private setTab(tab: number): boolean {
    if (tab === this.tab) {
      return false;
    }
    this.tab = tab;
    this.rebuild();
    return true;
  }

  override setCursor(cursor: number): boolean {
    const changed = super.setCursor(cursor);
    this.refresh();
    return changed;
  }

  override clear(): void {
    super.clear();
    this.container.setVisible(false);
    this.cursorObj?.setVisible(false);
    this.inspector?.setVisible(false);
    this.inspectorOpen = false;
    this.getUi().hideTooltip();
  }
}

/** Catalog boon names use spaces; instance ids use dashes. */
function nameOf(boonId: string): string {
  return boonId
    .split("-")
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Moody CURRENT-ENEMY boon panel.
//
// Read-only panel for the currently generated encounter (no persistent enemy
// ledger exists). Shows side-wide boons, per-slot attachments and the ACE
// group, with fog-safe and hidden-reserve rendering:
//   - hidden reserves render as silhouettes ("SLOT 3 — Unknown reserve") and
//     never reveal the species because a boon is attached
//   - under Fog of War unobserved boons render as "?" until seen
//   - debug mode adds rarity / targeting detail for balancing
//
// show() args: [{ boons, rosterSize, hiddenReserves?, fogOfWar?, observed?, debug? }]
// =============================================================================

import { globalScene } from "#app/global-scene";
import type { MoodyBoonInstance } from "#data/elite-redux/moody/moody-types";
import { Button } from "#enums/buttons";
import { TextStyle } from "#enums/text-style";
import { UiMode } from "#enums/ui-mode";
import { buildMoodyEnemyPanelRows, type MoodyEnemyPanelRow } from "#ui/moody/moody-presentation";
import { addTextObject } from "#ui/text";
import { UiHandler } from "#ui/ui-handler";
import { addWindow } from "#ui/ui-theme";

export interface MoodyEnemyPanelConfig {
  boons: readonly MoodyBoonInstance[];
  rosterSize: number;
  hiddenReserves?: boolean;
  fogOfWar?: boolean;
  observedInstanceIds?: ReadonlySet<string>;
  debug?: boolean;
}

const LIST_X = 8;
const LIST_Y = 20;
const LIST_W = 196;
const LIST_H = 150;
const VISIBLE = 10;
const ROW_STEP = 13;
const DETAIL_X = 210;
const DETAIL_Y = 20;
const DETAIL_W = 102;
const DETAIL_H = 150;

export class MoodyEnemyPanelUiHandler extends UiHandler {
  private container: Phaser.GameObjects.Container;
  private rows: Phaser.GameObjects.Text[] = [];
  private cursorObj: Phaser.GameObjects.NineSlice;
  private detailText: Phaser.GameObjects.Text;
  private pageLabel: Phaser.GameObjects.Text;
  private upArrow: Phaser.GameObjects.Image;
  private downArrow: Phaser.GameObjects.Image;

  private entries: MoodyEnemyPanelRow[] = [];
  private scrollTop = 0;
  private detailPage = 0;
  private detailPageCount = 1;

  constructor() {
    super(UiMode.MOODY_ENEMY_PANEL);
  }

  setup(): void {
    const ui = this.getUi();
    const w = globalScene.scaledCanvas.width;
    const h = globalScene.scaledCanvas.height;

    this.container = globalScene.add.container(0, -h);
    this.container.setName("moody-enemy-panel");
    this.container.setVisible(false);
    ui.add(this.container);

    const bg = globalScene.add.rectangle(0, 0, w, h, 0x14101c, 1).setOrigin(0);
    this.container.add(bg);
    const header = addTextObject(w / 2, 3, "ENEMY MOOD — CURRENT ENCOUNTER", TextStyle.HEADER_LABEL);
    header.setOrigin(0.5, 0);
    this.container.add(header);
    const footer = addTextObject(w / 2, h - 9, "↑ ↓ scroll   ◀ ▶ page text   X close", TextStyle.SETTINGS_LABEL, {
      fontSize: "40px",
    });
    footer.setOrigin(0.5, 1).setAlpha(0.8);
    this.container.add(footer);

    this.container.add(addWindow(LIST_X, LIST_Y, LIST_W, LIST_H));
    this.container.add(addWindow(DETAIL_X, DETAIL_Y, DETAIL_W, DETAIL_H));

    for (let slot = 0; slot < VISIBLE; slot++) {
      const row = addTextObject(LIST_X + 12, LIST_Y + 6 + slot * ROW_STEP, "", TextStyle.SETTINGS_LABEL, {
        fontSize: "34px",
      });
      row.setOrigin(0, 0);
      this.container.add(row);
      this.rows.push(row);
    }

    this.detailText = addTextObject(DETAIL_X + 6, DETAIL_Y + 5, "", TextStyle.WINDOW, {
      fontSize: "32px",
      wordWrap: { width: (DETAIL_W - 12) * 6, useAdvancedWrap: true },
    });
    this.detailText.setOrigin(0, 0);
    const detailMask = globalScene.make.graphics();
    detailMask.fillStyle(0xffffff);
    detailMask.fillRect(DETAIL_X, DETAIL_Y + 2, DETAIL_W, DETAIL_H - 12);
    detailMask.setScale(6);
    this.detailText.setMask(detailMask.createGeometryMask());
    this.container.add(this.detailText);
    this.pageLabel = addTextObject(DETAIL_X + DETAIL_W - 6, DETAIL_Y + DETAIL_H - 11, "", TextStyle.SETTINGS_LABEL, {
      fontSize: "30px",
    });
    this.pageLabel.setOrigin(1, 0).setAlpha(0.8);
    this.container.add(this.pageLabel);

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

    const listHit = globalScene.add.zone(LIST_X, LIST_Y + 4, LIST_W, VISIBLE * ROW_STEP + 4).setOrigin(0);
    listHit.setInteractive({ useHandCursor: true });
    listHit.on("pointerdown", (pointer: Phaser.Input.Pointer) => {
      if (!this.active) {
        return;
      }
      const localY = pointer.y / 6 - (LIST_Y + 4);
      const slot = Math.max(0, Math.min(VISIBLE - 1, Math.floor(localY / ROW_STEP)));
      const index = this.scrollTop + slot;
      if (index < this.entries.length) {
        this.setCursor(index);
        this.getUi().playSelect();
      }
      pointer.event?.stopPropagation?.();
    });
    this.container.add(listHit);
  }

  show(args: any[]): boolean {
    const config = args[0] as MoodyEnemyPanelConfig | undefined;
    if (config == null || !Array.isArray(config.boons)) {
      return false;
    }
    if (!super.show(args)) {
      return false;
    }
    this.entries = buildMoodyEnemyPanelRows(config.boons, {
      rosterSize: Math.max(1, Math.min(8, config.rosterSize)),
      ...(config.hiddenReserves == null ? {} : { hiddenReserves: config.hiddenReserves }),
      ...(config.fogOfWar == null ? {} : { fogOfWar: config.fogOfWar }),
      ...(config.observedInstanceIds == null ? {} : { observedInstanceIds: config.observedInstanceIds }),
      ...(config.debug == null ? {} : { debug: config.debug }),
    });
    this.scrollTop = 0;
    this.detailPage = 0;
    this.setCursor(0);
    this.refresh();
    this.container.setVisible(true);
    this.getUi().moveTo(this.container, this.getUi().length - 1);
    this.getUi().hideTooltip();
    return true;
  }

  private refresh(): void {
    const count = this.entries.length;
    if (this.cursor < this.scrollTop) {
      this.scrollTop = this.cursor;
    } else if (this.cursor >= this.scrollTop + VISIBLE) {
      this.scrollTop = this.cursor - VISIBLE + 1;
    }
    this.scrollTop = Math.max(0, Math.min(this.scrollTop, Math.max(0, count - VISIBLE)));

    for (let slot = 0; slot < VISIBLE; slot++) {
      const index = this.scrollTop + slot;
      const row = this.rows[slot];
      if (index >= count) {
        row.setText("");
        continue;
      }
      const entry = this.entries[index];
      row.setText(entry.label);
      row.setColor(
        entry.tint == null
          ? entry.kind === "boon"
            ? "#f8f8f8"
            : "#c8c0d8"
          : Phaser.Display.Color.IntegerToColor(entry.tint).rgba,
      );
      row.setAlpha(entry.kind === "header" || entry.kind === "slot" ? 0.85 : 1);
    }
    this.cursorObj
      .setVisible(count > 0)
      .setPosition(LIST_X + 4, LIST_Y + 6 + (this.cursor - this.scrollTop) * ROW_STEP - 1)
      .setSize(LIST_W - 8, ROW_STEP);
    this.upArrow.setVisible(this.scrollTop > 0);
    this.downArrow.setVisible(this.scrollTop + VISIBLE < count);

    const focused = this.entries[this.cursor];
    const detail = focused?.detail ?? "";
    this.detailText.setText(detail);
    this.detailPageCount = Math.max(1, Math.ceil(this.detailText.displayHeight / (DETAIL_H - 12)));
    this.detailPage = 0;
    this.applyDetailPage();
  }

  private applyDetailPage(): void {
    this.detailPage = Math.max(0, Math.min(this.detailPage, this.detailPageCount - 1));
    this.detailText.y = DETAIL_Y + 5 - this.detailPage * (DETAIL_H - 12);
    this.pageLabel.setText(this.detailPageCount > 1 ? `${this.detailPage + 1}/${this.detailPageCount}` : "");
  }

  processInput(button: Button): boolean {
    if (!this.active) {
      return false;
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
        return false;
      case Button.RIGHT:
        if (this.detailPage < this.detailPageCount - 1) {
          this.detailPage++;
          this.applyDetailPage();
          this.getUi().playSelect();
          return true;
        }
        return false;
      case Button.CANCEL:
      case Button.ACTION:
      case Button.SUBMIT:
        this.getUi().revertMode();
        return true;
      default:
        return false;
    }
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
    this.getUi().hideTooltip();
  }
}

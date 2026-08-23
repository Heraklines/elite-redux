/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { globalScene } from "#app/global-scene";
import {
  type ErEndlessActiveRift,
  getErEndlessActiveRifts,
  getErEndlessEquivalentDepth,
  getErEndlessRiftDefinition,
} from "#data/elite-redux/er-endless-continuation";
import { Button } from "#enums/buttons";
import { TextStyle } from "#enums/text-style";
import { UiMode } from "#enums/ui-mode";
import { addTextObject } from "#ui/text";
import { UiHandler } from "#ui/ui-handler";
import { addWindow } from "#ui/ui-theme";

const LIST_X = 8;
const LIST_Y = 25;
const LIST_W = 188;
const LIST_H = 145;
const DETAIL_X = 202;
const DETAIL_Y = 25;
const DETAIL_W = 110;
const DETAIL_H = 145;
const ROW_STEP = 15;
const VISIBLE_ROWS = 8;
const DETAIL_PAGE_HEIGHT = DETAIL_H - 18;

const CATEGORY_TINT = {
  mutation: "#65d8e8",
  pressure: "#ff8a8a",
} as const;

export class EndlessRiftLedgerUiHandler extends UiHandler {
  private container: Phaser.GameObjects.Container;
  private readonly rows: Phaser.GameObjects.Text[] = [];
  private cursorObj: Phaser.GameObjects.NineSlice;
  private detailText: Phaser.GameObjects.Text;
  private pageLabel: Phaser.GameObjects.Text;
  private countText: Phaser.GameObjects.Text;
  private emptyText: Phaser.GameObjects.Text;
  private upArrow: Phaser.GameObjects.Image;
  private downArrow: Phaser.GameObjects.Image;

  private entries: ErEndlessActiveRift[] = [];
  private scrollTop = 0;
  private detailPage = 0;
  private detailPageCount = 1;

  constructor() {
    super(UiMode.ENDLESS_RIFT_LEDGER);
  }

  setup(): void {
    const ui = this.getUi();
    const width = globalScene.scaledCanvas.width;
    const height = globalScene.scaledCanvas.height;

    this.container = globalScene.add.container(0, -height).setName("endless-rift-ledger").setVisible(false);
    ui.add(this.container);
    this.container.add(globalScene.add.rectangle(0, 0, width, height, 0x10151d, 1).setOrigin(0));

    const header = addTextObject(width / 2, 3, "RIFT LEDGER", TextStyle.HEADER_LABEL, { fontSize: "42px" });
    header.setOrigin(0.5, 0);
    this.container.add(header);

    this.countText = addTextObject(width - 8, 11, "", TextStyle.SETTINGS_LABEL, { fontSize: "30px" });
    this.countText.setOrigin(1, 0).setAlpha(0.8);
    this.container.add(this.countText);

    this.container.add(addWindow(LIST_X, LIST_Y, LIST_W, LIST_H));
    this.container.add(addWindow(DETAIL_X, DETAIL_Y, DETAIL_W, DETAIL_H));

    for (let slot = 0; slot < VISIBLE_ROWS; slot++) {
      const row = addTextObject(LIST_X + 12, LIST_Y + 8 + slot * ROW_STEP, "", TextStyle.SETTINGS_LABEL, {
        fontSize: "36px",
      });
      row.setOrigin(0, 0);
      this.container.add(row);
      this.rows.push(row);
    }

    this.emptyText = addTextObject(
      LIST_X + LIST_W / 2,
      LIST_Y + LIST_H / 2,
      "No active Rifts.",
      TextStyle.SETTINGS_LABEL,
      { fontSize: "42px" },
    );
    this.emptyText.setOrigin(0.5).setAlpha(0.75).setVisible(false);
    this.container.add(this.emptyText);

    this.detailText = addTextObject(DETAIL_X + 6, DETAIL_Y + 6, "", TextStyle.WINDOW, {
      fontSize: "34px",
      wordWrap: { width: (DETAIL_W - 12) * 6, useAdvancedWrap: true },
    });
    this.detailText.setOrigin(0, 0);
    const detailMask = globalScene.make.graphics();
    detailMask.fillStyle(0xffffff);
    detailMask.fillRect(DETAIL_X, DETAIL_Y + 2, DETAIL_W, DETAIL_PAGE_HEIGHT);
    detailMask.setScale(6);
    this.detailText.setMask(detailMask.createGeometryMask());
    this.container.add(this.detailText);

    this.pageLabel = addTextObject(DETAIL_X + DETAIL_W - 6, DETAIL_Y + DETAIL_H - 12, "", TextStyle.SETTINGS_LABEL, {
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

    const footer = addTextObject(
      width / 2,
      height - 2,
      "UP/DOWN select   LEFT/RIGHT page   X close",
      TextStyle.SETTINGS_LABEL,
      {
        fontSize: "38px",
      },
    );
    footer.setOrigin(0.5, 1).setAlpha(0.8);
    this.container.add(footer);

    const listHit = globalScene.add.zone(LIST_X, LIST_Y + 4, LIST_W, VISIBLE_ROWS * ROW_STEP + 6).setOrigin(0);
    listHit.setInteractive({ useHandCursor: true });
    listHit.on("pointerdown", (pointer: Phaser.Input.Pointer) => {
      if (!this.active) {
        return;
      }
      const localY = pointer.y / 6 - (LIST_Y + 4);
      const slot = Math.max(0, Math.min(VISIBLE_ROWS - 1, Math.floor(localY / ROW_STEP)));
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
    this.entries = [...getErEndlessActiveRifts()];
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
    } else if (this.cursor >= this.scrollTop + VISIBLE_ROWS) {
      this.scrollTop = this.cursor - VISIBLE_ROWS + 1;
    }
    this.scrollTop = Math.max(0, Math.min(this.scrollTop, Math.max(0, count - VISIBLE_ROWS)));

    for (let slot = 0; slot < VISIBLE_ROWS; slot++) {
      const index = this.scrollTop + slot;
      const row = this.rows[slot];
      const rift = this.entries[index];
      const definition = rift == null ? null : getErEndlessRiftDefinition(rift.id);
      if (rift == null || definition == null) {
        row.setText("");
        continue;
      }
      const category = definition.category === "pressure" ? "P" : "M";
      row.setText(`${category}${rift.pulsesRemaining}  ${definition.name}`);
      row.setColor(CATEGORY_TINT[definition.category]);
    }

    this.emptyText.setVisible(count === 0);
    this.cursorObj
      .setVisible(count > 0)
      .setPosition(LIST_X + 4, LIST_Y + 8 + (this.cursor - this.scrollTop) * ROW_STEP - 1)
      .setSize(LIST_W - 8, ROW_STEP);
    this.upArrow.setVisible(this.scrollTop > 0);
    this.downArrow.setVisible(this.scrollTop + VISIBLE_ROWS < count);
    this.countText.setText(
      `Depth ${Math.floor(getErEndlessEquivalentDepth(globalScene.currentBattle?.waveIndex ?? 0))}  |  ${count}/8 active`,
    );

    const rift = this.entries[this.cursor];
    const definition = rift == null ? null : getErEndlessRiftDefinition(rift.id);
    if (rift == null || definition == null) {
      this.detailText.setText("");
    } else {
      const pulseLabel = rift.pulsesRemaining === 1 ? "Rift pulse" : "Rift pulses";
      this.detailText.setText(
        `${definition.category.toUpperCase()}${definition.hostile ? " | HOSTILE" : ""}\n`
          + `${definition.name}\n\n`
          + `${rift.pulsesRemaining} ${pulseLabel} remain\n`
          + `Acquired at depth ${Math.floor(rift.acquiredAtDepth)}\n\n`
          + definition.description,
      );
      this.detailText.setColor(CATEGORY_TINT[definition.category]);
    }
    this.detailPageCount = Math.max(1, Math.ceil(this.detailText.displayHeight / DETAIL_PAGE_HEIGHT));
    this.detailPage = 0;
    this.applyDetailPage();
  }

  private applyDetailPage(): void {
    this.detailPage = Math.max(0, Math.min(this.detailPage, this.detailPageCount - 1));
    this.detailText.y = DETAIL_Y + 6 - this.detailPage * DETAIL_PAGE_HEIGHT;
    this.pageLabel.setText(this.detailPageCount > 1 ? `${this.detailPage + 1}/${this.detailPageCount}` : "");
  }

  processInput(button: Button): boolean {
    if (!this.active) {
      return false;
    }
    switch (button) {
      case Button.UP:
        if (this.entries.length > 0 && this.setCursor(this.cursor === 0 ? this.entries.length - 1 : this.cursor - 1)) {
          this.getUi().playSelect();
          return true;
        }
        return false;
      case Button.DOWN:
        if (this.entries.length > 0 && this.setCursor(this.cursor === this.entries.length - 1 ? 0 : this.cursor + 1)) {
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
      case Button.ACTION:
      case Button.SUBMIT:
        if (this.detailPage < this.detailPageCount - 1) {
          this.detailPage++;
          this.applyDetailPage();
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

  override setCursor(cursor: number): boolean {
    const changed = super.setCursor(cursor);
    this.refresh();
    return changed;
  }

  override clear(): void {
    super.clear();
    this.container.setVisible(false);
    this.cursorObj.setVisible(false);
    this.getUi().hideTooltip();
  }
}

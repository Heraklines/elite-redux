/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { globalScene } from "#app/global-scene";
import { getFunMegaStoneMetadata } from "#data/elite-redux/er-fun-mega-mode";
import { getFunModeConfig } from "#data/elite-redux/er-fun-mode";
import type { FormChangeItem } from "#enums/form-change-item";
import { TextStyle } from "#enums/text-style";
import { addTextObject } from "#ui/text";
import { addWindow } from "#ui/ui-theme";

const STAT_LABELS = ["HP", "ATK", "DEF", "SPA", "SPD", "SPE"];

export class FunMegaStatPreview {
  public readonly container: Phaser.GameObjects.Container;
  private readonly title: Phaser.GameObjects.Text;
  private readonly deltaTexts: Phaser.GameObjects.Text[] = [];
  private readonly deltaBars: Phaser.GameObjects.Rectangle[] = [];
  private readonly cellWidth: number;
  private readonly barWidth: number;

  constructor(x: number, y: number, width = 296) {
    this.container = globalScene.add.container(x, y).setVisible(false).setName("fun-mega-stat-preview");
    this.cellWidth = Math.floor((width - 8) / 6);
    this.barWidth = this.cellWidth - 8;
    this.container.add(addWindow(0, 0, width, 34).setOrigin(0));
    this.title = addTextObject(5, 2, "", TextStyle.SUMMARY_GOLD, {
      fontSize: "30px",
      fixedWidth: (width - 10) * 6,
      maxLines: 1,
    }).setOrigin(0);
    this.container.add(this.title);

    STAT_LABELS.forEach((label, index) => {
      const centerX = 4 + index * this.cellWidth + this.cellWidth / 2;
      const labelText = addTextObject(centerX - 2, 12, label, TextStyle.SETTINGS_LABEL, {
        fontSize: "25px",
      }).setOrigin(1, 0);
      const deltaText = addTextObject(centerX, 12, "", TextStyle.SETTINGS_LABEL, {
        fontSize: "25px",
      }).setOrigin(0, 0);
      const track = globalScene.add.rectangle(centerX, 26, this.barWidth, 3, 0x4b4657).setOrigin(0.5);
      const baseline = globalScene.add.rectangle(centerX, 26, 1, 5, 0xffe16b).setOrigin(0.5);
      const deltaBar = globalScene.add.rectangle(centerX, 26, 0, 3, 0x72dc87).setOrigin(0, 0.5);
      this.deltaTexts.push(deltaText);
      this.deltaBars.push(deltaBar);
      this.container.add([labelText, deltaText, track, deltaBar, baseline]);
    });
  }

  public show(item: FormChangeItem): boolean {
    if (!globalScene.gameMode.isFun || !getFunModeConfig().megaMode) {
      this.hide();
      return false;
    }
    const metadata = getFunMegaStoneMetadata(item);
    if (!metadata) {
      this.hide();
      return false;
    }
    this.title.setText(`${metadata.sourceName} -> ${metadata.targetName}`);
    metadata.statDelta.forEach((delta, index) => {
      const centerX = 4 + index * this.cellWidth + this.cellWidth / 2;
      const length = Math.min(this.barWidth / 2, (Math.abs(delta) / 50) * (this.barWidth / 2));
      this.deltaTexts[index]
        .setText(`${delta >= 0 ? "+" : ""}${delta}`)
        .setColor(delta > 0 ? "#72dc87" : delta < 0 ? "#e97575" : "#d8d0dc");
      this.deltaBars[index]
        .setFillStyle(delta < 0 ? 0xe97575 : 0x72dc87)
        .setPosition(delta < 0 ? centerX - length : centerX, 26)
        .setSize(length, 3);
    });
    this.container.setVisible(true);
    return true;
  }

  public hide(): void {
    this.container.setVisible(false);
  }
}

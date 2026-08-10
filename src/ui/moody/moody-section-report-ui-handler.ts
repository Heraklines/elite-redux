/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Moody SECTION REPORT: one reusable full-screen report surface.
//
// Used by the biome-transition report, the Bounty Board, Borrowed Future and
// the end-run Moody recap - each is a titled stack of sections with paged,
// scrollable text rather than a bespoke screen per feature. The caller passes
// typed sections; the handler renders, scrolls and returns. Optional action
// labels turn the footer into a confirm/cancel choice (Borrowed Future).
//
// show() args: [config: MoodySectionReportConfig]
//   config.onAction?(actionId) fires for ACTION (id "confirm") or CANCEL ("cancel").
// =============================================================================

import { globalScene } from "#app/global-scene";
import { Button } from "#enums/buttons";
import { TextStyle } from "#enums/text-style";
import { UiMode } from "#enums/ui-mode";
import type { MoodyTransitionSection } from "#ui/moody/moody-presentation";
import { addTextObject } from "#ui/text";
import { UiHandler } from "#ui/ui-handler";
import { addWindow } from "#ui/ui-theme";

export interface MoodySectionReportConfig {
  title: string;
  sections: readonly MoodyTransitionSection[];
  /** Footer hint; defaults to a scroll/close hint. */
  footer?: string;
  /** When set, ACTION fires onAction("confirm") instead of just closing. */
  confirmLabel?: string;
  onAction?: (actionId: "confirm" | "cancel") => void;
}

const WINDOW_X = 6;
const WINDOW_Y = 16;
const WINDOW_W = 308;
const WINDOW_H = 154;
const TEXT_H = WINDOW_H - 10;

export class MoodySectionReportUiHandler extends UiHandler {
  private container: Phaser.GameObjects.Container;
  private headerText: Phaser.GameObjects.Text;
  private footerText: Phaser.GameObjects.Text;
  private bodyText: Phaser.GameObjects.Text;
  private pageLabel: Phaser.GameObjects.Text;
  private emptyText: Phaser.GameObjects.Text;

  private config: MoodySectionReportConfig | null = null;
  private page = 0;
  private pageCount = 1;
  private fired = false;

  constructor() {
    super(UiMode.MOODY_SECTION_REPORT);
  }

  setup(): void {
    const ui = this.getUi();
    const w = globalScene.scaledCanvas.width;
    const h = globalScene.scaledCanvas.height;

    this.container = globalScene.add.container(0, -h);
    this.container.setName("moody-section-report");
    this.container.setVisible(false);
    ui.add(this.container);

    const bg = globalScene.add.rectangle(0, 0, w, h, 0x14101c, 1).setOrigin(0);
    this.container.add(bg);
    this.headerText = addTextObject(w / 2, 3, "", TextStyle.HEADER_LABEL);
    this.headerText.setOrigin(0.5, 0);
    this.container.add(this.headerText);
    this.footerText = addTextObject(w / 2, h - 9, "", TextStyle.SETTINGS_LABEL, { fontSize: "40px" });
    this.footerText.setOrigin(0.5, 1).setAlpha(0.8);
    this.container.add(this.footerText);

    this.container.add(addWindow(WINDOW_X, WINDOW_Y, WINDOW_W, WINDOW_H));
    this.bodyText = addTextObject(WINDOW_X + 7, WINDOW_Y + 5, "", TextStyle.WINDOW, {
      fontSize: "32px",
      wordWrap: { width: (WINDOW_W - 14) * 6, useAdvancedWrap: true },
    });
    this.bodyText.setOrigin(0, 0);
    const mask = globalScene.make.graphics();
    mask.fillStyle(0xffffff);
    mask.fillRect(WINDOW_X, WINDOW_Y + 2, WINDOW_W, TEXT_H);
    mask.setScale(6);
    this.bodyText.setMask(mask.createGeometryMask());
    this.container.add(this.bodyText);

    this.pageLabel = addTextObject(WINDOW_X + WINDOW_W - 7, WINDOW_Y + WINDOW_H - 11, "", TextStyle.SETTINGS_LABEL, {
      fontSize: "30px",
    });
    this.pageLabel.setOrigin(1, 0).setAlpha(0.8);
    this.container.add(this.pageLabel);

    this.emptyText = addTextObject(w / 2, WINDOW_Y + WINDOW_H / 2, "", TextStyle.SETTINGS_LABEL, {
      fontSize: "40px",
      align: "center",
    });
    this.emptyText.setOrigin(0.5, 0.5).setAlpha(0.75).setVisible(false);
    this.container.add(this.emptyText);
  }

  show(args: any[]): boolean {
    const config = args[0] as MoodySectionReportConfig | undefined;
    if (config == null || typeof config.title !== "string" || !Array.isArray(config.sections)) {
      return false;
    }
    if (!super.show(args)) {
      return false;
    }
    this.config = config;
    this.fired = false;
    this.headerText.setText(config.title);
    this.footerText.setText(
      config.footer
        ?? (config.confirmLabel == null ? "↑ ↓ page   X close" : `↑ ↓ page   Z ${config.confirmLabel}   X back`),
    );

    if (config.sections.length === 0) {
      this.bodyText.setText("");
      this.emptyText.setText("Nothing to report.").setVisible(true);
      this.pageCount = 1;
    } else {
      this.emptyText.setVisible(false);
      const blocks = config.sections.map(section => `— ${section.title} —\n${section.lines.join("\n")}`);
      this.bodyText.setText(blocks.join("\n\n"));
      this.pageCount = Math.max(1, Math.ceil(this.bodyText.displayHeight / TEXT_H));
    }
    this.page = 0;
    this.applyPage();
    this.container.setVisible(true);
    this.getUi().moveTo(this.container, this.getUi().length - 1);
    this.getUi().hideTooltip();
    return true;
  }

  private applyPage(): void {
    this.page = Math.max(0, Math.min(this.page, this.pageCount - 1));
    this.bodyText.y = WINDOW_Y + 5 - this.page * TEXT_H;
    this.pageLabel.setText(this.pageCount > 1 ? `${this.page + 1}/${this.pageCount}` : "");
  }

  private finish(actionId: "confirm" | "cancel"): void {
    if (this.fired) {
      return;
    }
    this.fired = true;
    const onAction = this.config?.onAction;
    this.getUi()
      .revertMode()
      .then(() => onAction?.(actionId));
  }

  processInput(button: Button): boolean {
    if (!this.active || this.config == null) {
      return false;
    }
    switch (button) {
      case Button.UP:
        if (this.page > 0) {
          this.page--;
          this.applyPage();
          this.getUi().playSelect();
          return true;
        }
        return false;
      case Button.DOWN:
        if (this.page < this.pageCount - 1) {
          this.page++;
          this.applyPage();
          this.getUi().playSelect();
          return true;
        }
        return false;
      case Button.ACTION:
      case Button.SUBMIT:
        this.getUi().playSelect();
        this.finish("confirm");
        return true;
      case Button.CANCEL:
        this.finish("cancel");
        return true;
      default:
        return false;
    }
  }

  override clear(): void {
    super.clear();
    this.container.setVisible(false);
    this.config = null;
    this.getUi().hideTooltip();
  }
}

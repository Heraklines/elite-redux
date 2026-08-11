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
  /** Prevent CANCEL from dismissing a report that must be acknowledged. */
  requireConfirm?: boolean;
  onAction?: (actionId: "confirm" | "cancel") => void;
}

const FULL_WINDOW_W = 308;
const FULL_WINDOW_H = 154;
const COMPACT_WINDOW_W = 278;
const COMPACT_WINDOW_MIN_H = 50;
const COMPACT_WINDOW_MAX_H = 108;
const BODY_TOP = 5;
const FULL_FOOTER_SPACE = 19;
const COMPACT_FOOTER_SPACE = 14;

export class MoodySectionReportUiHandler extends UiHandler {
  private container: Phaser.GameObjects.Container;
  private headerText: Phaser.GameObjects.Text;
  private footerText: Phaser.GameObjects.Text;
  private bodyText: Phaser.GameObjects.Text;
  private pageLabel: Phaser.GameObjects.Text;
  private emptyText: Phaser.GameObjects.Text;
  private reportWindow: Phaser.GameObjects.NineSlice;
  private bodyMask: Phaser.GameObjects.Graphics;

  private config: MoodySectionReportConfig | null = null;
  private page = 0;
  private pageCount = 1;
  private fired = false;
  private windowX = 6;
  private windowY = 16;
  private windowW = FULL_WINDOW_W;
  private windowH = FULL_WINDOW_H;
  private footerSpace = FULL_FOOTER_SPACE;
  private textH = FULL_WINDOW_H - BODY_TOP - FULL_FOOTER_SPACE;

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
    this.footerText = addTextObject(w / 2, h - 15, "", TextStyle.SETTINGS_LABEL, { fontSize: "48px" });
    this.footerText.setOrigin(0.5, 1).setAlpha(0.8);
    this.container.add(this.footerText);

    this.reportWindow = addWindow(this.windowX, this.windowY, this.windowW, this.windowH);
    this.container.add(this.reportWindow);
    this.bodyText = addTextObject(this.windowX + 7, this.windowY + BODY_TOP, "", TextStyle.WINDOW, {
      fontSize: "32px",
      wordWrap: { width: (this.windowW - 14) * 6, useAdvancedWrap: true },
    });
    this.bodyText.setOrigin(0, 0);
    this.bodyMask = globalScene.make.graphics();
    this.bodyMask.fillStyle(0xffffff);
    this.bodyMask.fillRect(this.windowX, this.windowY + 2, this.windowW, this.textH);
    this.bodyMask.setScale(6);
    this.bodyText.setMask(this.bodyMask.createGeometryMask());
    this.container.add(this.bodyText);

    this.pageLabel = addTextObject(this.windowX + this.windowW - 7, this.windowY + 4, "", TextStyle.SETTINGS_LABEL, {
      fontSize: "30px",
    });
    this.pageLabel.setOrigin(1, 0).setAlpha(0.8);
    this.container.add(this.pageLabel);

    this.emptyText = addTextObject(w / 2, this.windowY + this.windowH / 2, "", TextStyle.SETTINGS_LABEL, {
      fontSize: "48px",
      align: "center",
    });
    this.emptyText.setOrigin(0.5, 0.5).setAlpha(0.75).setVisible(false);
    this.container.add(this.emptyText);
    this.container.bringToTop(this.footerText);
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
    const compact = config.requireConfirm === true;
    this.footerSpace = compact ? COMPACT_FOOTER_SPACE : FULL_FOOTER_SPACE;
    this.windowW = compact ? COMPACT_WINDOW_W : FULL_WINDOW_W;
    this.windowX = Math.round((globalScene.scaledCanvas.width - this.windowW) / 2);
    this.bodyText.setFontSize(compact ? 48 : 32);
    this.bodyText.setWordWrapWidth((this.windowW - 14) * 6, true);
    if (config.sections.length === 0) {
      this.bodyText.setText("");
      this.emptyText.setText("Nothing to report.").setVisible(true);
    } else {
      this.emptyText.setVisible(false);
      const blocks = config.sections.map(section => `— ${section.title} —\n${section.lines.join("\n")}`);
      this.bodyText.setText(blocks.join("\n\n"));
    }
    this.windowH = compact
      ? Phaser.Math.Clamp(
          Math.ceil(this.bodyText.displayHeight) + BODY_TOP + this.footerSpace,
          COMPACT_WINDOW_MIN_H,
          COMPACT_WINDOW_MAX_H,
        )
      : FULL_WINDOW_H;
    this.windowY = Math.round((globalScene.scaledCanvas.height - this.windowH) / 2 + (compact ? 7 : 0));
    this.textH = this.windowH - BODY_TOP - this.footerSpace;
    this.reportWindow.setPosition(this.windowX, this.windowY).setSize(this.windowW, this.windowH);
    this.headerText.setY(Math.max(3, this.windowY - 13));
    this.bodyText.setPosition(this.windowX + 7, this.windowY + BODY_TOP);
    this.footerText.setPosition(globalScene.scaledCanvas.width / 2, this.windowY + this.windowH - 4);
    this.pageLabel.setPosition(this.windowX + this.windowW - 7, this.windowY + 4);
    this.emptyText.setPosition(globalScene.scaledCanvas.width / 2, this.windowY + this.textH / 2);
    this.bodyMask
      .clear()
      .fillStyle(0xffffff)
      .fillRect(this.windowX, this.windowY + 2, this.windowW, this.textH);
    this.pageCount = Math.max(1, Math.ceil(this.bodyText.displayHeight / this.textH));
    const pagedHint = this.pageCount > 1 ? "UP DOWN page   " : "";
    this.footerText
      .setText(
        config.requireConfirm
          ? `${pagedHint}A ${config.confirmLabel ?? "CONTINUE"}`
          : (config.footer
              ?? (config.confirmLabel == null
                ? `${pagedHint}X close`
                : `${pagedHint}Z ${config.confirmLabel}   X back`)),
      )
      .setAlpha(config.requireConfirm ? 1 : 0.8);
    this.page = 0;
    this.applyPage();
    this.container.setVisible(true);
    this.getUi().moveTo(this.container, this.getUi().length - 1);
    this.getUi().hideTooltip();
    return true;
  }

  private applyPage(): void {
    this.page = Math.max(0, Math.min(this.page, this.pageCount - 1));
    this.bodyText.y = this.windowY + BODY_TOP - this.page * this.textH;
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
        if (this.config.requireConfirm) {
          this.getUi().playError();
          return true;
        }
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

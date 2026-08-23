/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Moody generic target picker (Phaser component + UiHandler).
//
// ONE target-selection shell for every binding mode in the spec: party slot,
// Pokémon instance, two slots, two Pokémon, exact move, item stack, elemental
// type, move tag, weather/terrain, conversion option, move sealing, progression
// inheritance and replacement line. Callers pass a typed MoodyTargetPickerModel
// (title, options with eligibility + reasons + attachments + preview); the
// shell renders, navigates and returns the chosen option id - it never knows
// which boon it is targeting.
//
// Behavior contract (spec section 4):
//   - ineligible targets are DIMMED with an explicit reason
//   - effects already attached to the candidate are listed
//   - the result preview is shown before confirmation
//   - CANCEL returns to the caller without committing (allowCancel)
//
// Input parity: UP/DOWN scroll (LEFT/RIGHT page), ACTION confirms, CANCEL backs
// out, tap focuses / double-tap confirms.
// =============================================================================

import { globalScene } from "#app/global-scene";
import { Button } from "#enums/buttons";
import { TextStyle } from "#enums/text-style";
import { UiMode } from "#enums/ui-mode";
import { createMoodyListWindow, type MoodyListWindowComponent } from "#ui/moody/moody-list-window";
import type { MoodyTargetOption, MoodyTargetPickerModel } from "#ui/moody/moody-presentation";
import { moodyOptionRowText } from "#ui/moody/moody-presentation";
import { addTextObject } from "#ui/text";
import { UiHandler } from "#ui/ui-handler";

const PANE_W = 236;
const PANE_H = 150;
const VISIBLE_ROWS = 4;
const ROW_STEP = 17;

export class MoodyTargetPickerUiHandler extends UiHandler {
  private container: Phaser.GameObjects.Container;
  private list: MoodyListWindowComponent;
  private previewText: Phaser.GameObjects.Text;
  private queueText: Phaser.GameObjects.Text;

  private model: MoodyTargetPickerModel | null = null;
  private onComplete: ((optionId: number | string | null) => void) | null = null;

  constructor() {
    super(UiMode.MOODY_TARGET_PICKER);
  }

  setup(): void {
    const ui = this.getUi();
    const w = globalScene.scaledCanvas.width;
    const h = globalScene.scaledCanvas.height;

    this.container = globalScene.add.container(0, -h);
    this.container.setName("moody-target-picker");
    this.container.setVisible(false);
    ui.add(this.container);

    const paneX = (w - PANE_W) / 2;
    const paneY = (h - PANE_H) / 2;

    const bg = globalScene.add.rectangle(0, 0, w, h, 0x000000, 0.55).setOrigin(0);
    this.container.add(bg);

    this.list = createMoodyListWindow({
      x: paneX,
      y: paneY,
      width: PANE_W,
      height: PANE_H,
      visibleRows: VISIBLE_ROWS,
      rowStep: ROW_STEP,
      onCursorChange: () => this.refreshPreview(),
      onConfirm: () => this.confirm(),
    });
    this.container.add(this.list.container);

    // Preview strip pinned to the bottom of the pane: exact result of binding
    // to the focused candidate before the player commits.
    this.previewText = addTextObject(paneX + 10, paneY + PANE_H - 48, "", TextStyle.SETTINGS_LABEL, {
      fontSize: "26px",
      fixedWidth: (PANE_W - 20) * 6,
      maxLines: 5,
      wordWrap: { width: (PANE_W - 20) * 6, useAdvancedWrap: true },
    });
    this.previewText.setOrigin(0, 0).setAlpha(0.85);
    this.container.add(this.previewText);

    this.queueText = addTextObject(paneX + PANE_W - 10, paneY + 6, "", TextStyle.SETTINGS_LABEL, { fontSize: "30px" });
    this.queueText.setOrigin(1, 0).setAlpha(0.8);
    this.container.add(this.queueText);
  }

  /**
   * show() args: [model: MoodyTargetPickerModel, onComplete: (optionId | null) => void]
   * `optionId` is null when the player cancels (only when model.allowCancel).
   */
  show(args: any[]): boolean {
    if (args.length < 2 || typeof args[0] !== "object" || !(args[1] instanceof Function)) {
      return false;
    }
    if (!super.show(args)) {
      return false;
    }
    this.model = args[0] as MoodyTargetPickerModel;
    this.onComplete = args[1] as (optionId: number | string | null) => void;
    this.list.setCursor(0, this.model.options.length);
    this.refreshList();
    this.container.setVisible(true);
    this.getUi().moveTo(this.container, this.getUi().length - 1);
    this.getUi().hideTooltip();
    return true;
  }

  private currentOption(): MoodyTargetOption | null {
    return this.model?.options[this.list.getCursor()] ?? null;
  }

  private refreshList(): void {
    if (this.model == null) {
      return;
    }
    const options = this.model.options;
    this.queueText.setText(this.model.queueLabel ?? "");
    this.list.layout(options.length, index => {
      const option = options[index];
      return {
        text: moodyOptionRowText(option),
        alpha: option.eligible ? 1 : 0.4,
      };
    });
    this.refreshPreview();
  }

  private refreshPreview(): void {
    const option = this.currentOption();
    if (option == null) {
      this.previewText.setText("");
      return;
    }
    const lines: string[] = [];
    if ((option.attachments?.length ?? 0) > 0) {
      lines.push(`Attached: ${option.attachments!.join(", ")}`);
    }
    if (option.preview != null) {
      lines.push(option.preview);
    }
    if (!option.eligible && option.ineligibleReason != null) {
      lines.push(`Cannot: ${option.ineligibleReason}`);
    }
    this.previewText.setText(lines.join("\n"));
  }

  private confirm(): void {
    const option = this.currentOption();
    if (option == null || this.onComplete == null) {
      return;
    }
    if (!option.eligible) {
      this.getUi().playError();
      return;
    }
    const done = this.onComplete;
    this.onComplete = null;
    this.getUi().playSelect();
    this.getUi()
      .revertMode()
      .then(() => done(option.id));
  }

  private cancel(): boolean {
    if (this.model == null || !this.model.allowCancel || this.onComplete == null) {
      return false;
    }
    const done = this.onComplete;
    this.onComplete = null;
    this.getUi()
      .revertMode()
      .then(() => done(null));
    return true;
  }

  processInput(button: Button): boolean {
    if (!this.active || this.model == null) {
      return false;
    }
    const count = this.model.options.length;
    switch (button) {
      case Button.UP:
        if (count > 0 && this.list.getCursor() > 0) {
          this.list.setCursor(this.list.getCursor() - 1, count);
          this.getUi().playSelect();
          return true;
        }
        return false;
      case Button.DOWN:
        if (count > 0 && this.list.getCursor() < count - 1) {
          this.list.setCursor(this.list.getCursor() + 1, count);
          this.getUi().playSelect();
          return true;
        }
        return false;
      case Button.LEFT:
        if (count > 0) {
          this.list.setCursor(Math.max(0, this.list.getCursor() - VISIBLE_ROWS), count);
          this.getUi().playSelect();
          return true;
        }
        return false;
      case Button.RIGHT:
        if (count > 0) {
          this.list.setCursor(Math.min(count - 1, this.list.getCursor() + VISIBLE_ROWS), count);
          this.getUi().playSelect();
          return true;
        }
        return false;
      case Button.ACTION:
      case Button.SUBMIT:
        this.confirm();
        return true;
      case Button.CANCEL:
        return this.cancel();
      default:
        return false;
    }
  }

  override clear(): void {
    super.clear();
    this.container.setVisible(false);
    this.model = null;
    this.onComplete = null;
    this.getUi().hideTooltip();
  }
}

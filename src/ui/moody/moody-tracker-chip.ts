/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Moody tracker chip (Phaser).
//
// One compact counter chip for the contextual tracker tray: Refrain chains,
// Damage Debt countdowns, Feast tokens, Glory stacks, bounty progress...
// Chips carry an explicit urgency glyph so warning/critical is never color-only.
// =============================================================================

import { globalScene } from "#app/global-scene";
import { TextStyle } from "#enums/text-style";
import type { MoodyTrackerChipModel } from "#ui/moody/moody-presentation";
import { addTextObject } from "#ui/text";

export interface MoodyTrackerChipComponent {
  container: Phaser.GameObjects.Container;
  setModel(model: MoodyTrackerChipModel | null): void;
  /** Width of the rendered chip in logical pixels (for tray layout). */
  getWidth(): number;
}

const URGENCY_GLYPH: Readonly<Record<MoodyTrackerChipModel["urgency"], string>> = {
  normal: "",
  warning: "! ",
  critical: "!! ",
};

const URGENCY_TINT: Readonly<Record<MoodyTrackerChipModel["urgency"], number>> = {
  normal: 0xf8f8f8,
  warning: 0xf8d038,
  critical: 0xdb4343,
};

export function createMoodyTrackerChip(x: number, y: number): MoodyTrackerChipComponent {
  const container = globalScene.add.container(x, y);
  container.setName("moody-tracker-chip");

  const bg = globalScene.add.rectangle(0, 0, 10, 11, 0x14101c, 0.85).setOrigin(0);
  bg.setStrokeStyle(1, 0x8f7ab5, 0.8);
  container.add(bg);

  const text = addTextObject(2, 1, "", TextStyle.SETTINGS_LABEL, { fontSize: "30px" });
  text.setOrigin(0, 0);
  container.add(text);

  let width = 10;

  return {
    container,
    setModel(model) {
      if (model == null) {
        container.setVisible(false);
        width = 0;
        return;
      }
      container.setVisible(true);
      const pin = model.pinned ? "★" : "";
      const urgency = URGENCY_GLYPH[model.urgency];
      text
        .setText(`${pin}${urgency}${model.label} ${model.value}`)
        .setColor(Phaser.Display.Color.IntegerToColor(URGENCY_TINT[model.urgency]).rgba);
      width = text.displayWidth + 4;
      bg.setSize(width, 11);
    },
    getWidth: () => width,
  };
}

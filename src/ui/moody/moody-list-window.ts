/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Shared Moody list-window chrome (Phaser).
//
// Every Moody list surface (target picker, ledger tabs, enemy panel, feed
// inspect, bounty board...) uses the same scaffolding: a 9-slice window, N
// fixed-height text rows, a nineslice cursor, up/down scroll arrows and a
// pointer zone with keyboard/controller/mobile parity. Centralizing it keeps
// dimensions stable and behavior identical across screens.
// =============================================================================

import { globalScene } from "#app/global-scene";
import { TextStyle } from "#enums/text-style";
import { moodyClampScroll } from "#ui/moody/moody-presentation";
import { addTextObject } from "#ui/text";
import { addWindow } from "#ui/ui-theme";

export interface MoodyListWindowOptions {
  x: number;
  y: number;
  width: number;
  height: number;
  visibleRows: number;
  rowStep: number;
  /** Row font size (scaled by the text-style scale factor like other handlers). */
  fontSize?: string;
  onCursorChange?: (index: number) => void;
  onConfirm?: (index: number) => void;
}

export interface MoodyListWindowComponent {
  container: Phaser.GameObjects.Container;
  rows: Phaser.GameObjects.Text[];
  /** Repaint rows for `[scrollTop, scrollTop + visibleRows)` of `count` entries. */
  layout(count: number, rowText: (index: number) => { text: string; color?: string; alpha?: number }): void;
  setCursor(index: number, count: number): void;
  getCursor(): number;
  getScrollTop(): number;
  setVisible(visible: boolean): void;
}

export function createMoodyListWindow(options: MoodyListWindowOptions): MoodyListWindowComponent {
  const { x, y, width, height, visibleRows, rowStep } = options;
  const fontSize = options.fontSize ?? "42px";
  const container = globalScene.add.container(0, 0);
  container.setName("moody-list-window");

  const window = addWindow(x, y, width, height);
  container.add(window);

  const rows: Phaser.GameObjects.Text[] = [];
  for (let row = 0; row < visibleRows; row++) {
    const text = addTextObject(x + 14, y + 24 + row * rowStep, "", TextStyle.SETTINGS_LABEL, { fontSize });
    text.setOrigin(0, 0);
    container.add(text);
    rows.push(text);
  }

  const cursorObj = globalScene.add
    .nineslice(0, 0, "summary_moves_cursor", undefined, width - 12, 15, 1, 1, 1, 1)
    .setOrigin(0)
    .setVisible(false);
  container.add(cursorObj);

  const upArrow = globalScene.add
    .image(x + width - 10, y + 20, "cursor")
    .setScale(0.45)
    .setAngle(-90)
    .setAlpha(0.8)
    .setVisible(false);
  const downArrow = globalScene.add
    .image(x + width - 10, y + height - 8, "cursor")
    .setScale(0.45)
    .setAngle(90)
    .setAlpha(0.8)
    .setVisible(false);
  container.add([upArrow, downArrow]);

  let cursor = 0;
  let scrollTop = 0;
  let count = 0;
  let rowTextFn: (index: number) => { text: string; color?: string; alpha?: number } = () => ({ text: "" });

  function refresh(): void {
    scrollTop = moodyClampScroll(cursor, scrollTop, count, visibleRows);
    for (let slot = 0; slot < visibleRows; slot++) {
      const index = scrollTop + slot;
      const row = rows[slot];
      if (index >= count) {
        row.setText("");
        continue;
      }
      const content = rowTextFn(index);
      row.setText(content.text);
      row.setColor(content.color ?? "#f8f8f8");
      row.setAlpha(content.alpha ?? 1);
    }
    cursorObj
      .setVisible(count > 0)
      .setPosition(x + 5, y + 24 + (cursor - scrollTop) * rowStep - 1)
      .setSize(width - 12, 15);
    upArrow.setVisible(scrollTop > 0);
    downArrow.setVisible(scrollTop + visibleRows < count);
  }

  // Touch/mouse parity: tapping a row focuses it; tapping the focused row confirms.
  const hit = globalScene.add.zone(x, y + 20, width, visibleRows * rowStep + 4).setOrigin(0);
  hit.setInteractive({ useHandCursor: true });
  hit.on("pointerdown", (pointer: Phaser.Input.Pointer) => {
    if (!container.visible) {
      return;
    }
    // Pointer coords are canvas-space (6x the logical canvas); convert to logical.
    const localY = pointer.y / 6 - (y + 20);
    const slot = Math.max(0, Math.min(visibleRows - 1, Math.floor(localY / rowStep)));
    const index = scrollTop + slot;
    if (index >= count) {
      return;
    }
    if (index === cursor) {
      options.onConfirm?.(index);
    } else {
      cursor = index;
      refresh();
      options.onCursorChange?.(index);
    }
    pointer.event?.stopPropagation?.();
  });
  container.add(hit);

  return {
    container,
    rows,
    layout(nextCount, rowText) {
      count = nextCount;
      rowTextFn = rowText;
      cursor = Math.max(0, Math.min(cursor, Math.max(0, count - 1)));
      refresh();
    },
    setCursor(index, nextCount) {
      count = nextCount;
      cursor = Math.max(0, Math.min(index, Math.max(0, count - 1)));
      refresh();
      options.onCursorChange?.(cursor);
    },
    getCursor: () => cursor,
    getScrollTop: () => scrollTop,
    setVisible(visible) {
      container.setVisible(visible);
    },
  };
}

/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Moody trigger feed (Phaser).
//
// A compact, ordered, NON-modal feed of boon/curse activations anchored to the
// battle HUD. It never interrupts combat: entries arrive in engine resolution
// order, the newest pushes older ones down, and simultaneous bursts collapse
// into "N Moody effects activated [Inspect]" until expanded (INSPECT opens the
// ordered detail list in the inspector drawer).
//
// Pure presentation: entries are handed in as text + order; the feed stores at
// most `capacity` entries and re-renders on push/clear.
// =============================================================================

import { globalScene } from "#app/global-scene";
import { TextStyle } from "#enums/text-style";
import { buildMoodyFeed, type MoodyFeedEntry } from "#ui/moody/moody-presentation";
import { addTextObject } from "#ui/text";
import { addWindow, WindowVariant } from "#ui/ui-theme";

export interface MoodyTriggerFeedComponent {
  container: Phaser.GameObjects.Container;
  push(entry: MoodyFeedEntry): void;
  clearFeed(): void;
  /** Expand/collapse the simultaneous-burst summary row. */
  setExpanded(expanded: boolean): void;
  isExpanded(): boolean;
  getEntries(): readonly MoodyFeedEntry[];
}

const ROW_STEP = 10;
const MAX_ROWS = 4;

export function createMoodyTriggerFeed(x: number, y: number, width: number, capacity = 12): MoodyTriggerFeedComponent {
  const container = globalScene.add.container(x, y);
  container.setName("moody-trigger-feed");
  container.setVisible(false);

  const bg = addWindow(
    0,
    0,
    width,
    8 + MAX_ROWS * ROW_STEP,
    undefined,
    undefined,
    undefined,
    undefined,
    WindowVariant.THIN,
  );
  bg.setAlpha(0.92);
  container.add(bg);

  const rows: Phaser.GameObjects.Text[] = [];
  for (let row = 0; row < MAX_ROWS; row++) {
    const text = addTextObject(5, 4 + row * ROW_STEP, "", TextStyle.SETTINGS_LABEL, { fontSize: "28px" });
    text.setOrigin(0, 0);
    container.add(text);
    rows.push(text);
  }
  const moreLabel = addTextObject(width - 5, 4 + MAX_ROWS * ROW_STEP - 10, "", TextStyle.SETTINGS_LABEL, {
    fontSize: "26px",
  });
  moreLabel.setOrigin(1, 0).setAlpha(0.8);
  container.add(moreLabel);

  let entries: MoodyFeedEntry[] = [];
  let expanded = false;

  function render(): void {
    const visible = entries.slice(-capacity);
    const model = buildMoodyFeed(visible, expanded ? MAX_ROWS : 2);
    container.setVisible(visible.length > 0);
    for (let row = 0; row < MAX_ROWS; row++) {
      rows[row].setText(model.visible[row]?.label ?? "");
    }
    if (!expanded && model.collapsed > 0) {
      moreLabel.setText(`${model.summaryLabel ?? ""} [Inspect]`);
    } else {
      moreLabel.setText(visible.length > MAX_ROWS ? `+${visible.length - MAX_ROWS}` : "");
    }
  }

  return {
    container,
    push(entry) {
      entries.push(entry);
      if (entries.length > capacity) {
        entries = entries.slice(entries.length - capacity);
      }
      render();
    },
    clearFeed() {
      entries = [];
      render();
    },
    setExpanded(next) {
      expanded = next;
      render();
    },
    isExpanded: () => expanded,
    getEntries: () => entries,
  };
}

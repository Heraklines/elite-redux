/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Moody card primitive (Phaser).
//
// One fixed-dimension card used by the boon draft, curse draft, codex rows and
// enemy inspection. Anatomy (top -> bottom, all inside the window):
//
//   name (rarity accent)          rarity label
//   CARD STATE   | scope glyph+scope | cadence
//   effect text (paged in place - the box never resizes)
//   delta lines (rank-up / evolution comparison)   [page x/y]
//
// Rarity is an ACCENT (name underline + rarity label tint), never a color
// flood: the window frame keeps the shared ER window chrome and scope/state
// always carry explicit glyphs + text.
// =============================================================================

import { globalScene } from "#app/global-scene";
import { TextStyle } from "#enums/text-style";
import type { MoodyCardModel } from "#ui/moody/moody-presentation";
import { addTextObject } from "#ui/text";
import { addWindow } from "#ui/ui-theme";

export interface MoodyCardComponent {
  container: Phaser.GameObjects.Container;
  /** Apply a new model; returns the page count of the effect text. */
  setModel(model: MoodyCardModel): number;
  /** Flip the effect text page (mask-shift paging; stable dimensions). */
  setPage(page: number): void;
  getPageCount(): number;
  getPage(): number;
  setFocused(focused: boolean): void;
}

export interface MoodyCardOptions {
  /** Show the rank/state strip (draft) or keep the card compact (enemy rows). */
  showDelta?: boolean;
}

const NAME_Y = 3;
const META_Y = 24;
const SCOPE_Y = 33;
const DESC_PADDING = 5;

export function createMoodyCard(
  x: number,
  y: number,
  width: number,
  height: number,
  options: MoodyCardOptions = {},
): MoodyCardComponent {
  const container = globalScene.add.container(x, y);
  container.setName("moody-card");

  const frame = addWindow(0, 0, width, height);
  container.add(frame);

  const nameText = addTextObject(width / 2, NAME_Y, "", TextStyle.SUMMARY_HEADER, {
    fontSize: "34px",
    align: "center",
    fixedWidth: (width - 10) * 6,
    maxLines: 2,
    wordWrap: { width: (width - 10) * 6, useAdvancedWrap: true },
  });
  nameText.setOrigin(0.5, 0);
  container.add(nameText);

  const stateText = addTextObject(DESC_PADDING, META_Y, "", TextStyle.SUMMARY_HEADER, { fontSize: "30px" });
  stateText.setOrigin(0, 0);
  container.add(stateText);

  const rarityText = addTextObject(width - DESC_PADDING, META_Y, "", TextStyle.SUMMARY_HEADER, { fontSize: "30px" });
  rarityText.setOrigin(1, 0);
  container.add(rarityText);

  const scopeText = addTextObject(DESC_PADDING, SCOPE_Y, "", TextStyle.SETTINGS_LABEL, { fontSize: "30px" });
  scopeText.setOrigin(0, 0).setAlpha(0.85);
  container.add(scopeText);

  const cadenceText = addTextObject(width - DESC_PADDING, SCOPE_Y, "", TextStyle.SETTINGS_LABEL, { fontSize: "30px" });
  cadenceText.setOrigin(1, 0).setAlpha(0.85);
  container.add(cadenceText);

  const descY = SCOPE_Y + 12;
  const descVisibleH = height - descY - 14;
  const descText = addTextObject(DESC_PADDING, descY, "", TextStyle.WINDOW, {
    fontSize: "34px",
    wordWrap: { width: (width - 10) * 6, useAdvancedWrap: true },
  });
  descText.setOrigin(0, 0);
  // Clip the effect text to the fixed box: page flips shift the text up by one
  // box-height, so card dimensions never move regardless of description length.
  const mask = globalScene.make.graphics();
  mask.fillStyle(0xffffff);
  mask.fillRect(x, y + descY - 2, width, descVisibleH + 4);
  mask.setScale(6);
  descText.setMask(mask.createGeometryMask());
  container.add(descText);

  const pageLabel = addTextObject(width - DESC_PADDING, height - 12, "", TextStyle.SETTINGS_LABEL, {
    fontSize: "30px",
  });
  pageLabel.setOrigin(1, 0).setAlpha(0.8);
  container.add(pageLabel);

  let page = 0;
  let pageCount = 1;
  const showDelta = options.showDelta !== false;

  function setModel(model: MoodyCardModel): number {
    const hidden = model.cardState === "hidden";
    nameText.setText(model.title).setColor("#f8f8f8");
    stateText.setText(model.cardStateLabel).setColor("#e8e0f0");
    if (hidden || model.rarity == null) {
      rarityText.setText(hidden ? "CURSED" : "").setColor("#8a4a9a");
      scopeText.setText(model.scopeLabel);
      cadenceText.setText("");
    } else {
      rarityText
        .setText(model.rarityLabel ?? "")
        .setColor(Phaser.Display.Color.IntegerToColor(model.rarityTint ?? 0xf8f8f8).rgba);
      scopeText.setText(`${model.scopeGlyph} ${model.scopeLabel}`);
      cadenceText.setText(model.cadenceLabel);
    }
    const deltaBlock = showDelta && model.deltaLines.length > 0 ? `\n\n${model.deltaLines.join("\n")}` : "";
    descText.setText(`${model.description}${deltaBlock}`);
    pageCount = Math.max(1, Math.ceil(descText.displayHeight / descVisibleH));
    page = 0;
    descText.y = descY;
    pageLabel.setText(pageCount > 1 ? `1/${pageCount}` : "");
    return pageCount;
  }

  function setPage(next: number): void {
    page = Math.max(0, Math.min(next, pageCount - 1));
    descText.y = descY - page * descVisibleH;
    pageLabel.setText(pageCount > 1 ? `${page + 1}/${pageCount}` : "");
  }

  return {
    container,
    setModel,
    setPage,
    getPageCount: () => pageCount,
    getPage: () => page,
    setFocused(focused: boolean) {
      nameText.setAlpha(focused ? 1 : 0.7);
      descText.setAlpha(focused ? 1 : 0.7);
    },
  };
}

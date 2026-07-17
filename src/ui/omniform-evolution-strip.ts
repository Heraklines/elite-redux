/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux - Omniform evolution STRIP (reusable UI component).
//
// A compact, horizontally-scrolling strip of an Omniform mon's evolution icons
// with a dedicated cycle prompt, per the maintainer mockup:
//     < [icon] [icon] [icon] > [F]
// The SELECTED icon is boxed; the mon's CURRENT battle-active form is marked
// distinctly (an accent underline). When there are more evolutions than fit, the
// window scrolls and the < / > overflow arrows appear (scales to 18).
//
// EMBEDDABLE by design (maintainer directive: phase 2 reuses this in the ER batch
// level-up panel): the constructor takes a PARENT container + layout params and
// makes NO assumption about the summary layout. It owns only its own sub-container
// and its selection state; the host wires input (call `cycle()`) and reacts to
// `onChange`.
// =============================================================================

import { globalScene } from "#app/global-scene";
import { TextStyle } from "#enums/text-style";
import { computeStripWindow, type OmniformEvolutionEntry } from "#ui/omniform-evolution-view";
import { addTextObject } from "#ui/text";

export interface OmniformEvolutionStripOptions {
  /** X of the strip's top-left within the parent container. */
  x: number;
  /** Y of the strip's top-left within the parent container. */
  y: number;
  /** Max icons visible at once before the window scrolls (default 5). */
  windowSize?: number;
  /** Cell width per icon in logical px (default 17). */
  cellWidth?: number;
  /** Icon sprite scale (default 0.5). */
  iconScale?: number;
  /** Glyph shown in the dedicated-button prompt (default "F", the CYCLE_FORM key). */
  buttonGlyph?: string;
  /** Draw the selected evolution's name under the strip (default true). */
  showName?: boolean;
  /** Fired whenever the selected index changes via {@link cycle}/{@link setSelectedIndex}. */
  onChange?: (index: number, entry: OmniformEvolutionEntry) => void;
}

const DEFAULTS = {
  windowSize: 5,
  cellWidth: 17,
  iconScale: 0.5,
  buttonGlyph: "F",
  showName: true,
};

export class OmniformEvolutionStrip {
  private readonly container: Phaser.GameObjects.Container;
  private readonly entries: OmniformEvolutionEntry[];
  private readonly windowSize: number;
  private readonly cellWidth: number;
  private readonly iconScale: number;
  private readonly buttonGlyph: string;
  private readonly showName: boolean;
  private readonly onChange: ((index: number, entry: OmniformEvolutionEntry) => void) | undefined;
  private selectedIndex: number;

  constructor(
    parent: Phaser.GameObjects.Container,
    entries: OmniformEvolutionEntry[],
    selectedIndex: number,
    options: OmniformEvolutionStripOptions,
  ) {
    this.entries = entries;
    this.windowSize = options.windowSize ?? DEFAULTS.windowSize;
    this.cellWidth = options.cellWidth ?? DEFAULTS.cellWidth;
    this.iconScale = options.iconScale ?? DEFAULTS.iconScale;
    this.buttonGlyph = options.buttonGlyph ?? DEFAULTS.buttonGlyph;
    this.showName = options.showName ?? DEFAULTS.showName;
    this.onChange = options.onChange;
    this.selectedIndex = Math.max(0, Math.min(selectedIndex, Math.max(0, entries.length - 1)));

    this.container = globalScene.add.container(options.x, options.y);
    parent.add(this.container);
    this.refresh();
  }

  /** The container this strip renders into (for visibility toggles by the host). */
  getContainer(): Phaser.GameObjects.Container {
    return this.container;
  }

  getSelectedIndex(): number {
    return this.selectedIndex;
  }

  getSelectedEntry(): OmniformEvolutionEntry | null {
    return this.entries[this.selectedIndex] ?? null;
  }

  getEntryCount(): number {
    return this.entries.length;
  }

  /** Advance the selection by one (wrapping), re-render, and fire onChange. */
  cycle(step = 1): void {
    if (this.entries.length <= 1) {
      return;
    }
    const next = (this.selectedIndex + step + this.entries.length) % this.entries.length;
    this.setSelectedIndex(next);
  }

  setSelectedIndex(index: number): void {
    if (this.entries.length === 0) {
      return;
    }
    const clamped = ((index % this.entries.length) + this.entries.length) % this.entries.length;
    if (clamped === this.selectedIndex) {
      return;
    }
    this.selectedIndex = clamped;
    this.refresh();
    const entry = this.getSelectedEntry();
    if (entry) {
      this.onChange?.(this.selectedIndex, entry);
    }
  }

  setVisible(visible: boolean): void {
    this.container.setVisible(visible);
  }

  destroy(): void {
    this.container.destroy();
  }

  /** Draw one evolution icon cell (selection box + icon + current-form marker). */
  private drawIconCell(
    entry: OmniformEvolutionEntry,
    entryIndex: number,
    cx: number,
    rowY: number,
    bandH: number,
  ): void {
    // Selection box behind the selected icon.
    if (entryIndex === this.selectedIndex) {
      const box = globalScene.add
        .rectangle(cx, rowY, this.cellWidth - 1, bandH - 2, 0xffffff, 0.18)
        .setOrigin(0.5, 0.5);
      box.setStrokeStyle(1, 0xf8f8f8, 0.9);
      this.container.add(box);
    }

    const icon = globalScene.add.sprite(
      cx,
      rowY,
      entry.species.getIconAtlasKey(entry.formIndex),
      entry.species.getIconId(false, entry.formIndex),
    );
    icon.setOrigin(0.5, 0.5);
    icon.setScale(this.iconScale);
    this.container.add(icon);

    // Distinct marker for the CURRENT battle-active form: a gold underline.
    if (entry.isCurrent) {
      const mark = globalScene.add
        .rectangle(cx, rowY + bandH / 2 - 2, this.cellWidth - 3, 2, 0xffd700, 1)
        .setOrigin(0.5, 0.5);
      this.container.add(mark);
    }
  }

  /** Rebuild the strip's children for the current selection + window. */
  private refresh(): void {
    this.container.removeAll(true);
    const total = this.entries.length;
    if (total === 0) {
      return;
    }
    const win = computeStripWindow(total, this.selectedIndex, this.windowSize);

    // A subtle backing band so the icons read clearly over any page behind them.
    const arrowW = 8;
    const glyphW = 15;
    const bandW = arrowW * 2 + win.count * this.cellWidth + glyphW + 4;
    const bandH = 20;
    const band = globalScene.add.rectangle(0, 0, bandW, bandH, 0x1a1a2e, 0.55).setOrigin(0, 0);
    this.container.add(band);

    const rowY = bandH / 2;

    // Left overflow arrow.
    if (win.hasLeft) {
      const left = addTextObject(2, rowY, "<", TextStyle.WINDOW, { fontSize: "64px" }).setOrigin(0, 0.5);
      this.container.add(left);
    }

    // Windowed icons.
    const firstCellX = arrowW;
    for (let slot = 0; slot < win.count; slot++) {
      const entryIndex = win.start + slot;
      const entry = this.entries[entryIndex];
      if (entry) {
        this.drawIconCell(entry, entryIndex, firstCellX + slot * this.cellWidth + this.cellWidth / 2, rowY, bandH);
      }
    }

    // Right overflow arrow.
    const rightArrowX = firstCellX + win.count * this.cellWidth;
    if (win.hasRight) {
      const right = addTextObject(rightArrowX, rowY, ">", TextStyle.WINDOW, { fontSize: "64px" }).setOrigin(0, 0.5);
      this.container.add(right);
    }

    // Dedicated-button prompt (the on-screen glyph, mirrors the fight info button).
    const glyphX = rightArrowX + arrowW;
    const prompt = addTextObject(glyphX, rowY, `[${this.buttonGlyph}]`, TextStyle.SUMMARY_GOLD, {
      fontSize: "64px",
    }).setOrigin(0, 0.5);
    this.container.add(prompt);

    // Selected evolution name under the strip.
    if (this.showName) {
      const entry = this.getSelectedEntry();
      if (entry) {
        const label = `${entry.name}${entry.isCurrent ? " *" : ""}  (${this.selectedIndex + 1}/${total})`;
        const nameText = addTextObject(2, bandH + 1, label, TextStyle.SUMMARY_ALT, { fontSize: "56px" }).setOrigin(
          0,
          0,
        );
        this.container.add(nameText);
      }
    }
  }
}

/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux - Omniform evolution STRIP (reusable UI component).
//
// A compact, horizontally-scrolling row of an Omniform mon's evolution icons
// with a dedicated cycle prompt, per the maintainer mockup:
//     < [icon] [icon] [icon] > (F)
// BARE icons - no background container, no selection box - so it blends with the
// host screen's aesthetic. The SELECTED icon reads full-brightness while the
// others are dimmed; the mon's CURRENT battle-active form gets a small gold
// underline. Overflow shows the < / > arrows (scales to 18 via scrolling). The
// dedicated-button prompt is a real key-badge sprite (the game's `keyboard`
// atlas), so it "looks like an actual button".
//
// EMBEDDABLE by design (maintainer directive: phase 2 reuses this in the ER batch
// level-up panel): the constructor takes a PARENT container + layout params and
// makes NO assumption about the summary layout. It owns only its own sub-container
// and its selection state; the host wires input (call `cycle()`) and reacts to
// `onChange`. Its pixel width is fixed (reserved arrow slots) - {@link omniformStripWidth}
// lets a host right-align it.
// =============================================================================

import { globalScene } from "#app/global-scene";
import { TextStyle } from "#enums/text-style";
import { computeStripWindow, type OmniformEvolutionEntry } from "#ui/omniform-evolution-view";
import { addTextObject } from "#ui/text";

/** Reserved horizontal slot (logical px) for each overflow arrow. */
const ARROW_SLOT = 7;
/** Gap + width (logical px) reserved for the key-badge prompt. */
const BADGE_GAP = 3;
const BADGE_WIDTH = 13;

export interface OmniformEvolutionStripOptions {
  /** X of the strip's top-left within the parent container. */
  x: number;
  /** Y of the strip's vertical CENTRE within the parent container. */
  y: number;
  /** Max icons visible at once before the window scrolls (default 5). */
  windowSize?: number;
  /** Cell width per icon in logical px (default 16). */
  cellWidth?: number;
  /** Icon sprite scale (default 0.5). */
  iconScale?: number;
  /**
   * Key-badge glyph shown as the dedicated-button prompt. Must be a frame name
   * (minus ".png") in the game's `keyboard` atlas, e.g. "F" (the CYCLE_FORM key).
   */
  buttonGlyph?: string;
  /** Fired whenever the selected index changes via {@link cycle}/{@link setSelectedIndex}. */
  onChange?: (index: number, entry: OmniformEvolutionEntry) => void;
}

const DEFAULTS = {
  windowSize: 5,
  cellWidth: 16,
  iconScale: 0.5,
  buttonGlyph: "F",
};

/**
 * The fixed pixel width of a strip with the given window + cell size (arrow slots
 * and the key-badge are always reserved, so the width is stable across scrolls).
 * A host can right-align by placing the strip at `rightEdgeX - omniformStripWidth(...)`.
 */
export function omniformStripWidth(windowSize = DEFAULTS.windowSize, cellWidth = DEFAULTS.cellWidth): number {
  return ARROW_SLOT + windowSize * cellWidth + ARROW_SLOT + BADGE_GAP + BADGE_WIDTH;
}

export class OmniformEvolutionStrip {
  private readonly container: Phaser.GameObjects.Container;
  private readonly entries: OmniformEvolutionEntry[];
  private readonly windowSize: number;
  private readonly cellWidth: number;
  private readonly iconScale: number;
  private readonly buttonGlyph: string;
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

  /**
   * Draw one BARE evolution icon (no box). The selected icon is full-brightness
   * and slightly larger; the others are dimmed. The CURRENT battle-active form
   * gets a small gold underline so it is marked distinctly.
   */
  private drawIconCell(entry: OmniformEvolutionEntry, entryIndex: number, cx: number, rowY: number): void {
    const selected = entryIndex === this.selectedIndex;

    const icon = globalScene.add.sprite(
      cx,
      rowY,
      entry.species.getIconAtlasKey(entry.formIndex),
      entry.species.getIconId(false, entry.formIndex),
    );
    icon.setOrigin(0.5, 0.5);
    icon.setScale(selected ? this.iconScale * 1.12 : this.iconScale);
    // Selected icon reads bright; the rest are dimmed so selection is obvious
    // without any box drawn around it.
    icon.setAlpha(selected ? 1 : 0.5);
    this.container.add(icon);

    // Distinct marker for the CURRENT battle-active form: a small gold underline.
    if (entry.isCurrent) {
      const mark = globalScene.add
        .rectangle(cx, rowY + this.cellWidth / 2 - 1, this.cellWidth - 5, 1.5, 0xffd700, 1)
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

    // No background band - bare icons blend with the host screen. Layout uses a
    // FIXED grid (reserved arrow + badge slots) so the strip width never shifts
    // as the window scrolls (see omniformStripWidth).
    const rowY = 0;
    const iconsX = ARROW_SLOT;

    // Left overflow arrow (its slot is always reserved; the glyph shows on overflow).
    if (win.hasLeft) {
      this.container.add(addTextObject(0, rowY, "<", TextStyle.WINDOW, { fontSize: "56px" }).setOrigin(0, 0.5));
    }

    // Windowed icons.
    for (let slot = 0; slot < win.count; slot++) {
      const entryIndex = win.start + slot;
      const entry = this.entries[entryIndex];
      if (entry) {
        this.drawIconCell(entry, entryIndex, iconsX + slot * this.cellWidth + this.cellWidth / 2, rowY);
      }
    }

    // Right overflow arrow (slot after the full window is always reserved).
    const rightArrowX = iconsX + this.windowSize * this.cellWidth;
    if (win.hasRight) {
      this.container.add(
        addTextObject(rightArrowX, rowY, ">", TextStyle.WINDOW, { fontSize: "56px" }).setOrigin(0, 0.5),
      );
    }

    // Dedicated-button prompt: a real key-badge sprite (game `keyboard` atlas),
    // matching the in-battle / pokedex button prompts so it "looks like a button".
    const badge = globalScene.add
      .sprite(rightArrowX + ARROW_SLOT + BADGE_GAP, rowY, "keyboard", `${this.buttonGlyph}.png`)
      .setOrigin(0, 0.5);
    this.container.add(badge);
  }
}

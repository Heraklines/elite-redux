/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Fun Mode "Moody Mode" - the LEDGER: a read-only, full-screen list of the
// run's acquired boons and curses.
//
// Boons and curses are grouped under their own headers; each boon row shows
// rarity, name, rank/evolution, target summary and (on the focused row) the
// effect text in a fixed detail pane that pages in-place when it overflows.
// Arrows scroll, touch/mouse moves the cursor, CANCEL returns. An empty ledger
// renders a guidance line instead of a blank screen.
//
// Pure presentation over moody-state.ts; this screen never mutates run state.
// =============================================================================

import { globalScene } from "#app/global-scene";
import { allMoves } from "#data/data-lists";
import { getMoodyModeState, MOODY_BOON_BY_ID, MOODY_CURSE_BY_ID } from "#data/elite-redux/moody/moody-state";
import type {
  MoodyBoonInstance,
  MoodyBoonTarget,
  MoodyCurseInstance,
  MoodyRarity,
} from "#data/elite-redux/moody/moody-types";
import { Button } from "#enums/buttons";
import { PokemonType } from "#enums/pokemon-type";
import { TextStyle } from "#enums/text-style";
import { UiMode } from "#enums/ui-mode";
import { addTextObject } from "#ui/text";
import { UiHandler } from "#ui/ui-handler";
import { addWindow } from "#ui/ui-theme";

/** Rarity tint matches the shared modifier-tier palette (text.ts getModifierTierTextTint). */
const RARITY_TINT: Readonly<Record<MoodyRarity, number>> = {
  great: 0x4998f8,
  ultra: 0xf8d038,
  rogue: 0xdb4343,
  master: 0xe331c5,
};

const RARITY_LABEL: Readonly<Record<MoodyRarity, string>> = {
  great: "GREAT",
  ultra: "ULTRA",
  rogue: "ROGUE",
  master: "MASTER",
};

const DREAD_LABEL: Readonly<Record<1 | 2 | 3, string>> = {
  1: "DREAD I",
  2: "DREAD II",
  3: "DREAD III",
};

/** One ledger entry: a header row, a boon row, or a curse row. */
interface LedgerRow {
  kind: "header" | "boon" | "curse";
  label: string;
  /** Rarity tint for boons; dread purple for curses; muted grey for headers. */
  tint: number;
  /** Detail-pane text for boon/curse rows (blank for headers). */
  detail: string;
}

const ROW_STEP = 13;
const LIST_X = 8;
const LIST_Y = 22;
const LIST_W = 196;
const LIST_H = 148;
const LIST_VISIBLE = 10;
const DETAIL_X = 210;
const DETAIL_Y = 22;
const DETAIL_W = 102;
const DETAIL_H = 148;
const DETAIL_TEXT_H = DETAIL_H - 12;

/** A compact, human-readable summary of a boon/curse target. */
function targetSummary(target: MoodyBoonTarget | undefined): string {
  if (target == null) {
    return "team";
  }
  if (target.pokemonType != null && (target.pokemonIds?.length ?? 0) > 0) {
    return `${PokemonType[target.pokemonType].toLowerCase()} ally`;
  }
  if (target.pokemonType != null) {
    return `${PokemonType[target.pokemonType].toLowerCase()} foes`;
  }
  if ((target.partySlots?.length ?? 0) > 0) {
    const slots = target.partySlots!.map(slot => `slot ${slot + 1}`).join(" + ");
    if ((target.moveIds?.length ?? 0) > 0) {
      const move = allMoves[target.moveIds![0]];
      return move == null ? slots : `${slots} · ${move.name}`;
    }
    if ((target.itemTypeIds?.length ?? 0) > 0) {
      return `${slots} · item`;
    }
    return slots;
  }
  if (target.pokemonType != null) {
    return PokemonType[target.pokemonType].toLowerCase();
  }
  if ((target.itemTypeIds?.length ?? 0) > 0) {
    return "item stack";
  }
  return "team";
}

function boonDetail(instance: MoodyBoonInstance): string {
  const definition = MOODY_BOON_BY_ID.get(instance.boonId);
  if (definition == null) {
    return "";
  }
  const lines: string[] = [];
  if (instance.rank >= 2) {
    lines.push(`Rank II: ${definition.rankTwo}`);
    lines.push("");
  }
  if (instance.rank >= 3 && instance.evolutionId != null) {
    const branch = definition.evolutions.find(evolution => evolution.id === instance.evolutionId);
    if (branch != null) {
      lines.push(`${branch.name}: ${branch.description}`);
      lines.push("");
    }
  }
  lines.push(definition.base);
  return lines.join("\n");
}

export class MoodyLedgerUiHandler extends UiHandler {
  private container: Phaser.GameObjects.Container;
  private rows: Phaser.GameObjects.Text[] = [];
  private detailText: Phaser.GameObjects.Text;
  private pageLabel: Phaser.GameObjects.Text;
  private cursorObj: Phaser.GameObjects.NineSlice;
  private upArrow: Phaser.GameObjects.Image;
  private downArrow: Phaser.GameObjects.Image;
  private emptyText: Phaser.GameObjects.Text;

  private entries: LedgerRow[] = [];
  private scrollTop = 0;
  private detailPage = 0;
  private detailPageCount = 1;

  constructor() {
    super(UiMode.MOODY_LEDGER);
  }

  setup(): void {
    const ui = this.getUi();
    const w = globalScene.scaledCanvas.width;
    const h = globalScene.scaledCanvas.height;

    this.container = globalScene.add.container(0, -h);
    this.container.setVisible(false);
    ui.add(this.container);

    const bg = globalScene.add.rectangle(0, 0, w, h, 0x14101c, 1).setOrigin(0);
    this.container.add(bg);
    const header = addTextObject(w / 2, 4, "MOODY LEDGER", TextStyle.HEADER_LABEL);
    header.setOrigin(0.5, 0);
    this.container.add(header);
    const footer = addTextObject(w / 2, h - 9, "↑ ↓ scroll   ◀ ▶ page text   X close", TextStyle.SETTINGS_LABEL, {
      fontSize: "40px",
    });
    footer.setOrigin(0.5, 1).setAlpha(0.8);
    this.container.add(footer);

    const listWindow = addWindow(LIST_X, LIST_Y, LIST_W, LIST_H);
    this.container.add(listWindow);
    const detailWindow = addWindow(DETAIL_X, DETAIL_Y, DETAIL_W, DETAIL_H);
    this.container.add(detailWindow);

    for (let slot = 0; slot < LIST_VISIBLE; slot++) {
      const row = addTextObject(LIST_X + 12, LIST_Y + 6 + slot * ROW_STEP, "", TextStyle.SETTINGS_LABEL, {
        fontSize: "36px",
      });
      row.setOrigin(0, 0);
      this.container.add(row);
      this.rows.push(row);
    }

    this.detailText = addTextObject(DETAIL_X + 6, DETAIL_Y + 5, "", TextStyle.WINDOW, {
      fontSize: "34px",
      wordWrap: { width: (DETAIL_W - 12) * 6, useAdvancedWrap: true },
    });
    this.detailText.setOrigin(0, 0);
    const detailMask = globalScene.make.graphics();
    detailMask.fillStyle(0xffffff);
    detailMask.fillRect(DETAIL_X, DETAIL_Y + 2, DETAIL_W, DETAIL_TEXT_H);
    detailMask.setScale(6);
    this.detailText.setMask(detailMask.createGeometryMask());
    this.container.add(this.detailText);
    this.pageLabel = addTextObject(DETAIL_X + DETAIL_W - 6, DETAIL_Y + DETAIL_H - 11, "", TextStyle.SETTINGS_LABEL, {
      fontSize: "30px",
    });
    this.pageLabel.setOrigin(1, 0).setAlpha(0.8);
    this.container.add(this.pageLabel);

    this.emptyText = addTextObject(
      LIST_X + LIST_W / 2,
      LIST_Y + LIST_H / 2,
      "No boons or curses yet.\nBoss drafts are recorded here.",
      TextStyle.SETTINGS_LABEL,
      { fontSize: "40px", align: "center" },
    );
    this.emptyText.setOrigin(0.5, 0.5).setAlpha(0.75).setVisible(false);
    this.container.add(this.emptyText);

    this.cursorObj = globalScene.add
      .nineslice(0, 0, "summary_moves_cursor", undefined, LIST_W - 8, ROW_STEP, 1, 1, 1, 1)
      .setOrigin(0)
      .setVisible(false);
    this.container.add(this.cursorObj);
    this.upArrow = globalScene.add
      .image(LIST_X + LIST_W - 8, LIST_Y + 8, "cursor")
      .setScale(0.45)
      .setAngle(-90)
      .setAlpha(0.8)
      .setVisible(false);
    this.downArrow = globalScene.add
      .image(LIST_X + LIST_W - 8, LIST_Y + LIST_H - 8, "cursor")
      .setScale(0.45)
      .setAngle(90)
      .setAlpha(0.8)
      .setVisible(false);
    this.container.add(this.upArrow);
    this.container.add(this.downArrow);

    // Click/touch on a list row moves the cursor (or closes when re-clicking nothing meaningful).
    const listHit = globalScene.add.zone(LIST_X, LIST_Y + 4, LIST_W, LIST_VISIBLE * ROW_STEP + 4).setOrigin(0);
    listHit.setInteractive({ useHandCursor: true });
    listHit.on("pointerdown", (pointer: Phaser.Input.Pointer) => {
      if (!this.active) {
        return;
      }
      // Pointer coords are canvas-space (6x the logical canvas); convert to logical.
      const localY = pointer.y / 6 - (LIST_Y + 4);
      const slot = Math.max(0, Math.min(LIST_VISIBLE - 1, Math.floor(localY / ROW_STEP)));
      const index = this.scrollTop + slot;
      if (index < this.entries.length) {
        this.setCursor(index);
        this.getUi().playSelect();
      }
      pointer.event?.stopPropagation?.();
    });
    this.container.add(listHit);
  }

  show(_args: any[]): boolean {
    if (!super.show(_args)) {
      return false;
    }

    this.entries = this.buildEntries();
    this.scrollTop = 0;
    this.detailPage = 0;
    this.setCursor(0);
    this.refresh();
    this.container.setVisible(true);
    this.getUi().moveTo(this.container, this.getUi().length - 1);
    this.getUi().hideTooltip();
    return true;
  }

  /** Flatten state boons + curses into grouped rows (boons first, then curses). */
  private buildEntries(): LedgerRow[] {
    const state = getMoodyModeState();
    const rows: LedgerRow[] = [];
    if (state == null || (state.boons.length === 0 && state.curses.length === 0)) {
      return rows;
    }

    rows.push({ kind: "header", label: `— BOONS (${state.boons.length}) —`, tint: 0x9a90a8, detail: "" });
    for (const boon of state.boons) {
      rows.push(this.boonRow(boon));
    }
    if (state.curses.length > 0) {
      rows.push({ kind: "header", label: `— CURSES (${state.curses.length}) —`, tint: 0x9a90a8, detail: "" });
      for (const curse of state.curses) {
        rows.push(this.curseRow(curse));
      }
    }
    return rows;
  }

  private boonRow(boon: MoodyBoonInstance): LedgerRow {
    const definition = MOODY_BOON_BY_ID.get(boon.boonId);
    if (definition == null) {
      return { kind: "boon", label: boon.boonId, tint: 0x9a90a8, detail: "" };
    }
    const rankMark = boon.rank >= 3 ? "★" : boon.rank === 2 ? "II" : "I";
    const evolution =
      boon.evolutionId == null ? "" : ` ${definition.evolutions.find(e => e.id === boon.evolutionId)?.name ?? ""}`;
    const dormant = boon.dormant === true ? " (dormant)" : "";
    const label = `${RARITY_LABEL[definition.rarity]} · ${definition.name} ${rankMark}${evolution} · ${targetSummary(boon.target)}${dormant}`;
    return { kind: "boon", label, tint: RARITY_TINT[definition.rarity], detail: boonDetail(boon) };
  }

  private curseRow(curse: MoodyCurseInstance): LedgerRow {
    const definition = MOODY_CURSE_BY_ID.get(curse.curseId);
    if (definition == null) {
      return { kind: "curse", label: curse.curseId, tint: 0x8a4a9a, detail: "" };
    }
    const label = `${definition.name}  ${DREAD_LABEL[definition.dread]}`;
    const target = targetSummary(curse.target);
    const detail = `${definition.description}${curse.target == null ? "" : `\n\nMarked: ${target}`}`;
    return { kind: "curse", label, tint: 0xb06ac0, detail };
  }

  private refresh(): void {
    const count = this.entries.length;
    // Keep the cursor inside the visible window.
    if (this.cursor < this.scrollTop) {
      this.scrollTop = this.cursor;
    } else if (this.cursor >= this.scrollTop + LIST_VISIBLE) {
      this.scrollTop = this.cursor - LIST_VISIBLE + 1;
    }
    this.scrollTop = Math.max(0, Math.min(this.scrollTop, Math.max(0, count - LIST_VISIBLE)));

    this.emptyText.setVisible(count === 0);
    for (let slot = 0; slot < LIST_VISIBLE; slot++) {
      const index = this.scrollTop + slot;
      const row = this.rows[slot];
      if (index >= count) {
        row.setText("");
        continue;
      }
      const entry = this.entries[index];
      const prefix = entry.kind === "header" ? "" : "  ";
      row.setText(`${prefix}${entry.label}`);
      row.setColor(Phaser.Display.Color.IntegerToColor(entry.tint).rgba);
      row.setAlpha(entry.kind === "header" ? 0.8 : 1);
    }

    const focused = this.entries[this.cursor];
    const selectable = focused != null && focused.kind !== "header";
    this.cursorObj
      .setVisible(count > 0)
      .setPosition(LIST_X + 4, LIST_Y + 6 + (this.cursor - this.scrollTop) * ROW_STEP - 1)
      .setSize(LIST_W - 8, ROW_STEP);
    this.upArrow.setVisible(this.scrollTop > 0);
    this.downArrow.setVisible(this.scrollTop + LIST_VISIBLE < count);

    // Detail pane: only real entries carry text; headers blank it.
    this.detailText.setText(selectable ? focused.detail : "");
    this.detailPageCount = selectable ? Math.max(1, Math.ceil(this.detailText.displayHeight / DETAIL_TEXT_H)) : 1;
    this.detailPage = 0;
    this.applyDetailPage();
  }

  /** Flip the detail pane to its current page by shifting the masked text up. */
  private applyDetailPage(): void {
    this.detailPage = Math.max(0, Math.min(this.detailPage, this.detailPageCount - 1));
    this.detailText.y = DETAIL_Y + 5 - this.detailPage * DETAIL_TEXT_H;
    this.pageLabel.setText(this.detailPageCount > 1 ? `${this.detailPage + 1}/${this.detailPageCount}` : "");
  }

  processInput(button: Button): boolean {
    if (!this.active) {
      return false;
    }
    const count = this.entries.length;
    switch (button) {
      case Button.UP:
        if (count > 0 && this.setCursor(this.cursor === 0 ? count - 1 : this.cursor - 1)) {
          this.getUi().playSelect();
          return true;
        }
        return false;
      case Button.DOWN:
        if (count > 0 && this.setCursor(this.cursor === count - 1 ? 0 : this.cursor + 1)) {
          this.getUi().playSelect();
          return true;
        }
        return false;
      case Button.LEFT:
        if (this.detailPage > 0) {
          this.detailPage--;
          this.applyDetailPage();
          this.getUi().playSelect();
          return true;
        }
        return false;
      case Button.RIGHT:
        if (this.detailPage < this.detailPageCount - 1) {
          this.detailPage++;
          this.applyDetailPage();
          this.getUi().playSelect();
          return true;
        }
        return false;
      case Button.CANCEL:
      case Button.ACTION:
      case Button.SUBMIT:
        // Read-only screen: any confirm/cancel returns to the previous mode.
        this.getUi().revertMode();
        return true;
      default:
        return false;
    }
  }

  override setCursor(cursor: number): boolean {
    const changed = super.setCursor(cursor);
    this.refresh();
    return changed;
  }

  override clear(): void {
    super.clear();
    this.container.setVisible(false);
    this.cursorObj?.setVisible(false);
    this.getUi().hideTooltip();
  }
}

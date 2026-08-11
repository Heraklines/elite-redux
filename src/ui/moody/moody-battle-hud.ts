/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { globalScene } from "#app/global-scene";
import { TextStyle } from "#enums/text-style";
import { type MoodyFeedEntry, type MoodyTrackerChipModel, orderMoodyTrackerChips } from "#ui/moody/moody-presentation";
import { addTextObject } from "#ui/text";

export interface MoodyBattleHpOverlay {
  barrier?: number;
  damageDebt?: number;
  debtDueLabel?: string;
  revivalGlyph?: string;
  revivalCharges?: number;
}

export interface MoodyBattleHudModel {
  ruleLines: string[];
  trackers: MoodyTrackerChipModel[];
  feed: MoodyFeedEntry[];
  hpOverlay?: MoodyBattleHpOverlay;
  hpOverlays?: readonly (MoodyBattleHpOverlay & { pokemonId: number; pokemonName: string })[];
}

export interface MoodyBattleHudComponent {
  container: Phaser.GameObjects.Container;
  render(model: MoodyBattleHudModel): void;
  toggleFeed(): void;
  isFeedExpanded(): boolean;
}

const PANEL_ROWS = 6;
const PANEL_ROW_HEIGHT = 9;

function compactTracker(model: MoodyTrackerChipModel): string {
  const urgency = model.urgency === "critical" ? "!! " : model.urgency === "warning" ? "! " : "";
  return `${urgency}${model.label} ${model.value}`;
}

export function createMoodyBattleHud(x: number, y: number, width: number): MoodyBattleHudComponent {
  const container = globalScene.add.container(x, y).setName("moody-battle-hud").setVisible(false);
  const tabBg = globalScene.add.rectangle(0, 0, 28, 10, 0x14101c, 0.9).setOrigin(0);
  tabBg.setStrokeStyle(1, 0x8f7ab5, 0.8);
  const tabText = addTextObject(4, 1, "MOOD", TextStyle.SETTINGS_LABEL, {
    fontSize: "28px",
    fixedWidth: 22 * 6,
    maxLines: 1,
  })
    .setOrigin(0, 0)
    .setColor("#f8e5a2");

  const panel = globalScene.add.container(0, 11).setVisible(false);
  const panelBg = globalScene.add
    .rectangle(0, 0, width, PANEL_ROWS * PANEL_ROW_HEIGHT + 7, 0x14101c, 0.92)
    .setOrigin(0);
  panelBg.setStrokeStyle(1, 0x8f7ab5, 0.75);
  panel.add(panelBg);
  const rows: Phaser.GameObjects.Text[] = [];
  for (let index = 0; index < PANEL_ROWS; index++) {
    const row = addTextObject(4, 3 + index * PANEL_ROW_HEIGHT, "", TextStyle.SETTINGS_LABEL, {
      fontSize: "34px",
      fixedWidth: (width - 8) * 6,
      maxLines: 1,
    }).setOrigin(0, 0);
    row.setColor("#f8e5a2");
    panel.add(row);
    rows.push(row);
  }
  container.add([tabBg, tabText, panel]);

  let expanded = false;
  let lastModel: MoodyBattleHudModel | null = null;

  const render = (model: MoodyBattleHudModel): void => {
    lastModel = model;
    container.setVisible(true);
    panel.setVisible(expanded);

    const ordered = orderMoodyTrackerChips(model.trackers, 3);
    const activeCount = model.ruleLines.length + ordered.length;
    tabText.setText(`MOOD ${activeCount}`);
    tabBg.setStrokeStyle(1, 0x8f7ab5, 0.8);

    const lines: string[] = [];
    if (model.ruleLines.length > 0) {
      lines.push(`RULE ${model.ruleLines[0]}${model.ruleLines.length > 1 ? ` +${model.ruleLines.length - 1}` : ""}`);
    }
    lines.push(...ordered.slice(0, 3).map(compactTracker));
    const latestFeed = model.feed.at(-1)?.label;
    if (latestFeed != null) {
      lines.push(`NOW ${latestFeed}`);
    }
    const hidden = model.ruleLines.length + ordered.length + (latestFeed == null ? 0 : 1) - lines.length;
    if (hidden > 0 || lines.length < PANEL_ROWS) {
      lines.push(hidden > 0 ? `+${hidden} more - open Ledger` : "Full details: Ledger");
    }
    rows.forEach((row, index) => row.setText(lines[index] ?? ""));
  };

  const toggle = (): void => {
    expanded = !expanded;
    if (lastModel != null) {
      render(lastModel);
    }
  };
  const tabHit = globalScene.add.zone(0, 0, 28, 10).setOrigin(0).setInteractive({ useHandCursor: true });
  tabHit.on("pointerdown", toggle);
  container.add(tabHit);

  return {
    container,
    render,
    toggleFeed: toggle,
    isFeedExpanded: () => expanded,
  };
}

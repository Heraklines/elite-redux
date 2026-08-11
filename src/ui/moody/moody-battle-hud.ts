/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { globalScene } from "#app/global-scene";
import { Button } from "#enums/buttons";
import { TextStyle } from "#enums/text-style";
import {
  type MoodyFeedEntry,
  type MoodyTrackerChipModel,
  moodyWrapText,
  orderMoodyTrackerChips,
} from "#ui/moody/moody-presentation";
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
  details?: readonly MoodyBattleHudDetail[];
  hpOverlay?: MoodyBattleHpOverlay;
  hpOverlays?: readonly (MoodyBattleHpOverlay & { pokemonId: number; pokemonName: string })[];
}

export interface MoodyBattleHudDetail {
  id: string;
  title: string;
  description: string;
  tone: "boon" | "curse" | "enemy" | "tracker" | "feed";
}

export interface MoodyBattleHudComponent {
  container: Phaser.GameObjects.Container;
  render(model: MoodyBattleHudModel): void;
  toggleFeed(): void;
  isFeedExpanded(): boolean;
  processInput(button: Button): boolean;
  setTripleLayout(triple: boolean): void;
}

export interface MoodyBattleHudOptions {
  side?: "left" | "right";
  tripleY?: number;
  triplePanelPosition?: "above" | "below";
}

export interface MoodyBattleHudLine {
  text: string;
  color: string;
}

const PANEL_ROWS = 8;
const PANEL_ROW_HEIGHT = 8;
const TRIPLE_Y = 89;
const PANEL_TEXT_CHARACTER_WIDTH = 1.6;
const TAB_WIDTH = 10;
const TAB_HEIGHT = 8;
const TAB_HIT_WIDTH = 16;
const TAB_HIT_HEIGHT = 12;

const DETAIL_COLORS: Readonly<Record<MoodyBattleHudDetail["tone"], string>> = {
  boon: "#f8e5a2",
  curse: "#dca4ef",
  enemy: "#f0aa8a",
  tracker: "#9fd7f2",
  feed: "#c8c3d5",
};

function compactTracker(model: MoodyTrackerChipModel): string {
  const urgency = model.urgency === "critical" ? "!! " : model.urgency === "warning" ? "! " : "";
  return `${urgency}${model.label} ${model.value}`;
}

export function buildMoodyBattleHudLines(
  model: MoodyBattleHudModel,
  maxChars: number,
  selectedDetailIndex = 0,
  expandedDetailId: string | null = null,
): MoodyBattleHudLine[] {
  if (model.details != null && model.details.length > 0) {
    const lines: MoodyBattleHudLine[] = [];
    const groups = [
      { title: "BOONS", details: model.details.filter(detail => detail.tone === "boon" || detail.tone === "enemy") },
      { title: "CURSES", details: model.details.filter(detail => detail.tone === "curse") },
    ];
    for (const group of groups) {
      if (group.details.length === 0) {
        continue;
      }
      lines.push({ text: group.title, color: group.title === "CURSES" ? "#dca4ef" : "#f8e5a2" });
      for (const detail of group.details) {
        const detailIndex = model.details.indexOf(detail);
        const selected = detailIndex === selectedDetailIndex;
        lines.push({
          text: `${selected ? ">" : " "} ${detail.title}`,
          color: selected ? "#ffffff" : DETAIL_COLORS[detail.tone],
        });
        if (detail.id === expandedDetailId) {
          lines.push(
            ...moodyWrapText(detail.description, maxChars - 2).map(text => ({ text: `  ${text}`, color: "#ece8f2" })),
          );
        }
      }
    }
    return lines;
  }

  const ordered = orderMoodyTrackerChips(model.trackers, model.trackers.length);
  const lines: MoodyBattleHudLine[] = model.ruleLines.map(text => ({ text, color: "#f8e5a2" }));
  lines.push(
    ...ordered.flatMap(tracker => [
      { text: compactTracker(tracker), color: "#9fd7f2" },
      ...moodyWrapText(tracker.detail ?? "", maxChars)
        .filter(Boolean)
        .map(text => ({ text, color: "#ece8f2" })),
    ]),
  );
  lines.push(...model.feed.map(entry => ({ text: `NOW ${entry.label}`, color: "#c8c3d5" })));
  return lines.length > 0 ? lines : [{ text: "No active Moody effects.", color: "#c8c3d5" }];
}

export function getMoodyBattleHudWrapCharacters(width: number): number {
  return Math.max(24, Math.floor((width - 14) / PANEL_TEXT_CHARACTER_WIDTH));
}

export function createMoodyBattleHud(
  x: number,
  y: number,
  width: number,
  options: MoodyBattleHudOptions = {},
): MoodyBattleHudComponent {
  const side = options.side ?? "left";
  const tabX = side === "right" ? width - TAB_WIDTH : 0;
  const container = globalScene.add.container(x, y).setName("moody-battle-hud").setVisible(false);
  const tabBg = globalScene.add.rectangle(tabX, 0, TAB_WIDTH, TAB_HEIGHT, 0x14101c, 0.92).setOrigin(0);
  tabBg.setStrokeStyle(1, 0x8f7ab5, 0.8);
  const tabText = addTextObject(tabX + 2, 0, side === "left" ? "<" : ">", TextStyle.SETTINGS_LABEL, {
    fontSize: "30px",
    fixedWidth: 6 * 6,
    maxLines: 1,
  })
    .setOrigin(0, 0)
    .setColor("#f8e5a2");

  const panel = globalScene.add.container(0, 12).setVisible(false);
  const panelBg = globalScene.add
    .rectangle(0, 0, width, PANEL_ROWS * PANEL_ROW_HEIGHT + 7, 0x14101c, 0.95)
    .setOrigin(0);
  panelBg.setStrokeStyle(1, 0x8f7ab5, 0.75);
  panel.add(panelBg);
  const rows: Phaser.GameObjects.Text[] = [];
  for (let index = 0; index < PANEL_ROWS; index++) {
    const row = addTextObject(4, 3 + index * PANEL_ROW_HEIGHT, "", TextStyle.SETTINGS_LABEL, {
      fontSize: "30px",
      fixedWidth: (width - 14) * 6,
      maxLines: 1,
    }).setOrigin(0, 0);
    row.setColor("#f8e5a2");
    panel.add(row);
    rows.push(row);
  }
  const upIndicator = addTextObject(width - 9, 1, "↑", TextStyle.SETTINGS_LABEL, { fontSize: "48px" })
    .setOrigin(0, 0)
    .setColor("#f8e5a2")
    .setVisible(false);
  const downIndicator = addTextObject(width - 9, PANEL_ROWS * PANEL_ROW_HEIGHT - 4, "↓", TextStyle.SETTINGS_LABEL, {
    fontSize: "48px",
  })
    .setOrigin(0, 0)
    .setColor("#f8e5a2")
    .setVisible(false);
  panel.add([upIndicator, downIndicator]);
  container.add([tabBg, tabText, panel]);

  let expanded = false;
  let tripleLayout = false;
  let scrollTop = 0;
  let selectedDetailIndex = 0;
  let expandedDetailId: string | null = null;
  let lastModel: MoodyBattleHudModel | null = null;

  const render = (model: MoodyBattleHudModel): void => {
    lastModel = model;
    container.setVisible(true);
    panel.setVisible(expanded);

    tabText.setText(expanded === (side === "left") ? ">" : "<");
    tabBg.setStrokeStyle(1, 0x8f7ab5, 0.8);

    const detailCount = model.details?.length ?? 0;
    selectedDetailIndex = Math.max(0, Math.min(selectedDetailIndex, Math.max(0, detailCount - 1)));
    if (expandedDetailId != null && model.details?.some(detail => detail.id === expandedDetailId) !== true) {
      expandedDetailId = null;
    }
    const lines = buildMoodyBattleHudLines(
      model,
      getMoodyBattleHudWrapCharacters(width),
      selectedDetailIndex,
      expandedDetailId,
    );
    scrollTop = Math.max(0, Math.min(scrollTop, Math.max(0, lines.length - PANEL_ROWS)));
    if (detailCount > 0 && expandedDetailId == null) {
      const selectedLine = lines.findIndex(line => line.text.startsWith("> "));
      if (selectedLine < scrollTop) {
        scrollTop = selectedLine;
      } else if (selectedLine >= scrollTop + PANEL_ROWS) {
        scrollTop = selectedLine - PANEL_ROWS + 1;
      }
    }
    rows.forEach((row, index) => {
      const line = lines[scrollTop + index];
      row.setText(line?.text ?? "").setColor(line?.color ?? "#ece8f2");
    });
    upIndicator.setVisible(expanded && scrollTop > 0);
    downIndicator.setVisible(expanded && scrollTop + PANEL_ROWS < lines.length);
  };

  const toggle = (): void => {
    expanded = !expanded;
    if (expanded) {
      scrollTop = 0;
      selectedDetailIndex = 0;
      expandedDetailId = null;
    }
    if (lastModel != null) {
      render(lastModel);
    }
  };
  const tabHitX = side === "right" ? width - TAB_HIT_WIDTH : 0;
  const tabHit = globalScene.add
    .zone(tabHitX, 0, TAB_HIT_WIDTH, TAB_HIT_HEIGHT)
    .setOrigin(0)
    .setInteractive({ useHandCursor: true });
  tabHit.on("pointerdown", toggle);
  container.add(tabHit);

  const setTripleLayout = (triple: boolean): void => {
    if (tripleLayout === triple) {
      return;
    }
    tripleLayout = triple;
    container.setY(triple ? (options.tripleY ?? TRIPLE_Y) : y);
    panel.setX(triple ? (side === "left" ? 100 : -100) : 0);
    panel.setY(
      triple && (options.triplePanelPosition ?? "above") === "above" ? -(PANEL_ROWS * PANEL_ROW_HEIGHT + 8) : 12,
    );
  };

  const processInput = (button: Button): boolean => {
    if (!expanded) {
      return false;
    }
    const details = lastModel?.details ?? [];
    const lines =
      lastModel == null
        ? []
        : buildMoodyBattleHudLines(
            lastModel,
            getMoodyBattleHudWrapCharacters(width),
            selectedDetailIndex,
            expandedDetailId,
          );
    if (expandedDetailId != null) {
      switch (button) {
        case Button.UP:
          scrollTop = Math.max(0, scrollTop - 1);
          break;
        case Button.DOWN:
          scrollTop = Math.min(Math.max(0, lines.length - PANEL_ROWS), scrollTop + 1);
          break;
        case Button.SUBMIT:
        case Button.ACTION:
        case Button.CANCEL:
          expandedDetailId = null;
          break;
        case Button.LEFT:
        case Button.RIGHT:
          toggle();
          return true;
        default:
          return true;
      }
      if (lastModel != null) {
        render(lastModel);
      }
      return true;
    }
    switch (button) {
      case Button.UP:
        if (details.length === 0) {
          scrollTop = Math.max(0, scrollTop - 1);
        } else {
          selectedDetailIndex = Math.max(0, selectedDetailIndex - 1);
        }
        if (lastModel != null) {
          render(lastModel);
        }
        return true;
      case Button.DOWN:
        if (details.length === 0) {
          scrollTop = Math.min(Math.max(0, lines.length - PANEL_ROWS), scrollTop + 1);
        } else {
          selectedDetailIndex = Math.min(Math.max(0, details.length - 1), selectedDetailIndex + 1);
        }
        if (lastModel != null) {
          render(lastModel);
        }
        return true;
      case Button.SUBMIT:
      case Button.ACTION:
        expandedDetailId = details[selectedDetailIndex]?.id ?? null;
        if (lastModel != null) {
          render(lastModel);
        }
        return true;
      case Button.LEFT:
      case Button.RIGHT:
      case Button.CANCEL:
        toggle();
        return true;
      default:
        return true;
    }
  };

  container.setY(y);

  return {
    container,
    render,
    toggleFeed: toggle,
    isFeedExpanded: () => expanded,
    processInput,
    setTripleLayout,
  };
}

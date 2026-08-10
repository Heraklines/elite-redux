/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { globalScene } from "#app/global-scene";
import { TextStyle } from "#enums/text-style";
import {
  buildMoodyFeed,
  type MoodyFeedEntry,
  type MoodyTrackerChipModel,
  orderMoodyTrackerChips,
} from "#ui/moody/moody-presentation";
import { createMoodyTrackerChip, type MoodyTrackerChipComponent } from "#ui/moody/moody-tracker-chip";
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
  /** Backward-compatible first-active overlay. */
  hpOverlay?: MoodyBattleHpOverlay;
  /** Exact overlays for every active player battler. */
  hpOverlays?: readonly (MoodyBattleHpOverlay & { pokemonId: number; pokemonName: string })[];
}

const MAX_CHIPS = 4;
const MAX_FEED_ROWS = 4;

export interface MoodyBattleHudComponent {
  container: Phaser.GameObjects.Container;
  render(model: MoodyBattleHudModel): void;
  toggleFeed(): void;
  isFeedExpanded(): boolean;
}

export function createMoodyBattleHud(x: number, y: number, width: number): MoodyBattleHudComponent {
  const container = globalScene.add.container(x, y).setName("moody-battle-hud").setVisible(false);
  const ruleBg = globalScene.add.rectangle(0, 0, width, 12, 0x14101c, 0.85).setOrigin(0);
  ruleBg.setStrokeStyle(1, 0x8f7ab5, 0.6);
  const ruleText = addTextObject(3, 1, "", TextStyle.SETTINGS_LABEL, {
    fontSize: "28px",
    fixedWidth: (width - 6) * 6,
    maxLines: 1,
  }).setOrigin(0, 0);
  container.add([ruleBg, ruleText]);

  const chips: MoodyTrackerChipComponent[] = [];
  for (let index = 0; index < MAX_CHIPS; index++) {
    const chip = createMoodyTrackerChip(0, 14);
    container.add(chip.container);
    chips.push(chip);
  }

  const feedBg = globalScene.add.rectangle(0, 27, width, 22, 0x14101c, 0.7).setOrigin(0);
  container.add(feedBg);
  const feedRows: Phaser.GameObjects.Text[] = [];
  for (let row = 0; row < MAX_FEED_ROWS; row++) {
    const text = addTextObject(3, 28 + row * 9, "", TextStyle.SETTINGS_LABEL, {
      fontSize: "26px",
      fixedWidth: (width - 6) * 6,
      maxLines: 1,
    }).setOrigin(0, 0);
    container.add(text);
    feedRows.push(text);
  }
  const hpText = addTextObject(3, 51, "", TextStyle.SETTINGS_LABEL, {
    fontSize: "28px",
    fixedWidth: (width - 6) * 6,
    maxLines: 2,
  }).setOrigin(0, 0);
  container.add(hpText);

  let feedExpanded = false;
  let lastModel: MoodyBattleHudModel | null = null;

  const render = (model: MoodyBattleHudModel): void => {
    lastModel = model;
    container.setVisible(true);
    ruleBg.setVisible(model.ruleLines.length > 0);
    ruleText.setVisible(model.ruleLines.length > 0).setText(model.ruleLines.join(" | "));

    const ordered = orderMoodyTrackerChips(model.trackers, 3).slice(0, MAX_CHIPS);
    let chipX = 0;
    for (let index = 0; index < MAX_CHIPS; index++) {
      const chip = chips[index];
      const chipModel = ordered[index] ?? null;
      chip.container.setPosition(chipX, 14);
      chip.setModel(chipModel);
      if (chipModel != null) {
        chipX += chip.getWidth() + 3;
      }
    }

    const feedModel = buildMoodyFeed(model.feed, feedExpanded ? MAX_FEED_ROWS : 2);
    feedBg.setVisible(feedModel.visible.length > 0).setSize(width, feedExpanded ? 40 : 22);
    for (let row = 0; row < MAX_FEED_ROWS; row++) {
      feedRows[row].setVisible(feedExpanded || row < 2).setText(feedModel.visible[row]?.label ?? "");
    }
    if (!feedExpanded && feedModel.collapsed > 0 && feedModel.summaryLabel != null) {
      feedRows[1].setText(`${feedModel.summaryLabel} [Inspect]`);
    }

    const overlays =
      model.hpOverlays
      ?? (model.hpOverlay == null ? [] : [{ pokemonId: -1, pokemonName: "Active", ...model.hpOverlay }]);
    hpText.setText(
      overlays
        .map(overlay => {
          const parts: string[] = [];
          if ((overlay.barrier ?? 0) > 0) {
            parts.push(`barrier ${overlay.barrier}`);
          }
          if ((overlay.damageDebt ?? 0) > 0) {
            parts.push(`debt ${overlay.damageDebt}${overlay.debtDueLabel == null ? "" : ` (${overlay.debtDueLabel})`}`);
          }
          if ((overlay.revivalCharges ?? 0) > 0) {
            parts.push(`${overlay.revivalGlyph ?? "revive"} ${"◆".repeat(overlay.revivalCharges ?? 0)}`);
          }
          return parts.length === 0 ? "" : `${overlay.pokemonName}: ${parts.join(" / ")}`;
        })
        .filter(Boolean)
        .join("   "),
    );
  };

  const feedHit = globalScene.add.zone(0, 27, width, 40).setOrigin(0).setInteractive({ useHandCursor: true });
  feedHit.on("pointerdown", () => {
    feedExpanded = !feedExpanded;
    if (lastModel != null) {
      render(lastModel);
    }
  });
  container.add(feedHit);

  return {
    container,
    render,
    toggleFeed() {
      feedExpanded = !feedExpanded;
      if (lastModel != null) {
        render(lastModel);
      }
    },
    isFeedExpanded: () => feedExpanded,
  };
}

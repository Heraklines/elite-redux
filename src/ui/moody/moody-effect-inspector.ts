/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Moody effect inspector drawer (Phaser).
//
// A right-side drawer showing the full text of one focused effect: name,
// rarity, rank/evolution, scope/cadence, exact target, current counters, and
// the complete upgrade/evolution tree. Text pages in place inside a fixed box
// so the drawer never resizes under long descriptions.
//
// Opened from any list surface via INSPECT (ACTION on a focused row) and closed
// with CANCEL; keyboard/controller/mobile all drive the same paging.
// =============================================================================

import { globalScene } from "#app/global-scene";
import { MOODY_BOON_BY_ID } from "#data/elite-redux/moody/moody-state";
import type { MoodyBoonInstance } from "#data/elite-redux/moody/moody-types";
import { TextStyle } from "#enums/text-style";
import {
  buildMoodyBadge,
  inferMoodyCadence,
  MOODY_CADENCE_LABEL,
  MOODY_SCOPE_GLYPH,
  moodyProgressText,
  moodyRankLabel,
  moodyTargetSummary,
} from "#ui/moody/moody-presentation";
import { addTextObject } from "#ui/text";
import { addWindow } from "#ui/ui-theme";

export interface MoodyEffectInspectorComponent {
  container: Phaser.GameObjects.Container;
  /** Populate the drawer; returns the number of text pages. */
  inspect(instance: MoodyBoonInstance): number;
  setPage(page: number): void;
  getPageCount(): number;
  getPage(): number;
  setVisible(visible: boolean): void;
}

export function createMoodyEffectInspector(
  x: number,
  y: number,
  width: number,
  height: number,
): MoodyEffectInspectorComponent {
  const container = globalScene.add.container(0, 0);
  container.setName("moody-effect-inspector");
  container.setVisible(false);

  const window = addWindow(x, y, width, height);
  container.add(window);

  const title = addTextObject(x + 6, y + 4, "", TextStyle.SUMMARY_HEADER, { fontSize: "38px" });
  title.setOrigin(0, 0);
  container.add(title);

  const bodyTop = y + 16;
  const bodyH = height - 16 - 12;
  const body = addTextObject(x + 6, bodyTop, "", TextStyle.WINDOW, {
    fontSize: "32px",
    wordWrap: { width: (width - 12) * 6, useAdvancedWrap: true },
  });
  body.setOrigin(0, 0);
  const mask = globalScene.make.graphics();
  mask.fillStyle(0xffffff);
  mask.fillRect(x, bodyTop, width, bodyH);
  mask.setScale(6);
  body.setMask(mask.createGeometryMask());
  container.add(body);

  const pageLabel = addTextObject(x + width - 6, y + height - 11, "", TextStyle.SETTINGS_LABEL, { fontSize: "28px" });
  pageLabel.setOrigin(1, 0).setAlpha(0.8);
  container.add(pageLabel);

  let page = 0;
  let pageCount = 1;

  return {
    container,
    inspect(instance) {
      const definition = MOODY_BOON_BY_ID.get(instance.boonId);
      if (definition == null) {
        title.setText(instance.boonId);
        body.setText("");
        pageCount = 1;
        page = 0;
        pageLabel.setText("");
        return pageCount;
      }
      const badge = buildMoodyBadge(instance);
      title.setText(`${definition.name} ${moodyRankLabel(instance, definition)}`);
      const lines: string[] = [
        `${badge.stateLabel} · ${definition.rarity.toUpperCase()} · ${MOODY_SCOPE_GLYPH[definition.targetKind]} ${definition.scope}`,
        `Cadence: ${MOODY_CADENCE_LABEL[inferMoodyCadence(definition)]}`,
        `Bound to: ${moodyTargetSummary(instance.target)}`,
      ];
      const progress = moodyProgressText(instance);
      if (progress != null) {
        lines.push(`Progress: ${progress}`);
      }
      lines.push("", `Base: ${definition.base}`, "", `Rank II: ${definition.rankTwo}`, "");
      for (const branch of definition.evolutions) {
        const owned = instance.evolutionId === branch.id ? " (chosen)" : "";
        lines.push(`${branch.name}${owned}: ${branch.description}`, "");
      }
      body.setText(lines.join("\n"));
      pageCount = Math.max(1, Math.ceil(body.displayHeight / bodyH));
      page = 0;
      body.y = bodyTop;
      pageLabel.setText(pageCount > 1 ? `1/${pageCount}` : "");
      return pageCount;
    },
    setPage(next) {
      page = Math.max(0, Math.min(next, pageCount - 1));
      body.y = bodyTop - page * bodyH;
      pageLabel.setText(pageCount > 1 ? `${page + 1}/${pageCount}` : "");
    },
    getPageCount: () => pageCount,
    getPage: () => page,
    setVisible(visible) {
      container.setVisible(visible);
    },
  };
}

/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Moody effect badge primitive (Phaser).
//
// A compact, fixed-height text chip representing one attached boon on a slot,
// Pokémon, move, item stack, enemy or HUD row. State is ALWAYS glyph + text
// (never color-only); rarity tints only the small leading scope glyph.
//
// Badge text example: "■ Bastion Seat II ✓" / "◆ Chosen One ★Conqueror ▲4/10"
// State glyph mapping lives in moody-presentation.ts (MOODY_STATE_GLYPH).
// =============================================================================

import { globalScene } from "#app/global-scene";
import { TextStyle } from "#enums/text-style";
import { MOODY_STATE_LABEL, type MoodyBadgeModel } from "#ui/moody/moody-presentation";
import { addTextObject } from "#ui/text";

export interface MoodyEffectBadgeComponent {
  container: Phaser.GameObjects.Container;
  setModel(model: MoodyBadgeModel | null): void;
}

const STATE_TINT: Readonly<Record<MoodyBadgeModel["state"], number>> = {
  ready: 0x8ff0a4,
  consumed: 0x9a90a8,
  cooldown: 0xf8d038,
  dormant: 0x8a6ac0,
  suppressed: 0xdb4343,
  invalid: 0xdb4343,
  progress: 0x4998f8,
};

export function createMoodyEffectBadge(x: number, y: number): MoodyEffectBadgeComponent {
  const container = globalScene.add.container(x, y);
  container.setName("moody-effect-badge");

  const scopeGlyph = addTextObject(0, 0, "", TextStyle.SETTINGS_LABEL, { fontSize: "30px" });
  scopeGlyph.setOrigin(0, 0);
  container.add(scopeGlyph);

  const nameText = addTextObject(7, 0, "", TextStyle.SETTINGS_LABEL, { fontSize: "30px" });
  nameText.setOrigin(0, 0);
  container.add(nameText);

  const stateText = addTextObject(0, 0, "", TextStyle.SETTINGS_LABEL, { fontSize: "30px" });
  stateText.setOrigin(0, 0);
  container.add(stateText);

  return {
    container,
    setModel(model: MoodyBadgeModel | null) {
      if (model == null) {
        container.setVisible(false);
        return;
      }
      container.setVisible(true);
      // The model's badgeText starts with the scope glyph; split it so the glyph
      // can take the rarity tint while the name stays neutral and the state
      // glyph+text takes the state tint. Text always accompanies the glyph.
      const firstSpace = model.badgeText.indexOf(" ");
      scopeGlyph
        .setText(firstSpace > 0 ? model.badgeText.slice(0, firstSpace) : model.badgeText)
        .setColor(Phaser.Display.Color.IntegerToColor(model.tint).rgba);
      const rest = firstSpace > 0 ? model.badgeText.slice(firstSpace + 1) : "";
      const stateGlyphIndex = rest.lastIndexOf(model.stateGlyph);
      const name = stateGlyphIndex > 0 ? rest.slice(0, stateGlyphIndex).trimEnd() : rest;
      nameText.setText(name).setColor("#f8f8f8");
      const progress = model.progressText == null ? "" : ` ${model.progressText}`;
      stateText
        .setText(`${model.stateGlyph} ${MOODY_STATE_LABEL[model.state]}${progress}`)
        .setColor(Phaser.Display.Color.IntegerToColor(STATE_TINT[model.state]).rgba);
      stateText.setPosition(scopeGlyph.width / 6 + 7 + nameText.displayWidth + 4, 0);
      // Dormant badges stay visible but greyed (Mood Swing spec): alpha conveys
      // "present but off" while the ☾ glyph + DORMANT text carry the meaning.
      container.setAlpha(model.state === "dormant" ? 0.55 : 1);
    },
  };
}

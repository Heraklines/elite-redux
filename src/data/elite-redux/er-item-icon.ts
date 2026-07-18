/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux - item-icon sprite resolver (shared).
//
// Most item icons are FRAMES in the shared "items" texture atlas, addressed by
// a `ModifierType.iconImage` frame name. ER custom items (tactical/reactive held
// items, elemental Gems, terrain/ward seeds) are instead STANDALONE textures,
// loaded by key via `loadImage` in loading-scene under the `er_*` convention -
// they are NOT frames in the atlas. Building their sprite the vanilla way
// (`scene.add.sprite(x, y, "items", "er_eject_pack")`) asks the atlas for a frame
// it does not have: Phaser logs `Texture "items" has no frame "er_eject_pack"`
// and renders a blank / whole-atlas fallback. That is exactly what blanked ER
// items on the post-battle reward screen (live log 2026-07-18).
//
// This resolver is the single place that picks the right source: if the key is
// its own loaded texture, draw it directly; otherwise fall back to the atlas
// frame. It mirrors the check the biome shop grid and the summary/held-item
// getIcon overrides already do, consolidated so every surface behaves the same.
//
// Sizing: the standalone er_* textures are 24x24 vs the atlas's ~32x32 frames.
// Following the getIcon house convention (dee012ee), they are drawn at their
// NATURAL size here - callers apply whatever per-surface scale they already use
// for the atlas frame; the resolver only chooses the texture, never rescales.
// =============================================================================

import { globalScene } from "#app/global-scene";

/**
 * Build the icon sprite for a `ModifierType.iconImage` at (x, y), transparently
 * handling both atlas frames and ER standalone `er_*` textures.
 *
 * @param x - local x position
 * @param y - local y position
 * @param iconImage - the ModifierType's `iconImage` (an atlas frame name, or an
 *   `er_*` standalone texture key)
 */
export function addItemIconSprite(x: number, y: number, iconImage?: string | null): Phaser.GameObjects.Sprite {
  // A standalone er_* item is loaded as its OWN texture key - draw it directly.
  if (iconImage != null && globalScene.textures.exists(iconImage)) {
    return globalScene.add.sprite(x, y, iconImage);
  }
  // Otherwise it is a frame within the shared "items" atlas (the vanilla path).
  return globalScene.add.sprite(x, y, "items", iconImage ?? undefined);
}

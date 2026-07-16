/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — N-type display strip (Pass B).
//
// The static preview screens (starter-select, pokedex, pokedex-page) historically
// rendered exactly TWO type badges via `setTypeIcons(type1, type2)`. ER's N-type
// substrate (`setExtraTypes`) means a mon can carry 3..6 types (six = Primal
// Regigigas), so those screens dropped every type past the 2nd.
//
// This lays out an arbitrary number of type badges in a single horizontal strip
// that SHRINKS TO FIT a bounded width:
//   - 2 (or fewer) types keep the exact original placement (scale + stride), so
//     the overwhelming majority of mons render byte-identically.
//   - 3..N tighten the inter-icon stride down toward "touching" first (badges stay
//     full, readable size); only if even touching overflows the budget do the
//     badges shrink uniformly. At the current max of 6, badges fit at full size on
//     every surface. Beyond that it degrades gracefully (uniform shrink) rather
//     than hard-breaking.
//
// The three fixed badge sprites the handlers already own are reused as the first
// icons; icons 3..N are pooled lazily into a per-handler array. Frames come from
// the localized `types` atlas (frame = `PokemonType[t].toLowerCase()`), exactly
// as the original code did.
// =============================================================================

import { globalScene } from "#app/global-scene";
import type { PokemonSpeciesForm } from "#data/pokemon-species";
import { PokemonType } from "#enums/pokemon-type";
import { getLocalizedSpriteKey } from "#utils/common";

/** Native width (px) of a type badge frame in the `types` atlas (32x14). */
const TYPE_BADGE_WIDTH = 32;

/**
 * The full ordered STATIC type list of a species FORM for the preview screens:
 * `[type1, type2?, ...extraTypes]`. `getExtraTypes()` is already deduped against
 * type1/type2, so this never double-counts. Used by the static dex/starter panels
 * (a live Pokemon uses `getTypes()` instead, which folds extras in itself).
 */
export function speciesFormTypes(form: PokemonSpeciesForm): PokemonType[] {
  const types: PokemonType[] = [form.type1];
  if (form.type2 !== null) {
    types.push(form.type2);
  }
  types.push(...form.getExtraTypes());
  return types;
}

export interface TypeIconStripOptions {
  /** Left edge of the first badge (unchanged from the original x of icon1). */
  x0: number;
  /** Baseline y of every badge (unchanged from the original y). */
  y0: number;
  /** Base display scale for 1-2 type mons (the original per-surface scale). */
  baseScale: number;
  /** Base inter-icon stride (px) for 1-2 type mons (the original spacing). */
  baseStride: number;
  /** Max total strip width (px) the surface can spare before badges must shrink. */
  maxWidth: number;
}

/**
 * Lay out `types` as a shrink-to-fit horizontal badge strip.
 *
 * @param container - the container the pooled extra badges are added to.
 * @param icon1 - the first fixed badge sprite (already owned by the handler).
 * @param icon2 - the second fixed badge sprite (already owned by the handler).
 * @param extraPool - a per-handler array of pooled badges for types 3..N (grown here).
 * @param types - the full ordered type list ([] clears the strip).
 * @param opts - per-surface geometry + budget.
 */
export function layoutTypeIconStrip(
  container: Phaser.GameObjects.Container,
  icon1: Phaser.GameObjects.Sprite,
  icon2: Phaser.GameObjects.Sprite,
  extraPool: Phaser.GameObjects.Sprite[],
  types: readonly PokemonType[],
  opts: TypeIconStripOptions,
): void {
  const n = types.length;
  if (n === 0) {
    icon1.setVisible(false);
    icon2.setVisible(false);
    for (const extra of extraPool) {
      extra.setVisible(false);
    }
    return;
  }

  const { x0, y0, baseScale, baseStride, maxWidth } = opts;
  let scale = baseScale;
  let stride = baseStride;
  if (n > 2) {
    const iconWidth = TYPE_BADGE_WIDTH * scale;
    // Tighten the stride so the last badge's LEFT edge lands within the budget.
    const fitStride = (maxWidth - iconWidth) / (n - 1);
    stride = Math.min(baseStride, fitStride);
    if (stride < iconWidth) {
      // Even touching overflows: shrink every badge uniformly so all n fit edge
      // to edge within the budget (graceful degradation past ~7 types).
      scale = maxWidth / (TYPE_BADGE_WIDTH * n);
      stride = TYPE_BADGE_WIDTH * scale;
    }
  }

  const place = (icon: Phaser.GameObjects.Sprite, index: number): void => {
    icon
      .setScale(scale)
      .setOrigin(0, 0)
      .setPosition(x0 + index * stride, y0)
      .setFrame(PokemonType[types[index]].toLowerCase())
      .setVisible(true);
  };

  place(icon1, 0);
  if (n > 1) {
    place(icon2, 1);
  } else {
    icon2.setVisible(false);
  }
  for (let i = 2; i < n; i++) {
    let extra = extraPool[i - 2];
    if (!extra) {
      extra = globalScene.add.sprite(0, 0, getLocalizedSpriteKey("types")).setOrigin(0, 0);
      extraPool[i - 2] = extra;
      container.add(extra);
    }
    place(extra, i);
  }
  for (let i = Math.max(0, n - 2); i < extraPool.length; i++) {
    extraPool[i].setVisible(false);
  }
}

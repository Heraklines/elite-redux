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
/** Native height (px) of a type badge frame in the `types` atlas (32x14). */
const TYPE_BADGE_HEIGHT = 14;
/** At/above this type count, switch from a single row to paired vertical columns. */
const PAIRED_THRESHOLD = 4;

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

/** A single placed badge's geometry. */
export interface TypeIconPlacement {
  x: number;
  y: number;
}

/** The resolved geometry for a strip of `count` type badges. */
export interface TypeIconStripLayout {
  scale: number;
  placements: TypeIconPlacement[];
}

/**
 * PURE geometry for the N-type badge strip (no sprites) - see
 * {@linkcode layoutTypeIconStrip} for the surface-facing renderer and the layout
 * rules. Exposed so the layout can be unit-tested precisely.
 */
export function computeTypeIconStripLayout(count: number, opts: TypeIconStripOptions): TypeIconStripLayout {
  const { x0, y0, baseScale, baseStride, maxWidth } = opts;
  if (count <= 0) {
    return { scale: baseScale, placements: [] };
  }
  const paired = count >= PAIRED_THRESHOLD;
  let scale = baseScale;
  let colStride = baseStride;
  if (paired) {
    const cols = Math.ceil(count / 2);
    const gridWidth = (cols - 1) * baseStride + TYPE_BADGE_WIDTH * scale;
    if (gridWidth > maxWidth) {
      scale = baseScale * (maxWidth / gridWidth);
      colStride = baseStride * (maxWidth / gridWidth);
    }
  }
  const rowStride = TYPE_BADGE_HEIGHT * scale + 1;
  const placements: TypeIconPlacement[] = [];
  for (let i = 0; i < count; i++) {
    const x = paired ? x0 + Math.floor(i / 2) * colStride : x0 + i * colStride;
    const y = paired ? y0 + (i % 2) * rowStride : y0;
    placements.push({ x, y });
  }
  return { scale, placements };
}

/**
 * Lay out `types` as a type-badge strip.
 *
 * - 1-3 types: the ORIGINAL single horizontal row (x0 + i*stride) - the common
 *   case renders byte-identically to the pre-N-type code.
 * - 4+ types (maintainer layout): VERTICAL PAIRS advancing horizontally. Types
 *   1-2 stack in column 0, 3-4 in column 1, 5-6 in column 2, a lone 7th in column
 *   3, and so on (column = floor(i/2), row = i%2). This halves the row length vs a
 *   flat 6/7-wide strip so the badges stay full, readable size and don't cover the
 *   sprite / crowd the name - exactly like the game's own dual-type pair, repeated.
 *   Degrades sanely past that: if the columns would exceed the width budget the
 *   whole grid shrinks uniformly.
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

  const { scale, placements } = computeTypeIconStripLayout(n, opts);

  const place = (icon: Phaser.GameObjects.Sprite, index: number): void => {
    icon
      .setScale(scale)
      .setOrigin(0, 0)
      .setPosition(placements[index].x, placements[index].y)
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

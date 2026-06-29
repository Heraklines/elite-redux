/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux - Community Challenge "Trial Plates" card-art compositor.
//
// The maintainer constraint: NO bespoke per-challenge AI art. Each card image is
// derived DETERMINISTICALLY from the ruleset as a heraldic silhouette plate:
//   - a 2-stop type-coloured tincture ground (dominant type of the challenge),
//   - the challenge's "hero" Pokemon as a BLACK SILHOUETTE (the real icon frame
//     tinted 0x000000 - works for every mon, no pre-baked black art needed),
//   - an accent-tinted rim copy behind it (the purple/cyan glow), and
//   - an ink floor so the silhouette grounds into the plate.
//
// Pure 2D / harness-faithful: a black multiply is pixel-exact even under the
// harness's approximated offscreen-multiply. The richer runtime aura
// (er-shiny-lab FX) is a runtime-only enhancement layered on top later.
//
// `deriveHero()` picks the hero/type from partial config so CREATE can show a
// live plate preview as the creator edits the ruleset.
// =============================================================================

import { globalScene } from "#app/global-scene";
import type { CommunityChallengeConfig, CommunityChallengeEntry } from "#data/elite-redux/er-community-challenges";
import type { PokemonSpecies } from "#data/pokemon-species";
import { getTypeRgb } from "#data/type";
import { PokemonType } from "#enums/pokemon-type";
import { getPokemonSpecies } from "#utils/pokemon-utils";

function hex(rgb: [number, number, number]): number {
  return (rgb[0] << 16) | (rgb[1] << 8) | rgb[2];
}

function scale(rgb: [number, number, number], f: number): [number, number, number] {
  return [
    Math.max(0, Math.min(255, Math.round(rgb[0] * f))),
    Math.max(0, Math.min(255, Math.round(rgb[1] * f))),
    Math.max(0, Math.min(255, Math.round(rgb[2] * f))),
  ];
}

/** The "hero" species + dominant type a plate is built from. */
export interface ChallengeHero {
  readonly species: PokemonSpecies | null;
  readonly type: PokemonType;
}

/**
 * Derive the hero species + dominant type from (possibly partial) config:
 * pinned `art.themeSpeciesId` first, else the highest-BST allowed species, else a
 * generic silhouette. `accentType` overrides the tincture. Pure - drives both the
 * card art and the CREATE live preview.
 */
export function deriveHero(config: Partial<CommunityChallengeConfig>): ChallengeHero {
  let species: PokemonSpecies | null = null;
  const heroId = config.art?.themeSpeciesId;
  if (heroId != null) {
    species = safeSpecies(heroId);
  }
  if (!species && config.allowedSpecies && config.allowedSpecies.length > 0) {
    // Highest-BST allowed species reads as the "face" of a restricted run.
    let best: PokemonSpecies | null = null;
    for (const id of config.allowedSpecies) {
      const s = safeSpecies(id);
      if (s && (!best || s.baseTotal > best.baseTotal)) {
        best = s;
      }
    }
    species = best;
  }
  const type = config.art?.accentType ?? species?.type1 ?? PokemonType.NORMAL;
  return { species, type };
}

function safeSpecies(id: number): PokemonSpecies | null {
  try {
    return getPokemonSpecies(id);
  } catch {
    return null;
  }
}

/**
 * Build a Trial Plate into a container at (x, y) of size w x h. The caller adds
 * the returned container to its own display list. `accent` is the rim glow hex
 * (cyan / magenta) chosen by the caller per selection state.
 */
export function buildChallengeCardArt(
  entry: CommunityChallengeEntry,
  x: number,
  y: number,
  w: number,
  h: number,
  accent = 0x3890f8,
): Phaser.GameObjects.Container {
  const c = globalScene.add.container(x, y);
  const hero = deriveHero(entry.config);
  const base = getTypeRgb(hero.type);

  // 1. Ground tincture: dark floor + a brighter top band (2-stop, no gradient API).
  c.add(globalScene.add.rectangle(0, 0, w, h, hex(scale(base, 0.32)), 1).setOrigin(0));
  c.add(globalScene.add.rectangle(0, 0, w, Math.round(h * 0.6), hex(scale(base, 0.62)), 0.55).setOrigin(0));
  // 2. Ink floor so the silhouette grounds.
  c.add(globalScene.add.rectangle(0, Math.round(h * 0.62), w, h - Math.round(h * 0.62), 0x120f16, 0.7).setOrigin(0));

  // 3. Hero silhouette: the real icon frame, upscaled, tinted pure black. An
  //    accent-tinted offset copy behind it gives the rim glow. Guarded against a
  //    missing icon texture/frame (the Assets rule: never render __MISSING, never
  //    crash) - falls back to a procedural charge so the plate is still themed.
  const cx = w / 2;
  const cy = Math.round(h * 0.6);
  const s = Math.max(0.7, (h * 0.92) / 40); // fit the ~40px icon with a little bleed
  if (hero.species && tryAddSilhouette(c, hero.species, cx, cy, s, accent)) {
    // silhouette added
  } else {
    addFallbackCharge(c, cx, cy, h, accent);
  }

  return c;
}

/**
 * Build the circular "wax-seal" emblem/crest for a challenge into a container
 * centered at (cx, cy) of radius r: a type-tinted disc, a gold ring, and the hero
 * silhouette (or a procedural charge). Used for the card corner badge + the
 * detail-panel crest. `stamped: false` renders an empty seal (the launch state).
 */
export function buildChallengeEmblem(
  entry: CommunityChallengeEntry,
  cx: number,
  cy: number,
  r: number,
  stamped = true,
): Phaser.GameObjects.Container {
  const c = globalScene.add.container(cx, cy);
  const hero = deriveHero(entry.config);
  const base = getTypeRgb(hero.type);
  const accent = 0x3890f8;
  c.add(globalScene.add.circle(0, 0, r, hex(scale(base, stamped ? 0.4 : 0.18)), 1));
  c.add(globalScene.add.circle(0, 0, r).setStrokeStyle(2, 0xc8a24a, 0.9));
  if (!stamped) {
    return c;
  }
  if (!(hero.species && tryAddSilhouette(c, hero.species, 0, 0, Math.max(0.8, (r * 1.7) / 40), accent))) {
    addFallbackCharge(c, 0, 0, r * 2, accent);
  }
  return c;
}

/** True if the hero icon texture+frame are loaded and the silhouette was added. */
function tryAddSilhouette(
  c: Phaser.GameObjects.Container,
  species: PokemonSpecies,
  cx: number,
  cy: number,
  s: number,
  accent: number,
): boolean {
  const key = species.getIconAtlasKey(0, false, 0);
  const frame = String(species.getIconId(false, 0, false, 0));
  const tex = globalScene.textures.exists(key) ? globalScene.textures.get(key) : null;
  if (!tex || tex.key === "__MISSING" || !tex.has(frame)) {
    return false;
  }
  const rim = globalScene.add.sprite(cx, cy, key, frame);
  rim
    .setOrigin(0.5, 0.5)
    .setScale(s * 1.06)
    .setTint(accent)
    .setAlpha(0.55);
  c.add(rim);
  const silo = globalScene.add.sprite(cx, cy, key, frame);
  silo.setOrigin(0.5, 0.5).setScale(s).setTint(0x000000);
  c.add(silo);
  return true;
}

/**
 * Add a COLOURED Pokemon icon (the real party icon) centered in a `size` cell at
 * (x, y) into `container`, guarded against a missing texture/frame. Falls back to
 * a dark placeholder square (the Assets rule) - which is also the harness render,
 * since the pokemon_icons atlases aren't injected into the offscreen canvas.
 */
export function addPokemonIcon(
  container: Phaser.GameObjects.Container,
  speciesId: number,
  x: number,
  y: number,
  size: number,
): void {
  const species = safeSpecies(speciesId);
  if (species) {
    const key = species.getIconAtlasKey(0, false, 0);
    const frame = String(species.getIconId(false, 0, false, 0));
    const tex = globalScene.textures.exists(key) ? globalScene.textures.get(key) : null;
    if (tex && tex.key !== "__MISSING" && tex.has(frame)) {
      const icon = globalScene.add.sprite(x + size / 2, y + size / 2, key, frame);
      // The party icon frame is ~40px; fit it to the cell with a touch of bleed.
      icon.setOrigin(0.5, 0.5).setScale((size / 40) * 1.5);
      container.add(icon);
      return;
    }
  }
  container.add(globalScene.add.rectangle(x, y, size, size, 0x1c2236, 1).setOrigin(0).setStrokeStyle(1, 0x2a3450, 0.6));
}

/** A procedural heraldic charge (diamond + ring) when no icon resolves. */
function addFallbackCharge(c: Phaser.GameObjects.Container, cx: number, cy: number, h: number, accent: number): void {
  const r = Math.round(h * 0.3);
  c.add(globalScene.add.circle(cx, cy, r, 0x100c14, 0.85));
  c.add(globalScene.add.circle(cx, cy, r).setStrokeStyle(1, accent, 0.5));
  const d = globalScene.add.rectangle(cx, cy, r, r, 0x05050a, 0.9).setAngle(45);
  d.setStrokeStyle(1, accent, 0.7);
  c.add(d);
}

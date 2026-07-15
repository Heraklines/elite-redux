/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — authored frame-rate for MULTI-FRAME custom "GIF" sprite atlases.
//
// The engine builds EVERY pokemon battle animation the same way: enumerate the
// atlas frames 0001.png..0400.png and `anims.create({ frameRate: 10, repeat: -1 })`
// (see PokemonSpeciesForm.loadAssets / Pokemon.loadAssets). So a multi-frame ER
// custom atlas already PLAYS in battle with ZERO extra wiring — the moment its
// atlas ships more than one frame it loops at 10 fps, exactly like vanilla.
//
// The ONE thing the shared path can't express is a NON-10 fps authored cadence.
// A baked GIF (e.g. Regitube's idle at 116.7 ms/frame ≈ 8.57 fps) would otherwise
// play slightly too fast. This module lets an atlas OPT IN to its own cadence by
// carrying it in the atlas JSON; the value rides along on Phaser's
// `Texture.customData` (Phaser copies every non-`frames` top-level JSON key there,
// see textures/parsers/JSONHash.js). It is a strict NO-OP when the field is
// absent, so vanilla sprites and every existing single-frame ER custom render
// byte-for-byte as before.
//
// Contract — the atlas JSON MAY carry a top-level `animation` block:
//   { "frames": { "0001.png": {…}, … "0020.png": {…} },
//     "animation": { "frameRate": 8.571, "loop": true } }
// `frameRate` (fps) wins; else a uniform `durations_ms` array (ms/frame) is
// averaged to fps. `frameRate`/`durations_ms` at the JSON ROOT are also accepted.
// =============================================================================

/** Coerce to a finite, strictly-positive number, else undefined. */
function positiveNumber(value: unknown): number | undefined {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

/**
 * Derive the authored animation frame rate (fps) from a pokemon atlas's Phaser
 * `Texture.customData`, or `undefined` when the atlas carries no cadence (the
 * default — the caller then keeps the engine's uniform 10 fps).
 */
export function erAtlasFrameRate(customData: unknown): number | undefined {
  if (customData == null || typeof customData !== "object") {
    return undefined;
  }
  const root = customData as Record<string, unknown>;
  const animationValue = root.animation;
  const animation =
    animationValue != null && typeof animationValue === "object"
      ? (animationValue as Record<string, unknown>)
      : undefined;

  const explicit = positiveNumber(animation?.frameRate) ?? positiveNumber(root.frameRate);
  if (explicit != null) {
    return explicit;
  }

  const durations = animation?.durations_ms ?? root.durations_ms;
  if (Array.isArray(durations) && durations.length > 0) {
    let sum = 0;
    let count = 0;
    for (const d of durations) {
      const ms = positiveNumber(d);
      if (ms != null) {
        sum += ms;
        count++;
      }
    }
    if (count > 0) {
      return positiveNumber(1000 / (sum / count));
    }
  }
  return undefined;
}

/**
 * Retune a freshly-built pokemon battle animation to its atlas's AUTHORED frame
 * rate, if any. Mirrors {@linkcode Pokemon.setFrameRate}: set the animation's
 * `frameRate`; the subsequent `sprite.play(key)` recomputes `msPerFrame` from it
 * (Phaser AnimationState.startAnimation). A strict no-op when the animation is
 * missing or the atlas carries no cadence, so single-frame / vanilla atlases are
 * unchanged.
 */
export function applyErAtlasFrameRate(
  anims: Phaser.Animations.AnimationManager,
  spriteKey: string,
  customData: unknown,
): void {
  const fps = erAtlasFrameRate(customData);
  if (fps == null) {
    return;
  }
  const anim = anims.get(spriteKey);
  if (anim) {
    anim.frameRate = fps;
  }
}

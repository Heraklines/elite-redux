/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux - per-type TRANSFORM burst FX (partner / Omniform evolutions).
//
// The vanilla mid-battle form change (QuietFormChangePhase) flashes the sprite
// WHITE and swaps it. For a partner evolution we want something better and
// GENERIC: a brief (~1s) burst tinted by the TARGET evolution's PRIMARY type
// colour plus a handful of small type-themed particles (grass -> green light +
// drifting leaves, electric -> spark jitter, water -> falling droplets, fire ->
// rising embers, else generic motes). Every current and future evolution gets
// it automatically from the target form's primary type; no per-species art.
//
// Design (data-driven, in the direction of the Shiny Lab aura vocabulary but
// compressed into a single burst):
//   - One PER-TYPE config table (`getErTransformTypeFx`) maps a `PokemonType` to
//     { tint rgb (the canonical `getTypeRgb` colour), particle shape, motion,
//     bounded count, spin/spread/size }. A fallback covers UNKNOWN / STELLAR /
//     out-of-range so EVERY type yields a valid config.
//   - ONE generic particle implementation renders that config with a handful of
//     distinct primitive shapes (ellipse / rectangle) - no bespoke system per
//     type, no new textures/CDN assets.
//   - A tinted additive LIGHT flash (bright core + soft halo + expanding ring)
//     carries the "type-coloured light".
//
// Perf / lifecycle:
//   - Effect <= ~1s, particle count bounded (<= `ER_TRANSFORM_FX_MAX_PARTICLES`).
//   - Every tween is declarative (computed ONCE at spawn) - no per-frame alloc.
//   - Purely VISUAL randomness uses `Math.random`, never the seeded battle RNG,
//     so it can never advance the roll cursor / desync co-op.
//   - Every game object / timer is owned by the scene. The instance keeps a
//     single self-terminating teardown timer (NOT a loop - the ErShinyLabNameFx
//     leak lesson, commit e79ed2343) and a `destroy()` that kills tweens +
//     destroys every object; `destroy()` is called from that owning timer on
//     completion and is idempotent + safe to call early (scene/sprite teardown).
//   - Headless-safe: the test mocks stub the shape factories + fire tweens'
//     `onComplete` immediately, so the burst self-completes with no hang.
// =============================================================================

import { globalScene } from "#app/global-scene";
import { getTypeRgb } from "#data/type";
import { PokemonType } from "#enums/pokemon-type";
import type { Pokemon } from "#field/pokemon";
import { readErShinyLabSpriteSourcePixels } from "#sprites/er-shiny-lab-sprite-fx";

/** Total lifetime of the burst; the effect is fully torn down after this. */
export const ER_TRANSFORM_FX_TOTAL_MS = 950;

/** Hard cap on discrete particles spawned per burst (bounded-count contract). */
export const ER_TRANSFORM_FX_MAX_PARTICLES = 20;

/** Depth applied to the burst objects so they draw above the field sprites. */
const ER_TRANSFORM_FX_DEPTH = 200;

/** The primitive shape a particle is drawn with. */
export type ErTransformParticleShape = "leaf" | "droplet" | "ember" | "mote" | "spark" | "shard";

/** How a particle travels over its lifetime. */
export type ErTransformParticleMotion = "rise" | "fall" | "burst" | "sway";

/** A resolved, renderable per-type transform-FX config. */
export interface ErTransformTypeFx {
  /** Light + particle tint (canonical type colour). */
  rgb: [number, number, number];
  shape: ErTransformParticleShape;
  motion: ErTransformParticleMotion;
  /** Particle count (always in `(0, ER_TRANSFORM_FX_MAX_PARTICLES]`). */
  count: number;
  /** Total spin over the particle lifetime, in degrees. */
  spin: number;
  /** Radial travel distance in field units. */
  spread: number;
  /** Base particle size in field units. */
  size: number;
}

/** The shape/motion preset half of a config (tint is derived from the type separately). */
type ErTransformFxPreset = Omit<ErTransformTypeFx, "rgb">;

/** Fallback preset for UNKNOWN / STELLAR / any unmapped type: neutral motes. */
const FALLBACK_PRESET: ErTransformFxPreset = {
  shape: "mote",
  motion: "burst",
  count: 14,
  spin: 0,
  spread: 42,
  size: 5,
};

/**
 * Per-type presets. Types not listed fall back to {@linkcode FALLBACK_PRESET}.
 * Shapes/motions reuse a small shared vocabulary (leaves drift, embers rise,
 * droplets fall, sparks jitter out, shards settle, motes float) rather than a
 * bespoke system per type.
 */
const TYPE_FX_PRESETS: Partial<Record<PokemonType, ErTransformFxPreset>> = {
  [PokemonType.GRASS]: { shape: "leaf", motion: "sway", count: 14, spin: 220, spread: 46, size: 6 },
  [PokemonType.BUG]: { shape: "leaf", motion: "sway", count: 14, spin: 200, spread: 44, size: 5 },
  [PokemonType.FLYING]: { shape: "leaf", motion: "rise", count: 14, spin: 160, spread: 48, size: 6 },
  [PokemonType.FIRE]: { shape: "ember", motion: "rise", count: 16, spin: 60, spread: 40, size: 5 },
  [PokemonType.WATER]: { shape: "droplet", motion: "fall", count: 16, spin: 40, spread: 44, size: 5 },
  [PokemonType.ICE]: { shape: "shard", motion: "fall", count: 14, spin: 90, spread: 42, size: 5 },
  [PokemonType.ELECTRIC]: { shape: "spark", motion: "burst", count: 18, spin: 0, spread: 52, size: 6 },
  [PokemonType.STEEL]: { shape: "shard", motion: "burst", count: 14, spin: 120, spread: 46, size: 5 },
  [PokemonType.ROCK]: { shape: "shard", motion: "burst", count: 14, spin: 140, spread: 44, size: 6 },
  [PokemonType.GROUND]: { shape: "shard", motion: "fall", count: 14, spin: 80, spread: 42, size: 6 },
  [PokemonType.POISON]: { shape: "mote", motion: "rise", count: 15, spin: 40, spread: 40, size: 5 },
  [PokemonType.FAIRY]: { shape: "mote", motion: "sway", count: 16, spin: 120, spread: 44, size: 5 },
  [PokemonType.PSYCHIC]: { shape: "mote", motion: "burst", count: 16, spin: 60, spread: 48, size: 5 },
  [PokemonType.GHOST]: { shape: "mote", motion: "rise", count: 14, spin: 60, spread: 42, size: 5 },
  [PokemonType.DARK]: { shape: "mote", motion: "burst", count: 14, spin: 40, spread: 42, size: 5 },
  [PokemonType.DRAGON]: { shape: "spark", motion: "burst", count: 16, spin: 20, spread: 50, size: 6 },
  [PokemonType.FIGHTING]: { shape: "spark", motion: "burst", count: 15, spin: 20, spread: 46, size: 5 },
  [PokemonType.NORMAL]: { shape: "mote", motion: "burst", count: 14, spin: 0, spread: 42, size: 5 },
};

/**
 * The canonical light tint for a type. `getTypeRgb` returns black `[0,0,0]` for
 * UNKNOWN / out-of-range, which would render an invisible "light" - fall back to
 * white so the flash always reads. STELLAR is already white there.
 */
function transformTintRgb(type: PokemonType): [number, number, number] {
  const rgb = getTypeRgb(type);
  if (rgb[0] === 0 && rgb[1] === 0 && rgb[2] === 0) {
    return [255, 255, 255];
  }
  return rgb;
}

/**
 * Resolve the per-type transform-FX config. Total function: every `PokemonType`
 * (and every out-of-range numeric value) yields a valid, bounded config with a
 * visible tint. Pure - safe to unit-test without a scene.
 */
export function getErTransformTypeFx(type: PokemonType): ErTransformTypeFx {
  const preset = TYPE_FX_PRESETS[type] ?? FALLBACK_PRESET;
  const count = Math.max(1, Math.min(ER_TRANSFORM_FX_MAX_PARTICLES, preset.count));
  return { rgb: transformTintRgb(type), ...preset, count };
}

/** Pack an rgb triple into a Phaser `0xRRGGBB` colour int. */
function rgbToInt([r, g, b]: [number, number, number]): number {
  return ((r & 0xff) << 16) | ((g & 0xff) << 8) | (b & 0xff);
}

/**
 * Owns one transform burst: a tinted light flash plus a bounded, type-themed
 * particle cloud, all scene-owned and torn down together after
 * {@linkcode ER_TRANSFORM_FX_TOTAL_MS}. Fire-and-forget: construct via
 * {@linkcode playErTransformFx}; it self-destructs on completion.
 */
export class ErFormTransformFx {
  private readonly objects: Phaser.GameObjects.GameObject[] = [];
  private teardown: Phaser.Time.TimerEvent | null = null;
  private destroyed = false;

  constructor(pokemon: Pokemon, type: PokemonType) {
    const config = getErTransformTypeFx(type);
    const color = rgbToInt(config.rgb);

    const sprite = pokemon.getSprite();
    // Field-local anchor: the same basis QuietFormChangePhase uses for its tint
    // sprites (pokemon position + the sprite's in-container offset). Nudge up
    // toward the body centre so the burst is centred on the mon, not its feet.
    const anchorX = pokemon.x + (sprite?.x ?? 0);
    const anchorY = pokemon.y + (sprite?.y ?? 0) - 26;

    this.buildFlash(anchorX, anchorY, color);
    this.buildParticles(anchorX, anchorY, color, config);

    // Single self-terminating teardown (NOT a loop): the owning timer calls
    // destroy() once the burst is over. destroy() is idempotent, so an earlier
    // scene/sprite teardown that also calls it is harmless.
    this.teardown = globalScene.time.delayedCall(ER_TRANSFORM_FX_TOTAL_MS, () => this.destroy());
  }

  /** Register a freshly-created object under this burst and parent it to the field. */
  private track<T extends Phaser.GameObjects.GameObject>(obj: T): T {
    (obj as unknown as { setDepth?: (d: number) => unknown }).setDepth?.(ER_TRANSFORM_FX_DEPTH);
    globalScene.field.add(obj);
    this.objects.push(obj);
    return obj;
  }

  /** An additive-blended shape (soft light look); shapes fall back gracefully if a method is stubbed. */
  private addGlow(
    x: number,
    y: number,
    w: number,
    h: number,
    color: number,
    alpha: number,
  ): Phaser.GameObjects.Ellipse {
    const glow = globalScene.add.ellipse(x, y, w, h, color, alpha);
    glow.setBlendMode(Phaser.BlendModes.ADD);
    return this.track(glow);
  }

  /** Bright core + soft halo + an expanding ring = the type-tinted light flash. */
  private buildFlash(x: number, y: number, color: number): void {
    const core = this.addGlow(x, y, 46, 46, color, 0.95).setScale(0.45);
    globalScene.tweens.add({ targets: core, scale: 1.25, alpha: 0, duration: 480, ease: "Quad.easeOut" });

    const halo = this.addGlow(x, y, 74, 74, color, 0.5).setScale(0.7);
    globalScene.tweens.add({ targets: halo, scale: 2.0, alpha: 0, duration: 680, ease: "Quad.easeOut" });

    const ring = globalScene.add.ellipse(x, y, 30, 30, color, 0);
    ring.setBlendMode(Phaser.BlendModes.ADD).setStrokeStyle(3, color, 0.9).setScale(0.35);
    this.track(ring);
    globalScene.tweens.add({ targets: ring, scale: 2.3, alpha: 0, duration: 560, ease: "Cubic.easeOut" });
  }

  /** Spawn the bounded, type-themed particle cloud. */
  private buildParticles(x: number, y: number, color: number, config: ErTransformTypeFx): void {
    const twoPi = Math.PI * 2;
    for (let i = 0; i < config.count; i++) {
      // Even angular spread with a little jitter so the cloud is not a fan.
      const angle = (i / config.count) * twoPi + (Math.random() - 0.5) * 0.9;
      const dist = config.spread * (0.55 + Math.random() * 0.7);
      const particle = this.makeParticle(x, y, color, config, angle);
      this.animateParticle(particle, x, y, angle, dist, config, i);
    }
  }

  /** Create one particle primitive sized/shaped per the config. */
  private makeParticle(
    x: number,
    y: number,
    color: number,
    config: ErTransformTypeFx,
    angle: number,
  ): Phaser.GameObjects.GameObject {
    const s = config.size;
    let obj: Phaser.GameObjects.GameObject;
    switch (config.shape) {
      case "leaf":
        obj = globalScene.add.ellipse(x, y, s * 1.7, s * 0.75, color);
        break;
      case "droplet":
        obj = globalScene.add.ellipse(x, y, s * 0.8, s * 1.4, color);
        break;
      case "ember":
      case "mote":
        obj = globalScene.add.ellipse(x, y, s, s, color);
        break;
      case "spark":
        obj = globalScene.add.rectangle(x, y, s * 0.5, s * 1.7, color);
        break;
      case "shard":
        // A small square rotated 45deg reads as a crystalline diamond.
        obj = globalScene.add.rectangle(x, y, s, s, color);
        (obj as Phaser.GameObjects.Rectangle).setAngle(45);
        break;
    }
    (obj as unknown as { setBlendMode?: (m: number) => unknown }).setBlendMode?.(Phaser.BlendModes.ADD);
    // Orient streak-like shapes along their travel direction.
    if (config.shape === "spark" || config.shape === "droplet") {
      (obj as Phaser.GameObjects.Rectangle).setAngle((angle * 180) / Math.PI + 90);
    }
    return this.track(obj);
  }

  /** Attach the ONE declarative motion tween for a particle (no per-frame work). */
  private animateParticle(
    particle: Phaser.GameObjects.GameObject,
    x: number,
    y: number,
    angle: number,
    dist: number,
    config: ErTransformTypeFx,
    index: number,
  ): void {
    let dx = Math.cos(angle) * dist;
    let dy = Math.sin(angle) * dist;
    let ease = "Cubic.easeOut";
    let duration = 620;

    switch (config.motion) {
      case "rise":
        // Mostly upward with a gentle horizontal drift.
        dx *= 0.6;
        dy = -Math.abs(dy) * 0.7 - dist * 0.5;
        ease = "Sine.easeOut";
        duration = 720;
        break;
      case "fall":
        // Slight lift then accelerate downward.
        dx *= 0.6;
        dy = Math.abs(dy) * 0.6 + dist * 0.7;
        ease = "Quad.easeIn";
        duration = 700;
        break;
      case "sway":
        // Buoyant leaves: rise with a wider horizontal sway.
        dx *= 1.15;
        dy = -Math.abs(dy) * 0.5 - dist * 0.35;
        ease = "Sine.easeOut";
        duration = 760;
        break;
      case "burst":
        ease = "Cubic.easeOut";
        duration = 560;
        break;
    }

    const tween: Record<string, unknown> = {
      targets: particle,
      x: x + dx,
      y: y + dy,
      alpha: 0,
      scale: 0.35,
      duration,
      delay: (index % 4) * 28,
      ease,
    };
    if (config.spin !== 0) {
      tween.angle = `+=${config.spin}`;
    }
    globalScene.tweens.add(tween as Phaser.Types.Tweens.TweenBuilderConfig);
  }

  /**
   * Tear the burst down: stop the teardown timer, kill every tween, destroy
   * every object. Idempotent and safe to call at any time (including a scene or
   * sprite teardown mid-burst).
   */
  destroy(): void {
    if (this.destroyed) {
      return;
    }
    this.destroyed = true;
    if (this.teardown) {
      this.teardown.remove(false);
      this.teardown = null;
    }
    for (const obj of this.objects) {
      globalScene.tweens.killTweensOf(obj);
      obj.destroy();
    }
    this.objects.length = 0;
  }
}

/**
 * Play the per-type transform burst on `pokemon`, themed by `targetType` (the
 * primary type of the evolution it is becoming). Fire-and-forget: the returned
 * instance self-destructs after {@linkcode ER_TRANSFORM_FX_TOTAL_MS}; callers may
 * hold it to force an earlier {@linkcode ErFormTransformFx.destroy}. Never
 * throws (visual-only, fail-closed) so it is safe on the transform hot path.
 */
export function playErTransformFx(pokemon: Pokemon, targetType: PokemonType): ErFormTransformFx | null {
  try {
    return new ErFormTransformFx(pokemon, targetType);
  } catch (err: unknown) {
    console.error("Failed to play ER transform FX", err);
    return null;
  }
}

// =============================================================================
// FULL transform SEQUENCE (fill -> shape morph -> reveal + burst).
//
// The burst above is the REVEAL stage of a longer sequence, ported from the
// maintainer-approved Shiny Lab preview (shiny-lab/site/effects.mjs). The full
// arc, when a partner / Omniform mon transforms or reverts:
//   1) FILL  (~480ms): the source sprite fades out as a TARGET-type-coloured
//      glowing silhouette floods in, until the body is a solid glowing shape.
//   2) MORPH (~760ms): that silhouette's SHAPE flows from the source form's
//      outline into the target form's outline via a signed-distance-field
//      interpolation (a real shape morph, NOT a crossfade). The SDF is built
//      with the same two-pass (1, sqrt2) chamfer the site uses.
//   3) REVEAL + BURST: the per-type {@linkcode ErFormTransformFx} burst fires as
//      the glow drains and the real (already-swapped, under the glow) target
//      sprite is revealed underneath.
//
// TIMING CONTRACT (the maintainer-reported late-swap fix): the FILL starts
// immediately (it needs no target texture); the caller-supplied `onSwap`
// (loadAssets + updateInfo) is awaited DURING fill/morph so the real sprite is
// swapped to the target form UNDER the glow; the reveal then drains onto the
// already-swapped real sprite. If assets are not ready when the morph ends the
// silhouette holds briefly (cap ~1s) then fails OPEN (reveal + burst, no drain).
//
// FAIL-CLOSED: if pixel data or the canvas-texture API is unavailable (headless
// mocks, missing frames), the sequence degrades to the CURRENT burst-only
// behaviour (`playErTransformFx`) while still driving `onSwap`. Never throws,
// never stalls a phase (purely visual; orchestrated by the scene time event, the
// battle phase flow is never awaited on it).
//
// LIFECYCLE: mirrors the burst's leak-safe discipline (the ErShinyLabNameFx
// timer-leak lesson) - ONE looping time event + ONE safety delayed call, both
// removed in an idempotent teardown that also destroys the generated canvas
// texture and restores the real sprite. Purely-visual randomness stays inside
// the burst (`Math.random`), never the battle RNG.
// =============================================================================

/** FILL stage duration: source fades out, the glowing silhouette floods in. */
export const ER_TRANSFORM_MORPH_FILL_MS = 480;
/** MORPH stage duration: the silhouette flows source shape -> target shape. */
export const ER_TRANSFORM_MORPH_MORPH_MS = 760;
/** DRAIN duration: how long the solid glow drains to reveal the target sprite. */
export const ER_TRANSFORM_MORPH_DRAIN_MS = 360;
/** Max EXTRA time the silhouette holds waiting on `onSwap` before failing open. */
export const ER_TRANSFORM_MORPH_HOLD_CAP_MS = 1000;
/** Padding (px) around the sprite grid so the glow rim never clips the texture. */
const ER_TRANSFORM_MORPH_PAD = 72;
/** Depth of the morph silhouette: above the field sprites, below the burst. */
const ER_TRANSFORM_MORPH_DEPTH = ER_TRANSFORM_FX_DEPTH - 10;
/** Frame cadence of the morph driver (ms); the real Phaser clock steps it live. */
const ER_TRANSFORM_MORPH_TICK_MS = 16;

/** Result of building a centroid-aligned silhouette mask on a common grid. */
export interface ErTransformMask {
  /** 1 inside the silhouette, 0 outside, row-major on the `W x H` grid. */
  mask: Uint8Array;
  /** X offset the sprite was drawn at to centroid-align it on the grid. */
  offX: number;
  /** Y offset the sprite was drawn at to centroid-align it on the grid. */
  offY: number;
  /** Number of opaque source pixels (0 = an empty silhouette; fail closed). */
  count: number;
}

/** Smoothstep on [0,1] (matches the site's `fxSmooth`). */
function erTransformSmooth(t: number): number {
  return t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t);
}

/** Quadratic ease-out (matches Phaser `Quad.easeOut` / the site's `quadOut`). */
function erTransformQuadOut(t: number): number {
  const c = t <= 0 ? 0 : t >= 1 ? 1 : t;
  return 1 - (1 - c) * (1 - c);
}

/**
 * Two-pass (1, sqrt2) chamfer distance transform, IN PLACE. Seeds are `0` /
 * `INF`; the result at each cell is the pixel distance to the nearest seed. The
 * same sweep the site's `fxChamfer` (and fx.mjs `computeDist`) runs. Pure.
 */
export function erTransformChamfer(d: Float32Array, W: number, H: number): void {
  const A = 1;
  const B = Math.SQRT2;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let v = d[y * W + x];
      if (x > 0) {
        v = Math.min(v, d[y * W + x - 1] + A);
      }
      if (y > 0) {
        v = Math.min(v, d[(y - 1) * W + x] + A);
      }
      if (x > 0 && y > 0) {
        v = Math.min(v, d[(y - 1) * W + x - 1] + B);
      }
      if (x < W - 1 && y > 0) {
        v = Math.min(v, d[(y - 1) * W + x + 1] + B);
      }
      d[y * W + x] = v;
    }
  }
  for (let y = H - 1; y >= 0; y--) {
    for (let x = W - 1; x >= 0; x--) {
      let v = d[y * W + x];
      if (x < W - 1) {
        v = Math.min(v, d[y * W + x + 1] + A);
      }
      if (y < H - 1) {
        v = Math.min(v, d[(y + 1) * W + x] + A);
      }
      if (x < W - 1 && y < H - 1) {
        v = Math.min(v, d[(y + 1) * W + x + 1] + B);
      }
      if (x > 0 && y < H - 1) {
        v = Math.min(v, d[(y + 1) * W + x - 1] + B);
      }
      d[y * W + x] = v;
    }
  }
}

/**
 * Signed distance field of a boolean mask: negative INSIDE the silhouette,
 * positive OUTSIDE, ~0 on the edge (`outsideDist - insideDist`, each one chamfer
 * pass). Interpolating two SDFs and thresholding at 0 is a TRUE shape morph, not
 * a crossfade. Port of the site's `fxSignedDT`. Pure.
 */
export function erTransformSignedDt(mask: Uint8Array, W: number, H: number): Float32Array {
  const INF = 1e6;
  const N = W * H;
  const dOut = new Float32Array(N);
  const dIn = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    dOut[i] = mask[i] ? 0 : INF;
    dIn[i] = mask[i] ? INF : 0;
  }
  erTransformChamfer(dOut, W, H);
  erTransformChamfer(dIn, W, H);
  const sdf = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    sdf[i] = dOut[i] - dIn[i];
  }
  return sdf;
}

/**
 * Build a boolean silhouette mask of a `w x h` RGBA buffer onto a common
 * `W x H` grid, centred by the silhouette's centroid so the source and target
 * masses line up (the morph looks like a shape flow, not a slide). Port of the
 * site's `fxBuildMask`. Pure - takes raw pixel data, no scene.
 */
export function erTransformBuildMask(
  data: ArrayLike<number>,
  w: number,
  h: number,
  W: number,
  H: number,
): ErTransformMask {
  let sx = 0;
  let sy = 0;
  let c = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (data[(y * w + x) * 4 + 3] > 40) {
        sx += x;
        sy += y;
        c++;
      }
    }
  }
  const cxs = c ? sx / c : w / 2;
  const cys = c ? sy / c : h / 2;
  const offX = Math.round(W / 2 - cxs);
  const offY = Math.round(H / 2 - cys);
  const mask = new Uint8Array(W * H);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (data[(y * w + x) * 4 + 3] > 40) {
        const X = x + offX;
        const Y = y + offY;
        if (X >= 0 && Y >= 0 && X < W && Y < H) {
          mask[Y * W + X] = 1;
        }
      }
    }
  }
  return { mask, offX, offY, count: c };
}

/** A caller hook that swaps the real sprite/info to the target form under the glow. */
export interface ErTransformMorphOptions {
  /**
   * Perform the real sprite + info swap (typically `loadAssets` + `updateInfo`).
   * Awaited DURING the fill/morph so the swap lands under the glow. May be sync
   * or async; its rejection is caught (the sequence fails open, never throws).
   */
  onSwap: () => Promise<void> | void;
}

/** A running transform sequence. `mode` records which path actually engaged. */
export interface ErTransformSequence {
  /** `"morph"` = the full fill/morph/reveal engaged; `"burst"` = fail-closed burst-only. */
  readonly mode: "morph" | "burst";
  /** Idempotent teardown; safe to call at any time (scene/sprite teardown). */
  destroy(): void;
}

/** Minimal shape of a Phaser `CanvasTexture` we depend on (feature-detected). */
interface CanvasTextureLike {
  context: CanvasRenderingContext2D;
  refresh(): void;
}

/**
 * Owns one full transform sequence: a per-frame canvas-texture silhouette (fill
 * + SDF morph + drain) over the real sprite, coordinating the async `onSwap` and
 * firing the per-type burst at the reveal. Construct via
 * {@linkcode playErTransformMorph}; {@linkcode ErFormTransformMorph.tryCreate}
 * returns null (WITHOUT touching `onSwap`) when the environment can't render it,
 * so the caller can fail closed cleanly.
 */
class ErFormTransformMorph implements ErTransformSequence {
  readonly mode = "morph" as const;

  private readonly pokemon: Pokemon;
  private readonly type: PokemonType;
  private readonly onSwap: () => Promise<void> | void;
  private readonly color: [number, number, number];

  private readonly MW: number;
  private readonly MH: number;
  private readonly sdfSrc: Float32Array;
  private sdfTgt: Float32Array | null = null;

  private readonly textureKey: string;
  private readonly tex: CanvasTextureLike;
  private readonly texCtx: CanvasRenderingContext2D;
  private readonly image: Phaser.GameObjects.Image;
  private readonly morphCanvas: HTMLCanvasElement;
  private readonly morphCtx: CanvasRenderingContext2D;
  private readonly morphImg: ImageData;

  private readonly startNow: number;
  private loop: Phaser.Time.TimerEvent | null = null;
  private safety: Phaser.Time.TimerEvent | null = null;

  private ready = false;
  private readyFailed = false;
  private readyAtMs = 0;
  private burst: ErFormTransformFx | null = null;
  private burstFired = false;
  private revealStart = 0;
  private destroyed = false;

  private constructor(
    pokemon: Pokemon,
    type: PokemonType,
    onSwap: () => Promise<void> | void,
    color: [number, number, number],
    build: {
      MW: number;
      MH: number;
      sdfSrc: Float32Array;
      textureKey: string;
      tex: CanvasTextureLike;
      image: Phaser.GameObjects.Image;
      morphCanvas: HTMLCanvasElement;
      morphCtx: CanvasRenderingContext2D;
      morphImg: ImageData;
    },
  ) {
    this.pokemon = pokemon;
    this.type = type;
    this.onSwap = onSwap;
    this.color = color;
    this.MW = build.MW;
    this.MH = build.MH;
    this.sdfSrc = build.sdfSrc;
    this.textureKey = build.textureKey;
    this.tex = build.tex;
    this.texCtx = build.tex.context;
    this.image = build.image;
    this.morphCanvas = build.morphCanvas;
    this.morphCtx = build.morphCtx;
    this.morphImg = build.morphImg;
    this.startNow = globalScene.time.now;

    // Kick the sprite swap immediately; it resolves UNDER the glow. Its result
    // (or failure) only gates the reveal - the phase flow never awaits it.
    Promise.resolve()
      .then(() => this.onSwap())
      .then(() => this.onSwapResolved())
      .catch((err: unknown) => {
        console.error("ER transform morph onSwap failed", err);
        this.readyFailed = true;
      });

    this.loop = globalScene.time.addEvent({
      delay: ER_TRANSFORM_MORPH_TICK_MS,
      loop: true,
      callback: () => this.tick(),
    });
    // Absolute backstop so the visual always tears down even if the loop stops.
    const maxLife =
      ER_TRANSFORM_MORPH_FILL_MS
      + ER_TRANSFORM_MORPH_HOLD_CAP_MS
      + ER_TRANSFORM_MORPH_MORPH_MS
      + ER_TRANSFORM_MORPH_DRAIN_MS
      + 400;
    this.safety = globalScene.time.delayedCall(maxLife, () => this.teardownVisual());
  }

  /**
   * Build a sequence, or return null (WITHOUT invoking `onSwap`) if the runtime
   * can't render it - missing canvas API, no pixel data, or an empty silhouette.
   * Never throws.
   */
  static tryCreate(
    pokemon: Pokemon,
    type: PokemonType,
    onSwap: () => Promise<void> | void,
  ): ErFormTransformMorph | null {
    try {
      if (typeof document === "undefined") {
        return null;
      }
      const textures = globalScene.textures as Phaser.Textures.TextureManager & {
        createCanvas?: (key: string, width: number, height: number) => CanvasTextureLike | null;
      };
      if (typeof textures.createCanvas !== "function") {
        return null;
      }
      const sprite = pokemon.getSprite?.();
      const sourceKey = sprite?.texture?.key;
      if (!sprite || !sourceKey) {
        return null;
      }
      const srcPix = readErShinyLabSpriteSourcePixels({ key: sourceKey, frame: sprite.frame?.name });
      if (!srcPix) {
        return null;
      }
      const w = srcPix.width;
      const h = srcPix.height;
      if (w <= 0 || h <= 0) {
        return null;
      }
      const MW = w + 2 * ER_TRANSFORM_MORPH_PAD;
      const MH = h + 2 * ER_TRANSFORM_MORPH_PAD;
      const fm = erTransformBuildMask(srcPix.data, w, h, MW, MH);
      if (fm.count === 0) {
        return null;
      }
      const sdfSrc = erTransformSignedDt(fm.mask, MW, MH);

      const morphCanvas = document.createElement("canvas");
      morphCanvas.width = MW;
      morphCanvas.height = MH;
      const morphCtx = morphCanvas.getContext("2d", { willReadFrequently: true });
      if (!morphCtx) {
        return null;
      }
      const morphImg = morphCtx.createImageData(MW, MH);

      const textureKey = erTransformNextTextureKey(pokemon);
      const tex = textures.createCanvas?.(textureKey, MW, MH) ?? null;
      if (!tex?.context) {
        return null;
      }

      // Position the morph texture so the source silhouette overlays the real
      // sprite exactly: the sprite draws its frame at origin (0.5, 1) at
      // (pokemon.x, pokemon.y); the source's origin point in the grid is
      // (offX + 0.5w, offY + h), so that fraction becomes the image origin.
      const originX = (fm.offX + 0.5 * w) / MW;
      const originY = (fm.offY + 1.0 * h) / MH;
      const scale = pokemon.getSpriteScale?.() ?? 1;
      const px = pokemon.x + (sprite.x ?? 0);
      const py = pokemon.y + (sprite.y ?? 0);
      const image = globalScene.add
        .image(px, py, textureKey)
        .setOrigin(originX, originY)
        .setScale(scale)
        .setDepth(ER_TRANSFORM_MORPH_DEPTH);
      globalScene.field.add(image);

      const color = transformTintRgb(type);
      return new ErFormTransformMorph(pokemon, type, onSwap, color, {
        MW,
        MH,
        sdfSrc,
        textureKey,
        tex,
        image,
        morphCanvas,
        morphCtx,
        morphImg,
      });
    } catch (err: unknown) {
      console.error("Failed to build ER transform morph", err);
      return null;
    }
  }

  /** Capture the (now-swapped) target silhouette; gate the reveal on success. */
  private onSwapResolved(): void {
    if (this.destroyed) {
      return;
    }
    try {
      const sprite = this.pokemon.getSprite?.();
      const targetKey = sprite?.texture?.key;
      if (!sprite || !targetKey) {
        this.readyFailed = true;
        return;
      }
      const tgtPix = readErShinyLabSpriteSourcePixels({ key: targetKey, frame: sprite.frame?.name });
      if (!tgtPix) {
        this.readyFailed = true;
        return;
      }
      const tm = erTransformBuildMask(tgtPix.data, tgtPix.width, tgtPix.height, this.MW, this.MH);
      if (tm.count === 0) {
        this.readyFailed = true;
        return;
      }
      this.sdfTgt = erTransformSignedDt(tm.mask, this.MW, this.MH);
      this.readyAtMs = this.elapsed();
      this.ready = true;
    } catch (err: unknown) {
      console.error("ER transform morph target capture failed", err);
      this.readyFailed = true;
    }
  }

  private elapsed(): number {
    return globalScene.time.now - this.startNow;
  }

  /** Fade the real sprite (source fades out during fill, target fades in on reveal). */
  private setSpriteAlpha(alpha: number): void {
    const sprite = this.pokemon.getSprite?.();
    sprite?.setAlpha?.(alpha);
  }

  private tick(): void {
    if (this.destroyed) {
      return;
    }
    const el = this.elapsed();
    const FILL = ER_TRANSFORM_MORPH_FILL_MS;
    const MORPH = ER_TRANSFORM_MORPH_MORPH_MS;
    const DRAIN = ER_TRANSFORM_MORPH_DRAIN_MS;
    const holdCapEnd = FILL + ER_TRANSFORM_MORPH_HOLD_CAP_MS;

    this.texCtx.clearRect(0, 0, this.MW, this.MH);

    // FILL: source sprite fades out, the solid glowing silhouette floods in.
    if (el < FILL) {
      const f = erTransformQuadOut(el / FILL);
      this.setSpriteAlpha(1 - f);
      this.renderMorphFrame(0, f);
      return;
    }

    // Decide whether we can morph yet, must fail open, or must keep holding.
    const canMorph = this.ready && !!this.sdfTgt;
    const mustFailOpen = !canMorph && (this.readyFailed || el >= holdCapEnd);

    if (!canMorph && !mustFailOpen) {
      // HOLD: solid source-shape silhouette while `onSwap` is still in flight.
      this.setSpriteAlpha(0);
      this.renderMorphFrame(0, 1);
      return;
    }

    if (canMorph) {
      const morphStart = Math.max(FILL, this.readyAtMs);
      if (el < morphStart) {
        this.setSpriteAlpha(0);
        this.renderMorphFrame(0, 1);
        return;
      }
      if (el < morphStart + MORPH) {
        // MORPH: the silhouette flows from the source shape to the target shape.
        const p = erTransformSmooth((el - morphStart) / MORPH);
        this.setSpriteAlpha(0);
        this.renderMorphFrame(p, 1);
        return;
      }
    }

    // REVEAL (+ burst). Fire the burst once; drain the glow onto the real sprite.
    if (!this.burstFired) {
      this.burstFired = true;
      this.revealStart = el;
      this.burst = playErTransformFx(this.pokemon, this.type);
    }
    const drainEl = el - this.revealStart;

    if (mustFailOpen || !this.sdfTgt) {
      // Fail open: no drain - snap the real sprite in and let the burst carry it.
      this.setSpriteAlpha(1);
      this.teardownVisual();
      return;
    }

    const drain = Math.max(0, 1 - drainEl / DRAIN);
    this.setSpriteAlpha(Math.min(1, drainEl / DRAIN));
    if (drain > 0) {
      this.renderMorphFrame(1, drain);
    }
    if (drainEl >= DRAIN) {
      this.setSpriteAlpha(1);
      this.teardownVisual();
    }
  }

  /** Rasterise the morphed silhouette at interpolation `p` into `morphImg`. */
  private rasterizeMorph(p: number): void {
    const src = this.sdfSrc;
    const tgt = this.sdfTgt ?? this.sdfSrc;
    const d = this.morphImg.data;
    const [r, g, b] = this.color;
    const rim = 2.6;
    const glowW = rim * 2.2;
    const N = this.MW * this.MH;
    for (let i = 0; i < N; i++) {
      const s = src[i] + (tgt[i] - src[i]) * p;
      const k = i * 4;
      if (s <= 0) {
        const rimGlow = Math.max(0, 1 - -s / rim);
        const boost = 0.45 * rimGlow;
        d[k] = r + (255 - r) * boost;
        d[k + 1] = g + (255 - g) * boost;
        d[k + 2] = b + (255 - b) * boost;
        d[k + 3] = 255;
      } else if (s < glowW) {
        const a = 1 - s / glowW;
        d[k] = r;
        d[k + 1] = g;
        d[k + 2] = b;
        d[k + 3] = (a * a * 200) | 0;
      } else {
        d[k + 3] = 0;
      }
    }
  }

  /** Draw the morph at `p` with an overall opacity: a blurred additive glow + the crisp shape. */
  private renderMorphFrame(p: number, overallAlpha: number): void {
    if (overallAlpha <= 0) {
      this.tex.refresh();
      return;
    }
    this.rasterizeMorph(p);
    this.morphCtx.putImageData(this.morphImg, 0, 0);
    const ctx = this.texCtx;
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.globalAlpha = overallAlpha * 0.7;
    try {
      ctx.filter = "blur(4px)";
    } catch {
      // Some 2D contexts don't support `filter`; the crisp pass below still reads.
    }
    ctx.drawImage(this.morphCanvas, 0, 0);
    ctx.restore();
    ctx.save();
    ctx.globalAlpha = overallAlpha;
    ctx.drawImage(this.morphCanvas, 0, 0);
    ctx.restore();
    this.tex.refresh();
  }

  /** Tear down the SILHOUETTE visual only (leaves any in-flight burst to self-destruct). */
  private teardownVisual(): void {
    if (this.loop) {
      this.loop.remove(false);
      this.loop = null;
    }
    if (this.safety) {
      this.safety.remove(false);
      this.safety = null;
    }
    this.setSpriteAlpha(1);
    try {
      this.image.destroy();
    } catch {
      // Sprite/scene may already be torn down; the destroy is best-effort.
    }
    const textures = globalScene.textures as Phaser.Textures.TextureManager & { remove?: (key: string) => unknown };
    try {
      if (textures.exists(this.textureKey)) {
        textures.remove?.(this.textureKey);
      }
    } catch {
      // Texture cleanup is best-effort; a stale generated key must not throw.
    }
  }

  /** Full teardown: the visual AND any live burst (scene/sprite teardown). Idempotent. */
  destroy(): void {
    if (this.destroyed) {
      return;
    }
    this.destroyed = true;
    this.teardownVisual();
    this.burst?.destroy();
    this.burst = null;
  }
}

/** Generate a unique, unused canvas-texture key for a morph instance. */
function erTransformNextTextureKey(pokemon: Pokemon): string {
  const textures = globalScene.textures;
  const base = `er-transform-morph-${pokemon.id}`;
  let key = `${base}-${Date.now().toString(36)}`;
  let i = 0;
  while (textures.exists(key)) {
    key = `${base}-${Date.now().toString(36)}-${++i}`;
  }
  return key;
}

/**
 * Play the FULL transform sequence (fill -> SDF shape morph -> reveal + burst) on
 * `pokemon`, themed by `targetType` (the target form's primary type). `onSwap`
 * performs the real sprite/info swap and is awaited UNDER the glow so the reveal
 * drains onto the already-swapped sprite.
 *
 * Fire-and-forget and fail-safe: when the runtime can't render the morph
 * (headless mocks, missing pixel data, no canvas-texture API) it degrades to the
 * burst-only {@linkcode playErTransformFx} while STILL driving `onSwap`, so the
 * transform always completes. Never throws; never awaited by the phase flow.
 * `onSwap` is invoked exactly once regardless of path.
 */
export function playErTransformMorph(
  pokemon: Pokemon,
  targetType: PokemonType,
  options: ErTransformMorphOptions,
): ErTransformSequence {
  const morph = ErFormTransformMorph.tryCreate(pokemon, targetType, options.onSwap);
  if (morph) {
    return morph;
  }
  // Fail closed: still drive the swap, then play the snappy burst-only reveal.
  try {
    void Promise.resolve()
      .then(() => options.onSwap())
      .catch((err: unknown) => console.error("ER transform (burst-only) onSwap failed", err));
  } catch (err: unknown) {
    console.error("ER transform (burst-only) onSwap threw", err);
  }
  const burst = playErTransformFx(pokemon, targetType);
  return {
    mode: "burst",
    destroy: () => burst?.destroy(),
  };
}

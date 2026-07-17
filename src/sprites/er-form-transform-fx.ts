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

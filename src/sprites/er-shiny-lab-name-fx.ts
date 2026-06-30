/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// ER Shiny Lab - animated NAME FX (the equipped SURFACE effect applied to the
// characters of a Pokemon's NAME).
//
// The flat Name-FX path (every surface just `setColor(style.color)`) only adopts
// the palette COLOR. This module additionally paints the equipped animated SURFACE
// shader (e.g. Holo Foil's moving sheen) onto the name's glyphs, faithfully (the
// REAL surface shader via `renderErShinyLabLook`) and with proper frame caching.
//
// Perf contract: frames are PRE-RENDERED ONCE per unique (name + look) and cached
// as Phaser canvas textures (shared LRU/refCount cache in er-shiny-lab-sprite-fx).
// Playback is pure frame-SWAP on a timer - the tick NEVER recomputes a shader.
// Re-showing the same (name + look) reuses the cached textures (cross-instance via
// `acquireErShinyLabCachedTexture`, same-instance via the idempotent state key).
//
// Source glyphs: the name's own `Phaser.GameObjects.Text` is briefly re-rendered
// WHITE (shadow suppressed but its padding kept, so geometry is identical), read
// back via `getImageData`, and fed to `renderErShinyLabLook` as the source pixels -
// this reuses Phaser's exact font rendering for a perfect glyph match. The renderer
// then recolours (palette) + animates (surface). Auras (`around`) are NEVER applied
// to text. Headless-safe (no-op when `document` is unavailable / canvas reads fail).
// =============================================================================

import { globalScene } from "#app/global-scene";
import type { ErShinyLabParams } from "#data/elite-redux/er-shiny-lab-effects";
import { type ErShinyLabSourcePixels, renderErShinyLabLook } from "#data/elite-redux/er-shiny-lab-renderer";
import {
  acquireErShinyLabCachedTexture,
  type ErShinyLabSpriteFxLook,
  releaseGeneratedTexture,
  textureFromRenderedPixels,
} from "#sprites/er-shiny-lab-sprite-fx";

/** Pre-rendered frames per unique (name + look) loop. ~24 keeps the sheen smooth without bloating the cache. */
export const ER_SHINY_LAB_NAME_FX_FRAME_COUNT = 24;
/** Loop length in ms; one frame is swapped every `PERIOD / FRAME_COUNT` (= 100ms by default). */
export const ER_SHINY_LAB_NAME_FX_PERIOD_MS = 2400;

const NAME_FX_FRAME_DELAY = ER_SHINY_LAB_NAME_FX_PERIOD_MS / ER_SHINY_LAB_NAME_FX_FRAME_COUNT;
const NAME_FX_KEY_PREFIX = "er-shiny-lab-name-fx";

/**
 * A stable identity for a (name + glyph-geometry + look) build. Two builds with the same key
 * produce pixel-identical frames, so the class can no-op an unchanged update and the texture
 * cache can be shared across UI surfaces. `glyphSig` (canvas dims + font) disambiguates the
 * SAME name rendered at different sizes on different surfaces (Summary vs Party), which would
 * otherwise collide. The look portion is the equipped palette + surface + the shader amounts
 * that actually affect the name pixels (auras / protect-flags are irrelevant to text).
 */
export function erShinyLabNameFxStateKey(name: string, glyphSig: string, look: ErShinyLabSpriteFxLook): string {
  const { loadout, params } = look;
  return [
    name,
    glyphSig,
    loadout.palette ?? "",
    loadout.surface ?? "",
    params.palAmt,
    params.surfAmt,
    params.scale,
    params.seed,
    params.tintMode,
  ].join("|");
}

/** The N per-frame cache keys for a build (one cached texture per animation frame). */
export function erShinyLabNameFxFrameKeys(stateKey: string): string[] {
  const keys: string[] = [];
  for (let f = 0; f < ER_SHINY_LAB_NAME_FX_FRAME_COUNT; f++) {
    keys.push(`${stateKey}|f${f}`);
  }
  return keys;
}

/** Whether a look should drive the animated NAME surface FX (vs the cheap flat palette-colour path). */
export function shouldAnimateErShinyLabName(
  look: ErShinyLabSpriteFxLook | null | undefined,
): look is ErShinyLabSpriteFxLook {
  return !!(look?.params.nameFx && look.loadout.surface);
}

/**
 * Briefly re-render the name Text as WHITE glyphs on transparent and read them back as a source
 * pixel buffer for `renderErShinyLabLook`. The fill is forced white (the renderer applies the
 * palette recolour itself) and the shadow is suppressed WITHOUT changing its reserved padding,
 * so the canvas dimensions - and therefore the glyph positions - are identical to the live text.
 * The original style is always restored (finally), so the fallback flat text is left intact.
 */
function captureWhiteGlyphs(text: Phaser.GameObjects.Text): ErShinyLabSourcePixels | null {
  if (typeof document === "undefined") {
    return null;
  }
  const canvas = text.canvas;
  const context = text.context;
  if (!canvas || !context || canvas.width <= 0 || canvas.height <= 0) {
    return null;
  }
  const style = text.style;
  const savedColor = style.color;
  const savedShadowStroke = style.shadowStroke;
  const savedShadowFill = style.shadowFill;
  try {
    text.setColor("#ffffff");
    // Keep the offsets/blur (so the canvas keeps its size) but stop the shadow from drawing.
    text.setShadow(style.shadowOffsetX, style.shadowOffsetY, style.shadowColor, style.shadowBlur, false, false);
    const data = context.getImageData(0, 0, canvas.width, canvas.height).data;
    return { width: canvas.width, height: canvas.height, data };
  } catch {
    return null;
  } finally {
    text.setColor(savedColor);
    text.setShadow(
      style.shadowOffsetX,
      style.shadowOffsetY,
      style.shadowColor,
      style.shadowBlur,
      savedShadowStroke,
      savedShadowFill,
    );
  }
}

/** A signature of the glyph GEOMETRY (canvas dims + font) for the cache key. */
function glyphSignature(text: Phaser.GameObjects.Text): string {
  const canvas = text.canvas;
  const w = canvas?.width ?? 0;
  const h = canvas?.height ?? 0;
  return `${w}x${h}|${text.style.fontSize}|${text.style.fontFamily}`;
}

/**
 * Owns the animated NAME surface FX for a single name `Text`. The handler calls {@linkcode update}
 * whenever the name/look may have changed; the instance pre-renders + caches the loop frames once,
 * overlays a frame-swapping sprite exactly over the name (hiding the flat glyphs), and tears it all
 * down (textures released, sprite + timer destroyed, base text restored) on {@linkcode clear} /
 * {@linkcode destroy}. Self-contained and fail-closed: any failure leaves the base flat text shown.
 */
export class ErShinyLabNameFx {
  private sprite: Phaser.GameObjects.Sprite | null = null;
  private text: Phaser.GameObjects.Text | null = null;
  private frameKeys: string[] = [];
  private frameIndex = 0;
  private timer: Phaser.Time.TimerEvent | null = null;
  private stateKey: string | null = null;
  private active = false;
  private savedTextAlpha = 1;
  /** Current playback speed (the frames are rendered at base speed; speed drives the timer rate). */
  private speed = 1;

  /** The per-frame timer delay for a given speed (faster speed -> shorter delay -> faster loop). */
  private static frameDelay(speed: number): number {
    const s = Math.max(0.25, Math.min(3, speed || 1));
    return Math.max(16, NAME_FX_FRAME_DELAY / s);
  }

  /** Recreate the playback timer at the current speed's delay, preserving the frame position. */
  private restartTimer(): void {
    this.timer?.remove();
    this.timer = globalScene.time.addEvent({
      delay: ErShinyLabNameFx.frameDelay(this.speed),
      loop: true,
      callback: () => this.tick(),
    });
  }

  /**
   * Build or refresh the animated FX for `text` given its resolved `look`. Returns true when the
   * animated FX is active (caller should leave its flat `setColor` in place as the hidden fallback).
   * Returns false (and tears the FX down) when the FX does not apply - palette-only Name FX, no Name
   * FX, headless, or a capture/render failure - so the caller's flat text shows unchanged.
   */
  update(text: Phaser.GameObjects.Text, look: ErShinyLabSpriteFxLook | null | undefined): boolean {
    this.text = text;
    if (typeof document === "undefined" || !shouldAnimateErShinyLabName(look) || !text.text) {
      this.clear();
      return false;
    }

    const stateKey = erShinyLabNameFxStateKey(text.text, glyphSignature(text), look);
    if (this.active && this.stateKey === stateKey && this.sprite) {
      // Frames are speed-independent (rendered at base speed for a seamless loop), so a speed-only
      // change does NOT rebuild - it just re-rates the playback timer. Without this the cached
      // frames keep playing at the OLD speed (the "speed doesn't affect Name FX" bug).
      const speed = look.params.speed ?? 1;
      if (this.speed !== speed) {
        this.speed = speed;
        this.restartTimer();
      }
      this.syncTransform(text); // keep the overlay aligned if the name moved (cheap; no re-render)
      return true;
    }

    if (!this.rebuild(text, look, stateKey)) {
      this.clear();
      return false;
    }
    this.stateKey = stateKey;
    return true;
  }

  /** Toggle the overlay without releasing textures (e.g. a transient panel hide). No-op when inactive. */
  setVisible(visible: boolean): void {
    if (!this.active) {
      return;
    }
    this.sprite?.setVisible(visible);
    this.text?.setAlpha(visible ? 0 : this.savedTextAlpha);
  }

  /** Tear down the FX (release frame textures, stop the timer, restore the flat text). Idempotent. */
  clear(): void {
    if (this.timer) {
      this.timer.remove();
      this.timer = null;
    }
    this.releaseFrames();
    this.sprite?.setVisible(false);
    if (this.active && this.text) {
      this.text.setAlpha(this.savedTextAlpha);
    }
    this.active = false;
    this.frameIndex = 0;
    this.stateKey = null;
  }

  /** Full teardown - also destroys the overlay sprite. Use when the owning name is gone for good. */
  destroy(): void {
    this.clear();
    this.sprite?.destroy();
    this.sprite = null;
    this.text = null;
  }

  private rebuild(text: Phaser.GameObjects.Text, look: ErShinyLabSpriteFxLook, stateKey: string): boolean {
    const source = captureWhiteGlyphs(text);
    if (!source) {
      return false;
    }
    // Auras never apply to text; the renderer recolours the white glyphs itself, so the synthetic
    // white source must NOT be spared by the protect-black/white guards (which target sprite art).
    const loadout = { palette: look.loadout.palette, surface: look.loadout.surface, around: null };
    // Frames are rendered at BASE speed (speed: 1) so the 24-frame loop wraps seamlessly and is
    // shared across speeds; the equipped speed only changes the PLAYBACK rate (the timer delay).
    const params: ErShinyLabParams = { ...look.params, protectBlack: false, protectWhite: false, speed: 1 };
    const periodSeconds = ER_SHINY_LAB_NAME_FX_PERIOD_MS / 1000;

    const newKeys: string[] = [];
    const cacheKeys = erShinyLabNameFxFrameKeys(stateKey);
    for (let f = 0; f < ER_SHINY_LAB_NAME_FX_FRAME_COUNT; f++) {
      const cacheKey = cacheKeys[f];
      let key = acquireErShinyLabCachedTexture(cacheKey);
      if (!key) {
        const time = (f / ER_SHINY_LAB_NAME_FX_FRAME_COUNT) * periodSeconds;
        const rendered = renderErShinyLabLook(source, loadout, params, time, { pad: 0 });
        key = rendered ? textureFromRenderedPixels(rendered, NAME_FX_KEY_PREFIX, cacheKey) : null;
      }
      if (!key) {
        for (const k of newKeys) {
          releaseGeneratedTexture(k);
        }
        return false;
      }
      newKeys.push(key);
    }

    // Swap in the new frames only once the whole loop is built (release the previous loop's refs).
    this.releaseFrames();
    this.frameKeys = newKeys;
    this.frameIndex = 0;

    const sprite = this.ensureSprite(text, newKeys[0]);
    sprite.setTexture(newKeys[0]);
    this.syncTransform(text);

    if (!this.active) {
      this.savedTextAlpha = text.alpha;
    }
    text.setAlpha(0); // hide the flat glyphs; the FX sprite carries the visible name
    this.active = true;

    this.speed = look.params.speed ?? 1;
    this.restartTimer();
    return true;
  }

  private ensureSprite(text: Phaser.GameObjects.Text, initialKey: string): Phaser.GameObjects.Sprite {
    if (!this.sprite) {
      this.sprite = globalScene.add.sprite(text.x, text.y, initialKey);
    }
    const parent = text.parentContainer;
    if (parent) {
      if (this.sprite.parentContainer !== parent) {
        parent.add(this.sprite);
      }
      // Widen both to GameObject so `moveAbove`'s generic doesn't constrain the base (Text) to the
      // child (Sprite); this keeps the FX sprite drawn directly above the name glyphs.
      const fxChild: Phaser.GameObjects.GameObject = this.sprite;
      const nameBase: Phaser.GameObjects.GameObject = text;
      parent.moveAbove(fxChild, nameBase);
    } else {
      this.sprite.setDepth(text.depth + 1);
    }
    return this.sprite;
  }

  private syncTransform(text: Phaser.GameObjects.Text): void {
    // pad:0 means the rendered texture is exactly the text's canvas, so matching x/y/origin/scale
    // overlays the FX perfectly regardless of the text's origin.
    this.sprite
      ?.setOrigin(text.originX, text.originY)
      .setPosition(text.x, text.y)
      .setScale(text.scaleX, text.scaleY)
      .setRotation(text.rotation)
      .setVisible(true);
  }

  private tick(): void {
    const sprite = this.sprite;
    if (!sprite || this.frameKeys.length === 0) {
      return;
    }
    this.frameIndex = (this.frameIndex + 1) % this.frameKeys.length;
    const key = this.frameKeys[this.frameIndex];
    if (globalScene.textures.exists(key)) {
      sprite.setTexture(key);
    }
  }

  private releaseFrames(): void {
    for (const key of this.frameKeys) {
      releaseGeneratedTexture(key);
    }
    this.frameKeys = [];
  }
}

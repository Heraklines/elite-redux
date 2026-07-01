/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux - Ghost Trainer aura FX overlay.
//
// Renders one of the Shiny Lab "around" shaders AROUND a trainer's field sprite
// during an encounter (a ghost trainer the uploader equipped an aura on, or the
// editor's live preview). Reuses the EXACT Shiny Lab pixel pipeline
// (`ErShinyLabSpriteFxOverlay` + `readErShinyLabSpriteSourcePixels` +
// `renderErShinyLabLook`) - a trainer sprite is a standard atlas field sprite
// with the same tintSprite pair as a Pokemon, so the generic pipeline reads it
// unchanged. Near-copy of the Pokemon battle-FX refresh loop (field/pokemon.ts).
//
// Doubles: one overlay per visible trainer sub-sprite. The overlay sprite is a
// child of the host container (Trainer container or the editor preview group) so
// it inherits the host's position / scale / alpha (so a trainer fade-out at
// encounter end carries the aura with it). DESTROY tears down every overlay + the
// refresh timer (no leaks).
// =============================================================================

import { globalScene } from "#app/global-scene";
import { ER_SHINY_LAB_DEFAULT_PARAMS } from "#data/elite-redux/er-shiny-lab-effects";
import {
  clampTrainerFxIntensity,
  clampTrainerFxSpeed,
  TRAINER_FX_BASE_SPEED,
  type TrainerFxTuning,
} from "#data/elite-redux/er-trainer-fx";
import {
  type ErShinyLabSpriteFxLook,
  ErShinyLabSpriteFxOverlay,
  getErShinyLabSpriteFxTime,
} from "#sprites/er-shiny-lab-sprite-fx";

/** A container that hosts the aura overlay child sprites + the base sprites to wrap. */
export interface TrainerAuraHost {
  add(child: Phaser.GameObjects.GameObject): unknown;
}

interface AuraOverlayEntry {
  overlay: ErShinyLabSpriteFxOverlay;
  base: Phaser.GameObjects.Sprite;
}

/**
 * The bold default aura reach + amount for a trainer sprite (much taller than a 96px
 * Pokemon battle sprite, so the Pokemon-tuned default reads tiny). The FX intensity
 * multiplier scales BOTH on top of these (the renderer clamps the extremes).
 */
const TRAINER_AURA_BASE_SIZE = 1.85;
const TRAINER_AURA_BASE_AMOUNT = 1;

/**
 * Aura overlay manager for a set of base sprites. FX `tuning` maps `speed` onto the
 * render-clock multiplier (`params.speed`) and `intensity` onto the aura reach +
 * amount (`params.auraSize` + `params.aroAmt`), each scaling the bold trainer default.
 * Tuning of 1x (or omitted) reproduces the shipped bold aura EXACTLY.
 */
export class ErTrainerAuraFx {
  private readonly look: ErShinyLabSpriteFxLook;
  private readonly entries: AuraOverlayEntry[] = [];
  private timer: Phaser.Time.TimerEvent | null = null;
  private destroyed = false;

  constructor(
    host: TrainerAuraHost,
    baseSprites: Phaser.GameObjects.Sprite[],
    auraId: string,
    keyPrefix: string,
    tuning?: TrainerFxTuning,
  ) {
    const speed = TRAINER_FX_BASE_SPEED * clampTrainerFxSpeed(tuning?.speed);
    const intensity = clampTrainerFxIntensity(tuning?.intensity);
    this.look = {
      loadout: { palette: null, surface: null, around: auraId },
      params: {
        ...ER_SHINY_LAB_DEFAULT_PARAMS,
        auraSize: TRAINER_AURA_BASE_SIZE * intensity,
        aroAmt: TRAINER_AURA_BASE_AMOUNT * intensity,
        speed,
      },
    };
    for (let i = 0; i < baseSprites.length; i++) {
      const base = baseSprites[i];
      if (!base) {
        continue;
      }
      const overlay = new ErShinyLabSpriteFxOverlay(base, `${keyPrefix}-${i}`);
      host.add(overlay.getSprite());
      this.entries.push({ overlay, base });
    }
  }

  /** Begin the 100ms refresh loop (idempotent). Renders one frame immediately. */
  start(): void {
    if (this.destroyed || this.timer) {
      return;
    }
    this.refresh();
    this.timer = globalScene.time.addEvent({
      delay: 100,
      loop: true,
      callback: () => this.refresh(),
    });
  }

  /** Render the current aura frame onto each overlay (hiding the base when it succeeds). */
  refresh(): void {
    if (this.destroyed) {
      return;
    }
    const time = getErShinyLabSpriteFxTime();
    for (const { overlay, base } of this.entries) {
      const textureKey = base.texture?.key;
      if (!textureKey) {
        continue;
      }
      const source = { key: textureKey, frame: base.frame?.name };
      if (overlay.refresh(this.look, source, time)) {
        // The rendered texture already contains the sprite pixels + the aura, so
        // hide the bare base to avoid drawing the un-aura'd sprite underneath.
        base.setVisible(false);
      } else {
        base.setVisible(true);
        overlay.hide(false);
      }
    }
  }

  destroy(): void {
    if (this.destroyed) {
      return;
    }
    this.destroyed = true;
    this.timer?.remove();
    this.timer = null;
    for (const { overlay, base } of this.entries) {
      overlay.destroy();
      base.setVisible(true);
    }
    this.entries.length = 0;
  }
}

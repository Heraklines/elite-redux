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
import { ER_SHINY_LAB_DEFAULT_PARAMS, type ErShinyLabParams } from "#data/elite-redux/er-shiny-lab-effects";
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
 * Aura overlay manager for a set of base sprites. The `auraSize` param can be
 * tuned per-call if a trainer's proportions need a wider/narrower reach (a
 * parameter, not a code change).
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
    params?: Partial<ErShinyLabParams>,
  ) {
    this.look = {
      loadout: { palette: null, surface: null, around: auraId },
      params: { ...ER_SHINY_LAB_DEFAULT_PARAMS, ...params },
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

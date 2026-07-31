/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import type { AnySound } from "#app/battle-scene";
import SoundFade from "phaser3-rex-plugins/plugins/soundfade";

/**
 * Fade a sound only while Phaser still owns its audio nodes.
 *
 * `SoundManager.play()` destroys one-shot sounds when they naturally complete. A slow presentation
 * can therefore outlive its audio, leaving a truthy sound whose WebAudio gain node has been cleared.
 * SoundFade reads `sound.volume` before it starts, so passing that stale object throws synchronously.
 */
export function fadeOutSoundIfActive(scene: Phaser.Scene, sound: AnySound | null, duration = 100): void {
  if (!sound || sound.pendingRemove) {
    return;
  }
  SoundFade.fadeOut(scene, sound, duration);
}

/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { globalScene } from "#app/global-scene";

/** A renderer that makes no frame progress for this long has stalled its current presentation. */
export const COOP_PRESENTATION_STALL_MS = 5000;
/** Advancing frames may be slow, but a broken animation callback still cannot hold control forever. */
const COOP_PRESENTATION_HARD_WALL_MS = 120_000;

export interface CoopPresentationProgressWatchdog {
  remove(): void;
}

/**
 * Bound presentation by renderer progress instead of an assumed GPU frame rate. Software WebGL can advance
 * below one frame per second while still drawing a valid animation. The callback remains the sole success
 * proof; no progress fails on the first interval and the wall ceiling catches an endlessly advancing tween.
 */
export function armCoopPresentationProgressWatchdog(
  onExpired: () => void,
  stallMs = COOP_PRESENTATION_STALL_MS,
): CoopPresentationProgressWatchdog {
  const startedAt = Date.now();
  let lastFrame = globalScene.game.loop.frame;
  let removed = false;
  let timer: Phaser.Time.TimerEvent | undefined;
  const check = () => {
    if (removed) {
      return;
    }
    const frame = globalScene.game.loop.frame;
    if (frame > lastFrame && Date.now() - startedAt < COOP_PRESENTATION_HARD_WALL_MS) {
      lastFrame = frame;
      timer = globalScene.time.delayedCall(stallMs, check);
      return;
    }
    onExpired();
  };
  timer = globalScene.time.delayedCall(stallMs, check);
  return {
    remove: () => {
      if (removed) {
        return;
      }
      removed = true;
      timer?.remove();
    },
  };
}

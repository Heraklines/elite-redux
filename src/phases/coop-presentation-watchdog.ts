/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { globalScene } from "#app/global-scene";
import { coopSessionGeneration, getCoopBattleStreamer } from "#data/elite-redux/coop/coop-runtime";

/** A renderer that makes no frame progress for this long has stalled its current presentation. */
export const COOP_PRESENTATION_STALL_MS = 5000;
/** Advancing frames may be slow, but a broken animation callback still cannot hold control forever. */
const COOP_PRESENTATION_HARD_WALL_MS = 120_000;

export interface CoopPresentationProgressWatchdog {
  remove(): void;
}

function scheduleWallClock(callback: () => void, ms: number): () => void {
  const timer = globalThis.setTimeout(callback, ms);
  return () => globalThis.clearTimeout(timer);
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
  // Bind every read and timer to the exact renderer runtime that armed the proof. A scene timer cannot
  // enforce liveness when that same scene is paused/destroyed, and a late ambient globalScene read can point
  // at a replacement session. The stream scheduler is wall-clock-owned and context-aware in the duo harness;
  // the fallback remains a wall timer for defensive non-runtime construction.
  const scene = globalScene;
  const streamer = getCoopBattleStreamer();
  const generation = coopSessionGeneration();
  const now = streamer == null ? Date.now : () => streamer.authorityNow();
  const schedule =
    streamer == null
      ? scheduleWallClock
      : (callback: () => void, ms: number) => streamer.scheduleAuthorityRetry(callback, ms);
  const startedAt = now();
  let lastFrame = scene.game.loop.frame;
  let removed = false;
  let cancelTimer: (() => void) | undefined;
  const check = () => {
    if (removed) {
      return;
    }
    if (streamer != null && (generation !== coopSessionGeneration() || getCoopBattleStreamer() !== streamer)) {
      // The old runtime no longer owns presentation or terminal UI. Its teardown replaces the phase tree.
      removed = true;
      return;
    }
    if (streamer == null && globalScene !== scene) {
      // Defensive non-runtime construction still belongs to the exact scene that armed it. A replacement
      // scene owns neither this proof nor its failure UI, so retire the stale wall callback silently.
      removed = true;
      return;
    }
    const frame = scene.game.loop.frame;
    if (frame > lastFrame && now() - startedAt < COOP_PRESENTATION_HARD_WALL_MS) {
      lastFrame = frame;
      cancelTimer = schedule(check, stallMs);
      return;
    }
    onExpired();
  };
  cancelTimer = schedule(check, stallMs);
  return {
    remove: () => {
      if (removed) {
        return;
      }
      removed = true;
      cancelTimer?.();
    },
  };
}

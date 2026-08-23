/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { globalScene } from "#app/global-scene";
import { coopSessionGeneration, getCoopBattleStreamer } from "#data/elite-redux/coop/coop-runtime";

/** Polling remains responsive without treating one throttled browser interval as a renderer failure. */
const COOP_PRESENTATION_POLL_MS = 5_000;
/** A visible renderer must make no frame progress for this full rolling window before it is considered stalled. */
export const COOP_PRESENTATION_STALL_MS = 30_000;
/** Advancing frames may be slow, but a broken animation callback still cannot hold control forever. */
const DEFAULT_COOP_PRESENTATION_HARD_WALL_MS = 120_000;
let configuredCoopPresentationHardWallMs = DEFAULT_COOP_PRESENTATION_HARD_WALL_MS;

/**
 * Override the advancing-renderer ceiling for an exact test runtime. The production bundle never calls this:
 * it retains the 120-second fail-closed wall. The two-browser CI entry needs a larger ceiling because its
 * software WebGL renderer can make genuine frame progress for several minutes before invoking an animation's
 * real completion callback. This changes patience only; it cannot manufacture presentation completion.
 */
export function setCoopPresentationHardWallMsForTest(ms: number | null): void {
  if (ms === null) {
    configuredCoopPresentationHardWallMs = DEFAULT_COOP_PRESENTATION_HARD_WALL_MS;
    return;
  }
  if (!Number.isFinite(ms) || ms <= 0) {
    throw new Error(`invalid co-op presentation hard wall: ${ms}`);
  }
  configuredCoopPresentationHardWallMs = ms;
}

export interface CoopPresentationProgressWatchdog {
  remove(): void;
}

function scheduleWallClock(callback: () => void, ms: number): () => void {
  const timer = globalThis.setTimeout(callback, ms);
  return () => globalThis.clearTimeout(timer);
}

/**
 * Bound presentation by renderer progress instead of an assumed GPU frame rate. Software WebGL and a
 * background-throttled human browser can legitimately go several five-second polling intervals without
 * producing a frame. Expire only after the rolling no-progress window, while the independent hard wall still
 * catches an endlessly advancing tween whose completion callback never arrives.
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
  const hardWallMs = configuredCoopPresentationHardWallMs;
  let lastFrame = scene.game.loop.frame;
  let lastProgressAt = startedAt;
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
    const sampledAt = now();
    const frame = scene.game.loop.frame;
    if (frame > lastFrame) {
      lastFrame = frame;
      lastProgressAt = sampledAt;
    }
    if (sampledAt - startedAt >= hardWallMs || sampledAt - lastProgressAt >= stallMs) {
      onExpired();
      return;
    }
    cancelTimer = schedule(check, Math.min(COOP_PRESENTATION_POLL_MS, stallMs));
  };
  cancelTimer = schedule(check, Math.min(COOP_PRESENTATION_POLL_MS, stallMs));
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

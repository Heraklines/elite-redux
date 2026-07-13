/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/** Minimal engine-facing evidence that a lobby decision reached an input-capable public surface. */
export interface CoopPublicLaunchSurfaceProbe {
  readonly phaseName: string | null;
  readonly uiMode: number;
  readonly handlerActive: boolean;
}

/** The exact phase/UI pair one role must open after the fresh-run decision. */
export interface CoopPublicLaunchSurfaceExpectation {
  readonly phaseName: string;
  readonly uiMode: number;
}

export interface CoopPublicLaunchSurfaceWait {
  readonly expected: CoopPublicLaunchSurfaceExpectation;
  readonly read: () => CoopPublicLaunchSurfaceProbe;
  readonly isCurrent: () => boolean;
  readonly timeoutMs?: number;
  readonly pollMs?: number;
}

/** Receipt or a queued phase is insufficient: the expected public handler must actually be active. */
export function isCoopPublicLaunchSurfaceReady(
  probe: CoopPublicLaunchSurfaceProbe,
  expected: CoopPublicLaunchSurfaceExpectation,
): boolean {
  return probe.phaseName === expected.phaseName && probe.uiMode === expected.uiMode && probe.handlerActive;
}

/**
 * Bounded continuation proof used by the title/lobby adapter. It never mutates the scene;
 * it only observes the exact phase, UI mode, active handler, and session-generation fence.
 */
export function awaitCoopPublicLaunchSurface(wait: CoopPublicLaunchSurfaceWait): Promise<boolean> {
  const timeoutMs = Math.max(0, Math.trunc(wait.timeoutMs ?? 5_000));
  const pollMs = Math.max(1, Math.trunc(wait.pollMs ?? 16));
  const deadline = Date.now() + timeoutMs;

  return new Promise(resolve => {
    const inspect = (): void => {
      if (!wait.isCurrent()) {
        resolve(false);
        return;
      }
      try {
        if (isCoopPublicLaunchSurfaceReady(wait.read(), wait.expected)) {
          resolve(true);
          return;
        }
      } catch {
        // A scene transition can temporarily remove the old handler; retry within the same bound.
      }
      if (Date.now() >= deadline) {
        resolve(false);
        return;
      }
      setTimeout(inspect, Math.min(pollMs, Math.max(1, deadline - Date.now())));
    };
    inspect();
  });
}

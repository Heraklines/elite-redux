/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import type { CoopRuntimeContext, CoopTimerOwner } from "#data/elite-redux/coop/authority-v2/contract";

/**
 * Arm one address-owned human-input deadline only after its exact executable control is proven.
 *
 * Replay, projection, and browser setup time cannot consume this window because no `humanInput` timer exists
 * before `waitForControlProof` resolves. Runtime teardown cancels an already-armed timer and notifies the
 * caller without invoking `onExpire`; a superseded control is checked again at the timer edge and likewise
 * fails closed. The caller owns the returned cancellation handle and must release it when real input wins.
 */
export async function armHumanInputWindowAfterControlProof(
  ctx: CoopRuntimeContext,
  owner: CoopTimerOwner,
  durationMs: number,
  waitForControlProof: () => Promise<boolean>,
  controlProofIsCurrent: () => boolean,
  onExpire: () => void,
  onInvalidated: () => void = () => {},
): Promise<(() => void) | null> {
  if (
    ctx.cancellation.aborted
    || !Number.isSafeInteger(durationMs)
    || durationMs <= 0
    || owner.ownerId.length === 0
    || owner.address.length === 0
  ) {
    return null;
  }

  let removeProofAbortListener = () => {};
  const cancelledBeforeProof = new Promise<boolean>(resolve => {
    const onAbort = () => resolve(false);
    ctx.cancellation.addEventListener("abort", onAbort, { once: true });
    removeProofAbortListener = () => ctx.cancellation.removeEventListener("abort", onAbort);
    if (ctx.cancellation.aborted) {
      resolve(false);
    }
  });
  let proven = false;
  try {
    proven = await Promise.race([waitForControlProof().catch(() => false), cancelledBeforeProof]);
  } finally {
    removeProofAbortListener();
  }
  if (!proven || ctx.cancellation.aborted || !controlProofIsCurrent()) {
    return null;
  }

  let active = true;
  let cancelTimer = () => {};
  let removeWindowAbortListener = () => {};
  const settle = (expired: boolean): void => {
    if (!active) {
      return;
    }
    active = false;
    cancelTimer();
    removeWindowAbortListener();
    if (expired && !ctx.cancellation.aborted && controlProofIsCurrent()) {
      onExpire();
      return;
    }
    onInvalidated();
  };
  cancelTimer = ctx.scheduler.schedule(owner, durationMs, "humanInput", () => settle(true));
  const onAbort = () => settle(false);
  ctx.cancellation.addEventListener("abort", onAbort, { once: true });
  removeWindowAbortListener = () => ctx.cancellation.removeEventListener("abort", onAbort);
  if (ctx.cancellation.aborted) {
    settle(false);
    return null;
  }
  return () => settle(false);
}

/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { globalScene } from "#app/global-scene";
import { coopWarn } from "#data/elite-redux/coop/coop-debug";
import { clearCoopRuntime, getCoopRuntime } from "#data/elite-redux/coop/coop-runtime";

let terminalInProgress = false;

/** Route an unrecoverable authority boundary to the same visible, non-gameplay terminal on either peer. */
export function terminateCoopAuthoritySession(reason: string): void {
  if (terminalInProgress) {
    return;
  }
  terminalInProgress = true;
  const scene = globalScene;
  coopWarn("checkpoint", `TERMINAL authority failure: ${reason}`);
  const interrupted = scene.phaseManager.getCurrentPhase();
  const visibleMessage =
    "The shared battle could not be synchronized safely. Reconnect to resume from your co-op save.";
  try {
    getCoopRuntime()?.membership.terminate();
  } catch {
    /* terminal cleanup continues */
  }
  try {
    scene.phaseManager.clearPhaseQueue();
    clearCoopRuntime();
    scene.reset();
    scene.phaseManager.unshiftNew("TitlePhase");
    if (scene.phaseManager.getCurrentPhase() === interrupted) {
      interrupted?.end();
    }
  } catch (error) {
    coopWarn("checkpoint", "authority terminal routing partially failed", error);
  } finally {
    terminalInProgress = false;
  }
  // `reset()` tears down the battle UI, so a message shown before it is immediately erased.  Present
  // the failure only after TitlePhase has been queued/started; the terminal must be visible, not merely
  // recorded in developer logs.
  queueMicrotask(() => {
    try {
      scene.ui.showText(visibleMessage, null, undefined, 6000);
    } catch {
      /* cosmetic */
    }
  });
}

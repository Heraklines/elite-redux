/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — Omniform transform presentation hold.
//
// The Omniform transform plays a ~2.2s fill/morph/reveal sequence
// (`playErTransformMorph`) that must LAND before the move animation plays, so
// the mon visibly becomes the new form FIRST and then attacks as that form (the
// maintainer-reported ordering: the transform must not happen "afterwards", on
// top of / behind the move anim). Because the FX is scene-clock driven and the
// move animation lives in the following `MoveEffectPhase`, `erOmniformOnMoveStart`
// unshifts THIS phase between the transform kickoff and the move animation. It
// holds the phase flow until the sequence's `whenSettled` promise resolves — the
// same way `QuietFormChangePhase` awaits its own tween before the flow continues.
//
// HARD BOUND (never a softlock): the wait is a race between `whenSettled` and a
// {@linkcode ER_OMNIFORM_TRANSFORM_WAIT_TIMEOUT_MS} hard timeout that FAILS OPEN
// (the sprite is already swapped and the battle continues even if the FX dies).
// The morph's own absolute-lifetime backstop already settles `whenSettled` well
// within this timeout; the timeout is a second, independent safety net. Only the
// full "morph" path is ever gated here — the fail-closed burst-only path resolves
// `whenSettled` immediately, so it adds no wait (unchanged pre-sequencing
// behaviour). On the authoritative co-op guest this phase is neutralized to an
// inert no-op by the renderer gate (it is host-authoritative presentation), so a
// replay can never deadlock on it.
// =============================================================================

import { globalScene } from "#app/global-scene";
import { Phase } from "#app/phase";

/** Hard cap on how long the move flow holds for the transform FX before failing open. */
export const ER_OMNIFORM_TRANSFORM_WAIT_TIMEOUT_MS = 3500;

export class ErOmniformTransformWaitPhase extends Phase {
  public readonly phaseName = "ErOmniformTransformWaitPhase";

  /** Resolves when the transform sequence has visually settled (or failed open). */
  private readonly settled: Promise<void>;

  constructor(settled: Promise<void>) {
    super();
    this.settled = settled;
  }

  public override start(): void {
    super.start();

    let finished = false;
    let timer: Phaser.Time.TimerEvent | null = null;
    const finish = (): void => {
      if (finished) {
        return;
      }
      finished = true;
      timer?.remove(false);
      timer = null;
      this.end();
    };

    // Hard timeout that fails OPEN: the battle continues even if the FX never
    // settles (e.g. the scene tore it down). Bounded, so no softlock is possible.
    timer = globalScene.time.delayedCall(ER_OMNIFORM_TRANSFORM_WAIT_TIMEOUT_MS, finish);
    // Release as soon as the transform visual has rested on the target form.
    void this.settled.then(finish, finish);
  }
}

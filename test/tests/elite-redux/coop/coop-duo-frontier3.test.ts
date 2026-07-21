/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// FRONTIER 3 - reward shop rendezvous barrier deadlock after a won-wave faint replacement
// under replay lag (journey run 29864116114, both seats' public-ui-trace.jsonl).
//
// THE LIVE BUG (two browsers, faint journey):
//   - The WATCHER (guest, the reward pick WATCHER) fell ~27s behind replaying the won-wave faint
//     replacement, tripped the STALL WATCHDOG ("mutual wait local=25s peer=21s -> recovering"), and
//     ran a correlated Authority V2 recovery. The recovery applied and QUEUED the exact REWARD_PRESENT
//     control - entering its narrow CONTROL-PROJECTION WINDOW (fence held + allowControlProjection):
//     the SelectModifierPhase (the reward screen) is deliberately let START so the projection can land.
//   - The watcher's reward-watch then armed its `awaitInteractionChoice` to receive the owner's relayed
//     picks. The recovery fence's `isAuthorityWaitCreationFrozen` was STILL true in that window, so the
//     relay REFUSED the wait and resolved NULL in ~60ms (trace: "AWAIT interactionChoice seq=0 REFUSED
//     (Authority V2 recovery fence held)" -> "WATCHER timed out waiting for partner -> leaving reward
//     screen"). That null is NOT a 20-min COOP_REWARD_WAIT_MS timeout - it is the fence refusing to arm.
//   - Because the watcher LEFT the reward screen, its own recovery installControl loop could never
//     observe the "exact public interaction surface" for REWARD_PRESENT -> deferred > 30000ms -> shared
//     terminal ("control projection exceeded 30000ms while deferred: awaiting exact public interaction
//     surface"). The owner (host) had already released its shop barrier (both-arrived) and driven the
//     reward, so the deadlock is entirely the recovering watcher refusing its own projected surface.
//
// THE MECHANISM (product): the recovery fence freezes new authority-wait creation WHILE THE SNAPSHOT IS
// IN FLIGHT - correct. But `allowControlProjection()` opens a window whose SOLE purpose is to let the one
// authority-stated control (the reward/interaction screen) LAND, and that surface's whole reason to exist
// is to arm the wait for the owner's relayed picks. Freezing that wait strands the surface the window just
// green-lit. The fix scopes the freeze exactly like `isControlSurfaceStartFrozen`:
//   isAuthorityWaitCreationFrozen() === frozen() && !controlProjectionAllowed
// -> genuine recovery (held, no control window yet) still refuses waits (invariant preserved); the
// control-projection window arms the projected surface's wait (deadlock resolved). No timeout inflation.
//
// This is a faithful TWO-CLIENT repro at the exact seam: a real owner relay + a real watcher relay over
// the production LoopbackTransport framing, the watcher's `isAuthorityWaitCreationFrozen` wired to a REAL
// `createRecoveryFence()`. The 27s owner lag is modeled by the owner sending its pick AFTER the watcher
// has armed inside the control-projection window (a bounded deferral of the drive, NOT a timeout change).
// It needs no BattleScene, so it runs fast + deterministically (sibling of coop-interaction-relay.test.ts).
//
// RED before the fix: sub-test B's watcher instant-nulls (settled with null before the owner's pick) and
// the fence reports authorityWaitCreationFrozen=true in the control-projection window.
// GREEN after: the watcher WAITS its real window and receives the delayed owner pick; sub-test A proves
// genuine-recovery freeze is untouched.
//
// HOW TO RUN:
//   npx vitest run test/tests/elite-redux/coop/coop-duo-frontier3.test.ts
// =============================================================================

import { createRecoveryFence } from "#data/elite-redux/coop/authority-v2/recovery-fence";
import { CoopInteractionRelay } from "#data/elite-redux/coop/coop-interaction-relay";
import { COOP_REWARD_CHOICE_KINDS } from "#data/elite-redux/coop/coop-seq-registry";
import { createLoopbackPair } from "#data/elite-redux/coop/coop-transport";
import { afterEach, describe, expect, it } from "vitest";

/** The pinned reward interaction seq the owner sends on and the watcher awaits (wave 1, counter 0). */
const REWARD_SEQ = 0;
/** The real reward wait window (20 min); the watcher must WAIT this, never instant-leave in ~60ms. */
const COOP_REWARD_WAIT_MS = 1_200_000;

/** Flush pending micro- AND macro-tasks so a synchronous/immediate `Promise.resolve(null)` settles. */
async function flushTasks(): Promise<void> {
  await Promise.resolve();
  await new Promise(resolve => setTimeout(resolve, 0));
  await Promise.resolve();
}

describe("co-op DUO Frontier 3: recovering WATCHER must not instant-null its reward wait in the control-projection window", () => {
  const disposers: Array<() => void> = [];

  afterEach(() => {
    while (disposers.length > 0) {
      disposers.pop()?.();
    }
  });

  /** Owner (host, authority) + watcher (guest, non-authority) relays over one loopback pair. */
  function buildRelays(watcherFrozen: () => boolean): {
    owner: CoopInteractionRelay;
    watcher: CoopInteractionRelay;
  } {
    const { host, guest } = createLoopbackPair();
    // The recovery-fence gate at `awaitInteractionChoice` fires UNCONDITIONALLY (before any Authority V2
    // branch), so it is the same defect whether or not V2 is on. Use plain relays (the reward pick crosses
    // as an ordinary choice carrier) to isolate the fence refusal without the V2 receipt machinery. Only
    // the WATCHER is wired to the live recovery fence - exactly the seam that stranded the live watcher.
    const owner = new CoopInteractionRelay(host);
    const watcher = new CoopInteractionRelay(guest, {
      isAuthorityWaitCreationFrozen: watcherFrozen,
    });
    disposers.push(() => owner.dispose());
    disposers.push(() => watcher.dispose());
    return { owner, watcher };
  }

  it("A) still REFUSES a fresh wait during genuine recovery (fence held, snapshot in flight) - invariant preserved", async () => {
    const fence = createRecoveryFence();
    const { watcher } = buildRelays(() => fence.isAuthorityWaitCreationFrozen());

    // Genuine recovery: the snapshot is in flight (material-apply). The control-projection window has NOT
    // been opened. The fence MUST refuse a fresh wait - a recovering replica may not arm one here.
    expect(fence.acquire()).toBe(true);
    expect(fence.state).toBe("held");
    expect(fence.isAuthorityWaitCreationFrozen()).toBe(true);

    let settledValue: unknown = "pending";
    void watcher
      .awaitInteractionChoice(REWARD_SEQ, COOP_REWARD_WAIT_MS, COOP_REWARD_CHOICE_KINDS)
      .then(v => (settledValue = v));
    await flushTasks();
    // The wait is refused fail-closed (resolves null immediately) - the recovery snapshot is protected.
    expect(settledValue, "genuine-recovery wait creation stays frozen (fix must not weaken this)").toBeNull();
  });

  it("B) ARMS the projected surface's wait in the control-projection window and WAITS its real window for the lagged owner's pick", async () => {
    const fence = createRecoveryFence();
    const { owner, watcher } = buildRelays(() => fence.isAuthorityWaitCreationFrozen());

    // The recovery applied and queued the exact REWARD_PRESENT control -> it opens the CONTROL-PROJECTION
    // WINDOW so the reward screen (SelectModifierPhase) may START. That surface's job is to arm the wait
    // for the owner's relayed picks. The fence must NOT refuse THAT wait, or the surface it green-lit is
    // stranded and the installControl loop never observes it (-> 30s deferred -> terminal).
    expect(fence.acquire()).toBe(true);
    expect(fence.allowControlProjection()).toBe(true);
    expect(fence.state).toBe("held"); // still held: only the stated control (+ its wait) is let through
    // THE FIX, asserted directly: wait creation unfreezes with the control-projection window.
    expect(
      fence.isAuthorityWaitCreationFrozen(),
      "the control-projection window must not freeze the projected surface's own wait",
    ).toBe(false);

    // The watcher's reward-watch arms its await INSIDE the window (this is where the live watcher nulled).
    let settled = false;
    let settledValue: unknown;
    const awaited = watcher
      .awaitInteractionChoice(REWARD_SEQ, COOP_REWARD_WAIT_MS, COOP_REWARD_CHOICE_KINDS)
      .then(v => {
        settled = true;
        settledValue = v;
        return v;
      });

    // Model the ~27s owner lag: the owner is still finishing its side (barrier just opened) and has NOT
    // picked yet. The watcher must be PARKED on a live wait here - NOT instant-nulled in ~60ms.
    await flushTasks();
    expect(
      settled,
      "the freshly-arrived watcher must WAIT its real window, not leave instantly (the ~60ms instant-null bug)",
    ).toBe(false);

    // The lagged owner now drives the reward and relays its authoritative pick (reward option index 2).
    owner.sendInteractionChoice(REWARD_SEQ, "reward", 2);
    const result = await awaited;

    expect(settled, "the armed wait resolved once the owner's real pick arrived").toBe(true);
    expect(result, "the watcher received the owner's relayed pick, never a premature null").not.toBeNull();
    expect(settledValue).not.toBeNull();
    expect(result?.choice).toBe(2);
  });

  it("C) once recovery RELEASES the fence open, wait creation is unfrozen for the ordinary (post-recovery) path", async () => {
    const fence = createRecoveryFence();
    const { owner, watcher } = buildRelays(() => fence.isAuthorityWaitCreationFrozen());

    fence.acquire();
    fence.allowControlProjection();
    fence.release(); // recovery complete: progression resumes normally
    expect(fence.state).toBe("open");
    expect(fence.isAuthorityWaitCreationFrozen()).toBe(false);

    const awaited = watcher.awaitInteractionChoice(REWARD_SEQ, COOP_REWARD_WAIT_MS, COOP_REWARD_CHOICE_KINDS);
    owner.sendInteractionChoice(REWARD_SEQ, "reward", 1);
    const result = await awaited;
    expect(result?.choice).toBe(1);
  });
});

/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// #P33 asym-watchdog integration - the REAL wireCoopStallWatchdog over a real transport,
// with a held-resync MACHINE wait registered via the stall probe (the live wave-4 softlock
// shape: local parked in a phase hold, the partner NOT in a mutual network wait). Proves:
//   - an asymmetric stall runs the existing recovery a bounded number of times, then routes
//     the runtime into the shared terminal (never a unilateral continue)
//   - the faint-switch-window exemption suppresses escalation (a live human, not a stall)
//   - the reward-shop / human-input exemption holds for free: an unregistered human wait is
//     never a machine wait, so localMs stays quiet and nothing escalates
// =============================================================================

import type { CoopNextControl } from "#data/elite-redux/coop/authority-v2/contract";
import type { CoopBattleStreamer } from "#data/elite-redux/coop/coop-battle-stream";
import { getCoopCausalTrace, resetCoopCausalTrace } from "#data/elite-redux/coop/coop-causal-trace";
import {
  beginCoopFaintSwitchWindow,
  CoopInteractionRelay,
  endCoopFaintSwitchWindow,
  resetCoopFaintSwitchWindows,
} from "#data/elite-redux/coop/coop-interaction-relay";
import type { CoopRuntime } from "#data/elite-redux/coop/coop-runtime";
import { isCoopSharedTerminalFrozen, wireCoopStallWatchdog } from "#data/elite-redux/coop/coop-runtime";
import { beginCoopMachineWait, clearCoopMachineWaits } from "#data/elite-redux/coop/coop-stall-probe";
import { type CoopWireChannel, WebRtcTransport } from "#data/elite-redux/coop/coop-webrtc-transport";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

class MockWire implements CoopWireChannel {
  readyState = "open";
  peer: MockWire | null = null;
  private msgHandler: ((d: string) => void) | null = null;
  send(data: string): void {
    this.peer?.msgHandler?.(data);
  }
  close(): void {
    this.readyState = "closed";
  }
  onMessage(h: (d: string) => void): void {
    this.msgHandler = h;
  }
  onOpen(): void {}
  onClose(): void {}
}

const idleStream = { oldestNetworkWaitMs: () => -1 } as unknown as CoopBattleStreamer;

/**
 * A stub runtime with exactly the surfaces the watchdog's recovery + shared-terminal fallback touch.
 * There is no bound supervisor, so `failCoopRuntimeSharedSession` takes the bounded legacy teardown:
 * it sets the runtime's shared-terminal state to frozen (the observable we assert on) without a scene.
 */
function makeStubRuntime(activeControl: CoopNextControl | null = null): CoopRuntime {
  return {
    controller: {
      versionMismatch: false,
      functionalFingerprintMismatch: false,
      sessionEpoch: 0,
      role: "host",
      interactionCounter: () => 0,
    },
    membership: { terminate: () => {} },
    battleSync: { freezeForTerminal: () => {} },
    interactionRelay: { cancelWaiters: () => {} },
    v2ControlLedger: { activeControl },
  } as unknown as CoopRuntime;
}

describe("#P33 asymmetric stall watchdog -> bounded recovery -> shared terminal", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetCoopCausalTrace();
    clearCoopMachineWaits();
    resetCoopFaintSwitchWindows();
  });
  afterEach(() => {
    vi.useRealTimers();
    resetCoopCausalTrace();
    clearCoopMachineWaits();
    resetCoopFaintSwitchWindows();
  });

  function wireHost(runtime: CoopRuntime) {
    const a = new MockWire();
    const b = new MockWire();
    a.peer = b;
    b.peer = a;
    const hostT = new WebRtcTransport("host", a);
    const hostRelay = new CoopInteractionRelay(hostT);
    wireCoopStallWatchdog(hostT, hostRelay, idleStream, runtime);
    return { hostT };
  }

  it("a held-resync machine wait with a silent-but-connected partner escalates to the shared terminal", async () => {
    const runtime = makeStubRuntime();
    const { hostT } = wireHost(runtime);
    expect(hostT.state).toBe("connected");

    // Simulate the CoopApplyResyncPhase held boundary: a local MACHINE wait that never resolves. The peer
    // is alive (transport connected) but is NOT in a mutual network wait, so it never sends a stallBeat.
    const endHold = beginCoopMachineWait("coop-resync-hold:t4");

    // Bounded recovery (3 attempts, 30s cooldown) then terminate: ~110s of watchdog ticks.
    await vi.advanceTimersByTimeAsync(120_000);
    await vi.advanceTimersByTimeAsync(0);

    const recoveries = getCoopCausalTrace().filter(e => e.domain === "recovery" && e.stage === "stall-detected");
    expect(recoveries.length, "the asymmetric stall attempted the existing recovery first").toBeGreaterThanOrEqual(1);
    expect(isCoopSharedTerminalFrozen(runtime), "bounded recovery exhausted -> routed into shared terminal").toBe(true);
    endHold();
  });

  it("the faint-switch-window exemption suppresses escalation (a live human is not a stall)", async () => {
    const runtime = makeStubRuntime();
    wireHost(runtime);
    beginCoopFaintSwitchWindow();
    const endHold = beginCoopMachineWait("coop-resync-hold:t4");

    await vi.advanceTimersByTimeAsync(120_000);
    await vi.advanceTimersByTimeAsync(0);

    expect(getCoopCausalTrace().some(e => e.domain === "recovery")).toBe(false);
    expect(isCoopSharedTerminalFrozen(runtime), "faint window exempts the watchdog").toBe(false);
    endHold();
    endCoopFaintSwitchWindow();
  });

  it("an installed V2 replacement control suppresses escalation without a legacy faint-window pin", async () => {
    const runtime = makeStubRuntime({
      kind: "REPLACEMENT",
      operationId: "RC/e1/w2/t1/o2/f0/s0",
      ownerSeatId: 0,
      epoch: 1,
      wave: 2,
      turn: 1,
      occurrence: 2,
      fieldIndex: 0,
    });
    wireHost(runtime);
    const endHold = beginCoopMachineWait("authority-v2-successor:w2:t1:r25");

    // The real public-browser failure waited 43 seconds for the owner to finish the PARTY picker. Cross the
    // 20-second asymmetric-stall threshold while remaining inside the replacement scheduler's 60-second
    // owner lease: the exact V2 control is human deliberation, not an asymmetric deadlock.
    await vi.advanceTimersByTimeAsync(45_000);
    await vi.advanceTimersByTimeAsync(0);

    expect(getCoopCausalTrace().some(e => e.domain === "recovery")).toBe(false);
    expect(isCoopSharedTerminalFrozen(runtime), "V2 replacement deliberation remains playable").toBe(false);
    endHold();
  });

  it("a human-input wait is never a machine wait, so a shop browse never escalates", async () => {
    const runtime = makeStubRuntime();
    wireHost(runtime);
    // No machine wait is registered (the reward-shop owner is in UI, not a network/queue wait).
    await vi.advanceTimersByTimeAsync(120_000);
    await vi.advanceTimersByTimeAsync(0);

    expect(getCoopCausalTrace().some(e => e.domain === "recovery")).toBe(false);
    expect(isCoopSharedTerminalFrozen(runtime)).toBe(false);
  });
});

/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Unit tests for the co-op CONTROL-PLANE report block (#diagnostics). Engine-free: a stub CoopRuntime is
// installed so `formatCoopControlPlane()` can be exercised without booting a scene. Asserts the block is
// EMPTY for a solo run (no runtime) and, when a session is live, carries the diagnosable control-plane
// state a hang is triaged from: session identifiers, the parked interaction (seq + accepted kinds + age),
// the awaited rendezvous barrier, the interaction counter, and the transport's last-received-frame age.
// =============================================================================

import { COOP_CONTROL_PLANE_MARKER, formatCoopControlPlane } from "#data/elite-redux/coop/coop-diagnostics";
import type { CoopRuntime } from "#data/elite-redux/coop/coop-runtime";
import { clearCoopRuntime, setCoopRuntime } from "#data/elite-redux/coop/coop-runtime";
import { afterEach, describe, expect, it } from "vitest";

/**
 * A minimal stub CoopRuntime carrying only the fields `formatCoopControlPlane` reads. Cast through
 * `unknown` (the established test-stub pattern in this suite, e.g. the duo harness's `ReplayGameManager`);
 * the diagnostics reader only ever touches the members set here, each guarded by its own try/catch.
 */
function stubRuntime(over: {
  awaited?: { seq: number; ageMs: number; expectedKinds: readonly string[] }[];
  lastRxMs?: number | undefined;
}): CoopRuntime {
  const noop = () => {};
  return {
    // The reader's fields:
    controller: {
      role: "host",
      seat: 0,
      versionMismatch: false,
      netcodeMode: "authoritative",
      interactionCounter: () => 4,
      dispose: noop,
    },
    interactionRelay: {
      describeAwaitedInteractions: () => over.awaited ?? [],
      dispose: noop,
    },
    rendezvous: {
      describeArrivals: () => ({ localArrived: ["waveStart:5"], partnerArrived: [], awaiting: ["waveStart:5"] }),
      dispose: noop,
    },
    localTransport: {
      state: "connected",
      lastRxMs: () => over.lastRxMs,
      close: noop,
    },
    // The rest of the runtime clearCoopRuntime tears down (no-op teardown for this stub):
    battleSync: { dispose: noop },
    battleStream: { dispose: noop },
    uiMirror: { dispose: noop },
    mePump: { endSession: noop },
  } as unknown as CoopRuntime;
}

describe("co-op control-plane report block (#diagnostics)", () => {
  afterEach(() => {
    clearCoopRuntime();
  });

  it("is empty for a solo run (no live co-op session)", () => {
    clearCoopRuntime();
    expect(formatCoopControlPlane(), "no runtime -> no control-plane block").toBe("");
  });

  it("captures session identifiers, the parked interaction, rendezvous, and transport lastRx", () => {
    setCoopRuntime(stubRuntime({ awaited: [{ seq: 4, ageMs: 12_000, expectedKinds: ["reward"] }], lastRxMs: 3_000 }));
    const block = formatCoopControlPlane();
    expect(block.startsWith(COOP_CONTROL_PLANE_MARKER), "opens with the fenced marker").toBe(true);
    expect(block).toContain("role=host");
    expect(block).toContain("counter=4");
    // The parked interaction the whole session is blocked on: seq + accepted kinds + wait age.
    expect(block).toContain("seq4[reward]@12s");
    // The awaited rendezvous barrier.
    expect(block).toContain("awaiting=[waveStart:5]");
    // The transport's last-received-frame age (the true heartbeat).
    expect(block).toContain("lastRx=3s");
  });

  it("renders a never-received transport as lastRx=never (a suspended/dead tab signature)", () => {
    setCoopRuntime(stubRuntime({ lastRxMs: undefined }));
    const block = formatCoopControlPlane();
    expect(block).toContain("lastRx=never");
    expect(block).toContain("awaiting=none");
  });
});

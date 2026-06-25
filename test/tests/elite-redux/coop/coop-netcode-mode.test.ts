/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// Co-op SELECTABLE netcode mode (#633, A/B). Two complete implementations live side
// by side: "lockstep" (the safe live DEFAULT - both engines resolve, the visible move
// stays synced) and "authoritative" (the guest is a pure renderer of the host's stream).
// The HOST decides which one and the GUEST adopts it from the runConfig. This is the
// pure, engine-free core - verified over a LoopbackTransport controller pair (mirrors
// coop-battle-sync.test.ts), so it runs unchanged over the real WebRTC transport.

import { CoopSessionController } from "#data/elite-redux/coop/coop-session-controller";
import { createLoopbackPair } from "#data/elite-redux/coop/coop-transport";
import { describe, expect, it } from "vitest";

/** LoopbackTransport delivers on a microtask; flush before asserting. */
const flush = () => new Promise<void>(resolve => queueMicrotask(resolve));

describe("co-op selectable netcode mode (#633, A/B)", () => {
  it("defaults to lockstep on a fresh controller (before any runConfig)", () => {
    const { host, guest } = createLoopbackPair();
    const h = new CoopSessionController(host);
    const g = new CoopSessionController(guest);
    // The safe live default - restores the visible move sync - before the host decides.
    expect(h.netcodeMode).toBe("lockstep");
    expect(g.netcodeMode).toBe("lockstep");
  });

  it("the host's chosen 'authoritative' mode crosses the wire so the guest adopts it", async () => {
    const { host, guest } = createLoopbackPair();
    const h = new CoopSessionController(host);
    const g = new CoopSessionController(guest);

    // Host opts into the authoritative netcode, then broadcasts the run config.
    h.setNetcodeMode("authoritative");
    h.broadcastRunConfig({ difficulty: "hell", challenges: [] });
    await flush();

    // The host knows its own mode immediately; the guest adopts the host's value.
    expect(h.netcodeMode).toBe("authoritative");
    expect(g.netcodeMode).toBe("authoritative");
    // It rides along in the retained run config too (so the re-broadcast carries it).
    expect(h.runConfig()?.netcodeMode).toBe("authoritative");
    expect(g.runConfig()?.netcodeMode).toBe("authoritative");
  });

  it("an absent netcodeMode on the wire (legacy/in-flight save) means lockstep on the guest", async () => {
    const { host, guest } = createLoopbackPair();
    const g = new CoopSessionController(guest);

    // A bare runConfig from before this field existed - no netcodeMode key. The guest
    // must treat it as lockstep (the safe default), not crash or guess authoritative.
    host.send({ t: "runConfig", difficulty: "elite", challenges: [] });
    await flush();

    expect(g.runConfig()?.difficulty).toBe("elite");
    expect(g.netcodeMode).toBe("lockstep");
  });

  it("the host's lockstep choice rides along so the guest stays lockstep", async () => {
    const { host, guest } = createLoopbackPair();
    const h = new CoopSessionController(host);
    const g = new CoopSessionController(guest);

    h.setNetcodeMode("lockstep");
    h.broadcastRunConfig({ difficulty: "ace", challenges: [] });
    await flush();

    expect(g.netcodeMode).toBe("lockstep");
    expect(g.runConfig()?.netcodeMode).toBe("lockstep");
  });
});

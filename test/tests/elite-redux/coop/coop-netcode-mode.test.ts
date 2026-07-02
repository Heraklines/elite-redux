/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// Co-op netcode mode (#633 M3: authoritative-only). Co-op is now AUTHORITATIVE-ONLY - the
// host is the sole engine and the guest is a pure renderer - so the mode DEFAULTS to
// "authoritative" and the old "lockstep" dual-engine mode is retired. `setNetcodeMode` still
// functions (an explicit override retained for back-compat / tests). The HOST pins it and the
// GUEST adopts it from the runConfig. Pure, engine-free core over a LoopbackTransport pair.

import { CoopSessionController } from "#data/elite-redux/coop/coop-session-controller";
import { createLoopbackPair } from "#data/elite-redux/coop/coop-transport";
import { describe, expect, it } from "vitest";

/** LoopbackTransport delivers on a microtask; flush before asserting. */
const flush = () => new Promise<void>(resolve => queueMicrotask(resolve));

describe("co-op selectable netcode mode (#633, A/B)", () => {
  it("defaults to authoritative on a fresh controller (before any runConfig)", () => {
    const { host, guest } = createLoopbackPair();
    const h = new CoopSessionController(host);
    const g = new CoopSessionController(guest);
    // Co-op is AUTHORITATIVE-ONLY (#633 M3): the guest is a pure renderer by default.
    expect(h.netcodeMode).toBe("authoritative");
    expect(g.netcodeMode).toBe("authoritative");
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

  it("an absent netcodeMode on the wire (legacy/in-flight save) means authoritative on the guest", async () => {
    const { host, guest } = createLoopbackPair();
    const g = new CoopSessionController(guest);

    // A bare runConfig from before this field existed - no netcodeMode key. The guest
    // treats it as authoritative (#633 M3: the one and only co-op netcode), never crashes.
    host.send({ t: "runConfig", difficulty: "elite", challenges: [] });
    await flush();

    expect(g.runConfig()?.difficulty).toBe("elite");
    expect(g.netcodeMode).toBe("authoritative");
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

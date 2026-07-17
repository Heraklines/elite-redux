/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Co-op CAPABILITY handshake wiring (#896 W2e-R2). Engine-free (lane-A) tests that the
// CoopSessionController advertises + negotiates capabilities on the pairing handshake, that the
// surface adapters' activation predicate fails closed when the peer lacks a capability, that a
// hot-rejoin re-handshake PRESERVES the negotiated set while a genuine re-pair RENEGOTIATES, and the
// wire round-trip of the `capabilities` field on hello/rosterSync. Pure-controller over a loopback /
// tiny flap transport - no game engine. See coop-session-controller.ts + coop-capabilities.ts.
// =============================================================================

import {
  isCoopBiomeOperationEnabled,
  resetCoopBiomeOperationFlag,
  setCoopBiomeOperationEnabled,
} from "#data/elite-redux/coop/coop-biome-operation";
import {
  COOP_CAP_OP_BIOME,
  COOP_CAP_OP_ME,
  COOP_CAP_OP_REWARD,
  clearNegotiatedCoopCapabilities,
  getNegotiatedCoopCapabilities,
  isCoopCapabilityNegotiated,
  setNegotiatedCoopCapabilities,
} from "#data/elite-redux/coop/coop-capabilities";
import { CoopSessionController } from "#data/elite-redux/coop/coop-session-controller";
import type { CoopConnectionState, CoopMessage, CoopRole, CoopTransport } from "#data/elite-redux/coop/coop-transport";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

/** Loopback / flap transports deliver on a microtask; flush before asserting. */
const flush = () => new Promise<void>(resolve => queueMicrotask(resolve));

/**
 * A minimal controllable in-process transport (mirrors the one in coop-lobby-selfheal.test.ts): delivers
 * to the peer on a microtask, but its `connected` flag can toggle so a test can drive a #805 hot-rejoin
 * (connected -> disconnected -> connected). While DARK a send is dropped at the source; a frame in flight
 * is dropped if the peer is dark at delivery.
 */
class FlapTransport implements CoopTransport {
  readonly role: CoopRole;
  private peer: FlapTransport | null = null;
  private _state: CoopConnectionState = "connected";
  private readonly msgHandlers = new Set<(msg: CoopMessage) => void>();
  private readonly stateHandlers = new Set<(state: CoopConnectionState) => void>();

  constructor(role: CoopRole) {
    this.role = role;
  }

  _pair(peer: FlapTransport): void {
    this.peer = peer;
  }

  get state(): CoopConnectionState {
    return this._state;
  }

  setConnected(connected: boolean): void {
    const next: CoopConnectionState = connected ? "connected" : "disconnected";
    if (this._state === next) {
      return;
    }
    this._state = next;
    for (const h of [...this.stateHandlers]) {
      h(next);
    }
  }

  send(msg: CoopMessage): void {
    if (this._state !== "connected") {
      return;
    }
    const peer = this.peer;
    if (peer == null) {
      return;
    }
    queueMicrotask(() => {
      if (peer._state !== "connected") {
        return;
      }
      for (const h of [...peer.msgHandlers]) {
        h(msg);
      }
    });
  }

  onMessage(handler: (msg: CoopMessage) => void): () => void {
    this.msgHandlers.add(handler);
    return () => {
      this.msgHandlers.delete(handler);
    };
  }

  onStateChange(handler: (state: CoopConnectionState) => void): () => void {
    this.stateHandlers.add(handler);
    return () => {
      this.stateHandlers.delete(handler);
    };
  }

  close(): void {
    this._state = "closed";
    this.msgHandlers.clear();
    this.stateHandlers.clear();
  }
}

function makeFlapPair(): { host: FlapTransport; guest: FlapTransport } {
  const host = new FlapTransport("host");
  const guest = new FlapTransport("guest");
  host._pair(guest);
  guest._pair(host);
  return { host, guest };
}

describe("co-op capability handshake wiring (#896 W2e-R2)", () => {
  beforeEach(() => {
    clearNegotiatedCoopCapabilities();
  });

  afterEach(() => {
    // Session-scoped module state is process-global; reset so nothing leaks into another file.
    clearNegotiatedCoopCapabilities();
    resetCoopBiomeOperationFlag();
  });

  // ---------------------------------------------------------------------------
  // Negotiation over the pairing handshake.
  // ---------------------------------------------------------------------------
  it("both peers advertise on hello -> the negotiated set is the INTERSECTION", async () => {
    const { host, guest } = makeFlapPair();
    const h = new CoopSessionController(host, {
      username: "Host",
      tiebreak: 1,
      localCapabilities: [COOP_CAP_OP_BIOME, COOP_CAP_OP_ME],
    });
    const g = new CoopSessionController(guest, {
      username: "Guest",
      tiebreak: 2,
      localCapabilities: [COOP_CAP_OP_ME, COOP_CAP_OP_REWARD],
    });
    h.connect();
    g.connect();
    await flush();

    // Intersection is symmetric, so both controllers converge the shared module set to {opSurface.me.v2}.
    expect(isCoopCapabilityNegotiated(COOP_CAP_OP_ME)).toBe(true);
    expect(isCoopCapabilityNegotiated(COOP_CAP_OP_BIOME)).toBe(false);
    expect(isCoopCapabilityNegotiated(COOP_CAP_OP_REWARD)).toBe(false);
    expect([...(getNegotiatedCoopCapabilities() ?? [])]).toEqual([COOP_CAP_OP_ME]);
  });

  it("an OLDER peer (no localCapabilities -> no field) pairs, negotiated is EMPTY (legacy)", async () => {
    const { host, guest } = makeFlapPair();
    // The host advertises; the guest is an older build (negotiation not in use -> sends no field).
    const h = new CoopSessionController(host, {
      username: "Host",
      tiebreak: 1,
      localCapabilities: [COOP_CAP_OP_BIOME, COOP_CAP_OP_ME],
    });
    const g = new CoopSessionController(guest, { username: "Guest", tiebreak: 2 });
    h.connect();
    g.connect();
    await flush();

    // The host still pairs (version handshake unchanged) but negotiates the empty intersection.
    expect(h.partnerConnected).toBe(true);
    expect(isCoopCapabilityNegotiated(COOP_CAP_OP_BIOME)).toBe(false);
    expect(isCoopCapabilityNegotiated(COOP_CAP_OP_ME)).toBe(false);
    expect([...(getNegotiatedCoopCapabilities() ?? [])]).toEqual([]);
  });

  // ---------------------------------------------------------------------------
  // The surface adapter's activation predicate consults the negotiated set (fail closed).
  // ---------------------------------------------------------------------------
  it("adapter is OFF when the peer lacks the capability even though the local flag is ON (fail closed)", async () => {
    setCoopBiomeOperationEnabled(true); // local flag ON...
    const { host, guest } = makeFlapPair();
    const h = new CoopSessionController(host, {
      username: "Host",
      tiebreak: 1,
      localCapabilities: [COOP_CAP_OP_BIOME],
    });
    // ...but the peer does NOT advertise biome.
    const g = new CoopSessionController(guest, { username: "Guest", tiebreak: 2, localCapabilities: [COOP_CAP_OP_ME] });
    h.connect();
    g.connect();
    await flush();

    // Local flag ON + peer lacks capability => surface OFF (the migrated path is not active).
    expect(isCoopBiomeOperationEnabled()).toBe(false);
  });

  it("adapter is ON when BOTH advertise the capability and the local flag is ON", async () => {
    setCoopBiomeOperationEnabled(true);
    const { host, guest } = makeFlapPair();
    const h = new CoopSessionController(host, {
      username: "Host",
      tiebreak: 1,
      localCapabilities: [COOP_CAP_OP_BIOME],
    });
    const g = new CoopSessionController(guest, {
      username: "Guest",
      tiebreak: 2,
      localCapabilities: [COOP_CAP_OP_BIOME],
    });
    h.connect();
    g.connect();
    await flush();

    expect(isCoopCapabilityNegotiated(COOP_CAP_OP_BIOME)).toBe(true);
    expect(isCoopBiomeOperationEnabled()).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // Hot rejoin PRESERVES the negotiated set (re-handshake -> same intersection).
  // ---------------------------------------------------------------------------
  it("freezes the first accepted capability intersection against later mutation", () => {
    setNegotiatedCoopCapabilities([COOP_CAP_OP_BIOME, COOP_CAP_OP_ME], [COOP_CAP_OP_BIOME, COOP_CAP_OP_ME]);
    expect([...(getNegotiatedCoopCapabilities() ?? [])]).toEqual([COOP_CAP_OP_BIOME, COOP_CAP_OP_ME]);

    setNegotiatedCoopCapabilities([COOP_CAP_OP_BIOME, COOP_CAP_OP_ME], [COOP_CAP_OP_ME, COOP_CAP_OP_REWARD]);
    expect(
      [...(getNegotiatedCoopCapabilities() ?? [])],
      "a later hello/roster frame cannot change live session behavior",
    ).toEqual([COOP_CAP_OP_BIOME, COOP_CAP_OP_ME]);
  });

  it("a HOT REJOIN (flap -> reconnect re-handshake) preserves the negotiated set", async () => {
    const { host, guest } = makeFlapPair();
    const caps = [COOP_CAP_OP_BIOME, COOP_CAP_OP_ME];
    const h = new CoopSessionController(host, { username: "Host", tiebreak: 1, localCapabilities: caps });
    const g = new CoopSessionController(guest, { username: "Guest", tiebreak: 2, localCapabilities: caps });
    h.connect();
    g.connect();
    await flush();
    expect([...(getNegotiatedCoopCapabilities() ?? [])]).toEqual([COOP_CAP_OP_BIOME, COOP_CAP_OP_ME]);

    // Channel flaps dark then back: the controller's reconnect resync re-announces hello -> re-negotiates
    // to the IDENTICAL frozen set (nothing cleared it on the flap).
    guest.setConnected(false);
    host.setConnected(false);
    await flush();
    guest.setConnected(true);
    host.setConnected(true);
    await flush();
    await flush();
    await flush();

    expect([...(getNegotiatedCoopCapabilities() ?? [])]).toEqual([COOP_CAP_OP_BIOME, COOP_CAP_OP_ME]);
    expect(isCoopCapabilityNegotiated(COOP_CAP_OP_BIOME)).toBe(true);
    expect(isCoopCapabilityNegotiated(COOP_CAP_OP_ME)).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // A genuine RE-PAIR renegotiates against the new peer (fresh assembly clears first).
  // ---------------------------------------------------------------------------
  it("a genuine RE-PAIR (clear + new controllers) renegotiates against the NEW peer", async () => {
    // First pairing: both advertise biome+me.
    const first = makeFlapPair();
    const h1 = new CoopSessionController(first.host, {
      username: "H",
      tiebreak: 1,
      localCapabilities: [COOP_CAP_OP_BIOME, COOP_CAP_OP_ME],
    });
    const g1 = new CoopSessionController(first.guest, {
      username: "G",
      tiebreak: 2,
      localCapabilities: [COOP_CAP_OP_BIOME, COOP_CAP_OP_ME],
    });
    h1.connect();
    g1.connect();
    await flush();
    expect(isCoopCapabilityNegotiated(COOP_CAP_OP_BIOME)).toBe(true);

    // A fresh runtime assembly clears the negotiated set before the new pairing (assembleCoopRuntime does
    // this); the NEW peer only advertises me.
    clearNegotiatedCoopCapabilities();
    const second = makeFlapPair();
    const h2 = new CoopSessionController(second.host, {
      username: "H2",
      tiebreak: 1,
      localCapabilities: [COOP_CAP_OP_BIOME, COOP_CAP_OP_ME],
    });
    const g2 = new CoopSessionController(second.guest, {
      username: "G2",
      tiebreak: 2,
      localCapabilities: [COOP_CAP_OP_ME],
    });
    h2.connect();
    g2.connect();
    await flush();

    expect(isCoopCapabilityNegotiated(COOP_CAP_OP_BIOME)).toBe(false); // the new peer lacks biome
    expect(isCoopCapabilityNegotiated(COOP_CAP_OP_ME)).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // Wire-shape round-trip: the capabilities field survives serialization on hello + rosterSync.
  // ---------------------------------------------------------------------------
  describe("wire round-trip of the capabilities field", () => {
    it("hello carries + round-trips the capabilities array", () => {
      const hello: CoopMessage = {
        t: "hello",
        version: "er-coop-12",
        username: "Host",
        role: "host",
        tiebreak: 1,
        epoch: 1,
        capabilities: [COOP_CAP_OP_BIOME, COOP_CAP_OP_ME],
      };
      const round = JSON.parse(JSON.stringify(hello)) as CoopMessage;
      expect(round.t).toBe("hello");
      if (round.t === "hello") {
        expect(round.capabilities).toEqual([COOP_CAP_OP_BIOME, COOP_CAP_OP_ME]);
      }
    });

    it("rosterSync carries + round-trips the capabilities array", () => {
      const roster: CoopMessage = {
        t: "rosterSync",
        role: "guest",
        entries: [{ speciesId: 1, cost: 1 }],
        ready: true,
        capabilities: [COOP_CAP_OP_REWARD],
      };
      const round = JSON.parse(JSON.stringify(roster)) as CoopMessage;
      expect(round.t).toBe("rosterSync");
      if (round.t === "rosterSync") {
        expect(round.capabilities).toEqual([COOP_CAP_OP_REWARD]);
      }
    });

    it("an omitted capabilities field round-trips as undefined (older peer)", () => {
      const hello: CoopMessage = { t: "hello", version: "er-coop-12", username: "Old", role: "guest", epoch: 0 };
      const round = JSON.parse(JSON.stringify(hello)) as CoopMessage;
      if (round.t === "hello") {
        expect(round.capabilities).toBeUndefined();
      }
    });
  });
});

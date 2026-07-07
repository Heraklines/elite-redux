/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// Showdown 1v1 WAGER screen wire (D3). Engine-free over a LoopbackTransport:
//   - the stake OFFER round-trips (showdownStakeOffer),
//   - the friendly commit crosses the reciprocal `showdown-wager-commit` rendezvous.
// (The wager SCREEN itself is proven visually by the `showdown-wager` render-harness recipe;
// the vs-CPU spoof end-to-end handshake is in showdown-spoof.test.ts.)

import { CoopRendezvous } from "#data/elite-redux/coop/coop-rendezvous";
import { createLoopbackPair, type ShowdownStakeOfferWire } from "#data/elite-redux/coop/coop-transport";
import { SHOWDOWN_WAGER_COMMIT_POINT } from "#data/elite-redux/showdown/showdown-session";
import { describe, expect, it } from "vitest";

/** LoopbackTransport delivers on a microtask; flush a few times to drain. */
const flush = async () => {
  for (let i = 0; i < 8; i++) {
    await new Promise<void>(resolve => queueMicrotask(resolve));
  }
};

describe("Showdown wager wire + rendezvous (D3)", () => {
  it("a stake offer round-trips over the wire", async () => {
    const { host, guest } = createLoopbackPair();
    let received: ShowdownStakeOfferWire | null = null;
    guest.onMessage(m => {
      if (m.t === "showdownStakeOffer") {
        received = m.offer;
      }
    });
    const offer: ShowdownStakeOfferWire = { speciesId: 3, shiny: true, variant: 1, erBlackShiny: false, cost: 5 };
    host.send({ t: "showdownStakeOffer", offer });
    await flush();
    expect(received).toEqual(offer);
  });

  it("a stake LOCK round-trips with the escrow matchId + tier (D3b)", async () => {
    const { host, guest } = createLoopbackPair();
    let received: { matchId: string; tier: number } | null = null;
    guest.onMessage(m => {
      if (m.t === "showdownStakeLock") {
        received = { matchId: m.matchId, tier: m.tier };
      }
    });
    host.send({ t: "showdownStakeLock", matchId: "abc-123", tier: 102 });
    await flush();
    expect(received).toEqual({ matchId: "abc-123", tier: 102 });
  });

  it("both sides crossing showdown-wager-commit resolves the commit barrier", async () => {
    const { host, guest } = createLoopbackPair();
    const hrv = new CoopRendezvous(host, { timeoutMs: 10_000 });
    const grv = new CoopRendezvous(guest, { timeoutMs: 10_000 });
    const hp = hrv.rendezvous(SHOWDOWN_WAGER_COMMIT_POINT);
    const gp = grv.rendezvous(SHOWDOWN_WAGER_COMMIT_POINT);
    await flush();
    expect((await hp).timedOut).toBe(false);
    expect((await gp).timedOut).toBe(false);
    hrv.dispose();
    grv.dispose();
  });
});

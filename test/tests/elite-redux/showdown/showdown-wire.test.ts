/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// Showdown wire protocol (Task A4): the additive 1v1-PvP messages on the SHARED
// co-op transport. Engine-free (no ER_SCENARIO gate). Each of the 8 new `t` kinds
// round-trips host -> guest over the in-process LoopbackTransport, and the two wire
// shapes are asserted structurally compatible with the showdown domain types
// WITHOUT the transport ever importing showdown/ (dependency stays one-way).

import type {
  CoopMessage,
  ShowdownMonManifestWire,
  ShowdownStakeOfferWire,
} from "#app/data/elite-redux/coop/coop-transport";
import { createLoopbackPair } from "#app/data/elite-redux/coop/coop-transport";
import type { StakeOffer } from "#app/data/elite-redux/showdown/showdown-stakes";
import type { ShowdownMonManifest } from "#app/data/elite-redux/showdown/showdown-team";
import { describe, expect, it } from "vitest";

// ---------------------------------------------------------------------------
// Type-level structural compatibility (compiled, never executed).
//
// Stakes: StakeOffer.variant is the narrow `0 | 1 | 2` union while the wire uses
// plain `number`, so only the domain -> wire direction is assignable WITHOUT a
// cast (a `number` can't narrow back to `0 | 1 | 2`). We assert that one way.
//
// Manifest: both shapes are structurally identical, so BOTH directions hold.
// ---------------------------------------------------------------------------
const stakeToWire: ShowdownStakeOfferWire = {} as StakeOffer;
const manifestToWire: ShowdownMonManifestWire = {} as ShowdownMonManifest;
const wireToManifest: ShowdownMonManifest = {} as ShowdownMonManifestWire;

/**
 * Send `msg` host -> guest over the loopback and assert it is a faithful WIRE
 * round-trip. LoopbackTransport delivers BY REFERENCE, so a naive `toStrictEqual(msg)`
 * would compare the object to itself and prove nothing about serializability. Instead
 * we compare against a JSON re-hydration (what the real WebRTC channel actually
 * carries), and separately assert that re-hydration deep-equals `msg` - a
 * serializability guard (no functions / undefined / cycles slip through the wire).
 */
async function assertWireRoundTrip(msg: CoopMessage): Promise<void> {
  const rehydrated = JSON.parse(JSON.stringify(msg)) as CoopMessage;
  // Serializability guard: the message survives a JSON round-trip byte-for-byte.
  expect(rehydrated).toStrictEqual(msg);

  const { host, guest } = createLoopbackPair();
  const received: CoopMessage[] = [];
  guest.onMessage(m => received.push(m));
  host.send(msg);
  // Loopback delivers on a microtask; awaiting yields the microtask queue so the
  // delivery (queued first) runs before this continuation resumes.
  await Promise.resolve();
  host.close();
  expect(received).toHaveLength(1);
  expect(received[0]).toStrictEqual(rehydrated);
}

const sampleOffer: ShowdownStakeOfferWire = {
  speciesId: 25,
  shiny: true,
  variant: 2,
  erBlackShiny: false,
  cost: 6,
};

const sampleManifest: ShowdownMonManifestWire = {
  speciesId: 25,
  formIndex: 0,
  level: 100,
  shiny: true,
  variant: 2,
  abilityIndex: 1,
  nature: 3,
  ivs: [31, 31, 31, 31, 31, 31],
  moveset: [85, 98, 86, 57],
  item: "LIFE_ORB",
  rootSpeciesId: 172,
};

describe("showdown wire protocol", () => {
  it("keeps wire and domain shapes structurally compatible", () => {
    // Runtime no-op; the value is the compile-time assignment above. Referencing the
    // consts here keeps them "used" (and dodges biome's noVoid) without a suppression.
    expect([stakeToWire, manifestToWire, wireToManifest]).toHaveLength(3);
  });

  it("round-trips showdownStakeOffer", async () => {
    await assertWireRoundTrip({ t: "showdownStakeOffer", offer: sampleOffer });
  });

  it("round-trips showdownStakeLock", async () => {
    await assertWireRoundTrip({ t: "showdownStakeLock", matchId: "m-1", tier: 102 });
  });

  it("round-trips showdownTeam", async () => {
    await assertWireRoundTrip({ t: "showdownTeam", manifest: [sampleManifest, sampleManifest] });
  });

  it("round-trips showdownReady", async () => {
    await assertWireRoundTrip({ t: "showdownReady", teamHash: "deadbeef" });
  });

  it("round-trips showdownCommandRequest", async () => {
    await assertWireRoundTrip({ t: "showdownCommandRequest", turn: 7 });
  });

  it("round-trips showdownCommand", async () => {
    await assertWireRoundTrip({
      t: "showdownCommand",
      turn: 7,
      command: { command: 0, cursor: 1, moveId: 85, targets: [2], useMode: 0 },
    });
  });

  it("round-trips showdownResult (escrow match)", async () => {
    await assertWireRoundTrip({ t: "showdownResult", matchId: "m-1", winner: "host", reason: "victory" });
  });

  it("round-trips showdownResult (friendly, null matchId)", async () => {
    await assertWireRoundTrip({ t: "showdownResult", matchId: null, winner: "guest", reason: "forfeit" });
  });

  it("round-trips showdownVoid (escrow match)", async () => {
    await assertWireRoundTrip({ t: "showdownVoid", matchId: "m-1", reason: "checksum" });
  });

  it("round-trips showdownVoid (friendly, null matchId)", async () => {
    await assertWireRoundTrip({ t: "showdownVoid", matchId: null, reason: "earlyDisconnect" });
  });
});

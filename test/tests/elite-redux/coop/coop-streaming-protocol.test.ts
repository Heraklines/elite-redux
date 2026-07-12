/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// Host-authoritative battle streaming protocol (#633, LIVE-D). The host is the sole
// resolution engine; these new CoopMessage variants carry the EXACT enemy party, the
// per-turn outcome stream, and the authoritative post-turn checkpoint to the guest.
// This verifies the wire shapes round-trip intact over the transport (the same
// LoopbackTransport used for the rest of the co-op suite), independent of any engine.

import type {
  CoopAuthoritativeBattleStateV1,
  CoopBattleCheckpoint,
  CoopBattleEvent,
  CoopFullMonSnapshot,
  CoopMessage,
  CoopSerializedEnemy,
} from "#data/elite-redux/coop/coop-transport";
import { createLoopbackPair } from "#data/elite-redux/coop/coop-transport";
import { describe, expect, it } from "vitest";

/** LoopbackTransport delivers on a microtask; let it drain before asserting. */
const flush = () => new Promise<void>(r => setTimeout(r, 0));

const fullField: CoopFullMonSnapshot[] = [
  {
    bi: 0,
    partyIndex: 0,
    speciesId: 1,
    hp: 1,
    maxHp: 1,
    status: 0,
    statStages: [],
    fainted: false,
    abilityId: 0,
    formIndex: 0,
    moves: [],
    tags: [],
  },
];

const authoritativeState: CoopAuthoritativeBattleStateV1 = {
  version: 1,
  tick: 2,
  wave: 1,
  turn: 1,
  playerParty: [],
  enemyParty: [],
  field: [],
  weather: 0,
  weatherTurnsLeft: 0,
  terrain: 0,
  terrainTurnsLeft: 0,
  arenaTags: [],
  money: 0,
  pokeballCounts: [],
  playerModifiers: [],
  enemyModifiers: [],
};

/** Connected pair + an inbox that collects every message the guest receives. */
function captureGuestInbox(): { host: ReturnType<typeof createLoopbackPair>["host"]; received: CoopMessage[] } {
  const { host, guest } = createLoopbackPair();
  const received: CoopMessage[] = [];
  guest.onMessage(m => received.push(m));
  return { host, received };
}

describe("co-op host-authoritative streaming protocol (#633, LIVE-D)", () => {
  it("enemyPartySync carries the host's exact enemy party to the guest", async () => {
    const { host, received } = captureGuestInbox();
    const enemies: CoopSerializedEnemy[] = [
      { fieldIndex: 2, data: { species: 265, abilityIndex: 0, ivs: [23, 7, 29, 1, 30, 24] } },
      { fieldIndex: 3, data: { species: 163, abilityIndex: 1, ivs: [27, 19, 22, 19, 9, 23] } },
    ];
    host.send({ t: "enemyPartySync", wave: 1, enemies });
    await flush();

    expect(received).toHaveLength(1);
    const msg = received[0];
    expect(msg.t).toBe("enemyPartySync");
    if (msg.t !== "enemyPartySync") {
      throw new Error("discriminant lost over the wire");
    }
    expect(msg.wave).toBe(1);
    expect(msg.enemies).toHaveLength(2);
    expect(msg.enemies[1].fieldIndex).toBe(3);
    // The opaque PokemonData blob survives intact (the guest reconstructs from it).
    expect(msg.enemies[1].data.abilityIndex).toBe(1);
    expect(msg.enemies[0].data.ivs).toEqual([23, 7, 29, 1, 30, 24]);
  });

  it("turnResolution carries the ordered event log + the authoritative checkpoint", async () => {
    const { host, received } = captureGuestInbox();
    const events: CoopBattleEvent[] = [
      { k: "message", text: "Bulbasaur used Vine Whip!" },
      { k: "moveUsed", bi: 0, moveId: 22, targets: [2] },
      { k: "hp", bi: 2, hp: 3, maxHp: 14 },
      { k: "faint", bi: 2 },
      { k: "statStage", bi: 1, stat: 1, value: -1 },
      { k: "weather", weather: 3, turnsLeft: 5 },
    ];
    const checkpoint: CoopBattleCheckpoint = {
      field: [
        {
          bi: 0,
          partyIndex: 0,
          speciesId: 1,
          hp: 17,
          maxHp: 21,
          status: 0,
          statStages: [0, 0, 0, 0, 0, 0, 0],
          fainted: false,
        },
        {
          bi: 2,
          partyIndex: 0,
          speciesId: 1,
          hp: 0,
          maxHp: 14,
          status: 0,
          statStages: [0, 0, 0, 0, 0, 0, 0],
          fainted: true,
        },
      ],
      weather: 3,
      weatherTurnsLeft: 5,
      terrain: 0,
      terrainTurnsLeft: 0,
    };
    host.send({
      t: "turnResolution",
      turn: 1,
      events,
      checkpoint,
      checksum: "abcd1234abcd1234",
      preimage: "{}",
      fullField,
      authoritativeState,
    });
    await flush();

    const msg = received[0];
    expect(msg.t).toBe("turnResolution");
    if (msg.t !== "turnResolution") {
      throw new Error("discriminant lost over the wire");
    }
    expect(msg.turn).toBe(1);
    expect(msg.events).toHaveLength(6);
    // Ordered + discriminated events survive.
    expect(msg.events[0]).toEqual({ k: "message", text: "Bulbasaur used Vine Whip!" });
    const faint = msg.events.find(e => e.k === "faint");
    expect(faint).toEqual({ k: "faint", bi: 2 });
    // The authoritative checkpoint is intact: the enemy is at 0 hp + fainted.
    const enemyState = msg.checkpoint.field.find(f => f.bi === 2);
    expect(enemyState?.hp).toBe(0);
    expect(enemyState?.fainted).toBe(true);
    expect(msg.checkpoint.weather).toBe(3);
  });

  it("battleCheckpoint carries an out-of-turn authoritative sync", async () => {
    const { host, received } = captureGuestInbox();
    const checkpoint: CoopBattleCheckpoint = {
      field: [
        {
          bi: 1,
          partyIndex: 0,
          speciesId: 1,
          hp: 20,
          maxHp: 21,
          status: 4,
          statStages: [1, 0, 0, 0, 0, 0, 0],
          fainted: false,
        },
      ],
      weather: 0,
      weatherTurnsLeft: 0,
      terrain: 0,
      terrainTurnsLeft: 0,
    };
    host.send({
      t: "battleCheckpoint",
      reason: "switch",
      checkpoint,
      checksum: "abcd1234abcd1234",
      fullField,
      authoritativeState,
    });
    await flush();

    const msg = received[0];
    expect(msg.t).toBe("battleCheckpoint");
    if (msg.t !== "battleCheckpoint") {
      throw new Error("discriminant lost over the wire");
    }
    expect(msg.reason).toBe("switch");
    expect(msg.checkpoint.field[0].status).toBe(4);
    expect(msg.checkpoint.field[0].statStages[0]).toBe(1);
  });

  it("an unknown/older client ignores a streaming message gracefully (forward-compat)", async () => {
    // A client that does not handle the new kinds simply never matches them - the
    // transport delivers, the handler's switch falls through. We model that by a
    // handler that only knows the OLD kinds; it must not throw on a new one.
    const { host, guest } = createLoopbackPair();
    let handledOld = 0;
    guest.onMessage(m => {
      switch (m.t) {
        case "ping":
          handledOld++;
          break;
        // no case for turnResolution -> ignored, no throw
      }
    });
    expect(() =>
      host.send({
        t: "turnResolution",
        turn: 1,
        events: [],
        checkpoint: { field: [], weather: 0, weatherTurnsLeft: 0, terrain: 0, terrainTurnsLeft: 0 },
        checksum: "abcd1234abcd1234",
        preimage: "{}",
        fullField,
        authoritativeState,
      }),
    ).not.toThrow();
    host.send({ t: "ping", ts: 1 });
    await flush();
    expect(handledOld).toBe(1);
  });
});

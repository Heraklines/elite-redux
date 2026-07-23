/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// Co-op host-authoritative battle STREAM (#633, LIVE-D). The host->guest wire:
// the host streams the enemy party + per-turn resolutions + out-of-turn checkpoints;
// the guest awaits each turn and renders it, never computing. Verified over a
// LoopbackTransport (the same "test via spoofing" path the rest of the suite uses).

import {
  CoopV2TurnCutover,
  clearActiveCoopV2TurnCutover,
  setActiveCoopV2TurnCutover,
} from "#data/elite-redux/coop/authority-v2/cutover-turn";
import {
  CoopBattleStreamer,
  type CoopCheckpointEnvelope,
  hasCoopV2ImmediateCommandSuccessor,
} from "#data/elite-redux/coop/coop-battle-stream";
import type { CoopAuthoritativeEnvelopeV1 } from "#data/elite-redux/coop/coop-operation-envelope";
import type {
  CoopAuthoritativeBattleStateV1,
  CoopBattleCheckpoint,
  CoopFullMonSnapshot,
  CoopMessage,
} from "#data/elite-redux/coop/coop-transport";
import { createLoopbackPair } from "#data/elite-redux/coop/coop-transport";
import { COOP_NO_FAULT_PROFILE, faultableTypes, wrapCoopFaultPair } from "#test/tools/coop-fault-transport";
import { describe, expect, it } from "vitest";

const flushWire = () => new Promise<void>(resolve => queueMicrotask(resolve));

const emptyCheckpoint = (): CoopBattleCheckpoint => ({
  tick: 19,
  field: [
    {
      bi: 0,
      partyIndex: 0,
      speciesId: 1,
      hp: 1,
      maxHp: 1,
      status: 0,
      statStages: [0, 0, 0, 0, 0, 0, 0],
      fainted: false,
    },
  ],
  weather: 0,
  weatherTurnsLeft: 0,
  terrain: 0,
  terrainTurnsLeft: 0,
});

const emptyAuthoritativeState = (wave: number, turn = 1, tick = 20): CoopAuthoritativeBattleStateV1 => ({
  version: 1,
  tick,
  wave,
  turn,
  playerParty: [{ id: 1 }],
  enemyParty: [{ id: 2 }],
  field: [{ side: "player", bi: 0, partyIndex: 0, pokemonId: 1, presented: true }],
  weather: 0,
  weatherTurnsLeft: 0,
  terrain: 0,
  terrainTurnsLeft: 0,
  arenaTags: [],
  money: 123,
  pokeballCounts: [],
  playerModifiers: [],
  enemyModifiers: [],
});

describe("Authority V2 turn successor classification", () => {
  it("states COMMAND only when no active seat or complete party crossed a non-command boundary", () => {
    const ordinary = {
      ...emptyAuthoritativeState(3),
      playerParty: [{ id: 1, hp: 20 }],
      enemyParty: [{ id: 2, hp: 20 }],
      field: [
        { side: "player" as const, bi: 0, partyIndex: 0, pokemonId: 1, presented: true },
        { side: "enemy" as const, bi: 2, partyIndex: 0, pokemonId: 2, presented: true },
      ],
    };
    expect(hasCoopV2ImmediateCommandSuccessor(ordinary)).toBe(true);

    // A just-fainted active mon with a living reserve crosses REPLACEMENT first.
    expect(
      hasCoopV2ImmediateCommandSuccessor({
        ...ordinary,
        enemyParty: [
          { id: 2, hp: 0 },
          { id: 3, hp: 20 },
        ],
      }),
    ).toBe(false);

    // A completed victory/defeat crosses wave/terminal progression, never COMMAND.
    expect(
      hasCoopV2ImmediateCommandSuccessor({
        ...ordinary,
        enemyParty: [{ id: 2, hp: 0 }],
      }),
    ).toBe(false);
    expect(
      hasCoopV2ImmediateCommandSuccessor({
        ...ordinary,
        playerParty: [{ id: 1, hp: 0 }],
      }),
    ).toBe(false);
  });

  it("states a wave/terminal boundary (not COMMAND) for a WON-wave post-summon carrier with a cleared enemy party", () => {
    // The automatic-victory faint+replacement carrier: the enemy party is DEFEATED and CLEARED the same
    // turn, so its authoritativeState has enemyParty.length === 0 and a player-only field. The only legal
    // successor is WAVE_ADVANCE; a COMMAND successor here yields a COMMAND_FRONTIER that then refuses the
    // victory's WAVE_ADVANCE and fail-closed terminates the shared session (run 29832035821).
    expect(
      hasCoopV2ImmediateCommandSuccessor({
        ...emptyAuthoritativeState(3),
        playerParty: [{ id: 1, hp: 20 }],
        enemyParty: [],
        field: [{ side: "player" as const, bi: 0, partyIndex: 0, pokemonId: 1, presented: true }],
      }),
    ).toBe(false);
  });

  it("states COMMAND for a WILD co-fainted enemy seat with no reserve (nothing refills it)", () => {
    // Real-browser faint journey (run 29838585830): a double wild battle where an enemy seat CO-FAINTS
    // alongside the just-replaced guest mon. bi3 (partyIndex 1) fainted, bi2 (partyIndex 0) is alive, and
    // BOTH enemies are on the field with NO living off-field reserve - a WILD faint crosses no replacement
    // (nothing will refill that seat). The next real successor IS the command frontier, so classifying it
    // `terminal` (as the raw field.some(hp<=0) check did) fail-closed refused the turn-2 CONTROL_COMMIT.
    expect(
      hasCoopV2ImmediateCommandSuccessor({
        ...emptyAuthoritativeState(3),
        double: true,
        playerParty: [
          { id: 1, hp: 20 },
          { id: 11, hp: 20 },
        ],
        enemyParty: [
          { id: 2, hp: 7 },
          { id: 3, hp: 0 },
        ],
        field: [
          { side: "player" as const, bi: 0, partyIndex: 0, pokemonId: 1, presented: true },
          { side: "player" as const, bi: 1, partyIndex: 1, pokemonId: 11, presented: true },
          { side: "enemy" as const, bi: 2, partyIndex: 0, pokemonId: 2, presented: true },
          { side: "enemy" as const, bi: 3, partyIndex: 1, pokemonId: 3, presented: true },
        ],
      }),
    ).toBe(true);
  });

  it("states a REPLACEMENT boundary (not COMMAND) for a co-fainted enemy seat WITH a living reserve", () => {
    // The TRAINER counterpart: an enemy seat co-faints but a living off-field reserve (partyIndex 2) will
    // be summoned to refill it (getNextSummonIndex). That IS a replacement boundary, so the settled turn
    // must NOT state an immediate command successor - it stays gated exactly as before this fix.
    expect(
      hasCoopV2ImmediateCommandSuccessor({
        ...emptyAuthoritativeState(3),
        double: true,
        playerParty: [
          { id: 1, hp: 20 },
          { id: 11, hp: 20 },
        ],
        enemyParty: [
          { id: 2, hp: 7 },
          { id: 3, hp: 0 },
          { id: 4, hp: 20 },
        ],
        field: [
          { side: "player" as const, bi: 0, partyIndex: 0, pokemonId: 1, presented: true },
          { side: "player" as const, bi: 1, partyIndex: 1, pokemonId: 11, presented: true },
          { side: "enemy" as const, bi: 2, partyIndex: 0, pokemonId: 2, presented: true },
          { side: "enemy" as const, bi: 3, partyIndex: 1, pokemonId: 3, presented: true },
        ],
      }),
    ).toBe(false);
  });

  it("keeps incomplete legacy PokemonData shapes on the compatible command path", () => {
    expect(hasCoopV2ImmediateCommandSuccessor(emptyAuthoritativeState(3))).toBe(true);
  });
});

const emptyFullField = (): CoopFullMonSnapshot[] => [
  {
    bi: 0,
    partyIndex: 0,
    speciesId: 1,
    hp: 1,
    maxHp: 1,
    status: 0,
    statStages: [0, 0, 0, 0, 0, 0, 0],
    fainted: false,
    abilityId: 0,
    formIndex: 0,
    moves: [],
    tags: [],
  },
];

function emitCompleteTurn(
  stream: CoopBattleStreamer,
  turn: number,
  events: Parameters<CoopBattleStreamer["emitTurn"]>[3],
  checkpoint: CoopBattleCheckpoint,
  checksum: string,
): void {
  stream.emitTurn(7, 1, turn, events, checkpoint, checksum, "{}", emptyFullField(), emptyAuthoritativeState(1, turn));
}

function sendCompleteCheckpoint(
  stream: CoopBattleStreamer,
  reason: string,
  checkpoint: CoopBattleCheckpoint,
  checksum: string,
  state = emptyAuthoritativeState(1),
): void {
  stream.sendCheckpoint(reason, 7, state.wave, state.turn, checkpoint, checksum, emptyFullField(), state);
}

function checkpointEnvelope(
  reason = "replacement",
  checkpoint = emptyCheckpoint(),
  checksum = "deadbeefdeadbeef",
  state = emptyAuthoritativeState(4, 2),
): CoopCheckpointEnvelope {
  return {
    reason,
    epoch: 7,
    wave: state.wave,
    turn: state.turn,
    revision: state.tick,
    checkpoint,
    checksum,
    fullField: emptyFullField(),
    authoritativeState: state,
  };
}

function acknowledgeTurnThroughContinuation(
  stream: CoopBattleStreamer,
  resolution: NonNullable<Awaited<ReturnType<CoopBattleStreamer["awaitTurn"]>>>,
  superseding?: CoopCheckpointEnvelope,
): void {
  expect(stream.acknowledgeTurnCommit(resolution, "materialApplied", superseding)).toBe(true);
  expect(stream.acknowledgeTurnCommit(resolution, "presentationReady", superseding)).toBe(true);
  expect(stream.acknowledgeTurnCommit(resolution, "continuationReady", superseding)).toBe(true);
}

function acknowledgeReplacementThroughContinuation(stream: CoopBattleStreamer, envelope: CoopCheckpointEnvelope): void {
  expect(stream.acknowledgeReplacement(envelope, "materialApplied")).toBe(true);
  expect(stream.acknowledgeReplacement(envelope, "presentationReady")).toBe(true);
  expect(stream.acknowledgeReplacement(envelope, "continuationReady")).toBe(true);
}

describe("co-op host-authoritative battle stream (#633, LIVE-D)", () => {
  it("withholds malformed host events before authority retention", () => {
    const { host } = createLoopbackPair();
    const stream = new CoopBattleStreamer(host);
    const state = emptyAuthoritativeState(1, 1, 20);

    expect(() =>
      stream.emitTurn(
        7,
        1,
        1,
        [{ k: "moveUsed", bi: 0, moveId: 1, targets: [-1] }],
        emptyCheckpoint(),
        "deadbeefdeadbeef",
        "{}",
        emptyFullField(),
        state,
      ),
    ).toThrow("malformed turn event index=0");
    expect(stream.retainedAuthorityDiagnostics().turnCommits).toBe(0);
    expect(() =>
      stream.emitTurn(
        7,
        1,
        1,
        [
          {
            k: "showAbility",
            bi: 0,
            pokemonId: 7,
            partySlot: 0,
            abilityId: 1,
            passive: true,
            passiveSlot: 32,
          } as never,
        ],
        emptyCheckpoint(),
        "deadbeefdeadbeef",
        "{}",
        emptyFullField(),
        state,
      ),
    ).toThrow("malformed turn event index=0");
    expect(stream.retainedAuthorityDiagnostics().turnCommits).toBe(0);
    expect(() =>
      stream.emitTurn(
        7,
        1,
        1,
        [{ k: "moveUsed", bi: 0, moveId: 1, targets: [] }],
        emptyCheckpoint(),
        "deadbeefdeadbeef",
        "{}",
        emptyFullField(),
        state,
      ),
    ).not.toThrow();
    expect(stream.retainedAuthorityDiagnostics().turnCommits).toBe(1);
    stream.dispose();
  });

  it("the guest adopts the host's exact enemy party", async () => {
    const { host, guest } = createLoopbackPair();
    const hostStream = new CoopBattleStreamer(host);
    const guestStream = new CoopBattleStreamer(guest);

    let got: { wave: number; count: number } | null = null;
    guestStream.onEnemyPartySync((wave, enemies) => {
      got = { wave, count: enemies.length };
    });

    hostStream.sendEnemyParty(7, [
      { fieldIndex: 2, data: { species: 1 } },
      { fieldIndex: 3, data: { species: 4 } },
    ]);
    await new Promise(r => setTimeout(r, 0));
    expect(got).toEqual({ wave: 7, count: 2 });
  });

  it("awaitEnemyParty resolves with the host's party when the guest is parked first (LIVE-D6)", async () => {
    const { host, guest } = createLoopbackPair();
    const hostStream = new CoopBattleStreamer(host);
    const guestStream = new CoopBattleStreamer(guest);

    // Guest reaches its encounter and waits BEFORE the host (still at its save-slot
    // screen) has generated - the realistic order with the launch-hang fix.
    const awaited = guestStream.awaitEnemyParty(7);
    hostStream.sendEnemyParty(7, [{ fieldIndex: 2, data: { speciesId: 163 } }]);

    const res = await awaited;
    expect(res).not.toBeNull();
    expect(res?.[0]?.data.speciesId).toBe(163);
  });

  it("awaitEnemyParty returns a party that arrived BEFORE the await (race buffer)", async () => {
    const { host, guest } = createLoopbackPair();
    const hostStream = new CoopBattleStreamer(host);
    const guestStream = new CoopBattleStreamer(guest);

    hostStream.sendEnemyParty(9, [{ fieldIndex: 2, data: { speciesId: 1 } }]);
    await new Promise(r => setTimeout(r, 0)); // let it land in the guest buffer

    const res = await guestStream.awaitEnemyParty(9);
    expect(res?.[0]?.data.speciesId).toBe(1);
  });

  it("purges a prior session's wave-keyed battle carriers before reused keys can resolve", async () => {
    const { host, guest } = createLoopbackPair();
    const hostStream = new CoopBattleStreamer(host);
    const guestStream = new CoopBattleStreamer(guest);

    hostStream.sendEnemyParty(9, [{ fieldIndex: 2, data: { speciesId: 1 } }], -1, 0, emptyAuthoritativeState(9));
    await flushWire();
    expect(guestStream.meTypeForWave(9)).toBe(-1);
    const abandonedWait = guestStream.awaitEnemyParty(10, 10_000);

    guestStream.purgeSessionBoundaryState("new session reuses wave 9");

    expect(guestStream.meTypeForWave(9)).toBeUndefined();
    expect(guestStream.battleTypeForWave(9)).toBeUndefined();
    expect(await abandonedWait, "the prior phase cannot steal the new session's wave carrier").toBeNull();
    expect(await guestStream.awaitEnemyParty(9, 1)).toBeNull();
    hostStream.sendEnemyParty(10, [{ fieldIndex: 2, data: { speciesId: 4 } }], -1, 0, emptyAuthoritativeState(10));
    expect((await guestStream.awaitEnemyParty(10))?.[0]?.data.speciesId).toBe(4);
  });

  it("retains the complete new-wave state across encounter peek until command consumes it", async () => {
    const { host, guest } = createLoopbackPair();
    const hostStream = new CoopBattleStreamer(host);
    const guestStream = new CoopBattleStreamer(guest);
    const state = emptyAuthoritativeState(9);

    hostStream.sendEnemyParty(9, [{ fieldIndex: 2, data: { speciesId: 1 } }], -1, 0, state);
    await guestStream.awaitEnemyParty(9);

    expect(guestStream.peekEnemyPartyState(9)).toEqual(state);
    expect(guestStream.peekEnemyPartyState(9), "encounter presentation does not consume the command seal").toEqual(
      state,
    );
    expect(guestStream.consumeEnemyPartyState(9)).toEqual(state);
    expect(guestStream.consumeEnemyPartyState(9), "boundary state is one-shot").toBeUndefined();
  });

  it("keeps the newest complete wave state when an older enemy-party carrier is replayed", async () => {
    const { host, guest } = createLoopbackPair();
    const hostStream = new CoopBattleStreamer(host);
    const guestStream = new CoopBattleStreamer(guest);
    const older = emptyAuthoritativeState(9);
    const newer = { ...older, tick: older.tick + 1, money: 999 };

    hostStream.sendEnemyParty(9, [{ fieldIndex: 2, data: { speciesId: 1 } }], -1, 0, newer);
    await guestStream.awaitEnemyParty(9);
    hostStream.sendEnemyParty(9, [{ fieldIndex: 2, data: { speciesId: 1 } }], -1, 0, older);
    await flushWire();

    expect(guestStream.peekEnemyPartyState(9), "a delayed lower tick cannot replace the command seal").toEqual(newer);
    expect(
      guestStream.consumeEnemyParty(9),
      "a delayed lower tick cannot repopulate the party half of the same carrier",
    ).toBeNull();
  });

  it("delivers a retained Showdown entry prefix exactly once across duplicate carriers", async () => {
    const { host, guest } = createLoopbackPair();
    const hostStream = new CoopBattleStreamer(host);
    const guestStream = new CoopBattleStreamer(guest);
    const state = emptyAuthoritativeState(9);
    const entryPresentation = [
      {
        k: "showAbility" as const,
        bi: 2,
        pokemonId: 77,
        partySlot: 0,
        abilityId: 22,
        passive: false,
        passiveSlot: 0 as const,
      },
      { k: "terrain" as const, terrain: 1, turnsLeft: 5, anim: 7 },
    ];

    hostStream.sendEnemyParty(
      9,
      [{ fieldIndex: 2, data: { speciesId: 77 } }],
      -1,
      0,
      state,
      undefined,
      entryPresentation,
    );
    hostStream.sendEnemyParty(
      9,
      [{ fieldIndex: 2, data: { speciesId: 999 } }],
      -1,
      0,
      { ...state, tick: state.tick + 1 },
      undefined,
      entryPresentation,
    );
    await flushWire();
    await expect(guestStream.awaitEntryPresentation(9)).resolves.toEqual({
      events: entryPresentation,
      stateTick: state.tick,
    });

    hostStream.sendEnemyParty(
      9,
      [{ fieldIndex: 2, data: { speciesId: 77 } }],
      -1,
      0,
      state,
      undefined,
      entryPresentation,
    );
    await flushWire();
    expect(guestStream.consumeEntryPresentation(9), "a duplicate retained carrier cannot replay the prefix").toBeNull();
    await expect(
      guestStream.awaitEntryPresentation(9, { timeoutMs: 5 }),
      "a reconstructed turn-1 phase completes immediately after the exact prefix was already consumed",
    ).resolves.toEqual({ events: [], stateTick: 0 });
  });

  it("rejects malformed or unbounded Showdown entry presentation before retaining it", () => {
    const { host } = createLoopbackPair();
    const hostStream = new CoopBattleStreamer(host);
    const state = emptyAuthoritativeState(9);
    const enemies = [{ fieldIndex: 2, data: { speciesId: 77 } }];

    expect(() =>
      hostStream.sendEnemyParty(9, enemies, -1, 0, state, undefined, [
        {
          k: "showAbility",
          bi: 2,
          pokemonId: 77,
          partySlot: 0,
          abilityId: 0,
          passive: false,
          passiveSlot: 0,
        },
      ]),
    ).toThrow("malformed entry presentation");
    expect(() =>
      hostStream.sendEnemyParty(
        9,
        enemies,
        -1,
        0,
        state,
        undefined,
        Array.from({ length: 257 }, () => ({ k: "terrain" as const, terrain: 1, turnsLeft: 5, anim: 7 })),
      ),
    ).toThrow("events=257");
    expect(() =>
      hostStream.sendEnemyParty(9, enemies, -1, 0, undefined, undefined, [
        { k: "terrain", terrain: 1, turnsLeft: 5, anim: 7 },
      ]),
    ).toThrow("without its exact wave-start state");
  });

  it("retires a mystery selector carrier without blocking a newer same-wave battle carrier", async () => {
    const { host, guest } = createLoopbackPair();
    const hostStream = new CoopBattleStreamer(host);
    const guestStream = new CoopBattleStreamer(guest);
    const selector = emptyAuthoritativeState(32, 1, 193);

    hostStream.sendEnemyParty(32, [], 4, 3, selector);
    await flushWire();
    guestStream.retireEnemyPartyAuthorityThrough(32, 197);

    expect(guestStream.consumeEnemyParty(32), "the buffered selector party is retired").toBeNull();
    expect(guestStream.consumeEnemyPartyState(32), "the buffered selector state is retired").toBeUndefined();
    expect(guestStream.meTypeForWave(32), "the buffered selector descriptor is retired").toBeUndefined();

    hostStream.sendEnemyParty(32, [], 4, 3, selector);
    await flushWire();
    expect(guestStream.consumeEnemyParty(32), "a delayed selector replay stays retired").toBeNull();
    expect(guestStream.consumeEnemyPartyState(32)).toBeUndefined();

    const spawnedBattle = { ...emptyAuthoritativeState(32, 1, 198), enemyParty: [{ id: 77 }] };
    hostStream.sendEnemyParty(32, [{ fieldIndex: 2, data: { speciesId: 77 } }], 4, 0, spawnedBattle);
    await flushWire();
    const admitted = guestStream.consumeEnemyPartyAuthority(32);
    expect(admitted.enemies?.[0]?.data.speciesId, "a causally newer same-wave battle party is admitted").toBe(77);
    expect(admitted.state, "the newer state stays paired with its party").toEqual(spawnedBattle);
  });

  it("bounds unconsumed event-only wave states to the latest four waves", async () => {
    const { host, guest } = createLoopbackPair();
    const hostStream = new CoopBattleStreamer(host);
    const guestStream = new CoopBattleStreamer(guest);

    for (let wave = 1; wave <= 5; wave++) {
      hostStream.sendEnemyParty(wave, [], -1, 3, { ...emptyAuthoritativeState(wave), tick: wave });
      await guestStream.awaitEnemyParty(wave);
    }

    expect(
      guestStream.peekEnemyPartyState(1),
      "an event-only wave cannot leak forever without CommandPhase",
    ).toBeUndefined();
    expect(guestStream.peekEnemyPartyState(2)).toBeDefined();
    expect(guestStream.peekEnemyPartyState(5)).toBeDefined();
  });

  it("rejects complete wave state addressed to a different carrier wave", async () => {
    const { host, guest } = createLoopbackPair();
    const hostStream = new CoopBattleStreamer(host);
    const guestStream = new CoopBattleStreamer(guest);

    hostStream.sendEnemyParty(9, [], -1, 3, { ...emptyAuthoritativeState(8), wave: 8 });
    await guestStream.awaitEnemyParty(9);

    expect(guestStream.peekEnemyPartyState(9)).toBeUndefined();
  });

  it("fails closed when equal-tick enemy-party authority changes", async () => {
    const { host, guest } = createLoopbackPair();
    const current = { epoch: 7, wave: 9, turn: 1 };
    const hostStream = new CoopBattleStreamer(host, { authorityContext: () => current });
    const guestStream = new CoopBattleStreamer(guest, { authorityContext: () => current });
    const first = { ...emptyAuthoritativeState(9), tick: 12, money: 100 };
    const conflicting = { ...first, money: 101 };

    hostStream.sendEnemyParty(9, [], -1, 3, first);
    await guestStream.awaitEnemyParty(9);
    hostStream.sendEnemyParty(9, [], -1, 3, conflicting);
    await flushWire();

    expect(guestStream.retainedAuthorityDiagnostics().terminal).toBe(true);
  });

  it("awaitEnemyParty resolves null on timeout (guest then generates its own - never hangs)", async () => {
    const { guest } = createLoopbackPair();
    const timer: { fire?: () => void } = {};
    const guestStream = new CoopBattleStreamer(guest, {
      schedule: cb => {
        timer.fire = cb;
        return () => {};
      },
    });

    const awaited = guestStream.awaitEnemyParty(3, 1000);
    expect(timer.fire).toBeDefined();
    timer.fire?.(); // simulate the timeout firing
    expect(await awaited).toBeNull();
  });

  it("awaitEnemyParty for one wave is NOT satisfied by a stale OTHER wave's party", async () => {
    const { host, guest } = createLoopbackPair();
    const hostStream = new CoopBattleStreamer(host);
    const timer: { fire?: () => void } = {};
    const guestStream = new CoopBattleStreamer(guest, {
      schedule: cb => {
        timer.fire = cb;
        return () => {};
      },
    });

    // Host sends wave 5; the guest is waiting on wave 6 -> the stale party never
    // satisfies it, and it times out to null (then rolls its own).
    hostStream.sendEnemyParty(5, [{ fieldIndex: 2, data: { speciesId: 1 } }]);
    const awaited = guestStream.awaitEnemyParty(6, 1000);
    await new Promise(r => setTimeout(r, 0));
    timer.fire?.();
    expect(await awaited).toBeNull();
  });

  it("a turn resolution the guest is awaiting is delivered (host -> guest lockstep replacement)", async () => {
    const { host, guest } = createLoopbackPair();
    const hostStream = new CoopBattleStreamer(host);
    const guestStream = new CoopBattleStreamer(guest);

    const awaited = guestStream.awaitTurn(1);
    emitCompleteTurn(
      hostStream,
      1,
      [{ k: "message", text: "Bulbasaur fainted!" }],
      emptyCheckpoint(),
      "deadbeefdeadbeef",
    );

    const res = await awaited;
    expect(res).not.toBeNull();
    expect(res?.turn).toBe(1);
    expect(res?.events[0]).toEqual({ k: "message", text: "Bulbasaur fainted!" });
  });

  it("a resolution that arrives BEFORE the guest awaits is buffered and returned (race fix)", async () => {
    const { host, guest } = createLoopbackPair();
    const hostStream = new CoopBattleStreamer(host);
    const guestStream = new CoopBattleStreamer(guest);

    // Host is faster: it sends turn 2 before the guest reaches its await.
    emitCompleteTurn(hostStream, 2, [{ k: "faint", bi: 2 }], emptyCheckpoint(), "deadbeefdeadbeef");
    await new Promise(r => setTimeout(r, 0)); // let it land in the guest buffer

    const res = await guestStream.awaitTurn(2);
    expect(res).not.toBeNull();
    expect(res?.events[0]).toEqual({ k: "faint", bi: 2 });
  });

  it("a turn that never arrives resolves null after the timeout (guest shows 'waiting')", async () => {
    const { host, guest } = createLoopbackPair();
    new CoopBattleStreamer(host);
    // Fire the timeout immediately (no host emit).
    const guestStream = new CoopBattleStreamer(guest, {
      timeoutMs: 1,
      schedule: cb => {
        cb();
        return () => {};
      },
    });
    const res = await guestStream.awaitTurn(1);
    expect(res).toBeNull();
  });

  it("runtime-drops a malformed protocol-31 turn instead of buffering partial authority", async () => {
    const { host, guest } = createLoopbackPair();
    const timer: { fire?: () => void } = {};
    const guestStream = new CoopBattleStreamer(guest, {
      schedule: cb => {
        timer.fire = cb;
        return () => {};
      },
    });
    const awaited = guestStream.awaitTurn(1);
    host.send({
      t: "turnResolution",
      turn: 1,
      events: [],
      checkpoint: emptyCheckpoint(),
      checksum: "deadbeefdeadbeef",
    } as unknown as CoopMessage);
    await new Promise(r => setTimeout(r, 0));
    timer.fire?.();
    expect(await awaited).toBeNull();
  });

  it("a second await for the same addressed turn joins the in-flight authority result", async () => {
    const { host, guest } = createLoopbackPair();
    const hostStream = new CoopBattleStreamer(host);
    const guestStream = new CoopBattleStreamer(guest);

    const first = guestStream.awaitTurn(1);
    const second = guestStream.awaitTurn(1);
    emitCompleteTurn(hostStream, 1, [], emptyCheckpoint(), "deadbeefdeadbeef");

    expect(await first).not.toBeNull();
    expect(await second).toEqual(await first);
  });

  it("consumeEnemyParty returns the host's party for the matching wave, then clears it", async () => {
    const { host, guest } = createLoopbackPair();
    const hostStream = new CoopBattleStreamer(host);
    const guestStream = new CoopBattleStreamer(guest);

    hostStream.sendEnemyParty(3, [{ fieldIndex: 0, data: { species: 265, abilityIndex: 1 } }]);
    await new Promise(r => setTimeout(r, 0));

    // Wrong wave -> nothing (the guest never adopts a stale wave's enemies).
    expect(guestStream.consumeEnemyParty(2)).toBeNull();
    // Right wave -> the party, and it is consumed (one-shot).
    const enemies = guestStream.consumeEnemyParty(3);
    expect(enemies).not.toBeNull();
    expect(enemies?.[0].data.abilityIndex).toBe(1);
    expect(guestStream.consumeEnemyParty(3)).toBeNull();
  });

  it("out-of-turn checkpoints reach the guest's handler", async () => {
    const { host, guest } = createLoopbackPair();
    const hostStream = new CoopBattleStreamer(host);
    const guestStream = new CoopBattleStreamer(guest);

    let reason: string | null = null;
    guestStream.onCheckpoint(r => {
      reason = r;
    });
    sendCompleteCheckpoint(hostStream, "switch", emptyCheckpoint(), "deadbeefdeadbeef");
    await new Promise(r => setTimeout(r, 0));
    expect(reason).toBe("switch");
  });

  it("a replacement retransmit request with no retained host frame emits nothing", async () => {
    const { host, guest } = createLoopbackPair();
    const hostStream = new CoopBattleStreamer(host);
    const guestStream = new CoopBattleStreamer(guest);
    let arrivals = 0;
    guestStream.onCheckpointEnvelope(() => arrivals++);

    guestStream.requestReplacementCheckpoint(checkpointEnvelope());
    await new Promise(r => setTimeout(r, 0));

    expect(arrivals).toBe(0);
    expect(guestStream.peekCheckpoint()).toBeNull();
    hostStream.dispose();
    guestStream.dispose();
  });

  it("a held safe boundary can observe the complete replacement envelope without stealing the legacy observer", async () => {
    const { host, guest } = createLoopbackPair();
    const hostStream = new CoopBattleStreamer(host);
    const guestStream = new CoopBattleStreamer(guest);
    const checkpoint = { ...emptyCheckpoint(), tick: 19 };
    const state = { ...emptyAuthoritativeState(4), tick: 20, turn: 2 };
    const legacyReasons: string[] = [];
    const envelopes: { reason: string; checkpointTick: number | undefined; stateTick: number | undefined }[] = [];

    guestStream.onCheckpoint(reason => legacyReasons.push(reason));
    const unsubscribeThrowingObserver = guestStream.onCheckpointEnvelope(() => {
      throw new Error("observer failure must be isolated");
    });
    const unsubscribe = guestStream.onCheckpointEnvelope(envelope => {
      envelopes.push({
        reason: envelope.reason,
        checkpointTick: envelope.checkpoint.tick,
        stateTick: envelope.authoritativeState?.tick,
      });
    });
    const replayWake = guestStream.awaitTurnOrLiveEvent(2, 0);

    sendCompleteCheckpoint(hostStream, "replacement", checkpoint, "deadbeefdeadbeef", state);
    await new Promise(r => setTimeout(r, 0));

    expect(await replayWake, "a throwing observer did not suppress the replay-pump waiter").toEqual({
      kind: "checkpoint",
    });
    expect(envelopes).toEqual([{ reason: "replacement", checkpointTick: 19, stateTick: 20 }]);
    expect(legacyReasons, "a throwing envelope observer did not suppress the legacy fan-out").toEqual(["replacement"]);
    expect(guestStream.peekCheckpoint()?.authoritativeState?.turn).toBe(2);
    expect(guestStream.consumeCheckpoint()?.reason).toBe("replacement");
    expect(guestStream.peekCheckpoint()).toBeNull();

    // A failed safe-boundary apply requests the host's retained frame. This must create a SECOND real
    // envelope notification (not merely re-read the guest's old object), enabling same-tick idempotent retry.
    guestStream.requestReplacementCheckpoint(checkpointEnvelope("replacement", checkpoint, "deadbeefdeadbeef", state));
    await new Promise(r => setTimeout(r, 0));
    expect(envelopes).toHaveLength(2);
    expect(guestStream.consumeCheckpoint()?.authoritativeState?.tick).toBe(20);

    unsubscribe();
    unsubscribeThrowingObserver();
    sendCompleteCheckpoint(hostStream, "later", { ...emptyCheckpoint(), tick: 21 }, "cafebabecafebabe", {
      ...state,
      tick: 22,
    });
    await new Promise(r => setTimeout(r, 0));
    expect(envelopes, "the temporary recovery observer was removed").toHaveLength(2);
    expect(
      legacyReasons,
      "the independent legacy observer sees the requested retransmit and remains installed",
    ).toEqual(["replacement", "replacement", "later"]);
    guestStream.dispose();
    hostStream.dispose();
  });

  it("arbitrates same-turn final and replacement authority by revision", async () => {
    const makePair = () => {
      const { host, guest } = createLoopbackPair();
      const current = { epoch: 7, wave: 1, turn: 1 };
      return {
        hostStream: new CoopBattleStreamer(host, { authorityContext: () => current }),
        guestStream: new CoopBattleStreamer(guest, { authorityContext: () => current }),
      };
    };

    const olderReplacement = makePair();
    sendCompleteCheckpoint(
      olderReplacement.hostStream,
      "replacement",
      { ...emptyCheckpoint(), tick: 19 },
      "2020202020202020",
      emptyAuthoritativeState(1, 1, 20),
    );
    olderReplacement.hostStream.emitTurn(
      7,
      1,
      1,
      [],
      { ...emptyCheckpoint(), tick: 21 },
      "2222222222222222",
      "{}",
      emptyFullField(),
      emptyAuthoritativeState(1, 1, 22),
    );
    await flushWire();
    const finalWon = await olderReplacement.guestStream.awaitTurnOrLiveEvent(1, 0);
    expect(finalWon.kind, "revision 20 replacement cannot strand revision 22 final authority").toBe("turn");
    if (finalWon.kind === "turn") {
      expect(finalWon.res?.revision).toBe(22);
    }
    olderReplacement.hostStream.dispose();
    olderReplacement.guestStream.dispose();

    const newerReplacement = makePair();
    newerReplacement.hostStream.emitTurn(
      7,
      1,
      1,
      [],
      { ...emptyCheckpoint(), tick: 21 },
      "2222222222222222",
      "{}",
      emptyFullField(),
      emptyAuthoritativeState(1, 1, 22),
    );
    sendCompleteCheckpoint(
      newerReplacement.hostStream,
      "replacement",
      { ...emptyCheckpoint(), tick: 23 },
      "2424242424242424",
      emptyAuthoritativeState(1, 1, 24),
    );
    await flushWire();
    await expect(newerReplacement.guestStream.awaitTurnOrLiveEvent(1, 0)).resolves.toEqual({ kind: "checkpoint" });
    newerReplacement.hostStream.dispose();
    newerReplacement.guestStream.dispose();
  });

  it("does not let an older checkpoint win the parked-waiter promise microtask race", async () => {
    const { host, guest } = createLoopbackPair();
    const current = { epoch: 7, wave: 1, turn: 1 };
    const hostStream = new CoopBattleStreamer(host, { authorityContext: () => current });
    const guestStream = new CoopBattleStreamer(guest, { authorityContext: () => current });
    const raced = guestStream.awaitTurnOrLiveEvent(1, 0);

    hostStream.emitTurn(
      7,
      1,
      1,
      [],
      { ...emptyCheckpoint(), tick: 21 },
      "2222222222222222",
      "{}",
      emptyFullField(),
      emptyAuthoritativeState(1, 1, 22),
    );
    sendCompleteCheckpoint(
      hostStream,
      "replacement",
      { ...emptyCheckpoint(), tick: 19 },
      "2020202020202020",
      emptyAuthoritativeState(1, 1, 20),
    );

    const winner = await raced;
    expect(winner.kind).toBe("turn");
    if (winner.kind === "turn") {
      expect(winner.res?.revision).toBe(22);
    }
    hostStream.dispose();
    guestStream.dispose();
  });

  describe("protocol-33 retained authority transactions", () => {
    const context = () => ({ epoch: 7, wave: 1, turn: 1 });

    it("accepts production string-enum battler tags in a complete carrier", async () => {
      const { host, guest } = createLoopbackPair();
      const hostStream = new CoopBattleStreamer(host, { authorityContext: context });
      const guestStream = new CoopBattleStreamer(guest, { authorityContext: context });
      const fullField = emptyFullField();
      // BattlerTagType is a string enum at runtime even though the historical snapshot type used an
      // unsafe numeric cast.  This used to make a real SEEDED/ENCORE turn disappear as "malformed".
      fullField[0].tags = ["SEEDED" as never];

      const awaited = guestStream.awaitTurn(1);
      hostStream.emitTurn(
        7,
        1,
        1,
        [],
        emptyCheckpoint(),
        "deadbeefdeadbeef",
        "{}",
        fullField,
        emptyAuthoritativeState(1),
      );

      expect((await awaited)?.fullField[0].tags).toEqual(["SEEDED"]);
      hostStream.dispose();
      guestStream.dispose();
    });

    it("rejects numeric battler tags because no numeric-to-string enum mapping can converge", () => {
      const { host } = createLoopbackPair();
      const hostStream = new CoopBattleStreamer(host, { authorityContext: context });
      const fullField = emptyFullField();
      fullField[0].tags = [1];

      expect(() =>
        hostStream.emitTurn(
          7,
          1,
          1,
          [],
          emptyCheckpoint(),
          "deadbeefdeadbeef",
          "{}",
          fullField,
          emptyAuthoritativeState(1),
        ),
      ).toThrow("refusing malformed turn commit");
      hostStream.dispose();
    });

    it("recovers a dropped turn commit, re-ACKs a dropped ACK, and applies observers once", async () => {
      const pair = wrapCoopFaultPair(createLoopbackPair(), COOP_NO_FAULT_PROFILE, { seed: 0x50333231 });
      const hostRetryTimers: (() => void)[] = [];
      const current = { epoch: 7, wave: 1, turn: 1 };
      const hostStream = new CoopBattleStreamer(pair.host, {
        authorityContext: () => current,
        schedule: cb => {
          hostRetryTimers.push(cb);
          return () => {};
        },
      });
      const guestStream = new CoopBattleStreamer(pair.guest, { authorityContext: () => current });
      let appliedDeliveries = 0;
      let pendingReplies = 0;
      guestStream.onTurnCommit(() => appliedDeliveries++);
      pair.guest.onMessage(msg => {
        if (msg.t === "turnCommitPending") {
          pendingReplies++;
        }
      });

      pair.armNextDrop("turnResolution", "host");
      const awaited = guestStream.awaitTurn(1);
      emitCompleteTurn(hostStream, 1, [{ k: "message", text: "retained" }], emptyCheckpoint(), "deadbeefdeadbeef");
      await flushWire();
      expect(pair.counters.host.oneShotDropped, "the first commit was actually lost").toBe(1);

      guestStream.requestTurnCommit(7, 1, 1);
      const resolution = await awaited;
      expect(resolution?.events).toEqual([{ k: "message", text: "retained" }]);
      expect(appliedDeliveries).toBe(1);

      expect(guestStream.acknowledgeTurnCommit(resolution!, "materialApplied")).toBe(true);
      expect(guestStream.acknowledgeTurnCommit(resolution!, "presentationReady")).toBe(true);
      pair.armNextDrop("turnCommitAck", "guest");
      expect(guestStream.acknowledgeTurnCommit(resolution!, "continuationReady")).toBe(true);
      await flushWire();
      current.wave = 2;
      current.turn = 1;
      hostRetryTimers.shift()?.();
      await flushWire();
      expect(appliedDeliveries, "the production host retry was re-ACKed before observer/apply fan-out").toBe(1);
      expect(
        hostStream.retainedAuthorityDiagnostics().turnCommits,
        "the successful exact re-ACK releases authority",
      ).toBe(0);

      const pendingBefore = pendingReplies;
      guestStream.requestTurnCommit(7, 1, 1, resolution!.revision);
      await flushWire();
      expect(pendingReplies, "a released old-address commit does not manufacture a pending reply").toBe(pendingBefore);
      hostStream.dispose();
      guestStream.dispose();
    });

    it("retains mechanically applied turns until the exact delayed public continuation opens", async () => {
      const { host, guest } = createLoopbackPair();
      const current = { epoch: 7, wave: 1, turn: 1 };
      const hostStream = new CoopBattleStreamer(host, { authorityContext: () => current });
      const guestStream = new CoopBattleStreamer(guest, { authorityContext: () => current });
      let rawTurnDeliveries = 0;
      let pendingReplies = 0;
      guest.onMessage(message => {
        if (message.t === "turnResolution") {
          rawTurnDeliveries++;
        }
        if (message.t === "turnCommitPending") {
          pendingReplies++;
        }
      });

      const awaited = guestStream.awaitTurn(1);
      emitCompleteTurn(hostStream, 1, [], emptyCheckpoint(), "deadbeefdeadbeef");
      const resolution = await awaited;
      expect(resolution).not.toBeNull();
      // Drain the initial revisionless rendezvous request and the exact request issued when awaitTurn
      // resolves. The probe below then measures one deliberate retained replay, independent of queued
      // transport microtasks.
      await flushWire();
      const baseline = rawTurnDeliveries;

      expect(guestStream.acknowledgeTurnCommit(resolution!, "materialApplied")).toBe(true);
      expect(guestStream.acknowledgeTurnCommit(resolution!, "presentationReady")).toBe(true);
      expect(
        guestStream.registerTurnContinuation(resolution!, undefined, {
          kind: "command",
          epoch: 7,
          wave: 1,
          turn: 2,
        }),
      ).toBe(true);
      await flushWire();

      expect(guestStream.notifyContinuationSurface("command"), "the old turn's UI cannot release retention").toBe(0);
      guestStream.requestTurnCommit(7, 1, 1, resolution!.revision);
      await flushWire();
      expect(rawTurnDeliveries, "material + renderer convergence remain replayable while UI is delayed").toBe(
        baseline + 1,
      );

      current.turn = 2;
      expect(guestStream.notifyContinuationSurface("command"), "the exact next command surface releases once").toBe(1);
      await flushWire();
      const beforeClearedProbe = rawTurnDeliveries;
      const pendingBefore = pendingReplies;
      guestStream.requestTurnCommit(7, 1, 1, resolution!.revision);
      await flushWire();
      expect(rawTurnDeliveries).toBe(beforeClearedProbe);
      expect(pendingReplies).toBeGreaterThan(pendingBefore);

      hostStream.dispose();
      guestStream.dispose();
    });

    it("accepts an exact next-turn renderer waiter when no local command owner exists", async () => {
      const { host, guest } = createLoopbackPair();
      const current = { epoch: 7, wave: 1, turn: 1 };
      const hostStream = new CoopBattleStreamer(host, { authorityContext: () => current });
      const guestStream = new CoopBattleStreamer(guest, { authorityContext: () => current });

      const awaited = guestStream.awaitTurn(1);
      emitCompleteTurn(hostStream, 1, [], emptyCheckpoint(), "deadbeefdeadbeef");
      const resolution = await awaited;
      expect(resolution).not.toBeNull();
      expect(guestStream.acknowledgeTurnCommit(resolution!, "materialApplied")).toBe(true);
      expect(guestStream.acknowledgeTurnCommit(resolution!, "presentationReady")).toBe(true);
      expect(
        guestStream.registerTurnContinuation(resolution!, undefined, {
          kind: "command",
          epoch: 7,
          wave: 1,
          turn: 2,
        }),
      ).toBe(true);

      expect(guestStream.notifyContinuationSurface("rendererWait"), "old-turn replay cannot release").toBe(0);
      current.turn = 2;
      expect(guestStream.notifyContinuationSurface("rendererWait"), "installed exact replay waiter releases").toBe(1);
      expect(guestStream.notifyContinuationSurface("rendererWait"), "renderer readiness is exactly once").toBe(0);

      hostStream.dispose();
      guestStream.dispose();
    });

    it("accepts an exact-address reward surface when wave-end authority arrives after the next-command prediction", async () => {
      const { host, guest } = createLoopbackPair();
      const current = { epoch: 7, wave: 1, turn: 3 };
      const hostStream = new CoopBattleStreamer(host, { authorityContext: () => current });
      const guestStream = new CoopBattleStreamer(guest, { authorityContext: () => current });

      const awaited = guestStream.awaitTurn(3);
      emitCompleteTurn(hostStream, 3, [], emptyCheckpoint(), "deadbeefdeadbeef");
      const resolution = await awaited;
      expect(resolution).not.toBeNull();
      expect(guestStream.acknowledgeTurnCommit(resolution!, "materialApplied")).toBe(true);
      expect(guestStream.acknowledgeTurnCommit(resolution!, "presentationReady")).toBe(true);
      expect(
        guestStream.registerTurnContinuation(resolution!, undefined, {
          kind: "command",
          epoch: 7,
          wave: 1,
          turn: 4,
        }),
        "the guest predicts command before the delayed wave-end signal is visible",
      ).toBe(true);

      expect(
        guestStream.notifyContinuationSurface("sharedInput"),
        "the old turn's reward surface cannot release the retained turn",
      ).toBe(0);
      current.turn = 4;
      expect(
        guestStream.notifyContinuationSurface("sharedInput"),
        "the renderer-active reward surface at the exact predicted address is valid continuation proof",
      ).toBe(1);
      expect(guestStream.notifyContinuationSurface("sharedInput"), "continuation releases exactly once").toBe(0);

      hostStream.dispose();
      guestStream.dispose();
    });

    it("accepts wave+1 turn 1 only after the exact wave-advance carrier is admitted", async () => {
      const { host, guest } = createLoopbackPair();
      const current = { epoch: 7, wave: 1, turn: 3 };
      const hostStream = new CoopBattleStreamer(host, { authorityContext: () => current });
      const guestStream = new CoopBattleStreamer(guest, { authorityContext: () => current });

      const awaited = guestStream.awaitTurn(3);
      emitCompleteTurn(hostStream, 3, [], emptyCheckpoint(), "deadbeefdeadbeef");
      const resolution = await awaited;
      expect(resolution).not.toBeNull();
      expect(guestStream.acknowledgeTurnCommit(resolution!, "materialApplied")).toBe(true);
      expect(guestStream.acknowledgeTurnCommit(resolution!, "presentationReady")).toBe(true);
      expect(
        guestStream.registerTurnContinuation(resolution!, undefined, {
          kind: "command",
          epoch: 7,
          wave: 1,
          turn: 4,
        }),
      ).toBe(true);

      current.wave = 2;
      current.turn = 1;
      expect(
        guestStream.notifyContinuationSurface("command"),
        "a next-wave surface cannot release an unproven next-command prediction",
      ).toBe(0);
      expect(guestStream.noteWaveAdvanceAdmitted(8, 1)).toBe(true);
      expect(guestStream.notifyContinuationSurface("command"), "wrong-epoch carriers cannot release").toBe(0);
      expect(guestStream.noteWaveAdvanceAdmitted(7, 2)).toBe(true);
      expect(guestStream.notifyContinuationSurface("command"), "wrong-wave carriers cannot release").toBe(0);
      expect(guestStream.noteWaveAdvanceAdmitted(7, 1)).toBe(true);
      expect(guestStream.noteWaveAdvanceAdmitted(7, 1), "duplicate admission is idempotent").toBe(false);

      current.wave = 3;
      expect(guestStream.notifyContinuationSurface("command"), "later unrelated waves remain fenced").toBe(0);
      current.wave = 2;
      expect(
        guestStream.notifyContinuationSurface("command"),
        "wave+1 turn 1 releases after exact terminal admission",
      ).toBe(1);
      expect(guestStream.notifyContinuationSurface("command"), "continuation releases exactly once").toBe(0);

      hostStream.dispose();
      guestStream.dispose();
    });

    it("keeps the immutable admission ledger separate from a renderer-mutated working copy", async () => {
      const { host, guest } = createLoopbackPair();
      const authorityContext = () => ({ epoch: 7, wave: 1, turn: 1 });
      const hostStream = new CoopBattleStreamer(host, { authorityContext });
      const guestStream = new CoopBattleStreamer(guest, { authorityContext });
      const redeliveries: CoopAuthoritativeBattleStateV1[] = [];
      guestStream.onTurnCommit(delivered => redeliveries.push(delivered.authoritativeState));

      const awaited = guestStream.awaitTurn(1);
      emitCompleteTurn(hostStream, 1, [{ k: "message", text: "immutable" }], emptyCheckpoint(), "deadbeefdeadbeef");
      const resolution = await awaited;
      expect(resolution).not.toBeNull();

      // Production materializers normalize nested state while applying it. This disposable delivery may move,
      // while the admission ledger and retransmitted authority must stay byte-identical to the wire commit.
      resolution!.authoritativeState.money = 999;
      resolution!.fullField[0].hp = 0;
      resolution!.events.push({ k: "message", text: "renderer-only mutation" });
      guestStream.requestTurnCommitRetry(7, 1, 1, resolution!.revision);
      await flushWire();

      expect(redeliveries.at(-1)?.money, "retry rehydrates the original admitted authority").toBe(123);
      expect(guestStream.acknowledgeTurnCommit(resolution!, "materialApplied")).toBe(true);
      expect(guestStream.acknowledgeTurnCommit(resolution!, "presentationReady")).toBe(true);
      expect(guestStream.acknowledgeTurnCommit(resolution!, "continuationReady")).toBe(true);
      expect(
        guestStream.retainedAuthorityDiagnostics().terminal,
        "a valid applied commit never enters fatal recovery",
      ).toBe(false);

      hostStream.dispose();
      guestStream.dispose();
    });

    it("fails both peers closed when continuation evidence skips mandatory stages", async () => {
      const { host, guest } = createLoopbackPair();
      const authorityContext = () => ({ epoch: 7, wave: 1, turn: 1 });
      const hostStream = new CoopBattleStreamer(host, { authorityContext });
      const guestStream = new CoopBattleStreamer(guest, { authorityContext });
      const awaited = guestStream.awaitTurn(1);
      emitCompleteTurn(hostStream, 1, [], emptyCheckpoint(), "deadbeefdeadbeef");
      const resolution = await awaited;

      expect(guestStream.acknowledgeTurnCommit(resolution!, "continuationReady")).toBe(false);
      await flushWire();
      await flushWire();
      expect(guestStream.retainedAuthorityDiagnostics().terminal).toBe(true);
      expect(
        hostStream.retainedAuthorityDiagnostics().terminal,
        "the local progression failure uses the shared fatal contract",
      ).toBe(true);

      hostStream.dispose();
      guestStream.dispose();
    });

    it.each([
      ["missing stage", undefined, 20],
      ["wrong address", "materialApplied", 21],
    ] as const)("fails both peers closed for a %s ACK", async (_label, stage, revision) => {
      const { host, guest } = createLoopbackPair();
      const authorityContext = () => ({ epoch: 7, wave: 1, turn: 1 });
      const hostStream = new CoopBattleStreamer(host, { authorityContext });
      const guestStream = new CoopBattleStreamer(guest, { authorityContext });
      const awaited = guestStream.awaitTurn(1);
      emitCompleteTurn(hostStream, 1, [], emptyCheckpoint(), "deadbeefdeadbeef");
      const resolution = await awaited;

      guest.send({
        t: "turnCommitAck",
        epoch: 7,
        wave: 1,
        turn: 1,
        revision,
        checkpointTick: resolution!.checkpoint.tick!,
        stateTick: resolution!.authoritativeState.tick,
        checksum: resolution!.checksum,
        stage,
        status: "applied",
      } as unknown as CoopMessage);
      await flushWire();
      await flushWire();
      expect(hostStream.retainedAuthorityDiagnostics().terminal).toBe(true);
      expect(
        guestStream.retainedAuthorityDiagnostics().terminal,
        "invalid host evidence converges through shared fatal",
      ).toBe(true);

      hostStream.dispose();
      guestStream.dispose();
    });

    it("rejects cross-wave traffic and malformed bi-only authority before buffering", async () => {
      const { host, guest } = createLoopbackPair();
      const guestStream = new CoopBattleStreamer(guest, {
        authorityContext: () => ({ epoch: 7, wave: 2, turn: 1 }),
      });
      let delivered = 0;
      guestStream.onTurnCommit(() => delivered++);
      const valid = checkpointEnvelope(
        "turnResolution",
        emptyCheckpoint(),
        "deadbeefdeadbeef",
        emptyAuthoritativeState(1),
      );
      const base = {
        t: "turnResolution",
        epoch: valid.epoch,
        wave: valid.wave,
        turn: valid.turn,
        revision: valid.revision,
        events: [] as const,
        checkpoint: valid.checkpoint,
        checksum: valid.checksum,
        preimage: "{}",
        fullField: valid.fullField,
        authoritativeState: valid.authoritativeState,
      };

      host.send(base as unknown as CoopMessage);
      host.send({
        ...base,
        wave: 2,
        authoritativeState: { ...valid.authoritativeState, wave: 2 },
        fullField: [{ bi: 0 }],
      } as unknown as CoopMessage);
      host.send({
        ...base,
        wave: 2,
        events: [{ k: "hp", bi: 99, hp: 0, maxHp: 1 }],
        authoritativeState: { ...valid.authoritativeState, wave: 2 },
      } as unknown as CoopMessage);
      await flushWire();

      expect(delivered, "neither stale addresses nor structurally fake carriers reach apply observers").toBe(0);
      expect(guestStream.consumeLiveEvents(1)).toEqual([]);
      guestStream.dispose();
    });

    it("never aliases accepted buffered commits or live events when a later wave reuses the turn number", async () => {
      const { host, guest } = createLoopbackPair();
      const current = { epoch: 7, wave: 1, turn: 1 };
      const hostStream = new CoopBattleStreamer(host, { authorityContext: () => current });
      const guestStream = new CoopBattleStreamer(guest, { authorityContext: () => current });

      hostStream.emitTurn(
        7,
        1,
        1,
        [{ k: "message", text: "old-wave" }],
        emptyCheckpoint(),
        "deadbeefdeadbeef",
        "{}",
        emptyFullField(),
        emptyAuthoritativeState(1),
      );
      hostStream.emitEvent(7, 1, 1, 0, { k: "message", text: "old-wave-live" });
      await flushWire();

      current.wave = 2;
      expect(
        guestStream.consumeLiveEvents(1),
        "an accepted wave-1 event cannot become wave 2's event merely because both use turn 1",
      ).toEqual([]);

      const awaited = guestStream.awaitTurn(1);
      hostStream.emitEvent(7, 2, 1, 0, { k: "message", text: "new-wave-live" });
      hostStream.emitTurn(
        7,
        2,
        1,
        [{ k: "message", text: "new-wave" }],
        emptyCheckpoint(),
        "cafebabecafebabe",
        "{}",
        emptyFullField(),
        emptyAuthoritativeState(2),
      );

      const resolution = await awaited;
      expect(resolution?.wave).toBe(2);
      expect(resolution?.events).toEqual([{ k: "message", text: "new-wave" }]);
      expect(guestStream.consumeLiveEvents(1)).toEqual([{ seq: 0, event: { k: "message", text: "new-wave-live" } }]);
      acknowledgeTurnThroughContinuation(guestStream, resolution!);
      hostStream.dispose();
      guestStream.dispose();
    });

    it("retains same-turn revisions at exact class-prefixed addresses and hands off only the newest", async () => {
      const { host, guest } = createLoopbackPair();
      const guestStream = new CoopBattleStreamer(guest, {
        authorityContext: () => ({ epoch: 7, wave: 1, turn: 1 }),
      });
      let observed = 0;
      guestStream.onTurnCommit(() => observed++);
      const complete = (revision: number, text: string): Extract<CoopMessage, { t: "turnResolution" }> => ({
        t: "turnResolution",
        epoch: 7,
        wave: 1,
        turn: 1,
        revision,
        events: [{ k: "message", text }],
        checkpoint: { ...emptyCheckpoint(), tick: revision - 1 },
        checksum: revision === 22 ? "2222222222222222" : "2121212121212121",
        preimage: `{"revision":${revision}}`,
        fullField: emptyFullField(),
        authoritativeState: emptyAuthoritativeState(1, 1, revision),
      });
      const older = complete(21, "older");
      const newest = complete(22, "newest");

      host.send(older);
      host.send(newest);
      await flushWire();

      expect(
        guestStream.retainedAuthorityDiagnostics().bufferedAuthority,
        "two immutable revisions coexist instead of overwriting one epoch/wave/turn slot",
      ).toBe(2);
      const resolution = await guestStream.awaitTurn(1);
      expect(resolution).toMatchObject({ revision: 22, events: [{ k: "message", text: "newest" }] });
      expect(
        guestStream.retainedAuthorityDiagnostics().bufferedAuthority,
        "newest handoff atomically prunes superseded same-address deliveries",
      ).toBe(0);
      acknowledgeTurnThroughContinuation(guestStream, resolution!);

      host.send({ ...newest, events: newest.events.map(event => ({ ...event })) });
      await flushWire();
      expect(observed, "an identical exact retransmission is re-ACKed without a second delivery").toBe(2);
      expect(guestStream.retainedAuthorityDiagnostics().bufferedAuthority).toBe(0);
      guestStream.dispose();
    });

    it("does not let an older revision ACK cancel a newer exact commit request at the same turn", async () => {
      const { host, guest } = createLoopbackPair();
      const scheduled: { cb: () => void; cancelled: boolean }[] = [];
      const exactRequests: number[] = [];
      host.onMessage(message => {
        if (message.t === "requestTurnCommit" && message.revision !== undefined) {
          exactRequests.push(message.revision);
        }
      });
      const guestStream = new CoopBattleStreamer(guest, {
        authorityContext: () => ({ epoch: 7, wave: 1, turn: 1 }),
        schedule: cb => {
          const timer = { cb, cancelled: false };
          scheduled.push(timer);
          return () => {
            timer.cancelled = true;
          };
        },
      });
      const first: Extract<CoopMessage, { t: "turnResolution" }> = {
        t: "turnResolution",
        epoch: 7,
        wave: 1,
        turn: 1,
        revision: 21,
        events: [{ k: "message", text: "first" }],
        checkpoint: emptyCheckpoint(),
        checksum: "2121212121212121",
        preimage: "{}",
        fullField: emptyFullField(),
        authoritativeState: emptyAuthoritativeState(1, 1, 21),
      };

      host.send(first);
      await flushWire();
      const resolution = await guestStream.awaitTurn(1);
      await flushWire();
      expect(resolution?.revision).toBe(21);
      expect(guestStream.acknowledgeTurnCommit(resolution!, "materialApplied")).toBe(true);
      expect(guestStream.acknowledgeTurnCommit(resolution!, "presentationReady")).toBe(true);

      guestStream.requestTurnCommit(7, 1, 1, 22);
      await flushWire();
      expect(
        guestStream.retainedAuthorityDiagnostics().requests,
        "two immutable revisions own independent retry slots",
      ).toBe(2);

      expect(guestStream.acknowledgeTurnCommit(resolution!, "continuationReady")).toBe(true);
      expect(guestStream.retainedAuthorityDiagnostics().requests, "the revision-21 ACK releases only revision 21").toBe(
        1,
      );

      const requestsBeforeRetry = exactRequests.length;
      for (const timer of [...scheduled]) {
        if (!timer.cancelled) {
          timer.cb();
        }
      }
      await flushWire();
      expect(exactRequests.slice(requestsBeforeRetry)).toEqual([22]);
      guestStream.dispose();
    });

    it("keeps turn and replacement deliveries independent at the same numeric address and revision", async () => {
      const { host, guest } = createLoopbackPair();
      const current = { epoch: 7, wave: 4, turn: 2 };
      const guestStream = new CoopBattleStreamer(guest, { authorityContext: () => current });
      let replacementOpens = 0;
      guestStream.onCheckpointEnvelope(() => replacementOpens++);
      const state = emptyAuthoritativeState(4, 2, 22);
      const checkpoint = { ...emptyCheckpoint(), tick: 21 };
      const turn: Extract<CoopMessage, { t: "turnResolution" }> = {
        t: "turnResolution",
        ...current,
        revision: 22,
        events: [{ k: "message", text: "turn" }],
        checkpoint,
        checksum: "2222222222222222",
        preimage: "{}",
        fullField: emptyFullField(),
        authoritativeState: state,
      };
      const replacement: Extract<CoopMessage, { t: "battleCheckpoint" }> = {
        t: "battleCheckpoint",
        reason: "replacement",
        ...current,
        revision: 22,
        checkpoint,
        checksum: "3333333333333333",
        fullField: emptyFullField(),
        authoritativeState: state,
      };

      host.send(turn);
      host.send(replacement);
      await flushWire();
      expect(
        guestStream.retainedAuthorityDiagnostics().bufferedAuthority,
        "message class is part of the receiver address",
      ).toBe(2);

      const resolution = await guestStream.awaitTurn(2);
      expect(resolution?.events).toEqual([{ k: "message", text: "turn" }]);
      expect(guestStream.peekCheckpoint()).toMatchObject({ reason: "replacement", revision: 22 });
      expect(guestStream.retainedAuthorityDiagnostics().bufferedAuthority).toBe(1);

      host.send({ ...replacement, fullField: replacement.fullField.map(mon => ({ ...mon })) });
      await flushWire();
      expect(replacementOpens, "an identical replacement retransmission cannot reopen its surface").toBe(1);
      const handedOff = guestStream.consumeCheckpoint();
      expect(handedOff).toMatchObject({ reason: "replacement", revision: 22 });
      expect(guestStream.retainedAuthorityDiagnostics().bufferedAuthority).toBe(0);
      acknowledgeTurnThroughContinuation(guestStream, resolution!);
      acknowledgeReplacementThroughContinuation(guestStream, handedOff!);
      guestStream.dispose();
    });

    it("retains distinct replacement revisions without allowing an older or duplicate replay to reopen", async () => {
      const { host, guest } = createLoopbackPair();
      const guestStream = new CoopBattleStreamer(guest, {
        authorityContext: () => ({ epoch: 7, wave: 4, turn: 2 }),
      });
      const older = checkpointEnvelope();
      const newest = checkpointEnvelope(
        "replacement",
        { ...emptyCheckpoint(), tick: 21 },
        "2222222222222222",
        emptyAuthoritativeState(4, 2, 22),
      );
      let opened = 0;
      guestStream.onCheckpointEnvelope(() => opened++);

      host.send({ t: "battleCheckpoint", ...older });
      host.send({ t: "battleCheckpoint", ...newest });
      await flushWire();
      expect(
        guestStream.retainedAuthorityDiagnostics().bufferedAuthority,
        "each immutable replacement revision owns an exact receiver slot",
      ).toBe(2);
      expect(guestStream.peekCheckpoint()?.revision).toBe(22);

      host.send({ t: "battleCheckpoint", ...older });
      host.send({ t: "battleCheckpoint", ...newest, fullField: newest.fullField.map(mon => ({ ...mon })) });
      await flushWire();
      expect(opened, "reordered older and identical exact traffic cannot reopen either surface").toBe(2);
      expect(guestStream.retainedAuthorityDiagnostics().bufferedAuthority).toBe(2);

      const handedOff = guestStream.consumeCheckpoint();
      expect(handedOff?.revision).toBe(22);
      expect(
        guestStream.retainedAuthorityDiagnostics().bufferedAuthority,
        "newest replacement handoff prunes the older same-address delivery to prevent rollback",
      ).toBe(0);
      acknowledgeReplacementThroughContinuation(guestStream, handedOff!);
      guestStream.dispose();
    });

    it("never lets delayed prior-epoch frames resolve or wake the new epoch's exact waiter", async () => {
      const { host, guest } = createLoopbackPair();
      const current = { epoch: 7, wave: 1, turn: 1 };
      const hostStream = new CoopBattleStreamer(host, { authorityContext: () => current });
      const guestStream = new CoopBattleStreamer(guest, { authorityContext: () => current });

      const oldWait = guestStream.awaitTurn(1);
      current.epoch = 8;
      guestStream.requestTurnCommit(8, 1, 1, 20);
      const newWait = guestStream.awaitTurn(1);
      expect(await oldWait, "opening the new epoch dissolves the old addressed waiter").toBeNull();
      expect(
        guestStream.retainedAuthorityDiagnostics().requests,
        "clearing the stale epoch-7 waiter leaves both epoch-8 exact and discovery requests intact",
      ).toBe(2);

      hostStream.emitEvent(7, 1, 1, 0, { k: "message", text: "stale-live" });
      hostStream.emitTurn(
        7,
        1,
        1,
        [{ k: "message", text: "stale-turn" }],
        emptyCheckpoint(),
        "deadbeefdeadbeef",
        "{}",
        emptyFullField(),
        emptyAuthoritativeState(1),
      );
      hostStream.emitEvent(8, 1, 1, 0, { k: "message", text: "current-live" });
      hostStream.emitTurn(
        8,
        1,
        1,
        [{ k: "message", text: "current-turn" }],
        emptyCheckpoint(),
        "cafebabecafebabe",
        "{}",
        emptyFullField(),
        emptyAuthoritativeState(1),
      );

      const resolution = await newWait;
      expect(resolution?.epoch).toBe(8);
      expect(resolution?.events).toEqual([{ k: "message", text: "current-turn" }]);
      expect(guestStream.consumeLiveEvents(1)).toEqual([{ seq: 0, event: { k: "message", text: "current-live" } }]);
      expect(
        guestStream.retainedAuthorityDiagnostics().requests,
        "the current exact request remains until continuation-ready",
      ).toBe(1);
      acknowledgeTurnThroughContinuation(guestStream, resolution!);
      hostStream.dispose();
      guestStream.dispose();
    });

    it("classifies a cross-address replay wait as superseded instead of a host stall", async () => {
      const { guest } = createLoopbackPair();
      const current = { epoch: 7, wave: 1, turn: 1 };
      const guestStream = new CoopBattleStreamer(guest, { authorityContext: () => current });

      const oldReplay = guestStream.awaitTurnOrLiveEvent(1, 0, 1);
      current.wave = 2;
      const currentReplay = guestStream.awaitTurnOrLiveEvent(1, 0, 2);

      await expect(
        oldReplay,
        "opening wave 2 turn 1 benignly dissolves the orphaned wave 1 turn-1 replay",
      ).resolves.toEqual({ kind: "superseded" });
      expect(
        guestStream.retainedAuthorityDiagnostics().waiters,
        "only the current wave's exact authority wait remains",
      ).toBe(1);

      guestStream.dispose();
      await expect(currentReplay).resolves.toEqual({ kind: "turn", res: null });
    });

    it("keeps the newest buffered revision, ignores an identical duplicate, and rejects a reordered older one", async () => {
      const { host, guest } = createLoopbackPair();
      const guestStream = new CoopBattleStreamer(guest, {
        authorityContext: () => ({ epoch: 7, wave: 1, turn: 1 }),
      });
      let observed = 0;
      let acknowledgements = 0;
      guestStream.onTurnCommit(() => observed++);
      host.onMessage(message => {
        if (message.t === "turnCommitAck") {
          acknowledgements++;
        }
      });
      const complete = (revision: number, text: string): Extract<CoopMessage, { t: "turnResolution" }> => ({
        t: "turnResolution",
        epoch: 7,
        wave: 1,
        turn: 1,
        revision,
        events: [{ k: "message", text }],
        checkpoint: { ...emptyCheckpoint(), tick: revision - 1 },
        checksum: revision === 22 ? "2222222222222222" : "2121212121212121",
        preimage: `{"revision":${revision}}`,
        fullField: emptyFullField(),
        authoritativeState: emptyAuthoritativeState(1, 1, revision),
      });
      const newest = complete(22, "newest");

      host.send(newest);
      await flushWire();

      const resolution = await guestStream.awaitTurn(1);
      acknowledgeTurnThroughContinuation(guestStream, resolution!);
      await flushWire();
      host.send({ ...newest, events: newest.events.map(event => ({ ...event })) });
      host.send(complete(21, "stale"));
      await flushWire();

      expect(resolution?.revision).toBe(22);
      expect(resolution?.events).toEqual([{ k: "message", text: "newest" }]);
      expect(observed, "history remains immutable after buffer handoff and ACK").toBe(1);
      expect(acknowledgements, "an identical immutable replay re-sends only final continuation evidence").toBe(4);
      guestStream.dispose();
    });

    it("routes conflicting content for one immutable buffered revision through the shared fatal contract", async () => {
      const { host, guest } = createLoopbackPair();
      const hostTerminals: string[] = [];
      const guestTerminals: string[] = [];
      const hostStream = new CoopBattleStreamer(host, {
        authorityContext: () => ({ epoch: 7, wave: 1, turn: 1 }),
        onAuthorityTerminal: reason => {
          hostTerminals.push(reason);
          host.close();
        },
      });
      const guestStream = new CoopBattleStreamer(guest, {
        authorityContext: () => ({ epoch: 7, wave: 1, turn: 1 }),
        onAuthorityTerminal: reason => guestTerminals.push(reason),
      });
      let failures = 0;
      host.onMessage(message => {
        if (message.t === "authorityFailure") {
          failures++;
        }
      });
      guest.onMessage(message => {
        if (message.t === "authorityFailure") {
          failures++;
        }
      });
      const base: Extract<CoopMessage, { t: "turnResolution" }> = {
        t: "turnResolution",
        epoch: 7,
        wave: 1,
        turn: 1,
        revision: 20,
        events: [{ k: "message", text: "first" }],
        checkpoint: emptyCheckpoint(),
        checksum: "deadbeefdeadbeef",
        preimage: "{}",
        fullField: emptyFullField(),
        authoritativeState: emptyAuthoritativeState(1),
      };

      host.send(base);
      host.send({ ...base, events: [{ k: "message", text: "conflict" }] });
      await flushWire();
      await flushWire();
      await flushWire();

      expect(failures, "the receiving peer ACKs without echoing a fatal back").toBe(1);
      expect(hostTerminals, "the peer receiving a guest-origin fatal latches the same terminal").toEqual([
        expect.stringContaining("Conflicting turn authority"),
      ]);
      expect(guestTerminals).toEqual([expect.stringContaining("Conflicting turn authority")]);
      await expect(guestStream.awaitTurn(1), "terminal authority cannot be consumed as gameplay").resolves.toBeNull();
      expect(hostStream.retainedAuthorityDiagnostics().terminal).toBe(true);
      expect(guestStream.retainedAuthorityDiagnostics().terminal).toBe(true);
      hostStream.dispose();
      guestStream.dispose();
    });

    it("never exposes a buffered replacement checkpoint after its full authority address is no longer current", async () => {
      const { host, guest } = createLoopbackPair();
      const current = { epoch: 7, wave: 4, turn: 2 };
      const hostStream = new CoopBattleStreamer(host, { authorityContext: () => current });
      const guestStream = new CoopBattleStreamer(guest, { authorityContext: () => current });
      const old = checkpointEnvelope();

      hostStream.sendCheckpoint(
        old.reason,
        old.epoch,
        old.wave,
        old.turn,
        old.checkpoint,
        old.checksum,
        old.fullField,
        old.authoritativeState,
      );
      await flushWire();
      expect(guestStream.peekCheckpoint()?.wave).toBe(4);

      current.epoch = 8;
      current.wave = 1;
      current.turn = 1;
      expect(
        guestStream.peekCheckpoint(),
        "a prior epoch's accepted singleton cannot divert the new run's replay pump",
      ).toBeNull();
      hostStream.dispose();
      guestStream.dispose();
    });

    it("wakes a turn-N replay parked before the exact N+1 replacement arrives", async () => {
      const { host, guest } = createLoopbackPair();
      const hostCurrent = { epoch: 7, wave: 4, turn: 2 };
      const guestCurrent = { epoch: 7, wave: 4, turn: 2 };
      const hostStream = new CoopBattleStreamer(host, { authorityContext: () => hostCurrent });
      const guestStream = new CoopBattleStreamer(guest, { authorityContext: () => guestCurrent });
      const parked = guestStream.awaitTurnOrLiveEvent(2, 0);
      await flushWire();

      // Production asymmetry: TurnEnd already incremented the authority while the renderer remains in
      // its turn-2 owner picker. The old test advanced one shared context to 3 on BOTH sides and therefore
      // never exercised the cross-address admission that stranded the real browser.
      hostCurrent.turn = 3;
      const replacement = checkpointEnvelope(
        "replacement",
        { ...emptyCheckpoint(), tick: 21 },
        "cafebabecafebabe",
        emptyAuthoritativeState(4, 3, 22),
      );
      hostStream.sendCheckpoint(
        replacement.reason,
        replacement.epoch,
        replacement.wave,
        replacement.turn,
        replacement.checkpoint,
        replacement.checksum,
        replacement.fullField,
        replacement.authoritativeState,
      );

      expect(await parked).toEqual({ kind: "checkpoint" });
      expect(guestCurrent.turn, "the renderer is still parked at the old picker address").toBe(2);
      expect(guestStream.peekCheckpoint(), "ambient consumers cannot steal future-address authority").toBeNull();
      expect(guestStream.peekCheckpointForTurn(2)).toEqual(replacement);
      expect(guestStream.consumeCheckpointForTurn(2)).toEqual(replacement);
      expect(guestStream.peekCheckpointForTurn(2)).toBeNull();
      guestStream.dispose();
      hostStream.dispose();
    });

    it("wakes a turn-N replay when a delayed exact N-1 replacement loses the race to local TurnInit", async () => {
      const { host, guest } = createLoopbackPair();
      const hostCurrent = { epoch: 7, wave: 4, turn: 2 };
      const guestCurrent = { epoch: 7, wave: 4, turn: 3 };
      const hostStream = new CoopBattleStreamer(host, { authorityContext: () => hostCurrent });
      const guestStream = new CoopBattleStreamer(guest, { authorityContext: () => guestCurrent });
      const parked = guestStream.awaitTurnOrLiveEvent(3, 0);
      await flushWire();

      // The renderer has already entered its derived turn-3 shell, but the host's retained replacement
      // authority was captured at turn 2. The exact active turn-3 wait is the fail-closed evidence that
      // admits this single predecessor carrier; arbitrary stale checkpoints remain cross-address drops.
      const replacement = checkpointEnvelope(
        "replacement",
        { ...emptyCheckpoint(), tick: 21 },
        "cafebabecafebabe",
        emptyAuthoritativeState(4, 2, 22),
      );
      hostStream.sendCheckpoint(
        replacement.reason,
        replacement.epoch,
        replacement.wave,
        replacement.turn,
        replacement.checkpoint,
        replacement.checksum,
        replacement.fullField,
        replacement.authoritativeState,
      );

      expect(await parked).toEqual({ kind: "checkpoint" });
      expect(guestStream.peekCheckpoint(), "ambient consumers cannot steal predecessor-address authority").toBeNull();
      expect(guestStream.peekCheckpointForTurn(3)).toEqual(replacement);
      expect(guestStream.consumeCheckpointForTurn(3)).toEqual(replacement);
      expect(guestStream.peekCheckpointForTurn(3)).toBeNull();
      guestStream.dispose();
      hostStream.dispose();
    });

    it("reasserts only a same-turn or exact N+1 applied replacement for a delayed resolution", () => {
      const { guest } = createLoopbackPair();
      const stream = new CoopBattleStreamer(guest);
      const resolution = {
        epoch: 7,
        wave: 4,
        turn: 2,
        revision: 20,
      };
      const sameTurn = checkpointEnvelope(
        "replacement",
        { ...emptyCheckpoint(), tick: 20 },
        "1111111111111111",
        emptyAuthoritativeState(4, 2, 21),
      );
      const nextTurn = checkpointEnvelope(
        "replacement",
        { ...emptyCheckpoint(), tick: 21 },
        "2222222222222222",
        emptyAuthoritativeState(4, 3, 22),
      );

      stream.retainAppliedOutOfBandCheckpoint(sameTurn);
      expect(stream.consumeAppliedOutOfBandCheckpoint(resolution)).toBe(sameTurn);
      stream.retainAppliedOutOfBandCheckpoint(nextTurn);
      expect(stream.consumeAppliedOutOfBandCheckpoint(resolution)).toBe(nextTurn);
      expect(stream.consumeAppliedOutOfBandCheckpoint(resolution), "causal carriers are one-shot").toBeNull();
      stream.dispose();
    });

    it("does not consume wrong-epoch, wrong-wave, or N+2 applied replacement authority", () => {
      const { guest } = createLoopbackPair();
      const stream = new CoopBattleStreamer(guest);
      const wrongEpoch = {
        ...checkpointEnvelope(
          "replacement",
          { ...emptyCheckpoint(), tick: 22 },
          "3333333333333333",
          emptyAuthoritativeState(4, 3, 23),
        ),
        epoch: 8,
      };
      const wrongWave = checkpointEnvelope(
        "replacement",
        { ...emptyCheckpoint(), tick: 23 },
        "4444444444444444",
        emptyAuthoritativeState(5, 3, 24),
      );
      const twoTurnsAhead = checkpointEnvelope(
        "replacement",
        { ...emptyCheckpoint(), tick: 24 },
        "5555555555555555",
        emptyAuthoritativeState(4, 4, 25),
      );
      stream.retainAppliedOutOfBandCheckpoint(wrongEpoch);
      stream.retainAppliedOutOfBandCheckpoint(wrongWave);
      stream.retainAppliedOutOfBandCheckpoint(twoTurnsAhead);

      expect(stream.consumeAppliedOutOfBandCheckpoint({ epoch: 7, wave: 4, turn: 2, revision: 20 })).toBeNull();
      expect(
        stream.consumeAppliedOutOfBandCheckpoint({ epoch: 8, wave: 4, turn: 2, revision: 20 }),
        "wrong-epoch authority remained available only to its own epoch",
      ).toBe(wrongEpoch);
      expect(
        stream.consumeAppliedOutOfBandCheckpoint({ epoch: 7, wave: 5, turn: 2, revision: 20 }),
        "wrong-wave authority remained available only to its own wave",
      ).toBe(wrongWave);
      expect(
        stream.consumeAppliedOutOfBandCheckpoint({ epoch: 7, wave: 4, turn: 3, revision: 20 }),
        "N+2 authority remained available for the exact preceding turn",
      ).toBe(twoTurnsAhead);
      stream.dispose();
    });

    it("retains multiple replacement revisions until exact continuation-ready evidence", async () => {
      const { host, guest } = createLoopbackPair();
      const hostStream = new CoopBattleStreamer(host, {
        authorityContext: () => ({ epoch: 7, wave: 4, turn: 2 }),
      });
      const guestStream = new CoopBattleStreamer(guest, {
        authorityContext: () => ({ epoch: 7, wave: 4, turn: 2 }),
      });
      const oldEnvelope = checkpointEnvelope();
      const newCheckpoint = { ...emptyCheckpoint(), tick: 21 };
      const newEnvelope = checkpointEnvelope(
        "replacement",
        newCheckpoint,
        "cafebabecafebabe",
        emptyAuthoritativeState(4, 2, 22),
      );
      const rawRevisions: number[] = [];
      guest.onMessage(msg => {
        if (msg.t === "battleCheckpoint") {
          rawRevisions.push(msg.revision);
        }
      });

      hostStream.sendCheckpoint(
        "replacement",
        oldEnvelope.epoch,
        oldEnvelope.wave,
        oldEnvelope.turn,
        oldEnvelope.checkpoint,
        oldEnvelope.checksum,
        oldEnvelope.fullField,
        oldEnvelope.authoritativeState,
      );
      hostStream.sendCheckpoint(
        "replacement",
        newEnvelope.epoch,
        newEnvelope.wave,
        newEnvelope.turn,
        newEnvelope.checkpoint,
        newEnvelope.checksum,
        newEnvelope.fullField,
        newEnvelope.authoritativeState,
      );
      await flushWire();

      expect(guestStream.acknowledgeReplacement(oldEnvelope, "materialApplied")).toBe(true);
      await flushWire();
      const beforeMaterialRequest = rawRevisions.length;
      guestStream.requestReplacementCheckpoint(oldEnvelope);
      await flushWire();
      expect(rawRevisions.slice(beforeMaterialRequest), "material apply does not release host retention").toEqual([20]);

      expect(guestStream.acknowledgeReplacement(oldEnvelope, "presentationReady")).toBe(true);
      await flushWire();
      const beforePresentationRequest = rawRevisions.length;
      guestStream.requestReplacementCheckpoint(oldEnvelope);
      await flushWire();
      expect(
        rawRevisions.slice(beforePresentationRequest),
        "renderer readiness still does not release retention",
      ).toEqual([20]);

      expect(guestStream.acknowledgeReplacement(oldEnvelope, "continuationReady")).toBe(true);
      await flushWire();
      const afterExactAck = rawRevisions.length;
      guestStream.requestReplacementCheckpoint(oldEnvelope);
      await flushWire();
      expect(rawRevisions).toHaveLength(afterExactAck);

      guestStream.requestReplacementCheckpoint(newEnvelope);
      await flushWire();
      expect(rawRevisions.at(-1), "the newer unacked replacement remains independently replayable").toBe(22);
      hostStream.dispose();
      guestStream.dispose();
    });

    it("releases a stale replacement after a newer applied turn reaches continuation-ready", async () => {
      const { host, guest } = createLoopbackPair();
      const current = { epoch: 7, wave: 4, turn: 2 };
      const hostTerminals: string[] = [];
      const hostStream = new CoopBattleStreamer(host, {
        authorityContext: () => current,
        onAuthorityTerminal: reason => hostTerminals.push(reason),
      });
      const guestStream = new CoopBattleStreamer(guest, { authorityContext: () => current });
      const stale = checkpointEnvelope();

      hostStream.sendCheckpoint(
        stale.reason,
        stale.epoch,
        stale.wave,
        stale.turn,
        stale.checkpoint,
        stale.checksum,
        stale.fullField,
        stale.authoritativeState,
      );
      await flushWire();
      expect(hostStream.retainedAuthorityDiagnostics().replacementCommits).toBe(1);

      current.wave = 5;
      current.turn = 1;
      const newerState = emptyAuthoritativeState(5, 1, 30);
      const awaited = guestStream.awaitTurn(1);
      hostStream.emitTurn(
        7,
        5,
        1,
        [],
        { ...emptyCheckpoint(), tick: 29 },
        "3030303030303030",
        "{}",
        emptyFullField(),
        newerState,
      );
      const newer = await awaited;
      expect(newer).not.toBeNull();
      expect(guestStream.acknowledgeTurnCommit(newer!, "materialApplied")).toBe(true);
      await flushWire();
      expect(
        hostStream.retainedAuthorityDiagnostics().replacementCommits,
        "material application alone cannot causally retire retained authority",
      ).toBe(1);
      expect(guestStream.acknowledgeTurnCommit(newer!, "presentationReady")).toBe(true);
      await flushWire();
      expect(
        hostStream.retainedAuthorityDiagnostics().replacementCommits,
        "presentation readiness alone cannot causally retire retained authority",
      ).toBe(1);
      expect(guestStream.acknowledgeTurnCommit(newer!, "continuationReady")).toBe(true);
      await flushWire();

      expect(
        hostStream.retainedAuthorityDiagnostics().replacementCommits,
        "the newer full state causally subsumes the old replacement",
      ).toBe(0);
      expect(hostStream.retainedAuthorityDiagnostics().deliveryTimers).toBe(0);
      expect(guestStream.retainedAuthorityDiagnostics().bufferedAuthority, "obsolete guest work is pruned").toBe(0);
      expect(guestStream.retainedAuthorityDiagnostics().waiters).toBe(0);

      expect(
        guestStream.acknowledgeReplacement(stale, "materialApplied"),
        "an already-admitted delayed frame can still emit a late ACK",
      ).toBe(true);
      await flushWire();
      expect(hostTerminals, "a late exact ACK for retired authority is harmless").toEqual([]);
      expect(hostStream.retainedAuthorityDiagnostics().terminal).toBe(false);
      expect(hostStream.retainedAuthorityDiagnostics().fatalPending).toBe(false);

      hostStream.dispose();
      guestStream.dispose();
    });

    it("host retries a replacement after a lost ACK and the guest re-ACKs without reopening it", async () => {
      const pair = wrapCoopFaultPair(createLoopbackPair(), COOP_NO_FAULT_PROFILE, { seed: 0x50333252 });
      const hostRetryTimers: (() => void)[] = [];
      const current = { epoch: 7, wave: 4, turn: 2 };
      const replacementContext = () => current;
      const hostStream = new CoopBattleStreamer(pair.host, {
        authorityContext: replacementContext,
        schedule: cb => {
          hostRetryTimers.push(cb);
          return () => {};
        },
      });
      const guestStream = new CoopBattleStreamer(pair.guest, { authorityContext: replacementContext });
      const envelope = checkpointEnvelope();
      let opened = 0;
      guestStream.onCheckpointEnvelope(() => opened++);

      hostStream.sendCheckpoint(
        "replacement",
        envelope.epoch,
        envelope.wave,
        envelope.turn,
        envelope.checkpoint,
        envelope.checksum,
        envelope.fullField,
        envelope.authoritativeState,
      );
      await flushWire();
      expect(opened).toBe(1);
      expect(guestStream.consumeCheckpoint()).not.toBeNull();

      expect(guestStream.acknowledgeReplacement(envelope, "materialApplied")).toBe(true);
      expect(guestStream.acknowledgeReplacement(envelope, "presentationReady")).toBe(true);
      pair.armNextDrop("battleCheckpointAck", "guest");
      expect(guestStream.acknowledgeReplacement(envelope, "continuationReady")).toBe(true);
      await flushWire();
      current.wave = 5;
      current.turn = 1;
      hostRetryTimers.shift()?.();
      await flushWire();
      expect(opened, "duplicate replacement was re-ACKed before recovery observers/command UI").toBe(1);

      guestStream.requestReplacementCheckpoint(envelope);
      await flushWire();
      expect(opened, "the successful re-ACK cleared host retention").toBe(1);
      hostStream.dispose();
      guestStream.dispose();
    });

    it("retires a late replacement through the completed newer wave transaction", async () => {
      const { host, guest } = createLoopbackPair();
      const current = { epoch: 7, wave: 4, turn: 2 };
      const hostStream = new CoopBattleStreamer(host, { authorityContext: () => current });
      const guestStream = new CoopBattleStreamer(guest, { authorityContext: () => current });
      const replacement = checkpointEnvelope();
      const ackStages: string[] = [];
      let opened = 0;
      host.onMessage(message => {
        if (message.t === "battleCheckpointAck") {
          ackStages.push(message.stage);
        }
      });
      guestStream.onCheckpointEnvelope(() => opened++);
      hostStream.sendCheckpoint(
        replacement.reason,
        replacement.epoch,
        replacement.wave,
        replacement.turn,
        replacement.checkpoint,
        replacement.checksum,
        replacement.fullField,
        replacement.authoritativeState,
      );
      await flushWire();

      const waveAuthority: CoopAuthoritativeEnvelopeV1 = {
        version: 1,
        sessionEpoch: 7,
        revision: 2,
        wave: 4,
        turn: 2,
        logicalPhase: "WAVE_VICTORY",
        pendingOperation: {
          id: "7:0:WAVE_ADVANCE:4",
          kind: "WAVE_ADVANCE",
          owner: 0,
          status: "applied",
          payload: {},
        },
        authoritativeState: emptyAuthoritativeState(4, 2, 21),
      };
      expect(
        guestStream.acknowledgeReplacementsSubsumedByOperation({
          ...waveAuthority,
          sessionEpoch: 8,
        }),
        "another session cannot retire replacement authority",
      ).toBe(0);
      expect(
        guestStream.acknowledgeReplacementsSubsumedByOperation({
          ...waveAuthority,
          authoritativeState: emptyAuthoritativeState(4, 2, replacement.authoritativeState.tick),
        }),
        "an equal state tick is not stronger authority",
      ).toBe(0);
      expect(
        guestStream.acknowledgeReplacementsSubsumedByOperation({
          ...waveAuthority,
          turn: 1,
          authoritativeState: emptyAuthoritativeState(4, 1, 21),
        }),
        "an older battle address cannot retire a future replacement",
      ).toBe(0);
      expect(hostStream.retainedAuthorityDiagnostics().replacementCommits).toBe(1);
      expect(guestStream.peekCheckpoint()).toEqual(replacement);

      expect(guestStream.acknowledgeReplacementsSubsumedByOperation(waveAuthority)).toBe(1);
      await flushWire();
      expect(ackStages).toEqual(["materialApplied", "presentationReady", "continuationReady"]);
      expect(hostStream.retainedAuthorityDiagnostics().replacementCommits).toBe(0);
      expect(guestStream.peekCheckpoint(), "the late checkpoint cannot reopen after the newer DATA applied").toBeNull();
      expect(opened, "causal retirement emits no second apply/presentation wake").toBe(1);

      expect(guestStream.acknowledgeReplacementsSubsumedByOperation(waveAuthority)).toBe(1);
      await flushWire();
      expect(ackStages, "a repeated wave proof republishes only final retained evidence").toEqual([
        "materialApplied",
        "presentationReady",
        "continuationReady",
        "continuationReady",
      ]);
      expect(hostStream.retainedAuthorityDiagnostics().terminal).toBe(false);
      expect(guestStream.retainedAuthorityDiagnostics().terminal).toBe(false);
      hostStream.dispose();
      guestStream.dispose();
    });

    it("keeps replacement authority immutable through handoff, applied-OOB retention, and ACK", async () => {
      const { host, guest } = createLoopbackPair();
      const authorityContext = () => ({ epoch: 7, wave: 4, turn: 2 });
      const hostTerminals: string[] = [];
      const guestTerminals: string[] = [];
      const hostStream = new CoopBattleStreamer(host, {
        authorityContext,
        onAuthorityTerminal: reason => hostTerminals.push(reason),
      });
      const guestStream = new CoopBattleStreamer(guest, {
        authorityContext,
        onAuthorityTerminal: reason => guestTerminals.push(reason),
      });
      let opened = 0;
      let acknowledgements = 0;
      guestStream.onCheckpointEnvelope(() => opened++);
      host.onMessage(message => {
        if (message.t === "battleCheckpointAck") {
          acknowledgements++;
        }
      });
      const replacement = checkpointEnvelope();
      const sendRaw = (envelope: CoopCheckpointEnvelope) => host.send({ t: "battleCheckpoint", ...envelope });

      hostStream.sendCheckpoint(
        replacement.reason,
        replacement.epoch,
        replacement.wave,
        replacement.turn,
        replacement.checkpoint,
        replacement.checksum,
        replacement.fullField,
        replacement.authoritativeState,
      );
      await flushWire();
      const handedOff = guestStream.consumeCheckpoint();
      expect(handedOff).toEqual(replacement);
      guestStream.retainAppliedOutOfBandCheckpoint(handedOff!);
      acknowledgeReplacementThroughContinuation(guestStream, handedOff!);
      await flushWire();

      sendRaw({ ...replacement, fullField: replacement.fullField.map(mon => ({ ...mon })) });
      sendRaw(
        checkpointEnvelope(
          "replacement",
          { ...emptyCheckpoint(), tick: 17 },
          "1818181818181818",
          emptyAuthoritativeState(4, 2, 18),
        ),
      );
      await flushWire();

      expect(opened, "equal-identical and lower revisions never reopen an applied surface").toBe(1);
      expect(acknowledgements, "equal-identical authority re-sends only final continuation evidence").toBe(4);
      expect(
        guestStream.consumeAppliedOutOfBandCheckpoint({
          epoch: replacement.epoch,
          wave: replacement.wave,
          turn: replacement.turn,
          revision: replacement.revision - 1,
        }),
        "idempotent/lower traffic cannot overwrite the applied immutable frame",
      ).toEqual(replacement);

      sendRaw({ ...replacement, checksum: "ffffffffffffffff" });
      await flushWire();
      await flushWire();
      await flushWire();

      expect(hostTerminals, "replacement conflict terminates the authority sender too").toEqual([
        expect.stringContaining("Conflicting replacement authority"),
      ]);
      expect(guestTerminals).toEqual([expect.stringContaining("Conflicting replacement authority")]);
      expect(opened).toBe(1);
      hostStream.dispose();
      guestStream.dispose();
    });

    it("fails shared and tears down every authority resource when retained capacity is exceeded", async () => {
      const { host, guest } = createLoopbackPair();
      const current = { epoch: 7, wave: 1, turn: 1 };
      const timers: { callback: () => void; ms: number; cancelled: boolean }[] = [];
      const schedule = (callback: () => void, ms: number) => {
        const timer = { callback, ms, cancelled: false };
        timers.push(timer);
        return () => {
          timer.cancelled = true;
        };
      };
      const hostTerminals: string[] = [];
      const guestTerminals: string[] = [];
      const hostStream = new CoopBattleStreamer(host, {
        authorityContext: () => current,
        authorityRetentionLimit: 1,
        schedule,
        onAuthorityTerminal: reason => hostTerminals.push(reason),
      });
      const guestStream = new CoopBattleStreamer(guest, {
        authorityContext: () => current,
        schedule,
        onAuthorityTerminal: reason => guestTerminals.push(reason),
      });
      let fatalFrames = 0;
      guest.onMessage(message => {
        if (message.t === "authorityFailure") {
          fatalFrames++;
        }
      });

      const turnWait = guestStream.awaitTurn(1);
      const enemyWait = guestStream.awaitEnemyParty(99);
      emitCompleteTurn(hostStream, 1, [], emptyCheckpoint(), "deadbeefdeadbeef");
      const replacement = checkpointEnvelope(
        "replacement",
        { ...emptyCheckpoint(), tick: 21 },
        "2222222222222222",
        emptyAuthoritativeState(1, 1, 22),
      );
      hostStream.sendCheckpoint(
        replacement.reason,
        replacement.epoch,
        replacement.wave,
        replacement.turn,
        replacement.checkpoint,
        replacement.checksum,
        replacement.fullField,
        replacement.authoritativeState,
      );
      await flushWire();
      await flushWire();
      await flushWire();

      expect(fatalFrames, "overflow emits one bounded fatal frame without ping-pong").toBe(1);
      expect(hostTerminals).toEqual([expect.stringContaining("retention exceeded 1")]);
      expect(guestTerminals).toEqual([expect.stringContaining("retention exceeded 1")]);
      const emptyTerminalResources = {
        turnCommits: 0,
        replacementCommits: 0,
        deliveryTimers: 0,
        requestTimers: 0,
        requests: 0,
        redeliveryRequests: 0,
        bufferedAuthority: 0,
        history: 0,
        acknowledgements: 0,
        waiters: 0,
        fatalPending: false,
        terminal: true,
      };
      expect(hostStream.retainedAuthorityDiagnostics()).toEqual(emptyTerminalResources);
      expect(guestStream.retainedAuthorityDiagnostics()).toEqual(emptyTerminalResources);
      await expect(
        turnWait,
        "the pre-terminal turn delivery cannot preserve its retry/request loop",
      ).resolves.not.toBeNull();
      await expect(
        enemyWait,
        "a non-authority gameplay waiter is dissolved by the shared terminal",
      ).resolves.toBeNull();
      expect(
        timers.every(timer => timer.cancelled),
        "commit and fatal timers are all cancelled",
      ).toBe(true);
      await expect(guestStream.awaitTurn(1), "overflow cannot leak its formerly buffered turn").resolves.toBeNull();
      expect(guestStream.consumeCheckpoint()).toBeNull();
      hostStream.dispose();
      guestStream.dispose();
    });

    it("bounds permanent turn/replacement ACK loss with one shared terminal and releases every retry", async () => {
      const pair = wrapCoopFaultPair(
        createLoopbackPair(),
        {
          drop: 1,
          reorder: 0,
          delay: 0,
          faultable: faultableTypes(["turnCommitAck", "battleCheckpointAck"]),
        },
        { seed: 0x50333342 },
      );
      const current = { epoch: 7, wave: 1, turn: 1 };
      const timers: { callback: () => void; ms: number; cancelled: boolean; fired: boolean }[] = [];
      let now = 0;
      const terminalReasons: string[] = [];
      const hostStream = new CoopBattleStreamer(pair.host, {
        authorityContext: () => current,
        authorityRetentionMs: 100,
        now: () => now,
        schedule: (callback, ms) => {
          const timer = { callback, ms, cancelled: false, fired: false };
          timers.push(timer);
          return () => {
            timer.cancelled = true;
          };
        },
        onAuthorityTerminal: reason => terminalReasons.push(reason),
      });
      const guestStream = new CoopBattleStreamer(pair.guest, { authorityContext: () => current });
      let peerFailures = 0;
      guestStream.onAuthorityFailure(() => peerFailures++);
      let rawTurnDeliveries = 0;
      let rawReplacementDeliveries = 0;
      pair.guest.onMessage(message => {
        if (message.t === "turnResolution") {
          rawTurnDeliveries++;
        }
        if (message.t === "battleCheckpoint") {
          rawReplacementDeliveries++;
        }
      });

      const awaited = guestStream.awaitTurn(1);
      emitCompleteTurn(hostStream, 1, [], emptyCheckpoint(), "deadbeefdeadbeef");
      const resolution = await awaited;
      acknowledgeTurnThroughContinuation(guestStream, resolution!);
      const replacement = checkpointEnvelope(
        "replacement",
        { ...emptyCheckpoint(), tick: 21 },
        "2222222222222222",
        emptyAuthoritativeState(1, 1, 22),
      );
      hostStream.sendCheckpoint(
        replacement.reason,
        replacement.epoch,
        replacement.wave,
        replacement.turn,
        replacement.checkpoint,
        replacement.checksum,
        replacement.fullField,
        replacement.authoritativeState,
      );
      await flushWire();
      expect(guestStream.consumeCheckpoint()).toEqual(replacement);
      acknowledgeReplacementThroughContinuation(guestStream, replacement);
      await flushWire();
      expect(pair.counters.guest.dropped, "both authority ACK classes are permanently faulted").toBeGreaterThanOrEqual(
        2,
      );

      now = 100;
      const commitRetry = timers.find(timer => timer.ms === 2_000 && !timer.cancelled);
      expect(commitRetry).toBeDefined();
      commitRetry!.fired = true;
      commitRetry!.callback();
      await flushWire();
      await flushWire();

      expect(peerFailures, "the guest accepted the delayed fatal using its exact ACK proof").toBe(1);
      expect(terminalReasons).toEqual([expect.stringContaining("retention deadline")]);
      expect(
        timers.every(timer => timer.fired || timer.cancelled),
        "the terminal outcome leaves no live commit/fatal retry timer",
      ).toBe(true);

      const turnsBeforeTerminalProbe = rawTurnDeliveries;
      const replacementsBeforeTerminalProbe = rawReplacementDeliveries;
      guestStream.requestTurnCommit(7, 1, 1, resolution!.revision);
      guestStream.requestReplacementCheckpoint(replacement);
      await flushWire();
      expect(rawTurnDeliveries, "turn authority cannot resume after the terminal outcome").toBe(
        turnsBeforeTerminalProbe,
      );
      expect(rawReplacementDeliveries, "replacement authority also clears only after the same terminal outcome").toBe(
        replacementsBeforeTerminalProbe,
      );
      hostStream.dispose();
      guestStream.dispose();
    });

    it("accepts an exactly ACKed N+1 replacement as proof that a delayed turn-N commit was superseded", async () => {
      const { host, guest } = createLoopbackPair();
      const current = { epoch: 7, wave: 4, turn: 1 };
      const hostStream = new CoopBattleStreamer(host, { authorityContext: () => current });
      const guestStream = new CoopBattleStreamer(guest, { authorityContext: () => current });
      const turnPromise = guestStream.awaitTurn(1);
      hostStream.emitTurn(
        7,
        4,
        1,
        [],
        emptyCheckpoint(),
        "deadbeefdeadbeef",
        "{}",
        emptyFullField(),
        emptyAuthoritativeState(4, 1),
      );
      const resolution = await turnPromise;
      expect(resolution).not.toBeNull();

      current.turn = 2;
      const replacementCheckpoint = { ...emptyCheckpoint(), tick: 21 };
      const replacement = checkpointEnvelope(
        "replacement",
        replacementCheckpoint,
        "cafebabecafebabe",
        emptyAuthoritativeState(4, 2, 22),
      );
      hostStream.sendCheckpoint(
        "replacement",
        replacement.epoch,
        replacement.wave,
        replacement.turn,
        replacement.checkpoint,
        replacement.checksum,
        replacement.fullField,
        replacement.authoritativeState,
      );
      await flushWire();
      expect(guestStream.consumeCheckpoint()?.turn).toBe(2);
      acknowledgeReplacementThroughContinuation(guestStream, replacement);
      await flushWire();
      acknowledgeTurnThroughContinuation(guestStream, resolution!, replacement);
      await flushWire();

      let pending = 0;
      guest.onMessage(message => {
        if (message.t === "turnCommitPending" && message.turn === 1) {
          pending++;
        }
      });
      guestStream.requestTurnCommit(7, 4, 1, resolution!.revision);
      await flushWire();
      expect(pending, "the exact superseded ACK cleared the retained turn-N commit").toBe(1);
      hostStream.dispose();
      guestStream.dispose();
    });

    it("retries a lost fatal frame, re-ACKs duplicates exactly once, and honors its absolute deadline", async () => {
      const pair = wrapCoopFaultPair(createLoopbackPair(), COOP_NO_FAULT_PROFILE, { seed: 0x50333246 });
      const scheduled: (() => void)[] = [];
      let now = 0;
      const hostStream = new CoopBattleStreamer(pair.host, {
        authorityContext: context,
        now: () => now,
        schedule: cb => {
          scheduled.push(cb);
          return () => {};
        },
      });
      const guestStream = new CoopBattleStreamer(pair.guest, { authorityContext: context });
      let routed = 0;
      guestStream.onAuthorityFailure(() => routed++);
      const failure = {
        t: "authorityFailure" as const,
        failureId: "fatal-1",
        epoch: 7,
        wave: 1,
        turn: 1,
        revision: 1,
        boundary: "turnResolution" as const,
        reason: "capture failed",
      };

      pair.armNextDrop("authorityFailure", "host");
      const acknowledged = hostStream.broadcastAuthorityFailure(failure);
      await flushWire();
      expect(routed).toBe(0);
      scheduled.shift()?.();
      await expect(acknowledged).resolves.toBe(true);
      expect(routed).toBe(1);

      pair.host.send(failure);
      await flushWire();
      expect(routed, "duplicate fatal delivery is re-ACKed without a second terminal route").toBe(1);
      hostStream.dispose();
      guestStream.dispose();

      const unackedPair = createLoopbackPair();
      const deadlineTimers: (() => void)[] = [];
      now = 0;
      const unackedHost = new CoopBattleStreamer(unackedPair.host, {
        authorityContext: context,
        now: () => now,
        schedule: cb => {
          deadlineTimers.push(cb);
          return () => {};
        },
      });
      const expired = unackedHost.broadcastAuthorityFailure({ ...failure, failureId: "fatal-deadline" });
      now = 3_000;
      deadlineTimers.shift()?.();
      await expect(expired).resolves.toBe(false);
      unackedHost.dispose();
    });

    it("accepts a delayed fatal for an exact retained address after ambient wave state advances", async () => {
      const pair = createLoopbackPair();
      const current = { epoch: 7, wave: 190, turn: 3 };
      const hostStream = new CoopBattleStreamer(pair.host, { authorityContext: () => current });
      const guestStream = new CoopBattleStreamer(pair.guest, { authorityContext: () => current });
      let routed = 0;
      guestStream.onAuthorityFailure(() => routed++);

      const awaited = guestStream.awaitTurn(3);
      hostStream.emitTurn(
        7,
        190,
        3,
        [],
        emptyCheckpoint(),
        "deadbeefdeadbeef",
        "{}",
        emptyFullField(),
        emptyAuthoritativeState(190, 3),
      );
      expect(await awaited, "the guest admitted immutable authority at the failing address").not.toBeNull();

      // A raw compatibility hint/speculative next battle may update this mutable context first.
      current.wave = 191;
      current.turn = 1;
      await hostStream.broadcastAuthorityFailure({
        epoch: 7,
        wave: 190,
        turn: 3,
        boundary: "turnResolution",
        reason: "late final-turn settlement failure",
      });
      await flushWire();

      expect(routed, "exact retained evidence outranks the speculative ambient successor").toBe(1);
      hostStream.dispose();
      guestStream.dispose();
    });

    it("rejects a cross-wave fatal when no exact authority evidence binds that old address", async () => {
      const pair = createLoopbackPair();
      const current = { epoch: 7, wave: 191, turn: 1 };
      const guestStream = new CoopBattleStreamer(pair.guest, { authorityContext: () => current });
      let routed = 0;
      guestStream.onAuthorityFailure(() => routed++);

      pair.host.send({
        t: "authorityFailure",
        failureId: "unbound-old-wave",
        epoch: 7,
        wave: 190,
        turn: 3,
        revision: 1,
        boundary: "turnResolution",
        reason: "unbound old failure",
      });
      await flushWire();

      expect(routed, "an address jump without immutable evidence remains fail-closed").toBe(0);
      guestStream.dispose();
    });
  });

  it("dispose fails an in-flight await and stops listening", async () => {
    const { host, guest } = createLoopbackPair();
    const hostStream = new CoopBattleStreamer(host);
    const guestStream = new CoopBattleStreamer(guest);

    const awaited = guestStream.awaitTurn(5);
    guestStream.dispose();
    expect(await awaited).toBeNull();

    // After dispose the guest no longer buffers/handles anything.
    let fired = false;
    guestStream.onCheckpoint(() => {
      fired = true;
    });
    sendCompleteCheckpoint(hostStream, "post-dispose", emptyCheckpoint(), "deadbeefdeadbeef");
    await new Promise(r => setTimeout(r, 0));
    expect(fired).toBe(false);
  });

  describe("ghost-pool sync (#633)", () => {
    // A minimal pool - the streamer relays it verbatim (order preserved), which is what
    // makes the guest's seeded ghost pick land on the same team as the host.
    // biome-ignore lint/suspicious/noExplicitAny: minimal fixtures; the streamer is shape-agnostic
    const pool = [{ id: "a" }, { id: "b" }, { id: "c" }] as any;

    it("the guest receives the host's ghost pool verbatim + in order", async () => {
      const { host, guest } = createLoopbackPair();
      const hostStream = new CoopBattleStreamer(host);
      const guestStream = new CoopBattleStreamer(guest);

      let got: { id: string }[] | null = null;
      guestStream.onGhostPool(p => {
        got = p as unknown as { id: string }[];
      });
      hostStream.sendGhostPool(pool);
      await new Promise(r => setTimeout(r, 0));
      expect((got as { id: string }[] | null)?.map(t => t.id)).toEqual(["a", "b", "c"]);
    });

    it("buffers a pool that arrives BEFORE the guest subscribes (eager broadcast)", async () => {
      const { host, guest } = createLoopbackPair();
      const hostStream = new CoopBattleStreamer(host);
      const guestStream = new CoopBattleStreamer(guest);

      // Host broadcasts on prefetch-resolve, possibly before the guest's runtime wires its
      // handler - the message must be buffered + delivered on subscribe, never lost.
      hostStream.sendGhostPool(pool);
      await new Promise(r => setTimeout(r, 0));
      let got: { id: string }[] | null = null;
      guestStream.onGhostPool(p => {
        got = p as unknown as { id: string }[];
      });
      expect((got as { id: string }[] | null)?.length).toBe(3);
    });
  });

  describe("checksum-driven resync handshake (#633, TRACK-2)", () => {
    it("emitTurn / sendCheckpoint carry the host's checksum to the guest's await/consume", async () => {
      const { host, guest } = createLoopbackPair();
      const hostStream = new CoopBattleStreamer(host);
      const guestStream = new CoopBattleStreamer(guest);

      const awaited = guestStream.awaitTurn(1);
      emitCompleteTurn(hostStream, 1, [], emptyCheckpoint(), "feedface00000001");
      const res = await awaited;
      expect(res?.checksum).toBe("feedface00000001");

      sendCompleteCheckpoint(hostStream, "switch", emptyCheckpoint(), "feedface00000002");
      await new Promise(r => setTimeout(r, 0));
      const envelope = guestStream.consumeCheckpoint();
      expect(envelope?.checksum).toBe("feedface00000002");
      expect(envelope?.reason).toBe("switch");
      // One-shot: consumed.
      expect(guestStream.consumeCheckpoint()).toBeNull();
    });

    it("a guest requestStateSync round-trips to the host and back as a stateSync blob", async () => {
      const { host, guest } = createLoopbackPair();
      const current = { epoch: 1, wave: 1, turn: 7 };
      const hostStream = new CoopBattleStreamer(host, { authorityContext: () => current });
      const guestStream = new CoopBattleStreamer(guest, { authorityContext: () => current });

      // Host answers the guest's exact immutable recovery ticket.
      let sawTurn = -1;
      hostStream.onStateSyncRequest(ticket => {
        sawTurn = ticket.frontier.turn;
        hostStream.sendStateSync(`blob-for-turn-${sawTurn}`, ticket, {
          wave: current.wave,
          turn: current.turn,
          stateTick: 1,
          controlDigest: "digest",
        });
      });

      const result = await guestStream.requestStateSync("turn-checksum");
      expect(sawTurn).toBe(7);
      expect(result).toMatchObject({ kind: "snapshot", blob: "blob-for-turn-7" });
    });

    it("a stale addressed stateSync never satisfies the newest resync request", async () => {
      const { host, guest } = createLoopbackPair();
      const current = { epoch: 1, wave: 1, turn: 2 };
      const hostStream = new CoopBattleStreamer(host, { authorityContext: () => current });
      const guestStream = new CoopBattleStreamer(guest, { authorityContext: () => current });

      // The host answers the FIRST request late + the SECOND promptly. The first request
      // is superseded by the second (one in flight at a time), so the late seq-1 reply is
      // dropped and only the seq-2 reply satisfies the live await.
      const seqs: number[] = [];
      let staleTicket: Parameters<typeof hostStream.sendStateSync>[1] | undefined;
      hostStream.onStateSyncRequest(ticket => {
        seqs.push(ticket.seq);
        if (ticket.seq === 1) {
          staleTicket = ticket;
        } else {
          hostStream.sendStateSync("fresh", ticket, {
            wave: current.wave,
            turn: current.turn,
            stateTick: 2,
            controlDigest: "digest-2",
          });
        }
      });

      const first = guestStream.requestStateSync("turn-checksum"); // seq 1 - superseded
      await new Promise<void>(resolve => queueMicrotask(resolve));
      const second = guestStream.requestStateSync("stall"); // seq 2 - the live one
      // The stale seq-1 reply, were it to arrive, must not satisfy `second`.
      hostStream.sendStateSync("stale", staleTicket!, {
        wave: current.wave,
        turn: current.turn,
        stateTick: 1,
        controlDigest: "digest-1",
      });

      expect(await first).toEqual({ kind: "superseded" });
      expect(await second).toMatchObject({ kind: "snapshot", blob: "fresh" });
      expect(seqs).toEqual([1, 2]);
    });

    it("a resync that never gets answered resolves with an explicit timeout", async () => {
      const { guest } = createLoopbackPair();
      const current = { epoch: 1, wave: 1, turn: 3 };
      // Deliberately install no host streamer/listener, so no explicit unavailable can return.
      const guestStream = new CoopBattleStreamer(guest, {
        authorityContext: () => current,
        recoveryTimeoutMs: 1,
        schedule: cb => {
          cb();
          return () => {};
        },
      });
      expect(await guestStream.requestStateSync("turn-checksum")).toEqual({ kind: "timeout" });
    });

    it("the owner's ME-boundary checksum reaches the watcher's handler (#633 Phase C)", async () => {
      const { host, guest } = createLoopbackPair();
      const ownerStream = new CoopBattleStreamer(host);
      const watcherStream = new CoopBattleStreamer(guest);

      let got: { seq: number; checksum: string } | null = null;
      watcherStream.onMeChecksum((seq, checksum) => {
        got = { seq, checksum };
      });
      ownerStream.sendMeChecksum(42, "cafebabecafebabe");
      await new Promise(r => setTimeout(r, 0));
      expect(got).toEqual({ seq: 42, checksum: "cafebabecafebabe" });
    });
  });

  describe("enemy-party handoff robustness (#633/#698 re-request + retry)", () => {
    it("a guest requestEnemyParty reaches the host's responder, which re-broadcasts the party", async () => {
      const { host, guest } = createLoopbackPair();
      const hostStream = new CoopBattleStreamer(host);
      const guestStream = new CoopBattleStreamer(guest);

      // Host responder: re-broadcast a fixed party for the requested wave (mirrors the
      // runtime responder, which serializes captureCoopEnemies() once the host has it).
      let sawRequest = -1;
      hostStream.onEnemyPartyRequest(wave => {
        sawRequest = wave;
        hostStream.sendEnemyParty(wave, [{ fieldIndex: 2, data: { speciesId: 296 } }]);
      });

      guestStream.requestEnemyParty(4);
      await new Promise(r => setTimeout(r, 0));
      expect(sawRequest).toBe(4);

      const enemies = guestStream.consumeEnemyParty(4);
      expect(enemies?.[0]?.data.speciesId).toBe(296);
    });

    it("awaitEnemyPartyWithRetry re-requests on the interval and resolves when the host answers a retry", async () => {
      const { host, guest } = createLoopbackPair();
      const hostStream = new CoopBattleStreamer(host);

      // Drive the retry timer manually; the underlying long await never fires its ceiling here.
      const timers: (() => void)[] = [];
      const guestStream = new CoopBattleStreamer(guest, {
        schedule: cb => {
          timers.push(cb);
          return () => {};
        },
      });

      // Host has NOT broadcast yet; it only answers a re-request (the lost-message case).
      const requests: number[] = [];
      hostStream.onEnemyPartyRequest(wave => {
        requests.push(wave);
        // Answer the SECOND request to prove the immediate replay request is followed by timed retry.
        if (requests.length === 2) {
          hostStream.sendEnemyParty(wave, [{ fieldIndex: 2, data: { speciesId: 307 } }]);
        }
      });

      const awaited = guestStream.awaitEnemyPartyWithRetry(4, w => guestStream.requestEnemyParty(w), {
        timeoutMs: 120_000,
        retryIntervalMs: 5_000,
        maxRetries: 6,
      });

      // The first request was sent immediately after parking. The first scheduled timer is the
      // underlying await's ceiling; the retry timer follows it.
      expect(timers.length).toBe(2); // [0] = ceiling, [1] = first retry
      await new Promise(r => setTimeout(r, 0));
      expect(requests).toEqual([4]);
      // Fire the first timed retry -> second request, which the host answers.
      timers[1]?.();
      const res = await awaited;
      expect(requests).toEqual([4, 4]);
      expect(res?.[0]?.data.speciesId).toBe(307);
    });

    it("replays the exact retained wave carrier after first-envelope loss", async () => {
      const pair = wrapCoopFaultPair(createLoopbackPair(), COOP_NO_FAULT_PROFILE, { seed: 0x454e454d });
      const hostStream = new CoopBattleStreamer(pair.host);
      const guestStream = new CoopBattleStreamer(pair.guest);
      const state = emptyAuthoritativeState(9);
      const party = [{ fieldIndex: 0, data: { speciesId: 307, level: 40 } }];

      pair.armNextDrop("enemyPartySync", "host");
      hostStream.sendEnemyParty(9, party, 44, 1, state);
      const received = await guestStream.awaitEnemyPartyWithRetry(9, wave => guestStream.requestEnemyParty(wave), {
        timeoutMs: 1_000,
        retryIntervalMs: 100,
        maxRetries: 1,
      });

      expect(pair.counters.host.oneShotDropped, "the first full wave carrier was actually lost").toBe(1);
      expect(received).toEqual(party);
      expect(guestStream.meTypeForWave(9), "the host ME verdict survives replay").toBe(44);
      expect(guestStream.battleTypeForWave(9), "the host battle type survives replay").toBe(1);
      expect(guestStream.consumeEnemyPartyState(9), "the complete wave boundary survives replay").toEqual(state);

      hostStream.dispose();
      guestStream.dispose();
    });

    it("replays the complete encounter authority after first-envelope loss", async () => {
      const pair = wrapCoopFaultPair(createLoopbackPair(), COOP_NO_FAULT_PROFILE, { seed: 0x454e4354 });
      const hostStream = new CoopBattleStreamer(pair.host);
      const guestStream = new CoopBattleStreamer(pair.guest);
      const party = [{ fieldIndex: 0, data: { speciesId: 307, level: 40 } }];
      const encounter = {
        battleType: 1,
        mysteryEncounterType: -1,
        formatId: "double",
        enemyLevels: [40, 41],
        trainer: {
          trainerType: 12,
          variant: 2,
          partyTemplateIndex: 1,
          name: "Authority",
          partnerName: "Replay",
        },
      };

      pair.armNextDrop("enemyPartySync", "host");
      hostStream.sendEnemyParty(9, party, -1, 1, undefined, encounter);
      await guestStream.awaitEnemyPartyWithRetry(9, wave => guestStream.requestEnemyParty(wave), {
        timeoutMs: 1_000,
        retryIntervalMs: 100,
        maxRetries: 1,
      });

      expect(guestStream.consumeEnemyPartyEncounter(9)).toEqual(encounter);
      expect(guestStream.consumeEnemyPartyEncounter(9), "encounter authority is consumed atomically").toBeUndefined();

      hostStream.dispose();
      guestStream.dispose();
    });

    it("never downgrades a retained complete carrier to a party-only retry response", async () => {
      const { host, guest } = createLoopbackPair();
      const hostStream = new CoopBattleStreamer(host);
      const guestStream = new CoopBattleStreamer(guest);
      const party = [{ fieldIndex: 0, data: { speciesId: 307, level: 40 } }];
      const encounter = {
        battleType: 0,
        mysteryEncounterType: -1,
        formatId: "double",
        enemyLevels: [40, 40],
      };

      hostStream.sendEnemyParty(2, party, -1, 0, undefined, encounter);
      await new Promise(r => setTimeout(r, 0));
      // Model the obsolete CommandPhase/re-request responder attempting to replace the same wave with
      // a narrower carrier. The stream must retain and replay the complete EncounterPhase authority.
      hostStream.sendEnemyParty(2, party, undefined, 0);
      guestStream.consumeEnemyParty(2);
      guestStream.consumeEnemyPartyEncounter(2);
      guestStream.requestEnemyParty(2);
      await new Promise(r => setTimeout(r, 0));

      expect(guestStream.consumeEnemyParty(2)).toEqual(party);
      expect(guestStream.consumeEnemyPartyEncounter(2)).toEqual(encounter);

      hostStream.dispose();
      guestStream.dispose();
    });

    it("awaitEnemyPartyWithRetry resolves immediately from a party buffered BEFORE the await (no retry needed)", async () => {
      const { host, guest } = createLoopbackPair();
      const hostStream = new CoopBattleStreamer(host);
      const guestStream = new CoopBattleStreamer(guest);

      // The host's broadcast lands before the guest reaches its await -> consumed from the buffer.
      hostStream.sendEnemyParty(4, [{ fieldIndex: 2, data: { speciesId: 296 } }]);
      await new Promise(r => setTimeout(r, 0));

      let requested = false;
      const res = await guestStream.awaitEnemyPartyWithRetry(4, () => {
        requested = true;
      });
      expect(res?.[0]?.data.speciesId).toBe(296);
      expect(requested).toBe(false);
    });

    it("awaitEnemyPartyWithRetry resolves null after the ceiling so the production caller can fail closed", async () => {
      const { guest } = createLoopbackPair();
      // Every scheduled timer fires immediately: the retries re-request (no host), then the
      // ceiling-await also fires immediately -> null. Null never authorizes local enemy generation.
      const guestStream = new CoopBattleStreamer(guest, {
        schedule: cb => {
          cb();
          return () => {};
        },
      });
      const res = await guestStream.awaitEnemyPartyWithRetry(4, () => {}, {
        timeoutMs: 1,
        retryIntervalMs: 1,
        maxRetries: 2,
      });
      expect(res).toBeNull();
    });

    it("a requestEnemyParty with no host responder is a safe no-op (does not throw)", async () => {
      const { host, guest } = createLoopbackPair();
      new CoopBattleStreamer(host); // host installs no responder
      const guestStream = new CoopBattleStreamer(guest);
      expect(() => guestStream.requestEnemyParty(4)).not.toThrow();
      await new Promise(r => setTimeout(r, 0));
    });
  });

  // Fix #1 (#633): the enemy-party stream carries each enemy's HELD ITEMS (serialized
  // ModifierData blobs) for TRAINER + wild waves, so the guest reconstructs the host's
  // exact items instead of rolling its own (which double / diverged the items). We assert
  // the held-item payload survives the wire AND a JSON round-trip (the real WebRTC transport
  // structured-clones / JSON-encodes), since that is the shape buildCoopEnemy reconstructs.
  describe("enemy held-item carry (#633 Fix #1)", () => {
    const heldItems = [
      { typeId: "LEFTOVERS", className: "TurnHealModifier", args: [999], stackCount: 1 },
      { typeId: "BERRY", className: "BerryModifier", args: [999], stackCount: 2, typePregenArgs: [4] },
    ];

    it("the host's serialized held items reach the guest verbatim", async () => {
      const { host, guest } = createLoopbackPair();
      const hostStream = new CoopBattleStreamer(host);
      const guestStream = new CoopBattleStreamer(guest);

      hostStream.sendEnemyParty(4, [{ fieldIndex: 0, data: { speciesId: 163, heldItems } }]);
      await new Promise(r => setTimeout(r, 0));

      const enemies = guestStream.consumeEnemyParty(4);
      const carried = enemies?.[0]?.data.heldItems as typeof heldItems | undefined;
      expect(carried).toBeDefined();
      expect(carried).toEqual(heldItems);
    });

    it("the held-item payload survives a JSON round-trip (real transport encoding)", () => {
      // buildCoopEnemy -> applyCoopEnemyHeldItems reconstructs `new ModifierData(blob, false)`
      // from exactly these plain fields, so the wire encoding must preserve them losslessly.
      const round = JSON.parse(JSON.stringify({ speciesId: 163, heldItems }));
      expect(round.heldItems).toEqual(heldItems);
      expect(round.heldItems[1].typePregenArgs).toEqual([4]);
    });
  });

  // #633 M4 push-snapshot launch: the host PUSHES the full session snapshot at launch and the guest
  // BOOTS from it, and the `requestEnemyParty` POLL is DELETED (the guest awaits the host's one-shot
  // push event-driven over the ordered/reliable channel). These engine-free tests pin the wire half:
  // the launchSnapshot round-trip (parked-waiter + race-buffer + timeout) and that awaitEnemyParty
  // emits ZERO re-request messages. (The full two-engine convergence proof is coop-duo-launch-snapshot.)
  describe("launch snapshot + poll deletion (#633 M4)", () => {
    const SESSION_JSON = JSON.stringify({ seed: "abc", waveIndex: 1, party: [], enemyParty: [] });

    it("the guest awaits the host's launchSnapshot PUSH when parked first (no poll)", async () => {
      const { host, guest } = createLoopbackPair();
      const hostStream = new CoopBattleStreamer(host);
      const guestStream = new CoopBattleStreamer(guest);

      // Guest reaches launch and parks BEFORE the host has generated (the realistic order).
      const awaited = guestStream.awaitLaunchSnapshot(1);
      hostStream.sendLaunchSnapshot(1, SESSION_JSON);

      expect(await awaited).toBe(SESSION_JSON);
    });

    it("the guest consumes a launchSnapshot that arrived BEFORE its await (race buffer)", async () => {
      const { host, guest } = createLoopbackPair();
      const hostStream = new CoopBattleStreamer(host);
      const guestStream = new CoopBattleStreamer(guest);

      hostStream.sendLaunchSnapshot(1, SESSION_JSON);
      await new Promise(r => setTimeout(r, 0)); // let it land in the guest buffer

      expect(await guestStream.awaitLaunchSnapshot(1)).toBe(SESSION_JSON);
    });

    it("a guest that missed the launchSnapshot re-requests the host's cached snapshot", async () => {
      const { host, guest } = createLoopbackPair();
      const hostStream = new CoopBattleStreamer(host);

      // The push lands before the guest streamer exists, reproducing a lost boundary frame.
      hostStream.sendLaunchSnapshot(1, SESSION_JSON);
      await new Promise(r => setTimeout(r, 0));
      const guestStream = new CoopBattleStreamer(guest);

      expect(await guestStream.awaitLaunchSnapshot(1)).toBe(SESSION_JSON);
    });

    it("a guest that missed a first-save abort re-requests the host's retained abort", async () => {
      const { host, guest } = createLoopbackPair();
      const hostStream = new CoopBattleStreamer(host);

      // The first carrier is lost before the guest streamer exists. The later wave-keyed request
      // must replay the abort, never hang and never synthesize a launch snapshot.
      hostStream.sendLaunchSnapshotAbort(1, "first-save-cas-failed");
      await new Promise(r => setTimeout(r, 0));
      const guestStream = new CoopBattleStreamer(guest);
      expect(await guestStream.awaitLaunchSnapshot(1)).toBeNull();
    });

    it("awaitLaunchSnapshot resolves null on timeout (authoritative caller fails closed)", async () => {
      const { guest } = createLoopbackPair();
      const timer: { fire?: () => void } = {};
      const guestStream = new CoopBattleStreamer(guest, {
        schedule: cb => {
          timer.fire = cb;
          return () => {};
        },
      });
      const awaited = guestStream.awaitLaunchSnapshot(1, 5_000);
      timer.fire?.(); // fire the timeout
      expect(await awaited).toBeNull();
    });

    it("THE POLL IS GONE: awaitEnemyParty sends ZERO requestEnemyParty messages on the wire", async () => {
      const { host, guest } = createLoopbackPair();
      // Tap everything the GUEST endpoint sends toward the host (host receives it here).
      const hostSeen: string[] = [];
      host.onMessage(msg => hostSeen.push(msg.t));
      const hostStream = new CoopBattleStreamer(host);
      const guestStream = new CoopBattleStreamer(guest);

      // The M4 production path awaits event-driven (awaitEnemyParty), NOT the retry poll. Even with
      // a wait window elapsing before the host answers, the guest must NEVER re-request.
      const awaited = guestStream.awaitEnemyParty(3, 5_000);
      await new Promise(r => setTimeout(r, 0));
      hostStream.sendEnemyParty(3, [{ fieldIndex: 2, data: { speciesId: 1 } }]);
      const res = await awaited;

      expect(res?.[0]?.data.speciesId).toBe(1);
      expect(hostSeen, "the guest emitted NO requestEnemyParty (the poll is deleted)").not.toContain(
        "requestEnemyParty",
      );
    });
  });
});

describe("stale-turn finalize mark (#790 + regression fix)", () => {
  it("never lets a raced cosmetic carrier strip the V2 revision/successor from a cut-over turn", async () => {
    const { host, guest } = createLoopbackPair();
    let fireTimeout: (() => void) | undefined;
    const stream = new CoopBattleStreamer(guest, {
      timeoutMs: 5_000,
      schedule: cb => {
        fireTimeout = cb;
        return () => {};
      },
    });
    const cutover = new CoopV2TurnCutover({} as never);
    setActiveCoopV2TurnCutover(cutover);
    const carrier = {
      t: "turnResolution",
      epoch: 7,
      wave: 1,
      turn: 1,
      revision: 20,
      events: [],
      checkpoint: emptyCheckpoint(),
      checksum: "deadbeefdeadbeef",
      preimage: "{}",
      fullField: emptyFullField(),
      authoritativeState: emptyAuthoritativeState(1, 1, 20),
    } satisfies Extract<CoopMessage, { t: "turnResolution" }>;
    const replacement = {
      kind: "REPLACEMENT",
      operationId: "RC/e7/w1/t1/o2/f1/s1",
      ownerSeatId: 1,
      epoch: 7,
      wave: 1,
      turn: 1,
      occurrence: 2,
      fieldIndex: 1,
      remaining: [],
    } as const;

    try {
      const cosmeticOnly = stream.awaitTurn(1, 1);
      host.send(carrier);
      fireTimeout?.();
      expect(await cosmeticOnly, "the raw compatibility copy cannot drive mechanics under V2").toBeNull();

      const authoritative = stream.awaitTurn(1, 1);
      stream.ingestAuthoritativeV2Turn(carrier, replacement, 2);
      const admitted = await authoritative;
      expect(admitted?.authorityNextControl).toEqual(replacement);
      expect(admitted?.authorityRevision).toBe(2);
    } finally {
      clearActiveCoopV2TurnCutover(cutover);
      cutover.dispose();
      stream.dispose();
    }
  });

  it("keeps a materialized same-turn replacement carrier consumable even after its turn is finalized (#faint-material-digest)", async () => {
    const { host, guest } = createLoopbackPair();
    const hostCurrent = { epoch: 7, wave: 1, turn: 1 };
    const guestCurrent = { epoch: 7, wave: 1, turn: 1 };
    const hostStream = new CoopBattleStreamer(host, { authorityContext: () => hostCurrent });
    const guestStream = new CoopBattleStreamer(guest, { authorityContext: () => guestCurrent });
    try {
      // Nothing buffered yet: the #790 stale-duplicate bail is free to fire.
      expect(guestStream.hasConsumableReplacementForTurn(1)).toBe(false);

      // The authority ships the post-summon SAME-TURN replacement carrier for turn 1 (a faint replacement is
      // addressed at the faint's own turn, which the ordinary TURN_COMMIT already finalized).
      const replacement = checkpointEnvelope(
        "replacement",
        { ...emptyCheckpoint(), tick: 20 },
        "cafebabecafebabe",
        emptyAuthoritativeState(1, 1, 21),
      );
      hostStream.sendCheckpoint(
        replacement.reason,
        replacement.epoch,
        replacement.wave,
        replacement.turn,
        replacement.checkpoint,
        replacement.checksum,
        replacement.fullField,
        replacement.authoritativeState,
      );
      await flushWire();

      // The carrier is buffered and wakeable for the exact same turn, so the replay phase MUST NOT treat the
      // finalized turn as a stale phantom - it has to fall through to the pump and consume this checkpoint.
      expect(guestStream.peekCheckpointForTurn(1)).toEqual(replacement);
      expect(guestStream.hasConsumableReplacementForTurn(1)).toBe(true);

      // Once consumed, there is nothing left to wake the turn, so a later duplicate replay IS a stale phantom.
      expect(guestStream.consumeCheckpointForTurn(1)).toEqual(replacement);
      expect(guestStream.hasConsumableReplacementForTurn(1)).toBe(false);
    } finally {
      guestStream.dispose();
      hostStream.dispose();
    }
  });

  it("proves Authority V2 material only after the exact admitted revision completes the real finalize path", async () => {
    const { guest } = createLoopbackPair();
    const current = { epoch: 7, wave: 1, turn: 1 };
    const stream = new CoopBattleStreamer(guest, { authorityContext: () => current });
    const carrier = {
      t: "turnResolution",
      epoch: 7,
      wave: 1,
      turn: 1,
      revision: 20,
      events: [],
      checkpoint: emptyCheckpoint(),
      checksum: "deadbeefdeadbeef",
      preimage: "{}",
      fullField: emptyFullField(),
      authoritativeState: emptyAuthoritativeState(1, 1, 20),
    } satisfies Extract<CoopMessage, { t: "turnResolution" }>;

    // The renderer shell can speculatively advance before its real replay consumer starts. Authority V2
    // admission is already exact/session-bound, so its material must survive that ambient legacy mismatch
    // and remain addressable by the replay phase's immutable source wave.
    current.turn = 2;
    const awaitedSuccessor = {
      kind: "AWAIT_SUCCESSOR",
      afterOperationId: "TURN/fixture",
      epoch: 7,
      wave: 1,
      turn: 1,
      allowedKinds: ["REPLACEMENT_COMMIT", "INTERACTION_COMMIT", "WAVE_ADVANCE", "TERMINAL_COMMIT"],
      allowNextWaveStart: false,
      expectedOperationId: null,
    } as const;
    stream.ingestAuthoritativeV2Turn(carrier, awaitedSuccessor, 1);
    const awaited = stream.awaitTurn(1, 1);
    const admitted = await awaited;
    expect(admitted).not.toBeNull();
    expect(admitted?.authorityNextControl, "the renderer receives V2's explicit ordered successor wait").toEqual(
      awaitedSuccessor,
    );
    expect(
      admitted?.authorityRevision,
      "the renderer receives the V2 global revision, not the unrelated turn-carrier revision",
    ).toBe(1);
    expect(stream.hasFinalizedAuthoritativeV2Turn(carrier), "admitted/buffered material is not applied material").toBe(
      false,
    );

    expect(stream.markAuthoritativeTurnFinalized(admitted!)).toBe(true);
    expect(stream.hasFinalizedAuthoritativeV2Turn(carrier)).toBe(true);
    expect(
      stream.hasFinalizedAuthoritativeV2Turn({ ...carrier, checksum: "feedfacefeedface" }),
      "same address+revision with different canonical material cannot reuse the proof",
    ).toBe(false);

    const newer = {
      ...carrier,
      revision: 21,
      checkpoint: { ...carrier.checkpoint, tick: 20 },
      authoritativeState: emptyAuthoritativeState(1, 1, 21),
    } satisfies Extract<CoopMessage, { t: "turnResolution" }>;
    stream.ingestAuthoritativeV2Turn(newer, awaitedSuccessor, 2);
    expect(
      stream.hasFinalizedAuthoritativeV2Turn(newer),
      "a generic same-address finalize mark cannot prove a newer revision",
    ).toBe(false);

    stream.clearFinalizedMark();
    expect(
      stream.hasFinalizedAuthoritativeV2Turn(carrier),
      "wave-local renderer cleanup must retain the exact V2 proof for post-boundary reliable redelivery",
    ).toBe(true);
    stream.dispose();
  });

  it("marks kill same-wave duplicates but NEVER survive the wave boundary (the live 'stuck after normal combat' regression)", () => {
    const { host } = createLoopbackPair();
    const stream = new CoopBattleStreamer(host);
    // Within a wave: once turn N finalized, N and below are stale, N+1 is live.
    stream.markTurnFinalized(7, 1, 2);
    expect(stream.isTurnFinalized(1, 1), "earlier turn same wave is stale").toBe(true);
    expect(stream.isTurnFinalized(1, 2), "the finalized turn itself is stale").toBe(true);
    expect(stream.isTurnFinalized(1, 3), "the NEXT turn is live").toBe(false);
    // A different waveIndex never matches (the guard is wave-scoped).
    expect(stream.isTurnFinalized(2, 1), "another wave's turn 1 is live").toBe(false);
    // THE REGRESSION: the guest's waveIndex may not tick before the next wave's turn 1 replay
    // starts, so the wave boundary MUST clear the mark - otherwise (same stale waveIndex, turn 1)
    // reads as a duplicate and the new wave's first turn is killed in a loop.
    stream.clearFinalizedMark();
    expect(stream.isTurnFinalized(1, 1), "after the wave-boundary clear NOTHING is stale").toBe(false);
    expect(stream.isTurnFinalized(1, 2), "after the wave-boundary clear NOTHING is stale (finalized turn)").toBe(false);
  });

  it("does not treat the same wave/turn in a replacement authority epoch as finalized", () => {
    const { host } = createLoopbackPair();
    const current = { epoch: 8, wave: 1, turn: 2 };
    const stream = new CoopBattleStreamer(host, { authorityContext: () => current });
    // The accepted epoch-7 resolution finalized after recovery had already installed epoch 8.
    // The mark must retain the resolution's explicit epoch rather than sampling mutable context.
    stream.markTurnFinalized(7, 1, 2);
    expect(stream.isTurnFinalized(1, 2)).toBe(false);

    stream.markTurnFinalized(8, 1, 2);
    stream.markTurnFinalized(7, 1, 3);
    expect(stream.isTurnFinalized(1, 2), "an older epoch mark cannot overwrite the current epoch").toBe(true);
    current.epoch = 7;
    expect(stream.isTurnFinalized(1, 2)).toBe(true);
    current.epoch = 8;
    expect(
      stream.isTurnFinalized(1, 2),
      "the current epoch remains finalized after inspecting an independently retained older-epoch mark",
    ).toBe(true);
    stream.dispose();
  });
});

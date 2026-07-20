/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import {
  resolveCoopV2CommandFrontier,
  resolveCoopV2ReplacementControl,
  resolveCoopV2ShowdownCommandProof,
} from "#data/elite-redux/coop/authority-v2/command-frontier";
import { validateNextControl } from "#data/elite-redux/coop/authority-v2/next-control";
import type { CoopAuthoritativeBattleStateV1, CoopAuthoritativeFieldSeat } from "#data/elite-redux/coop/coop-transport";
import { describe, expect, it } from "vitest";

function fieldSeat(
  side: "player" | "enemy",
  bi: number,
  pokemonId: number,
  overrides: Partial<CoopAuthoritativeFieldSeat> = {},
): CoopAuthoritativeFieldSeat {
  return {
    side,
    bi,
    pokemonId,
    partyIndex: side === "player" ? bi : Math.max(0, bi - 2),
    presented: true,
    ...overrides,
  };
}

function state(
  field: CoopAuthoritativeFieldSeat[],
  playerParty: Record<string, unknown>[],
  enemyParty: Record<string, unknown>[],
): CoopAuthoritativeBattleStateV1 {
  return {
    version: 1,
    tick: 1,
    wave: 1,
    turn: 1,
    playerParty,
    enemyParty,
    field,
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
}

describe("resolveCoopV2CommandFrontier", () => {
  it("extracts every numeric-seat classic co-op actor and omits an unowned AI enemy", () => {
    const result = resolveCoopV2CommandFrontier(
      state(
        [
          fieldSeat("enemy", 2, 90),
          fieldSeat("player", 1, 11, { ownerSeatId: 5, owner: "guest" }),
          fieldSeat("player", 0, 10, { ownerSeatId: 2, owner: "host" }),
        ],
        [
          { id: 10, hp: 30 },
          { id: 11, hp: 20 },
        ],
        [{ id: 90, hp: 100 }],
      ),
    );

    expect(result.unresolved).toEqual([]);
    expect(result.commands).toEqual([
      { ownerSeatId: 2, pokemonId: 10, fieldIndex: 0 },
      { ownerSeatId: 5, pokemonId: 11, fieldIndex: 1 },
    ]);
  });

  it("includes Showdown's owned enemy side and allows opposing parties to reuse a Pokemon id", () => {
    const result = resolveCoopV2CommandFrontier(
      state(
        [
          fieldSeat("player", 0, 42, { ownerSeatId: 7, owner: "host" }),
          fieldSeat("enemy", 2, 42, { ownerSeatId: 9, owner: "guest" }),
        ],
        [{ id: 42, hp: 100 }],
        [{ id: 42, hp: 100 }],
      ),
    );
    const control = {
      kind: "COMMAND_FRONTIER" as const,
      epoch: 1,
      wave: 1,
      turn: 1,
      commands: result.commands,
    };

    expect(result.unresolved).toEqual([]);
    expect(result.commands).toEqual([
      { ownerSeatId: 7, pokemonId: 42, fieldIndex: 0 },
      { ownerSeatId: 9, pokemonId: 42, fieldIndex: 2 },
    ]);
    expect(validateNextControl(control)).toEqual({ ok: true });
  });

  it("fails loud for an unowned human seat instead of silently publishing a partial frontier", () => {
    const ownerless = fieldSeat("player", 0, 10);
    const result = resolveCoopV2CommandFrontier(state([ownerless], [{ id: 10, hp: 30 }], []));

    expect(result.commands).toEqual([]);
    expect(result.unresolved).toEqual([{ seat: ownerless, reason: "missing-owner" }]);
  });

  it("uses Pokemon identity before party index and excludes only the actually fainted actor", () => {
    const result = resolveCoopV2CommandFrontier(
      state(
        [
          fieldSeat("player", 0, 22, { ownerSeatId: 3, partyIndex: 0 }),
          fieldSeat("player", 1, 11, { ownerSeatId: 4, partyIndex: 1 }),
        ],
        [
          { id: 11, hp: 0 },
          { id: 22, hp: 50 },
        ],
        [],
      ),
    );

    expect(result.unresolved).toEqual([]);
    expect(result.commands).toEqual([{ ownerSeatId: 3, pokemonId: 22, fieldIndex: 0 }]);
  });

  it("excludes a healthy logical slot occupant that has no real presented CommandPhase", () => {
    const result = resolveCoopV2CommandFrontier(
      state(
        [
          fieldSeat("player", 0, 10, { ownerSeatId: 2, presented: false }),
          fieldSeat("player", 1, 11, { ownerSeatId: 5 }),
        ],
        [
          { id: 10, hp: 30 },
          { id: 11, hp: 20 },
        ],
        [],
      ),
    );

    expect(result.unresolved).toEqual([]);
    expect(result.commands).toEqual([{ ownerSeatId: 5, pokemonId: 11, fieldIndex: 1 }]);
  });

  it("keeps the persisted host/guest role fallback but rejects invalid addresses", () => {
    const result = resolveCoopV2CommandFrontier(
      state(
        [
          fieldSeat("player", 0, 12, { owner: "host" }),
          fieldSeat("player", -1, 13, { owner: "guest" }),
          fieldSeat("enemy", 2, 0, { owner: "guest" }),
        ],
        [
          { id: 12, hp: 10 },
          { id: 13, hp: 10 },
        ],
        [{ id: 0, hp: 10 }],
      ),
    );

    expect(result.commands).toEqual([{ ownerSeatId: 0, pokemonId: 12, fieldIndex: 0 }]);
    expect(result.unresolved.map(issue => issue.reason)).toEqual(["invalid-field-index", "invalid-pokemon-id"]);
  });
});

describe("resolveCoopV2ReplacementControl", () => {
  it("states the exact event occurrence and owner-addressed classic co-op picker", () => {
    const result = resolveCoopV2ReplacementControl(
      4,
      state(
        [fieldSeat("player", 1, 11, { ownerSeatId: 7 })],
        [
          { id: 11, hp: 0, coopOwnerSeatId: 7 },
          { id: 12, hp: 20, coopOwnerSeatId: 7 },
        ],
        [],
      ),
      [
        { k: "message", text: "before" },
        { k: "faint", bi: 1 },
      ],
    );

    expect(result).toEqual({
      kind: "REPLACEMENT",
      operationId: "RC/e4/w1/t1/o1/f1/s7",
      ownerSeatId: 7,
      epoch: 4,
      wave: 1,
      turn: 1,
      occurrence: 1,
      fieldIndex: 1,
    });
  });

  it("derives the enemy-side field offset from the authoritative geometry", () => {
    const result = resolveCoopV2ReplacementControl(
      2,
      state(
        [fieldSeat("player", 0, 10, { ownerSeatId: 3 }), fieldSeat("enemy", 1, 90, { ownerSeatId: 9 })],
        [{ id: 10, hp: 30, coopOwnerSeatId: 3 }],
        [
          { id: 90, hp: 0 },
          { id: 91, hp: 20 },
        ],
      ),
      [{ k: "faint", bi: 1 }],
    );

    expect(result).toMatchObject({
      operationId: "RC/e2/w1/t1/o0/f0/s9",
      ownerSeatId: 9,
      fieldIndex: 0,
    });
  });
});

describe("resolveCoopV2ShowdownCommandProof", () => {
  const axes = {
    fieldIndex: 1,
    pokemonId: 42,
    enemyOffset: 2,
    hostSeatId: 7,
    guestSeatId: 9,
  };

  it("keeps both host-local sides in canonical orientation", () => {
    expect(resolveCoopV2ShowdownCommandProof({ ...axes, localRole: "host", localSide: "player" })).toEqual({
      ownerSeatId: 7,
      pokemonId: 42,
      fieldIndex: 1,
    });
    expect(resolveCoopV2ShowdownCommandProof({ ...axes, localRole: "host", localSide: "enemy" })).toEqual({
      ownerSeatId: 9,
      pokemonId: 42,
      fieldIndex: 3,
    });
  });

  it("reflects both guest-local sides back to canonical orientation", () => {
    expect(resolveCoopV2ShowdownCommandProof({ ...axes, localRole: "guest", localSide: "player" })).toEqual({
      ownerSeatId: 9,
      pokemonId: 42,
      fieldIndex: 3,
    });
    expect(resolveCoopV2ShowdownCommandProof({ ...axes, localRole: "guest", localSide: "enemy" })).toEqual({
      ownerSeatId: 7,
      pokemonId: 42,
      fieldIndex: 1,
    });
  });

  it("rejects malformed coordinates and ambiguous seat bindings", () => {
    expect(
      resolveCoopV2ShowdownCommandProof({
        ...axes,
        localRole: "host",
        localSide: "player",
        hostSeatId: 7,
        guestSeatId: 7,
      }),
    ).toBeNull();
    expect(
      resolveCoopV2ShowdownCommandProof({
        ...axes,
        localRole: "guest",
        localSide: "player",
        fieldIndex: -1,
      }),
    ).toBeNull();
  });
});

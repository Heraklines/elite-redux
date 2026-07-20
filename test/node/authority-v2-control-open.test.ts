/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import {
  buildCommandOpenEntry,
  type CoopCommandOpenMaterialV2,
  commandOpenMaterialDigest,
  decodeCommandOpenEntry,
} from "#data/elite-redux/coop/authority-v2/adapters/control-open";
import type {
  CoopAuthorityEntry,
  CoopFrameContextV2,
  CoopNextControl,
} from "#data/elite-redux/coop/authority-v2/contract";
import type { CoopAuthoritativeBattleStateV1 } from "#data/elite-redux/coop/coop-transport";
import { describe, expect, it } from "vitest";

const context: CoopFrameContextV2 = {
  sessionId: "session",
  runId: "run",
  sessionEpoch: 3,
  seatMapId: "seats",
  membershipRevision: 1,
  senderSeatId: 0,
  authoritySeatId: 0,
  connectionGeneration: 1,
};

function state(overrides: Partial<CoopAuthoritativeBattleStateV1> = {}): CoopAuthoritativeBattleStateV1 {
  return {
    version: 1,
    tick: 17,
    wave: 4,
    turn: 1,
    double: false,
    playerParty: [],
    enemyParty: [],
    field: [],
    weather: 0,
    weatherTurnsLeft: 0,
    terrain: 0,
    terrainTurnsLeft: 0,
    arenaTags: [],
    money: 0,
    lockModifierTiers: false,
    pokeballCounts: [],
    playerModifiers: [],
    enemyModifiers: [],
    seed: "seed",
    waveSeed: "wave-seed",
    ...overrides,
  };
}

function command(overrides: Partial<Extract<CoopNextControl, { kind: "COMMAND_FRONTIER" }>> = {}) {
  return {
    kind: "COMMAND_FRONTIER" as const,
    epoch: 3,
    wave: 4,
    turn: 1,
    commands: [{ ownerSeatId: 0, pokemonId: 42, fieldIndex: 0 }],
    ...overrides,
  };
}

function material(overrides: Partial<CoopCommandOpenMaterialV2> = {}): CoopCommandOpenMaterialV2 {
  return {
    kind: "command-open",
    wave: 4,
    turn: 1,
    authoritativeState: state(),
    ...overrides,
  };
}

describe("authority-v2 explicit command-open boundary", () => {
  it("carries and fingerprints the complete post-entry-effects state", () => {
    const built = buildCommandOpenEntry({
      context,
      operationId: "control-open-w4-t1",
      material: material(),
      command: command(),
    });
    const committed = { ...built, revision: 5 } satisfies CoopAuthorityEntry;

    expect(built.kind).toBe("CONTROL_COMMIT");
    expect(built.material.digest).toBe(commandOpenMaterialDigest(material()));
    expect(built.nextControl).toEqual(command());
    expect(decodeCommandOpenEntry(committed)).toEqual(material());
  });

  it("rejects tick-zero placeholders and incomplete state arrays", () => {
    expect(() =>
      buildCommandOpenEntry({
        context,
        operationId: "tick-zero",
        material: material({ authoritativeState: state({ tick: 0 }) }),
        command: command(),
      }),
    ).toThrow(/complete post-entry-effects/u);
    expect(() =>
      buildCommandOpenEntry({
        context,
        operationId: "missing-field",
        material: material({
          authoritativeState: { ...state(), field: undefined } as unknown as CoopAuthoritativeBattleStateV1,
        }),
        command: command(),
      }),
    ).toThrow(/complete post-entry-effects/u);
  });

  it("rejects a frontier derived for any other epoch, wave, or turn", () => {
    expect(() =>
      buildCommandOpenEntry({
        context,
        operationId: "wrong-wave",
        material: material(),
        command: command({ wave: 3 }),
      }),
    ).toThrow(/does not match/u);
    expect(() =>
      buildCommandOpenEntry({
        context,
        operationId: "wrong-turn",
        material: material(),
        command: command({ turn: 2 }),
      }),
    ).toThrow(/does not match/u);
    expect(() =>
      buildCommandOpenEntry({
        context,
        operationId: "wrong-epoch",
        material: material(),
        command: command({ epoch: 2 }),
      }),
    ).toThrow(/does not match/u);
  });

  it("rejects material tampering at decode even under the original digest", () => {
    const built = buildCommandOpenEntry({
      context,
      operationId: "tamper",
      material: material(),
      command: command(),
    });
    const tampered: CoopAuthorityEntry = {
      ...built,
      revision: 2,
      material: {
        ...built.material,
        payload: material({ authoritativeState: state({ money: 999 }) }),
      },
    };
    expect(decodeCommandOpenEntry(tampered)).toBeNull();
  });
});

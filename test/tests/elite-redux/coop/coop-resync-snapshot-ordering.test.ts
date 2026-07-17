/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import type { CoopCheckpointEnvelope } from "#data/elite-redux/coop/coop-battle-stream";
import type {
  CoopAuthoritativeBattleStateV1,
  CoopFullBattleSnapshot,
  CoopFullMonSnapshot,
} from "#data/elite-redux/coop/coop-transport";
import { coopCheckpointSupersedesResync, coopResyncSnapshotIsStale } from "#phases/coop-replay-phases";
import { describe, expect, it } from "vitest";

function state(tick: number, wave = 4, turn = 2): CoopAuthoritativeBattleStateV1 {
  return {
    version: 1,
    tick,
    wave,
    turn,
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
}

function heldSnapshot(): Pick<CoopFullBattleSnapshot, "tick" | "authoritativeState" | "sessionEpoch"> {
  return { tick: 17, authoritativeState: state(18), sessionEpoch: 7 };
}

function replacementEnvelope(checkpointTick = 19, stateTick = 20): CoopCheckpointEnvelope {
  return {
    reason: "replacement",
    epoch: 7,
    wave: 4,
    turn: 2,
    revision: stateTick,
    checkpoint: {
      tick: checkpointTick,
      field: [],
      weather: 0,
      weatherTurnsLeft: 0,
      terrain: 0,
      terrainTurnsLeft: 0,
    },
    checksum: "deadbeefdeadbeef",
    fullField: [
      {
        bi: 1,
        partyIndex: 1,
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
    ] satisfies CoopFullMonSnapshot[],
    authoritativeState: state(stateTick),
  };
}

describe("co-op resync snapshot ordering", () => {
  it("accepts only the live turn after the full recovery ticket validates the requested frontier", () => {
    expect(
      coopResyncSnapshotIsStale(2, 3, 3),
      "the scalar backstop sees an exact live turn; the protocol-38 ticket separately proves the request frontier",
    ).toBe(false);
    expect(coopResyncSnapshotIsStale(2, 3, 2), "a future snapshot cannot enter the current turn-2 shell").toBe(true);
  });

  it("still rejects a genuinely old snapshot and preserves the legacy request-turn fallback", () => {
    expect(coopResyncSnapshotIsStale(2, 2, 3)).toBe(true);
    expect(coopResyncSnapshotIsStale(2, undefined, 3)).toBe(true);
  });

  it("recognizes the live wave-4 transition: a post-replacement frame supersedes the mid-switch resync", () => {
    expect(
      coopCheckpointSupersedesResync(heldSnapshot(), replacementEnvelope()),
      "stateSync tick 18 was captured at turn 2 before replacement; checkpoint/state ticks 19/20 are the complete turn-2 authority",
    ).toBe(true);
  });

  it("keeps the recovery hold fail-closed for partial, stale, cross-boundary, or already-attempted frames", () => {
    const noState = { ...replacementEnvelope(), authoritativeState: undefined } as unknown as CoopCheckpointEnvelope;
    const noFullField = { ...replacementEnvelope(), fullField: undefined } as unknown as CoopCheckpointEnvelope;
    const otherWave = replacementEnvelope();
    otherWave.authoritativeState = state(20, 5, 2);
    const otherTurn = replacementEnvelope();
    otherTurn.authoritativeState = state(20, 4, 3);
    const unknownBoundary = replacementEnvelope();
    unknownBoundary.reason = "switch";

    expect(coopCheckpointSupersedesResync(heldSnapshot(), replacementEnvelope(18, 20))).toBe(false);
    expect(coopCheckpointSupersedesResync(heldSnapshot(), replacementEnvelope(19, 18))).toBe(false);
    expect(coopCheckpointSupersedesResync(heldSnapshot(), noState)).toBe(false);
    expect(coopCheckpointSupersedesResync(heldSnapshot(), noFullField)).toBe(false);
    expect(coopCheckpointSupersedesResync(heldSnapshot(), otherWave)).toBe(false);
    expect(coopCheckpointSupersedesResync(heldSnapshot(), otherTurn)).toBe(false);
    expect(coopCheckpointSupersedesResync(heldSnapshot(), unknownBoundary)).toBe(false);
    expect(
      coopCheckpointSupersedesResync(heldSnapshot(), replacementEnvelope(), 20),
      "a frame at/below the latest attempted authority tick cannot wake the hold twice",
    ).toBe(false);
  });

  it("rejects reversed, equal, fractional, non-finite, unsafe, and non-positive tick pairs", () => {
    expect(coopCheckpointSupersedesResync(heldSnapshot(), replacementEnvelope(21, 20))).toBe(false);
    expect(coopCheckpointSupersedesResync(heldSnapshot(), replacementEnvelope(20, 20))).toBe(false);
    expect(coopCheckpointSupersedesResync(heldSnapshot(), replacementEnvelope(19.5, 20))).toBe(false);
    expect(coopCheckpointSupersedesResync(heldSnapshot(), replacementEnvelope(19, Number.POSITIVE_INFINITY))).toBe(
      false,
    );
    expect(coopCheckpointSupersedesResync(heldSnapshot(), replacementEnvelope(19, Number.MAX_SAFE_INTEGER + 1))).toBe(
      false,
    );
    expect(coopCheckpointSupersedesResync(heldSnapshot(), replacementEnvelope(-1, 20))).toBe(false);
    expect(
      coopCheckpointSupersedesResync(heldSnapshot(), replacementEnvelope(19, 20), Number.NaN),
      "an invalid running floor cannot be used to release a fail-closed hold",
    ).toBe(false);
  });
});

/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import type { CoopCheckpointEnvelope } from "#data/elite-redux/coop/coop-battle-stream";
import type { CoopAuthoritativeBattleStateV1, CoopFullBattleSnapshot } from "#data/elite-redux/coop/coop-transport";
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

function heldSnapshot(): Pick<CoopFullBattleSnapshot, "tick" | "authoritativeState"> {
  return { tick: 17, authoritativeState: state(18) };
}

function replacementEnvelope(checkpointTick = 19, stateTick = 20): CoopCheckpointEnvelope {
  return {
    reason: "replacement",
    checkpoint: {
      tick: checkpointTick,
      field: [],
      weather: 0,
      weatherTurnsLeft: 0,
      terrain: 0,
      terrainTurnsLeft: 0,
    },
    checksum: "deadbeefdeadbeef",
    authoritativeState: state(stateTick),
  };
}

describe("co-op resync snapshot ordering", () => {
  it("applies a next-turn snapshot returned for a prior-turn mismatch", () => {
    expect(
      coopResyncSnapshotIsStale(2, 3, 3),
      "the host captured turn 3 after receiving the turn-2 request; this is current authority, not stale",
    ).toBe(false);
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
    const noState = replacementEnvelope();
    delete noState.authoritativeState;
    const otherWave = replacementEnvelope();
    otherWave.authoritativeState = state(20, 5, 2);
    const otherTurn = replacementEnvelope();
    otherTurn.authoritativeState = state(20, 4, 3);
    const unknownBoundary = replacementEnvelope();
    unknownBoundary.reason = "switch";

    expect(coopCheckpointSupersedesResync(heldSnapshot(), replacementEnvelope(18, 20))).toBe(false);
    expect(coopCheckpointSupersedesResync(heldSnapshot(), replacementEnvelope(19, 18))).toBe(false);
    expect(coopCheckpointSupersedesResync(heldSnapshot(), noState)).toBe(false);
    expect(coopCheckpointSupersedesResync(heldSnapshot(), otherWave)).toBe(false);
    expect(coopCheckpointSupersedesResync(heldSnapshot(), otherTurn)).toBe(false);
    expect(coopCheckpointSupersedesResync(heldSnapshot(), unknownBoundary)).toBe(false);
    expect(
      coopCheckpointSupersedesResync(heldSnapshot(), replacementEnvelope(), 20),
      "a frame at/below the latest attempted authority tick cannot wake the hold twice",
    ).toBe(false);
  });
});

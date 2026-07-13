/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Behavioral victims for the protocol-33 mutation-assurance lane.
 *
 * These are ordinary green tests in the complete co-op gate.  The mutation runner first proves the
 * selected victim is green, changes one production protection in an isolated checkout, and then requires
 * this exact victim to become red with its P33_MUTATION_CAUGHT marker.  The tests intentionally exercise
 * public production behavior; they never inspect source text or ask which mutation is active.
 */

import type { BattleScene } from "#app/battle-scene";
import { globalScene, initGlobalScene } from "#app/global-scene";
import { CoopBattleStreamer } from "#data/elite-redux/coop/coop-battle-stream";
import { CoopDurabilityManager } from "#data/elite-redux/coop/coop-durability";
import { settleCoopAuthoritativeProjection } from "#data/elite-redux/coop/coop-presentation";
import type {
  CoopAuthoritativeBattleStateV1,
  CoopBattleCheckpoint,
  CoopFullMonSnapshot,
} from "#data/elite-redux/coop/coop-transport";
import { createLoopbackPair } from "#data/elite-redux/coop/coop-transport";
import { COOP_UI_AUTHORITATIVE_COMMIT_MODES, COOP_UI_REGISTRY } from "#data/elite-redux/coop/coop-ui-registry";
import { UiMode } from "#enums/ui-mode";
import { describe, expect, it } from "vitest";

const CHECKSUM_A = "1111111111111111";
const CHECKSUM_B = "2222222222222222";

async function flushWire(turns = 8): Promise<void> {
  for (let i = 0; i < turns; i++) {
    await Promise.resolve();
  }
}

function checkpoint(): CoopBattleCheckpoint {
  return {
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
  };
}

function fullField(): CoopFullMonSnapshot[] {
  return [
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
}

function authorityState(wave: number, turn = 1, tick = 20): CoopAuthoritativeBattleStateV1 {
  return {
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
    money: 0,
    pokeballCounts: [],
    playerModifiers: [],
    enemyModifiers: [],
  };
}

function emitTurn(stream: CoopBattleStreamer, wave: number, checksum: string): void {
  stream.emitTurn(7, wave, 1, [], checkpoint(), checksum, "{}", fullField(), authorityState(wave));
}

function acknowledgeThroughContinuation(
  stream: CoopBattleStreamer,
  resolution: NonNullable<Awaited<ReturnType<CoopBattleStreamer["awaitTurn"]>>>,
): void {
  expect(stream.acknowledgeTurnCommit(resolution, "materialApplied")).toBe(true);
  expect(stream.acknowledgeTurnCommit(resolution, "presentationReady")).toBe(true);
  expect(stream.acknowledgeTurnCommit(resolution, "continuationReady")).toBe(true);
}

describe.sequential("protocol-33 mutation victims", () => {
  it("[P33-MUTATION full-address] isolates equal revisions across the wave component", async () => {
    const pair = createLoopbackPair();
    const current = { epoch: 7, wave: 1, turn: 1 };
    const host = new CoopBattleStreamer(pair.host, { authorityContext: () => current });
    const guest = new CoopBattleStreamer(pair.guest, { authorityContext: () => current });
    try {
      const firstWait = guest.awaitTurn(1);
      emitTurn(host, 1, CHECKSUM_A);
      const first = await firstWait;
      expect(first).not.toBeNull();
      acknowledgeThroughContinuation(guest, first!);
      await flushWire();

      // Reuse the exact turn/revision in the next wave.  Only the complete address distinguishes it.
      current.wave = 2;
      const secondWait = guest.awaitTurn(1);
      emitTurn(host, 2, CHECKSUM_B);
      const second = await secondWait;
      expect(
        second,
        "P33_MUTATION_CAUGHT[full-address]: epoch/wave/turn/revision must identify independent authority",
      ).toMatchObject({ epoch: 7, wave: 2, turn: 1, revision: 20, checksum: CHECKSUM_B });
      expect(
        guest.acknowledgeTurnCommit(second!, "materialApplied"),
        "P33_MUTATION_CAUGHT[full-address]: epoch/wave/turn/revision must identify independent authority",
      ).toBe(true);
      expect(guest.acknowledgeTurnCommit(second!, "presentationReady")).toBe(true);
      expect(guest.acknowledgeTurnCommit(second!, "continuationReady")).toBe(true);
    } finally {
      host.dispose();
      guest.dispose();
    }
  });

  it("[P33-MUTATION retained-continuation] retains replacement authority after material ACK", async () => {
    const pair = createLoopbackPair();
    const context = () => ({ epoch: 7, wave: 4, turn: 2 });
    const host = new CoopBattleStreamer(pair.host, { authorityContext: context });
    const guest = new CoopBattleStreamer(pair.guest, { authorityContext: context });
    const state = authorityState(4, 2);
    const envelope = {
      reason: "replacement",
      epoch: 7,
      wave: 4,
      turn: 2,
      revision: 20,
      checkpoint: checkpoint(),
      checksum: CHECKSUM_A,
      fullField: fullField(),
      authoritativeState: state,
    } as const;
    const deliveries: number[] = [];
    pair.guest.onMessage(message => {
      if (message.t === "battleCheckpoint") {
        deliveries.push(message.revision);
      }
    });
    try {
      host.sendCheckpoint(
        envelope.reason,
        envelope.epoch,
        envelope.wave,
        envelope.turn,
        envelope.checkpoint,
        envelope.checksum,
        envelope.fullField,
        envelope.authoritativeState,
      );
      await flushWire();
      expect(guest.acknowledgeReplacement(envelope, "materialApplied")).toBe(true);
      await flushWire();

      const beforeProbe = deliveries.length;
      guest.requestReplacementCheckpoint(envelope);
      await flushWire();
      expect(
        deliveries.slice(beforeProbe),
        "P33_MUTATION_CAUGHT[retained-continuation]: material ACK must not release retained authority",
      ).toEqual([20]);
    } finally {
      host.dispose();
      guest.dispose();
    }
  });

  it("[P33-MUTATION staged-ack-order] rejects continuationReady as the first ACK stage", async () => {
    const pair = createLoopbackPair();
    const context = () => ({ epoch: 7, wave: 1, turn: 1 });
    const host = new CoopBattleStreamer(pair.host, { authorityContext: context });
    const guest = new CoopBattleStreamer(pair.guest, { authorityContext: context });
    try {
      const awaited = guest.awaitTurn(1);
      emitTurn(host, 1, CHECKSUM_A);
      const resolution = await awaited;
      expect(resolution).not.toBeNull();
      expect(
        guest.acknowledgeTurnCommit(resolution!, "continuationReady"),
        "P33_MUTATION_CAUGHT[staged-ack-order]: continuationReady cannot skip material and presentation",
      ).toBe(false);
      await flushWire();
      expect(host.retainedAuthorityDiagnostics().terminal).toBe(true);
      expect(guest.retainedAuthorityDiagnostics().terminal).toBe(true);
    } finally {
      host.dispose();
      guest.dispose();
    }
  });

  it("[P33-MUTATION atomic-rollback] restores the exact pre-transaction control ledger", () => {
    const pair = createLoopbackPair();
    const durability = new CoopDurabilityManager(pair.guest);
    try {
      durability.adoptSnapshotMarksForTransaction({ "op:wave": 3, "op:reward": 2 });
      const before = durability.appliedMarks();
      durability.adoptSnapshotMarksForTransaction({ "op:wave": 9, "op:mystery": 4 });
      durability.restoreAppliedMarksForTransaction(before);
      expect(
        durability.appliedMarks(),
        "P33_MUTATION_CAUGHT[atomic-rollback]: failed control commit must restore the exact prior ledger",
      ).toEqual({ "op:wave": 3, "op:reward": 2 });
    } finally {
      durability.dispose();
    }
  });

  it("[P33-MUTATION ui-registry] keeps authoritative reward UI registered as mirrored", () => {
    expect(
      COOP_UI_REGISTRY[UiMode.MODIFIER_SELECT],
      "P33_MUTATION_CAUGHT[ui-registry]: authoritative reward UI must remain mirrored",
    ).toBe("mirrored");
    expect(COOP_UI_AUTHORITATIVE_COMMIT_MODES.has(UiMode.MODIFIER_SELECT)).toBe(true);
  });

  it("[P33-MUTATION renderer-postcondition] refuses authority whose required seat cannot be rendered", async () => {
    const priorScene = globalScene;
    initGlobalScene({
      getPlayerParty: () => [],
      getEnemyParty: () => [],
    } as unknown as BattleScene);
    try {
      const ready = await settleCoopAuthoritativeProjection({
        ...authorityState(1),
        field: [{ side: "player", bi: 0, partyIndex: 0, pokemonId: 999, presented: true }],
      });
      expect(
        ready,
        "P33_MUTATION_CAUGHT[renderer-postcondition]: a missing required seat cannot become presentation-ready",
      ).toBe(false);
    } finally {
      initGlobalScene(priorScene as BattleScene);
    }
  });
});

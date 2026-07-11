/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { CoopDurabilityManager } from "#data/elite-redux/coop/coop-durability";
import type {
  CoopAuthoritativeEnvelopeV1,
  CoopLogicalPhase,
  CoopOperationKind,
} from "#data/elite-redux/coop/coop-operation-envelope";
import {
  coopOperationDurabilityHooks,
  registerCoopOperationApplier,
  registerCoopOperationLiveSink,
  routeCoopOperationToLiveSink,
} from "#data/elite-redux/coop/coop-operation-journal";
import {
  COOP_OPERATION_SURFACES,
  type CoopOperationSurfaceClass,
} from "#data/elite-redux/coop/coop-operation-surface-registry";
import type { CoopAuthoritativeBattleStateV1, CoopMessage } from "#data/elite-redux/coop/coop-transport";
import { createLoopbackPair } from "#data/elite-redux/coop/coop-transport";
import { COOP_NO_FAULT_PROFILE, wrapCoopFaultPair } from "#test/tools/coop-fault-transport";
import { afterEach, describe, expect, it } from "vitest";

const KIND_PHASE: Record<CoopOperationSurfaceClass, readonly [CoopOperationKind, CoopLogicalPhase]> = {
  "op:ability": ["ABILITY_PICK", "INTERACTION"],
  "op:bargain": ["BARGAIN", "INTERACTION"],
  "op:biome": ["BIOME_PICK", "BIOME_SELECT"],
  "op:catchFull": ["CATCH_FULL", "TURN_RESOLVE"],
  "op:colosseum": ["COLO_PICK", "INTERACTION"],
  "op:faintSwitch": ["FAINT_SWITCH", "TURN_RESOLVE"],
  "op:learnMove": ["LEARN_MOVE", "TURN_RESOLVE"],
  "op:me": ["ME_PICK", "MYSTERY_ENCOUNTER"],
  "op:revival": ["REVIVAL", "TURN_RESOLVE"],
  "op:reward": ["REWARD", "REWARD_SELECT"],
  "op:stormglass": ["STORMGLASS", "INTERACTION"],
  "op:wave": ["WAVE_ADVANCE", "WAVE_VICTORY"],
};

const STATE: CoopAuthoritativeBattleStateV1 = {
  version: 1,
  tick: 0,
  wave: 10,
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

function envelopeFor(cls: CoopOperationSurfaceClass, revision: number): CoopAuthoritativeEnvelopeV1 {
  const [kind, logicalPhase] = KIND_PHASE[cls];
  return {
    version: 1,
    epoch: 1,
    revision,
    wave: 10,
    turn: 1,
    logicalPhase,
    pendingOperation: {
      id: `1:0:${revision}`,
      kind,
      owner: 0,
      status: "committed",
      payload: { marker: cls },
    },
    authoritativeState: STATE,
  } as CoopAuthoritativeEnvelopeV1;
}

async function flush(): Promise<void> {
  for (let i = 0; i < 16; i++) {
    await Promise.resolve();
  }
}

const restore: (() => void)[] = [];

afterEach(() => {
  while (restore.length > 0) {
    restore.pop()?.();
  }
  for (const cls of COOP_OPERATION_SURFACES) {
    registerCoopOperationLiveSink(cls, null);
  }
});

describe("authoritative operation fault campaign: every registered class", () => {
  it("maps, drops, replays, ACKs, and live-materializes every class after reconnect", async () => {
    const liveState = new Map<CoopOperationSurfaceClass, string>();
    const pair = wrapCoopFaultPair(
      createLoopbackPair(),
      { drop: 1, reorder: 0, delay: 0, faultable: (msg: CoopMessage) => msg.t === "envelope" },
      { seed: 0xa11c1a55 },
    );
    const host = new CoopDurabilityManager(pair.host);
    const guest = new CoopDurabilityManager(pair.guest, coopOperationDurabilityHooks());

    try {
      for (const cls of COOP_OPERATION_SURFACES) {
        registerCoopOperationLiveSink(cls, envelope => {
          liveState.set(cls, (envelope.pendingOperation?.payload as { marker: string }).marker);
          return true;
        });
        restore.push(
          registerCoopOperationApplier(cls, envelope => {
            routeCoopOperationToLiveSink(cls, envelope);
            return "applied";
          }),
        );

        // Revisions are dense PER CLASS, so the first operation for every surface is revision 1.
        const envelope = envelopeFor(cls, 1);
        expect(coopOperationDurabilityHooks().extractKey?.({ t: "envelope", envelope })).toEqual({
          cls,
          seq: 1,
        });
        host.commit(cls, 1, { t: "envelope", envelope });
      }
      await flush();
      expect(pair.faultsInjected(), "the campaign must really drop every first delivery").toBe(
        COOP_OPERATION_SURFACES.length,
      );
      expect(liveState.size, "no dropped operation may mutate receiver live state before recovery").toBe(0);
      expect(host.unackedCount()).toBe(COOP_OPERATION_SURFACES.length);

      pair.setProfile(COOP_NO_FAULT_PROFILE);
      guest.reconnect();
      await flush();

      expect([...liveState.keys()].sort()).toEqual([...COOP_OPERATION_SURFACES].sort());
      for (const cls of COOP_OPERATION_SURFACES) {
        expect(liveState.get(cls), `${cls} converged through its live-mutation seam`).toBe(cls);
      }
      expect(host.unackedCount(), "every replayed class was cumulatively ACKed").toBe(0);
    } finally {
      host.dispose();
      guest.dispose();
    }
  });
});

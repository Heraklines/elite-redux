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
  applyCoopOperationEnvelope,
  coopOperationDurabilityHooks,
  registerCoopOperationApplier,
  registerCoopOperationLiveSink,
  routeCoopOperationToLiveSink,
} from "#data/elite-redux/coop/coop-operation-journal";
import { CoopOperationGuest } from "#data/elite-redux/coop/coop-operation-runtime";
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
    sessionEpoch: 1,
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
  } satisfies CoopAuthoritativeEnvelopeV1;
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
  it("fails closed when a committed envelope has no registered operation applier", () => {
    const envelope = envelopeFor("op:biome", 1);
    const outcome = coopOperationDurabilityHooks().apply?.({
      cls: "op:future-unregistered",
      seq: 1,
      msg: { t: "envelope", envelope },
    });
    expect(outcome, "an unknown class must remain unacknowledged and retriable").toBe("rejected");
  });

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
      let globalRevision = 0;
      let retainedWave: CoopAuthoritativeEnvelopeV1 | null = null;
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

        // Every surface participates in one dense global commit stream.
        const committedEnvelope = envelopeFor(cls, ++globalRevision);
        if (cls === "op:wave") {
          retainedWave = committedEnvelope;
        }
        expect(coopOperationDurabilityHooks().extractKey?.({ t: "envelope", envelope: committedEnvelope })).toEqual({
          cls: "op:global",
          seq: globalRevision,
        });
        host.commit("op:global", globalRevision, { t: "envelope", envelope: committedEnvelope });
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
      const continuationRetained = COOP_OPERATION_SURFACES.filter(cls => cls !== "op:wave").length;
      expect(
        host.unackedCount(),
        "the later wave ACK is parked behind every earlier operation awaiting continuation",
      ).toBe(COOP_OPERATION_SURFACES.length);
      expect(guest.notifyOperationContinuationSurface("sharedInput", { epoch: 1, wave: 10, turn: 1 })).toBe(
        continuationRetained,
      );
      await flush();
      expect(host.unackedCount(), "generic continuations cannot claim the retained WAVE transaction").toBe(1);
      expect(retainedWave).not.toBeNull();
      expect(
        guest.completeRetainedWaveAdvance(retainedWave!, "sharedInput", { epoch: 1, wave: 10, turn: 1 }),
        "the dedicated DATA-bound wave adapter releases the final retained class",
      ).toBe(true);
      await flush();
      expect(host.unackedCount(), "every class releases only through its own exact continuation proof").toBe(0);
    } finally {
      host.dispose();
      guest.dispose();
    }
  });
});

describe("live-sink pacing: a valid in-order op whose materializer is not ready", () => {
  it("DEFERS at the journal layer (parked + retriable) instead of rejecting into bounded recovery", () => {
    // The live double-KO terminal class (fold gate 29596677056, B1/B7/B8/B10/B12): the guest received the
    // host's committed FAINT_SWITCH op BEFORE its own picker/replay surface opened. Classifying that pacing
    // gap as "rejected" burned bounded recovery (8 attempts) into a shared session terminal that closed the
    // transport and stranded the host at SwitchPhase. The op is valid and in-order - it must DEFER.
    const receiver = new CoopOperationGuest({ epoch: 1 });
    const envelope: CoopAuthoritativeEnvelopeV1 = {
      ...envelopeFor("op:faintSwitch", 1),
      pendingOperation: {
        id: "1:1:pacing-pin",
        kind: "FAINT_SWITCH",
        owner: 1,
        status: "applied",
        payload: { fieldIndex: 1, partySlot: 2, data: [0, 0, 1, 2] },
      },
    };

    // No live sink installed yet (session assembly has not reached this surface): defer, never reject.
    expect(
      applyCoopOperationEnvelope(receiver, "op:faintSwitch", envelope),
      "a missing materializer is engine pacing, not stream corruption",
    ).toBe("deferred");
    expect(receiver.getLastAppliedRevision(), "a deferred op must not advance the receive cursor").toBe(0);

    // Sink installed but its destination surface (the guest picker) has not opened: still defer.
    registerCoopOperationLiveSink("op:faintSwitch", () => false);
    expect(
      applyCoopOperationEnvelope(receiver, "op:faintSwitch", envelope),
      "a not-yet-ready materializer is engine pacing, not stream corruption",
    ).toBe("deferred");
    expect(receiver.getLastAppliedRevision()).toBe(0);

    // The surface opens: the exact same parked entry now applies and the cursor advances.
    registerCoopOperationLiveSink("op:faintSwitch", () => true);
    expect(applyCoopOperationEnvelope(receiver, "op:faintSwitch", envelope)).toBe("applied");
    expect(receiver.getLastAppliedRevision()).toBe(1);
  });
});

/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import type { CoopAuthorityEntry, CoopFrameContextV2 } from "#data/elite-redux/coop/authority-v2/contract";
import {
  buildCoopV2InteractionEnvelopeEntry,
  decodeCoopV2InteractionEnvelope,
  requiresCoopV2InteractionTerminalProof,
  successorOfCoopV2InteractionEnvelope,
} from "#data/elite-redux/coop/authority-v2/cutover-interaction";
import type {
  CoopAuthoritativeEnvelopeV1,
  CoopLogicalPhase,
  CoopOperationKind,
} from "#data/elite-redux/coop/coop-operation-envelope";
import { makeCoopOperationId } from "#data/elite-redux/coop/coop-operation-envelope";
import {
  applyCoopOperationEnvelope,
  registerCoopOperationLiveSink,
  resetCoopOperationJournalLog,
} from "#data/elite-redux/coop/coop-operation-journal";
import {
  CoopOperationGuest,
  createCoopRuntimeOpState,
  setActiveCoopRuntimeOpState,
} from "#data/elite-redux/coop/coop-operation-runtime";
import type { CoopOperationSurfaceClass } from "#data/elite-redux/coop/coop-operation-surface-registry";
import {
  COOP_BIOME_PICK_SEQ_BASE,
  COOP_CROSSROADS_SEQ_BASE,
  COOP_ME_PUMP_SEQ_BASE,
} from "#data/elite-redux/coop/coop-seq-registry";
import type { CoopAuthoritativeBattleStateV1 } from "#data/elite-redux/coop/coop-transport";
import { afterEach, describe, expect, it, vi } from "vitest";

const FRAME: CoopFrameContextV2 = {
  sessionId: "session",
  runId: "run",
  sessionEpoch: 1,
  seatMapId: "map",
  membershipRevision: 1,
  senderSeatId: 0,
  authoritySeatId: 0,
  connectionGeneration: 1,
};

const STATE: CoopAuthoritativeBattleStateV1 = {
  version: 1,
  tick: 1,
  wave: 1,
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
};

const RESYNC = {
  k: "meResync",
  base: null,
  party: [],
  meSaveData: "[]",
  seed: "seed",
  waveSeed: "wave-seed",
  dex: "dex",
  authoritativeState: STATE,
} as const;

function envelope(
  kind: CoopOperationKind,
  payload: unknown,
  logicalPhase: CoopLogicalPhase = "INTERACTION",
  owner = 1,
  pinnedSeq = 1,
): CoopAuthoritativeEnvelopeV1 {
  return {
    version: 1,
    sessionEpoch: 1,
    revision: 1,
    wave: 1,
    turn: 1,
    logicalPhase,
    pendingOperation: {
      id: makeCoopOperationId(1, owner, pinnedSeq, kind),
      kind,
      owner,
      status: "applied",
      payload,
    },
    authoritativeState: STATE,
  };
}

afterEach(() => {
  registerCoopOperationLiveSink("op:ability", null);
  registerCoopOperationLiveSink("op:reward", null);
  resetCoopOperationJournalLog();
  setActiveCoopRuntimeOpState(null);
});

describe("Authority V2 interaction cutover", () => {
  it.each([
    [
      "REWARD",
      {
        label: "reward",
        choice: 0,
        data: undefined,
        terminal: true,
        result: { lockModifierTiers: false },
      },
      "REWARD_SELECT",
      "op:reward",
      "AWAIT_SUCCESSOR",
    ],
    [
      "REWARD",
      { label: "skip", choice: -1, data: undefined, terminal: true, result: { lockModifierTiers: false } },
      "REWARD_SELECT",
      "op:reward",
      "AWAIT_SUCCESSOR",
    ],
    [
      "SHOP_BUY",
      {
        slot: 0,
        data: undefined,
        terminal: false,
        result: {
          remainingStock: [1, 0],
          continuation: {
            surface: "market",
            pinned: 0,
            reroll: 0,
            options: [
              { id: "A", tier: 0, upgradeCount: 0, cost: 1 },
              { id: "B", tier: 0, upgradeCount: 0, cost: 1 },
            ],
            marketKind: "biome",
            remainingStock: [1, 0],
          },
        },
      },
      "SHOP",
      "op:reward",
      "SHARED_INTERACTION",
    ],
    [
      "BIOME_PICK",
      { sourceBiomeId: 1, biomeId: 2, nodeIndex: 0, nextWave: 11 },
      "BIOME_SELECT",
      "op:biome",
      "AWAIT_SUCCESSOR",
    ],
    ["CROSSROADS_PICK", { optionIndex: 0 }, "BIOME_SELECT", "op:biome", "AWAIT_SUCCESSOR"],
    ["REVIVAL", { type: "prompt", fieldIndex: 0 }, "TURN_RESOLVE", "op:revival", "SHARED_INTERACTION"],
    [
      "REVIVAL",
      { type: "decision", fieldIndex: 0, partySlot: 1, speciesId: 25 },
      "TURN_RESOLVE",
      "op:revival",
      "AWAIT_SUCCESSOR",
    ],
    [
      "CATCH_FULL",
      { type: "prompt", pokemonName: "Pikachu", speciesId: 25 },
      "TURN_RESOLVE",
      "op:catchFull",
      "SHARED_INTERACTION",
    ],
    [
      "LEARN_MOVE",
      { type: "prompt", partySlot: 0, moveId: 33, maxMoveCount: 4 },
      "TURN_RESOLVE",
      "op:learnMove",
      "SHARED_INTERACTION",
    ],
    [
      "LEARN_MOVE_BATCH",
      { type: "decision", partySlot: 0, assignments: [[33, 0]], fallback: false },
      "TURN_RESOLVE",
      "op:learnMove",
      "AWAIT_SUCCESSOR",
    ],
    ["COLO_PICK", { type: "board", round: 0, labels: ["A", "B"] }, "INTERACTION", "op:colosseum", "SHARED_INTERACTION"],
    [
      "ABILITY_PRESENT",
      { pinned: 1, partyIndex: 0, workflow: "greater-randomizer", rolledAbilityIds: [11, 12, 13, 14] },
      "INTERACTION",
      "op:ability",
      "SHARED_INTERACTION",
    ],
    ["ABILITY_PICK", { data: [0, 1] }, "INTERACTION", "op:ability", "AWAIT_SUCCESSOR"],
    ["BARGAIN", { outcome: RESYNC }, "INTERACTION", "op:bargain", "AWAIT_SUCCESSOR"],
    ["STORMGLASS", { weatherIndex: 0, weather: 1 }, "INTERACTION", "op:stormglass", "AWAIT_SUCCESSOR"],
  ] as const)("states a non-null typed successor for %s", (kind, payload, logicalPhase, surfaceClass, expectedKind) => {
    const value = envelope(kind, payload, logicalPhase);
    const successor = successorOfCoopV2InteractionEnvelope(surfaceClass, value);
    expect(successor?.kind).toBe(expectedKind);
    const built = buildCoopV2InteractionEnvelopeEntry({
      context: FRAME,
      surfaceClass,
      envelope: value,
    });
    expect(built?.nextControl).toEqual(successor);
    expect(built?.nextControl).not.toBeNull();
  });

  it("admits a taken free reward as a terminal result through its exact JSON wire image", () => {
    const value = envelope(
      "REWARD",
      {
        label: "reward",
        choice: 1,
        data: [0],
        terminal: true,
        result: { lockModifierTiers: true },
      },
      "REWARD_SELECT",
      0,
      200_000,
    );
    const built = buildCoopV2InteractionEnvelopeEntry({
      context: FRAME,
      surfaceClass: "op:reward",
      envelope: value,
    });
    expect(built?.nextControl).toMatchObject({
      kind: "AWAIT_SUCCESSOR",
      allowNextWaveStart: true,
    });
    if (built == null) {
      throw new Error("terminal reward did not build an Authority V2 entry");
    }
    const wireEntry = JSON.parse(JSON.stringify({ ...built, revision: 7 })) as CoopAuthorityEntry;
    expect(decodeCoopV2InteractionEnvelope(wireEntry)).not.toBeNull();
  });

  it("rejects reward terminal flags that disagree with the concrete action", () => {
    const build = (payload: unknown) =>
      buildCoopV2InteractionEnvelopeEntry({
        context: FRAME,
        surfaceClass: "op:reward",
        envelope: envelope("REWARD", payload, "REWARD_SELECT"),
      });

    expect(build({ label: "reward", choice: 0, terminal: false, result: { lockModifierTiers: false } })).toBeNull();
    expect(build({ label: "skip", choice: -1, terminal: false, result: { lockModifierTiers: false } })).toBeNull();
    expect(build({ label: "reroll", choice: -2, terminal: true, result: { lockModifierTiers: false } })).toBeNull();
  });

  it("separates the host-authored Mystery presentation from its pinned human-input owner", () => {
    const pinned = 1;
    const value = envelope(
      "ME_PRESENT",
      { present: true, presentation: { k: "mePresent", tokens: {}, meetsReqs: [], labels: [] } },
      "MYSTERY_ENCOUNTER",
      0,
      (COOP_ME_PUMP_SEQ_BASE + pinned) * 8000,
    );
    const successor = successorOfCoopV2InteractionEnvelope("op:me", value);
    expect(successor).toMatchObject({
      kind: "SHARED_INTERACTION",
      operationId: value.pendingOperation?.id,
      ownerSeatId: 1,
      operationKind: "ME_PRESENT",
    });
    expect(
      buildCoopV2InteractionEnvelopeEntry({
        context: FRAME,
        surfaceClass: "op:me",
        envelope: value,
      }),
    ).not.toBeNull();
  });

  it("authorizes the exact chained biome picker after a Crossroads Leave", () => {
    const pinned = 7;
    const value = envelope("CROSSROADS_PICK", { optionIndex: 1 }, "BIOME_SELECT", 1, COOP_CROSSROADS_SEQ_BASE + pinned);
    expect(successorOfCoopV2InteractionEnvelope("op:biome", value)).toEqual({
      kind: "SHARED_INTERACTION",
      surfaceClass: "op:biome",
      operationId: makeCoopOperationId(1, 1, COOP_BIOME_PICK_SEQ_BASE + pinned, "BIOME_PICK"),
      ownerSeatId: 1,
      epoch: 1,
      wave: 1,
      turn: 1,
      operationKind: "BIOME_PICK",
      successor: {
        operationKinds: ["BIOME_PICK"],
        operationIds: [makeCoopOperationId(1, 1, COOP_BIOME_PICK_SEQ_BASE + pinned, "BIOME_PICK")],
      },
    });
  });

  it("states UI proof and mechanical successor as independent axes for Mystery catch-full", () => {
    const pinned = 3;
    const value = envelope(
      "ME_PRESENT",
      {
        present: true,
        presentation: {
          k: "mePresent",
          tokens: {},
          meetsReqs: [],
          labels: [],
          subPrompt: { kind: "catchFull" },
        },
      },
      "MYSTERY_ENCOUNTER",
      0,
      (COOP_ME_PUMP_SEQ_BASE + pinned) * 8000,
    );
    expect(successorOfCoopV2InteractionEnvelope("op:me", value)).toMatchObject({
      kind: "SHARED_INTERACTION",
      surfaceClass: "op:catchFull",
      operationKind: "CATCH_FULL",
      successor: {
        operationKinds: ["ME_PRESENT", "ME_TERMINAL", "BARGAIN_PRESENT", "COLO_PICK", "REWARD_PRESENT", "SHOP_PRESENT"],
        operationIds: null,
      },
    });
  });

  it.each([
    ["ME_PICK", { optionIndex: 0 }],
    ["ME_SUB", { value: 0 }],
    ["ME_BUTTON", { button: 0 }],
    ["QUIZ_ANSWER", { questionIndex: 0, choice: 0 }],
  ] as const)("keeps %s proposal telemetry out of the mechanical log", (kind, payload) => {
    const value = envelope(kind, payload, "MYSTERY_ENCOUNTER");
    expect(successorOfCoopV2InteractionEnvelope("op:me", value)?.kind).toBe("AWAIT_SUCCESSOR");
    expect(
      buildCoopV2InteractionEnvelopeEntry({
        context: FRAME,
        surfaceClass: "op:me",
        envelope: value,
      }),
    ).toBeNull();
  });

  it("distinguishes executable result terminals from no-input ordered waits", () => {
    expect(
      requiresCoopV2InteractionTerminalProof("op:ability", envelope("ABILITY_PICK", { data: [0, 1] }, "INTERACTION")),
    ).toBe(true);
    expect(
      requiresCoopV2InteractionTerminalProof(
        "op:me",
        envelope(
          "ME_TERMINAL",
          {
            terminal: "leave",
            outcome: RESYNC,
            destination: { kind: "continue", nextWave: 2, selectBiome: false },
          },
          "MYSTERY_ENCOUNTER",
          0,
        ),
      ),
    ).toBe(true);
    expect(
      requiresCoopV2InteractionTerminalProof(
        "op:me",
        envelope("ME_PRESENT", { present: false }, "MYSTERY_ENCOUNTER", 0),
      ),
    ).toBe(false);
    expect(
      requiresCoopV2InteractionTerminalProof(
        "op:bargain",
        envelope("BARGAIN_PRESENT", { pinned: 1, sins: [] }, "INTERACTION", 0),
      ),
    ).toBe(false);
  });

  it("commits a Colosseum decision as a mechanical result before its typed successor wait", () => {
    const value = envelope("COLO_PICK", { type: "decision", round: 0, index: 0 }, "INTERACTION", 0, 1);
    const built = buildCoopV2InteractionEnvelopeEntry({
      context: FRAME,
      surfaceClass: "op:colosseum",
      envelope: value,
    });
    expect(built).not.toBeNull();
    expect(built?.kind).toBe("INTERACTION_COMMIT");
    expect(built?.nextControl).toMatchObject({
      kind: "AWAIT_SUCCESSOR",
      afterOperationId: value.pendingOperation?.id,
    });
  });

  it("authorizes an exact next-wave start only for terminal reward and market results", () => {
    const terminalReward = successorOfCoopV2InteractionEnvelope(
      "op:reward",
      envelope(
        "REWARD",
        { label: "skip", choice: -1, terminal: true, result: { lockModifierTiers: false } },
        "REWARD_SELECT",
      ),
    );
    const reroll = successorOfCoopV2InteractionEnvelope(
      "op:reward",
      envelope(
        "REWARD",
        { label: "reroll", choice: -2, terminal: false, result: { lockModifierTiers: false } },
        "REWARD_SELECT",
      ),
    );
    const terminalMarket = successorOfCoopV2InteractionEnvelope(
      "op:reward",
      envelope("SHOP_BUY", { slot: -1, terminal: true, result: { remainingStock: [] } }, "SHOP"),
    );

    expect(terminalReward).toMatchObject({ kind: "AWAIT_SUCCESSOR", allowNextWaveStart: true });
    expect(reroll).toMatchObject({ kind: "AWAIT_SUCCESSOR", allowNextWaveStart: false });
    expect(terminalMarket).toMatchObject({ kind: "AWAIT_SUCCESSOR", allowNextWaveStart: true });
  });

  it("freezes terminal reward material to its exact JSON wire image before digesting it", () => {
    const built = buildCoopV2InteractionEnvelopeEntry({
      context: FRAME,
      surfaceClass: "op:reward",
      envelope: envelope(
        "REWARD",
        {
          label: "skip",
          choice: -1,
          data: undefined,
          terminal: true,
          result: { lockModifierTiers: false },
        },
        "REWARD_SELECT",
      ),
    });
    expect(built).not.toBeNull();
    const delivered = JSON.parse(JSON.stringify({ ...built, revision: 1 }));
    expect(delivered.material.payload.envelope.pendingOperation.payload).not.toHaveProperty("data");
    expect(decodeCoopV2InteractionEnvelope(delivered)).not.toBeNull();
  });

  it.each([
    [
      {
        terminal: "battle-settled",
        outcome: RESYNC,
        destination: {
          kind: "reward",
          hostTurn: 1,
          result: "victory",
          continuation: "rewards",
          trainerVictory: false,
          rewardSurfaces: [],
          eggLapse: false,
        },
      },
      "op:reward",
    ],
    [
      {
        terminal: "leave",
        outcome: RESYNC,
        destination: { kind: "continue", nextWave: 2, selectBiome: true },
      },
      "op:biome",
    ],
  ] as const)("parks ME terminal destinations until their next ordered presentation", (payload, _surfaceClass) => {
    const successor = successorOfCoopV2InteractionEnvelope(
      "op:me",
      envelope("ME_TERMINAL", payload, "MYSTERY_ENCOUNTER"),
    );
    expect(successor).toMatchObject({ kind: "AWAIT_SUCCESSOR" });
  });

  it("rejects an interaction wrapped under a non-interaction surface class", () => {
    expect(
      buildCoopV2InteractionEnvelopeEntry({
        context: FRAME,
        surfaceClass: "op:wave",
        envelope: envelope("REWARD", { terminal: false }, "REWARD_SELECT"),
      }),
    ).toBeNull();
  });

  it("rejects a valid interaction kind under the wrong registered surface", () => {
    expect(
      buildCoopV2InteractionEnvelopeEntry({
        context: FRAME,
        surfaceClass: "op:ability",
        envelope: envelope("REWARD", { label: "reward", choice: 0, data: undefined, terminal: false }, "REWARD_SELECT"),
      }),
    ).toBeNull();
  });

  it("requires one complete literal randomizer board and forbids rolls on deterministic ability workflows", () => {
    const build = (payload: unknown) =>
      buildCoopV2InteractionEnvelopeEntry({
        context: FRAME,
        surfaceClass: "op:ability",
        envelope: envelope("ABILITY_PRESENT", payload),
      });

    expect(build({ pinned: 1, partyIndex: 0, workflow: "greater-randomizer" })).toBeNull();
    expect(
      build({
        pinned: 1,
        partyIndex: 0,
        workflow: "greater-randomizer",
        rolledAbilityIds: [11, 11, 12, 13],
      }),
    ).toBeNull();
    expect(build({ pinned: 1, partyIndex: 0, workflow: "capsule", rolledAbilityIds: [11, 12, 13, 14] })).toBeNull();
  });

  it("rejects incomplete result payloads before they can consume a mechanical revision", () => {
    expect(
      buildCoopV2InteractionEnvelopeEntry({
        context: FRAME,
        surfaceClass: "op:reward",
        envelope: envelope("REWARD", { terminal: false }, "REWARD_SELECT"),
      }),
    ).toBeNull();
    expect(
      buildCoopV2InteractionEnvelopeEntry({
        context: FRAME,
        surfaceClass: "op:me",
        envelope: envelope(
          "ME_TERMINAL",
          { terminal: "leave", outcome: { k: "meResync" }, destination: { kind: "continue" } },
          "MYSTERY_ENCOUNTER",
        ),
      }),
    ).toBeNull();
  });

  it("rejects a terminal interaction whose embedded result disagrees with the common state image", () => {
    expect(
      buildCoopV2InteractionEnvelopeEntry({
        context: FRAME,
        surfaceClass: "op:bargain",
        envelope: envelope("BARGAIN", {
          outcome: {
            ...RESYNC,
            authoritativeState: { ...STATE, money: STATE.money + 1 },
          },
        }),
      }),
    ).toBeNull();
  });

  it("uses only the V2 revision domain and leaves the retired legacy cursor untouched", () => {
    const state = createCoopRuntimeOpState("guest");
    setActiveCoopRuntimeOpState(state);
    const guest = new CoopOperationGuest({ epoch: 1, initialRevision: 99 });
    const committed = envelope("ABILITY_PICK", { data: [1] });
    const sink = vi.fn(() => true);
    registerCoopOperationLiveSink("op:ability", sink);

    expect(
      applyCoopOperationEnvelope(guest, "op:ability", committed, {
        authority: "v2",
        revision: 7,
        operationId: committed.pendingOperation!.id,
        sessionEpoch: 1,
      }),
    ).toBe("applied");
    expect(guest.getLastAppliedRevision()).toBe(99);
    expect(sink).toHaveBeenCalledTimes(1);

    // A retained V2 retry is idempotent in the runtime-owned materialization ledger.
    expect(
      applyCoopOperationEnvelope(guest, "op:ability", committed, {
        authority: "v2",
        revision: 7,
        operationId: committed.pendingOperation!.id,
        sessionEpoch: 1,
      }),
    ).toBe("applied");
    expect(sink).toHaveBeenCalledTimes(1);
  });

  it("keeps the registry type closed over known surface classes", () => {
    const surface: CoopOperationSurfaceClass = "op:reward";
    expect(surface).toBe("op:reward");
  });
});

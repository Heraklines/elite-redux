/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import type { CoopAuthorityEntry, CoopFrameContextV2 } from "#data/elite-redux/coop/authority-v2/contract";
import { CoopV2ControlLedger } from "#data/elite-redux/coop/authority-v2/control-ledger";
import { buildCoopV2InteractionEnvelopeEntry } from "#data/elite-redux/coop/authority-v2/cutover-interaction";
import { projectionPlanOfCoopV2InteractionEntry } from "#data/elite-redux/coop/authority-v2/interaction-projection";
import { COOP_ABILITY_ACTION_STRIDE } from "#data/elite-redux/coop/coop-ability-operation";
import { COOP_COLOSSEUM_ACTION_STRIDE } from "#data/elite-redux/coop/coop-colosseum-operation";
import type {
  CoopAuthoritativeEnvelopeV1,
  CoopLogicalPhase,
  CoopOperationKind,
} from "#data/elite-redux/coop/coop-operation-envelope";
import { makeCoopOperationId } from "#data/elite-redux/coop/coop-operation-envelope";
import type { CoopOperationSurfaceClass } from "#data/elite-redux/coop/coop-operation-surface-registry";
import { COOP_REWARD_ACTION_STRIDE } from "#data/elite-redux/coop/coop-reward-operation";
import { COOP_CROSSROADS_SEQ_BASE, COOP_ME_PUMP_SEQ_BASE } from "#data/elite-redux/coop/coop-seq-registry";
import type { CoopAuthoritativeBattleStateV1 } from "#data/elite-redux/coop/coop-transport";
import { describe, expect, it } from "vitest";

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
  wave: 7,
  turn: 2,
  double: false,
  playerParty: [],
  enemyParty: [],
  field: [],
  weather: 0,
  weatherTurnsLeft: 0,
  terrain: 0,
  terrainTurnsLeft: 0,
  arenaTags: [],
  money: 100,
  lockModifierTiers: false,
  pokeballCounts: [],
  playerModifiers: [],
  enemyModifiers: [],
  seed: "seed",
  waveSeed: "wave-seed",
};

const OPTION = { id: "POKE_BALL", tier: 0, upgradeCount: 0, cost: 25 };

function envelope(
  kind: CoopOperationKind,
  payload: unknown,
  logicalPhase: CoopLogicalPhase,
  owner: number,
  pinnedSeq: number,
): CoopAuthoritativeEnvelopeV1 {
  return {
    version: 1,
    sessionEpoch: 1,
    revision: 1,
    wave: STATE.wave,
    turn: STATE.turn,
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

function entryOf(surfaceClass: CoopOperationSurfaceClass, value: CoopAuthoritativeEnvelopeV1): CoopAuthorityEntry {
  const built = buildCoopV2InteractionEnvelopeEntry({ context: FRAME, surfaceClass, envelope: value });
  expect(built).not.toBeNull();
  return { ...built!, revision: 1 };
}

describe("Authority V2 immutable interaction projection", () => {
  it.each([
    [
      "ability",
      "op:ability",
      envelope(
        "ABILITY_PRESENT",
        { pinned: 3, partyIndex: 0, workflow: "capsule" },
        "INTERACTION",
        1,
        3 * COOP_ABILITY_ACTION_STRIDE,
      ),
    ],
    ["bargain", "op:bargain", envelope("BARGAIN_PRESENT", { pinned: 3, sins: ["greed"] }, "INTERACTION", 1, 3)],
    [
      "biome",
      "op:biome",
      envelope("CROSSROADS_PICK", { optionIndex: 1 }, "BIOME_SELECT", 1, COOP_CROSSROADS_SEQ_BASE + 3),
    ],
    [
      "catch-full",
      "op:catchFull",
      envelope("CATCH_FULL", { type: "prompt", pokemonName: "Pikachu", speciesId: 25 }, "TURN_RESOLVE", 1, 11),
    ],
    [
      "colosseum",
      "op:colosseum",
      envelope(
        "COLO_PICK",
        { type: "board", round: 1, labels: ["Continue", "Cash out"] },
        "INTERACTION",
        1,
        3 * COOP_COLOSSEUM_ACTION_STRIDE + 2,
      ),
    ],
    [
      "learn-move",
      "op:learnMove",
      envelope("LEARN_MOVE", { type: "prompt", partySlot: 0, moveId: 33, maxMoveCount: 4 }, "TURN_RESOLVE", 1, 12),
    ],
    [
      "learn-move-batch",
      "op:learnMove",
      envelope(
        "LEARN_MOVE_BATCH",
        { type: "prompt", partySlot: 0, learnableIds: [33, 45], ownerIsGuest: true },
        "TURN_RESOLVE",
        1,
        13,
      ),
    ],
    [
      "mystery",
      "op:me",
      envelope(
        "ME_PRESENT",
        { present: true, presentation: { k: "mePresent", tokens: {}, meetsReqs: [], labels: ["A"] } },
        "MYSTERY_ENCOUNTER",
        0,
        (COOP_ME_PUMP_SEQ_BASE + 3) * 8000,
      ),
    ],
    ["revival", "op:revival", envelope("REVIVAL", { type: "prompt", fieldIndex: 0 }, "TURN_RESOLVE", 1, 14)],
    [
      "reward",
      "op:reward",
      envelope(
        "REWARD_PRESENT",
        { surface: "reward", pinned: 3, reroll: 0, options: [OPTION] },
        "REWARD_SELECT",
        1,
        3 * COOP_REWARD_ACTION_STRIDE,
      ),
    ],
    [
      "market",
      "op:reward",
      envelope(
        "SHOP_PRESENT",
        {
          surface: "market",
          pinned: 3,
          reroll: 0,
          options: [OPTION],
          marketKind: "black-market",
          remainingStock: [2],
        },
        "SHOP",
        1,
        3 * COOP_REWARD_ACTION_STRIDE,
      ),
    ],
    [
      "stormglass",
      "op:stormglass",
      envelope("STORMGLASS_PRESENT", { options: [{ weatherIndex: 0, weather: 1 }] }, "INTERACTION", 0, 15),
    ],
  ] as const)("decodes every executable %s frontier from immutable entry material", (kind, surface, value) => {
    expect(projectionPlanOfCoopV2InteractionEntry(entryOf(surface, value))?.kind).toBe(kind);
  });

  it("preserves the concrete market subclass and exact remaining stock", () => {
    const value = envelope(
      "SHOP_BUY",
      {
        slot: 0,
        terminal: false,
        result: {
          remainingStock: [1],
          continuation: {
            surface: "market",
            pinned: 3,
            reroll: 0,
            options: [OPTION],
            marketKind: "exotic",
            remainingStock: [1],
          },
        },
      },
      "SHOP",
      1,
      3 * COOP_REWARD_ACTION_STRIDE + 1,
    );
    expect(projectionPlanOfCoopV2InteractionEntry(entryOf("op:reward", value))).toMatchObject({
      kind: "market",
      projection: { marketKind: "exotic", remainingStock: [1] },
    });
  });

  it("uses the typed future BIOME operation address while retaining the source wave", () => {
    const value = envelope("CROSSROADS_PICK", { optionIndex: 1 }, "BIOME_SELECT", 1, COOP_CROSSROADS_SEQ_BASE + 9);
    const entry = entryOf("op:biome", value);
    expect(projectionPlanOfCoopV2InteractionEntry(entry)).toEqual({
      kind: "biome",
      operationId: entry.nextControl.kind === "SHARED_INTERACTION" ? entry.nextControl.operationId : "",
      sourceWave: STATE.wave,
    });
  });

  it("rejects non-terminal result entries that omit their complete continuation generation", () => {
    expect(
      buildCoopV2InteractionEnvelopeEntry({
        context: FRAME,
        surfaceClass: "op:reward",
        envelope: envelope(
          "REWARD",
          { label: "lock", choice: 0, terminal: false, result: { lockModifierTiers: true } },
          "REWARD_SELECT",
          1,
          3 * COOP_REWARD_ACTION_STRIDE + 1,
        ),
      }),
    ).toBeNull();
    expect(
      buildCoopV2InteractionEnvelopeEntry({
        context: FRAME,
        surfaceClass: "op:reward",
        envelope: envelope(
          "SHOP_BUY",
          { slot: 0, terminal: false, result: { remainingStock: [1] } },
          "SHOP",
          1,
          3 * COOP_REWARD_ACTION_STRIDE + 1,
        ),
      }),
    ).toBeNull();
  });

  it("retains the immutable source entry and refuses address-only shared-interaction recovery", () => {
    const value = envelope(
      "REWARD_PRESENT",
      { surface: "reward", pinned: 3, reroll: 0, options: [OPTION] },
      "REWARD_SELECT",
      1,
      3 * COOP_REWARD_ACTION_STRIDE,
    );
    const entry = entryOf("op:reward", value);
    expect(entry.nextControl.kind).toBe("SHARED_INTERACTION");
    if (entry.nextControl.kind !== "SHARED_INTERACTION") {
      throw new Error("fixture must expose one shared control");
    }
    const ledger = new CoopV2ControlLedger();
    expect(ledger.registerEntry(entry)).toBe(true);
    expect(ledger.sourceEntryOf(entry.nextControl)).toEqual(entry);

    const detached = ledger.sourceEntryOf(entry.nextControl)!;
    (detached.material as { digest: string }).digest = "mutated";
    expect(ledger.sourceEntryOf(entry.nextControl)?.material.digest).toBe(entry.material.digest);

    expect(new CoopV2ControlLedger().adoptRecoveryControl(entry.revision, entry.operationId, entry.nextControl)).toBe(
      false,
    );
    const recovered = new CoopV2ControlLedger();
    expect(recovered.adoptRecoveryFrontier(entry)).toBe(true);
    expect(projectionPlanOfCoopV2InteractionEntry(recovered.sourceEntryOf(entry.nextControl)!)).not.toBeNull();
  });
});

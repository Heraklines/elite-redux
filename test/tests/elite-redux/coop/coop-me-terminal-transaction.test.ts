/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import {
  CoopMeTerminalTransactionReceiver,
  commitMeOwnerIntent,
  isCompleteCoopMeTerminalPayload,
  nextCoopMePresentationStep,
  receiveCoopMeTerminalTransaction,
  resetCoopMeOperationFlag,
  resetCoopMeOperationState,
  setCoopMeOperationEnabled,
  setCoopMePresentationAuthorityStateHooksForTest,
} from "#data/elite-redux/coop/coop-me-operation";
import { type CoopMeTerminalPayload, makeCoopOperationId } from "#data/elite-redux/coop/coop-operation-envelope";
import { createCoopRuntimeOpState, setActiveCoopRuntimeOpState } from "#data/elite-redux/coop/coop-operation-runtime";
import { COOP_ME_TERM_SEQ_BASE } from "#data/elite-redux/coop/coop-seq-registry";
import type { CoopAuthoritativeBattleStateV1, CoopInteractionOutcome } from "#data/elite-redux/coop/coop-transport";
import { describe, expect, it } from "vitest";

type MeOutcome = Extract<CoopInteractionOutcome, { k: "meResync" }>;

function authoritativeState(wave: number, enemies = 0): CoopAuthoritativeBattleStateV1 {
  return {
    version: 1,
    tick: wave * 100,
    wave,
    turn: 3,
    playerParty: [],
    enemyParty: enemies === 0 ? [] : ([{ id: 9001 }] as unknown as CoopAuthoritativeBattleStateV1["enemyParty"]),
    field: [],
    weather: 0,
    weatherTurnsLeft: 0,
    terrain: 0,
    terrainTurnsLeft: 0,
    arenaTags: [],
    money: 500,
    pokeballCounts: [],
    playerModifiers: [],
    enemyModifiers: [],
  };
}

function outcome(wave: number, enemies = 0): MeOutcome {
  return {
    k: "meResync",
    base: null,
    party: [],
    meSaveData: "[]",
    seed: `seed-${wave}`,
    waveSeed: `wave-${wave}`,
    dex: "dex",
    authoritativeState: authoritativeState(wave, enemies),
  };
}

function leavePayload(wave: number, selectBiome = false): CoopMeTerminalPayload {
  return {
    terminal: "leave",
    outcome: outcome(wave),
    destination: { kind: "continue", nextWave: wave + 1, selectBiome },
  };
}

function battlePayload(
  wave: number,
  options: { encounterMode?: number; disableSwitch?: boolean } = {},
): CoopMeTerminalPayload {
  return {
    terminal: "battle",
    outcome: outcome(wave, 1),
    destination: {
      kind: "battle",
      hostTurn: 3,
      encounterMode: options.encounterMode ?? 2,
      disableSwitch: options.disableSwitch ?? false,
    },
  };
}

function settledPayload(
  wave: number,
  options: {
    result?: "victory" | "failure";
    continuation?: "rewards" | "encounter" | "none";
    trainerVictory?: boolean;
    addHeal?: boolean;
    rewardShop?: boolean;
    eggLapse?: boolean;
  } = {},
): CoopMeTerminalPayload {
  const continuation = options.continuation ?? "rewards";
  return {
    terminal: "battle-settled",
    outcome: outcome(wave),
    destination: {
      kind: "reward",
      hostTurn: 3,
      result: options.result ?? "victory",
      continuation,
      trainerVictory: options.trainerVictory ?? false,
      addHeal: options.addHeal ?? false,
      rewardShop: options.rewardShop ?? continuation === "rewards",
      eggLapse: options.eggLapse ?? continuation === "rewards",
    },
  };
}

function terminalId(pinned: number, step: number, epoch = 1): string {
  return makeCoopOperationId(epoch, 0, (COOP_ME_TERM_SEQ_BASE + pinned) * 8000 + 4000 + step, "ME_TERMINAL");
}

describe("complete retained Mystery terminal transaction", () => {
  it("keeps host presentation ordinals and commit logs isolated per runtime", () => {
    const runtimeA = createCoopRuntimeOpState("host");
    const runtimeB = createCoopRuntimeOpState("guest");
    const pinned = 7;
    const seq = 8_000_000 + pinned;
    const params = {
      kind: "ME_PRESENT" as const,
      seq,
      pinned,
      step: 0,
      payload: {
        present: true,
        presentation: { k: "mePresent" as const, tokens: {}, meetsReqs: [], labels: [] },
      },
      localRole: "host" as const,
      wave: 12,
      turn: 0,
    };

    setCoopMeOperationEnabled(true);
    setCoopMePresentationAuthorityStateHooksForTest({
      capture: turn => ({
        ...authoritativeState(12),
        turn,
        playerParty: [{ id: 1 }] as unknown as CoopAuthoritativeBattleStateV1["playerParty"],
      }),
    });
    try {
      setActiveCoopRuntimeOpState(runtimeA);
      expect(nextCoopMePresentationStep(pinned)).toBe(0);
      expect(commitMeOwnerIntent(params)).not.toBeNull();
      expect(nextCoopMePresentationStep(pinned)).toBe(1);

      setActiveCoopRuntimeOpState(runtimeB);
      expect(nextCoopMePresentationStep(pinned), "the renderer did not inherit the host's ordinal").toBe(0);
      expect(
        commitMeOwnerIntent(params),
        "the same deterministic id is independent in the second runtime",
      ).not.toBeNull();
      expect(nextCoopMePresentationStep(pinned)).toBe(1);

      setActiveCoopRuntimeOpState(runtimeA);
      expect(nextCoopMePresentationStep(pinned)).toBe(1);
    } finally {
      for (const runtime of [runtimeA, runtimeB]) {
        setActiveCoopRuntimeOpState(runtime);
        resetCoopMeOperationState();
      }
      setActiveCoopRuntimeOpState(null);
      setCoopMePresentationAuthorityStateHooksForTest(null);
      resetCoopMeOperationFlag();
    }
  });

  it("keeps terminal receipts isolated on the exact receiving runtime", () => {
    const runtimeA = createCoopRuntimeOpState("guest");
    const runtimeB = createCoopRuntimeOpState("guest");
    const receipt = { operationId: terminalId(7, 0), pinned: 7, step: 0, payload: leavePayload(12) };
    let materialApplies = 0;
    let destinationExecutions = 0;
    const hooks = {
      applyMaterial: () => {
        materialApplies++;
        return true;
      },
      executeDestination: () => {
        destinationExecutions++;
        return true;
      },
    };

    try {
      setActiveCoopRuntimeOpState(runtimeA);
      expect(receiveCoopMeTerminalTransaction(receipt, hooks)).toBe("executed");

      setActiveCoopRuntimeOpState(runtimeB);
      expect(
        receiveCoopMeTerminalTransaction(receipt, hooks),
        "the second client owns a distinct receipt ledger even for the same deterministic id",
      ).toBe("executed");

      setActiveCoopRuntimeOpState(runtimeA);
      expect(receiveCoopMeTerminalTransaction(receipt, hooks)).toBe("duplicate");
      expect(materialApplies).toBe(2);
      expect(destinationExecutions).toBe(2);
    } finally {
      setActiveCoopRuntimeOpState(null);
    }
  });

  it("rejects every split terminal shape and accepts complete leave/battle/settlement destinations", () => {
    expect(isCompleteCoopMeTerminalPayload({ terminal: "leave" })).toBe(false);
    expect(isCompleteCoopMeTerminalPayload({ terminal: "battle", hostTurn: 3 })).toBe(false);
    expect(
      isCompleteCoopMeTerminalPayload({
        terminal: "battle",
        outcome: outcome(12, 1),
        destination: { kind: "continue", nextWave: 13, selectBiome: false },
      }),
    ).toBe(false);
    expect(isCompleteCoopMeTerminalPayload(leavePayload(12, true))).toBe(true);
    expect(isCompleteCoopMeTerminalPayload(battlePayload(12, { encounterMode: 3, disableSwitch: true }))).toBe(true);
    expect(isCompleteCoopMeTerminalPayload(settledPayload(12, { addHeal: true, trainerVictory: true }))).toBe(true);
    const missingRewardSurface = settledPayload(12);
    delete (missingRewardSurface.destination as { rewardShop?: boolean }).rewardShop;
    expect(
      isCompleteCoopMeTerminalPayload(missingRewardSurface),
      "the renderer cannot infer whether a settled reward phase opens a shop",
    ).toBe(false);
    expect(
      isCompleteCoopMeTerminalPayload(settledPayload(12, { result: "failure", trainerVictory: true, eggLapse: false })),
      "a failed battle cannot declare trainer-victory presentation",
    ).toBe(false);
    expect(
      isCompleteCoopMeTerminalPayload(
        settledPayload(12, { continuation: "encounter", addHeal: true, rewardShop: true }),
      ),
      "event-continuation settlements cannot smuggle reward-only mutations",
    ).toBe(false);
  });

  it("applies DATA once, withholds completion for a late destination receiver, then executes once after reconnect", () => {
    const receiver = new CoopMeTerminalTransactionReceiver();
    const receipt = { operationId: terminalId(7, 0), pinned: 7, step: 0, payload: leavePayload(12) };
    let materialApplies = 0;
    let destinationAttempts = 0;
    let destinationReady = false;
    const hooks = {
      applyMaterial: () => {
        materialApplies++;
        return true;
      },
      executeDestination: () => {
        destinationAttempts++;
        return destinationReady;
      },
    };

    // A dropped frame is represented by no receive call: neither stage can move.
    expect(materialApplies).toBe(0);
    expect(destinationAttempts).toBe(0);
    expect(receiver.receive(receipt, hooks), "late replay phase withholds ACK after the one DATA apply").toBe("retry");
    expect(materialApplies).toBe(1);
    expect(destinationAttempts).toBe(1);

    destinationReady = true; // same receiver survives the channel reconnect
    expect(receiver.receive(receipt, hooks), "exact redelivery executes only the pending control stage").toBe(
      "executed",
    );
    expect(materialApplies).toBe(1);
    expect(destinationAttempts).toBe(2);
    expect(receiver.receive(receipt, hooks), "duplicate delivery is an exact no-op").toBe("duplicate");
    expect(materialApplies).toBe(1);
    expect(destinationAttempts).toBe(2);
  });

  it("rejects reordered post-battle operations, then admits battle -> settlement -> leave", () => {
    const receiver = new CoopMeTerminalTransactionReceiver();
    const hooks = { applyMaterial: () => true, executeDestination: () => true };
    const pinned = 11;

    expect(
      receiver.receive({ operationId: terminalId(pinned, 1), pinned, step: 1, payload: leavePayload(20, true) }, hooks),
      "leave cannot overtake either battle handoff or settlement",
    ).toBe("rejected");
    expect(
      receiver.receive(
        {
          operationId: terminalId(pinned, 0),
          pinned,
          step: 0,
          payload: battlePayload(20, { encounterMode: 1, disableSwitch: true }),
        },
        hooks,
      ),
    ).toBe("executed");
    expect(
      receiver.receive({ operationId: terminalId(pinned, 1), pinned, step: 1, payload: settledPayload(20) }, hooks),
    ).toBe("executed");
    expect(
      receiver.receive({ operationId: terminalId(pinned, 2), pinned, step: 2, payload: leavePayload(20, true) }, hooks),
    ).toBe("executed");
  });

  it("retains every Colosseum round as step N, retries round N+1 after rejoin, then executes final leave", () => {
    const receiver = new CoopMeTerminalTransactionReceiver();
    const pinned = 12;
    let materialApplies = 0;
    let destinationAttempts = 0;
    let destinationReady = true;
    const hooks = {
      applyMaterial: () => {
        materialApplies++;
        return true;
      },
      executeDestination: () => {
        destinationAttempts++;
        return destinationReady;
      },
    };
    const round0 = { operationId: terminalId(pinned, 0), pinned, step: 0, payload: battlePayload(20) };
    const settled0 = {
      operationId: terminalId(pinned, 1),
      pinned,
      step: 1,
      payload: settledPayload(20, { continuation: "encounter", eggLapse: false }),
    };
    const round1 = {
      operationId: terminalId(pinned, 2),
      pinned,
      step: 2,
      payload: battlePayload(20, { encounterMode: 3, disableSwitch: true }),
    };

    expect(
      receiver.receive({ operationId: terminalId(pinned, 2), pinned, step: 2, payload: battlePayload(20) }, hooks),
      "a later round cannot overtake its retained battle settlement",
    ).toBe("rejected");
    expect(receiver.receive(round0, hooks)).toBe("executed");
    expect(receiver.receive(round0, hooks), "an old round remains idempotent after execution").toBe("duplicate");

    destinationReady = false;
    expect(receiver.receive(settled0, hooks), "settlement DATA is retained while the held BattleEnd is late").toBe(
      "retry",
    );
    expect(materialApplies).toBe(2);
    destinationReady = true;
    expect(receiver.receive(settled0, hooks), "hot-rejoin retries only settlement control").toBe("executed");
    expect(materialApplies, "the settlement state image applied exactly once").toBe(2);
    expect(receiver.receive(round1, hooks), "the next battle is admitted only after settlement").toBe("executed");
    expect(receiver.receive(round0, hooks), "a late duplicate from round N never regresses the cursor").toBe(
      "duplicate",
    );

    expect(
      receiver.receive(
        {
          operationId: terminalId(pinned, 3),
          pinned,
          step: 3,
          payload: settledPayload(20, { continuation: "encounter", eggLapse: false }),
        },
        hooks,
      ),
    ).toBe("executed");
    expect(
      receiver.receive({ operationId: terminalId(pinned, 4), pinned, step: 4, payload: leavePayload(20, true) }, hooks),
    ).toBe("executed");
    expect(
      receiver.receive({ operationId: terminalId(pinned, 5), pinned, step: 5, payload: battlePayload(20) }, hooks),
      "the final leave closes the pinned transaction sequence",
    ).toBe("rejected");
    expect(destinationAttempts).toBe(6);
  });

  it("rejects same-id payload conflicts and a second terminal for the same pinned stage", () => {
    const receiver = new CoopMeTerminalTransactionReceiver();
    let ready = false;
    const hooks = { applyMaterial: () => true, executeDestination: () => ready };
    const first = { operationId: terminalId(13, 0), pinned: 13, step: 0, payload: leavePayload(30) };
    expect(receiver.receive(first, hooks)).toBe("retry");
    expect(receiver.receive({ ...first, payload: leavePayload(30, true) }, hooks)).toBe("rejected");
    expect(receiver.receive({ ...first, pinned: 14 }, hooks), "one id cannot be rebound to another pin").toBe(
      "rejected",
    );
    expect(receiver.receive({ ...first, step: 1 }, hooks), "one id cannot be rebound to another step").toBe("rejected");
    expect(
      receiver.receive({ operationId: terminalId(13, 0, 2), pinned: 13, step: 0, payload: leavePayload(30) }, hooks),
    ).toBe("rejected");
    ready = true;
    expect(receiver.receive(first, hooks)).toBe("executed");
  });

  it.each([
    "quiz result",
    "delve/repeated selector",
    "nested party picker",
    "secondary picker",
    "catch-full picker",
    "embedded shop handoff",
  ])("executes independently of prior presentation family: %s", presentationFamily => {
    const receiver = new CoopMeTerminalTransactionReceiver();
    const stages: string[] = [];
    const result = receiver.receive(
      {
        operationId: terminalId(40, 0),
        pinned: 40,
        step: 0,
        payload: leavePayload(40, presentationFamily === "embedded shop handoff"),
      },
      {
        applyMaterial: () => {
          stages.push("material");
          return true;
        },
        executeDestination: () => {
          stages.push("destination");
          return true;
        },
      },
    );
    expect(result).toBe("executed");
    expect(stages).toEqual(["material", "destination"]);
  });
});

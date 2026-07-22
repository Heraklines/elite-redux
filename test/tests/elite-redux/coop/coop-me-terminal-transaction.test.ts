/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { resetCoopStateTicks } from "#data/elite-redux/coop/coop-battle-engine";
import {
  COOP_ME_AUTHORITY_TURN,
  CoopMeTerminalTransactionReceiver,
  captureCoopMeCommittedTerminalCursor,
  commitMeOwnerIntent,
  completeCoopMeFinalOutcomeFromRetainedSettlement,
  coopMeTerminalSanctionedTails,
  isCompleteCoopMeTerminalPayload,
  nextCoopMePresentationStep,
  receiveCoopMeTerminalTransaction,
  releaseCoopMeRetainedTerminal,
  resetCoopMeOperationFlag,
  resetCoopMeOperationState,
  setCoopMeOperationEnabled,
  setCoopMePresentationAuthorityStateHooksForTest,
} from "#data/elite-redux/coop/coop-me-operation";
import {
  COOP_ME_REROLL_MULTIPLIER_MAX,
  COOP_ME_REWARD_SURFACE_LIMIT,
  type CoopMeRewardSurfaceProjection,
  type CoopMeTerminalPayload,
  makeCoopMeModifierRewardSurfaceProjection,
  makeCoopOperationId,
} from "#data/elite-redux/coop/coop-operation-envelope";
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
    rewardSurfaces?: CoopMeRewardSurfaceProjection[];
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
      rewardSurfaces:
        options.rewardSurfaces
        ?? (continuation === "rewards" ? [makeCoopMeModifierRewardSurfaceProjection("modifier:0")] : []),
      eggLapse: options.eggLapse ?? continuation === "rewards",
    },
  };
}

function rewardSettledPayload(
  wave: number,
  options: {
    result?: "victory" | "failure";
    rewardSurfaces?: CoopMeRewardSurfaceProjection[];
    eggLapse?: boolean;
  } = {},
): Extract<CoopMeTerminalPayload, { terminal: "reward-settled" }> {
  return {
    terminal: "reward-settled",
    outcome: outcome(wave),
    destination: {
      kind: "reward",
      hostTurn: 3,
      result: options.result ?? "victory",
      continuation: "rewards",
      trainerVictory: false,
      rewardSurfaces: options.rewardSurfaces ?? [makeCoopMeModifierRewardSurfaceProjection("modifier:heal", -1)],
      eggLapse: options.eggLapse ?? true,
    },
  };
}

function terminalId(pinned: number, step: number, epoch = 1): string {
  return makeCoopOperationId(epoch, 0, (COOP_ME_TERM_SEQ_BASE + pinned) * 8000 + 4000 + step, "ME_TERMINAL");
}

function eggReward(overrides: Record<string, unknown> = {}): CoopMeRewardSurfaceProjection {
  return {
    kind: "egg",
    surfaceId: "egg:me:1:0",
    id: 12345,
    timestamp: 1_700_000_000_000,
    sourceType: null,
    tier: 1,
    hatchWaves: 25,
    species: 25,
    isShiny: false,
    variantTier: 0,
    eggMoveIndex: 1,
    overrideHiddenAbility: false,
    eggDescriptor: "A promised Egg",
    ...overrides,
  } as CoopMeRewardSurfaceProjection;
}

describe("complete retained Mystery terminal transaction", () => {
  it("republishes the exact post-reward result when the final live crossing capture is fieldless", () => {
    resetCoopStateTicks();
    try {
      const fieldless = { ...outcome(12), authoritativeState: undefined };
      const rewardResult = {
        ...authoritativeState(12),
        tick: 44,
        pokeballCounts: [[1, 99]] as [number, number][],
      };

      const completed = completeCoopMeFinalOutcomeFromRetainedSettlement(7, fieldless, rewardResult);

      expect(completed.authoritativeState).toEqual({
        ...rewardResult,
        tick: 1,
        pokeballCounts: [],
      });
      expect(fieldless.authoritativeState, "the fresh final outcome remains immutable").toBeUndefined();
      expect(rewardResult.tick, "the retained reward retry image remains immutable").toBe(44);
    } finally {
      resetCoopStateTicks();
    }
  });

  it("keeps an explicit monotonic host terminal cursor and releases the whole pinned lifecycle", () => {
    const runtime = createCoopRuntimeOpState("host");
    const pinned = 7;

    setCoopMeOperationEnabled(true);
    setActiveCoopRuntimeOpState(runtime);
    setCoopMePresentationAuthorityStateHooksForTest({
      capture: turn => ({ ...authoritativeState(12), turn }),
    });
    try {
      const settlementId = commitMeOwnerIntent({
        kind: "ME_TERMINAL",
        seq: COOP_ME_TERM_SEQ_BASE + pinned,
        pinned,
        step: 0,
        payload: rewardSettledPayload(12),
        localRole: "host",
        wave: 12,
        turn: COOP_ME_AUTHORITY_TURN,
      });
      expect(settlementId).not.toBeNull();
      expect(captureCoopMeCommittedTerminalCursor(pinned)).toEqual({
        operationId: settlementId,
        terminal: "reward-settled",
        step: 0,
      });

      const leaveId = commitMeOwnerIntent({
        kind: "ME_TERMINAL",
        seq: COOP_ME_TERM_SEQ_BASE + pinned,
        pinned,
        step: 1,
        payload: leavePayload(12),
        localRole: "host",
        wave: 12,
        turn: COOP_ME_AUTHORITY_TURN,
      });
      expect(leaveId).not.toBeNull();
      expect(captureCoopMeCommittedTerminalCursor(pinned)).toEqual({
        operationId: leaveId,
        terminal: "leave",
        step: 1,
      });

      releaseCoopMeRetainedTerminal(leaveId);
      expect(captureCoopMeCommittedTerminalCursor(pinned)).toBeUndefined();
    } finally {
      resetCoopMeOperationState();
      setActiveCoopRuntimeOpState(null);
      setCoopMePresentationAuthorityStateHooksForTest(null);
      resetCoopMeOperationFlag();
    }
  });

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
    expect(
      isCompleteCoopMeTerminalPayload(
        settledPayload(12, {
          rewardSurfaces: [makeCoopMeModifierRewardSurfaceProjection("modifier:heal", -1)],
          trainerVictory: true,
        }),
      ),
    ).toBe(true);
    expect(isCompleteCoopMeTerminalPayload(rewardSettledPayload(12))).toBe(true);
    expect(
      isCompleteCoopMeTerminalPayload({
        ...rewardSettledPayload(12),
        destination: {
          ...rewardSettledPayload(12).destination,
          continuation: "encounter",
        },
      }),
      "a no-battle settlement cannot authorize a battle/encounter continuation",
    ).toBe(false);
    expect(makeCoopMeModifierRewardSurfaceProjection("modifier:default").rerollMultiplier).toBe(1);
    const missingRewardSurfacePlan = settledPayload(12);
    delete (missingRewardSurfacePlan.destination as { rewardSurfaces?: unknown }).rewardSurfaces;
    expect(
      isCompleteCoopMeTerminalPayload(missingRewardSurfacePlan),
      "the renderer cannot infer an omitted ordered reward-surface plan",
    ).toBe(false);
    expect(
      isCompleteCoopMeTerminalPayload(
        settledPayload(12, {
          rewardSurfaces: [
            makeCoopMeModifierRewardSurfaceProjection("modifier:duplicate"),
            makeCoopMeModifierRewardSurfaceProjection("modifier:duplicate", -1),
          ],
        }),
      ),
      "stable surface identities must be unique within the ordered plan",
    ).toBe(false);
    expect(
      isCompleteCoopMeTerminalPayload(settledPayload(12, { result: "failure", trainerVictory: true, eggLapse: false })),
      "a failed battle cannot declare trainer-victory presentation",
    ).toBe(false);
    expect(
      isCompleteCoopMeTerminalPayload(
        settledPayload(12, {
          continuation: "encounter",
          rewardSurfaces: [makeCoopMeModifierRewardSurfaceProjection("modifier:smuggled")],
        }),
      ),
      "event-continuation settlements cannot smuggle reward-only mutations",
    ).toBe(false);
  });

  it("rejects unbounded or non-executable modifier reward projections", () => {
    const validates = (rewardSurfaces: CoopMeRewardSurfaceProjection[]) =>
      isCompleteCoopMeTerminalPayload(settledPayload(12, { rewardSurfaces }));

    expect(validates([makeCoopMeModifierRewardSurfaceProjection("modifier:0", 0.5)])).toBe(true);
    expect(
      validates(
        Array.from({ length: COOP_ME_REWARD_SURFACE_LIMIT }, (_, index) =>
          makeCoopMeModifierRewardSurfaceProjection(`modifier:${index}`),
        ),
      ),
    ).toBe(true);
    expect(validates([makeCoopMeModifierRewardSurfaceProjection("")])).toBe(false);
    expect(validates([makeCoopMeModifierRewardSurfaceProjection("Modifier 0")])).toBe(false);
    expect(validates([makeCoopMeModifierRewardSurfaceProjection(`m${"x".repeat(64)}`)])).toBe(false);
    expect(validates([makeCoopMeModifierRewardSurfaceProjection("modifier:0", -2)])).toBe(false);
    expect(validates([makeCoopMeModifierRewardSurfaceProjection("modifier:0", Number.NaN)])).toBe(false);
    expect(validates([makeCoopMeModifierRewardSurfaceProjection("modifier:0", Number.POSITIVE_INFINITY)])).toBe(false);
    expect(validates([eggReward()])).toBe(true);
    expect(validates([makeCoopMeModifierRewardSurfaceProjection("modifier:0"), eggReward()])).toBe(true);
    expect(validates([eggReward({ id: -1 })])).toBe(false);
    expect(validates([eggReward({ tier: 4 })])).toBe(false);
    expect(validates([eggReward({ species: 0 })])).toBe(false);
    expect(validates([eggReward({ species: 1500 })])).toBe(false);
    expect(validates([eggReward({ species: 999_999 })])).toBe(false);
    expect(validates([eggReward({ sourceType: 6 })])).toBe(false);
    expect(validates([eggReward({ isShiny: "yes" })])).toBe(false);
    expect(validates([eggReward({ variantTier: 3 })])).toBe(false);
    expect(validates([eggReward({ eggDescriptor: "x".repeat(257) })])).toBe(false);
    expect(
      validates([eggReward({ surfaceId: "modifier:0" }), makeCoopMeModifierRewardSurfaceProjection("modifier:0")]),
    ).toBe(false);
    expect(
      validates([makeCoopMeModifierRewardSurfaceProjection("modifier:0", COOP_ME_REROLL_MULTIPLIER_MAX + 1)]),
    ).toBe(false);
    expect(
      validates([{ kind: "move-tutor", surfaceId: "modifier:0", rerollMultiplier: 1 } as never]),
      "unknown surface kinds fail closed until their own protocol arm exists",
    ).toBe(false);
    expect(
      validates(
        Array.from({ length: COOP_ME_REWARD_SURFACE_LIMIT + 1 }, (_, index) =>
          makeCoopMeModifierRewardSurfaceProjection(`modifier:${index}`),
        ),
      ),
    ).toBe(false);
  });

  it("sanctions one retained reward phase for an ordered multi-surface plan", () => {
    const payload = settledPayload(12, {
      rewardSurfaces: [
        makeCoopMeModifierRewardSurfaceProjection("modifier:graves:0"),
        makeCoopMeModifierRewardSurfaceProjection("modifier:graves:1", -1),
      ],
    });
    expect(coopMeTerminalSanctionedTails(payload)).toEqual([
      "MysteryEncounterRewardsPhase",
      "PostMysteryEncounterPhase",
      "EggLapsePhase",
    ]);
  });

  it("sanctions the wave-advance continuation on a non-battle ME's final leave terminal", () => {
    // A non-battle ME emits reward-settled/battle-settled (its own reward tail) THEN a final leave/continue
    // terminal that RE-SETS the sanction. That final terminal is the last op before the next wave, so it must
    // sanction NewBattlePhase AND its NextEncounterPhase companion (battle-scene.newBattle pushes it). Omitting
    // NextEncounterPhase let strict-tails ENFORCE neutralize it -> drained queue -> phantom CommandPhase ->
    // empty-frontier shared-session terminal at the next ME wave's turn 1 (10-wave mystery-gauntlet lane).
    expect(coopMeTerminalSanctionedTails(leavePayload(12))).toEqual(["NewBattlePhase", "NextEncounterPhase"]);
    expect(coopMeTerminalSanctionedTails(leavePayload(12, /* selectBiome */ true))).toEqual([
      "SelectBiomePhase",
      "NewBattlePhase",
      "NextEncounterPhase",
    ]);
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

  it("applies a no-battle state image before rewards, then admits only its exact final leave", () => {
    const receiver = new CoopMeTerminalTransactionReceiver();
    const hooks = { applyMaterial: () => true, executeDestination: () => true };
    const pinned = 15;

    expect(
      receiver.receive(
        {
          operationId: terminalId(pinned, 1),
          pinned,
          step: 1,
          payload: leavePayload(24),
        },
        hooks,
      ),
      "final leave cannot overtake the no-battle pre-reward state image",
    ).toBe("rejected");
    expect(
      receiver.receive(
        {
          operationId: terminalId(pinned, 0),
          pinned,
          step: 0,
          payload: rewardSettledPayload(24),
        },
        hooks,
      ),
    ).toBe("executed");
    expect(
      receiver.receive(
        {
          operationId: terminalId(pinned, 1),
          pinned,
          step: 1,
          payload: battlePayload(24),
        },
        hooks,
      ),
      "a no-battle reward settlement cannot transition into a battle",
    ).toBe("rejected");
    expect(
      receiver.receive(
        {
          operationId: terminalId(pinned, 1),
          pinned,
          step: 1,
          payload: leavePayload(24),
        },
        hooks,
      ),
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

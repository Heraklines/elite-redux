import { initGlobalScene } from "#app/global-scene";
import { getMoodyCoordinatorEffectState } from "#data/elite-redux/moody/moody-coordinator-combat-state";
import {
  coordinateMoodyRuntime,
  type MoodyCoordinatorEvent,
  type MoodyCoordinatorState,
} from "#data/elite-redux/moody/moody-runtime-coordinator";
import { notifyMoodyCoordinatorPokemonPermanentlyRemoved } from "#data/elite-redux/moody/moody-runtime-game-adapter";
import { createMoodyModeState, resetMoodyModeState, restoreMoodyModeState } from "#data/elite-redux/moody/moody-state";
import type { Pokemon } from "#field/pokemon";
import type { MoodyOperationModel } from "#ui/moody/moody-operation";
import { afterEach, describe, expect, it, vi } from "vitest";

function pokemon(id: number): Pokemon {
  return {
    id,
    hp: 100,
    bossSegments: 0,
    getMaxHp: vi.fn(() => 100),
    getMoveset: vi.fn(() => []),
    getNameToRender: vi.fn(() => `Pokemon ${id}`),
    isFainted: vi.fn(() => false),
    updateInfo: vi.fn(async () => undefined),
  } as unknown as Pokemon;
}

function restoreLegacyState(options: {
  readonly slot: number;
  readonly pokemonId: number;
  readonly inheritedBoonId: string;
}): void {
  const state = createMoodyModeState(`legacy-${options.slot}-${options.inheritedBoonId}`);
  state.boons.push(
    {
      instanceId: "legacy-slot:test",
      boonId: "legacy-slot",
      rank: 1,
      target: { partySlots: [options.slot] },
      acquiredAtWave: 10,
    },
    {
      instanceId: `${options.inheritedBoonId}:test`,
      boonId: options.inheritedBoonId,
      rank: 1,
      target: { pokemonIds: [options.pokemonId] },
      progress: { counters: { progress: 8 } },
      acquiredAtWave: 20,
    },
  );
  expect(restoreMoodyModeState(state)).toBe(true);
}

function installLegacyScene(party: Pokemon[], operationResult?: { selectedIds: readonly string[] }) {
  const phases: unknown[] = [];
  let model: MoodyOperationModel | undefined;
  initGlobalScene({
    getPlayerParty: vi.fn(() => party),
    getEnemyParty: vi.fn(() => []),
    addMoney: vi.fn(),
    phaseManager: {
      unshiftPhase: vi.fn((phase: unknown) => phases.push(phase)),
      shiftPhase: vi.fn(),
    },
    ui: {
      requestMoodyOperation: vi.fn((next: MoodyOperationModel) => {
        model = next;
        return operationResult == null
          ? new Promise(() => undefined)
          : Promise.resolve({ action: "confirm", orderedIds: [], ...operationResult });
      }),
    },
  } as never);
  return {
    phases,
    get model() {
      return model;
    },
  };
}

const waveFailure: MoodyCoordinatorEvent = {
  type: "wave-completed",
  seed: 99,
  waveIndex: 20,
  victory: false,
  isBoss: true,
  alliedFaintCount: 1,
  partySize: 6,
  money: 0,
  compoundInterestCapRemaining: 0,
  biomeFailureShieldAvailable: false,
  activeBoonInstanceIds: ["bounty-board:test"],
};

function bountyState(stage: string, contractChain = 0): MoodyCoordinatorState {
  return {
    effects: [
      {
        effectId: "bounty-board",
        stage,
        state: { counters: { contractChain } },
      },
    ],
  };
}

describe("Moody release blocker: Legacy Slot binding and whitelist", () => {
  afterEach(() => {
    resetMoodyModeState();
    vi.restoreAllMocks();
  });

  it("does not trigger when a Pokemon outside the bound party slot is removed", () => {
    restoreLegacyState({ slot: 1, pokemonId: 1, inheritedBoonId: "chosen-one" });
    const scene = installLegacyScene([pokemon(1), pokemon(2)]);

    notifyMoodyCoordinatorPokemonPermanentlyRemoved(1);

    expect(scene.phases).toHaveLength(0);
  });

  it("rejects progression-bearing boons outside the explicit inheritance whitelist", () => {
    restoreLegacyState({ slot: 0, pokemonId: 1, inheritedBoonId: "time-loop" });
    const scene = installLegacyScene([pokemon(1), pokemon(2)]);

    notifyMoodyCoordinatorPokemonPermanentlyRemoved(1);

    expect(scene.phases).toHaveLength(0);
  });

  it("persists the bound slot with the selected compatible imprint", async () => {
    restoreLegacyState({ slot: 0, pokemonId: 1, inheritedBoonId: "chosen-one" });
    const scene = installLegacyScene([pokemon(1), pokemon(2)], { selectedIds: ["chosen-one:test"] });

    notifyMoodyCoordinatorPokemonPermanentlyRemoved(1);
    expect(scene.phases).toHaveLength(1);
    (scene.phases[0] as { start(): void }).start();
    await vi.waitFor(() => expect(getMoodyCoordinatorEffectState("legacy-slot")?.values?.pendingLegacy).toBeTruthy());

    expect(getMoodyCoordinatorEffectState("legacy-slot")?.values?.pendingLegacy).toMatchObject({
      partySlot: 0,
      selectedImprints: ["chosen-one:test"],
    });
  });
});

describe("Moody release blocker: Bounty Board cadence", () => {
  it("keeps the base contract optional and publishes a nonzero relic chance", () => {
    const draft = coordinateMoodyRuntime(bountyState("base"), {
      type: "contract-draft",
      seed: 1,
      feasibleContractIds: ["no-allied-faint"],
    });
    expect(draft.commands[0].data).toMatchObject({ optional: true });

    const completion = coordinateMoodyRuntime(draft.state, {
      type: "contract-completed",
      seed: 2,
      contractId: "no-allied-faint",
    });
    expect(Number(completion.commands[0].data.relicChance)).toBeGreaterThan(0);
  });

  it("resets Relic Hunter after the guaranteed second completion", () => {
    const first = coordinateMoodyRuntime(bountyState("relic-hunter"), {
      type: "contract-completed",
      seed: 1,
      contractId: "first",
    });
    expect(first.commands[0].data.relicChoice).toBe(false);
    expect(first.state.effects[0].state?.counters?.contractChain).toBe(1);

    const second = coordinateMoodyRuntime(first.state, {
      type: "contract-completed",
      seed: 2,
      contractId: "second",
    });
    expect(second.commands[0].data.relicChoice).toBe(true);
    expect(second.state.effects[0].state?.counters?.contractChain).toBe(0);

    const third = coordinateMoodyRuntime(second.state, {
      type: "contract-completed",
      seed: 3,
      contractId: "third",
    });
    expect(third.commands[0].data.relicChoice).toBe(false);
  });

  it("resets a partial Relic Hunter chain when the segment fails", () => {
    const result = coordinateMoodyRuntime(bountyState("relic-hunter", 1), waveFailure);
    expect(result.state.effects[0].state?.counters?.contractChain).toBe(0);
  });

  it("materializes a harder Master Contract objective instead of relabeling a base contract", () => {
    const feasible = ["no-allied-faint", "three-switches", "boss-turn-limit"];
    const result = coordinateMoodyRuntime(bountyState("master-contract"), {
      type: "contract-draft",
      seed: 7,
      feasibleContractIds: feasible,
    });
    const ids = result.commands[0].data.contractIds as readonly string[];
    expect(ids.length).toBeGreaterThan(0);
    expect(ids.every(id => id.startsWith("master:"))).toBe(true);
    expect(result.commands[0].data).toMatchObject({ objectiveDifficulty: "master" });
  });
});

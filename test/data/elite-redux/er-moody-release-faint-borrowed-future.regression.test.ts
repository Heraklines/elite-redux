import { initGlobalScene } from "#app/global-scene";
import { SideKind } from "#data/battle-format";
import { installCoopPartyReorderPresentationProjector } from "#data/elite-redux/coop/coop-party-reorder-presentation";
import * as formationAdapter from "#data/elite-redux/moody/moody-formation-game-adapter";
import * as fieldEngine from "#data/elite-redux/moody/moody-runtime-field-engine";
import * as coordinatorAdapter from "#data/elite-redux/moody/moody-runtime-game-adapter";
import {
  prepareMoodyCoordinatorEnemyActionCommitments,
  resolveMoodyCommittedEnemyTargetIndices,
} from "#data/elite-redux/moody/moody-runtime-game-adapter";
import { createMoodyModeState, resetMoodyModeState, restoreMoodyModeState } from "#data/elite-redux/moody/moody-state";
import { BattleType } from "#enums/battle-type";
import { BattlerIndex } from "#enums/battler-index";
import { MoveId } from "#enums/move-id";
import { MoveUseMode } from "#enums/move-use-mode";
import type { EnemyPokemon, Pokemon } from "#field/pokemon";
import { PokemonHeldItemModifier } from "#modifiers/modifier";
import { FaintPhase } from "#phases/faint-phase";
import type { MoodyOperationModel, MoodyOperationResult } from "#ui/moody/moody-operation";
import { afterEach, describe, expect, it, vi } from "vitest";

function enemyFaintTarget(): Pokemon {
  return {
    id: 901,
    getTag: vi.fn(() => undefined),
    isPlayer: vi.fn(() => false),
    loseHeldItem: vi.fn(),
    resetSummonData: vi.fn(),
  } as unknown as Pokemon;
}

function restoreBorrowedFuture(rank: 1 | 2 | 3 = 1, evolutionId?: string): void {
  const state = createMoodyModeState(`borrowed-future-${rank}-${evolutionId ?? "base"}`);
  state.boons.push({
    instanceId: "borrowed-future:test",
    boonId: "borrowed-future",
    rank,
    ...(evolutionId == null ? {} : { evolutionId }),
    acquiredAtWave: 10,
  });
  expect(restoreMoodyModeState(state)).toBe(true);
}

function battler(id: number, battlerIndex: number): Pokemon {
  const moveset = [{ moveId: MoveId.TACKLE }, { moveId: MoveId.GROWL }];
  return {
    id,
    level: 50,
    hp: 100,
    bossSegments: 0,
    moveset,
    summonData: { moveset: structuredClone(moveset) },
    getBattlerIndex: vi.fn(() => battlerIndex),
    getMoveset: vi.fn(() => moveset),
    getNameToRender: vi.fn(() => `Pokemon ${id}`),
    isActive: vi.fn(() => true),
    isFainted: vi.fn(() => false),
  } as unknown as Pokemon;
}

function enemyBattler(id: number, battlerIndex: number, target: number, moveId = MoveId.TACKLE): EnemyPokemon {
  return {
    ...battler(id, battlerIndex),
    abilityIndex: 0,
    getAbility: vi.fn(() => ({ id: 1, name: "Sturdy" })),
    getAbilitySlots: vi.fn(() => [{ ability: { id: 1, name: "Sturdy" } }]),
    getMoveset: vi.fn(() => [{ moveId, getMove: () => ({ id: moveId }) }]),
    getNextMove: vi.fn(() => ({ move: moveId, targets: [target], useMode: MoveUseMode.NORMAL })),
    getTypes: vi.fn(() => []),
  } as unknown as EnemyPokemon;
}

interface BorrowedSceneResult {
  readonly party: Pokemon[];
  readonly playerField: Pokemon[];
  readonly queuedPhases: unknown[];
  readonly requestMoodyOperation: ReturnType<typeof vi.fn>;
}

function installBorrowedScene(
  result: MoodyOperationResult | Promise<MoodyOperationResult> = new Promise<MoodyOperationResult>(() => undefined),
  contingencyResult?: MoodyOperationResult,
  battleType: BattleType = BattleType.TRAINER,
): BorrowedSceneResult {
  const party = [battler(11, 0), battler(22, 1)];
  const playerField = [...party];
  const enemies = [enemyBattler(101, 2, 0), enemyBattler(102, 3, 1, MoveId.GROWL)];
  const queuedPhases: unknown[] = [];
  const heldItem = Object.assign(Object.create(PokemonHeldItemModifier.prototype), {
    pokemonId: enemies[0].id,
    stackCount: 1,
    type: { name: "Leftovers" },
  });
  let requestIndex = 0;
  const requestMoodyOperation = vi.fn(() => {
    const next = requestIndex++ === 0 ? result : contingencyResult;
    return next == null ? new Promise<MoodyOperationResult>(() => undefined) : Promise.resolve(next);
  });
  installCoopPartyReorderPresentationProjector(async scene => {
    const liveParty = scene.getPlayerParty();
    const liveField = scene.getPlayerField();
    liveField.splice(0, liveField.length, ...liveParty.slice(0, liveField.length));
    return liveField.length;
  });
  initGlobalScene({
    currentBattle: {
      waveIndex: 20,
      battleType,
      battleSeed: "borrowed-future-live",
      turn: 1,
      arrangement: { playerCapacity: 2 },
    },
    getField: vi.fn(() => [...playerField, ...enemies]),
    getPlayerField: vi.fn(() => playerField),
    getEnemyField: vi.fn(() => enemies),
    getPlayerParty: vi.fn(() => party),
    getEnemyParty: vi.fn(() => enemies),
    findModifiers: vi.fn(() => [heldItem]),
    tryTransferHeldItemModifier: vi.fn(),
    phaseManager: {
      unshiftPhase: vi.fn((phase: unknown) => queuedPhases.push(phase)),
      shiftPhase: vi.fn(),
    },
    ui: { requestMoodyOperation },
  } as never);
  return { party, playerField, queuedPhases, requestMoodyOperation };
}

function startQueuedOperation(scene: BorrowedSceneResult): MoodyOperationModel {
  expect(scene.queuedPhases).toHaveLength(1);
  (scene.queuedPhases[0] as { start(): void }).start();
  expect(scene.requestMoodyOperation).toHaveBeenCalledOnce();
  return scene.requestMoodyOperation.mock.calls[0][0] as MoodyOperationModel;
}

describe("Moody release blocker: finalized faint ordering", () => {
  afterEach(() => {
    resetMoodyModeState();
    vi.restoreAllMocks();
  });

  it("does not finalize field, formation, or coordinator faint observations for a successful instant revive", () => {
    const target = enemyFaintTarget();
    const revive = {};
    initGlobalScene({
      currentBattle: {
        waveIndex: 70,
        turn: 3,
        arrangement: {
          locate: vi.fn(() => ({ side: 1, position: 0 })),
          ownerOf: vi.fn(() => SideKind.ENEMY),
        },
      },
      getField: vi.fn(() => [undefined, undefined, target]),
      applyModifier: vi.fn(() => revive),
      updateModifiers: vi.fn(),
      phaseManager: { shiftPhase: vi.fn(), unshiftPhase: vi.fn() },
    } as never);
    const finalize = vi.fn();
    const field = vi.spyOn(fieldEngine, "observeMoodyRuntimeFaint").mockReturnValue({
      intervene: () => false,
      finalize,
    });
    const formation = vi.spyOn(formationAdapter, "notifyMoodyFormationFaint").mockReturnValue(undefined);
    const coordinator = vi.spyOn(coordinatorAdapter, "notifyMoodyCoordinatorFinalizedFaint").mockReturnValue(undefined);

    new FaintPhase(BattlerIndex.ENEMY).start();

    expect(field).toHaveBeenCalledOnce();
    expect(finalize).not.toHaveBeenCalled();
    expect(formation).not.toHaveBeenCalled();
    expect(coordinator).not.toHaveBeenCalled();
  });
});

describe("Moody release blocker: Borrowed Future", () => {
  afterEach(() => {
    resetMoodyModeState();
    vi.restoreAllMocks();
  });

  it("keeps committed targets bound to their field slot after a player reorder", () => {
    const first = battler(11, 0);
    const second = battler(22, 1);
    const indices = resolveMoodyCommittedEnemyTargetIndices({ targetBattlerIndices: [0], targetPokemonIds: ["22"] }, [
      first,
      second,
    ]);
    expect(indices).toEqual([0]);
  });

  it("reorders the live player formation, not only the backing party array", async () => {
    restoreBorrowedFuture();
    const scene = installBorrowedScene({
      action: "confirm",
      selectedIds: [],
      orderedIds: ["22", "11"],
    });
    prepareMoodyCoordinatorEnemyActionCommitments();
    startQueuedOperation(scene);

    await vi.waitFor(() => expect(scene.party.map(pokemon => pokemon.id)).toEqual([22, 11]));
    expect(scene.playerField.map(pokemon => pokemon.id)).toEqual([22, 11]);
  });

  it("reveals every active enemy lead in doubles", () => {
    restoreBorrowedFuture();
    const scene = installBorrowedScene();
    prepareMoodyCoordinatorEnemyActionCommitments();
    const model = startQueuedOperation(scene);
    expect(model.committedActions).toHaveLength(2);
    expect(model.leadCount).toBe(2);
  });

  it("does not interrupt wild battles", () => {
    restoreBorrowedFuture();
    const scene = installBorrowedScene(new Promise<MoodyOperationResult>(() => undefined), undefined, BattleType.WILD);
    prepareMoodyCoordinatorEnemyActionCommitments();
    expect(scene.queuedPhases).toHaveLength(0);
    expect(scene.requestMoodyOperation).not.toHaveBeenCalled();
  });

  it("reveals every active enemy commitment with Parallel Futures", () => {
    restoreBorrowedFuture(3, "parallel-futures");
    const scene = installBorrowedScene();
    prepareMoodyCoordinatorEnemyActionCommitments();
    const model = startQueuedOperation(scene);
    expect(model.committedActions).toHaveLength(2);
  });

  it("includes the lead's moves, abilities, and held items at Rank II", () => {
    restoreBorrowedFuture(2);
    const scene = installBorrowedScene();
    prepareMoodyCoordinatorEnemyActionCommitments();
    const model = startQueuedOperation(scene);
    expect(model.detailLines?.some(line => line.startsWith("MOVES:") && !line.endsWith("None"))).toBe(true);
    expect(model.detailLines?.some(line => line.startsWith("ABILITIES:") && !line.endsWith("None"))).toBe(true);
    expect(model.detailLines?.some(line => line.startsWith("ITEMS:") && !line.endsWith("None"))).toBe(true);
  });

  it("executes one selected move-or-item change with Contingency Plan", async () => {
    restoreBorrowedFuture(3, "contingency-plan");
    const scene = installBorrowedScene(
      { action: "confirm", selectedIds: [], orderedIds: ["22", "11"] },
      { action: "confirm", selectedIds: ["move:22:1"], orderedIds: [] },
    );
    prepareMoodyCoordinatorEnemyActionCommitments();
    startQueuedOperation(scene);

    await vi.waitFor(() => expect(scene.requestMoodyOperation).toHaveBeenCalledTimes(2));
    const contingency = scene.requestMoodyOperation.mock.calls[1][0] as MoodyOperationModel;
    expect(contingency.title).toBe("CONTINGENCY PLAN");
    expect(contingency.options.length).toBeGreaterThan(0);
    expect(scene.party[0].moveset[0].moveId).toBe(MoveId.GROWL);
  });
});

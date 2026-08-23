import { initGlobalScene } from "#app/global-scene";
import { SideKind } from "#data/battle-format";
import * as formationAdapter from "#data/elite-redux/moody/moody-formation-game-adapter";
import * as fieldEngine from "#data/elite-redux/moody/moody-runtime-field-engine";
import * as coordinatorAdapter from "#data/elite-redux/moody/moody-runtime-game-adapter";
import { createMoodyModeState, resetMoodyModeState, restoreMoodyModeState } from "#data/elite-redux/moody/moody-state";
import { BattlerIndex } from "#enums/battler-index";
import type { Pokemon } from "#field/pokemon";
import { FaintPhase } from "#phases/faint-phase";
import { afterEach, describe, expect, it, vi } from "vitest";

function enemyPokemon(): Pokemon {
  return {
    id: 901,
    getTag: vi.fn(() => undefined),
    isPlayer: vi.fn(() => false),
    loseHeldItem: vi.fn(),
    resetSummonData: vi.fn(),
  } as unknown as Pokemon;
}

function sceneWith(target: Pokemon, instantRevive: object | null) {
  return {
    currentBattle: {
      waveIndex: 70,
      turn: 3,
      arrangement: {
        locate: vi.fn(() => ({ side: 1, position: 0 })),
        ownerOf: vi.fn(() => SideKind.ENEMY),
      },
    },
    getField: vi.fn(() => [undefined, undefined, target]),
    applyModifier: vi.fn(() => instantRevive),
    updateModifiers: vi.fn(),
    phaseManager: {
      shiftPhase: vi.fn(),
      unshiftPhase: vi.fn(),
    },
  };
}

describe("Moody finalized enemy defeat lifecycle", () => {
  afterEach(() => {
    resetMoodyModeState();
    vi.restoreAllMocks();
  });

  it("does not emit enemy-defeated effects when an instant revive succeeds", () => {
    const target = enemyPokemon();
    const revive = {};
    const scene = sceneWith(target, revive);
    initGlobalScene(scene as never);
    const finalizeField = vi.fn();
    vi.spyOn(fieldEngine, "observeMoodyRuntimeFaint").mockReturnValue({
      intervene: () => false,
      finalize: finalizeField,
    });
    const finalizeFormation = vi.spyOn(formationAdapter, "notifyMoodyFormationFaint").mockReturnValue(undefined);
    vi.spyOn(coordinatorAdapter, "notifyMoodyCoordinatorFaint").mockReturnValue(false);
    const finalized = vi.spyOn(coordinatorAdapter, "notifyMoodyCoordinatorFinalizedFaint");

    new FaintPhase(BattlerIndex.ENEMY).start();

    expect(scene.applyModifier).toHaveBeenCalledOnce();
    expect(target.loseHeldItem).toHaveBeenCalledWith(revive);
    expect(finalizeField).not.toHaveBeenCalled();
    expect(finalizeFormation).not.toHaveBeenCalled();
    expect(finalized).not.toHaveBeenCalled();
    expect(scene.phaseManager.shiftPhase).toHaveBeenCalledOnce();
  });

  it("offers Apex Plunder exactly when a segmented boss defeat is finalized", () => {
    const state = createMoodyModeState("apex-finalized-defeat");
    state.boons.push({
      instanceId: "apex-plunder:test",
      boonId: "apex-plunder",
      rank: 1,
      acquiredAtWave: 10,
    });
    expect(restoreMoodyModeState(state)).toBe(true);
    const target = {
      id: 902,
      bossSegments: 2,
      getTypes: vi.fn(() => []),
      isBoss: vi.fn(() => true),
      isFainted: vi.fn(() => true),
      isPlayer: vi.fn(() => false),
    } as unknown as Pokemon;
    const scene = {
      ...sceneWith(target, null),
      addMoney: vi.fn(),
      getEnemyParty: vi.fn(() => [target]),
      getPlayerParty: vi.fn(() => []),
    };
    initGlobalScene(scene as never);

    coordinatorAdapter.notifyMoodyCoordinatorEnemyDefeated(target);

    expect(scene.phaseManager.unshiftPhase).toHaveBeenCalledOnce();
    expect(scene.phaseManager.unshiftPhase.mock.calls[0][0]).toMatchObject({
      phaseName: "MoodyCoordinatorPokemonChoicePhase",
    });
  });
});

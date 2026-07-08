/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// #863(b) - the co-op #862 "drop the phantom ME" recovery must ALSO tear down the ME intro visuals.
//
// Live report (tester gtgeli, build mrbfz16x, wave 29): "I received Delibird event, partner had a
// battle". The authoritative GUEST self-rolled a phantom ME (its per-client pity diverged) while the
// HOST rolled a normal battle. MysteryEncounterPhase drops the phantom (mysteryEncounter=undefined,
// battleType=WILD, TurnInitPhase) - but EncounterPhase had ALREADY rendered the ME's intro visuals (the
// Delibird sprite), which lingered OVER the recovered battle.
//
// FIX (#863b): the drop branch reuses the SAME idempotent teardown the normal leave path uses
// (transitionMysteryEncounterIntroVisuals), fired BEFORE the encounter is nulled + fully guarded so the
// cosmetic cleanup can never throw or hang the recovery. Because the recovery nulls the encounter
// synchronously, the teardown's tween onComplete (which runs ~750ms later live) is null-guarded in
// encounter-phase-utils so it cannot crash.
//
//   ER_SCENARIO=1 npx vitest run test/tests/elite-redux/coop/coop-me-phantom-drop.test.ts
// =============================================================================

import { globalScene } from "#app/global-scene";
import { COOP_WAVE_NO_ME } from "#data/elite-redux/coop/coop-battle-stream";
import * as coopRuntime from "#data/elite-redux/coop/coop-runtime";
import { BattleType } from "#enums/battle-type";
import { SpeciesId } from "#enums/species-id";
import * as encounterPhaseUtils from "#mystery-encounters/encounter-phase-utils";
import { MysteryEncounterPhase } from "#phases/mystery-encounter-phases";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

describe.skipIf(!RUN)("coop #863(b) - phantom-ME drop tears down the ME intro visuals", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
    game.override.battleStyle("single").enemySpecies(SpeciesId.MAGIKARP).enemyLevel(5).startingLevel(20);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ---------------------------------------------------------------------------
  // A. The GUARD: the shared teardown is null-safe when the encounter is dropped BEFORE the tween
  //    completes (the live async timing). FAILS-BEFORE: the tween onComplete deref'd a nulled
  //    currentBattle.mysteryEncounter and threw ("Cannot set properties of undefined").
  // ---------------------------------------------------------------------------
  it("transitionMysteryEncounterIntroVisuals is null-safe if the encounter is dropped before the tween finishes", async () => {
    await game.classicMode.startBattle(SpeciesId.MAGIKARP);
    vi.spyOn(globalScene, "getEnemyField").mockReturnValue([]);

    const introVisuals = globalScene.add.container(0, 0);
    globalScene.currentBattle.mysteryEncounter = { introVisuals } as never;

    // Defer the tween onComplete so we can null the encounter BEFORE it runs (reproduces the live ~750ms
    // tween window; the headless mock otherwise fires onComplete synchronously inside tweens.add).
    let captured: (() => void) | undefined;
    const tweens = globalScene.tweens as unknown as { add: (data: { onComplete?: () => void }) => void };
    const realAdd = tweens.add;
    tweens.add = (data: { onComplete?: () => void }): void => {
      captured = data.onComplete;
    };
    const done = encounterPhaseUtils.transitionMysteryEncounterIntroVisuals();
    tweens.add = realAdd;

    // The #862 recovery drops the encounter WHILE the ease-out tween is still in flight.
    globalScene.currentBattle.mysteryEncounter = undefined;

    // The tween now completes: the guarded onComplete MUST NOT throw (pre-fix it deref'd the nulled encounter).
    expect(() => captured?.()).not.toThrow();
    await expect(done).resolves.toBe(true);
  }, 120_000);

  // ---------------------------------------------------------------------------
  // B. The BRANCH: the authoritative-guest phantom-ME drop REUSES the teardown and still completes the
  //    WILD recovery (encounter dropped, battleType WILD, TurnInitPhase queued), without throwing.
  // ---------------------------------------------------------------------------
  it("the #862 phantom-ME drop invokes the intro-visual teardown + completes the WILD recovery", async () => {
    await game.classicMode.startBattle(SpeciesId.MAGIKARP);
    const wave = globalScene.currentBattle.waveIndex;

    globalScene.currentBattle.mysteryEncounter = { introVisuals: globalScene.add.container(0, 0) } as never;

    // Force the authoritative-guest phantom condition: guest self-rolled an ME, host verdict = NO ME.
    vi.spyOn(coopRuntime, "isCoopAuthoritativeGuest").mockReturnValue(true);
    vi.spyOn(coopRuntime, "getCoopBattleStreamer").mockReturnValue({
      meTypeForWave: (w: number) => (w === wave ? COOP_WAVE_NO_ME : undefined),
    } as never);
    const teardownSpy = vi.spyOn(encounterPhaseUtils, "transitionMysteryEncounterIntroVisuals").mockResolvedValue(true);

    const phase = new MysteryEncounterPhase();
    const unshiftSpy = vi.spyOn(globalScene.phaseManager, "unshiftNew");
    vi.spyOn(phase, "end").mockImplementation(() => {}); // isolate the branch's direct effects (no cascade)

    expect(() => phase.start()).not.toThrow();

    expect(teardownSpy, "the phantom drop reused the intro-visual teardown (#863b)").toHaveBeenCalled();
    expect(globalScene.currentBattle.mysteryEncounter, "the phantom encounter was dropped").toBeUndefined();
    expect(globalScene.currentBattle.battleType, "recovered to a WILD battle").toBe(BattleType.WILD);
    expect(
      unshiftSpy.mock.calls.some(c => c[0] === "TurnInitPhase"),
      "the run PROCEEDS: a normal battle turn was queued",
    ).toBe(true);
  }, 120_000);
});

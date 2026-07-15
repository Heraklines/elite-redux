/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// CO-OP SOAK CATCH LEG (#843/#849 BUILD 1). Drives a SEEDED ball throw -> capture -> dexSync on a
// designated WILD wave of the seeded two-engine soak, and asserts BOTH accounts' dex credit + ball-count
// convergence (the #843 pokeball-drift guard). This closes the `catch` situation / BALL mode / dexSync
// kind+band coverage follow-ups: the default wave/shop soak (coop-soak.test.ts) does NOT configure a catch
// leg, so those surfaces stay declared-undrivable there; THIS test drives them inline via the
// coop-soak-driver `catchWaves` knob and PROVES the surface fires + converges.
//
// The catch is driven with the REAL machinery: the host faints one wild enemy (attacking it while the
// guest SWITCHES, so no move redirect KOs the survivor), then HOST-throws a MASTER_BALL at the lone
// survivor via the real GameManager.doThrowPokeball (the real BALL menu -> AttemptCapturePhase -> capture
// -> broadcastCoopWaveResolved("capture") + the dexSync broadcast). The guest reconciles its party
// (applyCoopCaptureParty), its dex (the dexSync stream), and its ball inventory - the production heals.
//
// HOW TO RUN (gated ER_SCENARIO=1, like every ER engine test):
//   ER_SCENARIO=1 npx vitest run test/tests/elite-redux/coop/coop-soak-catch.test.ts
//   (PowerShell: $env:ER_SCENARIO="1"; npx vitest run <path>)
// =============================================================================

import { initGlobalScene } from "#app/global-scene";
import { setCoopFaintSwitchWaitMs, setCoopWaveBarrierMs } from "#data/elite-redux/coop/coop-interaction-relay";
import { clearCoopRuntime, setCoopDexSyncDelayMs } from "#data/elite-redux/coop/coop-runtime";
import { MoveId } from "#enums/move-id";
import { UiMode } from "#enums/ui-mode";
import { Move } from "#moves/move";
import { GameManager } from "#test/framework/game-manager";
import { installDuoLogCapture } from "#test/tools/coop-duo-harness";
import { COOP_SOAK_SITUATIONS } from "#test/tools/coop-soak-coverage";
import { prepareCoopSoakContent, runCoopSoak, SOAK_PROFILES } from "#test/tools/coop-soak-driver";
import Phaser from "phaser";
import { afterEach, beforeAll, beforeEach, describe, expect, it, type MockInstance, vi } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

/** The wild wave the catch leg drives (a normal, non-boss, non-fixed wild double under the god profile). */
const CATCH_WAVE = 3;
/** A short run: enough to cross the catch wave + a couple of clean waves after it (survey continues green). */
const TOTAL_WAVES = 5;
const SEED = 424242;

describe.skipIf(!RUN)("CO-OP SOAK catch leg: seeded ball throw -> capture -> dexSync (#843/#849 BUILD 1)", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;
  let logs: ReturnType<typeof installDuoLogCapture>;
  let accuracySpy: MockInstance | undefined;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    // FORCE-HIT determinism knob (identical to the main soak): the framework clamps the accuracy roll to
    // its WORST case, so any sub-100 effective accuracy is a guaranteed miss; restore in afterEach.
    accuracySpy = vi.spyOn(Move.prototype, "calculateBattleAccuracy").mockReturnValue(-1);
    setCoopWaveBarrierMs(50);
    setCoopFaintSwitchWaitMs(4000);
    game = new GameManager(phaserGame);
    logs = installDuoLogCapture(`soak-catch-${Date.now()}`);
    // The god profile (level-300 party) so the catch wave is a stable, winnable wild double. The moveset
    // carries a SPREAD move (DAZZLING_GLEAM, hits both foes) because the catch leg's isolation turn MUST use a
    // multi-target move (a single-target move opens SelectTargetPhase, whose target prompt does not fire while
    // the host awaits the partner-slot command relay - see processCatchWave). BODY_SLAM stays as the other
    // damaging slot for the normal (non-catch) waves of this short run.
    const party = SOAK_PROFILES.god;
    game.override
      .battleStyle("double")
      .startingWave(1)
      .startingLevel(party.startingLevel)
      .moveset([MoveId.DAZZLING_GLEAM, MoveId.BODY_SLAM, MoveId.SHADOW_BALL, MoveId.FLAMETHROWER])
      .mysteryEncounterChance(0);
    if (party.heldItems != null) {
      game.override.startingHeldItems([...party.heldItems]);
    }
  });

  afterEach(() => {
    setCoopWaveBarrierMs(60_000);
    setCoopFaintSwitchWaitMs(60_000);
    setCoopDexSyncDelayMs(500); // the driver shortened it for the leg; restore the production default
    accuracySpy?.mockRestore();
    accuracySpy = undefined;
    logs.dispose();
    clearCoopRuntime();
    initGlobalScene(game.scene);
  });

  it("drives a seeded catch on a wild wave: BALL mode + catch situation + dexSync fire, BOTH dexes credited, balls converge", async () => {
    // A FOUR-mon party (not the full six) so the caught mon has room in the party - a full party triggers
    // the party-full CONFIRM/box sub-flow, which is a separate follow-up. Host owns slots 0,2; guest 1,3.
    const sp = SOAK_PROFILES.god.species;
    prepareCoopSoakContent(game, SEED);
    await game.classicMode.startBattle(sp[0], sp[1], sp[2], sp[3]);
    const result = await runCoopSoak(game, {
      seed: SEED,
      waves: TOTAL_WAVES,
      logs,
      profile: "god",
      catchWaves: new Set([CATCH_WAVE]),
      capturePostWaveState: true,
    });

    // eslint-disable-next-line no-console
    console.log(
      `[coop-soak-catch] seed=${SEED} waves=${result.wavesCompleted}/${result.wavesRequested} `
        + `findings=${result.findings.length} skips=${JSON.stringify(result.skips)}`,
    );
    for (const f of result.findings) {
      // eslint-disable-next-line no-console
      console.log(`[coop-soak-catch] FINDING [${f.fields}] @${f.firstWave} :: ${f.sample}`);
    }

    // The catch actually fired (not silently degraded to a normal wave).
    expect(result.skips.catchWaveNotCatchableWildDouble ?? 0, "the catch wave was a catchable wild double").toBe(0);
    expect(result.skips.catchSurvivorNotIsolated ?? 0, "the survivor was isolated for the throw").toBe(0);

    // The surfaces the catch leg exists to light up.
    expect(result.hits.modes.has(UiMode.BALL), "the real BALL menu opened on the host throw").toBe(true);
    expect(result.hits.situations.has(COOP_SOAK_SITUATIONS.catch), "the `catch` situation fired").toBe(true);
    expect(result.hits.kinds.has("dexSync"), "the dexSync relay kind was sent").toBe(true);
    expect(result.hits.bands.has("dexSync"), "the dexSync seq band was hit").toBe(true);

    // THE GUARD: no catch-related finding (both accounts credited + ball counts converged).
    const catchFindings = result.findings.filter(f => f.fields.startsWith("catch"));
    expect(
      catchFindings,
      `catch drive found ${catchFindings.length} defect(s) (replay SEED=${SEED}): `
        + catchFindings.map(f => `[${f.fields}]@${f.firstWave}`).join(", "),
    ).toEqual([]);

    // No unhealed digest desync elsewhere in the surveyed run, and the run surveyed every wave.
    expect(result.findings, "no unhealed findings across the run").toEqual([]);
    expect(result.assertions, "no production checksum assertions tripped").toBe(0);
    expect(result.wavesCompleted, "the run surveyed every requested wave (continued green past the catch)").toBe(
      TOTAL_WAVES,
    );
    expect(
      result.postWaveStates.map(state => state.wave),
      "every boundary was sampled before the next admission",
    ).toEqual([1, 2, 3, 4, 5]);
    const catchBoundary = result.postWaveStates.find(state => state.wave === CATCH_WAVE)?.retainedWaveTransaction;
    expect(catchBoundary?.dataApplied, "wave 3 catch DATA applied before wave 4 could be admitted").toBe(true);
    expect(
      catchBoundary?.continuationReady,
      "wave 3 catch reward surface released its retained continuation before wave 4 could be admitted",
    ).toBe(true);
    const wave4Boundary = result.postWaveStates.find(state => state.wave === CATCH_WAVE + 1)?.retainedWaveTransaction;
    expect(wave4Boundary?.dataApplied, "wave 4 admitted a distinct retained transaction").toBe(true);
    expect(wave4Boundary?.continuationReady, "wave 4 continuation also released without ambiguity").toBe(true);

    logs.flush();
  }, 600_000);
});

/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// CO-OP SOAK LEARN-MOVE LEG (#848/#849 BUILD 2). Drives a level-up move-learn that ACCEPTS + forces a
// forget across BOTH engines (instead of the default decline) in the seeded two-engine soak, and asserts
// moveset convergence. This closes the `levelUpLearn` situation / LEARN_MOVE_BATCH mode / learnMoveBatch(+
// Forward) kind + learnMoveBatchFwd band coverage follow-ups: the default wave/shop soak declines level-up
// learns, so those surfaces stay declared-undrivable there; THIS test drives them inline via the
// coop-soak-driver `learnMoveWaves` knob and PROVES the surface fires + the moveset converges.
//
// The learn is driven with the REAL machinery (coop-duo-learn-move.ts's guest-owned case, folded into the
// continuous run): the host forces the real ER LearnMoveBatchPhase on a full-moveset GUEST-owned mon (opening
// the read-only WATCHER panel), the guest opens the OWNER panel + picks the replacement (accept, forget slot
// 0), and the host applies the guest's pick authoritatively - the #848 shared batch-panel path.
//
// HOW TO RUN (gated ER_SCENARIO=1, like every ER engine test):
//   ER_SCENARIO=1 npx vitest run test/tests/elite-redux/coop/coop-soak-learn-move.test.ts
// =============================================================================

import { initGlobalScene } from "#app/global-scene";
import { setCoopFaintSwitchWaitMs, setCoopWaveBarrierMs } from "#data/elite-redux/coop/coop-interaction-relay";
import { clearCoopRuntime } from "#data/elite-redux/coop/coop-runtime";
import { PokemonMove } from "#data/moves/pokemon-move";
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

/** The wave the learn-move leg drives (a normal, non-boss, non-fixed wild double under the god profile). */
const LEARN_WAVE = 3;
const TOTAL_WAVES = 5;
const SEED = 515151;
/**
 * A RAW 4-move moveset (NOT via override, which would mask the learn's setMove) - none is WATER_GUN.
 * The seeded host pick on the learn wave is slot 2; keep that move spread-targeted so this specialized
 * interaction test does not depend on the one-process harness's unrelated deferred target prompt.
 */
const RAW_MOVESET = [MoveId.BODY_SLAM, MoveId.SHADOW_BALL, MoveId.DAZZLING_GLEAM, MoveId.THUNDERBOLT];

describe.skipIf(!RUN)("CO-OP SOAK learn-move leg: accept-with-forget across two engines (#848/#849 BUILD 2)", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;
  let logs: ReturnType<typeof installDuoLogCapture>;
  let accuracySpy: MockInstance | undefined;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    accuracySpy = vi.spyOn(Move.prototype, "calculateBattleAccuracy").mockReturnValue(-1);
    setCoopWaveBarrierMs(50);
    setCoopFaintSwitchWaitMs(4000);
    game = new GameManager(phaserGame);
    logs = installDuoLogCapture(`soak-learn-${Date.now()}`);
    const party = SOAK_PROFILES.god;
    // NB: NO .moveset() override on purpose - a MOVESET_OVERRIDE makes getMoveset() ALWAYS return the
    // override, masking the setMove() the learn applies. The RAW moveset is set on each mon below instead.
    game.override.battleStyle("double").startingWave(1).startingLevel(party.startingLevel).mysteryEncounterChance(0);
    if (party.heldItems != null) {
      game.override.startingHeldItems([...party.heldItems]);
    }
  });

  afterEach(() => {
    setCoopWaveBarrierMs(60_000);
    setCoopFaintSwitchWaitMs(60_000);
    accuracySpy?.mockRestore();
    accuracySpy = undefined;
    logs.dispose();
    clearCoopRuntime();
    initGlobalScene(game.scene);
  });

  it("drives a level-up learn (accept + forget) on a guest-owned mon: LEARN_MOVE_BATCH + learnMoveBatch fire, moveset converges", async () => {
    prepareCoopSoakContent(game, SEED);
    await game.classicMode.startBattle(...SOAK_PROFILES.god.species);
    // Set a RAW full 4-move moveset on every party mon (host side) so the learn's setMove is visible AND
    // combat has damaging moves. buildDuo (inside runCoopSoak) mirrors the host party onto the guest.
    for (const mon of game.scene.getPlayerParty()) {
      mon.moveset = RAW_MOVESET.map(id => new PokemonMove(id));
      if (mon.summonData?.moveset) {
        mon.summonData.moveset = RAW_MOVESET.map(id => new PokemonMove(id));
      }
    }

    const result = await runCoopSoak(game, {
      seed: SEED,
      waves: TOTAL_WAVES,
      logs,
      profile: "god",
      learnMoveWaves: new Set([LEARN_WAVE]),
    });

    // eslint-disable-next-line no-console
    console.log(
      `[coop-soak-learn] seed=${SEED} waves=${result.wavesCompleted}/${result.wavesRequested} `
        + `findings=${result.findings.length} skips=${JSON.stringify(result.skips)}`,
    );
    for (const f of result.findings) {
      // eslint-disable-next-line no-console
      console.log(`[coop-soak-learn] FINDING [${f.fields}] @${f.firstWave} :: ${f.sample}`);
    }

    // The learn actually fired (not degraded to a normal wave).
    expect(result.skips.learnMoveTargetNotEligible ?? 0, "the learn-move target was an eligible guest mon").toBe(0);

    // The surfaces the learn-move leg exists to light up.
    expect(result.hits.modes.has(UiMode.LEARN_MOVE_BATCH), "the batch Move Learn panel opened").toBe(true);
    expect(result.hits.situations.has(COOP_SOAK_SITUATIONS.levelUpLearn), "the `levelUpLearn` situation fired").toBe(
      true,
    );
    expect(
      result.hits.kinds.has("learnMoveBatch") || result.hits.kinds.has("learnMoveBatchForward"),
      "a learnMoveBatch relay kind was sent",
    ).toBe(true);
    expect(result.hits.bands.has("learnMoveBatchFwd"), "the learnMoveBatchFwd seq band was hit").toBe(true);

    // THE GUARD: no learn-related finding (moveset converged on both engines, no picker strand).
    const learnFindings = result.findings.filter(f => f.fields.startsWith("learnMove"));
    expect(
      learnFindings,
      `learn-move drive found ${learnFindings.length} defect(s) (replay SEED=${SEED}): `
        + learnFindings.map(f => `[${f.fields}]@${f.firstWave}`).join(", "),
    ).toEqual([]);

    // No unhealed digest desync elsewhere, and the run surveyed every wave (continued green past the learn).
    expect(result.findings, "no unhealed findings across the run").toEqual([]);
    expect(result.assertions, "no production checksum assertions tripped").toBe(0);
    expect(result.wavesCompleted, "the run surveyed every requested wave").toBe(TOTAL_WAVES);

    logs.flush();
  }, 600_000);
});

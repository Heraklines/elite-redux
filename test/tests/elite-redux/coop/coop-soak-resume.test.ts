/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// CO-OP SOAK SAVE-RESUME LEG (#807/#810/#849 BUILD 3). Serializes the host's live session mid-soak, reboots
// the GUEST from the snapshot (the #807/#810 coopGuestResumeBoot core, applyCoopLaunchSession), and asserts
// FULL byte-equal parity at boot - then proves the run CONTINUES GREEN for the remaining waves. This closes
// the `saveResume` situation follow-up: the default soak is a single continuous process (no save/resume), so
// the surface stays declared-undrivable there; THIS test drives it inline via the coop-soak-driver
// `resumeWaves` knob and PROVES the surface fires + the guest converges + the run continues.
//
// HOW TO RUN (gated ER_SCENARIO=1, like every ER engine test):
//   ER_SCENARIO=1 npx vitest run test/tests/elite-redux/coop/coop-soak-resume.test.ts
// =============================================================================

import { initGlobalScene } from "#app/global-scene";
import { setCoopFaintSwitchWaitMs, setCoopWaveBarrierMs } from "#data/elite-redux/coop/coop-interaction-relay";
import { clearCoopRuntime } from "#data/elite-redux/coop/coop-runtime";
import { Move } from "#moves/move";
import { GameManager } from "#test/framework/game-manager";
import { installDuoLogCapture } from "#test/tools/coop-duo-harness";
import { COOP_SOAK_SITUATIONS } from "#test/tools/coop-soak-coverage";
import { runCoopSoak, SOAK_PROFILES } from "#test/tools/coop-soak-driver";
import Phaser from "phaser";
import { afterEach, beforeAll, beforeEach, describe, expect, it, type MockInstance, vi } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

/** The wave the resume round-trip happens on (>=2 waves remain after it, so the run proves a green continuation). */
const RESUME_WAVE = 2;
const TOTAL_WAVES = 5;
const SEED = 606060;

describe.skipIf(!RUN)(
  "CO-OP SOAK save-resume leg: reboot guest from host snapshot + converge (#807/#810/#849 BUILD 3)",
  () => {
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
      logs = installDuoLogCapture(`soak-resume-${Date.now()}`);
      const party = SOAK_PROFILES.god;
      game.override
        .battleStyle("double")
        .startingWave(1)
        .startingLevel(party.startingLevel)
        .moveset([...party.moveset])
        .mysteryEncounterChance(0);
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

    it("serializes at a mid-soak wave, reboots the guest from the snapshot, converges byte-equal, and continues green", async () => {
      await game.classicMode.startBattle(...SOAK_PROFILES.god.species);
      const result = await runCoopSoak(game, {
        seed: SEED,
        waves: TOTAL_WAVES,
        logs,
        profile: "god",
        resumeWaves: new Set([RESUME_WAVE]),
      });

      // eslint-disable-next-line no-console
      console.log(
        `[coop-soak-resume] seed=${SEED} waves=${result.wavesCompleted}/${result.wavesRequested} `
          + `findings=${result.findings.length} skips=${JSON.stringify(result.skips)}`,
      );
      for (const f of result.findings) {
        // eslint-disable-next-line no-console
        console.log(`[coop-soak-resume] FINDING [${f.fields}] @${f.firstWave} :: ${f.sample}`);
      }

      // The surface the resume leg exists to light up.
      expect(result.hits.situations.has(COOP_SOAK_SITUATIONS.saveResume), "the `saveResume` situation fired").toBe(
        true,
      );

      // THE GUARD: no resume-related finding (the guest booted + converged byte-equal to the host).
      const resumeFindings = result.findings.filter(f => f.fields.startsWith("resume"));
      expect(
        resumeFindings,
        `resume drive found ${resumeFindings.length} defect(s) (replay SEED=${SEED}): `
          + resumeFindings.map(f => `[${f.fields}]@${f.firstWave}`).join(", "),
      ).toEqual([]);

      // No unhealed digest desync elsewhere, and the run surveyed every wave (continued green >=2 waves after
      // the resume at wave RESUME_WAVE).
      expect(result.findings, "no unhealed findings across the run").toEqual([]);
      expect(result.assertions, "no production checksum assertions tripped").toBe(0);
      expect(result.wavesCompleted, "the run continued green through every requested wave after the resume").toBe(
        TOTAL_WAVES,
      );
      expect(TOTAL_WAVES - RESUME_WAVE, "at least 2 waves surveyed AFTER the resume").toBeGreaterThanOrEqual(2);

      logs.flush();
    }, 600_000);
  },
);

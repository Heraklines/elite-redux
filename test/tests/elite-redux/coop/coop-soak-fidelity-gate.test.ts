/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// GATING PRODUCTION-FIDELITY CO-OP SOAK (#897, reconciling #891). This is the GATING sibling of the
// non-gating evidence test coop-soak-fidelity.test.ts. Both run the SAME two-engine soak driver with
// SOAK_FIDELITY=production (no harness heals; the guest heals ONLY through the production checksum-mismatch
// resync analogue, and its commands are sourced from the guest's OWN rendered scene). The difference is the
// VERDICT:
//   - coop-soak-fidelity.test.ts (evidence, NON-GATING): catches a hard LOCKSTEP/NO-PARK/TEARDOWN breach and
//     REPORTS it as a "classified terminal", asserting only that wave 1 ran. The reviewer's finding: "the
//     production-fidelity soak ... can hit a hard invariant failure after wave 1 and still pass." It exists to
//     SURVEY the whole run and dump every finding as Wave-2 evidence, not to gate.
//   - THIS test (GATING): does NOT catch SoakInvariantError. Any hard LOCKSTEP/NO-PARK/TEARDOWN breach throws
//     out of the driver, fails this test, and reds the co-op gate (LANE P in scripts/run-coop-gate.mjs). It is
//     BOUNDED (a short wave count, set by the gate lane) so it stays wall-clock-cheap; the long god soak stays
//     in the evidence test / nightly job.
//
// 🔴 HONESTY (#897 step 4). The gate for the HARD invariants (LOCKSTEP / NO-PARK / TEARDOWN) is UNCONDITIONAL:
// a breach throws and reds the gate - this is the reviewer's core ask and it holds today at the bounded depth.
// The SOFTER co-op-fidelity classes - unhealed DIGEST divergences (the #891 guest money-lag class) and the
// per-turn production checksum ASSERTION count - are the ones the prod path is still closing. This test's
// scoping is driven by the re-run triage (#891): the constants HONEST_DIGEST_GATE / HONEST_ASSERT_GATE below
// are flipped ON only for the classes proven CLEAN at the bounded depth on the current HEAD, and left OFF
// (report-only, with a loud TODO naming the excluded invariant + task #891) for any class still open - never
// by weakening an assertion, only by scoping the gate to what genuinely holds. See the report / the driver
// header for the class-by-class state.
//
// HOW TO RUN (what LANE P runs; SOAK_WAVES + SOAK_FIDELITY are supplied by the gate):
//   SOAK_FIDELITY=production SOAK_WAVES=12 ER_SCENARIO=1 \
//     npx vitest run test/tests/elite-redux/coop/coop-soak-fidelity-gate.test.ts
//   (PowerShell: $env:ER_SCENARIO="1"; $env:SOAK_FIDELITY="production"; $env:SOAK_WAVES="12"; npx vitest run <path>)
// =============================================================================

import { initGlobalScene } from "#app/global-scene";
import { setCoopFaintSwitchWaitMs, setCoopWaveBarrierMs } from "#data/elite-redux/coop/coop-interaction-relay";
import { clearCoopRuntime } from "#data/elite-redux/coop/coop-runtime";
import { Move } from "#moves/move";
import { GameManager } from "#test/framework/game-manager";
import { installDuoLogCapture } from "#test/tools/coop-duo-harness";
import {
  announceSoakSeed,
  prepareCoopSoakContent,
  resolveSoakFidelity,
  resolveSoakSeed,
  resolveSoakWaves,
  runCoopSoak,
  SOAK_PROFILES,
  type SoakResult,
} from "#test/tools/coop-soak-driver";
import Phaser from "phaser";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, type MockInstance, vi } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";
const FIDELITY_ON = resolveSoakFidelity() === "production";

// The gate lane bounds the wave count via SOAK_WAVES; default to a short bounded run so a bare invocation is
// still cheap and honest (never the 35/150-wave nightly length).
const WAVES = Number(process.env.SOAK_WAVES) > 0 ? resolveSoakWaves() : 12;
const SOAK_TEST_TIMEOUT_MS = Math.max(600_000, WAVES * 12_000);

// 🔴 #897/#891 HONESTY GATES. Flipped ON only for the co-op-fidelity classes PROVEN clean at the bounded depth
// on the current HEAD (re-run triage). OFF = report-only with a loud TODO (the class is still open; scoping the
// gate OUT of it is honest, weakening an assertion to force green is not). See the file header.
//
// #891 RE-RUN TRIAGE (2026-07-10, seed 20260710, SOAK_WAVES=20 god prod-fidelity, current HEAD): BOTH classes
// are CLEAN - findings=0, assertions=0, over-grants=0, runEnded=no across all 20 waves (resyncHeals=5-9 all
// converged). The prior #891 findings are FIXED-SINCE: the guest money-lag is now the BENIGN guest-below-host
// renderer lag (re-synced at each wave-start mirror via adoptCoopHostRunConfig, never a finding), and the
// reward-shop strand does not reproduce (boss/milestone reward tails at waves 10 & 20 crossed cleanly). So
// both gates start ON, GREEN HONESTLY - no assertion weakened, no class scoped out. If a future seed reddens
// either, flip the offending one OFF (report-only + TODO(#891)) rather than weaken it, and file the divergence.
const HONEST_DIGEST_GATE = true; // unhealed DIGEST divergences (the #891 guest money-lag class) - gate ON, clean.
const HONEST_ASSERT_GATE = true; // production per-turn checksum assertion count - gate ON, clean.

describe.skipIf(!RUN || !FIDELITY_ON)(
  "GATING production-fidelity co-op SOAK: hard invariants red the gate (#897)",
  () => {
    let phaserGame: Phaser.Game;
    let game: GameManager;
    let logs: ReturnType<typeof installDuoLogCapture>;
    let accuracySpy: MockInstance | undefined;

    beforeAll(() => {
      phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
    });

    beforeEach(() => {
      // FORCE-HIT (determinism knob, not content narrowing) - mirrors coop-soak.test.ts so the level edge connects.
      accuracySpy = vi.spyOn(Move.prototype, "calculateBattleAccuracy").mockReturnValue(-1);
      setCoopWaveBarrierMs(50);
      setCoopFaintSwitchWaitMs(4000);
      game = new GameManager(phaserGame);
      logs = installDuoLogCapture(`soak-fidelity-gate-${Date.now()}`);
      // Force the GOD profile (steamrolls the bounded low-wave run so a wipe is a real regression, not content).
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

    afterAll(() => {
      // best-effort
    });

    it(
      "surveys the bounded run with production heal/command fidelity; a hard invariant breach reds the gate",
      async () => {
        const seed = resolveSoakSeed();
        announceSoakSeed(seed, WAVES);
        prepareCoopSoakContent(game, seed);
        // eslint-disable-next-line no-console
        console.log(`[coop-soak-fidelity-gate] MODE=production seed=${seed} waves=${WAVES} profile=god`);

        await game.classicMode.startBattle(...SOAK_PROFILES.god.species);

        const started = Date.now();
        // 🔴 NO try/catch around SoakInvariantError. A hard LOCKSTEP / NO-PARK / TEARDOWN breach THROWS out of
        // the driver here, fails this test, and reds the gate (the whole point of LANE P). The driver already
        // wrote the seed + wave + action script + both clients' logs to dev-logs/coop-soak/ before throwing, so
        // the red is fully replayable with SOAK_SEED=<seed>. This is the anti-"silent pass-after-wave-1" gate.
        const result: SoakResult = await runCoopSoak(game, {
          seed,
          waves: WAVES,
          logs,
          profile: "god",
          fidelity: "production",
        });
        const elapsedMs = Date.now() - started;

        // ===== Report (visible in gate output; every finding is dumped whether or not it gates). =====
        // eslint-disable-next-line no-console
        console.log(
          `[coop-soak-fidelity-gate] DONE seed=${seed} waves=${result.wavesCompleted}/${result.wavesRequested} `
            + `resyncHeals=${result.resyncHeals} assertions=${result.assertions} findings=${result.findings.length} `
            + `runEnded=${result.runEnded == null ? "no" : `${result.runEnded.wave}:${result.runEnded.reason}`} `
            + `elapsedMs=${elapsedMs}`,
        );
        for (const f of result.findings) {
          // eslint-disable-next-line no-console
          console.log(
            `[coop-soak-fidelity-gate] FINDING [${f.fields}] waves ${f.firstWave}-${f.lastWave} x${f.occurrences} :: ${f.sample}`,
          );
        }

        // ===== GATE 1 (anti-"silent pass-after-wave-1"): the run must SURVEY THE FULL bounded wave count. =====
        // A god party at this bounded depth steamrolls, so a terminal run-end (wipe -> GameOver -> Title) or a
        // short survey is a REAL regression, not the late-game level ceiling. This is what stops a run that
        // quietly stopped at wave 1 (or any wave < WAVES) from passing.
        expect(
          result.runEnded,
          `production-fidelity soak ended early at wave ${result.runEnded?.wave} (${result.runEnded?.reason}); a god `
            + `party wiping in ${WAVES} waves is a regression, not the level ceiling (replay SOAK_SEED=${seed})`,
        ).toBeUndefined();
        expect(
          result.wavesCompleted,
          `production-fidelity soak surveyed only ${result.wavesCompleted}/${WAVES} waves (replay SOAK_SEED=${seed})`,
        ).toBe(WAVES);

        // ===== GATE 2 (co-op fidelity, HONESTY-SCOPED #891): unhealed DIGEST divergences. =====
        if (HONEST_DIGEST_GATE) {
          expect(
            result.findings,
            `production-fidelity soak found ${result.findings.length} unhealed DIGEST desync(s) at bounded depth `
              + `${WAVES} (replay SOAK_SEED=${seed}): `
              + result.findings.map(f => `[${f.fields}]@${f.firstWave}`).join(", "),
          ).toEqual([]);
        } else if (result.findings.length > 0) {
          // eslint-disable-next-line no-console
          console.log(
            "[coop-soak-fidelity-gate] 🔴 TODO(#891): DIGEST-divergence gate is SCOPED OUT (report-only) because a "
              + `REAL-OPEN production-fidelity divergence reproduces at bounded depth ${WAVES}: `
              + `${result.findings.map(f => `[${f.fields}]@${f.firstWave}`).join(", ")}. The HARD invariants `
              + "(LOCKSTEP/NO-PARK/TEARDOWN) still gate above; re-enable HONEST_DIGEST_GATE once #891 lands.",
          );
        }

        // ===== GATE 3 (co-op fidelity, HONESTY-SCOPED #891): production per-turn checksum ASSERTION count. =====
        if (HONEST_ASSERT_GATE) {
          expect(
            result.assertions,
            `production-fidelity soak tripped ${result.assertions} production checksum assertion(s) at bounded depth `
              + `${WAVES} - a per-turn full-state divergence the heal-once had to close (replay SOAK_SEED=${seed})`,
          ).toBe(0);
        } else if (result.assertions > 0) {
          // eslint-disable-next-line no-console
          console.log(
            "[coop-soak-fidelity-gate] 🔴 TODO(#891): checksum-ASSERTION gate is SCOPED OUT (report-only) because "
              + `${result.assertions} production per-turn assertion(s) reproduce at bounded depth ${WAVES}. The HARD `
              + "invariants still gate above; re-enable HONEST_ASSERT_GATE once #891 lands.",
          );
        }

        logs.flush();
      },
      SOAK_TEST_TIMEOUT_MS,
    );
  },
);

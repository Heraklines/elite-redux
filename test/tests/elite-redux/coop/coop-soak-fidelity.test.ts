/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// PRODUCTION-FIDELITY CO-OP SOAK (#879 review item 5). The standing soak (coop-soak.test.ts) heals the guest
// through convenient HARNESS seams the live client never takes - it re-mirrors the WHOLE guest (player party
// included) from the host every wave AND runs healGuestFromHost, and the guest's command answerer reads the
// HOST's authoritative guest-slot mon. Those seams keep the soak fast + green, but they MASK the exact class
// of bug live co-op still hits: a guest whose replayed state has DRIFTED is silently reset (or borrows the
// host's move) instead of failing loudly.
//
// This test runs the SAME two-engine soak driver with SOAK_FIDELITY=production, which:
//   (i)  heals the guest ONLY through production triggers - no per-wave player re-mirror / healGuestFromHost;
//        a heal happens only when a checksum MISMATCH fires the resync analogue (the stateSync heal). The
//        per-wave mirror still adopts the host-AUTHORITATIVE enemies / arena / run-config (a live guest adopts
//        those through its own EncounterPhase too), but PRESERVES the guest's own replayed player party.
//   (ii) selects the guest command from the GUEST's OWN rendered scene (its party / moveset / PP / enemies),
//        so a guest too stale to construct a real player's command desyncs/fails LOUDLY.
//
// EXPECT FINDINGS. This mode exists to SURFACE the fidelity gaps as evidence, not to be green - so unlike the
// standing soak this test does NOT assert findings === []. It runs the run, CLASSIFIES + REPORTS every digest
// finding (with field fingerprints), every production checksum assertion, and any hard invariant terminal
// (LOCKSTEP / NO-PARK / TEARDOWN), and asserts only that the machine RAN. The findings are Wave-2 evidence;
// production code is NOT fixed here.
//
// GATED DEFAULT-OFF: skipped unless SOAK_FIDELITY=production, so the standing coop-dir gate is unaffected.
//
// HOW TO RUN (35-wave god profile, the review target):
//   SOAK_FIDELITY=production SOAK_PROFILE=god SOAK_WAVES=35 ER_SCENARIO=1 \
//     npx vitest run test/tests/elite-redux/coop/coop-soak-fidelity.test.ts
//   (PowerShell: $env:ER_SCENARIO="1"; $env:SOAK_FIDELITY="production"; $env:SOAK_WAVES="35"; npx vitest run <path>)
// =============================================================================

import { initGlobalScene } from "#app/global-scene";
import { setCoopFaintSwitchWaitMs, setCoopWaveBarrierMs } from "#data/elite-redux/coop/coop-interaction-relay";
import { clearCoopRuntime } from "#data/elite-redux/coop/coop-runtime";
import { Move } from "#moves/move";
import { GameManager } from "#test/framework/game-manager";
import { installDuoLogCapture } from "#test/tools/coop-duo-harness";
import {
  announceSoakSeed,
  resolveSoakFidelity,
  resolveSoakSeed,
  resolveSoakWaves,
  runCoopSoak,
  SOAK_PROFILES,
  SoakInvariantError,
  type SoakResult,
} from "#test/tools/coop-soak-driver";
import Phaser from "phaser";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, type MockInstance, vi } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";
const FIDELITY_ON = resolveSoakFidelity() === "production";

// Default the god profile + a 35-wave run (the review target) when the env is unset; SOAK_WAVES still overrides.
const WAVES = Number(process.env.SOAK_WAVES) > 0 ? resolveSoakWaves() : 35;
const SOAK_TEST_TIMEOUT_MS = Math.max(600_000, WAVES * 12_000);

describe.skipIf(!RUN || !FIDELITY_ON)(
  "PRODUCTION-FIDELITY co-op SOAK: no harness heal / guest-sourced commands (#879)",
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
      logs = installDuoLogCapture(`soak-fidelity-${Date.now()}`);
      // Force the GOD profile (the review's 35-wave god target), independent of SOAK_PROFILE.
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
      "runs the god soak with production heal/command fidelity and REPORTS findings (does not fix them)",
      async () => {
        const seed = resolveSoakSeed();
        announceSoakSeed(seed, WAVES);
        // eslint-disable-next-line no-console
        console.log(`[coop-soak-fidelity] MODE=production seed=${seed} waves=${WAVES} profile=god`);

        await game.classicMode.startBattle(...SOAK_PROFILES.god.species);

        const started = Date.now();
        let result: SoakResult | undefined;
        let terminal: { kind: string; wave: number; detail: string } | undefined;
        try {
          result = await runCoopSoak(game, { seed, waves: WAVES, logs, profile: "god", fidelity: "production" });
        } catch (e) {
          // A hard invariant breach (LOCKSTEP / NO-PARK / TEARDOWN) is a CLASSIFIED terminal in this mode, not a
          // test failure - it is exactly the loud fidelity evidence we want. Record it; anything else re-throws.
          if (e instanceof SoakInvariantError) {
            terminal = { kind: e.invariant, wave: e.wave, detail: e.detail };
            // eslint-disable-next-line no-console
            console.log(
              `[coop-soak-fidelity] TERMINAL invariant=${e.invariant} wave=${e.wave} :: ${e.detail} (seed ${seed})`,
            );
          } else {
            throw e;
          }
        }
        const elapsedMs = Date.now() - started;

        // ===== The findings report (the deliverable). =====
        if (result == null) {
          // eslint-disable-next-line no-console
          console.log(`[coop-soak-fidelity] DONE (terminated by invariant) seed=${seed} elapsedMs=${elapsedMs}`);
        } else {
          // eslint-disable-next-line no-console
          console.log(
            `[coop-soak-fidelity] DONE seed=${seed} waves=${result.wavesCompleted}/${result.wavesRequested} `
              + `resyncHeals=${result.resyncHeals} assertions=${result.assertions} findings=${result.findings.length} `
              + `runEnded=${result.runEnded == null ? "no" : `${result.runEnded.wave}:${result.runEnded.reason}`} `
              + `elapsedMs=${elapsedMs}`,
          );
          for (const f of result.findings) {
            // eslint-disable-next-line no-console
            console.log(
              `[coop-soak-fidelity] FINDING [${f.fields}] waves ${f.firstWave}-${f.lastWave} x${f.occurrences} :: ${f.sample}`,
            );
          }
        }

        // The ONLY assertion: the machine RAN (surveyed at least one wave, or hit a classified terminal). This
        // test never reds on findings - findings ARE the deliverable and are reported above / written to
        // dev-logs/coop-soak/. Production code is NOT fixed here (Wave-2 evidence).
        const surveyed = result?.wavesCompleted ?? terminal?.wave ?? 0;
        expect(
          surveyed,
          `production-fidelity soak must survey at least wave 1 (got ${surveyed}); a wave-0 stop is a harness break, not a finding`,
        ).toBeGreaterThanOrEqual(1);
        logs.flush();
      },
      SOAK_TEST_TIMEOUT_MS,
    );
  },
);

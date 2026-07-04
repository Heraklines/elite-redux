/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// NIGHTLY CO-OP SOAK (#841) - the keystone prevention mechanism. Wraps the seeded
// two-engine soak driver (test/tools/coop-soak-driver.ts) as a vitest test: a long
// randomized host+guest run that asserts the DIGEST / LOCKSTEP / NO-PARK / TEARDOWN
// invariants at every wave boundary, so desyncs / strands / leaks are found BY MACHINE.
//
// Gated ER_SCENARIO=1 like every duo test. The regular suite runs the SMALL default
// (SOAK_WAVES=25) so it stays fast (target: under 3 minutes at default size); the
// nightly workflow passes SOAK_WAVES=150+. The seed is PRINTED first thing (SOAK_SEED
// to replay); a failure writes the seed + wave + action script + both clients' logs to
// dev-logs/coop-soak/<timestamp>/.
//
// HOW TO RUN:
//   ER_SCENARIO=1 npx vitest run test/tests/elite-redux/coop/coop-soak.test.ts
//   SOAK_SEED=12345 SOAK_WAVES=40 ER_SCENARIO=1 npx vitest run test/tests/elite-redux/coop/coop-soak.test.ts
//   (PowerShell: $env:ER_SCENARIO="1"; $env:SOAK_SEED="12345"; npx vitest run <path>)
// =============================================================================

import { initGlobalScene } from "#app/global-scene";
import { setCoopFaintSwitchWaitMs, setCoopWaveBarrierMs } from "#data/elite-redux/coop/coop-interaction-relay";
import { clearCoopRuntime } from "#data/elite-redux/coop/coop-runtime";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { GameManager } from "#test/framework/game-manager";
import { installDuoLogCapture } from "#test/tools/coop-duo-harness";
import { announceSoakSeed, resolveSoakSeed, resolveSoakWaves, runCoopSoak } from "#test/tools/coop-soak-driver";
import Phaser from "phaser";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

describe.skipIf(!RUN)("NIGHTLY co-op SOAK: seeded randomized two-engine run (#841)", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;
  let logs: ReturnType<typeof installDuoLogCapture>;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    // #788 v2 partner-sync gate: tiny wait so the harness's manually-driven shop flows proceed fast via
    // the gate's own timeout fallback instead of sitting through the 60s live default.
    setCoopWaveBarrierMs(50);
    // #786 faint replacement: bound the host's wait for the guest's relayed replacement pick so a
    // guest-owned faint resolves fast via the harness's auto-picker instead of the 60s live default.
    setCoopFaintSwitchWaitMs(4000);
    game = new GameManager(phaserGame);
    logs = installDuoLogCapture(`soak-${Date.now()}`);
    game.override
      .battleStyle("double")
      .startingWave(1)
      // #843 REAL COMBAT: NO enemy overrides. Every wave fights its REAL generated species with its REAL
      // moveset / held items / ability, and the enemy AI plays real moves - so the guest replays real
      // incoming damage / status / stat-stages / procs through the per-turn checkpoint (the whole point of
      // the soak). Winnability comes from a LEVEL EDGE (startingLevel 85), NOT from fake frail enemies.
      .startingLevel(85)
      // The player moveset IS overridden - but with FOUR real, varied, single-target DAMAGING moves (not a
      // narrowing). This is the explicitly-permitted determinism knob: the seeded slot picker
      // (chosenMoveSlot) fixes ONE slot per wave for BOTH engines, so a status / no-damage slot would make
      // that whole wave deal zero damage and NO-PARK stall; four coverage damaging moves guarantee every
      // seeded pick makes progress. Status / stat / proc fidelity is exercised by the REAL enemy AI's
      // incoming moves (replayed through the checkpoint), which is where that coverage actually matters.
      .moveset([MoveId.BODY_SLAM, MoveId.SHADOW_BALL, MoveId.FLAMETHROWER, MoveId.THUNDERBOLT])
      // 🔴 V1 COVERAGE GAP #1 (see the driver header + the task report): MYSTERY ENCOUNTERS are OFF for the
      // continuous soak. The duo harness drives MEs only from a PARKED buildDuoForMe rig (coop-duo-mystery
      // helpers), NOT from a mid-run continuation, so a random ME mid-soak cannot yet be driven. This is a
      // LOUD, skip-counted limitation (the driver records a `mysteryEncounterDisabledV1` skip), NOT a
      // silent omission; the follow-up plan to drive MEs randomly is in the report. Do NOT treat this as
      // adequate - it is the single biggest coverage gap.
      .mysteryEncounterChance(0)
      // 🔴 V1 COVERAGE GAP #2 (see the driver's `trainerWavesDisabledV1` skip + the report): TRAINER waves
      // are OFF. mirrorHostBattleToGuest rebuilds a WILD enemy party (TrainerSlot.NONE, no trainer object /
      // variant-driven bench / enemy switch machinery), so a mid-soak trainer wave would mirror a
      // structurally wrong battle onto the guest. This is a LOUD, skip-counted, documented gap (NOT a
      // silent override); the follow-up plan (a trainer-aware mirror carrying the trainer + full bench) is
      // in the report. Enabling it needs the harness mirror to gain trainer-battle rebuild first.
      .disableTrainerWaves();
  });

  afterEach(() => {
    setCoopWaveBarrierMs(60_000);
    setCoopFaintSwitchWaitMs(60_000);
    logs.dispose();
    clearCoopRuntime();
    // #710 harness-citizenship: restore the host GameManager scene (buildDuo builds a 2nd BattleScene).
    initGlobalScene(game.scene);
  });

  afterAll(() => {
    // best-effort
  });

  it("plays a seeded randomized co-op run asserting DIGEST/LOCKSTEP/NO-PARK/TEARDOWN each wave", async () => {
    const seed = resolveSoakSeed();
    const waves = resolveSoakWaves();
    // PRINT the seed FIRST THING so any failure is replayable with SOAK_SEED=<seed>.
    announceSoakSeed(seed, waves);

    const started = Date.now();
    // #843: a full SIX-mon party (like real co-op's 3-mon-per-player cap) so a player faint has a real
    // bench to replace from - the driver tags party[0..2] host-owned, party[3..5] guest-owned and drives
    // the #786 guest-chooses-its-own-replacement machinery when a guest-owned mon faints.
    await game.classicMode.startBattle(
      SpeciesId.SNORLAX,
      SpeciesId.GENGAR,
      SpeciesId.DRAGONITE,
      SpeciesId.TYRANITAR,
      SpeciesId.METAGROSS,
      SpeciesId.GARCHOMP,
    );
    const result = await runCoopSoak(game, { seed, waves, logs });
    const elapsedMs = Date.now() - started;

    // Report coverage + runtime (visible in the CI/console output; the nightly reads skip-counters here).
    // eslint-disable-next-line no-console
    console.log(
      `[coop-soak] DONE seed=${seed} waves=${result.wavesCompleted}/${result.wavesRequested} `
        + `resyncHeals=${result.resyncHeals} findings=${result.findings.length} `
        + `skips=${JSON.stringify(result.skips)} elapsedMs=${elapsedMs}`,
    );
    for (const f of result.findings) {
      // eslint-disable-next-line no-console
      console.log(
        `[coop-soak] FINDING [${f.fields}] waves ${f.firstWave}-${f.lastWave} x${f.occurrences} :: ${f.sample}`,
      );
    }

    // The run surveyed every requested wave (no hard strand short-circuited it).
    expect(result.wavesCompleted, "soak surveyed every requested wave").toBe(waves);
    // THE PRIMARY GATE: the soak found NO unhealed host-vs-guest DIGEST desync. A finding here is the
    // machine doing its job - a REAL co-op divergence the resync did not converge; it is surfaced above +
    // written to dev-logs/coop-soak/<...>/ with a replayable seed. This assertion is a FAITHFUL red on a
    // real bug, never to be made green by narrowing content (see the driver header + the task report).
    expect(
      result.findings,
      `soak found ${result.findings.length} unhealed DIGEST desync(s) (replay SOAK_SEED=${seed}): `
        + result.findings.map(f => `[${f.fields}]@${f.firstWave}`).join(", "),
    ).toEqual([]);
    logs.flush();
  }, 600_000);
});

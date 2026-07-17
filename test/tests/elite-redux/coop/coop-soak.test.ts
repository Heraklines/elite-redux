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
import { CoopBattleStreamer } from "#data/elite-redux/coop/coop-battle-stream";
import { setCoopFaintSwitchWaitMs, setCoopWaveBarrierMs } from "#data/elite-redux/coop/coop-interaction-relay";
import { clearCoopRuntime } from "#data/elite-redux/coop/coop-runtime";
import { Stat } from "#enums/stat";
import { Move } from "#moves/move";
import { GameManager } from "#test/framework/game-manager";
import { installDuoLogCapture } from "#test/tools/coop-duo-harness";
import { assertSoakCompleteness, logSoakCoverage } from "#test/tools/coop-soak-coverage";
import {
  announceSoakSeed,
  prepareCoopSoakContent,
  resolveSoakFidelity,
  resolveSoakLevel,
  resolveSoakProfile,
  resolveSoakSeed,
  resolveSoakWaves,
  runCoopSoak,
  SOAK_PROFILES,
} from "#test/tools/coop-soak-driver";
import Phaser from "phaser";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, type MockInstance, vi } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

// #849 FULL-RUN capability: the maintainer wants the nightly to run to COMPLETION (reach + clear the ER
// classic final boss at wave 200), not stop at the old level-85 wipe. The 25-wave PR default stays for
// speed; pass SOAK_WAVES=200 (the full classic length) for a full endgame survey. A full run far exceeds
// the old flat 10-minute cap, so scale the test timeout with the requested wave count (~10s/wave headroom
// over the duo harness's per-wave cost), floored at 10 minutes so short runs are unaffected.
//
// 🔴 CURRENT DEPTH CEILING (seed 20260704, 2026-07-04): the god-tier party now surveys FAR past the old
// wave-69 level-ceiling wipe - a clean 70-wave run passes all invariants + the completeness backstop, and
// a full run reaches ~wave 140 before stranding. TWO late-game findings surfaced (exactly the point):
//   1. wave 90 - a fixed-slot move FULLY depleted PP; the picker's last-resort fallback handed a no-PP
//      move to game.move.select (getMovePosition gates on ppUsed<movePp) -> NO-PARK strand. FIXED in the
//      driver (restorePlayerPartyPp at wave-start, a survivability knob like the every-10 heal).
//   2. wave ~140 (a %10 boss/milestone) - the crossing into the next wave strands at an undriven
//      SelectModifierPhase (MODIFIER_SELECT): the deep boss/milestone reward tail leaves a reward shop the
//      processBossWave handling does not drain. OPEN late-game finding (a follow-up to the boss-reward-tail
//      driver logic); until it lands, a SOAK_WAVES>=~140 run strands there. Use SOAK_WAVES<=130 for a
//      currently-clean deep run; raise COMPLETENESS_ASSERT_MIN toward the full length as the ceiling rises.
const SOAK_TEST_TIMEOUT_MS = Math.max(600_000, resolveSoakWaves() * 10_000);

describe.skipIf(!RUN)("NIGHTLY co-op SOAK: seeded randomized two-engine run (#841)", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;
  let logs: ReturnType<typeof installDuoLogCapture>;
  let accuracySpy: MockInstance | undefined;
  let recoverySpy: MockInstance | undefined;
  // #832 SOAK_PROFILE: "god" (default, byte-identical to today) or "level" (the faint-heavy level-65 party).
  // Resolved once per test in beforeEach so the override party + the coverage assertion agree on it.
  let profile: ReturnType<typeof resolveSoakProfile>;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    // 🔴 FORCE-HIT (a determinism knob, NOT content narrowing). The test framework clamps every battle
    // roll to its MAX value; for the ACCURACY roll that is the WORST case, so ANY sub-100 effective accuracy
    // becomes a GUARANTEED miss. Against a real EVASION enemy (e.g. a Snow Cloak Froslass, seen at seed
    // 20260704 wave 27) EVERY level-85 move then "avoids" - the wave can NEVER be won and NO-PARK strands
    // at the 60-turn budget, even though the soak's whole premise is "winnable via the LEVEL EDGE". This
    // makes accuracy consistent with the clamp's already-maxed DAMAGE (both player-favourable) so the level
    // edge actually connects; it does NOT weaken the DIGEST invariant (both engines still replay the SAME
    // forced-hit events byte-for-byte) and it changes no enemy content. Mirrors run-scenario.ts's --no-miss
    // (ER_RUN_NO_MISS). Restored in afterEach so it never leaks into other coop-suite files (isolate:false).
    accuracySpy = vi.spyOn(Move.prototype, "calculateBattleAccuracy").mockReturnValue(-1);
    // #788 v2 partner-sync gate: tiny wait so the harness's manually-driven shop flows proceed fast via
    // the gate's own timeout fallback instead of sitting through the 60s live default.
    setCoopWaveBarrierMs(50);
    // #786 faint replacement: bound the host's wait for the guest's relayed replacement pick so a
    // guest-owned faint resolves fast via the harness's auto-picker instead of the 60s live default.
    setCoopFaintSwitchWaitMs(4000);
    game = new GameManager(phaserGame);
    logs = installDuoLogCapture(`soak-${Date.now()}`);
    // #832 PROFILE-DRIVEN PARTY. The party (level + species + moveset + held items) comes from SOAK_PROFILES
    // so the override + the coverage assertion share one source of truth. "god" (default / SOAK_PROFILE unset)
    // is the level-500 legendary steamroller that must finish the full classic run; "level" is the
    // faint-heavy level-65 party that GUARANTEES the single-faint/switch/replace channel (#845-#848).
    profile = resolveSoakProfile();
    const party = SOAK_PROFILES[profile];
    // #846 diagnosis knob: SOAK_LEVEL overrides the profile's fixed starting level (repro a level-config
    // -specific digest divergence at a deeper edge, e.g. SOAK_LEVEL=55). Unset = the profile default stands.
    const startingLevel = resolveSoakLevel() ?? party.startingLevel;
    // #843 REAL COMBAT: NO enemy overrides. Every wave fights its REAL generated species with its REAL
    // moveset / held items / ability, and the enemy AI plays real moves - so the guest replays real incoming
    // damage / status / stat-stages / procs through the per-turn checkpoint (the whole point of the soak).
    // Winnability (god) / a fainting ceiling (level) comes from the party's LEVEL EDGE, not from fake frail
    // enemies. The forced 4-move damaging moveset is the explicitly-permitted determinism knob: the seeded
    // fixed-slot picker needs every slot to deal damage or a wave NO-PARK stalls; status/proc fidelity is
    // exercised by the REAL enemy AI's incoming moves (replayed through the checkpoint). MYSTERY ENCOUNTERS
    // stay OFF (V1 COVERAGE GAP #1 - the duo harness drives MEs only from a parked rig, not a mid-run
    // continuation); the driver records a `mysteryEncounterDisabledV1` skip. Held items are profile-scoped
    // (god carries LEFTOVERS for endgame sustain; level carries none so it faints reliably).
    game.override
      .battleStyle("double")
      .startingWave(1)
      .startingLevel(startingLevel)
      .moveset([...party.moveset])
      .mysteryEncounterChance(0);
    if (party.heldItems != null) {
      game.override.startingHeldItems([...party.heldItems]);
    }
    // TRAINER WAVES ARE ON (#846). The harness mirror (mirrorHostBattleToGuest) is now TRAINER-AWARE: it
    // rebuilds the guest battle with the host's trainer identity + the FULL enemy party (bench included)
    // keyed to the host's authoritative trainerSlot, so a RANDOM (rolled) trainer wave mirrors faithfully
    // and is surveyed under the full DIGEST / LOCKSTEP / NO-PARK / TEARDOWN invariants exactly like a wild
    // wave. `.disableTrainerWaves()` (which set DISABLE_STANDARD_TRAINERS_OVERRIDE) is REMOVED, so random
    // trainer waves roll on the usual cadence alongside the fixed rival / evil-team battles that already
    // ran. The driver's `trainerWavesDisabledV1` skip counter is gone with it. MEs stay OFF (GAP #1 above,
    // a separate follow-up); trainer waves are no longer an excluded class.
  });

  afterEach(() => {
    setCoopWaveBarrierMs(60_000);
    setCoopFaintSwitchWaitMs(60_000);
    accuracySpy?.mockRestore();
    accuracySpy = undefined;
    recoverySpy?.mockRestore();
    recoverySpy = undefined;
    logs.dispose();
    clearCoopRuntime();
    // #710 harness-citizenship: restore the host GameManager scene (buildDuo builds a 2nd BattleScene).
    initGlobalScene(game.scene);
  });

  afterAll(() => {
    // best-effort
  });

  it(
    "plays a seeded randomized co-op run asserting DIGEST/LOCKSTEP/NO-PARK/TEARDOWN each wave",
    async () => {
      const seed = resolveSoakSeed();
      const waves = resolveSoakWaves();
      // PRINT the seed FIRST THING so any failure is replayable with SOAK_SEED=<seed>.
      announceSoakSeed(seed, waves);
      prepareCoopSoakContent(game, seed);

      const started = Date.now();
      // #832/#843/#849: a full SIX-mon party (like real co-op's 3-mon-per-player cap) so a player faint has a
      // real bench to replace from - the driver tags party[0..2] host-owned, party[3..5] guest-owned and
      // drives the #786 guest-chooses-its-own-replacement machinery when a mon faints. The species come from
      // the resolved SOAK_PROFILE (SOAK_PROFILES): "god" = six overpowered legendaries (ETERNATUS/RAYQUAZA/
      // ARCEUS/MEWTWO/KYOGRE/ZACIAN) that steamroll the endgame so the soak reaches waves 70-200; "level" =
      // the level-65 team (SNORLAX/GENGAR/DRAGONITE/TYRANITAR/METAGROSS/GARCHOMP) that FAINTS reliably in its
      // ~wave-40-48 death spiral so the single-faint/switch/replace channel is GUARANTEED. Mega/primal FORMS
      // are not force-spawned (fragile through the headless duo mirror); the level EDGE does the work.
      await game.classicMode.startBattle(...SOAK_PROFILES[profile].species);
      const result = await runCoopSoak(game, { seed, waves, logs, profile, fidelity: resolveSoakFidelity() });
      const elapsedMs = Date.now() - started;

      // Report coverage + runtime (visible in the CI/console output; the nightly reads skip-counters here).
      // eslint-disable-next-line no-console
      console.log(
        `[coop-soak] DONE seed=${seed} waves=${result.wavesCompleted}/${result.wavesRequested} `
          + `resyncHeals=${result.resyncHeals} assertions=${result.assertions} findings=${result.findings.length} `
          + `trainerWaves=${result.trainerWaves.total} (fixed=${result.trainerWaves.fixed} random=${result.trainerWaves.random}) `
          + `skips=${JSON.stringify(result.skips)} elapsedMs=${elapsedMs}`,
      );
      for (const f of result.findings) {
        // eslint-disable-next-line no-console
        console.log(
          `[coop-soak] FINDING [${f.fields}] waves ${f.firstWave}-${f.lastWave} x${f.occurrences} :: ${f.sample}`,
        );
      }

      // #846 TERMINAL run-end: the host run can END mid-soak (a party WIPE on the evil-team fixed-trainer
      // gauntlet -> GameOver -> Title). The driver detects it and stops the survey LOUDLY (a counted terminal
      // outcome), NEVER a NO-PARK strand. A run-end is honest + acceptable (the survey covered every wave up
      // to it under all four invariants); it is reported here so a coordinator can decide whether the wipe is
      // a content-reality note (real-run heals fire but the level edge still loses to the gauntlet) or a
      // fidelity gap. The PRIMARY DIGEST gate below still applies to the surveyed waves.
      if (result.runEnded == null) {
        // No terminal: the run surveyed every requested wave (no hard strand short-circuited it).
        expect(result.wavesCompleted, "soak surveyed every requested wave").toBe(waves);
      } else {
        // eslint-disable-next-line no-console
        console.log(
          `[coop-soak] RUN ENDED at wave ${result.runEnded.wave} (seed ${seed}): ${result.runEnded.reason}. `
            + `Surveyed ${result.wavesCompleted}/${waves} waves under all invariants before the terminal.`,
        );
        // The survey ended EARLY at a real terminal - it must have stopped before the last wave.
        expect(result.wavesCompleted, "run-end stopped before the full requested count").toBeLessThan(waves);
        // COVERAGE FLOOR (anti-narrowing): a run-end is only an acceptable terminal if the run got DEEP
        // enough that the wipe is plausibly the party's real ceiling losing to the gauntlet (god at the deep
        // endgame, or the level-65 party's ~wave-40-48 death spiral) - NOT a regression that weakened the
        // party into an early wipe. A run-end below the proven-survivable baseline (both profiles clear 30
        // waves on multiple seeds) is a RED, not a silent green with reduced coverage. Floor = min(requested,
        // 30) so a deliberately tiny run isn't false-red.
        const coverageFloor = Math.min(waves, 30);
        expect(
          result.wavesCompleted,
          `run-end at wave ${result.runEnded.wave} surveyed only ${result.wavesCompleted} waves - below the `
            + `proven-survivable floor of ${coverageFloor} (a party this weak this early is a regression, `
            + `not the late-game level ceiling; replay SOAK_SEED=${seed})`,
        ).toBeGreaterThanOrEqual(coverageFloor);
      }
      if (profile === "god") {
        expect(
          result.runEnded,
          `the god profile is the start-to-finish carrier and may not stop before wave ${waves}`,
        ).toBeUndefined();
        expect(result.wavesCompleted, "the god profile completed the requested classic journey").toBe(waves);
      }
      // THE PRIMARY GATE: the soak found NO unhealed host-vs-guest DIGEST desync. A finding here is the
      // machine doing its job - a REAL co-op divergence the resync did not converge; it is surfaced above +
      // written to dev-logs/coop-soak/<...>/ with a replayable seed. This assertion is a FAITHFUL red on a
      // real bug, never to be made green by narrowing content (see the driver header + the task report).
      expect(
        result.findings,
        `soak found ${result.findings.length} unhealed DIGEST desync(s) (replay SOAK_SEED=${seed}): `
          + result.findings.map(f => `[${f.fields}]@${f.firstWave}`).join(", "),
      ).toEqual([]);

      // A successful recovery snapshot must never turn a causal replication defect into a green full run.
      // The narrowly classified renderer-money lag remains visible but expected; every other pre-heal mismatch
      // means the guest reached a boundary with state it did not derive from the host and blocks completion.
      const unexpectedPreHeals = result.preHealMismatches.filter(m => m.classification === "unexpected");
      expect(
        unexpectedPreHeals,
        `soak observed ${unexpectedPreHeals.length} unexpected pre-heal mismatch(es) `
          + `(replay SOAK_SEED=${seed}): `
          + unexpectedPreHeals.map(m => `wave${m.wave}@${m.where}[${m.fields.join(",")}]`).join("; "),
      ).toEqual([]);

      // #838 Phase 5 GATE: the PRODUCTION per-turn checksum ASSERTION count must be ZERO. This is the
      // guest's REAL CoopFinalizeTurnPhase.verifyChecksum tally (independent of the driver's boundary
      // `resyncHeals` probe above): the full-state authoritative payload is supposed to converge every
      // hashed field - PP included, BY CONSTRUCTION - so a normal-play run must never trip an assertion.
      // A nonzero count is a real full-state gap (the exact class Phase 5 exists to surface); it is
      // faithfully red, never to be greened by narrowing content.
      expect(
        result.assertions,
        `soak tripped ${result.assertions} production checksum assertion(s) - the full-state payload left a `
          + `per-turn divergence the heal-once had to close (replay SOAK_SEED=${seed}; see the [coop:ASSERT] lines)`,
      ).toBe(0);

      // #849 COMPLETENESS BACKSTOP: PROVE the soak exercised every co-op interactive surface it can drive,
      // and LOUDLY skip-count every one it deliberately cannot (each with its follow-up task). The report is
      // ALWAYS printed (the cold-surface list is the maintainer's deliverable); the ASSERTION is gated -
      // report-only below COMPLETENESS_ASSERT_MIN waves (the 25-wave PR default stays fast + green), full
      // enforcement at or above it (every GUARANTEED surface hit + the anti-silent-drop partition check, so a
      // newly-added mirrored mode / relay kind / seq band auto-reds until it is driven or declared undrivable).
      // #832: pass the PROFILE so the assertion uses the right GUARANTEED/PROBABILISTIC split + gate. Under
      // "level" the faint channel is GUARANTEED (enforced at any depth) and the gate is the level-ceiling
      // floor (30); under "god" it is unchanged (faint PROBABILISTIC, gate 60).
      logSoakCoverage(result.hits, profile);
      assertSoakCompleteness(result.hits, { wavesCompleted: result.wavesCompleted, seed, profile });
      logs.flush();
    },
    SOAK_TEST_TIMEOUT_MS,
  );

  it("retained wave boundary keeps one X Attack exact on both clients through natural expiry without recovery", async () => {
    const seed = 0xc533a11;
    const waves = 6;
    // One deterministic non-party reward is taken only on wave 1. Later shops leave, so the five-battle
    // TEMP_STAT_STAGE_BOOSTER lifecycle can lapse naturally at each real retained BattleEnd boundary.
    game.override
      .startingLevel(SOAK_PROFILES.god.startingLevel)
      .itemRewards([{ name: "TEMP_STAT_STAGE_BOOSTER", type: Stat.ATK }]);
    prepareCoopSoakContent(game, seed);
    await game.classicMode.startBattle(...SOAK_PROFILES.god.species);
    recoverySpy = vi.spyOn(CoopBattleStreamer.prototype, "requestStateSync");

    const result = await runCoopSoak(game, {
      seed,
      waves,
      logs,
      profile: "god",
      fidelity: "production",
      rewardPolicy: "leave",
      forceTakeRewardWaves: new Set([1]),
      capturePostWaveState: true,
    });

    expect(result.wavesCompleted, "the focused lifecycle crossed every requested battle boundary").toBe(waves);
    expect(result.findings, "no modifier/save divergence survived a boundary").toEqual([]);
    expect(result.preHealMismatches, "no mismatch was hidden by the one-heal path").toEqual([]);
    expect(result.resyncHeals, "the boundary driver never invoked recovery").toBe(0);
    expect(result.assertions, "the live per-turn checksum never requested a heal").toBe(0);
    expect(recoverySpy, "the guest never requested a production full-state recovery").not.toHaveBeenCalled();
    expect(result.postWaveStates.map(state => state.wave)).toEqual([1, 2, 3, 4, 5, 6]);

    const remainingBattles = [5, 4, 3, 2, 1, 0];
    for (const [index, state] of result.postWaveStates.entries()) {
      expect(
        state.retainedWaveTransaction,
        `wave ${state.wave}: the exact retained WAVE_ADVANCE transaction was staged`,
      ).not.toBeNull();
      expect(
        state.retainedWaveTransaction?.dataApplied,
        `wave ${state.wave}: BattleEnd applied the immutable authoritative DATA`,
      ).toBe(true);
      expect(
        state.retainedWaveTransaction?.continuationReady,
        `wave ${state.wave}: the real queued reward UI published continuationReady`,
      ).toBe(true);
      expect(state.resyncHeals, `wave ${state.wave}: no earlier boundary recovered`).toBe(0);
      expect(
        state.guestPlayerModifiers,
        `wave ${state.wave}: complete normalized player modifiers equal the host`,
      ).toEqual(state.hostPlayerModifiers);

      const expected = remainingBattles[index];
      const hostXAttack = state.hostPlayerModifiers
        .filter(modifier => modifier.typeId === "TEMP_STAT_STAGE_BOOSTER")
        .map(modifier => ({ args: modifier.args, stackCount: modifier.stackCount }));
      expect(
        hostXAttack,
        expected > 0
          ? `wave ${state.wave}: X Attack preserves [stat,maxBattles,battleCount] exactly`
          : `wave ${state.wave}: X Attack expired instead of surviving with a stale count`,
      ).toEqual(expected > 0 ? [{ args: [Stat.ATK, 5, expected], stackCount: 1 }] : []);
    }

    logs.flush();
  }, 300_000);
});

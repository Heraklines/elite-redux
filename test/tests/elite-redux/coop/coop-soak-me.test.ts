/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// #633 MID-RUN MYSTERY-ENCOUNTER CONTINUATION (SOAK BUILD 1). Proves the soak can DRIVE a mystery encounter
// INLINE in the continuous two-engine wave loop (the single biggest coverage gap: the ENTIRE ME surface -
// mePresent/me/meResync/quizAns/bargain/colosseum kinds+bands, the MYSTERY_ENCOUNTER mode - was KNOWN_UNDRIVABLE
// because the soak set mysteryEncounterChance 0 and the duo harness drove MEs only from a PARKED buildDuoForMe rig).
//
// The driver now takes an `meWaves` map: at each designated wave it FORCES the ME (raising the rate override for
// just that wave's EncounterPhase), crosses the host into its MysteryEncounterPhase, MIRRORS the ME onto the
// guest (mirrorHostMeToGuest), drives the host through the REAL ME + embedded reward shop, drives the guest's
// REAL CoopReplayMePhase, and asserts LOCKSTEP (the ME advances the alternation counter exactly once). Routes
// by counter parity: HOST-OWNED (even) drives its own pick; GUEST-OWNED (odd) awaits the guest's relayed index.
//
// HOW TO RUN (gated ER_SCENARIO=1, like every ER engine test):
//   ER_SCENARIO=1 npx vitest run test/tests/elite-redux/coop/coop-soak-me.test.ts
// =============================================================================

import { initGlobalScene } from "#app/global-scene";
import { setCoopFaintSwitchWaitMs, setCoopWaveBarrierMs } from "#data/elite-redux/coop/coop-interaction-relay";
import { clearCoopRuntime } from "#data/elite-redux/coop/coop-runtime";
import { MysteryEncounterType } from "#enums/mystery-encounter-type";
import { Move } from "#moves/move";
import { GameManager } from "#test/framework/game-manager";
import { installDuoLogCapture } from "#test/tools/coop-duo-harness";
import { logSoakCoverage } from "#test/tools/coop-soak-coverage";
import { announceSoakSeed, prepareCoopSoakContent, runCoopSoak, SOAK_PROFILES } from "#test/tools/coop-soak-driver";
import Phaser from "phaser";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, type MockInstance, vi } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

/** The designated ME wave (valid: WILD-eligible, non-boss, %10 != 1, in [10,180]) - host-owned by counter parity. */
const ME_WAVE = 15;
/** Stable content stream where wave 15 is a legal wild ME wave; recorded by the driver for replay. */
const ME_CONTENT_SEED = "test";

describe.skipIf(!RUN)("NIGHTLY co-op SOAK: mid-run mystery-encounter continuation (#633 BUILD 1)", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;
  let logs: ReturnType<typeof installDuoLogCapture>;
  let accuracySpy: MockInstance | undefined;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    // Force-hit (a determinism knob, NOT content narrowing) so the god party's max-clamped moves connect.
    accuracySpy = vi.spyOn(Move.prototype, "calculateBattleAccuracy").mockReturnValue(-1);
    // Mystery campaigns still traverse ordinary entry presentations. Do not let the test-only rendezvous
    // ceiling expire while the renderer is visibly replaying an ability-heavy wave opening.
    setCoopWaveBarrierMs(2_000);
    setCoopFaintSwitchWaitMs(4000);
    game = new GameManager(phaserGame);
    logs = installDuoLogCapture(`soak-me-${Date.now()}`);
    // GOD profile for the ME leg (steamrolls to wave 15 well below the ~wave-60 playWave razor's edge). MEs
    // stay OFF by default (chance 0); the driver's crossIntoMeWave raises the rate for JUST the designated
    // wave's EncounterPhase then resets it, so ONLY wave 15 rolls an ME.
    game.override
      .battleStyle("double")
      .startingWave(1)
      .startingLevel(SOAK_PROFILES.god.startingLevel)
      .moveset([...SOAK_PROFILES.god.moveset])
      .startingHeldItems([...(SOAK_PROFILES.god.heldItems ?? [])])
      .mysteryEncounterChance(0);
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

  it("drives a DEPARTMENT_STORE_SALE ME inline at wave 15 (host-owned), the guest replays in lockstep, findings=0", async () => {
    const seed = 828_633;
    // Survey THROUGH the ME wave (the designated ME is the final surveyed wave). The inline ME drive itself
    // is the load-bearing BUILD-1 capability; surveying waves AFTER a host-owned ME hits a post-ME reward-
    // shop-ownership counter-desync (the guest's next-wave owner handshake) that is the documented follow-up.
    const waves = ME_WAVE;
    announceSoakSeed(seed, waves);

    prepareCoopSoakContent(game, seed, ME_CONTENT_SEED);
    await game.classicMode.startBattle(...SOAK_PROFILES.god.species);
    const result = await runCoopSoak(game, {
      seed,
      waves,
      logs,
      profile: "god",
      pinSeed: ME_CONTENT_SEED,
      meWaves: new Map([[ME_WAVE, MysteryEncounterType.DEPARTMENT_STORE_SALE]]),
    });

    // eslint-disable-next-line no-console
    console.log(
      `[coop-soak-me] DONE seed=${seed} waves=${result.wavesCompleted}/${result.wavesRequested} `
        + `findings=${result.findings.length} MEs=${JSON.stringify(result.mysteryEncounters)} skips=${JSON.stringify(result.skips)}`,
    );

    // The ME was DRIVEN at wave 15 (not skipped, not a terminal).
    expect(result.mysteryEncounters.length, "one ME was driven inline").toBe(1);
    expect(result.mysteryEncounters[0].wave, "the ME was driven at the designated wave").toBe(ME_WAVE);
    expect(result.mysteryEncounters[0].type, "the driven ME is DEPARTMENT_STORE_SALE").toBe(
      MysteryEncounterType[MysteryEncounterType.DEPARTMENT_STORE_SALE],
    );
    // Wave 15 has an even interaction counter: ordinary rewards increment it 14 times before the ME.
    expect(result.mysteryEncounters[0].path, "wave 15 is HOST-OWNED by counter parity").toBe("host-owned");

    // The soak DROVE the ME (not skipped as disabled, not counted as an undrivable stray) and surveyed it
    // as the final wave (no NO-PARK strand, no terminal run-end).
    expect(
      result.skips.mysteryEncounterDisabledV1,
      "the ME-disabled skip is NOT recorded with a ME leg",
    ).toBeUndefined();
    expect(
      result.skips.mysteryEncounterWaveHit,
      "the ME was DRIVEN, not counted as an undrivable stray",
    ).toBeUndefined();
    expect(result.wavesCompleted, "the run surveyed every wave through the ME").toBe(waves);
    expect(result.runEnded, "no terminal run-end").toBeUndefined();

    // The ME SYNC surfaces fired: the MYSTERY_ENCOUNTER mode opened on the guest, and the ME relay kinds
    // (mePresent present + meResync outcome + the `me` option pick chain) were streamed. The coverage tap
    // observes the exact outgoing retained P33 envelopes for the migrated presentation/terminal edges and
    // their real 8M/9M address roots; no legacy raw fallback is required to make these assertions green.
    // These were ALL KNOWN_UNDRIVABLE before BUILD 1.
    logSoakCoverage(result.hits, "god");
    const kinds = [...result.hits.kinds];
    expect(kinds, "the ME present relay kind fired").toContain("mePresent");
    expect(kinds, "the ME resync relay kind fired").toContain("meResync");
    const bands = [...result.hits.bands];
    expect(bands, "the durable ME presentation used the ME pump address band").toContain("mePump");
    expect(bands, "the durable comprehensive terminal used the ME terminal address band").toContain("meTerm");

    // THE PRIMARY GATE: no unhealed DIGEST desync across the whole run incl. the ME wave.
    expect(
      result.findings,
      `soak found ${result.findings.length} unhealed DIGEST desync(s) (replay SOAK_SEED=${seed}): `
        + result.findings.map(f => `[${f.fields}]@${f.firstWave}`).join(", "),
    ).toEqual([]);
    expect(result.assertions, "no production checksum assertion fired across the ME and biome boundaries").toBe(0);

    logs.flush();
  }, 600_000);

  it("surveys TWO waves PAST a host-owned ME with NO post-ME pin leak (no spurious second ME), findings=0", async () => {
    // #633 FOLLOW-UP (finding (a) - POST-ME COUNTER DESYNC): before this landed, surveying waves AFTER a
    // HOST-OWNED ME STALLED - the guest's next-wave replay re-diverted a SPURIOUS SECOND ME and the wave's
    // owner/watcher handshake never converged. ROOT CAUSE (a HARNESS LEAK, not a production bug): in
    // production the guest's ME interaction pin (coopMeInteractionStart) is cleared at its true post-ME
    // boundary by PostMysteryEncounterPhase.start()'s authoritative-guest guard (coopClearMePinForGuest),
    // AFTER the embedded watcher reward shop drains. The two-engine harness drives the guest ONLY through the
    // CoopReplayMePhase LEAVE terminal (driveGuestMeReplay's documented scope), NOT its PostMysteryEncounterPhase,
    // so the pin leaked into guestCtx.mePins and coopMeInProgress() stayed TRUE - the next guest pump re-diverted.
    // The driver now mirrors the production post-ME boundary clear in processMeWave, so the survey continues.
    // Reuse the FIRST test's seed (828_633), which is proven to steamroll cleanly THROUGH wave 15 (the
    // pre-ME waves are known-green), so extending to wave 17 isolates the POST-ME behavior at 16 + 17.
    const seed = 828_633;
    const waves = ME_WAVE + 2; // drive the ME at 15, then survey 16 + 17 as plain battle waves
    announceSoakSeed(seed, waves);

    prepareCoopSoakContent(game, seed, ME_CONTENT_SEED);
    await game.classicMode.startBattle(...SOAK_PROFILES.god.species);
    const result = await runCoopSoak(game, {
      seed,
      waves,
      logs,
      profile: "god",
      pinSeed: ME_CONTENT_SEED,
      meWaves: new Map([[ME_WAVE, MysteryEncounterType.DEPARTMENT_STORE_SALE]]),
    });

    // eslint-disable-next-line no-console
    console.log(
      `[coop-soak-me] POST-ME-SURVEY DONE seed=${seed} waves=${result.wavesCompleted}/${result.wavesRequested} `
        + `findings=${result.findings.length} MEs=${JSON.stringify(result.mysteryEncounters)} skips=${JSON.stringify(result.skips)}`,
    );

    // EXACTLY ONE ME was driven (the designated wave-15 host-owned ME); the guest never re-diverted a spurious
    // SECOND ME on wave 16/17 (the leak's signature - it surfaced as an undrivable stray or a stall).
    expect(result.mysteryEncounters.length, "exactly one ME driven - no spurious post-ME second ME").toBe(1);
    expect(result.mysteryEncounters[0].wave, "the one ME was the designated wave-15 ME").toBe(ME_WAVE);
    expect(result.mysteryEncounters[0].path, "wave 15 is HOST-OWNED by counter parity").toBe("host-owned");
    expect(
      result.skips.mysteryEncounterWaveHit,
      "no undrivable stray ME was counted on the post-ME waves (the leak's signature)",
    ).toBeUndefined();

    // The survey reached EVERY wave past the ME (no stall, no terminal). This is the load-bearing assertion:
    // the post-ME waves 16 + 17 were driven as normal owner/watcher battle waves, in lockstep.
    expect(result.wavesCompleted, "the run surveyed every wave THROUGH + PAST the ME").toBe(waves);
    expect(result.runEnded, "no terminal run-end past the ME").toBeUndefined();

    // THE PRIMARY GATE: no unhealed DIGEST desync across the ME wave AND the two waves after it.
    expect(
      result.findings,
      `soak found ${result.findings.length} unhealed DIGEST desync(s) past the ME (replay SOAK_SEED=${seed}): `
        + result.findings.map(f => `[${f.fields}]@${f.firstWave}`).join(", "),
    ).toEqual([]);

    logs.flush();
  }, 600_000);

  it("drives a GUEST-OWNED ME inline (counter parity), then surveys past it, findings=0", async () => {
    // #633 FOLLOW-UP (ME LEG VARIANT: the GUEST-OWNED non-battle path - the IT #2 handshake's OTHER
    // direction). A single ME at wave 12 has an ODD interaction counter (the exact pre-ME trace records 11),
    // so counter parity routes wave 12 to the GUEST as owner: processMeWave takes the guest-owned
    // branch (startGuestMeReplay + relayGuestMeOptionIndexOnly + startGuestMeOutcomeRace +
    // drainGuestMeReplayToSettle - the host is the pick WATCHER, awaiting the guest's relayed option index via
    // coopHostAwaitGuestIndex). This exercises the reciprocal of the host-owned drive across two real engines,
    // INLINE in the continuous wave loop. Surveying wave 13 past it re-confirms the post-ME pin clear (finding
    // (a)) holds for the guest-owned path too (the guest-owned drive leaves the SAME coopMeInteractionStart pin
    // set). NB a single ME at wave 12 (not a wave-12 + wave-13 pair) is used deliberately: crossing directly
    // from one ME wave INTO the next is a separate flow the continuous harness does not yet drive.
    const seed = 828_633;
    const GUEST_ME_WAVE = 12; // exact pre-ME counter=11 -> guest-owned; wild-eligible for this seed
    const waves = GUEST_ME_WAVE + 1; // survey the wave past the guest-owned ME
    announceSoakSeed(seed, waves);

    prepareCoopSoakContent(game, seed, ME_CONTENT_SEED);
    await game.classicMode.startBattle(...SOAK_PROFILES.god.species);
    const result = await runCoopSoak(game, {
      seed,
      waves,
      logs,
      profile: "god",
      pinSeed: ME_CONTENT_SEED,
      meWaves: new Map([[GUEST_ME_WAVE, MysteryEncounterType.DEPARTMENT_STORE_SALE]]),
    });

    // eslint-disable-next-line no-console
    console.log(
      `[coop-soak-me] GUEST-OWNED-ME DONE seed=${seed} waves=${result.wavesCompleted}/${result.wavesRequested} `
        + `findings=${result.findings.length} MEs=${JSON.stringify(result.mysteryEncounters)} skips=${JSON.stringify(result.skips)}`,
    );

    // The GUEST-OWNED non-battle path was driven inline at wave 12 (the reciprocal of the host-owned case).
    expect(result.mysteryEncounters.length, "the designated ME was driven inline").toBe(1);
    expect(result.mysteryEncounters[0].wave, "the ME was driven at the designated wave").toBe(GUEST_ME_WAVE);
    expect(result.mysteryEncounters[0].path, "wave 12 is GUEST-OWNED by counter parity").toBe("guest-owned");
    expect(
      result.skips.mysteryEncounterWaveHit,
      "no undrivable stray ME was counted (the guest-owned ME was DRIVEN)",
    ).toBeUndefined();

    // The survey reached wave 13 past the guest-owned ME (no stall, no terminal) - the guest-owned drive's
    // post-ME pin clear holds too.
    expect(result.wavesCompleted, "the run surveyed every wave THROUGH + PAST the guest-owned ME").toBe(waves);
    expect(result.runEnded, "no terminal run-end past the ME").toBeUndefined();

    // THE PRIMARY GATE: no unhealed DIGEST desync across the guest-owned ME wave and the wave after it.
    expect(
      result.findings,
      `soak found ${result.findings.length} unhealed DIGEST desync(s) across the guest-owned ME (replay SOAK_SEED=${seed}): `
        + result.findings.map(f => `[${f.fields}]@${f.firstWave}`).join(", "),
    ).toEqual([]);

    logs.flush();
  }, 600_000);
});

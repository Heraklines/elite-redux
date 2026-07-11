/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// DETERMINISM CONTRACT (#842) - the guard that kills the client-local-identity desync
// class. Two INDEPENDENT two-engine pairs are driven with the IDENTICAL seeded script
// for a handful of waves; their #837 save-data digests MUST be byte-identical at every
// wave boundary. If a digest carried anything client-local (the classic instance: a
// granted-mon `pokemonId` embedded in a held-item modifier arg, or an id-keyed
// money-streak / ward-stone entry), the two independent runs' digests would diverge even
// though both agree on the game state. Both pairs are pinned to the SAME run seed and
// driven by the SAME seeded PRNG, so a boundary-digest difference is a pure identity leak.
//
// #839 UPDATE: the granted-mon pokemonId + money-streak + ward-stone id sources are now
// normalized to stable party-slot tokens in coop-battle-engine.ts (coopNormalizePokemonId
// / normalizeCoopMonKeyedEntries). This test asserts that normalization holds end-to-end
// across two independent engine pairs - no TODO skip; the digests compare clean.
//
// The two independent pairs run as SEPARATE it()s (each its own fresh GameManager - the
// framework clears the prompt-handler interval BETWEEN tests, and one full battle run per
// test avoids the mock-console double-wrap fragility of two GameManagers in one test);
// the third it() compares the two runs' per-boundary digests. The shared ER module-let
// substrates (money streak / overstay anchor / relic lists) are reset in beforeEach so
// each pair starts from the identical process-global slate (production is one process per
// client).
//
// HOW TO RUN (gated ER_SCENARIO=1, like every duo test):
//   ER_SCENARIO=1 npx vitest run test/tests/elite-redux/coop/coop-determinism-contract.test.ts
// =============================================================================

import { initGlobalScene } from "#app/global-scene";
import { setCoopFaintSwitchWaitMs, setCoopWaveBarrierMs } from "#data/elite-redux/coop/coop-interaction-relay";
import { clearCoopRuntime } from "#data/elite-redux/coop/coop-runtime";
import { setErBiomeOverstayAnchor } from "#data/elite-redux/er-biome-structure";
import { restoreErMoneyStreaks } from "#data/elite-redux/er-money-streak";
import { restoreErRelicBattleState } from "#data/elite-redux/er-relic-battle-state";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { GameManager } from "#test/framework/game-manager";
import { installDuoLogCapture } from "#test/tools/coop-duo-harness";
import { prepareCoopSoakContent, runCoopSoak, type SoakBoundaryDigest } from "#test/tools/coop-soak-driver";
import Phaser from "phaser";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

/** A handful of waves is enough to prove the contract; keep each run fast. */
const CONTRACT_WAVES = 4;
/** The single script seed both pairs are driven by. */
const SCRIPT_SEED = 987654321;

describe.skipIf(!RUN)("DETERMINISM CONTRACT: identical seeded script => identical save-data digests (#842)", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;
  let logs: ReturnType<typeof installDuoLogCapture>;
  // The two independent runs' per-boundary digests (compared in the third it()).
  let digestsA: SoakBoundaryDigest[] = [];
  let digestsB: SoakBoundaryDigest[] = [];

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    setCoopWaveBarrierMs(50);
    setCoopFaintSwitchWaitMs(4000);
    // Reset the shared ER module-let substrates so BOTH independent pairs start from the identical
    // process-global slate (production has one process per client; here they share this test process).
    restoreErMoneyStreaks([]);
    setErBiomeOverstayAnchor(null);
    restoreErRelicBattleState(undefined);
    game = new GameManager(phaserGame);
    logs = installDuoLogCapture(`determinism-${Date.now()}`);
    // #843: the SAME real-content config the soak now uses (NO enemy overrides - real generated species /
    // movesets / items / AI; winnability from the level edge + 4 real damaging player moves). The contract
    // asserts that even with REAL enemy generation, two INDEPENDENT runs PINNED to the same seed produce
    // byte-identical save-data digests - enemy gen is run-seed-determined, so pinSeed pins it (if it did not,
    // that is a finding to report, not to design around).
    game.override
      .battleStyle("double")
      .startingWave(1)
      .startingLevel(85)
      .moveset([MoveId.BODY_SLAM, MoveId.SHADOW_BALL, MoveId.FLAMETHROWER, MoveId.THUNDERBOLT])
      .mysteryEncounterChance(0)
      .disableTrainerWaves();
  });

  afterEach(() => {
    setCoopWaveBarrierMs(60_000);
    setCoopFaintSwitchWaitMs(60_000);
    logs.dispose();
    clearCoopRuntime();
    // #710 harness-citizenship: restore the host GameManager scene (buildDuo built a 2nd scene).
    initGlobalScene(game.scene);
  });

  afterAll(() => {
    // best-effort
  });

  /** Run one independent pair through the identical seeded script; return its per-boundary digests. */
  async function runPair(): Promise<SoakBoundaryDigest[]> {
    prepareCoopSoakContent(game, SCRIPT_SEED);
    await game.classicMode.startBattle(
      SpeciesId.SNORLAX,
      SpeciesId.GENGAR,
      SpeciesId.DRAGONITE,
      SpeciesId.TYRANITAR,
      SpeciesId.METAGROSS,
      SpeciesId.GARCHOMP,
    );
    // rewardPolicy "seeded": rewards are TAKEN (across the full pool - non-party AND party-target) by the
    // seed, EXACTLY as the soak drives them. This is the STRONG form of the contract: a taken reward that
    // embedded a client-local id (a granted mon's pokemonId in a held-item arg) would diverge the two
    // independent runs' digests - the #839 class this guard exists to catch (now normalized). The driver's
    // DEFAULT content seed derives from the SAME SCRIPT_SEED, so this also prevents replay-key regression.
    const result = await runCoopSoak(game, {
      seed: SCRIPT_SEED,
      waves: CONTRACT_WAVES,
      logs,
      rewardPolicy: "seeded",
    });
    return result.boundaryDigests;
  }

  it("pair A: seeded run records per-boundary save-data digests", async () => {
    digestsA = await runPair();
    expect(digestsA.length, "pair A recorded a boundary per wave").toBe(CONTRACT_WAVES);
    // Within a run the host and guest already agree (the driver's DIGEST invariant); sanity re-assert.
    for (const b of digestsA) {
      expect(b.hostSaveDigest, `pair A wave ${b.wave}: host==guest save-data digest`).toBe(b.guestSaveDigest);
    }
    logs.flush();
  }, 600_000);

  it("pair B: an INDEPENDENT seeded run records its per-boundary save-data digests", async () => {
    digestsB = await runPair();
    expect(digestsB.length, "pair B recorded a boundary per wave").toBe(CONTRACT_WAVES);
    for (const b of digestsB) {
      expect(b.hostSaveDigest, `pair B wave ${b.wave}: host==guest save-data digest`).toBe(b.guestSaveDigest);
    }
    logs.flush();
  }, 600_000);

  it("THE CONTRACT: the two independent runs' digests are byte-identical at every boundary (#842)", () => {
    expect(digestsA.length, "pair A ran").toBeGreaterThan(0);
    expect(digestsB.length, "pair B ran").toBeGreaterThan(0);
    expect(digestsB.length, "both pairs reached the same boundary count").toBe(digestsA.length);

    // THE CONTRACT (#842): at every wave boundary the two INDEPENDENT runs produce the IDENTICAL
    // SAVE-DATA DIGEST. That digest is the identity-normalized projection of getSessionSaveData (it
    // EXCLUDES `party`/`enemyParty` and normalizes id-keyed substrates to party-slot tokens, #839), so a
    // difference is a client-local-identity leak. We deliberately do NOT compare the full-state CHECKSUM
    // across runs: it hashes per-run-VOLATILE fields the save digest excludes for good reason - notably a
    // starter's RANDOMLY-ROLLED ability (abilityIndex is drawn per run, so two independent runs of the same
    // species legitimately differ). Within a single run the host and guest DO share one checksum (the
    // driver's DIGEST invariant guarantees it, since the guest mirrors the host's rolled ability); it is
    // only ACROSS two independent runs that the volatile checksum fields diverge, which is exactly why the
    // #842 contract is defined on the normalized save-data digest, not the raw checksum.
    for (let i = 0; i < digestsA.length; i++) {
      const a = digestsA[i];
      const b = digestsB[i];
      expect(a.wave, `boundary ${i} aligns on the same wave`).toBe(b.wave);
      expect(
        b.hostSaveDigest,
        `wave ${a.wave}: independent runs' HOST save-data digests are identical (#842 - no identity leak)`,
      ).toBe(a.hostSaveDigest);
      expect(b.guestSaveDigest, `wave ${a.wave}: independent runs' GUEST save-data digests are identical (#842)`).toBe(
        a.guestSaveDigest,
      );
    }
  });
});

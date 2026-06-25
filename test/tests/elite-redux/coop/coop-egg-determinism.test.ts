/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// Co-op egg-generation determinism (#633 Fix #3). Trainer wins grant egg vouchers and the
// EggLapsePhase creates eggs, so on the SHARED trainer-win path the two lockstep clients must
// generate BYTE-IDENTICAL eggs or gameData diverges. In solo the egg id (randInt) and the
// property seed (randomString) are UNSEEDED (Math.random); in co-op both derive from the SHARED
// wave seed. These live tests prove: (1) two "clients" with the SAME wave seed - even with
// DIVERGENT per-account dexData/pity - generate the identical egg (id + species + shiny +
// variant + eggMoveIndex + tier) in co-op; (2) a DIFFERENT wave seed yields a different egg;
// (3) solo is still UNSEEDED (two solo eggs differ). Single-scene constraint (per the co-op
// suite): "the two clients" are two egg generations under the same shared seed with the local
// per-account state mutated between them.

import { getGameMode } from "#app/game-mode";
import { globalScene } from "#app/global-scene";
import { Egg } from "#data/egg";
import { clearCoopRuntime, startLocalCoopSession } from "#data/elite-redux/coop/coop-runtime";
import { EggSourceType } from "#enums/egg-source-types";
import { EggTier } from "#enums/egg-type";
import { GameModes } from "#enums/game-modes";
import { SpeciesId } from "#enums/species-id";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

/** The egg fields that must be byte-identical across the two lockstep clients. */
const eggFingerprint = (egg: Egg) => ({
  id: egg.id,
  species: egg.species,
  isShiny: egg.isShiny,
  variantTier: egg.variantTier,
  eggMoveIndex: egg.eggMoveIndex,
  tier: egg.tier,
});

describe.skipIf(!RUN)("co-op egg-generation determinism (#633 Fix #3)", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
  });

  afterEach(() => {
    clearCoopRuntime();
  });

  const enterCoop = () => {
    startLocalCoopSession({ username: "Host" });
    game.scene.gameMode = getGameMode(GameModes.COOP);
    expect(globalScene.gameMode.isCoop).toBe(true);
  };

  /**
   * Force the per-wave egg-sequence counter back to its in-wave index 0, modeling "the OTHER
   * client generating its FIRST egg of the same wave" - same shared seed, fresh index. The
   * module's internal counter only resets when an egg is generated under a DIFFERENT waveSeed,
   * so we generate one throwaway egg under a sentinel seed (advancing the module onto it), then
   * restore the shared seed. The next real egg then sees a seed change and resets to index 0.
   */
  const rewindToFreshWaveEgg = (waveSeed: string) => {
    globalScene.waveSeed = `${waveSeed}__sentinel`;
    new Egg({ sourceType: EggSourceType.GACHA_LEGENDARY, tier: EggTier.RARE });
    globalScene.waveSeed = waveSeed;
  };

  it("two clients with the SAME wave seed but DIVERGENT per-account state generate the IDENTICAL egg", async () => {
    await game.classicMode.startBattle(SpeciesId.BULBASAUR);
    enterCoop();

    const sharedSeed = "coop-determinism-seed-A";
    globalScene.waveSeed = sharedSeed;

    // Client 1 - generate the first egg of this wave.
    const egg1 = new Egg({ sourceType: EggSourceType.GACHA_LEGENDARY, tier: EggTier.RARE });
    const fp1 = eggFingerprint(egg1);

    // Simulate a DIVERGENT second account: flip a chunk of the dex caughtAttr + bump pity to the
    // 10th-egg force threshold. In solo this would narrow the species pool and change the species;
    // in co-op the narrowing is skipped, so the shared seed pins the identical species.
    const gd = globalScene.gameData;
    gd.unlockPity[EggTier.RARE] = 9;
    for (const key of Object.keys(gd.dexData).slice(0, 50)) {
      gd.dexData[Number(key)].caughtAttr = BigInt(0xff);
    }

    // Client 2 - its FIRST egg of the SAME wave (same shared seed, index 0).
    rewindToFreshWaveEgg(sharedSeed);
    const egg2 = new Egg({ sourceType: EggSourceType.GACHA_LEGENDARY, tier: EggTier.RARE });
    const fp2 = eggFingerprint(egg2);

    // Byte-identical egg despite the divergent per-account dex/pity.
    expect(fp2).toEqual(fp1);
  });

  it("a DIFFERENT wave seed produces a DIFFERENT egg in co-op (the seed truly drives the egg)", async () => {
    await game.classicMode.startBattle(SpeciesId.BULBASAUR);
    enterCoop();

    globalScene.waveSeed = "coop-seed-X";
    const eggX = new Egg({ sourceType: EggSourceType.GACHA_LEGENDARY, tier: EggTier.RARE });

    globalScene.waveSeed = "coop-seed-Y";
    const eggY = new Egg({ sourceType: EggSourceType.GACHA_LEGENDARY, tier: EggTier.RARE });

    // At least one of id/species/shiny/variant differs across the two seeds (not a fixed egg).
    expect(eggFingerprint(eggX)).not.toEqual(eggFingerprint(eggY));
  });

  it("SOLO eggs stay UNSEEDED: the same wave seed still yields different ids (solo path untouched)", async () => {
    await game.classicMode.startBattle(SpeciesId.BULBASAUR);
    // Stay in the default (classic / non-coop) mode (isCoop is falsy here).
    expect(globalScene.gameMode.isCoop).toBeFalsy();

    globalScene.waveSeed = "solo-fixed-seed";
    const idsSeen = new Set<number>();
    for (let i = 0; i < 8; i++) {
      const egg = new Egg({ sourceType: EggSourceType.GACHA_LEGENDARY, tier: EggTier.RARE });
      idsSeen.add(egg.id);
    }
    // Unseeded Math.random ids: extremely unlikely to collide across 8 draws -> proves solo is
    // NOT using the shared-seed path (no behavior change for solo players).
    expect(idsSeen.size).toBeGreaterThan(1);
  });
});

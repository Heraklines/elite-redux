/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// REPRO #616: the Town Raffle JACKPOT pays a Formation Relic, but the player won it
// and got NOTHING. Suspect: the raffle's FORMATION_RELIC_FUNCS array is built at
// MODULE-LOAD time from `modifierTypes.ER_RELIC_*` (a lazily-populated registry); if
// the raffle module loads before those relics are registered, the captured entries
// are `undefined`, so randSeedItem hands setEncounterRewards an undefined func and the
// reward generator silently drops it -> empty shop on a jackpot.
//
// This forces the jackpot roll, runs the real encounter flow, and inspects the
// resulting SelectModifierPhase: the guaranteed relic func MUST be a real function
// (not undefined) and MUST generate a pickable option.
//
// Run: ER_SCENARIO=1 npx vitest run test/tools/repro-town-raffle-jackpot.test.ts

import { BiomeId } from "#enums/biome-id";
import { ModifierPoolType } from "#enums/modifier-pool-type";
import { MysteryEncounterType } from "#enums/mystery-encounter-type";
import { SpeciesId } from "#enums/species-id";
import { getPlayerModifierTypeOptions, regenerateModifierPoolThresholds } from "#modifiers/modifier-type";
import * as MysteryEncounters from "#mystery-encounters/mystery-encounters";
import { HUMAN_TRANSITABLE_BIOMES } from "#mystery-encounters/mystery-encounters";
import { GameManager } from "#test/framework/game-manager";
import { runMysteryEncounterToEnd } from "#test/utils/encounter-test-utils";
import * as Common from "#utils/common";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

describe.skipIf(!RUN)("repro: Town Raffle jackpot relic not granted (#616)", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;
  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });
  beforeEach(() => {
    game = new GameManager(phaserGame);
    game.override.mysteryEncounterChance(100).startingWave(12).startingBiome(BiomeId.TOWN).disableTrainerWaves();
    const biomeMap = new Map<BiomeId, MysteryEncounterType[]>();
    HUMAN_TRANSITABLE_BIOMES.forEach(b => biomeMap.set(b, [MysteryEncounterType.ER_TOWN_RAFFLE]));
    biomeMap.set(BiomeId.TOWN, [MysteryEncounterType.ER_TOWN_RAFFLE]);
    vi.spyOn(MysteryEncounters, "mysteryEncountersByBiome", "get").mockReturnValue(biomeMap);
  });

  it("a JACKPOT roll delivers a real Formation Relic to the reward shop", async () => {
    // Force the JACKPOT roll (< 10): the raffle's randSeedInt(100) ticket draw.
    const realRandSeedInt = Common.randSeedInt;
    vi.spyOn(Common, "randSeedInt").mockImplementation(((range: number, min = 0) =>
      range === 100 ? 3 : realRandSeedInt(range, min)) as typeof Common.randSeedInt);

    await game.runToMysteryEncounter(MysteryEncounterType.ER_TOWN_RAFFLE, [
      SpeciesId.SNORLAX,
      SpeciesId.BLISSEY,
      SpeciesId.LAPRAS,
    ]);
    await runMysteryEncounterToEnd(game, 1);

    // doEncounterRewards unshifted the SelectModifierPhase; advance to it (no start()).
    await game.phaseInterceptor.to("SelectModifierPhase", false);
    const phase = game.scene.phaseManager.getCurrentPhase() as unknown as {
      customModifierSettings?: { guaranteedModifierTypeFuncs?: unknown[] };
    };
    const funcs = phase?.customModifierSettings?.guaranteedModifierTypeFuncs ?? [];
    const relicFunc = funcs[0];
    console.log(`JACKPOT guaranteed relic func: count=${funcs.length} typeof[0]=${typeof relicFunc}`);

    // The captured relic func must be a real function, not undefined (module-load race).
    expect(typeof relicFunc, "the jackpot's relic func must be a real function, not undefined").toBe("function");

    // ...and it must actually generate a pickable reward option (non-empty shop).
    const party = game.scene.getPlayerParty();
    regenerateModifierPoolThresholds(party, ModifierPoolType.PLAYER, 0);
    const opts = getPlayerModifierTypeOptions(1, party, undefined, {
      guaranteedModifierTypeFuncs: funcs as never,
      fillRemaining: false,
    });
    console.log(`JACKPOT shop options = ${opts.length}: [${opts.map(o => o.type?.name ?? "(null)").join(", ")}]`);
    expect(opts.length, "the jackpot relic must appear as a pickable reward").toBeGreaterThan(0);
  }, 120_000);
});

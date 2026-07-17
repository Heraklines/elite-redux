/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Live regression (item A, captures 2026-07-06T05-03-45 / 05-11-27, "Freeze Post
// Shop" / "ME Freeze post shop and biome change"): a SOLO classic run was reported
// to freeze right after the reward shop + biome change when the next presented
// screen was a Mystery Encounter.
//
// Root-cause audit (this branch, HEAD): the reported freeze is the solo new-biome
// (biome-boundary / X1 wave) NewBiomeEncounterPhase softlock fixed by d3d8aad75 -
// the X1 wave is always a WILD/TRAINER encounter (an ME can NOT spawn on the first
// wave of a new biome; the game gates it off), so "post shop + biome change" freezes
// were the wild new-biome presentation stalling on coopBoundaryStillLive() off co-op.
//
// This test guards the SIBLING the coordinator flagged: that the ME PRESENTATION path
// itself (MysteryEncounterPhase, reached through the real EncounterPhase presentation
// chain) is NOT gated shut for solo. If any co-op boundary predicate
// (coopSelectionBoundaryLive / coopHostStreamPresentation) leaked into the solo path,
// the encounter would never present and this drive would hang at
// phaseInterceptor.to("MysteryEncounterRewardsPhase"). Post-fix it resolves cleanly.
//
// Gated behind ER_SCENARIO=1 like every ER engine test.
// =============================================================================

import { BiomeId } from "#enums/biome-id";
import { MysteryEncounterType } from "#enums/mystery-encounter-type";
import { SpeciesId } from "#enums/species-id";
import * as MysteryEncounters from "#mystery-encounters/mystery-encounters";
import { CIVILIZATION_ENCOUNTER_BIOMES } from "#mystery-encounters/mystery-encounters";
import { GameManager } from "#test/framework/game-manager";
import { runMysteryEncounterToEnd } from "#test/utils/encounter-test-utils";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";
const defaultParty = [SpeciesId.LAPRAS, SpeciesId.GENGAR, SpeciesId.ABRA];
const defaultWave = 37;

describe.skipIf(!RUN)("solo Mystery Encounter presents instead of freezing (item A: post-shop ME freeze)", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
    game.override
      .mysteryEncounterChance(100)
      .startingWave(defaultWave)
      .startingBiome(BiomeId.PLAINS)
      .disableTrainerWaves();

    // Same civilization-biome mapping the department-store ME test uses, so the forced
    // ME reliably spawns in the solo run we drive.
    const biomeMap = new Map<BiomeId, MysteryEncounterType[]>();
    CIVILIZATION_ENCOUNTER_BIOMES.forEach(biome => {
      biomeMap.set(biome, [MysteryEncounterType.DEPARTMENT_STORE_SALE]);
    });
    vi.spyOn(MysteryEncounters, "mysteryEncountersByBiome", "get").mockReturnValue(biomeMap);
  });

  it("a solo ME reaches the option selector and resolves to rewards (no presentation freeze)", async () => {
    await game.runToMysteryEncounter(MysteryEncounterType.DEPARTMENT_STORE_SALE, defaultParty);

    // The encounter PRESENTED (pre-fix on a co-op-gated path this would never be set,
    // the phase would hang before opening the selector).
    expect(game.scene.currentBattle?.mysteryEncounter?.encounterType).toBe(MysteryEncounterType.DEPARTMENT_STORE_SALE);

    // The solo selection path presents AND resolves (it is NOT gated by a co-op selection
    // boundary): driving option 1 drives all the way through to the rewards phase. If the
    // presentation or selection had frozen, this await would time out instead of resolving.
    await runMysteryEncounterToEnd(game, 1);

    // MysteryEncounterPhase.start() ran to the point of opening the selector (it recorded the
    // seen event) rather than early-returning on a co-op boundary predicate.
    expect(game.scene.mysteryEncounterSaveData.encounteredEvents.length).toBeGreaterThan(0);
  });
});

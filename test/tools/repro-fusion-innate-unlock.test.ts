/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// REPRO #611: a fusion's 3rd-tier innate (passive3) is owned by the FUSION
// species, so its candy unlock must be read from the fusion species' starter
// data. Previously canApplyAbility read the BASE species' passiveAttr for every
// slot, so a passive3 unlocked on the fusion species was ignored and the fused
// mon's 3rd innate stayed locked.
//
// Run: ER_SCENARIO=1 npx vitest run test/tools/repro-fusion-innate-unlock.test.ts

import { globalScene } from "#app/global-scene";
import { AbilityId } from "#enums/ability-id";
import { SpeciesId } from "#enums/species-id";
import { GameManager } from "#test/framework/game-manager";
import { isSlotEnabled, isSlotUnlocked, unlockSlot } from "#utils/passive-utils";
import { getPokemonSpecies } from "#utils/pokemon-utils";
import Phaser from "phaser";
import { beforeAll, describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

describe.skipIf(!RUN)("repro: fusion 3rd innate unlock from the fusion species (#611)", () => {
  let g: Phaser.Game;
  beforeAll(() => {
    g = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  it("a passive3 unlocked on the FUSION species activates the fused mon's 3rd innate", async () => {
    const game = new GameManager(g);
    game.override.battleStyle("single").startingLevel(40).enemySpecies(SpeciesId.MAGIKARP);
    await game.classicMode.startBattle(SpeciesId.SNORLAX);

    const mon = game.field.getPlayerPokemon();
    // Fuse Snorlax (base) with Blissey (fusion).
    mon.fusionSpecies = getPokemonSpecies(SpeciesId.BLISSEY);
    mon.fusionFormIndex = 0;
    expect(mon.isFusion(), "mon is now a fusion").toBe(true);

    const baseRoot = mon.species.getRootSpeciesId();
    const fusRoot = mon.fusionSpecies!.getRootSpeciesId();
    const sd = globalScene.gameData.starterData as Record<number, { passiveAttr: number }>;
    sd[baseRoot] = { ...(sd[baseRoot] ?? {}), passiveAttr: 0 }; // base: nothing unlocked
    sd[fusRoot] = { ...(sd[fusRoot] ?? {}), passiveAttr: unlockSlot(0, 2) }; // fusion: slot 2 unlocked+enabled

    const innates = mon.getPassiveAbilities();
    const slot2 = innates[2];
    console.log(`fusion innates = [${innates.map(a => a?.name ?? "(none)").join(", ")}]; slot2="${slot2?.name}"`);
    expect(slot2?.id, "fusion slot 2 must hold the fusion species' passive3").toBeTruthy();
    expect(slot2?.id, "slot2 is a real innate, not NONE").not.toBe(AbilityId.NONE);

    const slot2Active = mon.canApplyAbility(true, 2);
    const slot1Active = mon.canApplyAbility(true, 1);
    console.log(`canApplyAbility slot2(fusion-owned)=${slot2Active} slot1(base-owned)=${slot1Active}`);
    expect(slot2Active, "the 3rd innate (fusion-owned) must be active - it was unlocked on the fusion").toBe(true);
    expect(slot1Active, "slot 1 (base-owned) is still locked - base unlocked nothing").toBe(false);

    // DISPLAY parity (#611): the in-battle Abilities panel marks a slot Locked via
    // isSlotUnlocked(mon.innateSlotPassiveAttr(slot), slot). It must read the SAME
    // owning-species attr the battle gate does, or the panel would show "Locked" for
    // a fusion-owned innate that is actually live. Assert the exact panel computation.
    const slot2Shown =
      isSlotUnlocked(mon.innateSlotPassiveAttr(2), 2) && isSlotEnabled(mon.innateSlotPassiveAttr(2), 2);
    const slot1Shown =
      isSlotUnlocked(mon.innateSlotPassiveAttr(1), 1) && isSlotEnabled(mon.innateSlotPassiveAttr(1), 1);
    console.log(`panel lock-state: slot2 shownUnlocked=${slot2Shown} slot1 shownUnlocked=${slot1Shown}`);
    expect(slot2Shown, "the panel must render the fusion-owned 3rd innate as unlocked, not Locked").toBe(true);
    expect(slot1Shown, "the panel must still render the base-owned slot 1 as locked").toBe(false);
  }, 120_000);
});

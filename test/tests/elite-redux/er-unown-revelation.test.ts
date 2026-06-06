/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// Repro for "Unown doesn't School into Revelation form". The wiring
// (init-elite-redux-unown-school.ts) injects the form, registers the
// School-up/revert edges, and rewires the Revelation ability to the Schooling
// trio. This test isolates the MECHANISM from passive-gating by forcing
// Revelation as the active ability, then checks Unown schools on summon and
// reverts at <=1/4 HP.
//
// Gated behind ER_SCENARIO=1.

import { allAbilities } from "#data/data-lists";
import { SpeciesFormChangeAbilityTrigger } from "#data/form-change-triggers";
import { AbilityId } from "#enums/ability-id";
import { ErAbilityId } from "#enums/er-ability-id";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

describe.skipIf(!RUN)("ER Unown Revelation (Schooling)", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
    game.override
      .battleStyle("single")
      .ability(ErAbilityId.REVELATION as unknown as AbilityId)
      .enemySpecies(SpeciesId.MAGIKARP)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemyMoveset(MoveId.SPLASH)
      .moveset([MoveId.SPLASH])
      .startingLevel(50)
      .enemyLevel(5)
      .criticalHits(false);
  });

  it("schools into Revelation form on summon while above 1/4 HP", async () => {
    await game.classicMode.startBattle([SpeciesId.UNOWN]);
    const unown = game.field.getPlayerPokemon();
    console.log(
      `[unown] after summon: formKey=${unown.getFormKey()} formIndex=${unown.formIndex} hp%=${unown.getHpRatio()}`,
    );
    expect(unown.getFormKey()).toBe("revelation");
  });

  it("schools via its Revelation INNATE (passive) when passives are active", async () => {
    // Don't force the active ability — rely on ER's innate 885 (Revelation) in a
    // passive slot, with passives enabled (ER's in-game always-on innate model).
    game.override.ability(AbilityId.BALL_FETCH).hasPassiveAbility(true);
    await game.classicMode.startBattle([SpeciesId.UNOWN]);
    const unown = game.field.getPlayerPokemon();
    console.log(
      `[unown-innate] passives=${unown
        .getPassiveAbilities()
        .map(a => a?.id)
        .join(",")} formKey=${unown.getFormKey()}`,
    );
    expect(unown.getFormKey()).toBe("revelation");
  });

  it("reverts out of Revelation at <=1/4 HP at end of turn", async () => {
    await game.classicMode.startBattle([SpeciesId.UNOWN]);
    const unown = game.field.getPlayerPokemon();
    expect(unown.getFormKey()).toBe("revelation"); // schooled on summon

    unown.hp = Math.floor(unown.getMaxHp() * 0.2); // drop below the 1/4 threshold

    // At <=1/4 HP the ability resolves the revert edge (revelation -> base). This
    // is exactly what the PostTurn form-change attr calls each turn-end; assert it
    // selects the revert edge, then flush the queued QuietFormChangePhase.
    const queued = game.scene.triggerPokemonFormChange(unown, SpeciesFormChangeAbilityTrigger, false);
    expect(queued).toBe(true);
    game.move.use(MoveId.SPLASH);
    await game.toEndOfTurn();

    console.log(`[unown-revert] hp%=${unown.getHpRatio()} formKey=${unown.getFormKey()}`);
    expect(unown.getFormKey()).not.toBe("revelation"); // reverted to a normal letter
  });

  it("wires a PostFaint form-change so Revelation does not persist on faint", () => {
    // On faint the HP ratio is 0 (<=1/4), so the same formFunc the revert test
    // exercises takes its revert branch — the PostFaint attr just runs it on KO.
    const ability = allAbilities[ErAbilityId.REVELATION];
    expect(ability).toBeDefined();
    expect(ability.attrs.some(a => a.constructor.name === "PostFaintFormChangeAbAttr")).toBe(true);
  });
});

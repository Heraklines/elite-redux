/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// #109 — Bouffalant's innate Rock Head must block recoil (player report: a
// player Bouffalant using a recoil move still took recoil).
//
// Bouffalant's ER innate set includes Rock Head. Rock Head carries
// BlockRecoilDamageAttr; RecoilAttr.apply() cancels recoil when
// applyAbAttrs("BlockRecoilDamageAttr") sets cancelled=true. This test
// reproduces the player-side scenario and asserts no recoil is taken.
//
// Gated behind ER_SCENARIO=1.
// =============================================================================

import { allAbilities } from "#data/data-lists";
import { AbilityId } from "#enums/ability-id";
import { MoveId } from "#enums/move-id";
import { Passive as PassiveAttr } from "#enums/passive";
import { SpeciesId } from "#enums/species-id";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

const RUN_SCENARIOS = process.env.ER_SCENARIO === "1";

describe.skipIf(!RUN_SCENARIOS)("ER Rock Head innate blocks recoil (#109)", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
  });

  it("diagnostic: Bouffalant active ability + innates + recoil-block detection", async () => {
    game.override
      .battleStyle("single")
      .hasPassiveAbility(true)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemySpecies(SpeciesId.SNORLAX)
      .enemyMoveset(MoveId.SPLASH)
      .moveset(MoveId.HEAD_CHARGE)
      .startingLevel(100)
      .enemyLevel(100)
      .criticalHits(false);
    await game.classicMode.startBattle([SpeciesId.BOUFFALANT]);
    const p = game.field.getPlayerPokemon();
    const active = p.getAbility();
    // eslint-disable-next-line no-console
    console.log(
      "BOUFFALANT DIAG",
      JSON.stringify({
        active: `${active.id}:${active.name}`,
        innates: p.getPassiveAbilities().map(a => (a ? `${a.id}:${a.name}` : null)),
        hasPassive: p.hasPassive(),
        hasRockHead: p.hasAbility(AbilityId.ROCK_HEAD),
        blocksRecoil: p.hasAbilityWithAttr("BlockRecoilDamageAttr"),
        rockHeadHasBlockAttr: allAbilities[AbilityId.ROCK_HEAD]?.hasAttr("BlockRecoilDamageAttr"),
      }),
    );
    expect(active).toBeDefined();
  });

  it("Head Charge deals no recoil when Rock Head innate is active", async () => {
    game.override
      .battleStyle("single")
      .hasPassiveAbility(true)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemySpecies(SpeciesId.SNORLAX)
      .enemyMoveset(MoveId.SPLASH)
      .moveset(MoveId.HEAD_CHARGE)
      .startingLevel(100)
      .enemyLevel(100)
      .criticalHits(false);
    await game.classicMode.startBattle([SpeciesId.BOUFFALANT]);
    const p = game.field.getPlayerPokemon();
    const hpBefore = p.hp;
    game.move.use(MoveId.HEAD_CHARGE);
    await game.toEndOfTurn();
    // Recoil blocked by Rock Head ⇒ HP unchanged (Snorlax does nothing).
    expect(p.hp, "Bouffalant should take 0 recoil with Rock Head innate active").toBe(hpBefore);
  });

  // The real #109 fix: drive activation via per-slot passiveAttr (NO override).
  // Previously canApplyAbility/hasPassive used a single flag true only when EXACTLY
  // slot 0 was unlocked+enabled, so unlocking a second slot silently disabled the
  // slot-0 innate (Rock Head) → recoil came back.
  it("Rock Head (slot 0) still blocks recoil when slot 1 is ALSO unlocked (no override)", async () => {
    game.override
      .battleStyle("single")
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemySpecies(SpeciesId.SNORLAX)
      .enemyMoveset(MoveId.SPLASH)
      .moveset(MoveId.HEAD_CHARGE)
      .startingLevel(100)
      .enemyLevel(100)
      .criticalHits(false);
    await game.classicMode.startBattle([SpeciesId.BOUFFALANT]);
    const p = game.field.getPlayerPokemon();
    const root = p.species.getRootSpeciesId();
    // Unlock+enable slot 0 (Rock Head) AND slot 1 (Anger Point). The old single
    // flag (passiveAttr ^ 0b11) would now be non-zero ⇒ this.passive false ⇒ bug.
    game.scene.gameData.starterData[root].passiveAttr =
      PassiveAttr.UNLOCKED_1 | PassiveAttr.ENABLED_1 | PassiveAttr.UNLOCKED_2 | PassiveAttr.ENABLED_2;
    expect(p.hasAbility(AbilityId.ROCK_HEAD), "Rock Head detected with multiple slots unlocked").toBe(true);
    const hpBefore = p.hp;
    game.move.use(MoveId.HEAD_CHARGE);
    await game.toEndOfTurn();
    expect(p.hp, "Rock Head blocks recoil even with slot 1 also unlocked").toBe(hpBefore);
  });

  it("recoil IS taken when the Rock Head slot is unlocked but DISABLED", async () => {
    game.override
      .battleStyle("single")
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemySpecies(SpeciesId.SNORLAX)
      .enemyMoveset(MoveId.SPLASH)
      .moveset(MoveId.HEAD_CHARGE)
      .startingLevel(100)
      .enemyLevel(100)
      .criticalHits(false);
    await game.classicMode.startBattle([SpeciesId.BOUFFALANT]);
    const p = game.field.getPlayerPokemon();
    const root = p.species.getRootSpeciesId();
    // Slot 0 unlocked but NOT enabled ⇒ Rock Head inactive ⇒ recoil applies.
    game.scene.gameData.starterData[root].passiveAttr = PassiveAttr.UNLOCKED_1;
    expect(p.hasAbility(AbilityId.ROCK_HEAD), "disabled slot not active").toBe(false);
    const hpBefore = p.hp;
    game.move.use(MoveId.HEAD_CHARGE);
    await game.toEndOfTurn();
    expect(p.hp, "recoil taken when Rock Head slot disabled").toBeLessThan(hpBefore);
  });
});

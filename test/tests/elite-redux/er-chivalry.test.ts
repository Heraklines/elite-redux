import { CHIVALRY_ALLY_TRANSFER_FRACTION, ER_CHIVALRY_ABILITY_ID } from "#data/elite-redux/abilities/chivalry";
import { AbilityId } from "#enums/ability-id";
import { HitResult } from "#enums/hit-result";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";
const CHIVALRY = ER_CHIVALRY_ABILITY_ID as AbilityId;

describe.skipIf(!RUN)("ER Chivalry (5909)", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
    game.override
      .criticalHits(false)
      .startingLevel(100)
      .enemyLevel(100)
      .enemySpecies(SpeciesId.SNORLAX)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemyMoveset(MoveId.HARDEN)
      .ability(CHIVALRY)
      .moveset(MoveId.HARDEN);
  });

  it("doubles: the holder absorbs 50% of a direct hit aimed at its ally as raw HP", async () => {
    game.override.battleStyle("double");
    await game.classicMode.startBattle(SpeciesId.DRAGONITE, SpeciesId.SNORLAX);
    const [holder, ally] = game.scene.getPlayerField();
    const attacker = game.scene.getEnemyField()[0];

    const D = 120;
    const expectedShare = Math.floor(D * CHIVALRY_ALLY_TRANSFER_FRACTION);
    ally.damageAndUpdate(D, { result: HitResult.EFFECTIVE, source: attacker });

    // The ally kept the other half; the holder took exactly the raw 50% share.
    expect(ally.getInverseHp()).toBe(D - expectedShare);
    expect(holder.getInverseHp()).toBe(expectedShare);
  });

  it("doubles NERF: Multiscale on the holder does NOT reduce the transferred share", async () => {
    // Chivalry is the active ability; Multiscale is a passive, active at full HP.
    game.override.battleStyle("double").passiveAbility(AbilityId.MULTISCALE);
    await game.classicMode.startBattle(SpeciesId.DRAGONITE, SpeciesId.SNORLAX);
    const [holder, ally] = game.scene.getPlayerField();
    const attacker = game.scene.getEnemyField()[0];
    expect(holder.isFullHp()).toBe(true);

    const D = 120;
    const expectedShare = Math.floor(D * CHIVALRY_ALLY_TRANSFER_FRACTION);
    ally.damageAndUpdate(D, { result: HitResult.EFFECTIVE, source: attacker });

    // Multiscale (which would halve a real hit on the full-HP holder) is bypassed —
    // the raw INDIRECT transfer takes the full 50% share.
    expect(holder.getInverseHp()).toBe(expectedShare);
  });

  it("singles: after a voluntary switch, the incoming mon redirects 25% of a direct hit to the off-field holder", async () => {
    game.override.battleStyle("single");
    await game.classicMode.startBattle(SpeciesId.DRAGONITE, SpeciesId.SNORLAX);
    const holder = game.scene.getPlayerParty()[0];

    game.doSwitchPokemon(1);
    await game.toNextTurn();

    const incoming = game.field.getPlayerPokemon();
    expect(incoming.species.speciesId).toBe(SpeciesId.SNORLAX);
    const attacker = game.field.getEnemyPokemon();

    const D = 120;
    const expectedShare = Math.floor(D * 0.25);
    incoming.damageAndUpdate(D, { result: HitResult.EFFECTIVE, source: attacker });

    expect(incoming.getInverseHp()).toBe(D - expectedShare);
    expect(holder.getInverseHp()).toBe(expectedShare);
  });

  it("singles: the off-field holder CAN faint from the redirect, safely", async () => {
    game.override.battleStyle("single");
    await game.classicMode.startBattle(SpeciesId.DRAGONITE, SpeciesId.SNORLAX);
    const holder = game.scene.getPlayerParty()[0];

    game.doSwitchPokemon(1);
    await game.toNextTurn();

    const incoming = game.field.getPlayerPokemon();
    const attacker = game.field.getEnemyPokemon();
    // Leave the off-field holder with less HP than the redirected share (25% of 100 = 25).
    holder.hp = 5;

    incoming.damageAndUpdate(100, { result: HitResult.EFFECTIVE, source: attacker });

    // The holder fainted in the back (raw HP to 0), with no summon-phase corruption.
    expect(holder.isFainted()).toBe(true);
    expect(holder.hp).toBe(0);
    // The incoming mon survived (it only took the non-redirected portion here anyway).
    expect(incoming.isFainted()).toBe(false);
  });
});

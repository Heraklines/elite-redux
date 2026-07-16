import { ER_HEARTBREAK_ABILITY_ID } from "#data/elite-redux/abilities/heartbreak";
import { areLinked } from "#data/elite-redux/abilities/link";
import { ER_RENDEZVOUS_ABILITY_ID, RENDEZVOUS_HEAL_FRACTION } from "#data/elite-redux/abilities/rendezvous";
import {
  ER_SOULMATE_ABILITY_ID,
  SOULMATE_DAMAGE_REDIRECT_FRACTION,
  SOULMATE_HEAL_COPY_FRACTION,
} from "#data/elite-redux/abilities/soulmate";
import { resetTurnAttackLedger } from "#data/elite-redux/abilities/turn-attack-ledger";
import { AbilityId } from "#enums/ability-id";
import { BattlerIndex } from "#enums/battler-index";
import { HitResult } from "#enums/hit-result";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { Stat } from "#enums/stat";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";
const SOULMATE = ER_SOULMATE_ABILITY_ID as AbilityId;
const RENDEZVOUS = ER_RENDEZVOUS_ABILITY_ID as AbilityId;
const HEARTBREAK = ER_HEARTBREAK_ABILITY_ID as AbilityId;

describe.skipIf(!RUN)("ER Discupid trio — LINK primitive (5918-5920)", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    resetTurnAttackLedger();
    game = new GameManager(phaserGame);
    game.override
      .criticalHits(false)
      .startingLevel(100)
      .enemyLevel(100)
      .enemySpecies(SpeciesId.SNORLAX)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemyMoveset(MoveId.SPLASH)
      .moveset(MoveId.SPLASH)
      .battleStyle("double");
  });

  it("Soulmate: link forms on entry and 25% of the ally's direct damage is redirected to the holder", async () => {
    game.override.ability(SOULMATE);
    await game.classicMode.startBattle(SpeciesId.TOGEKISS, SpeciesId.SNORLAX);
    const [holder, ally] = game.scene.getPlayerField();
    const attacker = game.scene.getEnemyField()[0];
    expect(areLinked(holder, ally)).toBe(true);

    const D = 120;
    const expectedShare = Math.floor(D * SOULMATE_DAMAGE_REDIRECT_FRACTION);
    ally.damageAndUpdate(D, { result: HitResult.EFFECTIVE, source: attacker });

    expect(ally.getInverseHp()).toBe(D - expectedShare);
    expect(holder.getInverseHp()).toBe(expectedShare);
  });

  it("Soulmate: 50% of the holder's direct healing is copied to the ally, and the copy cannot recurse", async () => {
    // Both mons carry Soulmate, so a naive heal-copy would ping-pong; the guard stops it.
    game.override.ability(SOULMATE);
    await game.classicMode.startBattle(SpeciesId.TOGEKISS, SpeciesId.SNORLAX);
    const [holder, ally] = game.scene.getPlayerField();
    holder.hp = Math.floor(holder.getMaxHp() * 0.4);
    ally.hp = Math.floor(ally.getMaxHp() * 0.4);
    const allyBefore = ally.hp;

    const healed = holder.heal(80);
    expect(healed).toBe(80);
    // Ally gained exactly 50% of the holder's heal — once, no recursion back to the holder.
    expect(ally.hp - allyBefore).toBe(Math.floor(80 * SOULMATE_HEAL_COPY_FRACTION));
  });

  it("Soulmate: the link tears down when the ally leaves the field (faints)", async () => {
    game.override.ability(SOULMATE);
    await game.classicMode.startBattle(SpeciesId.TOGEKISS, SpeciesId.SNORLAX);
    const [holder, ally] = game.scene.getPlayerField();
    expect(areLinked(holder, ally)).toBe(true);

    ally.hp = 0;
    expect(areLinked(holder, ally)).toBe(false);
  });

  it("Rendezvous: both linked mons heal 5% when they coordinate on the same foe", async () => {
    // Both player mons (faster than the wild foe) target enemy slot 0. We assert
    // right after BOTH player moves resolve — before the slower foe ever acts —
    // so the holder's HP reflects only the Rendezvous heal, no enemy interference.
    game.override.ability(RENDEZVOUS).moveset(MoveId.WATER_GUN);
    await game.classicMode.startBattle(SpeciesId.TOGEKISS, SpeciesId.PLUSLE);
    const [holder, ally] = game.scene.getPlayerField();
    holder.hp = Math.floor(holder.getMaxHp() * 0.5);
    ally.hp = Math.floor(ally.getMaxHp() * 0.5);
    const holderBefore = holder.hp;
    const allyBefore = ally.hp;

    game.move.select(MoveId.WATER_GUN, 0, 2);
    game.move.select(MoveId.WATER_GUN, 1, 2);
    // Two player MoveEndPhases (Plusle then Togekiss) — heal lands on the second.
    await game.phaseInterceptor.to("MoveEndPhase");
    await game.phaseInterceptor.to("MoveEndPhase");

    expect(holder.hp).toBe(holderBefore + Math.floor(holder.getMaxHp() * RENDEZVOUS_HEAL_FRACTION));
    expect(ally.hp).toBe(allyBefore + Math.floor(ally.getMaxHp() * RENDEZVOUS_HEAL_FRACTION));
  });

  it("Rendezvous: the SECOND coordinated move gains ~20% power vs the first", async () => {
    // Two IDENTICAL attackers on one bulky foe so the two hits are comparable.
    // Onix (BST 385) is under the BST cap so it is not swapped; +6 Def keeps it
    // alive across both hits with its Defense constant between them.
    game.override.ability(RENDEZVOUS).moveset(MoveId.TACKLE).enemySpecies(SpeciesId.ONIX);
    await game.classicMode.startBattle(SpeciesId.PLUSLE, SpeciesId.PLUSLE);
    const enemy = game.scene.getEnemyField()[0];
    enemy.setStatStage(Stat.DEF, 6);

    const hpStart = enemy.hp;
    game.move.select(MoveId.TACKLE, 0, 2);
    game.move.select(MoveId.TACKLE, 1, 2);
    await game.move.forceEnemyMove(MoveId.SPLASH);
    await game.move.forceEnemyMove(MoveId.SPLASH);

    // First attacker's hit.
    await game.phaseInterceptor.to("MoveEndPhase");
    const afterFirst = enemy.hp;
    const firstHit = hpStart - afterFirst;
    // Second (coordinated) attacker's hit — carries the +20%.
    await game.phaseInterceptor.to("MoveEndPhase");
    const secondHit = afterFirst - enemy.hp;

    expect(firstHit).toBeGreaterThan(0);
    expect(secondHit).toBeGreaterThan(firstHit);
    expect(secondHit).toBeLessThanOrEqual(Math.ceil(firstHit * 1.2) + 1);
  });

  it("Heartbreak: when the linked ally faints, the holder gains Speed/attack and loses defenses", async () => {
    game.override.ability(HEARTBREAK).moveset(MoveId.SPLASH);
    await game.classicMode.startBattle(SpeciesId.TOGEKISS, SpeciesId.MAGIKARP);
    const [holder, ally] = game.scene.getPlayerField();
    expect(areLinked(holder, ally)).toBe(true);
    const higherAttack = holder.getStat(Stat.ATK) >= holder.getStat(Stat.SPATK) ? Stat.ATK : Stat.SPATK;
    ally.hp = 1; // frail ally, one tackle KOs it

    game.move.select(MoveId.SPLASH, 0);
    game.move.select(MoveId.SPLASH, 1);
    // Both foes tackle the ally (BattlerIndex.PLAYER_2) so it faints this turn.
    await game.move.forceEnemyMove(MoveId.TACKLE, BattlerIndex.PLAYER_2);
    await game.move.forceEnemyMove(MoveId.TACKLE, BattlerIndex.PLAYER_2);
    await game.phaseInterceptor.to("BerryPhase", false);

    expect(ally.isFainted()).toBe(true);
    expect(holder.getStatStage(Stat.SPD)).toBe(1);
    expect(holder.getStatStage(higherAttack)).toBe(1);
    expect(holder.getStatStage(Stat.DEF)).toBe(-1);
    expect(holder.getStatStage(Stat.SPDEF)).toBe(-1);
  });
});

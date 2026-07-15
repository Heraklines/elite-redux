import { clearCharge, getCharge, resetActiveTurns, setCharge } from "#data/elite-redux/abilities/charge-stack";
import {
  ER_CAPACITOR_BANK_ABILITY_ID,
  ER_FAULT_CURRENT_ABILITY_ID,
  ER_OVERLOADED_ABILITY_ID,
  FAULT_CURRENT_BP_PER_STACK,
} from "#data/elite-redux/abilities/electivire";
import { AbilityId } from "#enums/ability-id";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";
const CAPACITOR = ER_CAPACITOR_BANK_ABILITY_ID as AbilityId;
const FAULT = ER_FAULT_CURRENT_ABILITY_ID as AbilityId;
const OVERLOADED = ER_OVERLOADED_ABILITY_ID as AbilityId;

describe.skipIf(!RUN)("ER Mega Electivire trio (5925-5927)", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
    game.override
      .battleStyle("single")
      .criticalHits(false)
      .startingLevel(100)
      .enemyLevel(100)
      .enemySpecies(SpeciesId.SNORLAX)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemyMoveset(MoveId.TACKLE)
      .ability(CAPACITOR)
      .moveset([MoveId.TACKLE, MoveId.THUNDERBOLT, MoveId.HARDEN]);
  });

  it("Capacitor Bank: +1 on landing an attack and +1 on being hit (stacks toward 4)", async () => {
    await game.classicMode.startBattle(SpeciesId.ELECTIVIRE);
    const holder = game.field.getPlayerPokemon();
    clearCharge(holder);

    // Holder tackles (lands an attack: +1) and is tackled back (hit: +1).
    game.move.select(MoveId.TACKLE);
    await game.toEndOfTurn();

    expect(getCharge(holder)).toBe(2);
  });

  it("Capacitor Bank: a multi-hit incoming move grants only ONE stack", async () => {
    game.override.enemyMoveset(MoveId.DOUBLE_KICK); // 2 fixed hits
    await game.classicMode.startBattle(SpeciesId.ELECTIVIRE);
    const holder = game.field.getPlayerPokemon();
    clearCharge(holder);

    game.move.select(MoveId.HARDEN); // holder doesn't attack, so only the defend gain counts
    await game.toEndOfTurn();

    // One stack from the 2-hit move (not two).
    expect(getCharge(holder)).toBe(1);
  });

  it("Capacitor Bank: absorbs an Electric move (immune) and gains a stack", async () => {
    game.override.enemyMoveset(MoveId.THUNDERBOLT);
    await game.classicMode.startBattle(SpeciesId.ELECTIVIRE);
    const holder = game.field.getPlayerPokemon();
    clearCharge(holder);
    const hp = holder.hp;

    game.move.select(MoveId.HARDEN);
    await game.toEndOfTurn();

    // No damage taken (absorbed) and a stack gained.
    expect(holder.hp).toBe(hp);
    expect(getCharge(holder)).toBe(1);
  });

  it("Capacitor Bank: the holder's Electric move consumes ONE stack", async () => {
    await game.classicMode.startBattle(SpeciesId.ELECTIVIRE);
    const holder = game.field.getPlayerPokemon();
    setCharge(holder, 3);

    game.move.select(MoveId.THUNDERBOLT);
    await game.phaseInterceptor.to("MoveEndPhase");

    // Used an Electric move: -1 (consume). The +1 attack gain also fires, so net
    // is 3 - 1 + 1 = 3. Confirm it did not spend ALL stacks.
    expect(getCharge(holder)).toBe(3);
  });

  it("Fault Current: discharges every 2nd turn at 15 BP per stack, resetting stacks", async () => {
    game.override.ability(FAULT).enemyMoveset(MoveId.HARDEN);
    await game.classicMode.startBattle(SpeciesId.ELECTIVIRE);
    const holder = game.field.getPlayerPokemon();
    const enemy = game.field.getEnemyPokemon();
    setCharge(holder, 3);
    resetActiveTurns(holder);
    enemy.hp = enemy.getMaxHp();

    // Turn 1 (odd): no discharge yet.
    game.move.select(MoveId.HARDEN);
    await game.toEndOfTurn();
    expect(getCharge(holder)).toBe(3);
    const hpAfterT1 = enemy.hp;

    // Turn 2 (even): discharge all 3 stacks (45 BP spread) and reset to 0.
    setCharge(holder, 3);
    game.move.select(MoveId.HARDEN);
    await game.toEndOfTurn();

    expect(getCharge(holder)).toBe(0);
    expect(enemy.hp).toBeLessThan(hpAfterT1);
    expect(FAULT_CURRENT_BP_PER_STACK).toBe(15);
  });

  it("Overloaded: +25% Electric power and +1 priority while at 4 stacks", async () => {
    game.override.ability(OVERLOADED).enemyMoveset(MoveId.HARDEN).enemySpecies(SpeciesId.SNORLAX);
    await game.classicMode.startBattle(SpeciesId.ELECTIVIRE);
    const holder = game.field.getPlayerPokemon();
    const enemy = game.field.getEnemyPokemon();
    const tbolt = holder
      .getMoveset()
      .find(m => m.moveId === MoveId.THUNDERBOLT)!
      .getMove();

    setCharge(holder, 0);
    const basePrio = tbolt.getPriority(holder);
    const basePower = tbolt.calculateBattlePower(holder, enemy);

    setCharge(holder, 4);
    const overPrio = tbolt.getPriority(holder);
    const overPower = tbolt.calculateBattlePower(holder, enemy);

    expect(overPrio).toBe(basePrio + 1);
    expect(overPower).toBeGreaterThan(basePower);
  });

  it("Overloaded: cannot voluntarily switch out at 4 stacks, and chips 1/8 HP at end of turn", async () => {
    // Both sides use Harden (a true no-damage status move) so the only HP loss is
    // the Overloaded end-of-turn chip.
    game.override.ability(OVERLOADED).enemySpecies(SpeciesId.MAGIKARP).enemyMoveset(MoveId.HARDEN);
    await game.classicMode.startBattle(SpeciesId.ELECTIVIRE, SpeciesId.PIKACHU);
    const holder = game.field.getPlayerPokemon();
    setCharge(holder, 4);
    holder.hp = 200;

    // Switch is locked at 4 stacks.
    expect(holder.isTrapped()).toBe(true);

    // End-of-turn chip: 1/8 max HP while still at 4 stacks (both sides Harden → no
    // other damage), so the loss is exactly floor(maxHp/8) from the fixed 200 HP.
    game.move.select(MoveId.HARDEN);
    await game.toEndOfTurn();
    expect(200 - holder.hp).toBe(Math.floor(holder.getMaxHp() / 8));
  });
});

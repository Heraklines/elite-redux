import { ER_QUICKENING_GRACE_ABILITY_ID } from "#data/elite-redux/abilities/quickening-grace";
import { AbilityId } from "#enums/ability-id";
import { BattlerIndex } from "#enums/battler-index";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { Stat } from "#enums/stat";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";
const QUICKENING_GRACE = ER_QUICKENING_GRACE_ABILITY_ID as AbilityId;

describe.skipIf(!RUN)("ER Quickening Grace (5913)", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
    game.override
      .battleStyle("double")
      .criticalHits(false)
      .startingLevel(100)
      .enemyLevel(100)
      .enemySpecies(SpeciesId.SNORLAX)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemyMoveset(MoveId.HARDEN)
      .ability(QUICKENING_GRACE)
      // slot 0 (holder) uses HARDEN; slot 1 (ally) uses the charge move under test.
      .moveset([MoveId.HARDEN, MoveId.SOLAR_BEAM, MoveId.GEOMANCY]);
  });

  it("skips the charge turn of an ally's attacking two-turn move (Solar Beam fires turn 1)", async () => {
    await game.classicMode.startBattle(SpeciesId.XERNEAS, SpeciesId.VENUSAUR);
    const foe = game.scene.getEnemyField()[0];
    const foeBefore = foe.hp;

    game.move.select(MoveId.HARDEN, 0);
    game.move.select(MoveId.SOLAR_BEAM, 1, BattlerIndex.ENEMY);
    await game.toEndOfTurn();

    // Without the charge skip, turn 1 would only charge and deal no damage.
    expect(foe.hp).toBeLessThan(foeBefore);
  });

  it("control: WITHOUT Quickening Grace the same Solar Beam only charges turn 1 (no damage)", async () => {
    game.override.ability(AbilityId.BALL_FETCH);
    await game.classicMode.startBattle(SpeciesId.XERNEAS, SpeciesId.VENUSAUR);
    const foe = game.scene.getEnemyField()[0];
    const foeBefore = foe.hp;

    game.move.select(MoveId.HARDEN, 0);
    game.move.select(MoveId.SOLAR_BEAM, 1, BattlerIndex.ENEMY);
    await game.toEndOfTurn();

    // Charging turn: the foe took no damage.
    expect(foe.hp).toBe(foeBefore);
  });

  it("does NOT skip Geomancy (a status charge move) — it still charges turn 1", async () => {
    await game.classicMode.startBattle(SpeciesId.XERNEAS, SpeciesId.VENUSAUR);
    const [, ally] = game.scene.getPlayerField();

    game.move.select(MoveId.HARDEN, 0);
    game.move.select(MoveId.GEOMANCY, 1);
    await game.toEndOfTurn();

    // Geomancy raises SpAtk/SpDef/Spd +2 only on its RELEASE turn. If QG had
    // wrongly hastened it, the boosts would already be present after turn 1.
    expect(ally.getStatStage(Stat.SPATK)).toBe(0);
    expect(ally.getStatStage(Stat.SPD)).toBe(0);
  });
});

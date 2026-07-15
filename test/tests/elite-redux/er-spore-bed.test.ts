import { ErEntryTrapTag } from "#data/arena-tag";
import { ER_SPORE_BED_ABILITY_ID } from "#data/elite-redux/abilities/spore-bed";
import { AbilityId } from "#enums/ability-id";
import { ArenaTagSide } from "#enums/arena-tag-side";
import { ArenaTagType } from "#enums/arena-tag-type";
import { BattlerTagType } from "#enums/battler-tag-type";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";
const SPORE_BED = ER_SPORE_BED_ABILITY_ID as AbilityId;

describe.skipIf(!RUN)("ER Spore Bed (5902) — Infestation entry trap", () => {
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
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemyMoveset(MoveId.HARDEN)
      .ability(SPORE_BED);
  });

  it("lays an ER Infestation trap on the opposing side on entry, without catching the already-present foe", async () => {
    game.override.enemySpecies(SpeciesId.MAGIKARP);
    await game.classicMode.startBattle([SpeciesId.SNORLAX]);

    const trap = game.scene.arena.getTagOnSide(ArenaTagType.ER_INFESTATION_TRAP, ArenaTagSide.ENEMY);
    expect(trap).toBeInstanceOf(ErEntryTrapTag);
    // The foe that was already on the field when Spore Bed's holder entered is NOT caught.
    expect(game.field.getEnemyPokemon().getTag(BattlerTagType.INFESTATION)).toBeUndefined();
  });

  it("catches the next GROUNDED opposing switch-in with Infestation, then is spent (one-use)", async () => {
    game.override.enemySpecies(SpeciesId.MAGIKARP);
    await game.classicMode.startBattle([SpeciesId.SNORLAX]);

    const enemy = game.field.getEnemyPokemon();
    const trap = game.scene.arena.getTagOnSide(ArenaTagType.ER_INFESTATION_TRAP, ArenaTagSide.ENEMY) as ErEntryTrapTag;
    expect(trap).toBeInstanceOf(ErEntryTrapTag);
    expect(enemy.isGrounded()).toBe(true);

    // Simulate the grounded foe switching into the trap.
    const applied = trap.apply(false, enemy);
    expect(applied).toBe(true);
    expect(enemy.getTag(BattlerTagType.INFESTATION)).toBeDefined();
    expect(trap.consumed).toBe(true);

    // One-use: a subsequent switch-in is unaffected.
    enemy.removeTag(BattlerTagType.INFESTATION);
    const appliedAgain = trap.apply(false, enemy);
    expect(appliedAgain).toBe(false);
    expect(enemy.getTag(BattlerTagType.INFESTATION)).toBeUndefined();
  });

  it("does NOT catch an ungrounded (Flying) switch-in, and stays armed", async () => {
    // Pidgey is Normal/Flying → ungrounded → immune to a grounded-only entry trap.
    game.override.enemySpecies(SpeciesId.PIDGEY);
    await game.classicMode.startBattle([SpeciesId.SNORLAX]);

    const enemy = game.field.getEnemyPokemon();
    const trap = game.scene.arena.getTagOnSide(ArenaTagType.ER_INFESTATION_TRAP, ArenaTagSide.ENEMY) as ErEntryTrapTag;
    expect(enemy.isGrounded()).toBe(false);

    const applied = trap.apply(false, enemy);
    expect(applied).toBe(false);
    expect(enemy.getTag(BattlerTagType.INFESTATION)).toBeUndefined();
    // Still armed for a future grounded switch-in.
    expect(trap.consumed).toBe(false);
  });
});

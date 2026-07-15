import {
  ER_WORLD_IN_PIECES_ABILITY_ID,
  erWorldInPiecesAttached,
  WORLD_IN_PIECES_TYPES,
} from "#data/elite-redux/abilities/world-in-pieces";
import { AbilityId } from "#enums/ability-id";
import { MoveId } from "#enums/move-id";
import { PokemonType } from "#enums/pokemon-type";
import { SpeciesId } from "#enums/species-id";
import { Stat } from "#enums/stat";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";
const WORLD_IN_PIECES = ER_WORLD_IN_PIECES_ABILITY_ID as AbilityId;

describe.skipIf(!RUN)("ER World in Pieces (5917)", () => {
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
      .ability(WORLD_IN_PIECES)
      .moveset(MoveId.HARDEN);
  });

  it("stamps all six types on entry, and N-type effectiveness multiplies over all of them", async () => {
    await game.classicMode.startBattle(SpeciesId.SNORLAX);
    const holder = game.field.getPlayerPokemon();
    const enemy = game.field.getEnemyPokemon();

    const types = holder.getTypes();
    expect(types.length).toBe(6);
    for (const t of WORLD_IN_PIECES_TYPES) {
      expect(types).toContain(t);
    }

    // Fighting is super-effective vs Normal/Rock/Ice/Steel (2x each) and neutral
    // vs Electric/Dragon → 2^4 = 16x, proving the product runs over all six types.
    expect(holder.getAttackTypeEffectiveness(PokemonType.FIGHTING, { source: enemy })).toBeCloseTo(16, 5);
  });

  it("UI substrate: the battle-info panel lays out all six type icons", async () => {
    await game.classicMode.startBattle(SpeciesId.SNORLAX);
    const holder = game.field.getPlayerPokemon();
    await holder.updateInfo();

    // 3 fixed icons (type1/2/3) + 3 lazily-created extras, all visible for 6 types.
    const info = (
      holder as unknown as {
        battleInfo: {
          type2Icon: { visible: boolean };
          type3Icon: { visible: boolean };
          extraTypeIcons: { visible: boolean }[];
        };
      }
    ).battleInfo;
    expect(info.type2Icon.visible).toBe(true);
    expect(info.type3Icon.visible).toBe(true);
    const visibleExtras = info.extraTypeIcons.filter(icon => icon.visible);
    expect(visibleExtras.length).toBe(3);
  });

  it("the first direct hit each turn strips ONE non-Normal type (Normal never removed)", async () => {
    await game.classicMode.startBattle(SpeciesId.SNORLAX);
    const holder = game.field.getPlayerPokemon();
    expect(erWorldInPiecesAttached(holder)?.length).toBe(6);

    game.move.select(MoveId.HARDEN);
    await game.toEndOfTurn();

    const attached = erWorldInPiecesAttached(holder)!;
    expect(attached.length).toBe(5);
    expect(attached).toContain(PokemonType.NORMAL);
  });

  it("a multi-hit move still strips only ONE type per turn", async () => {
    // Twineedle: 2 fixed Bug hits (0.5x here) — the holder survives, and only one
    // type is stripped despite two hits.
    game.override.enemyMoveset(MoveId.TWINEEDLE);
    await game.classicMode.startBattle(SpeciesId.SNORLAX);
    const holder = game.field.getPlayerPokemon();

    game.move.select(MoveId.HARDEN);
    await game.toEndOfTurn();

    expect(erWorldInPiecesAttached(holder)?.length).toBe(5);
  });

  it("each missing type grants +20% effective Speed", async () => {
    await game.classicMode.startBattle(SpeciesId.SNORLAX);
    const holder = game.field.getPlayerPokemon();
    // Full six types → no bonus.
    const speedFull = holder.getEffectiveStat(Stat.SPD);

    game.move.select(MoveId.HARDEN);
    await game.toEndOfTurn();

    // One type stripped → +20% Speed.
    expect(erWorldInPiecesAttached(holder)?.length).toBe(5);
    const speedOneMissing = holder.getEffectiveStat(Stat.SPD);
    expect(speedOneMissing / speedFull).toBeGreaterThan(1.18);
    expect(speedOneMissing / speedFull).toBeLessThan(1.22);
  });

  it("scoring a KO restores one missing type", async () => {
    game.override.moveset([MoveId.QUICK_ATTACK, MoveId.HARDEN]);
    await game.classicMode.startBattle(SpeciesId.SNORLAX);
    const holder = game.field.getPlayerPokemon();
    const enemy = game.field.getEnemyPokemon();

    // Turn 1: take a hit → strip one type.
    game.move.select(MoveId.HARDEN);
    await game.toEndOfTurn();
    expect(erWorldInPiecesAttached(holder)?.length).toBe(5);

    // Turn 2: KO the (1 HP) enemy with a priority move so it faints before acting.
    enemy.hp = 1;
    game.move.select(MoveId.QUICK_ATTACK);
    await game.toEndOfTurn();

    expect(enemy.isFainted()).toBe(true);
    // The KO restored a type back to the full six.
    expect(erWorldInPiecesAttached(holder)?.length).toBe(6);
  });
});

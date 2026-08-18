/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { NullifyFirstNHitsAbAttr } from "#data/elite-redux/archetypes/nullify-first-n-hits";
import { ER_ID_MAP } from "#data/elite-redux/er-id-map";
import { AbilityId } from "#enums/ability-id";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";
const GALLANTRY = ER_ID_MAP.abilities[583] as AbilityId;

describe.skipIf(!RUN)("ER Gallantry encounter lifecycle", () => {
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
      .startingLevel(50)
      .hasPassiveAbility(true)
      .moveset(MoveId.CALM_MIND)
      .enemySpecies(SpeciesId.MAGIKARP)
      .enemyLevel(50)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemyMoveset(MoveId.TACKLE);
  });

  it("negates the first damaging hit again when the same party member enters the next wave", async () => {
    // Gallantry is Iron Valiant's third innate. Use its real source layout: a
    // primary-ability override would not exercise an innate's dispatch path.
    await game.classicMode.startBattle(SpeciesId.IRON_VALIANT);
    const player = game.field.getPlayerPokemon();
    const gallantry = player.getActiveAbilitySources().find(source => source.ability.id === GALLANTRY);
    expect(gallantry).toBeDefined();
    expect(gallantry?.ability.attrs.map(attr => attr.constructor.name)).toContain("NullifyFirstNHitsAbAttr");
    const nullify = gallantry?.ability.attrs.find(attr => attr instanceof NullifyFirstNHitsAbAttr);

    const firstBattleHp = player.hp;
    game.move.use(MoveId.CALM_MIND);
    await game.toEndOfTurn();
    expect(nullify?.used(player), "the first incoming damage calculation consumes Gallantry").toBe(1);
    expect(player.hp, "Gallantry blocks the first hit of the initial battle").toBe(firstBattleHp);

    game.move.use(MoveId.CALM_MIND);
    await game.toEndOfTurn();
    expect(player.hp, "Gallantry has only one charge in the battle").toBeLessThan(firstBattleHp);

    await game.doKillOpponents();
    await game.toNextWave();

    const nextBattleHp = player.hp;
    game.move.use(MoveId.CALM_MIND);
    await game.toEndOfTurn();
    expect(player.hp, "Gallantry refreshes for the next battle").toBe(nextBattleHp);
  });
});

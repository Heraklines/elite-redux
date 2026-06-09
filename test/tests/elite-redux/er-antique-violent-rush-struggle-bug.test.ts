/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Regression (#367) — three user reports:
//  - Sinistea/Polteageist ANTIQUE forms had NO innates (ER ships innates
//    [0,0,0] on those records — a data hole; the form now inherits the base
//    species' ER innates).
//  - Kleavor Redux "kept priority": its innate Violent Rush (+50% Speed on the
//    FIRST turn only) must expire after the holder's first move.
//  - Struggle Bug must be ER's version: 80 BP / 100 / 10 PP, NO SpAtk drop,
//    guaranteed crit while the user is below half HP.
//
// Gated behind ER_SCENARIO=1.
// =============================================================================

import { allMoves } from "#data/data-lists";
import { ER_ID_MAP } from "#data/elite-redux/er-id-map";
import { ErCritBelowHalfHpAttr } from "#data/moves/move";
import type { AbilityId } from "#enums/ability-id";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { Stat } from "#enums/stat";
import type { Pokemon } from "#field/pokemon";
import { GameManager } from "#test/framework/game-manager";
import { BooleanHolder } from "#utils/common";
import { getPokemonSpecies } from "#utils/pokemon-utils";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

describe.skipIf(!RUN)("ER Antique innates / Violent Rush expiry / Struggle Bug (#367)", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });
  beforeEach(() => {
    game = new GameManager(phaserGame);
  });

  it("Sinistea + Polteageist Antique forms inherit the base ER innates (were empty)", () => {
    for (const speciesId of [SpeciesId.SINISTEA, SpeciesId.POLTEAGEIST]) {
      const species = getPokemonSpecies(speciesId);
      const antique = species.forms.find(f => f.formKey === "antique") as unknown as {
        _passives: readonly AbilityId[] | null;
      };
      const base = species as unknown as { _passives: readonly AbilityId[] | null };
      expect(antique?._passives, `${SpeciesId[speciesId]} Antique has innates`).toBeTruthy();
      expect(antique._passives?.some(a => (a as number) !== 0)).toBe(true);
      expect(antique._passives).toEqual(base._passives);
    }
  });

  it("Violent Rush: +Speed multiplier applies on the first turn and EXPIRES after the first move", async () => {
    const violentRush = ER_ID_MAP.abilities[350] as AbilityId;
    expect(violentRush, "Violent Rush mapped").toBeDefined();
    game.override
      .ability(violentRush)
      .moveset(MoveId.SPLASH)
      .enemySpecies(SpeciesId.MAGIKARP)
      .enemyMoveset(MoveId.SPLASH);
    await game.classicMode.startBattle(SpeciesId.KLEAVOR);
    const player = game.scene.getPlayerPokemon() as Pokemon;
    const baseSpd = player.getStat(Stat.SPD);
    const firstTurnSpd = player.getEffectiveStat(Stat.SPD);
    expect(firstTurnSpd, "first-turn speed is boosted").toBeGreaterThan(baseSpd);

    game.move.select(MoveId.SPLASH);
    await game.toNextTurn();

    const secondTurnSpd = player.getEffectiveStat(Stat.SPD);
    expect(secondTurnSpd, "boost expired after the first move").toBeLessThan(firstTurnSpd);
    expect(secondTurnSpd).toBe(baseSpd);
  });

  it("Struggle Bug: 80/100/10, no SpAtk drop, crit rider present", () => {
    const m = allMoves[MoveId.STRUGGLE_BUG];
    expect([m.power, m.accuracy, m.pp]).toEqual([80, 100, 10]);
    const names = m.attrs.map(a => a.constructor.name);
    expect(names).not.toContain("StatStageChangeAttr");
    expect(names).toContain("ErCritBelowHalfHpAttr");
  });

  it("ErCritBelowHalfHpAttr crits below half HP and not above", () => {
    const attr = new ErCritBelowHalfHpAttr();
    const move = allMoves[MoveId.STRUGGLE_BUG];
    const lowHp = { getHpRatio: () => 0.4 } as unknown as Pokemon;
    const highHp = { getHpRatio: () => 0.6 } as unknown as Pokemon;
    const target = {} as Pokemon;

    const holderLow = new BooleanHolder(false);
    expect(attr.apply(lowHp, target, move, [holderLow])).toBe(true);
    expect(holderLow.value).toBe(true);

    const holderHigh = new BooleanHolder(false);
    expect(attr.apply(highHp, target, move, [holderHigh])).toBe(false);
    expect(holderHigh.value).toBe(false);
  });
});

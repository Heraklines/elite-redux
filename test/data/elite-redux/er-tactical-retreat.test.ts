/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */
// Tactical Retreat — lowered stat triggers a once-per-battle self-switch.
import { ForceSwitchOutHelper } from "#abilities/ab-attrs";
import { SelfSwitchOnStatLowerAbAttr } from "#data/elite-redux/archetypes/self-switch-on-stat-lower";
import type { AbilityId } from "#enums/ability-id";
import { ErAbilityId } from "#enums/er-ability-id";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { Stat } from "#enums/stat";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, test, vi } from "vitest";

describe("ER Ability - Tactical Retreat", () => {
  let pg: Phaser.Game;
  let game: GameManager;
  beforeAll(() => {
    pg = new Phaser.Game({ type: Phaser.HEADLESS });
  });
  beforeEach(() => {
    game = new GameManager(pg);
    game.override
      .battleStyle("single")
      .ability(ErAbilityId.TACTICAL_RETREAT as unknown as AbilityId)
      .enemySpecies(SpeciesId.SNORLAX)
      .enemyMoveset(MoveId.SPLASH)
      .moveset([MoveId.SPLASH]);
  });
  test("fires the self-switch once when a stat is lowered, then not again", async () => {
    const spy = vi.spyOn(ForceSwitchOutHelper.prototype, "switchOutLogic").mockReturnValue(true);
    await game.classicMode.startBattle(SpeciesId.MAGIKARP, SpeciesId.FEEBAS);
    const player = game.field.getPlayerPokemon();
    const attr = player
      .getAbility()
      .attrs.find(a => a instanceof SelfSwitchOnStatLowerAbAttr) as SelfSwitchOnStatLowerAbAttr;
    expect(attr).toBeDefined();
    const params = { pokemon: player, stats: [Stat.ATK], stages: -1, selfTarget: false, simulated: false } as never;
    expect(attr.canApply(params)).toBe(true); // a stat was lowered
    attr.apply(params);
    expect(spy).toHaveBeenCalledTimes(1); // switch invoked
    expect(attr.canApply(params)).toBe(false); // once per battle
    // A raised stat never triggers it.
    expect(attr.canApply({ pokemon: player, stats: [Stat.ATK], stages: 1, selfTarget: false } as never)).toBe(false);
  });
});

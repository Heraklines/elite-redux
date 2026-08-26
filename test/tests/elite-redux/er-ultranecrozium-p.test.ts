/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { erMegaStoneTier } from "#data/elite-redux/er-mega-tiers";
import { SpeciesFormChangeItemTrigger } from "#data/form-change-triggers";
import { pokemonFormChanges } from "#data/pokemon-forms";
import { AbilityId } from "#enums/ability-id";
import { ErSpeciesId } from "#enums/er-species-id";
import { FormChangeItem } from "#enums/form-change-item";
import { ModifierTier } from "#enums/modifier-tier";
import { MoveId } from "#enums/move-id";
import { PokemonType } from "#enums/pokemon-type";
import type { SpeciesId } from "#enums/species-id";
import { PokemonFormChangeItemModifier } from "#modifiers/modifier";
import { FormChangeItemModifierType } from "#modifiers/modifier-type";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

const NECROZMA_FUSIONS = [ErSpeciesId.NECROZMA_DUSK_MANE, ErSpeciesId.NECROZMA_DAWN_WINGS] as const;

describe("Ultranecrozium P reachability", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
    game.override
      .moveset([MoveId.SPLASH])
      .ability(AbilityId.BALL_FETCH)
      .battleStyle("single")
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemyMoveset(MoveId.SPLASH);
  });

  it("is a named Master-tier reward with a valid edge for both level-60 Necrozma evolutions", () => {
    const type = new FormChangeItemModifierType(FormChangeItem.ULTRANECROZIUM_P);
    expect(type.name).toBe("Ultranecrozium P");
    expect(erMegaStoneTier(FormChangeItem.ULTRANECROZIUM_P)).toBe(ModifierTier.MASTER);

    for (const speciesId of NECROZMA_FUSIONS) {
      const edge = (pokemonFormChanges[speciesId] ?? []).find(change => {
        const trigger = change.findTrigger(SpeciesFormChangeItemTrigger) as SpeciesFormChangeItemTrigger | undefined;
        return (
          change.preFormKey === "" && change.formKey === "primal" && trigger?.item === FormChangeItem.ULTRANECROZIUM_P
        );
      });
      expect(edge, `${ErSpeciesId[speciesId]} must expose Ultranecrozium P to the reward pool`).toBeDefined();
    }
  });

  it.each(NECROZMA_FUSIONS)("transforms %s into the shared Ultra battle form", async speciesId => {
    await game.classicMode.startBattle(speciesId as unknown as SpeciesId);
    const necrozma = game.field.getPlayerPokemon();
    expect(necrozma.getFormKey()).toBe("");

    const type = new FormChangeItemModifierType(FormChangeItem.ULTRANECROZIUM_P);
    type.id = "FORM_CHANGE_ITEM";
    const stone = new PokemonFormChangeItemModifier(type, necrozma.id, FormChangeItem.ULTRANECROZIUM_P, true);
    expect(await game.scene.addModifier(stone)).toBe(true);

    game.move.select(MoveId.SPLASH);
    await game.phaseInterceptor.to("EndEvolutionPhase");

    expect(game.phaseInterceptor.log).toContain("FormChangePhase");
    expect(necrozma.getFormKey()).toBe("primal");
    expect(necrozma.getNameToRender()).toBe("Necrozma Ultra");
    expect(necrozma.species.getFormNameToDisplay(necrozma.formIndex)).toBe("Ultra");
    expect(necrozma.getTypes()).toEqual([PokemonType.PSYCHIC, PokemonType.DRAGON, PokemonType.STEEL]);
    expect(necrozma.calculateBaseStats()).toEqual([97, 167, 109, 167, 109, 131]);
    expect(necrozma.isMega()).toBe(true);
  });
});

import { modifierTypes } from "#data/data-lists";
import { erMapUpgradeTier } from "#data/elite-redux/er-biome-routing";
import { SpeciesId } from "#enums/species-id";
import {
  ER_MAP_MAX_STACK_COUNT,
  GigantamaxAccessModifier,
  MapModifier,
  MegaEvolutionAccessModifier,
  TerastallizeAccessModifier,
} from "#modifiers/modifier";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

/**
 * Regression for the "two Mega Bracelet key items visible" report.
 *
 * The singleton key-item access modifiers (max stack 1) previously did not
 * override {@linkcode Modifier.match}, so the base implementation returned
 * `false` and {@linkcode PersistentModifier.add} could never merge a second
 * grant - it pushed a duplicate instance and the HUD showed two icons. In ER the
 * reward pool zero-weights an already-owned unique, but the ER biome market and
 * the Bug-Type Superfan mystery encounter can hand these out a SECOND time, so
 * the duplicate icon was reachable. With a `match()` override the second grant is
 * rejected by `add()` (incrementStack fails at max stack) and only one is stored.
 */
describe("ER singleton key-item dedup (#mega-bracelet)", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
  });

  // Vanilla key-item ModifierTypes have their stable id assigned lazily by the
  // real reward path via withIdFromFunc; mirror that so the grant is faithful.
  const grant = (key: "MEGA_BRACELET" | "DYNAMAX_BAND" | "TERA_ORB") =>
    game.scene.addModifier(modifierTypes[key]().withIdFromFunc(modifierTypes[key]).newModifier());

  it("granting the Mega Bracelet twice keeps exactly one HUD modifier", async () => {
    await game.classicMode.startBattle(SpeciesId.BULBASAUR);

    await grant("MEGA_BRACELET");
    await grant("MEGA_BRACELET");

    const owned = game.scene.getModifiers(MegaEvolutionAccessModifier);
    expect(owned).toHaveLength(1);
    expect(owned[0].getStackCount()).toBe(1);
  });

  it("the same dedup holds for the Dynamax Band and Tera Orb", async () => {
    await game.classicMode.startBattle(SpeciesId.BULBASAUR);

    await grant("DYNAMAX_BAND");
    await grant("DYNAMAX_BAND");
    await grant("TERA_ORB");
    await grant("TERA_ORB");

    expect(game.scene.getModifiers(GigantamaxAccessModifier)).toHaveLength(1);
    expect(game.scene.getModifiers(TerastallizeAccessModifier)).toHaveLength(1);
  });

  it("merges three Upgraded Maps into the base Map before rejecting another", async () => {
    await game.classicMode.startBattle(SpeciesId.BULBASAUR);
    const grantMapUpgrade = () =>
      game.scene.addModifier(
        modifierTypes.ER_UPGRADED_MAP().withIdFromFunc(modifierTypes.ER_UPGRADED_MAP).newModifier(),
      );

    expect(game.scene.getModifiers(MapModifier)).toHaveLength(1);
    expect(erMapUpgradeTier()).toBe(0);

    for (let i = 0; i < 3; i++) {
      await grantMapUpgrade();
    }

    const maps = game.scene.getModifiers(MapModifier);
    expect(maps).toHaveLength(1);
    expect(maps[0].getStackCount()).toBe(ER_MAP_MAX_STACK_COUNT);
    expect(erMapUpgradeTier()).toBe(3);

    await grantMapUpgrade();
    expect(game.scene.getModifiers(MapModifier)[0].getStackCount()).toBe(ER_MAP_MAX_STACK_COUNT);
    expect(erMapUpgradeTier()).toBe(3);
  });
});

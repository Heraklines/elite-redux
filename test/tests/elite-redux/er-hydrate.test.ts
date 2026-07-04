/*
 * Regression tests for the ER Hydrate ability (2.65 dex, ability id 315):
 *   "Changes the user's Normal-type moves to Water-type. If the user is
 *    Water-type its Water-type moves have a 10% chance to drench, otherwise it
 *    gains Water STAB."
 *
 * Run: ER_SCENARIO=1 npx vitest run test/tests/elite-redux/er-hydrate.test.ts
 */

import { allMoves } from "#data/data-lists";
import { AbilityId } from "#enums/ability-id";
import { BattlerTagType } from "#enums/battler-tag-type";
import { ErAbilityId } from "#enums/er-ability-id";
import { PokemonType } from "#enums/pokemon-type";
import { SpeciesId } from "#enums/species-id";
import { StatusEffect } from "#enums/status-effect";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";
const HYDRATE = ErAbilityId.HYDRATE as unknown as AbilityId;
const tackleId = () => allMoves.find(m => m?.name === "Tackle")!.id;

describe.skipIf(!RUN)("ER Hydrate ability", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });
  beforeEach(() => {
    game = new GameManager(phaserGame);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("wiring: carries the type-change, Water STAB, and drench-on-hit attrs", async () => {
    game.override.ability(HYDRATE);
    await game.classicMode.startBattle(SpeciesId.RATTATA);
    const player = game.scene.getPlayerPokemon()!;
    // StabAddAbAttr is an ER-custom attr not in the registry string map, so check
    // the ability's attrs by class name rather than hasAbilityWithAttr.
    const attrNames = player.getAbility().attrs.map(a => a.constructor.name);
    expect(attrNames, "Normal->Water type change").toContain("MoveTypeChangeAbAttr");
    expect(attrNames, "Water STAB rider").toContain("StabAddAbAttr");
    expect(attrNames, "drench-on-hit rider").toContain("PostAttackApplyBattlerTagAbAttr");
  }, 120_000);

  it("conversion: a Normal move becomes Water-type", async () => {
    game.override.ability(HYDRATE);
    await game.classicMode.startBattle(SpeciesId.RATTATA); // Normal, non-Water user
    const player = game.scene.getPlayerPokemon()!;
    const tackle = allMoves.find(m => m?.name === "Tackle")!;
    expect(tackle.type, "Tackle's base type is Normal").toBe(PokemonType.NORMAL);
    expect(player.getMoveType(tackle), "Hydrate retypes it to Water").toBe(PokemonType.WATER);
  }, 120_000);

  it("Water user: a converted Normal move can drench the target (10%)", async () => {
    game.override
      .battleStyle("single")
      .startingLevel(50)
      .enemyLevel(50)
      .ability(HYDRATE)
      // Sleeping bulky Snorlax: Tackle HITS it (so the post-attack drench hook
      // fires) but it can't counter-KO the frail Magikarp. Normal typing -> drenchable.
      .enemySpecies(SpeciesId.SNORLAX)
      .enemyStatusEffect(StatusEffect.SLEEP)
      .enemyMoveset(tackleId())
      .enemyAbility(AbilityId.BALL_FETCH)
      .criticalHits(false);
    await game.classicMode.startBattle(SpeciesId.MAGIKARP); // pure Water user
    const player = game.scene.getPlayerPokemon()!;
    const enemy = game.scene.getEnemyPokemon()!;
    expect(player.isOfType(PokemonType.WATER), "Magikarp is a Water-type user").toBe(true);
    // Force the 10% drench roll to proc (rolls are clamped to MAX otherwise).
    vi.spyOn(player, "randBattleSeedInt").mockReturnValue(0);

    game.move.use(tackleId(), 0); // Normal -> Water via Hydrate
    await game.toNextTurn();

    expect(enemy.getTag(BattlerTagType.ER_DRENCHED), "Water user's converted move drenched the foe").toBeDefined();
  }, 120_000);

  it("non-Water user: a converted move does NOT drench (STAB branch instead)", async () => {
    game.override
      .battleStyle("single")
      .startingLevel(50)
      .enemyLevel(50)
      .ability(HYDRATE)
      // Sleeping foe so the converted Tackle HITS (proves the chance is genuinely
      // 0 for a non-Water user, not just that the move was blocked).
      .enemySpecies(SpeciesId.SNORLAX)
      .enemyStatusEffect(StatusEffect.SLEEP)
      .enemyMoveset(tackleId())
      .enemyAbility(AbilityId.BALL_FETCH)
      .criticalHits(false);
    await game.classicMode.startBattle(SpeciesId.RATTATA); // Normal user -> STAB branch, no drench
    const player = game.scene.getPlayerPokemon()!;
    const enemy = game.scene.getEnemyPokemon()!;
    // Even with the roll forced low, the drench chance is 0 for a non-Water user.
    vi.spyOn(player, "randBattleSeedInt").mockReturnValue(0);

    game.move.use(tackleId(), 0);
    await game.toNextTurn();

    expect(enemy.getTag(BattlerTagType.ER_DRENCHED), "non-Water user never drenches").toBeUndefined();
  }, 120_000);
});

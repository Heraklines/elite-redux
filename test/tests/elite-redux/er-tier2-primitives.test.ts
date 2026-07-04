/*
 * Headless behavioral tests for the tier-2 audit PRIMITIVES:
 *   - special-category status filter (Voodoo Power: bleed only on special hits)
 *   - super-effective-always-crits (Flawless Precision)
 *   - strip-Ghost-type-on-hit ability (Refrigerator/Chandelier Illuminate)
 *   - random-berry-effect (Concoction move + Craving ability)
 *
 * Run: ER_SCENARIO=1 npx vitest run test/tests/elite-redux/er-tier2-primitives.test.ts
 */

import { allMoves } from "#data/data-lists";
import { AbilityId } from "#enums/ability-id";
import { ArenaTagSide } from "#enums/arena-tag-side";
import { ArenaTagType } from "#enums/arena-tag-type";
import { BattlerTagType } from "#enums/battler-tag-type";
import { ErAbilityId } from "#enums/er-ability-id";
import { PokemonType } from "#enums/pokemon-type";
import { SpeciesId } from "#enums/species-id";
import { StatusEffect } from "#enums/status-effect";
import { TerrainType } from "#enums/terrain-type";
import { WeatherType } from "#enums/weather-type";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";
const erAb = (id: ErAbilityId): AbilityId => id as unknown as AbilityId;
const moveId = (name: string): number => allMoves.find(m => m?.name === name)!.id;

describe.skipIf(!RUN)("ER tier-2 audit primitives", () => {
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

  it("Voodoo Power: bleeds the attacker on a SPECIAL hit, not a physical one", async () => {
    game.override
      .battleStyle("single")
      .startingLevel(50)
      .enemyLevel(50)
      .enemySpecies(SpeciesId.SNORLAX)
      .enemyStatusEffect(StatusEffect.SLEEP) // survives, doesn't counterattack
      .enemyMoveset(moveId("Tackle"))
      .enemyAbility(erAb(ErAbilityId.VOODOO_POWER))
      .ability(AbilityId.BALL_FETCH)
      .criticalHits(false);
    await game.classicMode.startBattle(SpeciesId.PIKACHU);
    const player = game.scene.getPlayerPokemon()!;
    const enemy = game.scene.getEnemyPokemon()!;
    vi.spyOn(enemy, "randBattleSeedInt").mockReturnValue(0); // force the 30% proc

    // Physical hit first — must NOT bleed.
    game.move.use(moveId("Quick Attack"), 0); // physical
    await game.toNextTurn();
    expect(player.getTag(BattlerTagType.ER_BLEED), "no bleed on a physical hit").toBeUndefined();

    // Special hit — must bleed the attacker.
    game.move.use(moveId("Thunder Shock"), 0); // special
    await game.toNextTurn();
    expect(player.getTag(BattlerTagType.ER_BLEED), "bleed on a special hit").toBeDefined();
  }, 120_000);

  it("Flawless Precision: carries the super-effective-always-crit attr", async () => {
    game.override.ability(erAb(ErAbilityId.FLAWLESS_PRECISION));
    await game.classicMode.startBattle(SpeciesId.MAGIKARP);
    const attrs = game.scene
      .getPlayerPokemon()!
      .getAbility()
      .attrs.map(a => a.constructor.name);
    expect(attrs, "never-miss").toContain("AlwaysHitAbAttr");
    expect(attrs, "bypass target ability").toContain("MoveAbilityBypassAbAttr");
    expect(attrs, "super-effective always crits (Fatal half)").toContain("ConditionalCritAbAttr");
  }, 120_000);

  it("Illuminate (Refrigerator): strips the Ghost type off the target on a landed hit", async () => {
    game.override
      .battleStyle("single")
      .startingLevel(50)
      .enemyLevel(50)
      .enemySpecies(SpeciesId.GASTLY) // Ghost/Poison
      .enemyStatusEffect(StatusEffect.SLEEP)
      .enemyMoveset(moveId("Tackle"))
      .ability(erAb(ErAbilityId.REFRIGERATOR))
      .enemyAbility(AbilityId.BALL_FETCH)
      .criticalHits(false);
    await game.classicMode.startBattle(SpeciesId.SQUIRTLE);
    const enemy = game.scene.getEnemyPokemon()!;
    expect(enemy.isOfType(PokemonType.GHOST), "Gastly starts Ghost-type").toBe(true);

    game.move.use(moveId("Water Gun"), 0); // Water hits Ghost (neutral)
    await game.toNextTurn();

    expect(enemy.isOfType(PokemonType.GHOST), "Ghost type stripped after the hit").toBe(false);
    expect(enemy.isOfType(PokemonType.POISON), "keeps its Poison type").toBe(true);
  }, 120_000);

  it("Concoction: uses a random berry effect (forced Sitrus heals the low-HP user)", async () => {
    game.override
      .battleStyle("single")
      .startingLevel(50)
      .enemyLevel(50)
      .enemySpecies(SpeciesId.SNORLAX)
      .enemyStatusEffect(StatusEffect.SLEEP)
      .enemyMoveset(moveId("Tackle"))
      .ability(AbilityId.BALL_FETCH)
      .enemyAbility(AbilityId.BALL_FETCH)
      .criticalHits(false);
    await game.classicMode.startBattle(SpeciesId.BULBASAUR);
    const player = game.scene.getPlayerPokemon()!;
    // Force the random berry pick to index 0 (Sitrus) and wound the user so Sitrus heals.
    vi.spyOn(player, "randBattleSeedInt").mockReturnValue(0);
    player.hp = Math.floor(player.getMaxHp() * 0.4);
    const hp0 = player.hp;

    game.move.use(moveId("Concoction"), 0);
    await game.toNextTurn();

    expect(player.hp, "Sitrus berry effect healed the user").toBeGreaterThan(hp0);
  }, 120_000);

  it("Craving: triggers a random berry effect each turn-end (forced Sitrus heals)", async () => {
    game.override
      .battleStyle("single")
      .startingLevel(50)
      .enemyLevel(50)
      .enemySpecies(SpeciesId.SNORLAX)
      .enemyStatusEffect(StatusEffect.SLEEP)
      .enemyMoveset(moveId("Tackle"))
      .ability(erAb(ErAbilityId.CRAVING))
      .enemyAbility(AbilityId.BALL_FETCH)
      .criticalHits(false);
    await game.classicMode.startBattle(SpeciesId.BULBASAUR);
    const player = game.scene.getPlayerPokemon()!;
    vi.spyOn(player, "randBattleSeedInt").mockReturnValue(0); // Sitrus
    player.hp = Math.floor(player.getMaxHp() * 0.4);
    const hp0 = player.hp;

    game.move.use(moveId("Splash"), 0);
    await game.toNextTurn();

    expect(player.hp, "end-of-turn Sitrus effect healed the user").toBeGreaterThan(hp0);
  }, 120_000);

  it("Clear Skies: clears weather AND blocks new weather for 5 turns", async () => {
    game.override
      .battleStyle("single")
      .startingLevel(50)
      .enemyLevel(50)
      .enemySpecies(SpeciesId.SNORLAX)
      .enemyStatusEffect(StatusEffect.SLEEP)
      .enemyMoveset(moveId("Tackle"))
      .ability(AbilityId.BALL_FETCH)
      .enemyAbility(AbilityId.BALL_FETCH)
      .criticalHits(false);
    await game.classicMode.startBattle(SpeciesId.SNORLAX);
    const arena = game.scene.arena;

    // Set rain, then clear it with Clear Skies.
    game.move.use(moveId("Rain Dance"), 0);
    await game.toNextTurn();
    expect(arena.weather?.weatherType, "Rain Dance set rain").toBe(WeatherType.RAIN);

    game.move.use(moveId("Clear Skies"), 0);
    await game.toNextTurn();
    expect(arena.weather?.weatherType ?? WeatherType.NONE, "Clear Skies cleared the weather").toBe(WeatherType.NONE);
    expect(arena.getTag(ArenaTagType.ER_WEATHER_LOCK), "weather-lock tag is up").toBeDefined();

    // New weather is blocked while the lock is active.
    game.move.use(moveId("Rain Dance"), 0);
    await game.toNextTurn();
    expect(arena.weather?.weatherType ?? WeatherType.NONE, "new weather blocked by the lock").toBe(WeatherType.NONE);
  }, 120_000);

  it("Molten Core: immune to Stealth Rock switch-in damage (and heals instead)", async () => {
    game.override
      .battleStyle("single")
      .startingLevel(50)
      .enemyLevel(50)
      .enemySpecies(SpeciesId.SNORLAX)
      .enemyStatusEffect(StatusEffect.SLEEP)
      .enemyMoveset(moveId("Tackle"))
      .ability(erAb(ErAbilityId.MOLTEN_CORE))
      .enemyAbility(AbilityId.BALL_FETCH)
      .criticalHits(false);
    // Fire mons: Rock is super-effective, so Stealth Rock would deal ~25% without immunity.
    await game.classicMode.startBattle(SpeciesId.CHARMANDER, SpeciesId.VULPIX);
    const arena = game.scene.arena;
    const enemyId = game.scene.getEnemyPokemon()!.id;
    // Lay Stealth Rock on the PLAYER side, then switch the (wounded) bench mon in.
    arena.addTag(ArenaTagType.STEALTH_ROCK, 0, undefined, enemyId, ArenaTagSide.PLAYER);
    const bench = game.scene.getPlayerParty()[1];
    bench.hp = Math.floor(bench.getMaxHp() * 0.5);
    const benchHp0 = bench.hp;

    game.doSwitchPokemon(1);
    await game.toNextTurn();

    const active = game.scene.getPlayerPokemon()!;
    expect(active.species.speciesId, "the bench mon switched in").toBe(SpeciesId.VULPIX);
    expect(active.hp, "no Stealth Rock damage; healed 1/4 instead").toBeGreaterThan(benchHp0);
  }, 120_000);

  it("Cosmic Daze: doubles an enraged foe's self-inflicted (enrage recoil) damage", async () => {
    game.override
      .battleStyle("single")
      .startingLevel(50)
      .enemyLevel(50)
      // Sleeping bulky foe with Cosmic Daze: it takes the hit (so recoil is dealt)
      // but doesn't counter-attack. Its Cosmic Daze doubles our enrage recoil.
      .enemySpecies(SpeciesId.SNORLAX)
      .enemyStatusEffect(StatusEffect.SLEEP)
      .enemyMoveset(moveId("Tackle"))
      .ability(AbilityId.BALL_FETCH)
      .enemyAbility(erAb(ErAbilityId.COSMIC_DAZE))
      .criticalHits(false);
    await game.classicMode.startBattle(SpeciesId.SNORLAX);
    const player = game.scene.getPlayerPokemon()!;
    const enemy = game.scene.getEnemyPokemon()!;
    player.addTag(BattlerTagType.ER_ENRAGE);
    const enemyHp0 = enemy.hp;
    const playerHp0 = player.hp;

    game.move.use(moveId("Tackle"), 0);
    await game.toNextTurn();

    const dealt = enemyHp0 - enemy.hp;
    const recoil = playerHp0 - player.hp;
    expect(dealt, "the attack dealt damage").toBeGreaterThan(0);
    // 33% recoil, DOUBLED to 66% by the Cosmic Daze foe (min 1, +-1 for flooring).
    expect(recoil, "66% enrage recoil (33% doubled)").toBe(Math.max(1, Math.floor(dealt * 0.33 * 2)));
  }, 120_000);

  it("Clueless: negates Terrain and Gravity EFFECTS (they stay set, effect off)", async () => {
    game.override
      .battleStyle("single")
      .startingLevel(50)
      .enemyLevel(50)
      .enemySpecies(SpeciesId.SNORLAX)
      .enemyStatusEffect(StatusEffect.SLEEP)
      .enemyMoveset(moveId("Tackle"))
      .ability(erAb(ErAbilityId.CLUELESS))
      .enemyAbility(AbilityId.BALL_FETCH)
      .criticalHits(false);
    await game.classicMode.startBattle(SpeciesId.SNORLAX);
    const arena = game.scene.arena;
    const playerId = game.scene.getPlayerPokemon()!.id;
    arena.trySetTerrain(TerrainType.GRASSY, true);
    arena.addTag(ArenaTagType.GRAVITY, 5, undefined, playerId);

    // The field effects still EXIST...
    expect(arena.terrain?.terrainType, "terrain object stays set").toBe(TerrainType.GRASSY);
    expect(arena.hasTag(ArenaTagType.GRAVITY), "gravity tag stays set").toBe(true);
    // ...but their EFFECTS are negated while Clueless is out.
    expect(arena.isFieldEffectSuppressed(), "field-effect suppression active").toBe(true);
    expect(arena.terrainType, "terrain effect negated (getter -> NONE)").toBe(TerrainType.NONE);
    expect(arena.hasActiveGravity(), "gravity effect negated").toBe(false);
  }, 120_000);
});

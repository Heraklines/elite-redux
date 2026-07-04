/*
 * Regression tests for the 3 "hard" Elite Redux move fixes that needed new
 * engine primitives (audit 2026-07):
 *   - Trepidation (er 967): ER_DESPAIR tag -> the holder's Psychic moves miss for 3 turns
 *   - Spectral Flame (er 966): burns Fire types (type-immunity bypass) + suppresses abilities in fog
 *   - Fetch (er 969): retrieves the user's most-recently consumed berry, then self-switches
 *
 * Run: ER_SCENARIO=1 npx vitest run test/tests/elite-redux/er-hard-move-fixes.test.ts
 */

import { allMoves } from "#data/data-lists";
import type { Move } from "#data/moves/move";
import { AbilityId } from "#enums/ability-id";
import { BattlerTagType } from "#enums/battler-tag-type";
import { BerryType } from "#enums/berry-type";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { StatusEffect } from "#enums/status-effect";
import { WeatherType } from "#enums/weather-type";
import { BerryModifier } from "#modifiers/modifier";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

const byName = (name: string): Move => {
  const m = allMoves.find(mv => mv?.name === name);
  if (!m) {
    throw new Error(`move not found: ${name}`);
  }
  return m;
};

describe.skipIf(!RUN)("ER hard move fixes (new primitives)", () => {
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

  it("wiring: the 3 moves carry the new ER attrs", async () => {
    await game.classicMode.startBattle(SpeciesId.MAGIKARP);

    // Trepidation -> AddBattlerTagAttr(ER_DESPAIR)
    const trep = byName("Trepidation");
    const trepTag = trep.getAttrs("AddBattlerTagAttr").some(a => a.tagType === BattlerTagType.ER_DESPAIR);
    expect(trepTag, "Trepidation applies ER_DESPAIR").toBe(true);

    // Spectral Flame -> ErStatusEffectIgnoreImmunityAttr (burn) + ErSuppressAbilitiesInFogAttr
    const spectral = byName("Spectral Flame");
    expect(
      spectral.attrs.some(a => a.constructor.name === "ErStatusEffectIgnoreImmunityAttr"),
      "Spectral Flame has type-immunity-bypassing burn",
    ).toBe(true);
    expect(
      spectral.attrs.some(a => a.constructor.name === "ErSuppressAbilitiesInFogAttr"),
      "Spectral Flame has fog ability suppression",
    ).toBe(true);

    // Fetch -> ErRetrieveConsumedItemAttr + ForceSwitchOutAttr
    const fetch = byName("Fetch");
    expect(
      fetch.attrs.some(a => a.constructor.name === "ErRetrieveConsumedItemAttr"),
      "Fetch retrieves a consumed item",
    ).toBe(true);
    expect(fetch.hasAttr("ForceSwitchOutAttr"), "Fetch self-switches").toBe(true);
  }, 120_000);

  it("Trepidation: the target's Psychic move misses; a non-Psychic move hits; tag lasts 3 turns", async () => {
    game.override
      .battleStyle("single")
      .startingLevel(50)
      .enemyLevel(50)
      .enemySpecies(SpeciesId.MAGIKARP)
      .enemyMoveset([MoveId.CONFUSION, MoveId.TACKLE]) // Confusion = Psychic 100 acc; Tackle = Normal control
      .ability(AbilityId.BALL_FETCH)
      .enemyAbility(AbilityId.BALL_FETCH)
      .criticalHits(false);
    // Jolteon (fast) outspeeds Magikarp so Trepidation lands BEFORE the enemy's
    // same-turn Psychic move -> the miss is observable on turn 1.
    await game.classicMode.startBattle(SpeciesId.JOLTEON);
    const player = game.scene.getPlayerPokemon()!;
    const enemy = game.scene.getEnemyPokemon()!;

    // Turn 1: Trepidation (force it to land) applies ER_DESPAIR to the enemy;
    // the enemy's Psychic Confusion then MISSES.
    game.move.use(byName("Trepidation").id, 0);
    await game.move.forceEnemyMove(MoveId.CONFUSION);
    await game.move.forceHit();
    const hpBeforeMiss = player.hp;
    await game.toNextTurn();

    expect(enemy.getTag(BattlerTagType.ER_DESPAIR), "enemy is in despair").toBeDefined();
    expect(player.hp, "the foe's Psychic move missed (no damage)").toBe(hpBeforeMiss);

    // Turn 2: the enemy's NON-Psychic Tackle still HITS while in despair.
    game.move.use(MoveId.SPLASH, 0);
    await game.move.forceEnemyMove(MoveId.TACKLE);
    const hpBeforeTackle = player.hp;
    await game.toNextTurn();
    expect(player.hp, "the foe's non-Psychic move hit").toBeLessThan(hpBeforeTackle);

    // Expiry: keep taking turns with the enemy spamming Confusion. Once the tag
    // lapses (3 turns), a Psychic move lands again.
    let expired = false;
    let psychicLandedAfterExpiry = false;
    for (let i = 0; i < 5 && !psychicLandedAfterExpiry; i++) {
      game.move.use(MoveId.SPLASH, 0);
      await game.move.forceEnemyMove(MoveId.CONFUSION);
      const before = player.hp;
      await game.toNextTurn();
      const tagGone = enemy.getTag(BattlerTagType.ER_DESPAIR) === undefined;
      if (tagGone) {
        expired = true;
        if (player.hp < before) {
          psychicLandedAfterExpiry = true;
        }
      } else {
        // still in despair -> Psychic must still miss
        expect(player.hp, "Psychic still misses while despair active").toBe(before);
      }
      if (player.isFainted()) {
        break;
      }
    }
    expect(expired, "ER_DESPAIR expired within a few turns").toBe(true);
    expect(psychicLandedAfterExpiry, "Psychic lands again once despair wears off").toBe(true);
  }, 120_000);

  it("Spectral Flame: burns a Fire type (Will-O-Wisp does NOT — control)", async () => {
    game.override
      .battleStyle("single")
      .startingLevel(50)
      .enemyLevel(50)
      .enemySpecies(SpeciesId.CHARMANDER) // Fire type
      .enemyMoveset(MoveId.SPLASH) // enemy does nothing
      .ability(AbilityId.BALL_FETCH)
      .enemyAbility(AbilityId.BALL_FETCH)
      .criticalHits(false);
    // Jolteon (fast) moves first so `forceHit` targets the PLAYER's status move.
    await game.classicMode.startBattle(SpeciesId.JOLTEON);
    const enemy = game.scene.getEnemyPokemon()!;
    // Suppress the Fire enemy's (innate) abilities so the ONLY thing gating the
    // burn is the type immunity we mean to test.
    enemy.summonData.abilitySuppressed = true;

    // CONTROL: Will-O-Wisp (guaranteed burn) is blocked by the Fire type immunity.
    game.move.use(MoveId.WILL_O_WISP, 0);
    await game.move.forceHit();
    await game.toNextTurn();
    expect(enemy.status?.effect, "vanilla burn is blocked on a Fire type").not.toBe(StatusEffect.BURN);

    // Spectral Flame burns the SAME Fire type (bypasses the type immunity).
    game.move.use(byName("Spectral Flame").id, 0);
    await game.move.forceHit();
    await game.toNextTurn();
    expect(enemy.status?.effect, "Spectral Flame burns a Fire type").toBe(StatusEffect.BURN);
  }, 120_000);

  it("Spectral Flame: suppresses the target's ability in FOG", async () => {
    game.override
      .battleStyle("single")
      .startingLevel(50)
      .enemyLevel(50)
      .enemySpecies(SpeciesId.MAGIKARP)
      .enemyMoveset(MoveId.SPLASH)
      .weather(WeatherType.FOG)
      .ability(AbilityId.BALL_FETCH)
      .enemyAbility(AbilityId.BALL_FETCH) // suppressable
      .criticalHits(false);
    // Jolteon (fast) moves first so `forceHit` targets the PLAYER's Spectral Flame.
    await game.classicMode.startBattle(SpeciesId.JOLTEON);
    const enemy = game.scene.getEnemyPokemon()!;
    expect(game.scene.arena.weather?.weatherType, "battle is in fog").toBe(WeatherType.FOG);
    expect(enemy.summonData.abilitySuppressed, "enemy ability starts active").toBeFalsy();

    game.move.use(byName("Spectral Flame").id, 0);
    await game.move.forceHit();
    await game.toNextTurn();

    expect(enemy.summonData.abilitySuppressed, "ability suppressed in fog").toBe(true);
  }, 120_000);

  it("Fetch: retrieves the user's most-recently consumed berry, then switches out", async () => {
    game.override
      .battleStyle("single")
      .startingLevel(50)
      .enemyLevel(20)
      .enemySpecies(SpeciesId.MAGIKARP)
      .enemyMoveset(MoveId.SPLASH)
      .ability(AbilityId.BALL_FETCH)
      .enemyAbility(AbilityId.BALL_FETCH)
      .criticalHits(false);
    await game.classicMode.startBattle(SpeciesId.SNORLAX, SpeciesId.MUNCHLAX);
    const [user, bench] = game.scene.getPlayerParty();
    // Model "lost item": the user ate a Sitrus berry earlier this battle.
    user.battleData.berriesEaten = [BerryType.SITRUS];

    const berriesForUser = () =>
      game.scene.findModifiers(
        m => m instanceof BerryModifier && (m as BerryModifier).pokemonId === user.id,
        true,
      ) as BerryModifier[];
    expect(berriesForUser().length, "user holds no berry before Fetch").toBe(0);

    game.move.use(byName("Fetch").id, 0);
    game.doSelectPartyPokemon(1); // switch to the ally
    await game.toEndOfTurn();

    // The consumed Sitrus is restored as a held-item modifier on the user.
    const restored = berriesForUser();
    expect(restored.length, "the consumed berry was retrieved").toBe(1);
    expect(restored[0].berryType, "retrieved berry is the Sitrus it consumed").toBe(BerryType.SITRUS);
    expect(user.battleData.berriesEaten.length, "the retrieved berry left the eaten ledger").toBe(0);

    // ...and the user switched to its ally.
    expect(game.field.getPlayerPokemon(), "user switched to the ally").toBe(bench);
    expect(user.isOnField(), "the user left the field").toBe(false);
  }, 120_000);
});

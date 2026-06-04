/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// #103 Batch A — exact-number real-battle verification of ER damage-multiplier
// abilities against the v2.65.3b C source (vendor/elite-redux/source/src/
// battle_util.c) AND their in-game descriptions. Unlike the smoke tests
// (`damage > 0`), these pin the actual multiplier by toggling the boost within a
// single battle and asserting the damage RATIO. The [0.85,1.0] damage-variance
// roll is mocked to a constant so the ratio is deterministic.
//
// Gated behind ER_SCENARIO=1.
// =============================================================================

import { AbilityId } from "#enums/ability-id";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { Stat } from "#enums/stat";
import { Pokemon } from "#field/pokemon";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const RUN_SCENARIOS = process.env.ER_SCENARIO === "1";

async function erId(id: number): Promise<AbilityId | undefined> {
  const erIdMap = (await import("#data/elite-redux/er-id-map")).ER_ID_MAP;
  return erIdMap.abilities[id] as AbilityId | undefined;
}

describe.skipIf(!RUN_SCENARIOS)("ER damage-multiplier fidelity (#103 Batch A)", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
  });

  // Dune Terror (ER 431): C-source ABILITY_DUNE_TERROR + description — Ground-type
  // moves get +20% power (x1.2). This piece was previously unwired (only the sand
  // damage-reduction half existed). We isolate the boost by suppressing the
  // ability mid-battle and comparing the same Ground move's damage.
  it("Dune Terror: Ground moves get a 1.2x power boost", async () => {
    const duneTerror = await erId(431);
    if (duneTerror === undefined) {
      return;
    }
    game.override
      .battleStyle("single")
      .ability(duneTerror)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemySpecies(SpeciesId.SNORLAX) // Normal: Ground is neutral, no effectiveness skew
      .enemyMoveset(MoveId.SPLASH)
      .moveset(MoveId.EARTHQUAKE)
      .startingLevel(100)
      .enemyLevel(100)
      .criticalHits(false);
    await game.classicMode.startBattle([SpeciesId.SNORLAX]); // Normal user: Earthquake non-STAB

    // Pin the [0.85,1.0] damage-variance roll to its max so the ratio is exact.
    vi.spyOn(Pokemon.prototype, "randBattleSeedIntRange").mockImplementation((_min: number, max: number) => max);

    const player = game.field.getPlayerPokemon();
    const enemy = game.field.getEnemyPokemon();

    // Turn 1 — ability active: boosted Earthquake.
    let hp0 = enemy.hp;
    game.move.use(MoveId.EARTHQUAKE);
    await game.toNextTurn();
    const dmgBoosted = hp0 - enemy.hp;

    // Suppress the ability, heal, fire again — unboosted baseline.
    player.summonData.abilitySuppressed = true;
    enemy.hp = enemy.getMaxHp();
    hp0 = enemy.hp;
    game.move.use(MoveId.EARTHQUAKE);
    await game.toEndOfTurn();
    const dmgBase = hp0 - enemy.hp;

    expect(dmgBase, "baseline Earthquake dealt damage").toBeGreaterThan(0);
    const ratio = dmgBoosted / dmgBase;
    expect(ratio, `Dune Terror should boost Ground moves ~1.2x (got ${ratio.toFixed(3)})`).toBeGreaterThan(1.15);
    expect(ratio, `Dune Terror should boost Ground moves ~1.2x (got ${ratio.toFixed(3)})`).toBeLessThan(1.25);
  });

  // Fossilized (ER 303): C-source + description — "Halves dmg taken by Rock moves.
  // Boosts own Rock moves by 1.2x." The defensive half was previously unwired.
  // Verify the holder takes HALF damage from an incoming Rock move.
  it("Fossilized: halves incoming Rock-move damage (defensive half)", async () => {
    const fossilized = await erId(303);
    if (fossilized === undefined) {
      return;
    }
    game.override
      .battleStyle("single")
      .ability(fossilized)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemySpecies(SpeciesId.RHYPERIOR) // high Atk Rock user
      .enemyMoveset(MoveId.ROCK_SLIDE)
      .moveset(MoveId.SPLASH)
      .startingLevel(100)
      .enemyLevel(100)
      .criticalHits(false);
    await game.classicMode.startBattle([SpeciesId.SNORLAX]); // Normal: Rock is neutral

    vi.spyOn(Pokemon.prototype, "randBattleSeedIntRange").mockImplementation((_min: number, max: number) => max);
    const player = game.field.getPlayerPokemon();

    // Turn 1 — ability active: reduced Rock damage taken.
    let hp0 = player.hp;
    game.move.use(MoveId.SPLASH);
    await game.toNextTurn();
    const dmgReduced = hp0 - player.hp;

    // Suppress ability, heal, take the hit again at full.
    player.summonData.abilitySuppressed = true;
    player.hp = player.getMaxHp();
    hp0 = player.hp;
    game.move.use(MoveId.SPLASH);
    await game.toEndOfTurn();
    const dmgFull = hp0 - player.hp;

    expect(dmgFull, "baseline Rock Slide dealt damage").toBeGreaterThan(0);
    const ratio = dmgReduced / dmgFull;
    expect(ratio, `Fossilized should halve Rock damage (~0.5x, got ${ratio.toFixed(3)})`).toBeGreaterThan(0.45);
    expect(ratio, `Fossilized should halve Rock damage (~0.5x, got ${ratio.toFixed(3)})`).toBeLessThan(0.55);
  });

  // Sand Song (ER 274): description — "Sound moves get a 1.2x boost and become
  // Ground if Normal." Was an unwired SKIP. Verify the Normal->Ground conversion
  // by hitting a Ghost (immune to Normal): with Sand Song the Normal sound move
  // becomes Ground and connects; suppressed, it does nothing.
  it("Sand Song: Normal sound moves become Ground (hit a Ghost)", async () => {
    const sandSong = await erId(274);
    if (sandSong === undefined) {
      return;
    }
    game.override
      .battleStyle("single")
      .ability(sandSong)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemySpecies(SpeciesId.GENGAR) // Ghost: immune to Normal, neutral to Ground
      .enemyMoveset(MoveId.SPLASH)
      .moveset(MoveId.HYPER_VOICE) // Normal, sound-based
      .startingLevel(100)
      .enemyLevel(100)
      .criticalHits(false);
    await game.classicMode.startBattle([SpeciesId.SNORLAX]);

    vi.spyOn(Pokemon.prototype, "randBattleSeedIntRange").mockImplementation((_min: number, max: number) => max);
    const player = game.field.getPlayerPokemon();
    const enemy = game.field.getEnemyPokemon();

    // Ability active: Hyper Voice converts Normal -> Ground, connects on Ghost.
    let hp0 = enemy.hp;
    game.move.use(MoveId.HYPER_VOICE);
    await game.toNextTurn();
    const dmgConverted = hp0 - enemy.hp;

    // Suppress: Normal vs Ghost = immune = 0 damage.
    player.summonData.abilitySuppressed = true;
    enemy.hp = enemy.getMaxHp();
    hp0 = enemy.hp;
    game.move.use(MoveId.HYPER_VOICE);
    await game.toEndOfTurn();
    const dmgImmune = hp0 - enemy.hp;

    expect(dmgConverted, "Sand Song should let Normal sound hit a Ghost (as Ground)").toBeGreaterThan(0);
    expect(dmgImmune, "without Sand Song, Normal is immune vs Ghost").toBe(0);
  });

  // Deep Freeze (ER 764): "Boosts Water and Ice by 1.25x. Halves Fire damage
  // taken." The Fire-halving defensive piece was previously unwired. Verify the
  // holder takes half damage from an incoming Fire move.
  it("Deep Freeze: halves incoming Fire-move damage", async () => {
    const deepFreeze = await erId(764);
    if (deepFreeze === undefined) {
      return;
    }
    game.override
      .battleStyle("single")
      .ability(deepFreeze)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemySpecies(SpeciesId.CHARIZARD) // Fire attacker
      .enemyMoveset(MoveId.FLAMETHROWER)
      .moveset(MoveId.SPLASH)
      .startingLevel(100)
      .enemyLevel(100)
      .criticalHits(false);
    await game.classicMode.startBattle([SpeciesId.SNORLAX]); // Normal: Fire is neutral

    vi.spyOn(Pokemon.prototype, "randBattleSeedIntRange").mockImplementation((_min: number, max: number) => max);
    const player = game.field.getPlayerPokemon();

    let hp0 = player.hp;
    game.move.use(MoveId.SPLASH);
    await game.toNextTurn();
    const dmgReduced = hp0 - player.hp;

    player.summonData.abilitySuppressed = true;
    player.hp = player.getMaxHp();
    hp0 = player.hp;
    game.move.use(MoveId.SPLASH);
    await game.toEndOfTurn();
    const dmgFull = hp0 - player.hp;

    expect(dmgFull, "baseline Flamethrower dealt damage").toBeGreaterThan(0);
    const ratio = dmgReduced / dmgFull;
    expect(ratio, `Deep Freeze should halve Fire damage (~0.5x, got ${ratio.toFixed(3)})`).toBeGreaterThan(0.45);
    expect(ratio, `Deep Freeze should halve Fire damage (~0.5x, got ${ratio.toFixed(3)})`).toBeLessThan(0.55);
  });

  // Terastal Treasure (ER 705): "Reduces damage taken by 40%, but lowers speed by
  // 20%." The speed penalty was previously unwired. Verify effective Speed is 0.8x.
  it("Terastal Treasure: effective Speed is 0.8x (the -20% tradeoff)", async () => {
    const terastal = await erId(705);
    if (terastal === undefined) {
      return;
    }
    game.override
      .battleStyle("single")
      .ability(terastal)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemySpecies(SpeciesId.SNORLAX)
      .enemyMoveset(MoveId.SPLASH)
      .moveset(MoveId.SPLASH)
      .startingLevel(100)
      .enemyLevel(100);
    await game.classicMode.startBattle([SpeciesId.SNORLAX]);
    const player = game.field.getPlayerPokemon();
    const spdWith = player.getEffectiveStat(Stat.SPD);
    player.summonData.abilitySuppressed = true;
    const spdWithout = player.getEffectiveStat(Stat.SPD);
    expect(spdWithout, "baseline speed").toBeGreaterThan(0);
    const ratio = spdWith / spdWithout;
    expect(ratio, `Terastal Treasure should give 0.8x Speed (got ${ratio.toFixed(3)})`).toBeGreaterThan(0.78);
    expect(ratio, `Terastal Treasure should give 0.8x Speed (got ${ratio.toFixed(3)})`).toBeLessThan(0.82);
  });

  // Winter Throne (ER 874): "1/8 Damage each turn to non-ice. Heals Ice 1/8 each
  // turn." The Ice self-heal was previously deferred. Verify an Ice-type holder
  // heals ~1/8 max HP per turn (when below full).
  it("Winter Throne: Ice-type holder heals 1/8 max HP per turn", async () => {
    const winterThrone = await erId(874);
    if (winterThrone === undefined) {
      return;
    }
    game.override
      .battleStyle("single")
      .ability(winterThrone)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemySpecies(SpeciesId.SNORLAX)
      .enemyMoveset(MoveId.SPLASH)
      .moveset(MoveId.SPLASH)
      .startingLevel(100)
      .enemyLevel(100);
    await game.classicMode.startBattle([SpeciesId.GLALIE]); // pure Ice
    const player = game.field.getPlayerPokemon();
    player.hp = Math.floor(player.getMaxHp() / 2); // below full so heal fires
    const hpBefore = player.hp;
    game.move.use(MoveId.SPLASH);
    await game.toNextTurn();
    const healed = player.hp - hpBefore;
    const eighth = Math.floor(player.getMaxHp() / 8);
    expect(healed, `Winter Throne should heal ~1/8 (${eighth}); got ${healed}`).toBeGreaterThanOrEqual(eighth - 1);
    expect(healed, `Winter Throne should heal ~1/8 (${eighth}); got ${healed}`).toBeLessThanOrEqual(eighth + 1);
  });

  // Reusable exact-multiplier check for an unconditional offensive type-boost
  // ability: deal `move` (of the boosted type) with the ability active vs
  // suppressed and assert the damage ratio ~= the expected multiplier.
  async function expectOffensiveTypeBoost(opts: {
    erAbilityId: number;
    move: MoveId;
    expected: number;
    enemy?: SpeciesId;
    user?: SpeciesId;
    /** When set, the user's HP is pinned to this fraction of max before each
     * measurement — used to exercise the low-HP boost tier (e.g. 0.25 to be
     * below a 1/3 threshold). */
    userHpFraction?: number;
  }): Promise<void> {
    const ability = await erId(opts.erAbilityId);
    if (ability === undefined) {
      return;
    }
    game.override
      .battleStyle("single")
      .ability(ability)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemySpecies(opts.enemy ?? SpeciesId.SNORLAX)
      .enemyMoveset(MoveId.SPLASH)
      .moveset(opts.move)
      .startingLevel(100)
      .enemyLevel(100)
      .criticalHits(false);
    await game.classicMode.startBattle([opts.user ?? SpeciesId.SNORLAX]);
    vi.spyOn(Pokemon.prototype, "randBattleSeedIntRange").mockImplementation((_min: number, max: number) => max);
    const enemy = game.field.getEnemyPokemon();
    const player = game.field.getPlayerPokemon();
    const pinHp = () => {
      if (opts.userHpFraction !== undefined) {
        player.hp = Math.max(1, Math.floor(player.getMaxHp() * opts.userHpFraction));
      }
    };
    pinHp();
    let hp0 = enemy.hp;
    game.move.use(opts.move);
    await game.toNextTurn();
    const dmgBoosted = hp0 - enemy.hp;
    player.summonData.abilitySuppressed = true;
    pinHp();
    enemy.hp = enemy.getMaxHp();
    hp0 = enemy.hp;
    game.move.use(opts.move);
    await game.toEndOfTurn();
    const dmgBase = hp0 - enemy.hp;
    expect(dmgBase, "baseline dealt damage").toBeGreaterThan(0);
    const ratio = dmgBoosted / dmgBase;
    expect(ratio, `expected ~${opts.expected}x (got ${ratio.toFixed(3)})`).toBeGreaterThan(opts.expected - 0.05);
    expect(ratio, `expected ~${opts.expected}x (got ${ratio.toFixed(3)})`).toBeLessThan(opts.expected + 0.05);
  }

  // Electrocytes (281): Electric moves x1.25 (C-source + description agree).
  it("Electrocytes: Electric moves x1.25", async () => {
    await expectOffensiveTypeBoost({ erAbilityId: 281, move: MoveId.THUNDERBOLT, expected: 1.25 });
  });

  // Nocturnal (306): Dark moves x1.25 (C-source + description agree).
  it("Nocturnal: Dark moves x1.25", async () => {
    await expectOffensiveTypeBoost({ erAbilityId: 306, move: MoveId.DARK_PULSE, expected: 1.25 });
  });

  // Earthbound (299): Ground moves x1.2 at full HP (1.5x under 1/3 HP — not tested here).
  it("Earthbound: Ground moves x1.2 (full HP)", async () => {
    await expectOffensiveTypeBoost({ erAbilityId: 299, move: MoveId.EARTHQUAKE, expected: 1.2 });
  });

  // Psychic Mind (343): Psychic moves x1.2 at full HP (1.5x under 1/3 HP).
  it("Psychic Mind: Psychic moves x1.2 (full HP)", async () => {
    await expectOffensiveTypeBoost({ erAbilityId: 343, move: MoveId.PSYCHIC, expected: 1.2 });
  });

  // Composite "X STAB" riders — the holder gets +1.5x on off-type moves of the
  // named type. Tested on composites whose OTHER part doesn't touch damage:
  // Acidic Slime (Corrosion + Poison STAB) and Tender Affection (Cute Charm +
  // Fairy STAB). User is Normal-type Snorlax (no natural STAB on the test move),
  // enemy Snorlax (Poison/Fairy both neutral vs Normal — no effectiveness skew).
  it("Acidic Slime (760 rider): Poison STAB gives off-type Poison moves x1.5", async () => {
    await expectOffensiveTypeBoost({ erAbilityId: 760, move: MoveId.SLUDGE_BOMB, expected: 1.5 });
  });

  it("Tender Affection (826 rider): Fairy STAB gives off-type Fairy moves x1.5", async () => {
    await expectOffensiveTypeBoost({ erAbilityId: 826, move: MoveId.MOONBLAST, expected: 1.5 });
  });

  // Atomic Punch (681): "Iron Fist + 30% Steel type damage". Tested with Flash
  // Cannon — a Steel move that is NOT a punch, so the Iron Fist half doesn't
  // confound the x1.3 Steel-type boost.
  it("Atomic Punch (681 rider): Steel moves x1.3", async () => {
    await expectOffensiveTypeBoost({ erAbilityId: 681, move: MoveId.FLASH_CANNON, expected: 1.3 });
  });

  // Low-HP boost tier — these abilities swap to a higher multiplier below 1/3 HP
  // (the `lowHpMultiplier`/`lowHpThreshold` params). Pin the user to 25% HP to
  // exercise the low-HP branch; full-HP is checked separately to prove the swap.
  it("Hellblaze (417): Fire moves x1.3 at full HP", async () => {
    await expectOffensiveTypeBoost({ erAbilityId: 417, move: MoveId.FLAMETHROWER, expected: 1.3 });
  });

  it("Hellblaze (417): Fire moves x1.8 below 1/3 HP", async () => {
    await expectOffensiveTypeBoost({
      erAbilityId: 417,
      move: MoveId.FLAMETHROWER,
      expected: 1.8,
      userHpFraction: 0.25,
    });
  });

  it("Short Circuit (322): Electric moves x1.5 below 1/3 HP", async () => {
    await expectOffensiveTypeBoost({
      erAbilityId: 322,
      move: MoveId.THUNDERBOLT,
      expected: 1.5,
      userHpFraction: 0.25,
    });
  });

  // Recoil rider — "boosts X-type moves but they have N% recoil". The boost is
  // covered above; here we confirm the recoil DOWNSIDE is wired (previously the
  // dispatcher dropped recoilPct, making these a pure over-powered boost).
  it("Electric Burst (336): Electric moves deal 10% recoil to the user", async () => {
    const ability = await erId(336);
    if (ability === undefined) {
      return;
    }
    game.override
      .battleStyle("single")
      .ability(ability) // Electric Burst — not Rock Head / Magic Guard
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemySpecies(SpeciesId.SNORLAX)
      .enemyMoveset(MoveId.SPLASH)
      .moveset(MoveId.THUNDERBOLT)
      .startingLevel(100)
      .enemyLevel(100)
      .criticalHits(false);
    await game.classicMode.startBattle([SpeciesId.SNORLAX]);
    vi.spyOn(Pokemon.prototype, "randBattleSeedIntRange").mockImplementation((_min: number, max: number) => max);
    const enemy = game.field.getEnemyPokemon();
    const player = game.field.getPlayerPokemon();
    const enemyHp0 = enemy.hp;
    const playerHp0 = player.hp;
    game.move.use(MoveId.THUNDERBOLT);
    await game.toEndOfTurn();
    const dmgDealt = enemyHp0 - enemy.hp;
    const recoilTaken = playerHp0 - player.hp;
    expect(dmgDealt, "move dealt damage").toBeGreaterThan(0);
    expect(recoilTaken, "user took recoil").toBeGreaterThan(0);
    const expected = Math.floor(dmgDealt * 0.1);
    expect(Math.abs(recoilTaken - expected)).toBeLessThanOrEqual(2);
  });

  // Arcane Force (494): "All moves gain STAB. Ups super-effective by 10%."
  // Isolate the +10% SE rider with a STAB super-effective move (Water Gun on a
  // Water user vs a Fire enemy): the all-moves StabAdd skips real-STAB moves, so
  // only the 1.1x SE rider is left to measure. (40-BP Water Gun avoids an OHKO
  // that would mask the ratio — the earlier "0.41x" was such a test artifact.)
  it("Arcane Force (494): super-effective STAB moves get the +10% rider", async () => {
    await expectOffensiveTypeBoost({
      erAbilityId: 494,
      move: MoveId.WATER_GUN,
      expected: 1.1,
      user: SpeciesId.BLASTOISE,
      enemy: SpeciesId.ARCANINE, // Fire: Water Gun is 2x super-effective
    });
  });
});

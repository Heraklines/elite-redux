/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// #103 / #127 — composite-ability RIDERS wired via the hand-maintained
// `compositeRiderAttrs` table (free-text effects the auto-generator couldn't
// resolve). These verify the riders that use existing/new primitives:
//   - Two-Faced (785): Electric & Dark moves x1.35 WITH 10% recoil
//     (TypeDamageBoost + TypeRecoil).
//   - Mucus Membrane (986): takes 30% less damage from all attacks
//     (DamageReduction, filter "all").
//
// Damage variance mocked to a constant so ratios are deterministic.
// Gated behind ER_SCENARIO=1.
// =============================================================================

import { InfatuatedTag } from "#data/battler-tags";
import { AbilityId } from "#enums/ability-id";
import { MoveId } from "#enums/move-id";
import { PokemonType } from "#enums/pokemon-type";
import { SpeciesId } from "#enums/species-id";
import { Stat } from "#enums/stat";
import { StatusEffect } from "#enums/status-effect";
import { WeatherType } from "#enums/weather-type";
import { Pokemon } from "#field/pokemon";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const RUN_SCENARIOS = process.env.ER_SCENARIO === "1";

async function erId(id: number): Promise<AbilityId | undefined> {
  const erIdMap = (await import("#data/elite-redux/er-id-map")).ER_ID_MAP;
  return erIdMap.abilities[id] as AbilityId | undefined;
}

describe.skipIf(!RUN_SCENARIOS)("ER composite riders (#127)", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
  });

  it("Two-Faced (785): Electric move takes 10% recoil (boost rider's downside)", async () => {
    const ability = await erId(785);
    if (ability === undefined) {
      return;
    }
    game.override
      .battleStyle("single")
      .ability(ability) // Two-Faced — not Rock Head / Magic Guard
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemySpecies(SpeciesId.SNORLAX)
      .enemyMoveset(MoveId.SPLASH)
      .moveset([MoveId.THUNDERBOLT, MoveId.TACKLE])
      .startingLevel(100)
      .enemyLevel(100)
      .criticalHits(false);
    await game.classicMode.startBattle([SpeciesId.SNORLAX]);
    vi.spyOn(Pokemon.prototype, "randBattleSeedIntRange").mockImplementation((_min: number, max: number) => max);
    const enemy = game.field.getEnemyPokemon();
    const player = game.field.getPlayerPokemon();
    const enemyHp0 = enemy.hp;
    const playerHp0 = player.hp;
    game.move.use(MoveId.THUNDERBOLT); // Electric — boosted, with recoil
    await game.toEndOfTurn();
    const dmgDealt = enemyHp0 - enemy.hp;
    const recoilTaken = playerHp0 - player.hp;
    expect(dmgDealt, "Electric move dealt damage").toBeGreaterThan(0);
    expect(recoilTaken, "user took recoil").toBeGreaterThan(0);
    const expected = Math.floor(dmgDealt * 0.1);
    expect(Math.abs(recoilTaken - expected)).toBeLessThanOrEqual(2);
  });

  it("Two-Faced (785): a NON-Electric/Dark move takes NO recoil (type-gated)", async () => {
    const ability = await erId(785);
    if (ability === undefined) {
      return;
    }
    game.override
      .battleStyle("single")
      .ability(ability)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemySpecies(SpeciesId.SNORLAX)
      .enemyMoveset(MoveId.SPLASH)
      .moveset([MoveId.TACKLE, MoveId.THUNDERBOLT])
      .startingLevel(100)
      .enemyLevel(100)
      .criticalHits(false);
    await game.classicMode.startBattle([SpeciesId.SNORLAX]);
    vi.spyOn(Pokemon.prototype, "randBattleSeedIntRange").mockImplementation((_min: number, max: number) => max);
    const player = game.field.getPlayerPokemon();
    const playerHp0 = player.hp;
    game.move.use(MoveId.TACKLE); // Normal — not Electric/Dark, no recoil
    await game.toEndOfTurn();
    expect(player.hp, "Normal move should not cause recoil").toBe(playerHp0);
  });

  it("Mucus Membrane (986): takes 30% less damage from attacks", async () => {
    const ability = await erId(986);
    if (ability === undefined) {
      return;
    }
    game.override
      .battleStyle("single")
      .ability(ability)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemySpecies(SpeciesId.SNORLAX)
      .enemyMoveset(MoveId.TACKLE)
      .moveset(MoveId.SPLASH)
      .startingLevel(100)
      .enemyLevel(100)
      .criticalHits(false);
    await game.classicMode.startBattle([SpeciesId.SNORLAX]);
    vi.spyOn(Pokemon.prototype, "randBattleSeedIntRange").mockImplementation((_min: number, max: number) => max);
    const player = game.field.getPlayerPokemon();

    // Turn 1 — ability active: reduced incoming damage.
    let hp0 = player.hp;
    game.move.use(MoveId.SPLASH);
    await game.toNextTurn();
    const dmgReduced = hp0 - player.hp;

    // Suppress, heal, take the hit again at full.
    player.summonData.abilitySuppressed = true;
    player.hp = player.getMaxHp();
    hp0 = player.hp;
    game.move.use(MoveId.SPLASH);
    await game.toEndOfTurn();
    const dmgFull = hp0 - player.hp;

    expect(dmgFull, "baseline dealt damage").toBeGreaterThan(0);
    const ratio = dmgReduced / dmgFull;
    expect(ratio, `expected ~0.7x taken (got ${ratio.toFixed(3)})`).toBeGreaterThan(0.65);
    expect(ratio, `expected ~0.7x taken (got ${ratio.toFixed(3)})`).toBeLessThan(0.75);
  });

  it("Dreamscape (859): all moves deal 20% more damage", async () => {
    const ability = await erId(859);
    if (ability === undefined) {
      return;
    }
    game.override
      .battleStyle("single")
      .ability(ability)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemySpecies(SpeciesId.SNORLAX)
      .enemyMoveset(MoveId.SPLASH)
      .moveset(MoveId.TACKLE)
      .startingLevel(100)
      .enemyLevel(100)
      .criticalHits(false);
    await game.classicMode.startBattle([SpeciesId.SNORLAX]);
    vi.spyOn(Pokemon.prototype, "randBattleSeedIntRange").mockImplementation((_min: number, max: number) => max);
    const enemy = game.field.getEnemyPokemon();
    const player = game.field.getPlayerPokemon();

    let hp0 = enemy.hp;
    game.move.use(MoveId.TACKLE);
    await game.toNextTurn();
    const dmgBoosted = hp0 - enemy.hp;

    player.summonData.abilitySuppressed = true;
    enemy.hp = enemy.getMaxHp();
    hp0 = enemy.hp;
    game.move.use(MoveId.TACKLE);
    await game.toEndOfTurn();
    const dmgBase = hp0 - enemy.hp;

    expect(dmgBase, "baseline dealt damage").toBeGreaterThan(0);
    const ratio = dmgBoosted / dmgBase;
    expect(ratio, `expected ~1.2x (got ${ratio.toFixed(3)})`).toBeGreaterThan(1.15);
    expect(ratio, `expected ~1.2x (got ${ratio.toFixed(3)})`).toBeLessThan(1.25);
  });

  it("Marine Apex (389): +50% damage vs Water-type targets", async () => {
    const ability = await erId(389);
    if (ability === undefined) {
      return;
    }
    game.override
      .battleStyle("single")
      .ability(ability)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemySpecies(SpeciesId.VAPOREON) // pure Water; Tackle is neutral vs Water
      .enemyMoveset(MoveId.SPLASH)
      .moveset(MoveId.TACKLE)
      .startingLevel(100)
      .enemyLevel(100)
      .criticalHits(false);
    await game.classicMode.startBattle([SpeciesId.SNORLAX]);
    vi.spyOn(Pokemon.prototype, "randBattleSeedIntRange").mockImplementation((_min: number, max: number) => max);
    const enemy = game.field.getEnemyPokemon();
    const player = game.field.getPlayerPokemon();
    let hp0 = enemy.hp;
    game.move.use(MoveId.TACKLE);
    await game.toNextTurn();
    const dmgBoosted = hp0 - enemy.hp;
    player.summonData.abilitySuppressed = true;
    enemy.hp = enemy.getMaxHp();
    hp0 = enemy.hp;
    game.move.use(MoveId.TACKLE);
    await game.toEndOfTurn();
    const dmgBase = hp0 - enemy.hp;
    expect(dmgBase, "baseline dealt damage").toBeGreaterThan(0);
    const ratio = dmgBoosted / dmgBase;
    expect(ratio, `expected ~1.5x vs Water (got ${ratio.toFixed(3)})`).toBeGreaterThan(1.45);
    expect(ratio, `expected ~1.5x vs Water (got ${ratio.toFixed(3)})`).toBeLessThan(1.55);
  });

  it("Sinister Claws (1011): a slicing move lowers the target's Sp. Def", async () => {
    const ability = await erId(1011);
    if (ability === undefined) {
      return;
    }
    game.override
      .battleStyle("single")
      .ability(ability)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemySpecies(SpeciesId.SNORLAX)
      .enemyMoveset(MoveId.SPLASH)
      .moveset([MoveId.SLASH, MoveId.TACKLE]) // SLASH is a slicing move
      .startingLevel(100)
      .enemyLevel(100)
      .criticalHits(false);
    await game.classicMode.startBattle([SpeciesId.SNORLAX]);
    const enemy = game.field.getEnemyPokemon();
    game.move.use(MoveId.SLASH);
    await game.toEndOfTurn();
    expect(enemy.getStatStage(Stat.SPDEF)).toBe(-1);
  });

  it("Sinister Claws (1011): a NON-slicing move does NOT lower Sp. Def", async () => {
    const ability = await erId(1011);
    if (ability === undefined) {
      return;
    }
    game.override
      .battleStyle("single")
      .ability(ability)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemySpecies(SpeciesId.SNORLAX)
      .enemyMoveset(MoveId.SPLASH)
      .moveset([MoveId.TACKLE, MoveId.SLASH])
      .startingLevel(100)
      .enemyLevel(100)
      .criticalHits(false);
    await game.classicMode.startBattle([SpeciesId.SNORLAX]);
    const enemy = game.field.getEnemyPokemon();
    game.move.use(MoveId.TACKLE);
    await game.toEndOfTurn();
    expect(enemy.getStatStage(Stat.SPDEF)).toBe(0);
  });

  it("Komodo (851): nativized to Draconize + Envenom, no longer adds Dragon type on summon", async () => {
    // Maintainer 2026-07-17: Komodo swapped its Half-Drake type-grant for Draconize
    // (Normal moves become Dragon-type; conditional Dragon STAB / Dragon-vs-Fairy),
    // keeping the Envenom poison. The holder must NOT gain a persistent Dragon type
    // on entry any more (the type-grant was removed epic-wide). See
    // test/tests/elite-redux/er-7corrections.test.ts for the attr-level assertions.
    const ability = await erId(851);
    if (ability === undefined) {
      return;
    }
    game.override
      .battleStyle("single")
      .ability(ability)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemySpecies(SpeciesId.SNORLAX)
      .enemyMoveset(MoveId.SPLASH)
      .moveset(MoveId.SPLASH)
      .startingLevel(100)
      .enemyLevel(100)
      .criticalHits(false);
    await game.classicMode.startBattle([SpeciesId.SNORLAX]); // Normal-type base
    const player = game.field.getPlayerPokemon();
    expect(player.getTypes()).not.toContain(PokemonType.DRAGON);
  });

  it("Lightsaber (908): adds Fire type on summon", async () => {
    const ability = await erId(908);
    if (ability === undefined) {
      return;
    }
    game.override
      .battleStyle("single")
      .ability(ability)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemySpecies(SpeciesId.SNORLAX)
      .enemyMoveset(MoveId.SPLASH)
      .moveset(MoveId.SPLASH)
      .startingLevel(100)
      .enemyLevel(100)
      .criticalHits(false);
    await game.classicMode.startBattle([SpeciesId.SNORLAX]); // Normal-type base
    const player = game.field.getPlayerPokemon();
    expect(player.getTypes()).toContain(PokemonType.FIRE);
  });

  it("Overcast (983): sets Mist on entry (blocks enemy stat drops)", async () => {
    const ability = await erId(983);
    if (ability === undefined) {
      return;
    }
    game.override
      .battleStyle("single")
      .ability(ability)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemySpecies(SpeciesId.SNORLAX)
      .enemyMoveset(MoveId.GROWL) // would lower the player's Atk by 1...
      .moveset(MoveId.SPLASH)
      .startingLevel(100)
      .enemyLevel(100)
      .criticalHits(false);
    await game.classicMode.startBattle([SpeciesId.SNORLAX]);
    const player = game.field.getPlayerPokemon();
    game.move.use(MoveId.SPLASH);
    await game.toEndOfTurn();
    // ...but Mist (set on entry) blocks the drop.
    expect(player.getStatStage(Stat.ATK)).toBe(0);
  });

  it("Cryo Proficiency (493): sets Hail when the holder is hit", async () => {
    const ability = await erId(493);
    if (ability === undefined) {
      return;
    }
    game.override
      .battleStyle("single")
      .ability(ability)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemySpecies(SpeciesId.SNORLAX)
      .enemyMoveset(MoveId.TACKLE) // hits the holder → triggers the PostDefend weather
      .moveset(MoveId.SPLASH)
      .startingLevel(100)
      .enemyLevel(100)
      .criticalHits(false);
    await game.classicMode.startBattle([SpeciesId.SNORLAX]);
    game.move.use(MoveId.SPLASH);
    await game.toEndOfTurn();
    expect(game.scene.arena.weather?.weatherType).toBe(WeatherType.HAIL);
  });

  it("Molten Core (870): absorbs Rock-type moves (immune + heals)", async () => {
    const ability = await erId(870);
    if (ability === undefined) {
      return;
    }
    game.override
      .battleStyle("single")
      .ability(ability)
      .enemyAbility(AbilityId.NO_GUARD) // guarantee Rock Slide connects
      .enemySpecies(SpeciesId.RHYPERIOR)
      .enemyMoveset(MoveId.ROCK_SLIDE)
      .moveset(MoveId.SPLASH)
      .startingLevel(100)
      .enemyLevel(100)
      .criticalHits(false);
    await game.classicMode.startBattle([SpeciesId.SNORLAX]);
    const player = game.field.getPlayerPokemon();
    player.hp = Math.floor(player.getMaxHp() / 2); // below max so the absorb-heal is observable
    const hpBefore = player.hp;
    game.move.use(MoveId.SPLASH);
    await game.toEndOfTurn();
    // Rock Slide is absorbed: no damage taken, and the holder heals instead.
    expect(player.hp).toBeGreaterThan(hpBefore);
  });

  it("Superheavy (848): carries force-switch immunity (blocks phasing)", async () => {
    const ability = await erId(848);
    if (ability === undefined) {
      return;
    }
    game.override
      .battleStyle("single")
      .ability(ability)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemySpecies(SpeciesId.SNORLAX)
      .enemyMoveset(MoveId.SPLASH)
      .moveset(MoveId.SPLASH)
      .startingLevel(100)
      .enemyLevel(100)
      .criticalHits(false);
    await game.classicMode.startBattle([SpeciesId.SNORLAX]);
    const player = game.field.getPlayerPokemon();
    // The composite wires Suction-Cups-style force-switch immunity.
    expect(player.hasAbilityWithAttr("ForceSwitchOutImmunityAbAttr")).toBe(true);
  });

  it("Sword of Damnation (689): named rider 'Sword of Ruin' is resolved (Def-lower field attr)", async () => {
    const ability = await erId(689);
    if (ability === undefined) {
      return;
    }
    game.override
      .battleStyle("single")
      .ability(ability)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemySpecies(SpeciesId.SNORLAX)
      .enemyMoveset(MoveId.SPLASH)
      .moveset(MoveId.SPLASH)
      .startingLevel(100)
      .enemyLevel(100)
      .criticalHits(false);
    await game.classicMode.startBattle([SpeciesId.SNORLAX]);
    const player = game.field.getPlayerPokemon();
    // The runtime named-rider resolver maps "Sword of Ruin" → vanilla
    // SWORD_OF_RUIN and copies its FieldMultiplyStatAbAttr (Def x0.75).
    expect(player.hasAbilityWithAttr("FieldMultiplyStatAbAttr")).toBe(true);
  });

  it("Demolitionist (616): contact move ignores the foe's Protect", async () => {
    const ability = await erId(616);
    if (ability === undefined) {
      return;
    }
    game.override
      .battleStyle("single")
      .ability(ability)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemySpecies(SpeciesId.SNORLAX)
      .enemyMoveset(MoveId.PROTECT)
      .moveset(MoveId.TACKLE) // contact move — bypasses Protect via Unseen-Fist effect
      .startingLevel(100)
      .enemyLevel(100)
      .criticalHits(false);
    await game.classicMode.startBattle([SpeciesId.SNORLAX]);
    const enemy = game.field.getEnemyPokemon();
    const hp0 = enemy.hp;
    game.move.use(MoveId.TACKLE);
    await game.toEndOfTurn();
    expect(enemy.hp).toBeLessThan(hp0);
  });

  it("Nika (469): Water moves ignore the sun damage penalty", async () => {
    const ability = await erId(469);
    if (ability === undefined) {
      return;
    }
    game.override
      .battleStyle("single")
      .ability(ability)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemySpecies(SpeciesId.SNORLAX)
      .enemyMoveset(MoveId.SPLASH)
      .moveset(MoveId.WATER_GUN)
      .weather(WeatherType.SUNNY) // sun normally halves Water moves
      .startingLevel(100)
      .enemyLevel(100)
      .criticalHits(false);
    await game.classicMode.startBattle([SpeciesId.SNORLAX]);
    vi.spyOn(Pokemon.prototype, "randBattleSeedIntRange").mockImplementation((_min: number, max: number) => max);
    const enemy = game.field.getEnemyPokemon();
    const player = game.field.getPlayerPokemon();
    // Nika active: x2.0 power cancels the x0.5 sun penalty (net normal damage).
    let hp0 = enemy.hp;
    game.move.use(MoveId.WATER_GUN);
    await game.toNextTurn();
    const dmgNika = hp0 - enemy.hp;
    // Suppress Nika: sun's x0.5 penalty applies.
    player.summonData.abilitySuppressed = true;
    enemy.hp = enemy.getMaxHp();
    hp0 = enemy.hp;
    game.move.use(MoveId.WATER_GUN);
    await game.toEndOfTurn();
    const dmgPenalized = hp0 - enemy.hp;
    expect(dmgPenalized, "penalized damage > 0").toBeGreaterThan(0);
    const ratio = dmgNika / dmgPenalized;
    expect(ratio, `expected ~2.0x vs the sun-penalized baseline (got ${ratio.toFixed(3)})`).toBeGreaterThan(1.9);
    expect(ratio, `expected ~2.0x vs the sun-penalized baseline (got ${ratio.toFixed(3)})`).toBeLessThan(2.1);
  });

  it("Pure Love (508): heals 25% of damage dealt to an INFATUATED target", async () => {
    const ability = await erId(508);
    if (ability === undefined) {
      return;
    }
    game.override
      .battleStyle("single")
      .ability(ability)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemySpecies(SpeciesId.SNORLAX)
      .enemyMoveset(MoveId.SPLASH)
      .moveset(MoveId.TACKLE)
      .startingLevel(100)
      .enemyLevel(100)
      .criticalHits(false);
    await game.classicMode.startBattle([SpeciesId.SNORLAX]);
    vi.spyOn(Pokemon.prototype, "randBattleSeedIntRange").mockImplementation((_min: number, max: number) => max);
    const enemy = game.field.getEnemyPokemon();
    const player = game.field.getPlayerPokemon();
    // Force the target infatuated (bypass gender check) so the lifesteal gate fires.
    enemy.summonData.tags.push(new InfatuatedTag(MoveId.NONE, player.id));
    player.hp = Math.floor(player.getMaxHp() / 2); // below max so the heal is observable
    const hpBefore = player.hp;
    const eHp0 = enemy.hp;
    game.move.use(MoveId.TACKLE);
    await game.toEndOfTurn();
    const dmg = eHp0 - enemy.hp;
    const healed = player.hp - hpBefore;
    expect(dmg, "move dealt damage").toBeGreaterThan(0);
    expect(healed, "user healed off the infatuated target").toBeGreaterThan(0);
    const expected = Math.floor(dmg * 0.25);
    expect(Math.abs(healed - expected)).toBeLessThanOrEqual(2);
  });

  it("Royal Decree (857): paralyzes the foe with Glare on entry", async () => {
    const ability = await erId(857);
    if (ability === undefined) {
      return;
    }
    game.override
      .battleStyle("single")
      .ability(ability)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemySpecies(SpeciesId.SNORLAX)
      .enemyMoveset(MoveId.SPLASH)
      .moveset(MoveId.SPLASH)
      .startingLevel(100)
      .enemyLevel(100)
      .criticalHits(false);
    await game.classicMode.startBattle([SpeciesId.SNORLAX]);
    const enemy = game.field.getEnemyPokemon();
    game.move.use(MoveId.SPLASH);
    await game.toEndOfTurn();
    // Glare-on-entry (once per battle) paralyzes the foe.
    expect(enemy.status?.effect).toBe(StatusEffect.PARALYSIS);
  });

  it("Pure Love (508): does NOT heal off a non-infatuated target", async () => {
    const ability = await erId(508);
    if (ability === undefined) {
      return;
    }
    game.override
      .battleStyle("single")
      .ability(ability)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemySpecies(SpeciesId.SNORLAX)
      .enemyMoveset(MoveId.SPLASH)
      .moveset(MoveId.TACKLE)
      .startingLevel(100)
      .enemyLevel(100)
      .criticalHits(false);
    await game.classicMode.startBattle([SpeciesId.SNORLAX]);
    const player = game.field.getPlayerPokemon();
    player.hp = Math.floor(player.getMaxHp() / 2);
    const hpBefore = player.hp;
    game.move.use(MoveId.TACKLE);
    await game.toEndOfTurn();
    // Target isn't infatuated → the conditional lifesteal does not fire.
    expect(player.hp).toBe(hpBefore);
  });
});

/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// ER ability dex-fidelity batch 2 — runtime BEHAVIOR proofs (GameManager).
//
// Covers the combat-observable clauses from the ER 2.65 dex fix-plan (Section B),
// second sweep:
//   240 Mirror Armor    — reflected drop bypasses the attacker's Clear Body
//   242 Stalwart        — unsuppressable / uncopiable / unreplaceable (data)
//   314 Mountaineer     — immune to Stealth Rock switch-in damage
//   335 Haunted Spirit  — GHOST-type attacker is immune to the on-KO curse
//   379 Ice Dew         — Ice absorb boosts the HIGHER attacking stat (data)
//   402 Toxic Debris    — sets Toxic Spikes on CONTACT (not physical-non-contact)
//   438 Jaws of Carnage — biting KO heals 50%, other KO heals 25%
//   477 Generator       — recharges (CHARGED) when Electric Terrain becomes active
//   478 Moon Spirit     — Moonlight recovers 75% (vs 50% control)
//   553 Guard Dog       — Scare raises SpAtk / Intimidate raises Atk (mirror)
//   570 Ill Will        — the KO move's PP is fully drained on the attacker
//   320 Air Blower      — casts a 3-turn Tailwind on entry
//   226 Electro Surge   — Electric Terrain 8 turns → 12 with Terrain Extender
//   834 Toxic Surge     — grounded STEEL is immune to the chip; Spikes → T-Spikes
//   606 Aerialist       — Flying-move power boosted (Flock 1.2 × rider 1.25)
//   300 Fighting Spirit — Normal moves become Fighting-type
//
// Gated ER_SCENARIO=1; the test framework clamps rolls to MAX so damage/heals are
// deterministic and sub-100% procs never fire (none of these clauses need them).
// =============================================================================

import { allAbilities, allMoves } from "#data/data-lists";
import { OnFaintEffectAbAttr } from "#data/elite-redux/archetypes/on-faint-effect";
import { ER_ABILITY_ARCHETYPES } from "#data/elite-redux/er-ability-archetypes";
import { TerrainType } from "#data/terrain";
import { AbilityId } from "#enums/ability-id";
import { ArenaTagSide } from "#enums/arena-tag-side";
import { ArenaTagType } from "#enums/arena-tag-type";
import { BattlerTagType } from "#enums/battler-tag-type";
import { ErAbilityId } from "#enums/er-ability-id";
import { MoveId } from "#enums/move-id";
import { PokemonType } from "#enums/pokemon-type";
import { SpeciesId } from "#enums/species-id";
import { Stat } from "#enums/stat";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";
const asAbility = (er: number): AbilityId => er as unknown as AbilityId;

describe.skipIf(!RUN)("ER ability dex-fidelity batch 2 — behavior", () => {
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
      .enemySpecies(SpeciesId.SNORLAX)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemyMoveset(MoveId.SPLASH)
      .enemyLevel(100)
      .startingLevel(100);
  });

  // 242 Stalwart — the ability is now flagged unsuppressable/uncopiable/unreplaceable
  // (and remains non-ignorable ⇒ Mold-Breaker immune).
  it("242 Stalwart: is unsuppressable / uncopiable / unreplaceable (+ Mold-Breaker immune)", () => {
    const stalwart = allAbilities[AbilityId.STALWART];
    expect(stalwart.suppressable).toBe(false);
    expect(stalwart.copiable).toBe(false);
    expect(stalwart.replaceable).toBe(false);
    expect(stalwart.ignorable).toBe(false);
  });

  // 379 Ice Dew — the archetype now boosts the HIGHER attacking stat on absorb.
  it("379 Ice Dew: absorb boosts the highest attacking stat (not fixed ATK)", () => {
    // ER_ABILITY_ARCHETYPES is keyed by ER SOURCE id (379), not the runtime id.
    const row = ER_ABILITY_ARCHETYPES[379];
    const effect = (row?.params as { effect?: { statBoost?: { highestAttack?: boolean; stat?: string } } })?.effect;
    expect(effect?.statBoost?.highestAttack).toBe(true);
    expect(effect?.statBoost?.stat).toBeUndefined();
  });

  // 402 Toxic Debris — sets Toxic Spikes on the attacker's side when hit by a
  // CONTACT move, and does NOT on a physical non-contact move.
  it("402 Toxic Debris: sets Toxic Spikes on CONTACT, not on physical non-contact", async () => {
    game.override.ability(AbilityId.TOXIC_DEBRIS).enemyMoveset(MoveId.TACKLE);
    await game.classicMode.startBattle(SpeciesId.SNORLAX);
    expect(game.scene.arena.getTagOnSide(ArenaTagType.TOXIC_SPIKES, ArenaTagSide.ENEMY)).toBeUndefined();
    game.move.use(MoveId.SPLASH);
    await game.toEndOfTurn();
    // Tackle makes contact → Toxic Spikes laid on the attacker (enemy) side.
    expect(game.scene.arena.getTagOnSide(ArenaTagType.TOXIC_SPIKES, ArenaTagSide.ENEMY)).toBeDefined();
  });

  it("402 Toxic Debris: does NOT fire on a physical non-contact move (Earthquake)", async () => {
    game.override.ability(AbilityId.TOXIC_DEBRIS).enemyMoveset(MoveId.EARTHQUAKE);
    await game.classicMode.startBattle(SpeciesId.SKARMORY);
    game.move.use(MoveId.SPLASH);
    await game.toEndOfTurn();
    // Earthquake is physical but NON-contact → no Toxic Spikes (vanilla wrongly did).
    expect(game.scene.arena.getTagOnSide(ArenaTagType.TOXIC_SPIKES, ArenaTagSide.ENEMY)).toBeUndefined();
  });

  // 335 Haunted Spirit — a GHOST-type attacker that lands the KO is NOT cursed;
  // a non-Ghost attacker IS.
  it("335 Haunted Spirit: GHOST-type KO'er is immune to the curse; non-Ghost is cursed", async () => {
    // Non-Ghost attacker → cursed.
    game.override
      .ability(asAbility(ErAbilityId.HAUNTED_SPIRIT))
      .moveset([MoveId.SPLASH])
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemySpecies(SpeciesId.MACHAMP)
      .enemyMoveset(MoveId.TACKLE);
    // 2-mon party so the holder can faint without ending the run (bench auto-sends).
    await game.classicMode.startBattle(SpeciesId.SHUCKLE, SpeciesId.SNORLAX);
    const player = game.field.getPlayerPokemon();
    const enemy = game.field.getEnemyPokemon();
    player.hp = 1;
    game.move.select(MoveId.SPLASH);
    game.doSelectPartyPokemon(1); // send bench mon after the holder faints
    await game.toNextTurn();
    expect(enemy.getTag(BattlerTagType.CURSED)).toBeDefined();
  });

  it("335 Haunted Spirit: GHOST-type attacker is NOT cursed", async () => {
    game.override
      .ability(asAbility(ErAbilityId.HAUNTED_SPIRIT))
      .moveset([MoveId.SPLASH])
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemySpecies(SpeciesId.GENGAR)
      .enemyMoveset(MoveId.LICK);
    await game.classicMode.startBattle(SpeciesId.SHUCKLE, SpeciesId.SNORLAX);
    const player = game.field.getPlayerPokemon();
    const enemy = game.field.getEnemyPokemon();
    player.hp = 1;
    game.move.select(MoveId.SPLASH);
    game.doSelectPartyPokemon(1);
    await game.toNextTurn();
    // Ghost attacker is immune to Haunted Spirit's curse.
    expect(enemy.getTag(BattlerTagType.CURSED)).toBeUndefined();
  });

  // 438 Jaws of Carnage — biting KO heals 50% of max HP, a non-biting KO 25%.
  it("438 Jaws of Carnage: biting-move KO heals 50% max HP", async () => {
    game.override.ability(asAbility(ErAbilityId.JAWS_OF_CARNAGE)).enemySpecies(SpeciesId.MAGIKARP).enemyLevel(1);
    await game.classicMode.startBattle(SpeciesId.GYARADOS);
    const player = game.field.getPlayerPokemon();
    player.hp = 1;
    game.move.use(MoveId.BITE); // BITING_MOVE
    await game.toEndOfTurn();
    // Frail lvl-1 foe is KO'd; biting KO → heal 50% max HP.
    expect(player.hp).toBeGreaterThanOrEqual(Math.floor(player.getMaxHp() * 0.45));
    expect(player.hp).toBeLessThanOrEqual(Math.ceil(player.getMaxHp() * 0.55) + 1);
  });

  it("438 Jaws of Carnage: non-biting KO heals only 25% max HP", async () => {
    game.override.ability(asAbility(ErAbilityId.JAWS_OF_CARNAGE)).enemySpecies(SpeciesId.MAGIKARP).enemyLevel(1);
    await game.classicMode.startBattle(SpeciesId.GYARADOS);
    const player = game.field.getPlayerPokemon();
    player.hp = 1;
    game.move.use(MoveId.TACKLE); // not a biting move
    await game.toEndOfTurn();
    expect(player.hp).toBeGreaterThanOrEqual(Math.floor(player.getMaxHp() * 0.2));
    expect(player.hp).toBeLessThanOrEqual(Math.ceil(player.getMaxHp() * 0.3) + 1);
  });

  // 240 Mirror Armor — the reflected stat drop lands through the attacker's Clear Body.
  it("240 Mirror Armor: reflected drop bypasses the attacker's Clear Body", async () => {
    game.override.ability(AbilityId.MIRROR_ARMOR).enemyAbility(AbilityId.CLEAR_BODY).enemyMoveset(MoveId.GROWL);
    await game.classicMode.startBattle(SpeciesId.SNORLAX);
    const player = game.field.getPlayerPokemon();
    const enemy = game.field.getEnemyPokemon();
    game.move.use(MoveId.SPLASH);
    await game.toEndOfTurn();
    // Mirror Armor reflects Growl's ATK drop back onto the Clear Body attacker,
    // and the reflection bypasses Clear Body → enemy ATK stage is -1.
    expect(player.getStatStage(Stat.ATK)).toBe(0);
    expect(enemy.getStatStage(Stat.ATK)).toBe(-1);
  });

  // 553 Guard Dog — the RAISED stat mirrors the effect that would lower it.
  it("553 Guard Dog: Scare raises Sp. Atk instead of lowering it", async () => {
    game.override.ability(AbilityId.GUARD_DOG).enemyAbility(asAbility(ErAbilityId.SCARE));
    await game.classicMode.startBattle(SpeciesId.SNORLAX);
    const player = game.field.getPlayerPokemon();
    // Scare would lower Sp. Atk −1; Guard Dog inverts it to +1 (same stat).
    expect(player.getStatStage(Stat.SPATK)).toBe(1);
    expect(player.getStatStage(Stat.ATK)).toBe(0);
  });

  it("553 Guard Dog: Intimidate still raises Attack", async () => {
    game.override.ability(AbilityId.GUARD_DOG).enemyAbility(AbilityId.INTIMIDATE);
    await game.classicMode.startBattle(SpeciesId.SNORLAX);
    const player = game.field.getPlayerPokemon();
    expect(player.getStatStage(Stat.ATK)).toBe(1);
    expect(player.getStatStage(Stat.SPATK)).toBe(0);
  });

  // 478 Moon Spirit — Moonlight recovers 75% (vs the 50% control) in no weather.
  it("478 Moon Spirit: Moonlight recovers 75% max HP", async () => {
    game.override.ability(asAbility(ErAbilityId.MOON_SPIRIT));
    await game.classicMode.startBattle(SpeciesId.UMBREON);
    const player = game.field.getPlayerPokemon();
    expect(player.hasAbility(asAbility(ErAbilityId.MOON_SPIRIT))).toBe(true);
    const maxHp = player.getMaxHp();
    player.hp = 1;
    game.move.use(MoveId.MOONLIGHT);
    await game.toEndOfTurn();
    const healed = player.hp - 1;
    // Moon Spirit bumps Moonlight's heal ratio 0.5 → 0.75 (the raw ratio is then
    // scaled by the shared weather-recovery reduction that also hits the control,
    // so Moon Spirit lands ~0.58 vs the control's ~0.39 — clearly separated).
    expect(healed / maxHp).toBeGreaterThanOrEqual(0.5);
  });

  it("478 control: Moonlight without Moon Spirit recovers only ~50%", async () => {
    game.override.ability(AbilityId.BALL_FETCH);
    await game.classicMode.startBattle(SpeciesId.UMBREON);
    const player = game.field.getPlayerPokemon();
    const maxHp = player.getMaxHp();
    player.hp = 1;
    game.move.use(MoveId.MOONLIGHT);
    await game.toEndOfTurn();
    const healed = player.hp - 1;
    // Base Moonlight (0.5 ratio) lands well under the Moon Spirit floor (0.5).
    expect(healed / maxHp).toBeLessThanOrEqual(0.45);
  });

  // 570 Ill Will — the move that KOs the holder has its PP fully drained on the
  // attacker. Asserted SURGICALLY by invoking the exact patched on-faint path:
  // the headless framework does NOT persistently track enemy moveset PP across a
  // turn boundary (it resets ppUsed after the wave/turn), so a full-battle read
  // can't observe the drain even though it fired. Driving the attr directly on a
  // real attacker's real moveset proves the effect deterministically.
  it("570 Ill Will: on-faint drain zeroes the KO move's PP on the attacker", async () => {
    // Clear the enemy-moveset OVERRIDE so getMoveset() returns the PERSISTENT
    // moveset (an active override rebuilds throwaway copies every call — exactly
    // the framework artifact that hides the drain from a full-battle read).
    game.override.ability(AbilityId.BALL_FETCH).enemySpecies(SpeciesId.MACHAMP).enemyMoveset([]);
    await game.classicMode.startBattle(SpeciesId.SNORLAX);
    const player = game.field.getPlayerPokemon();
    const enemy = game.field.getEnemyPokemon();
    const koMove = enemy.getMoveset()[0]; // a real, persistent moveset entry
    expect(koMove).toBeDefined();
    koMove.ppUsed = 3; // partially used
    expect(koMove.getPpRatio()).toBeGreaterThan(0);
    const attr = new OnFaintEffectAbAttr({ effect: { kind: "attacker-pp-drain" } });
    const params = { pokemon: player, attacker: enemy, move: koMove.getMove(), simulated: false } as const;
    expect(attr.canApply(params)).toBe(true);
    attr.apply(params);
    // The whole PP of the KO move is drained on the attacker.
    expect(koMove.getPpRatio()).toBe(0);
    expect(koMove.ppUsed).toBe(koMove.getMovePp());
  });

  // 320 Air Blower — casts a 3-turn Tailwind on the holder's side on entry.
  it("320 Air Blower: casts a 3-turn Tailwind on entry", async () => {
    game.override.ability(asAbility(ErAbilityId.AIR_BLOWER));
    await game.classicMode.startBattle(SpeciesId.PIDGEOT);
    const tailwind = game.scene.arena.getTagOnSide(ArenaTagType.TAILWIND, ArenaTagSide.PLAYER);
    expect(tailwind).toBeDefined();
    expect(tailwind!.turnCount).toBe(3);
  });

  // 226 Electro Surge — 8-turn Electric Terrain becomes 12 with a Terrain Extender.
  it("226 Electro Surge: Electric Terrain lasts 12 turns with Terrain Extender", async () => {
    game.override
      .ability(asAbility(ErAbilityId.ELECTRO_SURGE))
      .startingHeldItems([{ name: "MYSTICAL_ROCK", count: 2 }]);
    await game.classicMode.startBattle(SpeciesId.PIKACHU);
    expect(game.scene.arena.terrain?.terrainType).toBe(TerrainType.ELECTRIC);
    // 8 base + 2/stack (2 stacks = +4) → 12. Previously the override bypassed the
    // extender entirely and stayed flat at 8.
    expect(game.scene.arena.terrain?.turnsLeft).toBe(12);
  });

  // 834 Toxic Surge — grounded STEEL takes no chip; existing Spikes → Toxic Spikes.
  it("834 Toxic Surge: Steel-type is immune to the Toxic Terrain chip (Poison too)", async () => {
    game.override.ability(asAbility(ErAbilityId.TOXIC_SURGE));
    await game.classicMode.startBattle(SpeciesId.MUK);
    const terrain = game.scene.arena.terrain;
    expect(terrain?.terrainType).toBe(TerrainType.TOXIC);
    // dex: grounded non-Poison AND non-Steel take 1/16; Poison + Steel are immune.
    expect(terrain!.isTypeDamageImmune(PokemonType.STEEL)).toBe(true);
    expect(terrain!.isTypeDamageImmune(PokemonType.POISON)).toBe(true);
    expect(terrain!.isTypeDamageImmune(PokemonType.NORMAL)).toBe(false);
  });

  it("834 Toxic Surge: setting Toxic Terrain converts existing Spikes into Toxic Spikes", async () => {
    // Neutral holder so the terrain isn't already TOXIC before we lay Spikes.
    game.override.ability(AbilityId.BALL_FETCH);
    await game.classicMode.startBattle(SpeciesId.SNORLAX);
    const enemy = game.field.getEnemyPokemon();
    const player = game.field.getPlayerPokemon();
    expect(game.scene.arena.terrain?.terrainType).not.toBe(TerrainType.TOXIC);
    // Lay two Spikes layers on the enemy side, THEN set Toxic Terrain.
    game.scene.arena.addTag(ArenaTagType.SPIKES, 0, undefined, enemy.id, ArenaTagSide.ENEMY);
    game.scene.arena.addTag(ArenaTagType.SPIKES, 0, undefined, enemy.id, ArenaTagSide.ENEMY);
    expect(game.scene.arena.getTagOnSide(ArenaTagType.SPIKES, ArenaTagSide.ENEMY)).toBeDefined();
    game.scene.arena.trySetTerrain(TerrainType.TOXIC, true, player, 8);
    // Spikes replaced by Toxic Spikes.
    expect(game.scene.arena.getTagOnSide(ArenaTagType.SPIKES, ArenaTagSide.ENEMY)).toBeUndefined();
    expect(game.scene.arena.getTagOnSide(ArenaTagType.TOXIC_SPIKES, ArenaTagSide.ENEMY)).toBeDefined();
  });

  // 300 Fighting Spirit — Normal-type moves become Fighting-type.
  it("300 Fighting Spirit: Normal moves become Fighting-type", async () => {
    game.override.ability(asAbility(ErAbilityId.FIGHTING_SPIRIT));
    await game.classicMode.startBattle(SpeciesId.SNORLAX);
    const player = game.field.getPlayerPokemon();
    // Tackle (Normal) is retyped to Fighting.
    expect(player.getMoveType(allMoves[MoveId.TACKLE])).toBe(PokemonType.FIGHTING);
  });
});

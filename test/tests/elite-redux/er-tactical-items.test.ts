/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// ER tactical held items (er-tactical-items.ts) — engine behavior:
//
//   1. Expert Belt  — x1.2 damage on super-effective hits only. Passive.
//   2. Covert Cloak — the holder is immune to move secondaries (status/stat/
//                     flinch chances hit 0 at the getMoveChance chokepoint).
//   3. Red Card     — a struck surviving holder drags the ATTACKER out for a
//                     random replacement; single use.
//   4. Eject Button — a struck surviving holder switches ITSELF out (its side
//                     picks the replacement); single use.
//
// Gated behind ER_SCENARIO=1 (like every ER engine test).
// =============================================================================

import { EntryHazardTag } from "#data/arena-tag";
import { allMoves } from "#data/data-lists";
import { ErTacticalItemModifier, erTacticalItemType } from "#data/elite-redux/er-tactical-items";
import { AbilityId } from "#enums/ability-id";
import { ArenaTagSide } from "#enums/arena-tag-side";
import { ArenaTagType } from "#enums/arena-tag-type";
import { BattlerTagType } from "#enums/battler-tag-type";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { Stat } from "#enums/stat";
import { StatusEffect } from "#enums/status-effect";
import { StatusEffectAttr } from "#moves/move";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

describe.skipIf(!RUN)("ER tactical held items", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
    game.override
      .battleStyle("single")
      .startingLevel(50)
      .enemyLevel(50)
      .enemySpecies(SpeciesId.ABRA) // Psychic: Shadow Claw super effective, Tackle neutral
      .enemyMoveset(MoveId.SPLASH)
      .enemyAbility(AbilityId.BALL_FETCH)
      .ability(AbilityId.BALL_FETCH)
      .criticalHits(false);
  });

  // ---------------------------------------------------------------------------
  // 1. Expert Belt — x1.2 super-effective only
  // ---------------------------------------------------------------------------
  it("Expert Belt boosts SUPER-EFFECTIVE damage x1.2 and leaves neutral hits alone", async () => {
    await game.classicMode.startBattle(SpeciesId.GENGAR);
    const player = game.field.getPlayerPokemon();
    const enemy = game.field.getEnemyPokemon();

    // Probe a NON-ball-named Ghost move (Shadow Claw): the enemy's neutral
    // ability here is ER Ball Fetch, which "steals Ball-named moves" - so the
    // ball-named Shadow Ball is intercepted (0x) before damage, which would
    // break the "SE hit deals damage" premise. Shadow Claw is Ghost, super
    // effective vs Psychic (Abra), physical like the Tackle neutral probe, and
    // not ball-named, so it isolates Expert Belt's x1.2 cleanly.
    const seBefore = enemy.getAttackDamage({
      source: player,
      move: allMoves[MoveId.SHADOW_CLAW],
      isCritical: false,
      simulated: true,
    }).damage;
    const tackleBefore = enemy.getAttackDamage({
      source: player,
      move: allMoves[MoveId.TACKLE],
      isCritical: false,
      simulated: true,
    }).damage;

    const belt = new ErTacticalItemModifier(erTacticalItemType("expertBelt"), player.id, "expertBelt", false, 0, 1);
    game.scene.addModifier(belt, true, false, false, false);

    const seAfter = enemy.getAttackDamage({
      source: player,
      move: allMoves[MoveId.SHADOW_CLAW],
      isCritical: false,
      simulated: true,
    }).damage;
    const tackleAfter = enemy.getAttackDamage({
      source: player,
      move: allMoves[MoveId.TACKLE],
      isCritical: false,
      simulated: true,
    }).damage;

    expect(seBefore, "fixture sanity: the SE hit deals damage").toBeGreaterThan(0);
    expect(seAfter, "super-effective boosted x1.2").toBe(Math.floor(seBefore * 1.2));
    expect(tackleAfter, "neutral hit untouched").toBe(tackleBefore);
    expect(belt.getMaxHeldItemCount()).toBe(1);
  });

  // ---------------------------------------------------------------------------
  // 2. Covert Cloak — secondary-effect immunity for the holder
  // ---------------------------------------------------------------------------
  it("Covert Cloak zeroes an incoming move's secondary chance (holder-side Shield Dust)", async () => {
    await game.classicMode.startBattle(SpeciesId.GENGAR);
    const player = game.field.getPlayerPokemon();
    const enemy = game.field.getEnemyPokemon();

    const nuzzle = allMoves[MoveId.NUZZLE];
    const attr = nuzzle.attrs.find((a): a is StatusEffectAttr => a instanceof StatusEffectAttr);
    expect(attr, "Nuzzle carries a StatusEffectAttr secondary").toBeDefined();

    // Without the cloak: Nuzzle's paralysis chance is its full 100.
    expect(attr!.getMoveChance(enemy, player, nuzzle, false, false)).toBe(100);

    // With the cloak on the TARGET: the chance collapses to 0.
    const cloak = new ErTacticalItemModifier(erTacticalItemType("covertCloak"), player.id, "covertCloak", false, 0, 1);
    game.scene.addModifier(cloak, true, false, false, false);
    expect(attr!.getMoveChance(enemy, player, nuzzle, false, false)).toBe(0);

    // But the holder's OWN outgoing secondaries (selfEffect) are untouched.
    expect(attr!.getMoveChance(player, enemy, nuzzle, false, false)).toBe(100);
  });

  it("Covert Cloak prevents paralysis from an enemy Nuzzle over a real turn", async () => {
    game.override
      .enemyMoveset(MoveId.NUZZLE)
      .moveset([MoveId.SPLASH])
      .startingHeldItems([{ name: "ER_COVERT_CLOAK" }]);
    await game.classicMode.startBattle(SpeciesId.GENGAR);
    const player = game.field.getPlayerPokemon();

    game.move.select(MoveId.SPLASH);
    await game.toNextTurn();

    expect(player.status?.effect ?? StatusEffect.NONE, "no paralysis through the cloak").toBe(StatusEffect.NONE);
    expect(player.hp).toBeLessThan(player.getMaxHp()); // the damage itself still lands
  });

  // ---------------------------------------------------------------------------
  // 3. Red Card — drags the attacker out; single use
  // ---------------------------------------------------------------------------
  it("enemy-held Red Card drags the attacking player mon out for a random bench mon", async () => {
    game.override.moveset([MoveId.TACKLE]).enemyHeldItems([{ name: "ER_RED_CARD" }]);
    await game.classicMode.startBattle(SpeciesId.GENGAR, SpeciesId.MAGIKARP);
    const gengar = game.scene.getPlayerParty()[0];

    game.move.select(MoveId.TACKLE);
    await game.toNextTurn();

    expect(game.field.getPlayerPokemon().species.speciesId, "Gengar was dragged out").toBe(SpeciesId.MAGIKARP);
    expect(gengar.isOnField()).toBe(false);
    // Single use: the card is gone from the enemy.
    const remaining = game.scene.findModifiers(
      m => m instanceof ErTacticalItemModifier && (m as ErTacticalItemModifier).kind === "redCard",
      false,
    );
    expect(remaining, "Red Card consumed").toHaveLength(0);
  });

  // ---------------------------------------------------------------------------
  // 4. Eject Button — the struck holder switches out; single use
  // ---------------------------------------------------------------------------
  it("player-held Eject Button switches the struck holder out (player picks)", async () => {
    game.override
      .moveset([MoveId.SPLASH])
      // Ember, not Tackle: Gengar is Ghost - a Normal move can't hit it, and an
      // unhit holder must never eject.
      .enemyMoveset(MoveId.EMBER)
      .startingHeldItems([{ name: "ER_EJECT_BUTTON" }]);
    await game.classicMode.startBattle(SpeciesId.GENGAR, SpeciesId.MAGIKARP);
    const gengar = game.scene.getPlayerParty()[0];

    game.move.select(MoveId.SPLASH);
    game.doSelectPartyPokemon(1); // answer the Eject Button's modal SwitchPhase
    await game.toNextTurn();

    expect(game.field.getPlayerPokemon().species.speciesId, "holder ejected to Magikarp").toBe(SpeciesId.MAGIKARP);
    expect(gengar.isOnField()).toBe(false);
    const remaining = game.scene.findModifiers(
      m => m instanceof ErTacticalItemModifier && (m as ErTacticalItemModifier).kind === "ejectButton",
      true,
    );
    expect(remaining, "Eject Button consumed").toHaveLength(0);
  });

  // ---------------------------------------------------------------------------
  // Batch 2 behavior
  // ---------------------------------------------------------------------------

  it("Heavy-Duty Boots blocks entry-hazard damage on switch-in", async () => {
    game.override.startingHeldItems([{ name: "ER_HEAVY_DUTY_BOOTS" }]);
    await game.classicMode.startBattle(SpeciesId.SNORLAX); // grounded, bulky
    const player = game.field.getPlayerPokemon();
    const enemy = game.field.getEnemyPokemon();

    game.scene.arena.addTag(ArenaTagType.SPIKES, 0, undefined, enemy.id, ArenaTagSide.PLAYER);

    const hp = player.hp;
    game.scene.arena.applyTags(EntryHazardTag, false, player);
    expect(player.hp, "boots blocked the spikes").toBe(hp);

    // Remove the boots; the same hazard now bites the grounded holder.
    const boots = game.scene.findModifiers(m => m instanceof ErTacticalItemModifier, true)[0];
    game.scene.removeModifier(boots, false);
    game.scene.updateModifiers(true);
    game.scene.arena.applyTags(EntryHazardTag, false, player);
    expect(player.hp, "spikes bite without boots").toBeLessThan(hp);
  });

  it("Air Balloon makes the holder immune to Ground moves", async () => {
    game.override
      .enemySpecies(SpeciesId.SNORLAX) // bulky: survives the harness's non-zero SPLASH so the wave doesn't end
      .enemyMoveset(MoveId.EARTHQUAKE)
      .moveset([MoveId.SPLASH])
      .startingHeldItems([{ name: "ER_AIR_BALLOON" }]);
    await game.classicMode.startBattle(SpeciesId.SNORLAX);
    const player = game.field.getPlayerPokemon();

    expect(player.isGrounded(), "the balloon ungrounds the holder").toBe(false);
    game.move.select(MoveId.SPLASH);
    await game.toNextTurn();
    expect(player.hp, "Earthquake had no effect on the floating holder").toBe(player.getMaxHp());
  });

  it("Air Balloon pops when the holder is struck by a damaging move", async () => {
    game.override
      .enemySpecies(SpeciesId.SNORLAX)
      .enemyMoveset(MoveId.TACKLE)
      .moveset([MoveId.SPLASH])
      .startingHeldItems([{ name: "ER_AIR_BALLOON" }]);
    await game.classicMode.startBattle(SpeciesId.SNORLAX);
    const player = game.field.getPlayerPokemon();
    expect(player.isGrounded()).toBe(false);

    game.move.select(MoveId.SPLASH);
    await game.toNextTurn();

    const remaining = game.scene.findModifiers(
      m => m instanceof ErTacticalItemModifier && (m as ErTacticalItemModifier).kind === "airBalloon",
      true,
    );
    expect(remaining, "balloon popped").toHaveLength(0);
    expect(player.isGrounded(), "grounded again once the balloon pops").toBe(true);
  });

  it("Clear Amulet blocks a foe's Growl", async () => {
    game.override
      .enemySpecies(SpeciesId.SNORLAX)
      .enemyMoveset(MoveId.GROWL)
      .moveset([MoveId.SPLASH])
      .startingHeldItems([{ name: "ER_CLEAR_AMULET" }]);
    await game.classicMode.startBattle(SpeciesId.SNORLAX);
    const player = game.field.getPlayerPokemon();

    game.move.select(MoveId.SPLASH);
    await game.toNextTurn();
    expect(player.getStatStage(Stat.ATK), "Growl blocked by Clear Amulet").toBe(0);
  });

  it("Muscle Band boosts physical damage by 10%", async () => {
    await game.classicMode.startBattle(SpeciesId.SNORLAX);
    const player = game.field.getPlayerPokemon();
    const enemy = game.field.getEnemyPokemon();

    const before = enemy.getAttackDamage({
      source: player,
      move: allMoves[MoveId.TACKLE],
      isCritical: false,
      simulated: true,
    }).damage;

    const band = new ErTacticalItemModifier(erTacticalItemType("muscleBand"), player.id, "muscleBand", false, 0, 1);
    game.scene.addModifier(band, true, false, false, false);

    const after = enemy.getAttackDamage({
      source: player,
      move: allMoves[MoveId.TACKLE],
      isCritical: false,
      simulated: true,
    }).damage;

    expect(before, "fixture sanity").toBeGreaterThan(0);
    expect(after, "physical hit boosted x1.1").toBe(Math.floor(before * 1.1));
  });

  it("Muscle Band blocks a foe's Attack drop", async () => {
    game.override
      .enemySpecies(SpeciesId.SNORLAX)
      .enemyMoveset(MoveId.GROWL)
      .moveset([MoveId.SPLASH])
      .startingHeldItems([{ name: "ER_MUSCLE_BAND" }]);
    await game.classicMode.startBattle(SpeciesId.SNORLAX);
    const player = game.field.getPlayerPokemon();

    game.move.select(MoveId.SPLASH);
    await game.toNextTurn();
    expect(player.getStatStage(Stat.ATK), "Muscle Band blocked the Attack drop").toBe(0);
  });

  it("Eject Pack switches the holder out when a foe lowers its stats", async () => {
    game.override
      .enemyMoveset(MoveId.GROWL)
      .moveset([MoveId.SPLASH])
      .startingHeldItems([{ name: "ER_EJECT_PACK" }]);
    await game.classicMode.startBattle(SpeciesId.SNORLAX, SpeciesId.MAGIKARP);
    const snorlax = game.scene.getPlayerParty()[0];

    game.move.select(MoveId.SPLASH);
    game.doSelectPartyPokemon(1); // answer the Eject Pack's modal SwitchPhase
    await game.toNextTurn();

    expect(game.field.getPlayerPokemon().species.speciesId, "holder ejected to Magikarp").toBe(SpeciesId.MAGIKARP);
    expect(snorlax.isOnField()).toBe(false);
    const remaining = game.scene.findModifiers(
      m => m instanceof ErTacticalItemModifier && (m as ErTacticalItemModifier).kind === "ejectPack",
      true,
    );
    expect(remaining, "Eject Pack consumed").toHaveLength(0);
  });

  it("Mental Herb blocks Taunt and is consumed", async () => {
    game.override
      .enemySpecies(SpeciesId.SNORLAX)
      .enemyMoveset(MoveId.TAUNT)
      .moveset([MoveId.SPLASH])
      .startingHeldItems([{ name: "ER_MENTAL_HERB" }]);
    await game.classicMode.startBattle(SpeciesId.SNORLAX);
    const player = game.field.getPlayerPokemon();

    game.move.select(MoveId.SPLASH);
    await game.toNextTurn();
    expect(player.getTag(BattlerTagType.TAUNT), "Taunt blocked").toBeUndefined();
    const remaining = game.scene.findModifiers(
      m => m instanceof ErTacticalItemModifier && (m as ErTacticalItemModifier).kind === "mentalHerb",
      true,
    );
    expect(remaining, "Mental Herb consumed").toHaveLength(0);
  });

  it("Float Stone raises the holder's Speed by 10%", async () => {
    await game.classicMode.startBattle(SpeciesId.SNORLAX);
    const player = game.field.getPlayerPokemon();
    const before = player.getEffectiveStat(Stat.SPD);

    const stone = new ErTacticalItemModifier(erTacticalItemType("floatStone"), player.id, "floatStone", false, 0, 1);
    game.scene.addModifier(stone, true, false, false, false);

    const after = player.getEffectiveStat(Stat.SPD);
    expect(after, "Speed raised").toBeGreaterThan(before);
    expect(after / before, "Speed x1.1").toBeCloseTo(1.1, 1);
  });

  it("Iron Ball grounds a Flying-type holder so Ground moves connect", async () => {
    game.override
      .enemySpecies(SpeciesId.SNORLAX)
      .enemyMoveset(MoveId.EARTHQUAKE)
      .moveset([MoveId.SPLASH])
      .startingHeldItems([{ name: "ER_IRON_BALL" }]);
    // Pidgeot (Normal/Flying) is normally immune to Ground; Iron Ball grounds it.
    await game.classicMode.startBattle(SpeciesId.PIDGEOT);
    const player = game.field.getPlayerPokemon();

    expect(player.isGrounded(), "Iron Ball grounds the Flying-type holder").toBe(true);

    game.move.select(MoveId.SPLASH);
    await game.toNextTurn();
    expect(player.hp, "grounded Flying-type holder is hit by Earthquake").toBeLessThan(player.getMaxHp());
  });

  it("Iron Ball halves the holder's Speed", async () => {
    await game.classicMode.startBattle(SpeciesId.GENGAR);
    const player = game.field.getPlayerPokemon();
    const before = player.getEffectiveStat(Stat.SPD);

    const ball = new ErTacticalItemModifier(erTacticalItemType("ironBall"), player.id, "ironBall", false, 0, 1);
    game.scene.addModifier(ball, true, false, false, false);

    const after = player.getEffectiveStat(Stat.SPD);
    expect(after / before, "Speed x0.5").toBeCloseTo(0.5, 1);
  });

  it("Metronome boosts a move's power on the second consecutive use", async () => {
    game.override
      .moveset([MoveId.TACKLE])
      .enemySpecies(SpeciesId.SNORLAX)
      .startingHeldItems([{ name: "ER_METRONOME_ITEM" }]);
    await game.classicMode.startBattle(SpeciesId.SNORLAX);
    const enemy = game.field.getEnemyPokemon();

    game.move.select(MoveId.TACKLE);
    await game.toNextTurn();
    const hpAfter1 = enemy.hp;
    const dmg1 = enemy.getMaxHp() - hpAfter1;

    game.move.select(MoveId.TACKLE);
    await game.toNextTurn();
    const dmg2 = hpAfter1 - enemy.hp;

    expect(dmg1, "fixture sanity").toBeGreaterThan(0);
    expect(dmg2, "second consecutive Tackle boosted x1.2").toBe(Math.floor(dmg1 * 1.2));
  });

  it("Zoom Lens raises accuracy when the target has already acted this turn", async () => {
    await game.classicMode.startBattle(SpeciesId.SNORLAX);
    const player = game.field.getPlayerPokemon();
    const enemy = game.field.getEnemyPokemon();
    const move = allMoves[MoveId.TACKLE];

    const zoom = new ErTacticalItemModifier(erTacticalItemType("zoomLens"), player.id, "zoomLens", false, 0, 1);
    game.scene.addModifier(zoom, true, false, false, false);

    enemy.turnData.acted = false;
    const notMoved = player.getAccuracyMultiplier(enemy, move);
    enemy.turnData.acted = true;
    const moved = player.getAccuracyMultiplier(enemy, move);

    expect(moved, "accuracy x1.2 when the target already acted").toBeCloseTo(notMoved * 1.2, 5);
  });
});

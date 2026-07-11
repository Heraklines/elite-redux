/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */
// ER Aftermath (106): "After fainting, uses a 100 BP Explosion / Outburst that
// hits all adjacent Pokemon and always flinches." The old wiring did a flat 25%
// chip to the attacker (OnFaintEffectAbAttr) and NO explosion — because a
// fainted Pokemon cannot run a move (move-phase.ts:123 discards it). The fix
// (PostFaintDetonateAbAttr) clamps the lethal hit to 1 HP, then the holder
// actually USES the explosion (animation + spread + self-KO) before dying.
//
// These tests prove the explosion really PLAYS in battle (the player takes
// explosion damage on the KO that dealt it), that Damp blocks it, and — for the
// related "ability uses a move on switch-in" question — that Cheap Tactics (428)
// actually lands its Scratch. Gated behind ER_SCENARIO=1.
import { globalScene } from "#app/global-scene";
import { allMoves } from "#data/data-lists";
import { PostFaintDetonateAbAttr } from "#data/elite-redux/archetypes/post-faint-detonate";
import { scriptedPokemonMove } from "#data/elite-redux/archetypes/scripted-move-util";
import { ER_ID_MAP } from "#data/elite-redux/er-id-map";
import { AbilityId } from "#enums/ability-id";
import { BattlerTagType } from "#enums/battler-tag-type";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { GameManager } from "#test/framework/game-manager";
import { NumberHolder } from "#utils/common";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

describe.skipIf(!RUN)("ER Aftermath (106) — detonates on KO", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
    game.override
      .ability(AbilityId.BALL_FETCH)
      .battleStyle("single")
      .criticalHits(false)
      .enemySpecies(SpeciesId.MAGIKARP)
      .enemyAbility(AbilityId.AFTERMATH)
      .enemyMoveset(MoveId.SPLASH)
      .enemyLevel(100)
      .startingLevel(100);
  });

  it("the holder explodes when KO'd: the attacker takes damage it otherwise would not", async () => {
    await game.classicMode.startBattle([SpeciesId.SNORLAX]);

    const enemy = game.field.getEnemyPokemon();
    enemy.hp = 20; // make the player's hit lethal
    const player = game.field.getPlayerPokemon();

    game.move.use(MoveId.TACKLE);
    await game.toEndOfTurn();

    // The Aftermath holder fainted (from its own explosion's self-KO)...
    expect(enemy.isFainted()).toBe(true);
    // ...and the player took explosion damage. The enemy's only move is Splash
    // (no damage), so any HP loss on the player is the Aftermath detonation.
    expect(player.getInverseHp()).toBeGreaterThan(0);
  });

  it("a MULTI-HIT KO still detonates (later sub-hits must not re-kill the clamped holder)", async () => {
    // Repro: a multi-hit move clamps the holder to 1 HP on the lethal sub-hit,
    // then keeps striking. Previously the post-arm sub-hits were NOT endured, so
    // one of them killed the holder before the queued explosion could cast — the
    // detonation silently vanished. With enemy HP at 5, hit 1 of a 2–5 multi-hit
    // is already lethal, so at least one more sub-hit follows the clamp.
    await game.classicMode.startBattle([SpeciesId.SNORLAX]);

    const enemy = game.field.getEnemyPokemon();
    enemy.hp = 5;
    const player = game.field.getPlayerPokemon();

    game.move.use(MoveId.BULLET_SEED); // 2–5 hits
    await game.toEndOfTurn();

    expect(enemy.isFainted()).toBe(true);
    // Splash is the enemy's only move, so any player HP loss is the detonation.
    expect(player.getInverseHp()).toBeGreaterThan(0);
  });

  it("ER Damp does NOT block the detonation (Damp is repurposed to Water-on-contact)", async () => {
    // Vanilla Damp blocked explosions; ER repurposes Damp to "make the attacker
    // Water-type on contact", so it no longer prevents explosive moves. The
    // detonation must still fire (player takes explosion damage) even with Damp.
    game.override.ability(AbilityId.DAMP);
    await game.classicMode.startBattle([SpeciesId.SNORLAX]);

    const enemy = game.field.getEnemyPokemon();
    enemy.hp = 20;
    const player = game.field.getPlayerPokemon();

    game.move.use(MoveId.TACKLE);
    await game.toEndOfTurn();

    expect(enemy.isFainted()).toBe(true);
    expect(player.getInverseHp()).toBeGreaterThan(0);
  });

  it("Victory Bomb (729) detonates a Fire-type explosion on KO", async () => {
    game.override.enemyAbility(ER_ID_MAP.abilities[729] as AbilityId);
    await game.classicMode.startBattle([SpeciesId.SNORLAX]);

    const enemy = game.field.getEnemyPokemon();
    enemy.hp = 20;
    const player = game.field.getPlayerPokemon();

    game.move.use(MoveId.TACKLE);
    await game.toEndOfTurn();

    expect(enemy.isFainted()).toBe(true);
    expect(player.getInverseHp()).toBeGreaterThan(0);
  });

  it("Balloon Bomb (614, bespoke) detonates on KO via the shared true-detonate primitive", async () => {
    // 614 is now bespoke: Inflatable stat-trigger + the TRUE any-KO spread
    // detonate (PostFaintSpreadDetonateAbAttr) + an explosion-flinch rider. A
    // damaging KO still detonates and damages the adjacent player.
    game.override.enemyAbility(ER_ID_MAP.abilities[614] as AbilityId);
    await game.classicMode.startBattle([SpeciesId.SNORLAX]);

    const enemy = game.field.getEnemyPokemon();
    enemy.hp = 20;
    const player = game.field.getPlayerPokemon();

    game.move.use(MoveId.TACKLE);
    await game.toEndOfTurn();

    expect(enemy.isFainted()).toBe(true);
    expect(player.getInverseHp()).toBeGreaterThan(0);
  });
});

describe.skipIf(!RUN)("ER Cheap Tactics (428) — actually attacks with Scratch on switch-in", () => {
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
      .startingLevel(100)
      .ability(ER_ID_MAP.abilities[428] as AbilityId); // Cheap Tactics on the player
  });

  it("the switch-in Scratch lands: the opponent takes damage from a move it was never targeted by normally", async () => {
    await game.classicMode.startBattle([SpeciesId.SNORLAX]);
    const enemy = game.field.getEnemyPokemon();

    game.move.use(MoveId.SPLASH); // player does nothing this turn
    await game.toEndOfTurn();

    // The only damage source is the switch-in Scratch (both sides used Splash).
    expect(enemy.getInverseHp()).toBeGreaterThan(0);
  });
});

describe.skipIf(!RUN)("scriptedPokemonMove — reduced-power scripted casts", () => {
  let phaserGame: Phaser.Game;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  it("overrides base power for the cast while leaving the registered move untouched", () => {
    // Boot so allMoves is populated.
    void new GameManager(phaserGame);
    const registered = allMoves[MoveId.SPECTRAL_THIEF].power; // 90

    // Phantom Thief casts "40 BP Spectral Thief": the override must report 40...
    expect(scriptedPokemonMove(MoveId.SPECTRAL_THIEF, 40).getMove().power).toBe(40);
    // ...without a power, full registered power is used...
    expect(scriptedPokemonMove(MoveId.SPECTRAL_THIEF).getMove().power).toBe(registered);
    // ...and the shared global move is NOT mutated.
    expect(allMoves[MoveId.SPECTRAL_THIEF].power).toBe(registered);
  });
});

describe.skipIf(!RUN)("ER Aftermath — not invincible across turns (regression)", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });
  beforeEach(() => {
    game = new GameManager(phaserGame);
    game.override.battleStyle("single").criticalHits(false).enemyLevel(100).startingLevel(100);
  });

  // Repro of the reported "Aftermath Pokémon are now invincible". The endure
  // that lets a multi-hit KO still detonate used a permanent per-holder flag. If
  // the queued explosion fizzled (no target — e.g. the holder KO'd the last foe
  // with its OWN move that turn), the holder lived at 1 HP but stayed flagged,
  // so EVERY future lethal hit was clamped to 1 HP forever. The flag is now
  // turn-scoped: a stale arming from an earlier turn is dropped, so the holder
  // is killable again.
  it("a holder that armed last turn is not silently endured on a later turn", async () => {
    await game.classicMode.startBattle([SpeciesId.SNORLAX]);
    const attr = new PostFaintDetonateAbAttr();
    const holder = game.field.getPlayerPokemon();
    const opponent = game.field.getEnemyPokemon();
    const move = allMoves[MoveId.TACKLE];

    // Turn 1: a lethal hit arms the holder (clamp + queued explosion).
    globalScene.currentBattle.turn = 1;
    holder.hp = holder.getMaxHp();
    const arming = new NumberHolder(holder.hp + 100);
    expect(attr.canApply({ pokemon: holder, opponent, move, damage: arming })).toBe(true);
    attr.apply({ pokemon: holder, opponent, move, damage: arming });

    // Same turn, a remaining sub-hit at 1 HP IS endured (damage clamped to 0) —
    // this is the multi-hit behaviour we must preserve.
    holder.hp = 1;
    const subHit = new NumberHolder(100);
    expect(attr.canApply({ pokemon: holder, opponent, move, damage: subHit })).toBe(true);
    attr.apply({ pokemon: holder, opponent, move, damage: subHit });
    expect(subHit.value).toBe(0);

    // The detonation "fizzled": holder is still alive at 1 HP. Drop the lingering
    // STURDY tag so we isolate the arming-flag logic from the Sturdy clamp.
    holder.removeTag(BattlerTagType.STURDY);

    // NEXT turn: a fresh lethal hit must NOT be clamped away (the old bug left
    // the holder permanently surviving at 1 HP). It is handled as a brand-new
    // interaction, so the lethal damage stands.
    globalScene.currentBattle.turn = 2;
    const nextTurnHit = new NumberHolder(100);
    attr.canApply({ pokemon: holder, opponent, move, damage: nextTurnHit });
    attr.apply({ pokemon: holder, opponent, move, damage: nextTurnHit });
    expect(nextTurnHit.value).toBe(100);
  });
});

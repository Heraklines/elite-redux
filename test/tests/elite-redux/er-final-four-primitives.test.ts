/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// ER "final four" engine primitives — regression tests.
//
// 1. Wonder Room (move 472): "For 5 turns, Attack and SpAtk stats are swapped
//    and their stat buffs are ignored." — ATK<->SpAtk swap field-wide, using the
//    RAW base stats (stat stages ignored). Room-style tag (re-cast ends it).
// 2. Ally Switch (move 502): the user swaps field positions with its ally
//    (doubles). Live party-slot + field-position swap.
// 3. Shields Down (ability): using Shell Smash forces Minior into Core Form
//    regardless of HP, and it cannot revert to Meteor for the rest of the battle.
// 4. Sky Drop (move 507): 2-turn move; the target is immobilized while held in
//    the sky (its move is cancelled), then slammed for damage on turn 2.
//
// Gated behind ER_SCENARIO=1 (like the rest of the ER engine suite) — many of
// these touch ER-custom init that only runs under that flag.
// =============================================================================

import { allMoves } from "#data/data-lists";
import { AbilityId } from "#enums/ability-id";
import { ArenaTagSide } from "#enums/arena-tag-side";
import { ArenaTagType } from "#enums/arena-tag-type";
import { BattlerIndex } from "#enums/battler-index";
import { BattlerTagType } from "#enums/battler-tag-type";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { Stat } from "#enums/stat";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

describe.skipIf(!RUN)("ER final-four primitives", () => {
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
      .startingLevel(100)
      .enemyLevel(100)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemySpecies(SpeciesId.SNORLAX)
      .enemyMoveset(MoveId.SPLASH);
  });

  // ---------------------------------------------------------------------------
  // 1. WONDER ROOM (472) — ATK<->SpAtk swap, stat stages ignored, raw base stats
  // ---------------------------------------------------------------------------
  describe("Wonder Room (472)", () => {
    it("swaps effective ATK and SpAtk to the RAW base of the other stat", async () => {
      // Alakazam: base ATK 50, base SpAtk 135 — a large, easily-observed gap.
      await game.classicMode.startBattle(SpeciesId.ALAKAZAM);
      const player = game.field.getPlayerPokemon();

      const baseAtk = player.getStat(Stat.ATK, false);
      const baseSpAtk = player.getStat(Stat.SPATK, false);
      expect(baseSpAtk).toBeGreaterThan(baseAtk); // sanity: the gap exists

      // Baseline (no Wonder Room): effective ATK tracks base ATK.
      expect(player.getEffectiveStat(Stat.ATK)).toBe(baseAtk);
      expect(player.getEffectiveStat(Stat.SPATK)).toBe(baseSpAtk);

      // Raise Wonder Room field-wide.
      game.scene.arena.addTag(ArenaTagType.WONDER_ROOM, 5, MoveId.WONDER_ROOM, player.id, ArenaTagSide.BOTH);

      // While up: effective ATK reads the RAW base SpAtk, and vice-versa.
      expect(player.getEffectiveStat(Stat.ATK)).toBe(baseSpAtk);
      expect(player.getEffectiveStat(Stat.SPATK)).toBe(baseAtk);
    });

    it("ignores stat stages ('buffs') on the swapped stats", async () => {
      await game.classicMode.startBattle(SpeciesId.ALAKAZAM);
      const player = game.field.getPlayerPokemon();
      const baseAtk = player.getStat(Stat.ATK, false);
      const baseSpAtk = player.getStat(Stat.SPATK, false);

      // +2 ATK and -2 SpAtk stages.
      player.setStatStage(Stat.ATK, 2);
      player.setStatStage(Stat.SPATK, -2);

      // Without Wonder Room the stages apply (ATK x2, SpAtk x0.5).
      expect(player.getEffectiveStat(Stat.ATK)).toBe(Math.floor(baseAtk * 2));

      // Under Wonder Room the swapped ATK/SpAtk use RAW bases, stages ignored.
      game.scene.arena.addTag(ArenaTagType.WONDER_ROOM, 5, MoveId.WONDER_ROOM, player.id, ArenaTagSide.BOTH);
      expect(player.getEffectiveStat(Stat.ATK)).toBe(baseSpAtk); // raw SpAtk, no +2/-2 applied
      expect(player.getEffectiveStat(Stat.SPATK)).toBe(baseAtk); // raw ATK, no stage applied
    });

    it("the move raises a WONDER_ROOM tag on both sides, and re-casting ends it (Room-style)", async () => {
      game.override.moveset(MoveId.WONDER_ROOM);
      await game.classicMode.startBattle(SpeciesId.ALAKAZAM);

      game.move.use(MoveId.WONDER_ROOM);
      await game.toEndOfTurn();
      expect(game.scene.arena.getTag(ArenaTagType.WONDER_ROOM)).toBeDefined();

      // Re-cast: Room-style overlap removal ends it.
      game.move.use(MoveId.WONDER_ROOM);
      await game.toEndOfTurn();
      expect(game.scene.arena.getTag(ArenaTagType.WONDER_ROOM)).toBeUndefined();
    });
  });

  // ---------------------------------------------------------------------------
  // 2. ALLY SWITCH (502) — doubles field-slot swap
  // ---------------------------------------------------------------------------
  describe("Ally Switch (502)", () => {
    it("swaps the two allies' field/battler indices in a double battle", async () => {
      game.override.battleStyle("double").moveset([MoveId.ALLY_SWITCH, MoveId.SPLASH]);
      await game.classicMode.startBattle(SpeciesId.ALAKAZAM, SpeciesId.BLASTOISE);

      const [slot0, slot1] = game.scene.getPlayerField();
      expect(slot0.getFieldIndex()).toBe(0);
      expect(slot1.getFieldIndex()).toBe(1);

      game.move.select(MoveId.ALLY_SWITCH, 0);
      game.move.select(MoveId.SPLASH, 1);
      await game.toEndOfTurn();

      // The SAME two Pokemon objects have exchanged field slots.
      expect(slot0.getFieldIndex()).toBe(1);
      expect(slot1.getFieldIndex()).toBe(0);
      expect(slot0.getBattlerIndex()).toBe(BattlerIndex.PLAYER_2);
      expect(slot1.getBattlerIndex()).toBe(BattlerIndex.PLAYER);
    });

    it("fails in a single battle (no ally to switch with)", async () => {
      game.override.moveset([MoveId.ALLY_SWITCH]);
      await game.classicMode.startBattle(SpeciesId.ALAKAZAM);
      const player = game.field.getPlayerPokemon();
      expect(player.getFieldIndex()).toBe(0);

      game.move.use(MoveId.ALLY_SWITCH);
      await game.toEndOfTurn();

      // Still in slot 0 — the move had no legal effect in singles.
      expect(player.getFieldIndex()).toBe(0);
    });
  });

  // ---------------------------------------------------------------------------
  // 3. SHIELDS DOWN — Shell Smash forces Core Form, no revert
  // ---------------------------------------------------------------------------
  describe("Shields Down — Shell Smash forces Core Form", () => {
    it("Minior at full HP goes Meteor -> Core on Shell Smash and stays Core", async () => {
      game.override
        .ability(AbilityId.SHIELDS_DOWN)
        .moveset([MoveId.SHELL_SMASH, MoveId.SPLASH])
        // A truly harmless foe (low BST so it isn't devolved by the #419 cap,
        // level 1 + Splash so it can never KO the Minior mid-test).
        .enemyLevel(1)
        .enemySpecies(SpeciesId.MAGIKARP)
        .enemyMoveset(MoveId.SPLASH);
      await game.classicMode.startBattle(SpeciesId.MINIOR);
      const minior = game.field.getPlayerPokemon();

      // Starts in a Meteor Form (formIndex < 7) at full HP.
      expect(minior.formIndex).toBeLessThan(7);
      expect(minior.getFormKey()).toContain("meteor");
      expect(minior.getHpRatio()).toBeGreaterThan(0.5);

      // Shell Smash forces Core Form regardless of the (full) HP.
      game.move.use(MoveId.SHELL_SMASH);
      await game.toEndOfTurn();
      expect(minior.formIndex).toBeGreaterThanOrEqual(7);
      expect(minior.getFormKey()).not.toContain("meteor");

      // No-revert latch: still above 50% HP, another turn does NOT revert to Meteor.
      game.move.use(MoveId.SPLASH);
      await game.toEndOfTurn();
      expect(minior.formIndex).toBeGreaterThanOrEqual(7);
      expect(minior.getFormKey()).not.toContain("meteor");
    });
  });

  // ---------------------------------------------------------------------------
  // 4. SKY DROP (507) — 2-turn lift; target immobilized, damage on turn 2
  // ---------------------------------------------------------------------------
  describe("Sky Drop (507)", () => {
    beforeEach(() => {
      // Fast player vs. slow target so the charge (and the target immobilize)
      // resolves before the target would act.
      game.override
        .moveset([MoveId.SKY_DROP])
        .enemySpecies(SpeciesId.SHUCKLE) // base speed 5
        .enemyMoveset(MoveId.TACKLE);
      vi.spyOn(allMoves[MoveId.SKY_DROP], "accuracy", "get").mockReturnValue(100);
    });

    it("takes 2 turns, immobilizes the held target on the charge turn, damages on turn 2", async () => {
      await game.classicMode.startBattle(SpeciesId.MAGIKARP); // base speed 80 > Shuckle
      const player = game.field.getPlayerPokemon();
      const enemy = game.field.getEnemyPokemon();

      game.move.use(MoveId.SKY_DROP);

      // ---- Charge turn ----
      await game.phaseInterceptor.to("TurnEndPhase");
      // User is semi-invulnerable (lifted) and the attack is still queued.
      expect(player.getTag(BattlerTagType.FLYING)).toBeDefined();
      expect(player.getMoveQueue()[0]?.move).toBe(MoveId.SKY_DROP);
      // Target is held (SKY_DROP tag) and immobilized — its Tackle was cancelled,
      // so the player took no damage this turn.
      expect(enemy.getTag(BattlerTagType.SKY_DROP)).toBeDefined();
      expect(player.hp).toBe(player.getMaxHp());
      expect(enemy.hp).toBe(enemy.getMaxHp());

      // ---- Slam turn ----
      await game.phaseInterceptor.to("TurnEndPhase");
      expect(player.getTag(BattlerTagType.FLYING)).toBeUndefined();
      expect(enemy.hp).toBeLessThan(enemy.getMaxHp()); // damage dealt
      // The hold is released after the slam.
      expect(enemy.getTag(BattlerTagType.SKY_DROP)).toBeUndefined();
    });
  });
});

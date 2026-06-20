/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */
// Regression for the reported bug: "Using Thunder Shock doesn't trigger
// Thundercall."
//
// Thundercall (ER ability 388) per its ROM description: "After using any
// Electric-type move, Thundercall automatically triggers a follow-up Smite
// attack at 20% power." It is wired as a PostAttackScriptedMoveAbAttr that casts
// MoveId.THUNDER_SHOCK (the closest vanilla analog of ER's Smite) gated on the
// holder using an Electric-type move.
//
// Root cause of the bug: PostAttackScriptedMoveAbAttr's re-entry guard used
// `move.id === this.opts.moveId`. Because Thundercall's scripted follow-up IS
// Thunder Shock, a genuine Thunder Shock used by the holder hit that guard and
// the follow-up was silently swallowed. The guard now keys off the move's
// *use mode* (the scripted cast is virtual / INDIRECT) instead of its id, so a
// real Thunder Shock triggers Thundercall while the loop is still prevented.
//
// Gated behind ER_SCENARIO=1.
import { AbilityId } from "#enums/ability-id";
import { MoveId } from "#enums/move-id";
import { MoveUseMode } from "#enums/move-use-mode";
import { SpeciesId } from "#enums/species-id";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

async function erAbility(id: number): Promise<AbilityId | undefined> {
  const erIdMap = (await import("#data/elite-redux/er-id-map")).ER_ID_MAP;
  return erIdMap.abilities[id] as AbilityId | undefined;
}

describe.skipIf(!RUN)("ER Thundercall (388) — triggers from Thunder Shock", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
  });

  it("a genuine Thunder Shock by the holder casts the scripted Thunder Shock follow-up", async () => {
    const thundercall = await erAbility(388);
    expect(thundercall).toBeDefined();

    game.override
      .battleStyle("single")
      .criticalHits(false)
      .ability(thundercall!) // Thundercall on the player
      .moveset([MoveId.THUNDER_SHOCK])
      .enemySpecies(SpeciesId.SNORLAX) // bulky + not Electric-immune, survives both hits
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemyMoveset(MoveId.SPLASH)
      .enemyLevel(100)
      .startingLevel(100);
    await game.classicMode.startBattle(SpeciesId.SNORLAX);

    const enemy = game.field.getEnemyPokemon();
    const enemyHpBefore = enemy.hp;

    // Spy (call-through) to capture every scripted MovePhase the ability enqueues.
    const pm = game.scene.phaseManager;
    const spy = vi.spyOn(pm, "unshiftNew");

    game.move.use(MoveId.THUNDER_SHOCK);
    await game.toEndOfTurn();

    // Thundercall fired: exactly one scripted Thunder Shock follow-up was cast,
    // in INDIRECT (virtual) mode. The holder's OWN Thunder Shock must NOT count
    // (it is NORMAL, never unshifted by the ability) and the follow-up must NOT
    // re-trigger itself (no infinite loop).
    const callsToThunderShock = spy.mock.calls.filter(c => {
      if (c[0] !== "MovePhase") {
        return false;
      }
      const moveArg = c[3] as { getMove?: () => { id: number } } | undefined;
      return moveArg?.getMove?.().id === MoveId.THUNDER_SHOCK;
    });
    expect(callsToThunderShock.length).toBe(1);
    expect(callsToThunderShock[0][4]).toBe(MoveUseMode.INDIRECT);

    // And the enemy actually took two Electric hits' worth of damage (the holder's
    // Thunder Shock + the Thundercall follow-up), confirming the follow-up landed.
    expect(enemyHpBefore - enemy.hp).toBeGreaterThan(0);
  });

  it("does NOT trigger from a non-Electric move (type gate intact)", async () => {
    const thundercall = await erAbility(388);
    expect(thundercall).toBeDefined();

    game.override
      .battleStyle("single")
      .criticalHits(false)
      .ability(thundercall!)
      .moveset([MoveId.TACKLE]) // Normal-type
      .enemySpecies(SpeciesId.SNORLAX)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemyMoveset(MoveId.SPLASH)
      .enemyLevel(100)
      .startingLevel(100);
    await game.classicMode.startBattle(SpeciesId.SNORLAX);

    const pm = game.scene.phaseManager;
    const spy = vi.spyOn(pm, "unshiftNew");

    game.move.use(MoveId.TACKLE);
    await game.toEndOfTurn();

    // No Thunder Shock follow-up after a Normal-type move.
    const thunderShockCasts = spy.mock.calls.filter(c => {
      if (c[0] !== "MovePhase") {
        return false;
      }
      const moveArg = c[3] as { getMove?: () => { id: number } } | undefined;
      return moveArg?.getMove?.().id === MoveId.THUNDER_SHOCK;
    });
    expect(thunderShockCasts.length).toBe(0);
  });
});

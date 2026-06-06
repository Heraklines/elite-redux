/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */
// Repro + regression for the reported Aftermath timing bug:
//   "When a Pokemon with Aftermath is about to die and explode, it often still
//    attacks before and then explodes."
//
// Root cause: PostFaintDetonateAbAttr survives the lethal hit at 1 HP (Sturdy
// clamp), then enqueues the explosion via `unshiftNew("MovePhase", ...)` WITHOUT
// a MovePhaseTimingModifier. MovePhase is a dynamic phase, so a plain unshift is
// routed into the speed-sorted MovePhasePriorityQueue. If the Aftermath holder
// is KO'd by a FASTER attacker, the holder is still alive at 1 HP and STILL has
// its own (slower) move queued for this turn. With no FIRST modifier, the holder
// can take that queued action BEFORE the explosion resolves — the holder "still
// attacks, then explodes", granting it an illegitimate extra move.
//
// The fix forces the detonation with MovePhaseTimingModifier.FIRST so it resolves
// immediately on faint, before any remaining queued action by the holder. The
// SacrificialAttr self-KO then re-faints the holder, so its pending NORMAL move
// is skipped (a fainted Pokemon cannot run a move).
//
// Gated behind ER_SCENARIO=1.
import { PostFaintDetonateAbAttr } from "#data/elite-redux/archetypes/post-faint-detonate";
import { AbilityId } from "#enums/ability-id";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { Stat } from "#enums/stat";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

describe.skipIf(!RUN)("ER Aftermath — detonates immediately on faint (no extra action)", () => {
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
      .ability(AbilityId.BALL_FETCH)
      .moveset([MoveId.TACKLE])
      .enemySpecies(SpeciesId.SNORLAX)
      .enemyAbility(AbilityId.AFTERMATH) // Aftermath on the ENEMY (the slower KO'd holder)
      .enemyMoveset(MoveId.TACKLE)
      .enemyLevel(100)
      .startingLevel(100);
  });

  it("the holder does NOT land its own queued move after being KO'd (it explodes first)", async () => {
    await game.classicMode.startBattle(SpeciesId.SNORLAX);

    const player = game.field.getPlayerPokemon();
    const enemy = game.field.getEnemyPokemon();

    // Player moves first and KO's the enemy while the enemy's own (slower) Tackle
    // is still queued for this turn. The holder is clamped to 1 HP by Aftermath.
    player.setStat(Stat.SPD, 999, false);
    enemy.setStat(Stat.SPD, 1, false);
    // The player's Tackle does ~45 to this enemy Snorlax; 30 HP makes that hit
    // lethal (so the Aftermath clamp arms), while maxHp stays well above 1.
    enemy.hp = 30;

    const playerHpBefore = player.hp;

    // Count how many separate damaging hits the PLAYER takes this turn.
    //   - With the timing bug: the holder lands its queued Tackle (1 hit) AND the
    //     explosion lands (2nd hit) → 2 damaging hits on the player.
    //   - With the fix: the explosion resolves FIRST and self-KO's the holder, so
    //     its queued Tackle is cancelled → only the explosion hits → 1 hit.
    let playerDamagingHits = 0;
    const realDamage = player.damageAndUpdate.bind(player);
    vi.spyOn(player, "damageAndUpdate").mockImplementation((amount, opts) => {
      if (amount > 0) {
        playerDamagingHits++;
      }
      return realDamage(amount, opts);
    });

    game.move.use(MoveId.TACKLE);
    await game.toEndOfTurn();

    // The Aftermath holder fainted (lethal hit + its own explosion self-KO).
    expect(enemy.isFainted()).toBe(true);
    // The player took explosion damage.
    expect(playerHpBefore - player.hp).toBeGreaterThan(0);

    // CORE REGRESSION CHECK: the player must take exactly ONE damaging hit — the
    // explosion — and NOT also the holder's illegitimate post-faint Tackle.
    expect(playerDamagingHits).toBe(1);
  });

  it("PostFaintDetonateAbAttr enqueues the explosion with MovePhaseTimingModifier.FIRST", async () => {
    // Unit-level proof that the detonation is forced ahead of any remaining
    // queued action by the holder.
    await game.classicMode.startBattle(SpeciesId.SNORLAX);
    const holder = game.field.getPlayerPokemon();
    const opponent = game.field.getEnemyPokemon();
    const move = (await import("#data/data-lists")).allMoves[MoveId.TACKLE];

    const attr = new PostFaintDetonateAbAttr();
    const pm = game.scene.phaseManager;
    const spy = vi.spyOn(pm, "unshiftNew");

    const { NumberHolder } = await import("#utils/common");
    holder.hp = holder.getMaxHp();
    const dmg = new NumberHolder(holder.hp + 100);
    expect(attr.canApply({ pokemon: holder, opponent, move, damage: dmg })).toBe(true);
    attr.apply({ pokemon: holder, opponent, move, damage: dmg });

    const moveCall = spy.mock.calls.find(c => c[0] === "MovePhase");
    expect(moveCall).toBeDefined();
    // Signature: (name, pokemon, targets, move, useMode, timingModifier)
    // FIRST = 2 (MovePhaseTimingModifier.FIRST).
    expect(moveCall![5]).toBe(2);
  });
});

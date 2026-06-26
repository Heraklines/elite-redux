/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// ER damage-calc preview: per-hit damage comes from the REAL getAttackDamage (the
// abilities are already applied there); this layer scales it for MULTI-HIT. These
// assert the scaling factors against the real single-hit base. ER_SCENARIO=1 gated.

import { allMoves } from "#data/data-lists";
import { getErDamagePreview } from "#data/elite-redux/er-damage-preview";
import type { AbilityId } from "#enums/ability-id";
import { ErAbilityId } from "#enums/er-ability-id";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

describe.skipIf(!RUN)("ER damage preview - multi-hit scaling", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });
  beforeEach(() => {
    game = new GameManager(phaserGame);
    game.override.battleStyle("single").enemySpecies(SpeciesId.SNORLAX).enemyLevel(50).startingLevel(50);
  });
  afterAll(() => {
    phaserGame.destroy(true);
  });

  it("scales MultiHitAttr moves (Double Kick x2, Bullet Seed 2-5)", async () => {
    await game.classicMode.startBattle(SpeciesId.MAGIKARP);
    const player = game.field.getPlayerPokemon();
    const enemy = game.field.getEnemyPokemon();
    const base = (id: MoveId) => enemy.getAttackDamage({ source: player, move: allMoves[id], simulated: true }).damage;

    const dk = getErDamagePreview(player, enemy, allMoves[MoveId.DOUBLE_KICK]);
    expect(dk.max).toBe(Math.floor(base(MoveId.DOUBLE_KICK) * 2));
    expect(dk.hits).toBe("2 hits");

    const bs = getErDamagePreview(player, enemy, allMoves[MoveId.BULLET_SEED]);
    expect(bs.max).toBe(Math.floor(base(MoveId.BULLET_SEED) * 5));
    expect(bs.min).toBe(Math.floor(base(MoveId.BULLET_SEED) * 0.85 * 2));
    expect(bs.hits).toBe("2-5 hits");
  });

  it("scales a Multi-Headed mon's single-hit move by head count (Dodrio = 3 heads -> x1.35)", async () => {
    game.override.ability(ErAbilityId.MULTI_HEADED as unknown as AbilityId);
    await game.classicMode.startBattle(SpeciesId.DODRIO);
    const player = game.field.getPlayerPokemon();
    const enemy = game.field.getEnemyPokemon();
    // Pin to the first strike so the base hit is the FULL (unreduced) damage - the
    // same pin getErDamagePreview applies before scaling. Without this, a stale
    // turnData strikeIndex>0 makes getAttackDamage apply the head-reduction to the
    // base, which is exactly the bug the preview avoids.
    player.turnData.hitCount = 1;
    player.turnData.hitsLeft = 1;
    const base = enemy.getAttackDamage({ source: player, move: allMoves[MoveId.TACKLE], simulated: true }).damage;

    const p = getErDamagePreview(player, enemy, allMoves[MoveId.TACKLE]);
    expect(p.max).toBe(Math.floor(base * 1.35));
    expect(p.hits).toBe("3 heads");
  });

  it("single-hit move with no enhancer = base damage, no hit label", async () => {
    await game.classicMode.startBattle(SpeciesId.MAGIKARP);
    const player = game.field.getPlayerPokemon();
    const enemy = game.field.getEnemyPokemon();
    const base = enemy.getAttackDamage({ source: player, move: allMoves[MoveId.TACKLE], simulated: true }).damage;

    const p = getErDamagePreview(player, enemy, allMoves[MoveId.TACKLE]);
    expect(p.max).toBe(base);
    expect(p.hits).toBe("");
  });
});

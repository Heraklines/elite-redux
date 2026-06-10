/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Regression (#358) — ER Ward Stones (Minor / Greater / Prime):
//  - instantly block externally-inflicted statuses + CC tags (flinch,
//    confusion, infatuation, Encore/Taunt/Disable/Torment, ER statuses),
//    consuming exactly one charge per block;
//  - self-inflicted statuses (Rest) are never blocked;
//  - ER Frisk's held-item lock (ER_ITEM_DISABLED) disables the stone;
//  - a STOLEN stone arrives with 0 charges;
//  - charging: Minor refills after 10 won waves, Greater gets BOTH charges
//    at once after 15 — never one-by-one;
//  - trainer assignment respects the difficulty + wave gate (Hell 100+ /
//    Elite 150+ / never Ace);
//  - player stones (incl. charges + progress) round-trip the session save.
//
// Gated behind ER_SCENARIO=1.
// =============================================================================

import { globalScene } from "#app/global-scene";
import { setErDifficulty } from "#data/elite-redux/er-run-difficulty";
import {
  advanceErWardStoneCharges,
  ER_WARD_STONE_CONFIG,
  ErWardStoneModifier,
  erWardStoneModifierType,
  findErWardStone,
  getErWardStoneEntries,
  maybeAssignErWardStone,
  restoreErWardStones,
} from "#data/elite-redux/er-ward-stones";
import { AbilityId } from "#enums/ability-id";
import { BattlerTagType } from "#enums/battler-tag-type";
import { SpeciesId } from "#enums/species-id";
import { StatusEffect } from "#enums/status-effect";
import type { EnemyPokemon, Pokemon } from "#field/pokemon";
import type { PokemonHeldItemModifier } from "#modifiers/modifier";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

function giveStone(holder: Pokemon, tier: "minor" | "greater" | "prime"): ErWardStoneModifier {
  const mod = erWardStoneModifierType(tier).newModifier(holder) as ErWardStoneModifier;
  if (holder.isPlayer()) {
    globalScene.addModifier(mod, true);
  } else {
    void globalScene.addEnemyModifier(mod as PokemonHeldItemModifier, true, true);
  }
  return mod;
}

describe.skipIf(!RUN)("ER Ward Stones (#358)", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });
  beforeEach(async () => {
    game = new GameManager(phaserGame);
    await game.classicMode.startBattle(SpeciesId.SNORLAX);
  });
  afterEach(() => {
    setErDifficulty("ace");
  });

  it("blocks an external status and depletes exactly one charge; empty stone no longer blocks", () => {
    const player = game.scene.getPlayerPokemon()!;
    const enemy = game.scene.getEnemyPokemon()!;
    const stone = giveStone(player, "minor");
    expect(stone.charges).toBe(1);

    // External paralysis → blocked, charge spent, no status applied.
    expect(player.trySetStatus(StatusEffect.PARALYSIS, enemy)).toBe(false);
    expect(stone.charges).toBe(0);
    expect(player.status?.effect).toBeUndefined();

    // Empty stone → the next status goes through.
    expect(player.trySetStatus(StatusEffect.PARALYSIS, enemy)).toBe(true);
  });

  it("blocks CC tags — flinch AND Encore — one charge each", () => {
    const player = game.scene.getPlayerPokemon()!;
    const enemy = game.scene.getEnemyPokemon()!;
    const stone = giveStone(player, "greater");
    expect(stone.charges).toBe(2);

    expect(player.addTag(BattlerTagType.FLINCHED, 1, undefined, enemy.id)).toBe(false);
    expect(stone.charges).toBe(1);
    expect(player.getTag(BattlerTagType.FLINCHED)).toBeUndefined();

    expect(player.addTag(BattlerTagType.ENCORE, 3, undefined, enemy.id)).toBe(false);
    expect(stone.charges).toBe(0);

    // Out of charges → the flinch lands now.
    expect(player.addTag(BattlerTagType.FLINCHED, 1, undefined, enemy.id)).toBe(true);
  });

  it("never blocks a SELF-inflicted status (Rest)", () => {
    const player = game.scene.getPlayerPokemon()!;
    const stone = giveStone(player, "minor");

    // Rest passes the user itself as the source.
    expect(player.trySetStatus(StatusEffect.SLEEP, player, 3)).toBe(true);
    expect(stone.charges).toBe(1); // untouched
  });

  it("is disabled while the holder's items are locked (ER Frisk: ER_ITEM_DISABLED)", () => {
    const player = game.scene.getPlayerPokemon()!;
    const enemy = game.scene.getEnemyPokemon()!;
    const stone = giveStone(player, "minor");

    player.addTag(BattlerTagType.ER_ITEM_DISABLED, 2, undefined, enemy.id);
    expect(player.trySetStatus(StatusEffect.PARALYSIS, enemy)).toBe(true); // lands
    expect(stone.charges).toBe(1); // not consumed
  });

  it("a stolen stone arrives EMPTY (0 charges)", () => {
    const player = game.scene.getPlayerPokemon()!;
    const enemy = game.scene.getEnemyPokemon()!;
    const stone = giveStone(enemy, "greater");
    expect(stone.charges).toBe(2); // enemy stones spawn full
    expect(stone.isTransferable).toBe(true);

    const moved = globalScene.tryTransferHeldItemModifier(
      stone as PokemonHeldItemModifier,
      player,
      false,
      1,
      undefined,
      undefined,
      false,
    );
    expect(moved).toBe(true);
    const stolen = findErWardStone(player);
    expect(stolen).toBeDefined();
    expect(stolen!.charges).toBe(0);

    // Prime stones are never stealable.
    const prime = erWardStoneModifierType("prime").newModifier(enemy) as ErWardStoneModifier;
    expect(prime.isTransferable).toBe(false);
  });

  it("charging: Minor refills after 10 won waves; Greater gets BOTH charges at once after 15", () => {
    const player = game.scene.getPlayerPokemon()!;
    const minor = giveStone(player, "minor");
    minor.drainCharges();

    for (let i = 0; i < 9; i++) {
      advanceErWardStoneCharges();
    }
    expect(minor.charges).toBe(0); // 9 waves: still charging
    advanceErWardStoneCharges(); // 10th won wave
    expect(minor.charges).toBe(1);

    globalScene.removeModifier(minor, false);
    const greater = giveStone(player, "greater");
    greater.drainCharges();
    for (let i = 0; i < 14; i++) {
      advanceErWardStoneCharges();
    }
    expect(greater.charges).toBe(0); // never 1-then-2
    advanceErWardStoneCharges(); // 15th won wave
    expect(greater.charges).toBe(2); // both at once
  });

  it("trainer assignment respects the Hell 100+ / Elite 150+ gate (and never Ace)", () => {
    const enemy = game.scene.getEnemyPokemon()! as EnemyPokemon;
    vi.spyOn(enemy, "randBattleSeedInt").mockReturnValue(0); // every roll passes
    const battle = game.scene.currentBattle as unknown as { trainer: object | null; waveIndex: number };
    const prevTrainer = battle.trainer;
    const prevWave = battle.waveIndex;
    battle.trainer = {};

    // Hell below wave 100 → nothing.
    setErDifficulty("hell");
    battle.waveIndex = 99;
    maybeAssignErWardStone(enemy);
    expect(findErWardStone(enemy)).toBeUndefined();

    // Hell at wave 120 → assigned, FULL charges.
    battle.waveIndex = 120;
    maybeAssignErWardStone(enemy);
    const stone = findErWardStone(enemy);
    expect(stone).toBeDefined();
    expect(stone!.charges).toBe(ER_WARD_STONE_CONFIG[stone!.tier].maxCharges);

    // Ace never gets one.
    globalScene.removeModifier(stone! as PokemonHeldItemModifier, true);
    setErDifficulty("ace");
    battle.waveIndex = 190;
    maybeAssignErWardStone(enemy);
    expect(findErWardStone(enemy)).toBeUndefined();

    battle.trainer = prevTrainer;
    battle.waveIndex = prevWave;
  });

  it("holding a stone grants ability-trap immunity (Shadow Tag style) at NO charge cost", () => {
    const player = game.scene.getPlayerPokemon()!;
    const enemy = game.scene.getEnemyPokemon()!;

    // Shadow Tag on the opponent (real in-battle ability override): the
    // player is trapped without a stone...
    enemy.summonData.ability = AbilityId.SHADOW_TAG;
    expect(player.isTrapped()).toBe(true);

    // ...but merely HOLDING a Ward Stone (even an EMPTY one) frees them.
    const stone = giveStone(player, "minor");
    stone.drainCharges();
    expect(player.isTrapped()).toBe(false);
    expect(stone.charges).toBe(0); // no charge spent
  });

  it("player stones round-trip the session save with charges + progress intact", () => {
    const player = game.scene.getPlayerPokemon()!;
    const stone = giveStone(player, "greater");
    stone.charges = 1;
    stone.waveProgress = 7;

    const saved = getErWardStoneEntries();
    expect(saved).toContainEqual([player.id, 1, 1, 7]); // tierIndex 1 = greater

    globalScene.removeModifier(stone, false);
    expect(findErWardStone(player)).toBeUndefined();

    restoreErWardStones(saved);
    const restored = findErWardStone(player);
    expect(restored).toBeDefined();
    expect(restored!.tier).toBe("greater");
    expect(restored!.charges).toBe(1);
    expect(restored!.waveProgress).toBe(7);

    // Restoring twice must not duplicate.
    restoreErWardStones(saved);
    expect(globalScene.findModifiers(m => m instanceof ErWardStoneModifier, true)).toHaveLength(1);
  });
});

/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// #130 — per-holder move-flag grant (AddMoveFlagAbAttr). Composites that make
// the holder's moves of a type/category gain a flag so flag-boost abilities
// (Iron Fist / Sharpness) on the SAME holder pick them up:
//   • Brawling Wyvern (600): Dragon moves → PUNCHING.
//   • Gunman (780): Status moves → PULSE.
//   • Mixed Martial Arts (813): Normal moves → PUNCHING + KICKING.
//
// Verified via the static grant scanner + an end-to-end Iron Fist synergy
// (Brawling Wyvern passive + Iron Fist boosts a Dragon move).
//
// Gated behind ER_SCENARIO=1.
// =============================================================================

import { AddMoveFlagAbAttr } from "#abilities/ab-attrs";
import { allMoves } from "#data/data-lists";
import { AbilityId } from "#enums/ability-id";
import { MoveFlags } from "#enums/move-flags";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

async function erAbility(id: number): Promise<AbilityId | undefined> {
  const map = (await import("#data/elite-redux/er-id-map")).ER_ID_MAP;
  return map.abilities[id] as AbilityId | undefined;
}

describe.skipIf(!RUN)("ER per-holder move-flag grant (#130)", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
  });

  async function startWith(ability: AbilityId): Promise<void> {
    game.override
      .battleStyle("single")
      .ability(ability)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemySpecies(SpeciesId.SNORLAX)
      .enemyMoveset(MoveId.SPLASH)
      .moveset(MoveId.SPLASH)
      .startingLevel(50)
      .enemyLevel(50)
      .criticalHits(false);
    await game.classicMode.startBattle([SpeciesId.SNORLAX]);
  }

  it("Brawling Wyvern (600): grants PUNCHING to Dragon moves only", async () => {
    const ability = await erAbility(600);
    if (ability === undefined) {
      return;
    }
    await startWith(ability);
    const p = game.field.getPlayerPokemon();
    expect(AddMoveFlagAbAttr.userGrantsFlag(p, allMoves[MoveId.DRAGON_CLAW], MoveFlags.PUNCHING_MOVE)).toBe(true);
    expect(AddMoveFlagAbAttr.userGrantsFlag(p, allMoves[MoveId.TACKLE], MoveFlags.PUNCHING_MOVE)).toBe(false);
  });

  it("Gunman (780): grants PULSE to Status moves only", async () => {
    const ability = await erAbility(780);
    if (ability === undefined) {
      return;
    }
    await startWith(ability);
    const p = game.field.getPlayerPokemon();
    expect(AddMoveFlagAbAttr.userGrantsFlag(p, allMoves[MoveId.SPLASH], MoveFlags.PULSE_MOVE)).toBe(true);
    expect(AddMoveFlagAbAttr.userGrantsFlag(p, allMoves[MoveId.TACKLE], MoveFlags.PULSE_MOVE)).toBe(false);
  });

  it("Mixed Martial Arts (813): grants PUNCHING + KICKING to Normal moves only", async () => {
    const ability = await erAbility(813);
    if (ability === undefined) {
      return;
    }
    await startWith(ability);
    const p = game.field.getPlayerPokemon();
    expect(AddMoveFlagAbAttr.userGrantsFlag(p, allMoves[MoveId.TACKLE], MoveFlags.PUNCHING_MOVE)).toBe(true);
    expect(AddMoveFlagAbAttr.userGrantsFlag(p, allMoves[MoveId.TACKLE], MoveFlags.KICKING_MOVE)).toBe(true);
    expect(AddMoveFlagAbAttr.userGrantsFlag(p, allMoves[MoveId.DRAGON_CLAW], MoveFlags.PUNCHING_MOVE)).toBe(false);
  });

  it("Iron Fist boosts a Dragon move when Brawling Wyvern is a passive (end-to-end)", async () => {
    const wyvern = await erAbility(600);
    if (wyvern === undefined) {
      return;
    }
    game.override
      .battleStyle("single")
      .ability(AbilityId.IRON_FIST)
      .passiveAbility(wyvern)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemySpecies(SpeciesId.SNORLAX)
      .enemyMoveset(MoveId.SPLASH)
      .moveset(MoveId.DRAGON_CLAW)
      .startingLevel(50)
      .enemyLevel(50)
      .criticalHits(false);
    await game.classicMode.startBattle([SpeciesId.DRUDDIGON]);
    const p = game.field.getPlayerPokemon();
    // Iron Fist's MovePowerBoostAbAttr condition now ORs the flag grant, so a
    // Dragon move counts as PUNCHING for this holder → the 1.2x boost applies.
    expect(AddMoveFlagAbAttr.userGrantsFlag(p, allMoves[MoveId.DRAGON_CLAW], MoveFlags.PUNCHING_MOVE)).toBe(true);
  });
});

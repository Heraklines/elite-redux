/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// ER BLEED spec regression (the "Bleed isn't working how it's supposed to" bug).
// The 2.65 dex spec: bleed (1) chips 1/16 max HP/turn, (2) prevents healing,
// (3) negates stat boosts, (4) Rock/Ghost immune, (5) is removed ONLY by using a
// healing MOVE (which then heals nothing), and (6) must NOT be removed by
// switching out or by applying/curing a different status.
//
// Points 1-4 were already correct; this suite guards the two fixes:
//   - point 5: a healing MOVE cures bleed and heals 0; a NON-move heal (Leftovers)
//     heals 0 but leaves the bleed in place.
//   - point 6: bleed survives a switch-out (it lived in summonData and was wiped),
//     and a cure-all path no longer targets it (ER_AILMENT_TAGS excludes ER_BLEED).
//
// The battle cases are ER_SCENARIO=1 gated; the ER_AILMENT_TAGS membership check
// is a plain unit assertion (no battle boot).
// =============================================================================

import { ER_AILMENT_TAGS } from "#data/elite-redux/er-status-cure";
import { AbilityId } from "#enums/ability-id";
import { BattlerTagType } from "#enums/battler-tag-type";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { afterAll, beforeAll, beforeEach, describe, expect, it, test } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

describe("ER BLEED - cure-all no longer targets bleed (point 6)", () => {
  test("ER_AILMENT_TAGS excludes ER_BLEED but keeps frostbite + fear", () => {
    // A cure-all (Lum / Full Heal / Heal Bell / Natural Cure / Shed Skin / Healer)
    // clears every tag in this set. Bleed must NOT be in it - only a healing move
    // removes bleed.
    expect(ER_AILMENT_TAGS).not.toContain(BattlerTagType.ER_BLEED);
    expect(ER_AILMENT_TAGS).toContain(BattlerTagType.ER_FROSTBITE);
    expect(ER_AILMENT_TAGS).toContain(BattlerTagType.ER_FEAR);
  });
});

describe.skipIf(!RUN)("ER BLEED - persistence + heal-move-only cure", () => {
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
      .startingLevel(50)
      .enemyLevel(50)
      .ability(AbilityId.BALL_FETCH)
      .enemyAbility(AbilityId.BALL_FETCH)
      // Snorlax is Normal - NOT Rock/Ghost, so it CAN be bled.
      .enemySpecies(SpeciesId.SNORLAX)
      // HARDEN is a self-target stat move: neither side ever deals HP damage, so the
      // player's HP only moves from healing / the bleed chip. (ER's MoveId.SPLASH
      // maps to a 40-power damaging move, so it can't be used as a no-op here.)
      .enemyMoveset(MoveId.HARDEN)
      .moveset([MoveId.HARDEN, MoveId.RECOVER]);
  });

  afterAll(() => {
    phaserGame.destroy(true);
  });

  it("point 6: bleed PERSISTS across a switch-out, but a fainted mon drops it", async () => {
    await game.classicMode.startBattle(SpeciesId.SNORLAX);
    const player = game.field.getPlayerPokemon();
    expect(player.addTag(BattlerTagType.ER_BLEED)).toBe(true);

    // A switch-out runs leaveField -> resetSummonData(), which rebuilds summonData
    // from scratch. Before the fix that discarded the bleed; now an active bleed is
    // carried onto the fresh summonData (the way a non-volatile status persists).
    player.resetSummonData();
    expect(player.getTag(BattlerTagType.ER_BLEED)).toBeDefined();

    // A fainted mon keeps no status: resetSummonData on a fainted mon drops bleed.
    player.hp = 0;
    player.resetSummonData();
    expect(player.getTag(BattlerTagType.ER_BLEED)).toBeUndefined();
  });

  it("point 5: a healing MOVE (Recover) cures bleed and restores 0 HP", async () => {
    await game.classicMode.startBattle(SpeciesId.SNORLAX);
    const player = game.field.getPlayerPokemon();
    // Drop below full so a working heal would visibly restore HP.
    player.hp = Math.floor(player.getMaxHp() / 2);
    expect(player.addTag(BattlerTagType.ER_BLEED)).toBe(true);
    const hpBefore = player.hp;

    game.move.select(MoveId.RECOVER);
    await game.phaseInterceptor.to("TurnEndPhase");

    // Recover cured the bleed (heal MOVE) - and healed nothing, so with the bleed
    // gone there's no end-of-turn chip either: HP is exactly where it started.
    expect(player.getTag(BattlerTagType.ER_BLEED)).toBeUndefined();
    expect(player.hp).toBe(hpBefore);
  });

  it("point 5: a NON-move heal (Leftovers) restores 0 HP and does NOT cure bleed", async () => {
    game.override.startingHeldItems([{ name: "LEFTOVERS" }]);
    await game.classicMode.startBattle(SpeciesId.SNORLAX);
    const player = game.field.getPlayerPokemon();
    player.hp = Math.floor(player.getMaxHp() / 2);
    expect(player.addTag(BattlerTagType.ER_BLEED)).toBe(true);
    const hpBefore = player.hp;

    game.move.select(MoveId.HARDEN);
    await game.phaseInterceptor.to("TurnEndPhase");

    // Leftovers is not a healing MOVE: it heals nothing on a bled mon and must
    // leave the bleed in place, so the mon takes the net 1/16 chip this turn.
    expect(player.getTag(BattlerTagType.ER_BLEED)).toBeDefined();
    expect(player.hp).toBeLessThan(hpBefore);
  });
});

/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// ER BLEED cure spec - UPDATED per the maintainer directive (2026-07-07, the
// "someone in prod cannot heal bleed through any means" report): every ER
// status is curable through the NORMAL means (Full Heal / Lum / Heal Bell /
// cure abilities), and bleed is ADDITIONALLY cured by ANY healing:
//   - any PokemonHealPhase source (healing move, Leftovers, Wish, terrain,
//     recovery abilities) - the heal is consumed to cure it, restoring no HP
//     (the ROM's "prevents healing" flavor is kept);
//   - any HP-restoring ITEM (Potion family) - which also heals normally.
// Unchanged: bleed persists across switch-out; a fainted mon drops it.
// (The old spec reading - healing MOVES only, cure-alls spare bleed - is
// superseded; this suite was rewritten from asserting that behavior.)
//
// The battle cases are ER_SCENARIO=1 gated; the ER_AILMENT_TAGS membership check
// is a plain unit assertion (no battle boot).
// =============================================================================

import { modifierTypes } from "#data/data-lists";
import { ER_AILMENT_TAGS } from "#data/elite-redux/er-status-cure";
import { AbilityId } from "#enums/ability-id";
import { BattlerTagType } from "#enums/battler-tag-type";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { PokemonHpRestoreModifier, PokemonStatusHealModifier } from "#modifiers/modifier";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { afterAll, beforeAll, beforeEach, describe, expect, it, test } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

describe("ER BLEED - a normal cure-all clears bleed too (2026-07-07 directive)", () => {
  test("ER_AILMENT_TAGS includes bleed, frostbite AND fear", () => {
    // A cure-all (Lum / Full Heal / Heal Bell / Natural Cure / Shed Skin / Healer)
    // clears every tag in this set - since the 2026-07-07 directive that includes
    // bleed (live players previously could not shake it off at all).
    expect(ER_AILMENT_TAGS).toContain(BattlerTagType.ER_BLEED);
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

  it("ANY heal source cures bleed: Leftovers restores 0 HP but removes the bleed", async () => {
    game.override.startingHeldItems([{ name: "LEFTOVERS" }]);
    await game.classicMode.startBattle(SpeciesId.SNORLAX);
    const player = game.field.getPlayerPokemon();
    player.hp = Math.floor(player.getMaxHp() / 2);
    expect(player.addTag(BattlerTagType.ER_BLEED)).toBe(true);
    const hpBefore = player.hp;

    game.move.select(MoveId.HARDEN);
    // The Leftovers heal phase is unshifted DURING TurnEndPhase - run through to
    // the next turn so it has actually resolved before asserting.
    await game.toNextTurn();

    // 2026-07-07 directive: ANY healing cures bleed. The Leftovers tick is
    // consumed to cure it (no HP gained from it this turn).
    expect(player.getTag(BattlerTagType.ER_BLEED)).toBeUndefined();
    expect(player.hp).toBeLessThanOrEqual(hpBefore);
  });

  it("a Full Heal (status-cure item) clears bleed", async () => {
    await game.classicMode.startBattle(SpeciesId.SNORLAX);
    const player = game.field.getPlayerPokemon();
    expect(player.addTag(BattlerTagType.ER_BLEED)).toBe(true);

    const fullHeal = modifierTypes.FULL_HEAL().newModifier(player) as PokemonStatusHealModifier;
    expect(fullHeal).toBeInstanceOf(PokemonStatusHealModifier);
    expect(fullHeal.apply(player)).toBe(true);

    expect(player.getTag(BattlerTagType.ER_BLEED)).toBeUndefined();
  });

  it("a plain Potion (HP-restore item) cures bleed AND heals normally", async () => {
    await game.classicMode.startBattle(SpeciesId.SNORLAX);
    const player = game.field.getPlayerPokemon();
    player.hp = Math.floor(player.getMaxHp() / 2);
    expect(player.addTag(BattlerTagType.ER_BLEED)).toBe(true);
    const hpBefore = player.hp;

    const potion = modifierTypes.POTION().newModifier(player) as PokemonHpRestoreModifier;
    expect(potion).toBeInstanceOf(PokemonHpRestoreModifier);
    expect(potion.apply(player, 1)).toBe(true);

    // Items are the generous path: the bleed is cured AND the HP restores.
    expect(player.getTag(BattlerTagType.ER_BLEED)).toBeUndefined();
    expect(player.hp).toBeGreaterThan(hpBefore);
  });
});

/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// ER item-mechanic engine primitives — closes 5 remaining dex gaps:
//
//   1. Move  271 Trick       — held-item SWAP (ErSwapHeldItemAttr).
//   2. Move  478 Magic Room  — field-wide item-effect suppression (MagicRoomTag).
//   3. Move  970 Transmute   — on-KO consumed-item regen (ErTransmuteRegenOnKoAttr).
//   4. Abil. 139 Harvest     — regrows a berry consumed via Fling / Natural Gift.
//   5. Abil. 127 Unnerve     — blocks ALL foe consumables (adds PreventItemUse).
//
// Gated behind ER_SCENARIO=1 (like every ER engine test).
// =============================================================================

import { isMagicRoomActive } from "#data/arena-tag";
import { allAbilities } from "#data/data-lists";
import { ER_ID_MAP } from "#data/elite-redux/er-id-map";
import { ErReactiveItemModifier, erApplyReactiveOnHit, erReactiveItemType } from "#data/elite-redux/er-reactive-items";
import { AbilityId } from "#enums/ability-id";
import { ArenaTagType } from "#enums/arena-tag-type";
import { BerryType } from "#enums/berry-type";
import { HitResult } from "#enums/hit-result";
import { MoveId } from "#enums/move-id";
import { PokemonType } from "#enums/pokemon-type";
import { SpeciesId } from "#enums/species-id";
import { Stat } from "#enums/stat";
import { WeatherType } from "#enums/weather-type";
import { BerryModifier, PokemonHeldItemModifier } from "#modifiers/modifier";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

const TRANSMUTE = (ER_ID_MAP.moves[970] ?? MoveId.NONE) as MoveId;

describe.skipIf(!RUN)("ER item-mechanic primitives (5 dex gaps)", () => {
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
      .enemySpecies(SpeciesId.SNORLAX)
      .enemyMoveset(MoveId.SPLASH)
      .enemyAbility(AbilityId.BALL_FETCH)
      .criticalHits(false);
  });

  const playerHeldItems = (pokemonId: number) =>
    game.scene.findModifiers(
      m => m instanceof PokemonHeldItemModifier && (m as PokemonHeldItemModifier).pokemonId === pokemonId,
      true,
    ) as PokemonHeldItemModifier[];

  const enemyHeldItems = (pokemonId: number) =>
    game.scene.findModifiers(
      m => m instanceof PokemonHeldItemModifier && (m as PokemonHeldItemModifier).pokemonId === pokemonId,
      false,
    ) as PokemonHeldItemModifier[];

  // ---------------------------------------------------------------------------
  // 1. Trick (271) — held-item swap
  // ---------------------------------------------------------------------------
  it("Trick swaps the user's held item with the target's", async () => {
    game.override
      .ability(AbilityId.BALL_FETCH)
      .moveset([MoveId.TRICK])
      .startingHeldItems([{ name: "LEFTOVERS" }])
      .enemyHeldItems([{ name: "WIDE_LENS" }]);
    await game.classicMode.startBattle(SpeciesId.GENGAR);
    const player = game.field.getPlayerPokemon();
    const enemy = game.field.getEnemyPokemon();

    expect(
      playerHeldItems(player.id).map(m => m.type.id),
      "player starts with Leftovers",
    ).toContain("LEFTOVERS");
    expect(
      enemyHeldItems(enemy.id).map(m => m.type.id),
      "enemy starts with Wide Lens",
    ).toContain("WIDE_LENS");

    game.move.use(MoveId.TRICK, 0);
    await game.toEndOfTurn();

    // After Trick the user holds the target's item and vice versa.
    expect(
      playerHeldItems(player.id).map(m => m.type.id),
      "player now holds the foe's Wide Lens",
    ).toContain("WIDE_LENS");
    expect(
      playerHeldItems(player.id).map(m => m.type.id),
      "player no longer holds Leftovers",
    ).not.toContain("LEFTOVERS");
    expect(
      enemyHeldItems(enemy.id).map(m => m.type.id),
      "foe now holds the user's Leftovers",
    ).toContain("LEFTOVERS");
    expect(
      enemyHeldItems(enemy.id).map(m => m.type.id),
      "foe no longer holds Wide Lens",
    ).not.toContain("WIDE_LENS");
  }, 120_000);

  // ---------------------------------------------------------------------------
  // 2. Magic Room (478) — field-wide item-effect suppression
  // ---------------------------------------------------------------------------
  it("Magic Room suppresses Leftovers healing while up, and it resumes afterward", async () => {
    // Bulky player; both sides use Defense Curl (a pure self-buff — no damage in
    // this ER build, unlike SPLASH which was made damaging), so NOTHING but
    // Leftovers moves the player's HP and neither mon faints.
    game.override
      .ability(AbilityId.BALL_FETCH)
      .moveset([MoveId.MAGIC_ROOM, MoveId.DEFENSE_CURL])
      .enemyMoveset(MoveId.DEFENSE_CURL)
      .startingHeldItems([{ name: "LEFTOVERS" }]);
    await game.classicMode.startBattle(SpeciesId.SNORLAX);
    const player = game.field.getPlayerPokemon();
    const leftovers = playerHeldItems(player.id).find(m => m.type.id === "LEFTOVERS")!;
    expect(leftovers, "player holds Leftovers").toBeDefined();

    // Put the player below max so Leftovers has something to heal (small deficit
    // on a bulky mon — no risk of fainting).
    player.hp = player.getMaxHp() - 100;

    // Turn 1: cast Magic Room. No Leftovers heal at end of turn while it is up.
    const hpBefore = player.hp;
    game.move.use(MoveId.MAGIC_ROOM, 0);
    await game.toEndOfTurn();

    expect(isMagicRoomActive(), "Magic Room is active on the field").toBe(true);
    expect(leftovers.shouldApply(player), "Leftovers is suppressed by Magic Room").toBe(false);
    expect(player.hp, "player did not heal from Leftovers under Magic Room").toBe(hpBefore);

    // Simulate Magic Room expiry, then Leftovers works again.
    game.scene.arena.removeTag(ArenaTagType.MAGIC_ROOM);
    expect(isMagicRoomActive(), "Magic Room cleared").toBe(false);
    expect(leftovers.shouldApply(player), "Leftovers applies again once Magic Room ends").toBe(true);

    // Turn 2: with Magic Room gone, Leftovers heals. The heal is unshifted as a
    // PokemonHealPhase right after TurnEndPhase, so advance one more phase past
    // the end of turn to let it resolve.
    const hpBeforeHeal = player.hp;
    game.move.use(MoveId.DEFENSE_CURL, 0);
    await game.toEndOfTurn();
    await game.phaseInterceptor.to("PokemonHealPhase");
    expect(player.hp, "Leftovers heals once Magic Room is gone").toBeGreaterThan(hpBeforeHeal);
  }, 120_000);

  // ---------------------------------------------------------------------------
  // 3. Transmute (970) — on-KO consumed-item regen
  // ---------------------------------------------------------------------------
  it("Transmute regenerates the user's most-recent lost item when it KOs the target", async () => {
    game.override
      .ability(AbilityId.BALL_FETCH)
      .moveset([TRANSMUTE])
      .startingHeldItems([{ name: "LEFTOVERS" }]);
    await game.classicMode.startBattle(SpeciesId.GENGAR);
    const player = game.field.getPlayerPokemon();
    const enemy = game.field.getEnemyPokemon();

    // Model an item this mon already lost this battle (e.g. a knocked-off item),
    // so the ledger has something for Transmute to regenerate on the KO.
    const leftovers = playerHeldItems(player.id).find(m => m.type.id === "LEFTOVERS")!;
    player.loseHeldItem(leftovers);
    game.scene.updateModifiers(true);
    expect(
      playerHeldItems(player.id).some(m => m.type.id === "LEFTOVERS"),
      "Leftovers gone after loss",
    ).toBe(false);
    expect(
      player.battleData.lostItems.map(r => r.typeId),
      "the lost item is ledgered",
    ).toContain("LEFTOVERS");

    // Make Transmute lethal so the on-KO regen fires.
    enemy.hp = 1;

    game.move.use(TRANSMUTE, 0);
    await game.toEndOfTurn();

    expect(enemy.isFainted(), "Transmute KO'd the target").toBe(true);
    expect(
      playerHeldItems(player.id).some(m => m.type.id === "LEFTOVERS"),
      "Transmute regenerated the lost Leftovers on the KO",
    ).toBe(true);
    expect(player.battleData.lostItems, "the regenerated item left the ledger").toHaveLength(0);
  }, 120_000);

  // ---------------------------------------------------------------------------
  // 4. Harvest (139) — regrows a berry consumed via Fling
  // ---------------------------------------------------------------------------
  it("Harvest regrows a berry consumed by Fling (in sun)", async () => {
    game.override
      .ability(AbilityId.HARVEST)
      .moveset([MoveId.FLING])
      .weather(WeatherType.SUNNY)
      .startingHeldItems([{ name: "BERRY", type: BerryType.SITRUS, count: 1 }]);
    await game.classicMode.startBattle(SpeciesId.GENGAR);
    const player = game.field.getPlayerPokemon();

    const berriesOf = (id: number) =>
      game.scene.findModifiers(
        m => m instanceof BerryModifier && (m as BerryModifier).pokemonId === id,
        true,
      ) as BerryModifier[];
    expect(
      berriesOf(player.id).some(b => b.berryType === BerryType.SITRUS),
      "player starts with a Sitrus Berry",
    ).toBe(true);

    // Fling consumes the held berry (ledgered to battleData.berriesEaten, not the
    // Cud Chew store), then Harvest (100% in sun) regrows it at end of turn.
    game.move.use(MoveId.FLING, 0);
    await game.toEndOfTurn();

    expect(
      berriesOf(player.id).some(b => b.berryType === BerryType.SITRUS),
      "Harvest regrew the flung Sitrus Berry in sun",
    ).toBe(true);
  }, 120_000);

  // ---------------------------------------------------------------------------
  // 5. Unnerve (127) — blocks ALL foe consumables (not just berries)
  // ---------------------------------------------------------------------------
  it("Unnerve carries the PreventItemUse marker (blocks non-berry consumables)", async () => {
    game.override.ability(AbilityId.UNNERVE);
    await game.classicMode.startBattle(SpeciesId.GENGAR);
    const player = game.field.getPlayerPokemon();
    expect(player.hasAbilityWithAttr("PreventBerryUseAbAttr"), "Unnerve still blocks berries").toBe(true);
    expect(player.hasAbilityWithAttr("PreventItemUseAbAttr"), "Unnerve now blocks non-berry consumables too").toBe(
      true,
    );
    // Sanity: the ability data itself carries both markers.
    expect(allAbilities[AbilityId.UNNERVE].hasAttr("PreventItemUseAbAttr"), "Unnerve ability has PreventItemUse").toBe(
      true,
    );
  }, 120_000);

  it("Unnerve blocks a foe's reactive (pinch) item from proccing; a non-Unnerve foe does not", async () => {
    game.override.ability(AbilityId.UNNERVE);
    await game.classicMode.startBattle(SpeciesId.GENGAR);
    const enemy = game.field.getEnemyPokemon();

    // Give the foe a Cell Battery (reactive, Electric -> +1 Atk, single use).
    const cellBattery = erReactiveItemType("cellBattery").newModifier(enemy) as ErReactiveItemModifier;
    void game.scene.addEnemyModifier(cellBattery, true, true);
    game.scene.updateModifiers(false);
    expect(
      enemyHeldItems(enemy.id).some(m => m instanceof ErReactiveItemModifier),
      "foe holds the reactive item",
    ).toBe(true);

    // Under the player's Unnerve, the reactive item may NOT fire -> not consumed.
    erApplyReactiveOnHit(enemy, PokemonType.ELECTRIC, HitResult.EFFECTIVE, true);
    const stillHeld = enemyHeldItems(enemy.id).some(m => m instanceof ErReactiveItemModifier);
    expect(stillHeld, "Unnerve blocked the foe's reactive item (it was NOT consumed)").toBe(true);
    expect(enemy.getStatStage(Stat.ATK), "and the foe got no stat boost").toBe(0);
  }, 120_000);

  it("control: WITHOUT Unnerve, the same reactive item procs (proves the block is Unnerve's)", async () => {
    game.override.ability(AbilityId.BALL_FETCH);
    await game.classicMode.startBattle(SpeciesId.GENGAR);
    const player = game.field.getPlayerPokemon();
    const enemy = game.field.getEnemyPokemon();
    expect(player.hasAbilityWithAttr("PreventItemUseAbAttr"), "control lead has no PreventItemUse").toBe(false);

    const cellBattery = erReactiveItemType("cellBattery").newModifier(enemy) as ErReactiveItemModifier;
    void game.scene.addEnemyModifier(cellBattery, true, true);
    game.scene.updateModifiers(false);

    erApplyReactiveOnHit(enemy, PokemonType.ELECTRIC, HitResult.EFFECTIVE, true);
    const stillHeld = enemyHeldItems(enemy.id).some(m => m instanceof ErReactiveItemModifier);
    expect(stillHeld, "without Unnerve the reactive item fired and was consumed").toBe(false);
  }, 120_000);
});

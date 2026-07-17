/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// ER residual sub-clauses (built on top of already-mostly-implemented items):
//   1. Sky Drop (507)   — fails vs >=200kg / Flying targets; drops a light
//                          non-Flying target normally (damage on the slam turn).
//   2. Dreamcatcher (305) — the switch-strike on a sleeping foe is 1x (the
//                          any-asleep boost does NOT re-apply for that hit).
//   3. Fling (543) / Natural Gift (363) — per-item Fling BP table; per-berry
//                          Natural Gift type/power table.
//   4. Trick (271)      — Sticky Hold on EITHER side fails the swap atomically.
//   5. Unnerve (127)    — a foe under Unnerve cannot consume its elemental Gem.
//   6. Pursuit (228)    — intercepts a foe self-switching via a MOVE (U-turn) at 2x.
//
// Gated behind ER_SCENARIO=1 (like every ER engine test). Each sub-clause that
// needs a baseline vs. fixed comparison uses SEPARATE it() blocks sharing a
// describe-scope let (one GameManager per test — creating a 2nd mid-test trips
// the prompt-handler-interval guard).
// =============================================================================

import { globalScene } from "#app/global-scene";
import { allMoves } from "#data/data-lists";
import { erGemItemType } from "#data/elite-redux/er-elemental-gems";
import { ErFlingPowerAttr, ErNaturalGiftPowerAttr, ErNaturalGiftTypeAttr } from "#data/moves/move";
import { AbilityId } from "#enums/ability-id";
import { BattleType } from "#enums/battle-type";
import { BattlerTagType } from "#enums/battler-tag-type";
import { BerryType } from "#enums/berry-type";
import { MoveId } from "#enums/move-id";
import { PokemonType } from "#enums/pokemon-type";
import { SpeciesId } from "#enums/species-id";
import { StatusEffect } from "#enums/status-effect";
import type { PokemonHeldItemModifier } from "#modifiers/modifier";
import { GameManager } from "#test/framework/game-manager";
import { NumberHolder } from "#utils/common";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

const playerHoldsId = (id: string, pid: number): boolean =>
  (
    globalScene.findModifiers(m => (m as PokemonHeldItemModifier).pokemonId === pid, true) as PokemonHeldItemModifier[]
  ).some(m => m.type?.id === id);
const enemyHoldsId = (id: string, pid: number): boolean =>
  (
    globalScene.findModifiers(m => (m as PokemonHeldItemModifier).pokemonId === pid, false) as PokemonHeldItemModifier[]
  ).some(m => m.type?.id === id);

describe.skipIf(!RUN)("ER residual sub-clauses", () => {
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
      .ability(AbilityId.BALL_FETCH);
  });

  // ---------------------------------------------------------------------------
  // 1. Sky Drop (507) — weight / Flying immunity, normal drop
  // ---------------------------------------------------------------------------
  describe("Sky Drop (507)", () => {
    beforeEach(() => {
      game.override.moveset([MoveId.SKY_DROP]).enemyMoveset(MoveId.SPLASH);
      vi.spyOn(allMoves[MoveId.SKY_DROP], "accuracy", "get").mockReturnValue(100);
    });

    it("FAILS against a >=200kg target (no lift, no damage)", async () => {
      // Snorlax weighs 460 kg. Start past the #419 BST-cap ladder (wave 150) so
      // it is NOT devolved to Munchlax (105 kg) at a low wave.
      game.override.enemySpecies(SpeciesId.SNORLAX).startingWave(150);
      await game.classicMode.startBattle(SpeciesId.MAGIKARP);
      const player = game.field.getPlayerPokemon();
      const enemy = game.field.getEnemyPokemon();
      expect(enemy.getWeight()).toBeGreaterThanOrEqual(200);

      game.move.use(MoveId.SKY_DROP);
      await game.phaseInterceptor.to("TurnEndPhase");

      // The lift failed: no charge (user never became semi-invulnerable), the
      // target was never grabbed, and it took no damage.
      expect(player.getTag(BattlerTagType.FLYING)).toBeUndefined();
      expect(enemy.getTag(BattlerTagType.SKY_DROP)).toBeUndefined();
      expect(enemy.hp).toBe(enemy.getMaxHp());
    });

    it("FAILS against a Flying-type target (cannot be lifted)", async () => {
      game.override.enemySpecies(SpeciesId.PIDGEOT);
      await game.classicMode.startBattle(SpeciesId.MAGIKARP);
      const player = game.field.getPlayerPokemon();
      const enemy = game.field.getEnemyPokemon();
      expect(enemy.isOfType(PokemonType.FLYING)).toBe(true);

      game.move.use(MoveId.SKY_DROP);
      await game.phaseInterceptor.to("TurnEndPhase");

      expect(player.getTag(BattlerTagType.FLYING)).toBeUndefined();
      expect(enemy.getTag(BattlerTagType.SKY_DROP)).toBeUndefined();
      expect(enemy.hp).toBe(enemy.getMaxHp());
    });

    it("drops a light, non-Flying target normally (2-turn charge + damage)", async () => {
      // Shuckle: 20.5 kg, Bug/Rock — under the weight cap and not Flying.
      game.override.enemySpecies(SpeciesId.SHUCKLE);
      await game.classicMode.startBattle(SpeciesId.MAGIKARP); // faster than Shuckle
      const player = game.field.getPlayerPokemon();
      const enemy = game.field.getEnemyPokemon();
      expect(enemy.getWeight()).toBeLessThan(200);
      expect(enemy.isOfType(PokemonType.FLYING)).toBe(false);

      game.move.use(MoveId.SKY_DROP);

      // Charge turn: user lifted (semi-invulnerable), target grabbed + immobilized.
      await game.phaseInterceptor.to("TurnEndPhase");
      expect(player.getTag(BattlerTagType.FLYING)).toBeDefined();
      expect(enemy.getTag(BattlerTagType.SKY_DROP)).toBeDefined();
      expect(enemy.hp).toBe(enemy.getMaxHp());

      // Slam turn: damage dealt, hold released.
      await game.phaseInterceptor.to("TurnEndPhase");
      expect(player.getTag(BattlerTagType.FLYING)).toBeUndefined();
      expect(enemy.getTag(BattlerTagType.SKY_DROP)).toBeUndefined();
      expect(enemy.hp).toBeLessThan(enemy.getMaxHp());
    });
  });

  // ---------------------------------------------------------------------------
  // 2. Dreamcatcher (305) — switch-strike on a sleeping foe is 1x, not 2x
  // ---------------------------------------------------------------------------
  describe("Dreamcatcher (305) — switch-strike is 1x", () => {
    let dreamcatcher: AbilityId;
    let boostedDamage = 0;

    beforeEach(async () => {
      dreamcatcher = (await import("#data/elite-redux/er-id-map")).ER_ID_MAP.abilities[305] as AbilityId;
      game.override
        .moveset([MoveId.TACKLE])
        .ability(dreamcatcher)
        .battleType(BattleType.TRAINER)
        .enemySpecies(SpeciesId.SNORLAX)
        .enemyMoveset([MoveId.SPLASH]);
    });

    it("baseline — 2x vs a NON-switching sleeper", async () => {
      await game.classicMode.startBattle(SpeciesId.REGIROCK);
      const enemy = game.field.getEnemyPokemon();
      enemy.trySetStatus(StatusEffect.SLEEP, undefined, 3);
      enemy.hp = enemy.getMaxHp();
      const hpBefore = enemy.hp;

      game.move.select(MoveId.TACKLE);
      await game.toEndOfTurn();

      boostedDamage = hpBefore - enemy.hp;
      expect(boostedDamage).toBeGreaterThan(0);
    });

    it("the strike on a SLEEPING foe switching out is 1x (~half the boosted hit)", async () => {
      await game.classicMode.startBattle(SpeciesId.REGIROCK);
      const enemy0 = game.scene.getEnemyParty()[0];
      enemy0.trySetStatus(StatusEffect.SLEEP, undefined, 3);
      enemy0.hp = enemy0.getMaxHp();

      game.move.select(MoveId.TACKLE);
      game.forceEnemyToSwitch();
      await game.toEndOfTurn();

      expect(game.phaseInterceptor.log).toContain("SwitchSummonPhase");
      const switchDamage = enemy0.getInverseHp();
      // The switch-strike still connects...
      expect(switchDamage).toBeGreaterThan(0);
      // ...but at 1x — roughly HALF the boosted (2x) hit, NOT equal to it.
      expect(boostedDamage).toBeGreaterThan(0);
      expect(switchDamage).toBeLessThan(boostedDamage * 0.65);
      expect(switchDamage).toBeGreaterThan(boostedDamage * 0.35);
    });
  });

  // ---------------------------------------------------------------------------
  // 3. Fling (543) — per-item power table
  // ---------------------------------------------------------------------------
  describe("Fling (543) — item power table", () => {
    beforeEach(() => {
      game.override.moveset([MoveId.FLING]).enemySpecies(SpeciesId.SNORLAX).enemyMoveset(MoveId.SPLASH);
    });

    it("flings a Grip Claw at its table BP (90), not the flat 10", async () => {
      game.override.startingHeldItems([{ name: "GRIP_CLAW" }]);
      await game.classicMode.startBattle(SpeciesId.REGIROCK);
      const player = game.field.getPlayerPokemon();
      const enemy = game.field.getEnemyPokemon();

      // Direct table check: the resolved Fling power is the Grip Claw entry (90).
      const power = new NumberHolder(0);
      new ErFlingPowerAttr().apply(player, enemy, allMoves[MoveId.FLING], [power]);
      expect(power.value).toBe(90);

      // Behavioural: the item is thrown (consumed) and damage is dealt.
      const hpBefore = enemy.hp;
      game.move.select(MoveId.FLING);
      await game.toEndOfTurn();
      expect(enemy.hp).toBeLessThan(hpBefore);
      expect(playerHoldsId("GRIP_CLAW", player.id)).toBe(false);
    });

    it("flings a berry at 10 BP and ledgers it for Harvest", async () => {
      game.override.startingHeldItems([{ name: "BERRY", type: BerryType.SITRUS }]);
      await game.classicMode.startBattle(SpeciesId.REGIROCK);
      const player = game.field.getPlayerPokemon();
      const enemy = game.field.getEnemyPokemon();

      const power = new NumberHolder(0);
      new ErFlingPowerAttr().apply(player, enemy, allMoves[MoveId.FLING], [power]);
      expect(power.value).toBe(10);

      game.move.select(MoveId.FLING);
      await game.toEndOfTurn();
      // A flung berry is ledgered to Harvest's store.
      expect(player.battleData.berriesEaten).toContain(BerryType.SITRUS);
    });
  });

  // ---------------------------------------------------------------------------
  // 3b. Natural Gift (363) — per-berry type/power table
  // ---------------------------------------------------------------------------
  describe("Natural Gift (363) — berry type/power table", () => {
    beforeEach(() => {
      game.override.moveset([MoveId.NATURAL_GIFT]).enemySpecies(SpeciesId.SNORLAX).enemyMoveset(MoveId.SPLASH);
    });

    it("a Liechi berry gives a Grass-type, 100-power hit", async () => {
      game.override.startingHeldItems([{ name: "BERRY", type: BerryType.LIECHI }]);
      await game.classicMode.startBattle(SpeciesId.REGIROCK);
      const player = game.field.getPlayerPokemon();
      const enemy = game.field.getEnemyPokemon();

      const type = new NumberHolder(PokemonType.NORMAL);
      new ErNaturalGiftTypeAttr().apply(player, enemy, allMoves[MoveId.NATURAL_GIFT], [type]);
      expect(type.value).toBe(PokemonType.GRASS);

      const power = new NumberHolder(0);
      new ErNaturalGiftPowerAttr().apply(player, enemy, allMoves[MoveId.NATURAL_GIFT], [power]);
      expect(power.value).toBe(100);
    });

    it("a Sitrus berry gives a Psychic-type, 80-power hit and is ledgered for Harvest", async () => {
      game.override.startingHeldItems([{ name: "BERRY", type: BerryType.SITRUS }]);
      await game.classicMode.startBattle(SpeciesId.REGIROCK);
      const player = game.field.getPlayerPokemon();
      const enemy = game.field.getEnemyPokemon();

      const type = new NumberHolder(PokemonType.NORMAL);
      new ErNaturalGiftTypeAttr().apply(player, enemy, allMoves[MoveId.NATURAL_GIFT], [type]);
      expect(type.value).toBe(PokemonType.PSYCHIC);
      const power = new NumberHolder(0);
      new ErNaturalGiftPowerAttr().apply(player, enemy, allMoves[MoveId.NATURAL_GIFT], [power]);
      expect(power.value).toBe(80);

      game.move.select(MoveId.NATURAL_GIFT);
      await game.toEndOfTurn();
      expect(player.battleData.berriesEaten).toContain(BerryType.SITRUS);
    });
  });

  // ---------------------------------------------------------------------------
  // 4. Trick (271) — Sticky Hold on the USER fails the swap atomically
  // ---------------------------------------------------------------------------
  describe("Trick (271) — Sticky Hold atomicity", () => {
    it("fails entirely when the USER has Sticky Hold — no item moves", async () => {
      game.override
        .moveset([MoveId.TRICK])
        .ability(AbilityId.STICKY_HOLD)
        .startingHeldItems([{ name: "LEFTOVERS" }])
        .enemySpecies(SpeciesId.SNORLAX)
        .enemyMoveset(MoveId.SPLASH)
        .enemyHeldItems([{ name: "SOOTHE_BELL" }]);
      await game.classicMode.startBattle(SpeciesId.REGIROCK);
      const player = game.field.getPlayerPokemon();
      const enemy = game.field.getEnemyPokemon();

      expect(playerHoldsId("LEFTOVERS", player.id)).toBe(true);
      expect(enemyHoldsId("SOOTHE_BELL", enemy.id)).toBe(true);

      game.move.select(MoveId.TRICK);
      await game.toEndOfTurn();

      // Sticky Hold on the user makes the whole swap fail: both keep their items.
      expect(playerHoldsId("LEFTOVERS", player.id)).toBe(true);
      expect(enemyHoldsId("SOOTHE_BELL", enemy.id)).toBe(true);
      expect(playerHoldsId("SOOTHE_BELL", player.id)).toBe(false);
      expect(enemyHoldsId("LEFTOVERS", enemy.id)).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // 5. Unnerve (127) — a foe under Unnerve cannot consume its elemental Gem
  // ---------------------------------------------------------------------------
  describe("Unnerve (127) — elemental Gem suppression", () => {
    const giveEnemyNormalGem = async () => {
      const enemy = game.field.getEnemyPokemon();
      const gem = erGemItemType(PokemonType.NORMAL).newModifier(enemy) as PokemonHeldItemModifier;
      await globalScene.addEnemyModifier(gem, true, true);
      globalScene.updateModifiers(false);
      return enemy;
    };

    it("the foe KEEPS its Normal Gem while the player has Unnerve", async () => {
      game.override
        .moveset([MoveId.SPLASH])
        .ability(AbilityId.UNNERVE)
        .enemySpecies(SpeciesId.SNORLAX)
        .enemyMoveset([MoveId.TACKLE]); // Normal move → matches a Normal Gem
      await game.classicMode.startBattle(SpeciesId.REGIROCK);
      const enemy = await giveEnemyNormalGem();
      expect(enemy.getHeldItems().some(m => m.type?.id === "ER_NORMAL_GEM")).toBe(true);

      game.move.select(MoveId.SPLASH);
      await game.toEndOfTurn();
      // Suppressed: the enemy still holds its gem.
      expect(enemy.getHeldItems().some(m => m.type?.id === "ER_NORMAL_GEM")).toBe(true);
    });

    it("baseline — WITHOUT Unnerve the foe's Normal Gem shatters after a matching hit", async () => {
      game.override.moveset([MoveId.SPLASH]).enemySpecies(SpeciesId.SNORLAX).enemyMoveset([MoveId.TACKLE]);
      await game.classicMode.startBattle(SpeciesId.REGIROCK);
      const enemy = await giveEnemyNormalGem();
      expect(enemy.getHeldItems().some(m => m.type?.id === "ER_NORMAL_GEM")).toBe(true);

      game.move.select(MoveId.SPLASH);
      await game.toEndOfTurn();
      // No suppression: the gem was consumed.
      expect(enemy.getHeldItems().some(m => m.type?.id === "ER_NORMAL_GEM")).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // 6. Pursuit (228) — intercept a foe self-switching via a MOVE (U-turn)
  // ---------------------------------------------------------------------------
  // NB: the interception is SIDE-AGNOSTIC (forceMoveSwitchPursuers scans BOTH
  // sides). We drive it with the PLAYER self-switching (U-turn) and the ENEMY
  // holding Pursuit — the player's bench from startBattle is fully initialised,
  // so no half-built bench mon is summoned. The FAST player would U-turn (and
  // switch) FIRST; the reorder makes the SLOW enemy's Pursuit strike the player's
  // ORIGINAL mon before it leaves. The dex "foe uses U-turn, player uses Pursuit"
  // runs the identical code with the roles swapped.
  describe("Pursuit (228) — move-switch interception", () => {
    let baseline = 0;

    beforeEach(() => {
      game.override.enemyMoveset([MoveId.PURSUIT]).battleType(BattleType.TRAINER).enemySpecies(SpeciesId.MAGIKARP);
    });

    it("baseline — Pursuit vs a NON-switching mon", async () => {
      game.override.moveset([MoveId.SPLASH]);
      await game.classicMode.startBattle(SpeciesId.REGIELEKI, SpeciesId.MAGIKARP);
      const player0 = game.field.getPlayerPokemon();
      game.move.select(MoveId.SPLASH);
      await game.move.selectEnemyMove(MoveId.PURSUIT);
      await game.toEndOfTurn();
      baseline = player0.getInverseHp();
      expect(baseline).toBeGreaterThan(0);
    });

    it("Pursuit strikes a U-turn user at ~2x, before it self-switches", async () => {
      game.override.moveset([MoveId.U_TURN]);
      await game.classicMode.startBattle(SpeciesId.REGIELEKI, SpeciesId.MAGIKARP);
      const player0 = game.field.getPlayerPokemon();

      game.move.select(MoveId.U_TURN);
      game.doSelectPartyPokemon(1); // bench mon to switch into
      await game.move.selectEnemyMove(MoveId.PURSUIT);
      await game.toEndOfTurn();

      // The U-turn user self-switched (SwitchSummonPhase ran) but Pursuit already
      // struck the ORIGINAL mon at roughly double before it left the field.
      expect(game.phaseInterceptor.log).toContain("SwitchSummonPhase");
      const uturnStrike = player0.getInverseHp();
      expect(baseline).toBeGreaterThan(0);
      expect(uturnStrike).toBeGreaterThan(baseline * 1.7);
    });
  });
});

/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// ER ability-popup display — a triggered ability must FLASH its name banner.
//
// Maintainer report (Mega Lucario Z): the ability popup that announces an
// activating ability never appears for Ultra Instinct (the Deflect / counter
// mechanic) or for Berserk, even though their EFFECTS fire. Root cause: an
// archetype AbAttr that performs a discrete, player-visible triggered action
// was constructed with `showAbility = false`, so `applySingleAbAttrs` skips the
// `queueAbilityDisplay(...)` bracket. Continuous/passive modifiers (damage
// multipliers, type-chart, priority) correctly stay silent — only the discrete
// triggered effects must announce themselves, matching vanilla convention.
//
// These tests assert BOTH the effect AND the popup (via a queueAbilityDisplay
// spy filtered to the holder). Gated behind ER_SCENARIO=1.
// =============================================================================

import { CounterAttackOnHitAbAttr } from "#data/elite-redux/archetypes/counter-attack-on-hit";
import {
  FireHitFormChangeAbAttr,
  FireUseFormChangeAbAttr,
} from "#data/elite-redux/archetypes/fire-interaction-form-change";
import { HpThresholdFormChangeAbAttr } from "#data/elite-redux/archetypes/hp-threshold-form-change";
import { IgnoreResistancesAbAttr } from "#data/elite-redux/archetypes/offensive-type-chart-override";
import { PostItemLostScriptedMoveAbAttr } from "#data/elite-redux/archetypes/post-item-lost-scripted-move";
import { PostSummonScriptedMoveAbAttr } from "#data/elite-redux/archetypes/post-summon-scripted-move";
import { PostWeatherMoveFollowUpAbAttr } from "#data/elite-redux/archetypes/post-weather-move-follow-up";
import { SetFogOnHitAbAttr } from "#data/elite-redux/archetypes/set-fog-on-hit";
import { AbilityId } from "#enums/ability-id";
import { ErAbilityId } from "#enums/er-ability-id";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { Stat } from "#enums/stat";
import type { Pokemon } from "#field/pokemon";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

describe("ER ability popup — showAbility flag on discrete-triggered archetypes", () => {
  // Every archetype AbAttr that performs a discrete, player-visible triggered
  // effect (fires a move / sets weather / changes form) must default
  // showAbility = true so `applySingleAbAttrs` queues the ability banner.
  it("triggered-effect archetypes announce themselves (showAbility === true)", () => {
    expect(new CounterAttackOnHitAbAttr({ moveId: MoveId.VACUUM_WAVE }).showAbility).toBe(true);
    expect(new PostSummonScriptedMoveAbAttr({ moveId: MoveId.ICY_WIND }).showAbility).toBe(true);
    expect(new PostItemLostScriptedMoveAbAttr({ moveId: MoveId.TACKLE }).showAbility).toBe(true);
    expect(new PostWeatherMoveFollowUpAbAttr(MoveId.TACKLE).showAbility).toBe(true);
    expect(new SetFogOnHitAbAttr().showAbility).toBe(true);
    expect(new FireUseFormChangeAbAttr("mega").showAbility).toBe(true);
    expect(new FireHitFormChangeAbAttr("mega").showAbility).toBe(true);
    expect(new HpThresholdFormChangeAbAttr({ hpThreshold: 0.5, targetFormKey: "mega" }).showAbility).toBe(true);
  });

  it("continuous/passive modifiers stay silent (showAbility === false) — no over-flip", () => {
    // Control: a continuous damage-calc modifier must NOT flash a banner.
    expect(new IgnoreResistancesAbAttr().showAbility).toBe(false);
  });
});

/**
 * Spy the ability-display queue and report whether the HOLDER's popup was
 * requested to SHOW (show === true) at least once during the turn.
 */
function watchHolderPopup(game: GameManager, holder: Pokemon): () => boolean {
  const pm = game.scene.phaseManager;
  const spy = vi.spyOn(pm, "queueAbilityDisplay");
  return () => spy.mock.calls.some(call => call[0] === holder && call[2] === true);
}

describe.skipIf(!RUN)("ER ability popup — triggered abilities flash their banner", () => {
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
      .enemySpecies(SpeciesId.SNORLAX)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemyMoveset(MoveId.TACKLE)
      .enemyLevel(100)
      .startingLevel(100);
  });

  it("Ultra Instinct / Deflect — the counter fires AND the popup shows", async () => {
    // Deflect (er-1022 → ErAbilityId.DEFLECT): "Counters with 20BP Vacuum Wave
    // when hit. Takes 20% less damage." The Vacuum Wave counter is the
    // "Ultra Instinct" mechanic the maintainer named.
    game.override.ability(ErAbilityId.DEFLECT as unknown as AbilityId);
    await game.classicMode.startBattle(SpeciesId.LUCARIO);

    const player = game.field.getPlayerPokemon();
    const enemy = game.field.getEnemyPokemon();
    const enemyHpBefore = enemy.hp;
    const holderPopupShown = watchHolderPopup(game, player);

    game.move.use(MoveId.SPLASH); // player idles; enemy Tackles (contact) into Deflect
    await game.toEndOfTurn();

    // Effect: the Vacuum Wave counter chipped the enemy.
    expect(enemy.hp).toBeLessThan(enemyHpBefore);
    // Popup: the ability banner flashed for the holder.
    expect(holderPopupShown()).toBe(true);
  });

  it("Berserk — the stat boost applies AND the popup shows", async () => {
    // Vanilla Berserk is rewired to BerserkOnThresholdAbAttr: crossing 50% HP
    // from a damaging hit sharply(? +1) raises the highest attacking stat.
    game.override.ability(AbilityId.BERSERK);
    await game.classicMode.startBattle(SpeciesId.SNORLAX);

    const player = game.field.getPlayerPokemon();
    // Park HP just above the half threshold so the incoming Tackle crosses it.
    const threshold = Math.floor(player.getMaxHp() / 2);
    player.hp = threshold + 1;
    expect(player.getStatStage(Stat.SPATK)).toBe(0);
    expect(player.getStatStage(Stat.ATK)).toBe(0);
    const holderPopupShown = watchHolderPopup(game, player);

    game.move.use(MoveId.SPLASH);
    await game.toEndOfTurn();

    // Effect: highest attacking stat rose by +1.
    const boosted = player.getStatStage(Stat.ATK) === 1 || player.getStatStage(Stat.SPATK) === 1;
    expect(boosted).toBe(true);
    // Popup: the ability banner flashed for the holder.
    expect(holderPopupShown()).toBe(true);
  });

  it("Deflect as an INNATE (passive) — the counter fires AND the passive popup shows", async () => {
    // On Mega Lucario Z the counter is an INNATE (passive), so verify the popup
    // fires through the passive display path too, not just as an active ability.
    game.override.ability(AbilityId.BALL_FETCH).passiveAbility(ErAbilityId.DEFLECT as unknown as AbilityId);
    await game.classicMode.startBattle(SpeciesId.LUCARIO);

    const player = game.field.getPlayerPokemon();
    const enemy = game.field.getEnemyPokemon();
    const enemyHpBefore = enemy.hp;
    const holderPopupShown = watchHolderPopup(game, player);

    game.move.use(MoveId.SPLASH);
    await game.toEndOfTurn();

    expect(enemy.hp).toBeLessThan(enemyHpBefore);
    expect(holderPopupShown()).toBe(true);
  });
});

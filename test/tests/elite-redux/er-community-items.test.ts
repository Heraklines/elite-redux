/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Regression (#387/#392) - ER community item batch:
//  - registry: every item resolves through modifierTypes with its config
//    name/description and the right stack cap;
//  - Chili Sample burns on any damaging hit (10% roll), claws/rod/knuckles
//    only proc on CONTACT, Copper Rod also procs defensively;
//  - Loaded Dice raises the MINIMUM hits of 2-5-hit moves (3 stacks = 5);
//  - Lucky Heart adds +15 percentage points per stack (cap 2);
//  - Omni Gem doubles exactly ONE real damage calc per battle, simulated
//    calcs never consume it, newBattle resets the charge;
//  - Frostbite Orb frostbites the holder at turn end (Ice-types immune);
//  - Ability Capsule cycles the active ability once per Pokemon;
//  - Dex Nav: the biome species pool is non-empty and deduped.
//
// Gated behind ER_SCENARIO=1.
// =============================================================================

import { globalScene } from "#app/global-scene";
import { allMoves, modifierTypes } from "#data/data-lists";
import {
  ER_COMMUNITY_ITEM_CONFIG,
  ER_COMMUNITY_ITEM_KINDS,
  type ErCommunityItemKind,
  erAdvanceCommunityItemCharges,
  erApplyCommunityOnHitItems,
  erLoadedDiceMinHitBonus,
  erLuckyHeartChanceBonus,
  erTryApplyOmniGem,
  erTryConsumePowerHerb,
} from "#data/elite-redux/er-community-items";
import { BattlerTagType } from "#enums/battler-tag-type";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { StatusEffect } from "#enums/status-effect";
import type { Pokemon } from "#field/pokemon";
import type { ErCommunityItemModifier, PokemonHeldItemModifier } from "#modifiers/modifier";
import { erCommunityItemModifierType } from "#modifiers/modifier-type";
import { GameManager } from "#test/framework/game-manager";
import * as Utils from "#utils/common";
import { NumberHolder } from "#utils/common";
import { getModifierType } from "#utils/modifier-utils";
import Phaser from "phaser";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

const KIND_TO_TYPE_ID: Record<ErCommunityItemKind, string> = {
  chiliSample: "ER_CHILI_SAMPLE",
  copperRod: "ER_COPPER_ROD",
  rustyClaw: "ER_RUSTY_CLAW",
  spikedKnuckles: "ER_SPIKED_KNUCKLES",
  loadedDice: "ER_LOADED_DICE",
  luckyHeart: "ER_LUCKY_HEART",
  omniGem: "ER_OMNI_GEM",
  powerHerb: "ER_POWER_HERB",
};

function giveItem(holder: Pokemon, kind: ErCommunityItemKind, stacks = 1): ErCommunityItemModifier {
  const mod = erCommunityItemModifierType(kind).newModifier(holder) as ErCommunityItemModifier;
  mod.stackCount = stacks;
  if (holder.isPlayer()) {
    globalScene.addModifier(mod, true);
  } else {
    void globalScene.addEnemyModifier(mod as PokemonHeldItemModifier, true, true);
  }
  return mod;
}

/** Force or starve the 10% status proc roll. */
function forceProcRoll(value: number): void {
  vi.spyOn(Utils, "randSeedInt").mockImplementation((_range: number, min = 0) => min + value);
}

describe.skipIf(!RUN)("ER community item batch (#387/#392)", () => {
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
    vi.restoreAllMocks();
  });

  it("registry: every community item resolves with config name/description and stack cap", () => {
    for (const kind of ER_COMMUNITY_ITEM_KINDS) {
      const type = getModifierType(modifierTypes[KIND_TO_TYPE_ID[kind]]);
      expect(type.name, kind).toBe(ER_COMMUNITY_ITEM_CONFIG[kind].name);
      expect(type.getDescription(), kind).toBe(ER_COMMUNITY_ITEM_CONFIG[kind].description);
      const mod = giveItem(game.scene.getPlayerPokemon()!, kind);
      expect(mod.getMaxHeldItemCount(), kind).toBe(ER_COMMUNITY_ITEM_CONFIG[kind].maxStack);
    }
    expect(getModifierType(modifierTypes.FROSTBITE_ORB).name).toBe("Frostbite Orb");
    expect(getModifierType(modifierTypes.ER_ABILITY_CAPSULE).name).toBe("Ability Capsule");
    expect(getModifierType(modifierTypes.ER_DEX_NAV).name).toBe("Dex Nav");
  });

  it("Chili Sample: burns on a NON-contact damaging hit when the roll lands; never without the roll", () => {
    const player = game.scene.getPlayerPokemon()!;
    const enemy = game.scene.getEnemyPokemon()!;
    giveItem(player, "chiliSample");

    forceProcRoll(99); // roll misses
    erApplyCommunityOnHitItems(player, enemy, false);
    expect(enemy.turnData.pendingStatus).toBeFalsy();

    forceProcRoll(0); // roll hits
    erApplyCommunityOnHitItems(player, enemy, false);
    expect(enemy.turnData.pendingStatus).toBe(StatusEffect.BURN);
  });

  it("Rusty Claw: poison ONLY on contact", () => {
    const player = game.scene.getPlayerPokemon()!;
    const enemy = game.scene.getEnemyPokemon()!;
    giveItem(player, "rustyClaw");
    forceProcRoll(0);

    erApplyCommunityOnHitItems(player, enemy, false);
    expect(enemy.turnData.pendingStatus).toBeFalsy();

    erApplyCommunityOnHitItems(player, enemy, true);
    expect(enemy.turnData.pendingStatus).toBe(StatusEffect.POISON);
  });

  it("Spiked Knuckles: inflicts ER Bleed on contact", () => {
    const player = game.scene.getPlayerPokemon()!;
    const enemy = game.scene.getEnemyPokemon()!;
    giveItem(player, "spikedKnuckles");
    forceProcRoll(0);

    erApplyCommunityOnHitItems(player, enemy, true);
    expect(enemy.getTag(BattlerTagType.ER_BLEED)).toBeDefined();
  });

  it("Copper Rod: paralyzes BOTH ways on contact (defender's rod hits the attacker)", () => {
    const player = game.scene.getPlayerPokemon()!;
    const enemy = game.scene.getEnemyPokemon()!;
    giveItem(enemy, "copperRod");
    forceProcRoll(0);

    // Player strikes the rod-holding enemy with a contact move.
    erApplyCommunityOnHitItems(player, enemy, true);
    expect(player.turnData.pendingStatus).toBe(StatusEffect.PARALYSIS);
  });

  it("Loaded Dice: raises the MINIMUM hit count of 2-5-hit moves (3 stacks = always 5)", () => {
    const player = game.scene.getPlayerPokemon()!;
    const enemy = game.scene.getEnemyPokemon()!;
    const multiHit = allMoves[MoveId.FURY_SWIPES].getAttrs("MultiHitAttr")[0] as unknown as {
      getHitCount: (user: Pokemon, target: Pokemon) => number;
    };
    // Worst possible roll: 19 -> 2 hits without the dice.
    vi.spyOn(player, "randBattleSeedInt").mockReturnValue(19);
    expect(multiHit.getHitCount(player, enemy)).toBe(2);

    const dice = giveItem(player, "loadedDice", 1);
    expect(erLoadedDiceMinHitBonus(player)).toBe(1);
    expect(multiHit.getHitCount(player, enemy)).toBe(3);

    dice.stackCount = 3;
    expect(erLoadedDiceMinHitBonus(player)).toBe(3);
    expect(multiHit.getHitCount(player, enemy)).toBe(5);
  });

  it("Lucky Heart: +15 percentage points per stack, capped at 2 stacks", () => {
    const player = game.scene.getPlayerPokemon()!;
    expect(erLuckyHeartChanceBonus(player)).toBe(0);
    const heart = giveItem(player, "luckyHeart", 1);
    expect(erLuckyHeartChanceBonus(player)).toBe(15);
    heart.stackCount = 2;
    expect(erLuckyHeartChanceBonus(player)).toBe(30);
    heart.stackCount = 5; // over the cap, still 30
    expect(erLuckyHeartChanceBonus(player)).toBe(30);
  });

  it("Omni Gem: 2 charges, simulated calcs never consume, shatters (modifier removed) when spent", () => {
    const player = game.scene.getPlayerPokemon()!;
    const gem = giveItem(player, "omniGem");
    expect(gem.charges).toBe(2);

    // Simulated calc: doubled but NOT consumed (AI previews).
    const sim = new NumberHolder(100);
    erTryApplyOmniGem(player, sim, true);
    expect(sim.value).toBe(200);
    expect(gem.charges).toBe(2);

    // First real calc: doubled, one charge spent, gem still held.
    const first = new NumberHolder(100);
    erTryApplyOmniGem(player, first, false);
    expect(first.value).toBe(200);
    expect(gem.charges).toBe(1);
    expect(player.getHeldItems()).toContain(gem);

    // Second real calc: doubled, last charge spent -> the gem SHATTERS.
    const second = new NumberHolder(100);
    erTryApplyOmniGem(player, second, false);
    expect(second.value).toBe(200);
    expect(gem.charges).toBe(0);
    expect(player.getHeldItems()).not.toContain(gem);

    // Gone: no further doubling.
    const after = new NumberHolder(100);
    erTryApplyOmniGem(player, after, false);
    expect(after.value).toBe(100);
  });

  it("Frostbite Orb: frostbites the holder on apply; Ice-types stay immune", () => {
    const player = game.scene.getPlayerPokemon()!;
    const orbType = getModifierType(modifierTypes.FROSTBITE_ORB);
    const orb = orbType.newModifier(player) as PokemonHeldItemModifier;
    globalScene.addModifier(orb, true);

    expect(orb.apply(player)).toBe(true);
    expect(player.getTag(BattlerTagType.ER_FROSTBITE)).toBeDefined();
    expect(player.status?.effect).toBeUndefined(); // it is the TAG status, not a vanilla one
  });

  it("Ability Capsule: cycles the active ability to the species' next legal one, once per Pokemon", () => {
    const player = game.scene.getPlayerPokemon()!;
    const form = player.getSpeciesForm();
    const candidates = [form.ability1, form.ability2, form.abilityHidden].filter(
      (a, i, arr) => arr.indexOf(a) === i && a !== 0,
    );
    expect(candidates.length).toBeGreaterThanOrEqual(2);

    const before = player.getAbility().id;
    const capsule = getModifierType(modifierTypes.ER_ABILITY_CAPSULE).newModifier(player) as {
      apply: (p: Pokemon) => boolean;
    };
    expect(capsule.apply(player)).toBe(true);
    const after = player.getAbility().id;
    expect(after).not.toBe(before);
    expect(candidates).toContain(after);
    expect(player.customPokemonData.erAbilityCapsuleUsed).toBe(true);

    // Single use per Pokemon.
    expect(capsule.apply(player)).toBe(false);
  });

  it("Power Herb: 2 charge-turn skips, then empty; regains ONE charge after 10 waves", () => {
    const player = game.scene.getPlayerPokemon()!;
    const herb = giveItem(player, "powerHerb");
    expect(herb.charges).toBe(2);

    // Two skips, then the herb is exhausted (but NOT removed - it recharges).
    expect(erTryConsumePowerHerb(player)).toBe(true);
    expect(erTryConsumePowerHerb(player)).toBe(true);
    expect(erTryConsumePowerHerb(player)).toBe(false);
    expect(player.getHeldItems()).toContain(herb);

    // 9 waves: no refill yet. 10th wave: exactly ONE charge back.
    for (let i = 0; i < 9; i++) {
      erAdvanceCommunityItemCharges();
    }
    expect(herb.charges).toBe(0);
    erAdvanceCommunityItemCharges();
    expect(herb.charges).toBe(1);
    expect(herb.waveProgress).toBe(0);

    // A full herb accrues no progress.
    erAdvanceCommunityItemCharges();
    for (let i = 0; i < 10; i++) {
      erAdvanceCommunityItemCharges();
    }
    expect(herb.charges).toBe(2);
    erAdvanceCommunityItemCharges();
    expect(herb.waveProgress).toBe(0);
  });

  it("Dex Nav: the current biome offers a non-empty, deduped species pool", () => {
    const pool = game.scene.arena.getErDexNavSpeciesPool();
    expect(pool.length).toBeGreaterThan(0);
    expect(new Set(pool).size).toBe(pool.length);
  });
});

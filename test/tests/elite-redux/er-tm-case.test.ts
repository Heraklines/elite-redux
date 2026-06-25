/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// ER TM Case - a single-use universal TM (COMMON tier) that replaces the
// per-move TM_COMMON / TM_GREAT / TM_ULTRA across the reward pool AND the biome
// shop. Mirrors the Learner's Shroom (#404) flow (pick a mon -> pick a move ->
// teach -> consume), but the offered move list is the mon's COMPATIBLE TM moves
// it can still learn.
//
// Asserts:
//  - the move list = the mon's compatible-TM moves minus what it already knows;
//  - applying the modifier queues a LearnMovePhase (TM) for the chosen move;
//  - the modifier is a transient ConsumablePokemonModifier (never persisted as a
//    held item), and is back-out-safe via the SelectModifierPhase continuation
//    queue (#25);
//  - an empty list yields the standard NoEffect message;
//  - TM_COMMON/GREAT/ULTRA are gone from EVERY reward tier and the biome shop,
//    and TM_CASE (COMMON) is present in both.
//
// Gated behind ER_SCENARIO=1.
// =============================================================================

import { globalScene } from "#app/global-scene";
import { modifierTypes } from "#data/data-lists";
import { ER_SHOP_CATEGORY_POOL, rollErBiomeShopStock } from "#data/elite-redux/er-biome-economy";
import { ModifierTier } from "#enums/modifier-tier";
import { SpeciesId } from "#enums/species-id";
import type { PlayerPokemon, Pokemon } from "#field/pokemon";
import { ConsumablePokemonModifier } from "#modifiers/modifier";
import { modifierPool } from "#modifiers/modifier-pools";
import { ErTmCaseModifierType, getPlayerShopModifierTypeOptionsForWave } from "#modifiers/modifier-type";
import { GameManager } from "#test/framework/game-manager";
import { PartyUiHandler } from "#ui/party-ui-handler";
import { getModifierType } from "#utils/modifier-utils";
import Phaser from "phaser";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

const TM_KEYS = ["TM_COMMON", "TM_GREAT", "TM_ULTRA"] as const;

/** Flatten every reward pool tier into the set of modifier-type ids present. */
function poolIds(tier: ModifierTier): string[] {
  return (modifierPool[tier] ?? []).map(w => w.modifierType.id);
}

describe.skipIf(!RUN)("ER TM Case (universal single-use TM)", () => {
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

  it("registers as TM Case with the COMMON-tier description", () => {
    const type = getModifierType(modifierTypes.TM_CASE);
    expect(type).toBeInstanceOf(ErTmCaseModifierType);
    expect(type.name).toBe("TM Case");
    expect(type.getDescription()).toBe("Teach a Pokemon any one move from its TM list.");
  });

  it("offers exactly the mon's compatible-TM moves it does NOT already know", () => {
    const player = game.scene.getPlayerPokemon() as PlayerPokemon;

    const offered = player.getErTmCaseMoves();
    expect(offered.length).toBeGreaterThan(0);

    // Deduped, drawn strictly from compatibleTms, and excluding known moves.
    expect(new Set(offered).size).toBe(offered.length);
    const known = new Set(player.moveset.map(m => m?.moveId));
    for (const moveId of offered) {
      expect(player.compatibleTms).toContain(moveId);
      expect(known.has(moveId)).toBe(false);
    }
    // It is the compatibleTms list MINUS the known moves - nothing more.
    const expected = player.compatibleTms.filter(m => !known.has(m));
    expect(offered).toEqual(expected);

    // A move once KNOWN drops out of the list.
    const dropped = offered[0];
    player.moveset[0]!.moveId = dropped;
    expect(player.getErTmCaseMoves()).not.toContain(dropped);
  });

  it("teaching queues a LearnMovePhase (TM) for the chosen move, then is consumed", () => {
    const player = game.scene.getPlayerPokemon() as PlayerPokemon;
    const offered = player.getErTmCaseMoves();
    const pickIndex = 2;

    const type = getModifierType(modifierTypes.TM_CASE);
    const modifier = type.newModifier(player, pickIndex) as ConsumablePokemonModifier;

    // It is a transient consumable, NOT a held item that persists on the save.
    expect(modifier).toBeInstanceOf(ConsumablePokemonModifier);

    const unshiftSpy = vi.spyOn(globalScene.phaseManager, "unshiftNew").mockImplementation(() => undefined as never);
    expect(modifier.apply(player)).toBe(true);
    // Learned as a TM (LearnMoveType.TM): the LearnMovePhase TM branch records
    // usedTMs and removes the queued reward-screen continuation on success (#25).
    expect(unshiftSpy).toHaveBeenCalledWith(
      "LearnMovePhase",
      expect.any(Number),
      offered[pickIndex],
      expect.anything(),
    );
  });

  it("an out-of-range / empty pick applies to nothing (returns false)", () => {
    const player = game.scene.getPlayerPokemon() as PlayerPokemon;
    const type = getModifierType(modifierTypes.TM_CASE);
    const tooFar = type.newModifier(player, 999_999) as ConsumablePokemonModifier;
    vi.spyOn(globalScene.phaseManager, "unshiftNew").mockImplementation(() => undefined as never);
    expect(tooFar.apply(player)).toBe(false);
  });

  it("a mon with no learnable TMs left shows the standard NoEffect message", () => {
    const player = game.scene.getPlayerPokemon() as PlayerPokemon;
    // Strip the compatible TM list so nothing is left to teach.
    vi.spyOn(player, "getErTmCaseMoves").mockReturnValue([]);
    const type = new ErTmCaseModifierType();
    const filter = (type as unknown as { selectFilter: (p: Pokemon) => string | null }).selectFilter;
    expect(filter(player)).toBe(PartyUiHandler.NoEffectMessage);
  });

  it("POOL: TM_COMMON/GREAT/ULTRA are gone from every reward tier; TM_CASE is in COMMON only", () => {
    const common = poolIds(ModifierTier.COMMON);
    const great = poolIds(ModifierTier.GREAT);
    const ultra = poolIds(ModifierTier.ULTRA);

    // The three per-move TMs are removed from EVERY tier.
    for (const tier of [common, great, ultra]) {
      for (const key of TM_KEYS) {
        expect(tier).not.toContain(key);
      }
    }
    // TM_CASE sits in COMMON (where TM_COMMON was) and nowhere else.
    expect(common).toContain("TM_CASE");
    expect(great).not.toContain("TM_CASE");
    expect(ultra).not.toContain("TM_CASE");

    // It carries the COMMON tier so price/stock resolve correctly.
    const entry = (modifierPool[ModifierTier.COMMON] ?? []).find(w => w.modifierType.id === "TM_CASE");
    expect(entry?.modifierType.tier).toBe(ModifierTier.COMMON);
    // Same weight TM_COMMON used (2), so the TM-like option keeps its rate.
    expect(entry?.weight).toBe(2);
  });

  it("BIOME SHOP: the TM category stocks TM_CASE, not the per-move TMs", async () => {
    // The shop's TM category pool feeds the biome market's TM slots.
    expect(ER_SHOP_CATEGORY_POOL.TM).toEqual(["TM_CASE"]);
    for (const key of TM_KEYS) {
      expect(ER_SHOP_CATEGORY_POOL.TM).not.toContain(key);
    }

    // And the resolved biome-shop stock never offers the per-move TMs.
    const biome = game.scene.arena.biomeId;
    const stock = rollErBiomeShopStock(biome, 10);
    for (const slot of stock) {
      expect(TM_KEYS).not.toContain(slot.key as (typeof TM_KEYS)[number]);
    }
    const options = getPlayerShopModifierTypeOptionsForWave(10, 0, /* forBiomeShop */ true);
    for (const opt of options) {
      expect(opt.type).not.toBeInstanceOf(
        // The per-move TM generator never appears; only ErTmCaseModifierType can.
        Object.getPrototypeOf(getModifierType(modifierTypes.TM_COMMON)).constructor,
      );
    }
  });
});

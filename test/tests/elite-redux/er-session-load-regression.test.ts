/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// P0 session-load regression (deploy-13 "existing saves fail to load /
// session corrupted and cannot be loaded").
//
// Two independent failure modes, both hardened so a save is NEVER reported
// corrupted because ONE lookup is missing:
//
//   A) A party/enemyParty entry whose `species` no longer resolves via
//      getPokemonSpecies makes the PokemonData ctor throw
//      `Cannot read properties of undefined (reading 'forms')`. That threw out
//      of the JSON.parse reviver and aborted the ENTIRE session parse. Now the
//      bad mon is skipped (logged) and the rest of the session still loads.
//
//   B) The save-slot PREVIEW reconstructed each modifier via the bare
//      `Modifier[className]` lookup, which is undefined for ER custom held-item
//      classes (ErGemModifier / ErSeedModifier / ...) -> toModifier hit
//      `Reflect.construct(undefined, ...)` = "undefined is not a constructor".
//      The preview now uses the same `resolveErModifierClass` fallback the live
//      load path uses, so ER items resolve instead of erroring.
//
// Gated behind ER_SCENARIO=1.
// =============================================================================

import { ErGemModifier, erGemItemType } from "#data/elite-redux/er-elemental-gems";
import { ER_PARTNER_FAMILY, ER_REGITUBE_SPECIES_ID } from "#data/elite-redux/er-newcomer-species";
import { resolveErModifierClass } from "#data/elite-redux/er-persistent-modifiers";
import { PokemonType } from "#enums/pokemon-type";
import { SpeciesId } from "#enums/species-id";
import * as Modifier from "#modifiers/modifier";
import { ModifierData } from "#system/modifier-data";
import { GameManager } from "#test/framework/game-manager";
import { getPokemonSpecies } from "#utils/pokemon-utils";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

describe.skipIf(!RUN)("ER P0 session-load regression", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
  });

  it("A: an unregistered party species does NOT abort the whole parse (mon dropped, session loads)", async () => {
    await game.classicMode.startBattle(SpeciesId.MAGIKARP);
    const save = game.scene.gameData.getSessionSaveData();
    const json = JSON.parse(JSON.stringify(save)) as any;
    // A species id that no longer resolves via getPokemonSpecies (the live
    // "session corrupted" symptom). Registered newcomer ids still load fine.
    json.party.unshift(JSON.parse(JSON.stringify(json.party[0])));
    json.party[0].species = 799999;
    const originalCount = json.party.length;

    let parsed: any;
    expect(() => {
      parsed = game.scene.gameData.parseSessionData(JSON.stringify(json));
    }).not.toThrow();
    // The bad mon is dropped; every resolvable mon survives.
    expect(parsed.party.length).toBe(originalCount - 1);
    expect(parsed.party.every((p: any) => getPokemonSpecies(p.species))).toBe(true);
  });

  it("C: a NON-ARRAY container field does NOT abort the parse (coerced to empty, session loads)", async () => {
    // Track R cycle-11 dirty lane (run 29654429335): a fresh/dirty account's slot-4 remnant carried
    // a non-array `modifiers` (a bare number). `for (const md of modifiers ?? [])` only substitutes on
    // null/undefined, so a truthy non-array fell into for..of and threw the cryptic
    // "(t ?? []) is not iterable", aborting the ENTIRE session parse. On TitlePhase that surfaced as a
    // fatal-looking console error. The reviver now fails SOFT per container (coerce non-array -> []).
    await game.classicMode.startBattle(SpeciesId.MAGIKARP);
    const save = game.scene.gameData.getSessionSaveData();
    const json = JSON.parse(JSON.stringify(save)) as any;
    // The exact live corruption shape, plus the sibling array containers, as non-arrays.
    json.modifiers = 7;
    json.enemyModifiers = { not: "an array" };
    json.enemyParty = 0;
    json.challenges = "corrupt";

    let parsed: any;
    expect(() => {
      parsed = game.scene.gameData.parseSessionData(JSON.stringify(json));
    }).not.toThrow();
    // Each non-array container coerces to an empty array; the rest of the session still loads.
    expect(Array.isArray(parsed.modifiers)).toBe(true);
    expect(parsed.modifiers.length).toBe(0);
    expect(Array.isArray(parsed.enemyModifiers)).toBe(true);
    expect(parsed.enemyModifiers.length).toBe(0);
    expect(Array.isArray(parsed.enemyParty)).toBe(true);
    expect(parsed.enemyParty.length).toBe(0);
    expect(Array.isArray(parsed.challenges)).toBe(true);
    expect(parsed.challenges.length).toBe(0);
    // The valid party container is untouched.
    expect(parsed.party.length).toBe(json.party.length);
  });

  it("A: registered newcomer species (partner eeveelution + Regitube) still round-trip", async () => {
    await game.classicMode.startBattle(SpeciesId.MAGIKARP);
    const save = game.scene.gameData.getSessionSaveData();
    const json = JSON.parse(JSON.stringify(save)) as any;
    json.party[0].species = ER_PARTNER_FAMILY[0].partnerId;
    if (json.party[1]) {
      json.party[1].species = ER_REGITUBE_SPECIES_ID;
    }
    let parsed: any;
    expect(() => {
      parsed = game.scene.gameData.parseSessionData(JSON.stringify(json));
    }).not.toThrow();
    expect(parsed.party[0].species).toBe(ER_PARTNER_FAMILY[0].partnerId);
  });

  it("B: an ER custom held-item class reconstructs via the save-slot preview resolver", async () => {
    await game.classicMode.startBattle(SpeciesId.MAGIKARP);
    // Build a real ER gem modifier on a live party mon, serialize it the way a
    // save does, then reconstruct it through the SAME resolver the save-slot
    // preview now uses (Modifier[className] ?? resolveErModifierClass).
    const holder = game.scene.getPlayerParty()[0];
    const gemModifier = new ErGemModifier(erGemItemType(PokemonType.FIRE), holder.id, PokemonType.FIRE);
    const data = new ModifierData(gemModifier, true);
    expect(data.className).toBe("ErGemModifier");

    // The bare vanilla lookup misses ER classes -> undefined ctor was crash B.
    expect((Modifier as Record<string, unknown>)[data.className]).toBeUndefined();
    // The preview's resolver resolves it to the real class.
    const ctor = (Modifier as Record<string, unknown>)[data.className] ?? resolveErModifierClass(data.className);
    expect(ctor).toBe(ErGemModifier);
    const rebuilt = data.toModifier(ctor);
    expect(rebuilt).not.toBeNull();
    expect(rebuilt).toBeInstanceOf(ErGemModifier);
  });
});

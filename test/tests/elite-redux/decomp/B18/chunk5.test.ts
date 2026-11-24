/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B18 chunk 5 probes: what the shared L1 and L2 suites cannot see.
//  - AbilityStudioSourceAbilityAbAttr (42 users, a marker the game reads through hasAbility): the pick list is exactly the game's list of
//    identity-checked abilities, a rebuild of every user carries the same id and texts and answers the same "does this ability reference X"
//    question, the restriction to a trigger works the same on the original and on the rebuild, and Pokemon.hasAbility sees the marker.
import { allAbilities } from "#data/data-lists";
import { buildAttr, readDeclParams, recomposeAttr } from "#data/elite-redux/ability-studio/build-attr";
import {
  SOURCE_ABILITY_PICKS,
  shownNameCodec,
  sourceAbilityCodec,
} from "#data/elite-redux/ability-studio/decl/B18/b18-chunk5-codecs";
import { declRegistry } from "#data/elite-redux/ability-studio/decl-registry";
import { abilityStudioAbilityReferencesSource } from "#data/elite-redux/ability-studio/runtime-capabilities";
import {
  ABILITY_STUDIO_DIRECT_SOURCE_ABILITY_IDS,
  AbilityStudioSourceAbilityAbAttr,
} from "#data/elite-redux/ability-studio/runtime-components";
import { AbilityId } from "#enums/ability-id";
import { freshGame, startWorld } from "#test/tests/elite-redux/decomp/harness/game";
import { allAttrSites } from "#test/tests/elite-redux/decomp/harness/sites";
import Phaser from "phaser";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

const CLASS_NAME = "AbilityStudioSourceAbilityAbAttr";

function rebuild(attr: AbilityStudioSourceAbilityAbAttr, abilityId: number, attrIndex: number) {
  return recomposeAttr(
    declRegistry.get(CLASS_NAME)!,
    attr,
    abilityId,
    attrIndex,
    {},
  ) as AbilityStudioSourceAbilityAbAttr;
}

describe("B18 chunk 5", () => {
  let phaserGame: Phaser.Game;
  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("AbilityStudioSourceAbilityAbAttr (42 users)", () => {
    it("the pick list is exactly the game's list of identity-checked abilities, one unique name each", () => {
      expect(SOURCE_ABILITY_PICKS.map(pick => pick.id).sort((a, b) => a - b)).toEqual(
        [...ABILITY_STUDIO_DIRECT_SOURCE_ABILITY_IDS].sort((a, b) => a - b),
      );
      expect(new Set(SOURCE_ABILITY_PICKS.map(pick => pick.word)).size).toBe(SOURCE_ABILITY_PICKS.length);
      expect(SOURCE_ABILITY_PICKS).toHaveLength(40);
    });

    it("every pick word is the ability's own name in the game, and the codecs read back what they write", async () => {
      await startWorld(phaserGame);
      for (const pick of SOURCE_ABILITY_PICKS) {
        expect(allAbilities[pick.id].name, `ability ${pick.id}`).toBe(pick.word);
        expect(sourceAbilityCodec.toCtor(pick.word)).toBe(pick.id);
        expect(sourceAbilityCodec.fromInstance(pick.id)).toBe(pick.word);
      }
      expect(() => sourceAbilityCodec.toCtor("Blaze")).toThrow(/not one of the abilities/);
      expect(sourceAbilityCodec.fromInstance(AbilityId.BLAZE)).toBeUndefined();
      expect(shownNameCodec.fromInstance("Guts linked runtime behavior")).toBe("Guts");
      expect(shownNameCodec.fromInstance("something else")).toBeUndefined();
    });

    it("every pick builds the attr the constructor expects, with both texts, and reads back", () => {
      const module = declRegistry.get(CLASS_NAME)!;
      for (const pick of SOURCE_ABILITY_PICKS) {
        const attr = buildAttr(module, { source: pick.word, shownName: pick.word }) as AbilityStudioSourceAbilityAbAttr;
        expect(attr.abilityStudioSourceAbilityId).toBe(pick.id);
        expect(attr.componentLabel).toBe(`${pick.word} linked runtime behavior`);
        expect(attr.componentHookLabel).toBe(`Whenever a game system checks for ${pick.word}`);
        expect(attr.componentHookId).toBe("source-ability-runtime-check");
        expect(attr.showAbility).toBe(false);
        expect(readDeclParams(module, attr)).toEqual({ source: pick.word, shownName: pick.word });
      }
    });

    it("a rebuild of each of the 42 users carries the same id and texts and answers the same reference question", async () => {
      await startWorld(phaserGame);
      const sites = allAttrSites().filter(site => site.className === CLASS_NAME);
      expect(sites).toHaveLength(42);
      for (const site of sites) {
        const original = site.attr as AbilityStudioSourceAbilityAbAttr;
        const rebuilt = rebuild(original, site.abilityId, site.attrIndex);
        expect(rebuilt, site.abilityName).not.toBe(original);
        expect(rebuilt.abilityStudioSourceAbilityId, site.abilityName).toBe(original.abilityStudioSourceAbilityId);
        expect(rebuilt.componentLabel).toBe(original.componentLabel);
        expect(rebuilt.componentHookId).toBe(original.componentHookId);
        expect(rebuilt.componentHookLabel).toBe(original.componentHookLabel);
        expect(rebuilt.isActiveFor(undefined)).toBe(original.isActiveFor(undefined));
        const ability = { attrs: [rebuilt] } as never;
        expect(abilityStudioAbilityReferencesSource(ability, original.abilityStudioSourceAbilityId)).toBe(true);
        expect(abilityStudioAbilityReferencesSource(ability, AbilityId.BLAZE)).toBe(false);
      }
    });

    it("the two Aura copies (Dreadful Winds, Fairy Wings) carry the Dark Aura and Fairy Aura identity", async () => {
      await startWorld(phaserGame);
      const find = (abilityId: number) =>
        allAttrSites().find(site => site.className === CLASS_NAME && site.abilityId === abilityId)!;
      expect((find(20001).attr as AbilityStudioSourceAbilityAbAttr).abilityStudioSourceAbilityId).toBe(
        AbilityId.DARK_AURA,
      );
      expect((find(20013).attr as AbilityStudioSourceAbilityAbAttr).abilityStudioSourceAbilityId).toBe(
        AbilityId.FAIRY_AURA,
      );
      expect(rebuild(find(20001).attr as AbilityStudioSourceAbilityAbAttr, 20001, 2).abilityStudioSourceAbilityId).toBe(
        AbilityId.DARK_AURA,
      );
    });

    it("a trigger-restricted marker counts only for the Pokemon the trigger marked, original and rebuild alike", async () => {
      const game = freshGame(phaserGame);
      game.override.battleStyle("single").ability(AbilityId.LEVITATE).enemyAbility(AbilityId.LEVITATE);
      const { holder, foe } = await startWorld(phaserGame);
      const site = allAttrSites().find(candidate => candidate.className === CLASS_NAME && candidate.abilityId === 26)!;
      for (const source of [
        site.attr as AbilityStudioSourceAbilityAbAttr,
        rebuild(site.attr as never, 26, site.attrIndex),
      ]) {
        // A fresh copy keeps the shared live attr unrestricted for the other tests.
        const copy = rebuild(source, 26, site.attrIndex);
        expect(copy.isActiveFor(holder)).toBe(true);
        copy.restrictToTriggeredActivation();
        expect(copy.isActiveFor(holder)).toBe(false);
        expect(copy.isActiveFor(undefined)).toBe(false);
        copy.activateFor(holder);
        expect(copy.isActiveFor(holder)).toBe(true);
        expect(copy.isActiveFor(foe)).toBe(false);
      }
    });

    it("Pokemon.hasAbility answers yes for an ability that carries the marker and no for a different one", async () => {
      const { holder } = await startWorld(phaserGame);
      const levitate = allAbilities[AbilityId.LEVITATE];
      const marker = levitate.attrs.find(attr => attr instanceof AbilityStudioSourceAbilityAbAttr)!;
      expect(abilityStudioAbilityReferencesSource(levitate, AbilityId.LEVITATE, holder)).toBe(true);
      expect(abilityStudioAbilityReferencesSource(levitate, AbilityId.GUTS, holder)).toBe(false);
      // The marker is the one thing that makes this true for an ability with another id (the Aura copies).
      const copy = allAbilities[20001];
      expect(copy.id).not.toBe(AbilityId.DARK_AURA);
      expect(abilityStudioAbilityReferencesSource(copy, AbilityId.DARK_AURA, holder)).toBe(true);
      expect(marker).toBeInstanceOf(AbilityStudioSourceAbilityAbAttr);
    });
  });
});

/*
 * SPDX-FileCopyrightText: 2026 Pagefault Games
 * SPDX-FileContributor: Sisyphus
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { describe, expect, it } from "vitest";
import {
  ANIM_BY_TYPE_CATEGORY,
  MANUAL_OVERRIDES,
  MoveCategory,
  mapErSplitToCategory,
  mapErTypeToPokerogue,
  PokemonType,
  parseErIdMapMoves,
  parseErMoveIdEnum,
  pickVanillaAnimSlug,
  toKebabCase,
} from "./map-move-anims.mjs";

describe("map-move-anims — pure helpers", () => {
  describe("toKebabCase", () => {
    it("converts SCREAMING_SNAKE → kebab", () => {
      expect(toKebabCase("DRAIN_BRAIN")).toBe("drain-brain");
      expect(toKebabCase("OUTBURST")).toBe("outburst");
      expect(toKebabCase("AQUA_FANG")).toBe("aqua-fang");
    });

    it("collapses runs of underscores to a single dash", () => {
      expect(toKebabCase("FOO__BAR___BAZ")).toBe("foo-bar-baz");
    });
  });

  describe("mapErTypeToPokerogue", () => {
    it("maps ER type ordinals (0..17) to pokerogue PokemonType ordinals", () => {
      // ER 2 (Fire) → pokerogue FIRE (9) — non-trivial because the two enums disagree on ordering
      expect(mapErTypeToPokerogue(2)).toBe(PokemonType.FIRE);
      // ER 12 (Water) → pokerogue WATER (10)
      expect(mapErTypeToPokerogue(12)).toBe(PokemonType.WATER);
      // ER 16 (Ghost) → pokerogue GHOST (7)
      expect(mapErTypeToPokerogue(16)).toBe(PokemonType.GHOST);
      // ER 13 (Psychic) → pokerogue PSYCHIC (13) — coincidentally equal
      expect(mapErTypeToPokerogue(13)).toBe(PokemonType.PSYCHIC);
    });

    it("collapses ER's Mystery (18), None (19), and unknown to NORMAL", () => {
      expect(mapErTypeToPokerogue(18)).toBe(PokemonType.NORMAL);
      expect(mapErTypeToPokerogue(19)).toBe(PokemonType.NORMAL);
      expect(mapErTypeToPokerogue(999)).toBe(PokemonType.NORMAL);
    });

    it("maps ER 20 (Stellar) to STELLAR", () => {
      expect(mapErTypeToPokerogue(20)).toBe(PokemonType.STELLAR);
    });
  });

  describe("mapErSplitToCategory", () => {
    it("maps the three primary splits 1:1", () => {
      expect(mapErSplitToCategory(0)).toBe(MoveCategory.PHYSICAL);
      expect(mapErSplitToCategory(1)).toBe(MoveCategory.SPECIAL);
      expect(mapErSplitToCategory(2)).toBe(MoveCategory.STATUS);
    });

    it("collapses the ER-only splits (3..6) to PHYSICAL", () => {
      // USE_HIGHEST_OFFENSE/HITS_DEF/USE_HIGHEST_DAMAGE/HITS_SPDEF.
      // TODO(Phase C): when these get custom MoveAttr translations, refine.
      expect(mapErSplitToCategory(3)).toBe(MoveCategory.PHYSICAL);
      expect(mapErSplitToCategory(4)).toBe(MoveCategory.PHYSICAL);
      expect(mapErSplitToCategory(5)).toBe(MoveCategory.PHYSICAL);
      expect(mapErSplitToCategory(6)).toBe(MoveCategory.PHYSICAL);
    });
  });

  describe("pickVanillaAnimSlug", () => {
    it("respects manual overrides over the type-category table", () => {
      const r = pickVanillaAnimSlug({
        erEnumKey: "OUTBURST",
        pokemonType: PokemonType.NORMAL,
        category: MoveCategory.SPECIAL,
      });
      expect(r.source).toBe("manual");
      expect(r.slug).toBe(MANUAL_OVERRIDES.OUTBURST);
    });

    it("picks from the type-category table when no override exists", () => {
      const r = pickVanillaAnimSlug({
        erEnumKey: "AQUA_FANG",
        pokemonType: PokemonType.WATER,
        category: MoveCategory.PHYSICAL,
      });
      expect(r.source).toBe("type-category");
      expect(r.slug).toBe(ANIM_BY_TYPE_CATEGORY[`${PokemonType.WATER}|${MoveCategory.PHYSICAL}`]);
    });

    it("falls back to the generic category default when the type-category cell is missing", () => {
      // Deliberately invent a non-existent (type, category) — we use a key
      // that's NOT in ANIM_BY_TYPE_CATEGORY: type=99, category=0
      const r = pickVanillaAnimSlug({
        erEnumKey: "MADE_UP_MOVE",
        pokemonType: 99,
        category: MoveCategory.PHYSICAL,
      });
      expect(r.source).toBe("category-fallback");
      expect(r.slug).toBe("tackle");
    });
  });

  describe("parseErMoveIdEnum", () => {
    it("extracts every SCREAMING_KEY: number row from the ts source", () => {
      const source = `
        export const ErMoveId = {
          OUTBURST: 5004,
          AQUA_FANG: 5002,
          // a comment line that should not match
          PIXIE_BEAM: 5014,
        } as const;
      `;
      const out = parseErMoveIdEnum(source);
      expect(out).toMatchObject({ OUTBURST: 5004, AQUA_FANG: 5002, PIXIE_BEAM: 5014 });
    });
  });

  describe("parseErIdMapMoves", () => {
    it("extracts the moves block ignoring other top-level sections", () => {
      const source = `
        export const ER_ID_MAP: ErIdMap = {
          "species": {
            "1": 1,
            "999": 5500
          },
          "abilities": {
            "1": 1
          },
          "moves": {
            "1": 1,
            "760": 5004,
            "1031": 5186
          },
          "trainerClasses": {}
        };
      `;
      const out = parseErIdMapMoves(source);
      expect(out).toMatchObject({ 1: 1, 760: 5004, 1031: 5186 });
      // species/abilities sections must NOT bleed into the moves result.
      expect(out[999]).toBeUndefined();
    });
  });
});

import { SHOWDOWN_ITEM_POOL } from "#app/data/elite-redux/showdown/showdown-item-pool";
import { MEGA_STONE_ITEM } from "#app/data/elite-redux/showdown/showdown-team";
import { modifierTypes } from "#data/data-lists";
import { PokemonHeldItemModifierType } from "#modifiers/modifier-type";
import { describe, expect, it } from "vitest";

describe("SHOWDOWN_ITEM_POOL", () => {
  it("contains only real modifierTypes keys", () => {
    for (const key of SHOWDOWN_ITEM_POOL) {
      expect(modifierTypes[key], `unknown modifier key ${String(key)}`).toBeDefined();
    }
  });

  it("has no duplicates", () => {
    expect(new Set(SHOWDOWN_ITEM_POOL).size).toBe(SHOWDOWN_ITEM_POOL.length);
  });

  it("never collides with the mega-stone sentinel", () => {
    expect((SHOWDOWN_ITEM_POOL as readonly string[]).includes(MEGA_STONE_ITEM)).toBe(false);
  });

  // B7 item 2: every entry must instantiate to a CONCRETE held-item type (not a
  // ModifierTypeGenerator), because the wire applies the item by bare key via
  // `modifierTypes[key]().newModifier(pokemon)` - a generator yields null and the item
  // would silently vanish. This is the programmatic guarantee that the curated list stays
  // "all held battle items" and nothing non-held (or generator-keyed) sneaks in.
  it("every entry is a concrete PokemonHeldItemModifierType", () => {
    for (const key of SHOWDOWN_ITEM_POOL) {
      const type = modifierTypes[key]();
      expect(type, `${String(key)} did not instantiate`).toBeInstanceOf(PokemonHeldItemModifierType);
    }
  });

  it("includes the maintainer's named battle items (completeness)", () => {
    const expected = [
      "LEFTOVERS",
      "SHELL_BELL",
      "KINGS_ROCK",
      "QUICK_CLAW",
      "FOCUS_BAND",
      "BATON",
      "TOXIC_ORB",
      "FLAME_ORB",
      "SOUL_DEW",
      "GRIP_CLAW",
      "SCOPE_LENS",
      "EVIOLITE",
      "ER_LIFE_ORB",
      "ER_ASSAULT_VEST",
      "ER_ROCKY_HELMET",
    ] as const;
    for (const key of expected) {
      expect(SHOWDOWN_ITEM_POOL, `missing battle item ${key}`).toContain(key);
    }
  });

  it("excludes mega/form, XP/money/friendship/capture/luck and generator-keyed items", () => {
    // Mega/form-change (mega rule owns the slot), progression/utility items with no
    // meaning in one level-100 fight, and generator-keyed items whose bare-key apply
    // yields null. All must stay OUT of the fieldable pool.
    const forbidden = [
      "MEGA_BRACELET",
      "FORM_CHANGE_ITEM",
      "RARE_FORM_CHANGE_ITEM",
      "LUCKY_EGG",
      "GOLDEN_EGG",
      "SOOTHE_BELL",
      "GOLDEN_PUNCH",
      "AMULET_COIN",
      "MAP",
      "IV_SCANNER",
      "EVOLUTION_TRACKER_GIMMIGHOUL",
      "BERRY",
      "ATTACK_TYPE_BOOSTER",
      "SPECIES_STAT_BOOSTER",
      "BASE_STAT_BOOSTER",
      "TEMP_STAT_STAGE_BOOSTER",
    ] as const;
    for (const key of forbidden) {
      expect(SHOWDOWN_ITEM_POOL as readonly string[], `forbidden item leaked in: ${key}`).not.toContain(key);
    }
  });
});

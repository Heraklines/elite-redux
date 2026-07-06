import { SHOWDOWN_ITEM_POOL } from "#app/data/elite-redux/showdown/showdown-item-pool";
import { modifierTypes } from "#data/data-lists";
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
});

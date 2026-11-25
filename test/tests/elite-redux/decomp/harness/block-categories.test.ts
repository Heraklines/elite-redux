/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// Spec 8.4: every block (class declaration) sits in exactly one browse category, and the hand-written table has no
// leftover name for a class that is not declared.
import { declRegistry } from "#data/elite-redux/ability-studio/decl-registry";
import {
  BROWSE_CATEGORIES,
  blockCategoryFor,
  blockCategoryNames,
} from "#data/elite-redux/ability-studio/vocabulary/index";
import { describe, expect, it } from "vitest";

describe("block browse categories", () => {
  it("gives every declared class a category", () => {
    const missing = declRegistry
      .all()
      .map(module => module.className)
      .filter(name => blockCategoryFor(name) === undefined);
    expect(missing, `classes without a browse category: ${missing.join(", ")}`).toEqual([]);
  });

  it("lists no class that is not declared", () => {
    const declared = new Set(
      declRegistry.all().flatMap(module => [module.className, module.className.replace(/AbAttr$/, "")]),
    );
    const extra = blockCategoryNames().filter(name => !declared.has(name));
    expect(extra, `categories for classes that are not declared: ${extra.join(", ")}`).toEqual([]);
  });

  it("uses every one of the eleven categories", () => {
    const used = new Set(declRegistry.all().map(module => blockCategoryFor(module.className)));
    for (const category of BROWSE_CATEGORIES) {
      expect(used.has(category), category).toBe(true);
    }
  });
});

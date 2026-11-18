/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// L3 golden recipes: the four audited failures plus the half-damage worked example, each with a
// behavioural pass criterion checked in a real battle. See recipes.ts for the expected-fail contract.
import { unregisterCompositionAbilities } from "#test/tests/elite-redux/decomp/harness/blueprints";
import { describeRecipe, GOLDEN_RECIPES, runRecipe } from "#test/tests/elite-redux/decomp/harness/recipes";
import Phaser from "phaser";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

describe("L3 golden recipes", () => {
  let phaserGame: Phaser.Game;
  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });
  afterEach(unregisterCompositionAbilities);

  it("the recipe list holds the four audited failures", () => {
    expect(GOLDEN_RECIPES.map(r => r.id)).toEqual([
      "switch-out-below-35",
      "immune-to-ground",
      "half-damage-at-full-hp",
      "steam-eruption-after-fire-or-water",
    ]);
  });

  for (const recipe of GOLDEN_RECIPES) {
    if (recipe.standIn !== undefined) {
      it(`${recipe.id}: the behavioural checks pass for the known-good original (${recipe.standIn.note})`, async () => {
        const result = await runRecipe(phaserGame, recipe, { standIn: true });
        expect(result.checks.length).toBeGreaterThan(0);
        expect(result.passed, describeRecipe(result)).toBe(true);
      }, 120_000);
    }

    it(recipe.expectedFail === undefined
      ? `${recipe.id}: the staff-built composition passes its behavioural criterion`
      : `${recipe.id}: still fails for the stated reason (expected failure until the precedent lands)`, async () => {
      const result = await runRecipe(phaserGame, recipe);
      console.log(`DECOMP_L3_RECIPE ${recipe.id} passed=${result.passed} ${result.millis}ms`);
      if (recipe.expectedFail === undefined) {
        expect(result.passed, describeRecipe(result)).toBe(true);
        return;
      }
      expect(
        result.passed,
        `${recipe.title} now passes. The precedent (${recipe.expectedFail.landsWith}) has landed: remove "expectedFail" from the recipe.\n${describeRecipe(result)}`,
      ).toBe(false);
      // The build error must name what is missing, in words a builder can read.
      const message = result.compileErrors.join(" ");
      expect(
        recipe.expectedFail.mentions.some(text => message.includes(text)),
        `the build error does not mention any of ${recipe.expectedFail.mentions.join(" / ")}:
${describeRecipe(result)}`,
      ).toBe(true);
    }, 120_000);
  }
});

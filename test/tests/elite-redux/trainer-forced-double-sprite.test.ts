/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// CRASH-CLASS REGRESSION: a FORCED-DOUBLE trainer whose config has hasDouble=false
// must SUMMON without throwing.
//
// Co-op ME trainer battles (and the solo Doubles-Only #385 family) force
// `TrainerVariant.DOUBLE` on WHATEVER trainer the encounter rolls (both players get an
// enemy-facing slot; #818). But most `TrainerConfig`s have `hasDouble=false` (only a
// handful call `setHasDouble()`). The Trainer ctor DEMOTES the local sprite variant to
// DEFAULT when `!hasDouble` - building a SINGLE trainer sprite pair - while `this.variant`
// STAYS DOUBLE (so gameplay still fields two enemy mons). Before the fix the sprite
// accessors (`getSprites`/`getTintSprites`/`playAnim`) read `this.variant` alone, so they
// tried to index a PARTNER sprite (`getAt(2)`/`getAt(3)`) that was never added -> `.setTexture`
// on `undefined` threw at `Trainer.initSprite` the moment the trainer was summoned (the
// crash the first draft of coop-me-trainer-battle-double.test.ts hit on a rolled foe).
//
// FIX: the accessors now gate the partner sprite on `hasPartnerSprite()` (variant DOUBLE
// AND config.hasDouble AND !doubleOnly), matching the ctor's construction guard - so a
// forced-double single-sprite trainer exposes exactly ONE sprite and never indexes a
// missing one, while `this.variant` stays DOUBLE for the two-enemy gameplay force.
//
// Fails-before / passes-after: on the pre-fix code `initSprite()` throws here; on the fix it
// returns cleanly and `getSprites()` has length 1. A genuine two-trainer duo (hasDouble=true)
// still exposes TWO sprites - the double-trainer path is untouched.
// =============================================================================

import { SpeciesId } from "#enums/species-id";
import { TrainerType } from "#enums/trainer-type";
import { TrainerVariant } from "#enums/trainer-variant";
import { Trainer } from "#field/trainer";
import { GameManager } from "#test/framework/game-manager";
import { trainerConfigs } from "#trainers/trainer-config";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

describe("forced-DOUBLE trainer with hasDouble=false summons without crashing", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(async () => {
    game = new GameManager(phaserGame);
    // A live battle gives us a globalScene wired for sprite construction (addFieldSprite / pipeline).
    await game.classicMode.startBattle(SpeciesId.PIKACHU);
  });

  it("a hasDouble=false trainer FORCED to TrainerVariant.DOUBLE builds a single sprite and initSprite() does not throw", () => {
    // Precondition: BUG_CATCHER is a normal single trainer (no partner sprite art).
    expect(
      trainerConfigs[TrainerType.BUG_CATCHER].hasDouble,
      "BUG_CATCHER has no double sprite (hasDouble=false)",
    ).toBe(false);

    // The co-op / doubles-challenge force: variant DOUBLE onto a hasDouble=false trainer.
    const trainer = new Trainer(TrainerType.BUG_CATCHER, TrainerVariant.DOUBLE);

    // GAMEPLAY force is preserved: the variant stays DOUBLE (drives the 2-enemy double battle, #818).
    expect(trainer.variant, "the forced-double variant is preserved for the two-enemy gameplay").toBe(
      TrainerVariant.DOUBLE,
    );

    // The crash: pre-fix this indexes a partner sprite that was never added and throws.
    expect(() => trainer.initSprite(), "initSprite must not index a missing partner sprite").not.toThrow();

    // The sprite set is consistent with the single sprite pair the ctor actually built.
    expect(trainer.getSprites(), "a single-sprite trainer exposes exactly one sprite").toHaveLength(1);
    expect(trainer.getTintSprites(), "a single-sprite trainer exposes exactly one tint sprite").toHaveLength(1);
    // playAnim walks the same accessors - it must not trip on the absent partner either.
    expect(() => trainer.playAnim(), "playAnim must not index a missing partner sprite").not.toThrow();
  });

  it("a genuine two-trainer duo (hasDouble=true) still exposes TWO sprites (double path untouched)", () => {
    // ACE_TRAINER has a real double ("Ace Duo") - a true partner sprite exists.
    expect(trainerConfigs[TrainerType.ACE_TRAINER].hasDouble, "ACE_TRAINER is a real double trainer").toBe(true);

    const duo = new Trainer(TrainerType.ACE_TRAINER, TrainerVariant.DOUBLE);

    expect(duo.variant).toBe(TrainerVariant.DOUBLE);
    expect(() => duo.initSprite(), "a real duo still init-sprites cleanly").not.toThrow();
    expect(duo.getSprites(), "a real duo exposes both trainer sprites").toHaveLength(2);
    expect(duo.getTintSprites(), "a real duo exposes both tint sprites").toHaveLength(2);
  });
});

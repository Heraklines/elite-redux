import { modifierTypes } from "#data/data-lists";
import { bargainSinAvailable } from "#data/elite-redux/er-bargain-sins";
import { SpeciesId } from "#enums/species-id";
import { ExtraModifierModifier } from "#modifiers/modifier";
import { GameManager } from "#test/framework/game-manager";
import { NumberHolder } from "#utils/common";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

// ER reward ball: Greater Golden Ball = the Golden Poke Ball's +1 reward-option
// mechanism (ExtraModifierModifier), but +2. Verifies it seeds at stack 2 and
// feeds the reward-option counter that SelectModifierPhase.getModifierCount reads.
describe("ER Greater Golden Ball", () => {
  it("is an ExtraModifierModifier seeded at stack 2", () => {
    const mod = modifierTypes.ER_GREATER_GOLDEN_BALL().newModifier();
    expect(mod).toBeInstanceOf(ExtraModifierModifier);
    expect((mod as ExtraModifierModifier).getStackCount()).toBe(2);
  });

  it("adds +2 to the reward-option count", () => {
    const mod = modifierTypes.ER_GREATER_GOLDEN_BALL().newModifier() as ExtraModifierModifier;
    const count = new NumberHolder(3); // SelectModifierPhase.getModifierCount() base
    mod.apply(count);
    expect(count.value).toBe(5);
  });
});

const RUN = process.env.ER_SCENARIO === "1";

// End-to-end (#134): granting the ball must persist stack 2 in the LIVE modifier list,
// so the NORMAL reward (no customModifierSettings) shows base 3 + 2 = 5 options - the
// exact bump SelectModifierPhase.getModifierCount() reads at :561-562.
describe.skipIf(!RUN)("ER Greater Golden Ball (granted to the run)", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
  });

  it("holds stack 2 once granted and bumps the normal reward count to 5", async () => {
    await game.classicMode.startBattle(SpeciesId.BULBASAUR);

    await game.scene.addModifier(modifierTypes.ER_GREATER_GOLDEN_BALL().newModifier());
    const held = game.scene.findModifier(m => m instanceof ExtraModifierModifier) as ExtraModifierModifier | undefined;
    expect(held?.getStackCount()).toBe(2);

    const count = new NumberHolder(3);
    game.scene.applyModifiers(ExtraModifierModifier, true, count);
    expect(count.value).toBe(5); // the normal reward shows base 3 + 2 = 5 options
  });

  it("offers Greed only when the complete +2 Greater Golden Ball reward fits", async () => {
    await game.classicMode.startBattle(SpeciesId.BULBASAUR);

    expect(bargainSinAvailable("greed")).toBe(true);

    // One normal Golden Ball leaves exactly two slots: the promise is payable.
    const normalBall = () =>
      modifierTypes.GOLDEN_POKEBALL().withIdFromFunc(modifierTypes.GOLDEN_POKEBALL).newModifier();
    await game.scene.addModifier(normalBall());
    expect(bargainSinAvailable("greed")).toBe(true);

    // At +2 only one slot remains. Greed must disappear rather than wiping a
    // mon's candy for a reward whose advertised +2 cannot be granted.
    await game.scene.addModifier(normalBall());
    expect(bargainSinAvailable("greed")).toBe(false);

    await game.scene.addModifier(normalBall());
    expect(bargainSinAvailable("greed")).toBe(false);
  });
});

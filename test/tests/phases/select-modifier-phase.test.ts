import type { BattleScene } from "#app/battle-scene";
import { modifierTypes } from "#data/data-lists";
import { AbilityId } from "#enums/ability-id";
import { Button } from "#enums/buttons";
import { ModifierTier } from "#enums/modifier-tier";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { UiMode } from "#enums/ui-mode";
import { PlayerPokemon } from "#field/pokemon";
import type { CustomModifierSettings } from "#modifiers/modifier-type";
import { getLuckUpgradeOdds, ModifierTypeOption } from "#modifiers/modifier-type";
import { resolveRewardRerollTierPolicy, SelectModifierPhase } from "#phases/select-modifier-phase";
import { GameManager } from "#test/framework/game-manager";
import { initSceneWithoutEncounterPhase } from "#test/utils/game-manager-utils";
import { ModifierSelectUiHandler } from "#ui/modifier-select-ui-handler";
import { shiftCharCodes } from "#utils/common";
import { getPokemonSpecies } from "#utils/pokemon-utils";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

describe("SelectModifierPhase", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;
  let scene: BattleScene;

  beforeAll(() => {
    phaserGame = new Phaser.Game({
      type: Phaser.HEADLESS,
    });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
    scene = game.scene;

    game.override
      .moveset([MoveId.FISSURE, MoveId.SPLASH])
      .ability(AbilityId.NO_GUARD)
      .startingLevel(200)
      .enemySpecies(SpeciesId.MAGIKARP)
      .battleStyle("single");
  });

  it("ER: Luck monotonically improves reward-tier upgrade odds through the supported cap", () => {
    const odds = Array.from({ length: 19 }, (_, luck) => getLuckUpgradeOdds(luck));
    for (let luck = 1; luck < odds.length; luck++) {
      expect(odds[luck]).toBeLessThanOrEqual(odds[luck - 1]);
    }
    expect(4 / odds[0]).toBeCloseTo(0.039, 2);
    expect(4 / odds[18]).toBeCloseTo(0.222, 2);
  });

  it("ER: rarity locks preserve visible tiers without applying Luck twice", () => {
    const previous = [ModifierTier.GREAT, ModifierTier.MASTER, ModifierTier.LUXURY];
    expect(resolveRewardRerollTierPolicy(true, 1, previous)).toEqual({
      tiers: previous,
      allowLuckUpgrades: false,
    });
  });

  it("ER: unlocked rerolls preserve Master and Luxury floors while rerolling lower tiers", () => {
    expect(resolveRewardRerollTierPolicy(true, 1, [ModifierTier.GREAT, ModifierTier.ULTRA]).allowLuckUpgrades).toBe(
      false,
    );
    expect(
      resolveRewardRerollTierPolicy(false, 1, [ModifierTier.GREAT, ModifierTier.MASTER, ModifierTier.LUXURY]),
    ).toEqual({
      tiers: [undefined, ModifierTier.MASTER, ModifierTier.LUXURY],
      allowLuckUpgrades: true,
    });
  });

  it("should start a select modifier phase", async () => {
    initSceneWithoutEncounterPhase(scene, [SpeciesId.ABRA, SpeciesId.VOLCARONA]);
    const selectModifierPhase = new SelectModifierPhase();
    scene.phaseManager.unshiftPhase(selectModifierPhase);
    await game.phaseInterceptor.to("SelectModifierPhase");

    expect(scene.ui.getMode()).toBe(UiMode.MODIFIER_SELECT);
  });

  it("should generate random modifiers", async () => {
    await game.classicMode.startBattle(SpeciesId.ABRA, SpeciesId.VOLCARONA);
    game.move.select(MoveId.FISSURE);
    await game.phaseInterceptor.to("SelectModifierPhase");

    expect(scene.ui.getMode()).toBe(UiMode.MODIFIER_SELECT);
    const modifierSelectHandler = scene.ui.handlers.find(
      h => h instanceof ModifierSelectUiHandler,
    ) as ModifierSelectUiHandler;
    expect(modifierSelectHandler.options.length).toEqual(3);
  });

  it("should modify reroll cost", async () => {
    initSceneWithoutEncounterPhase(scene, [SpeciesId.ABRA, SpeciesId.VOLCARONA]);
    const options = [
      new ModifierTypeOption(modifierTypes.POTION(), 0, 100),
      new ModifierTypeOption(modifierTypes.ETHER(), 0, 400),
      new ModifierTypeOption(modifierTypes.REVIVE(), 0, 1000),
    ];

    const selectModifierPhase1 = new SelectModifierPhase(0, undefined, {
      guaranteedModifierTypeOptions: options,
    });
    const selectModifierPhase2 = new SelectModifierPhase(0, undefined, {
      guaranteedModifierTypeOptions: options,
      rerollMultiplier: 2,
    });

    const cost1 = selectModifierPhase1.getRerollCost(false);
    const cost2 = selectModifierPhase2.getRerollCost(false);
    expect(cost2).toEqual(cost1 * 2);
  });

  it.todo("should generate random modifiers from reroll", async () => {
    await game.classicMode.startBattle(SpeciesId.ABRA, SpeciesId.VOLCARONA);
    scene.money = 1000000;
    scene.shopCursorTarget = 0;

    game.move.select(MoveId.FISSURE);
    await game.phaseInterceptor.to("SelectModifierPhase");

    // TODO: nagivate the ui to reroll somehow
    //const smphase = scene.phaseManager.getCurrentPhase() as SelectModifierPhase;
    expect(scene.ui.getMode()).toBe(UiMode.MODIFIER_SELECT);
    const modifierSelectHandler = scene.ui.handlers.find(
      h => h instanceof ModifierSelectUiHandler,
    ) as ModifierSelectUiHandler;
    expect(modifierSelectHandler.options.length).toEqual(3);

    modifierSelectHandler.processInput(Button.ACTION);

    expect(scene.money).toBe(1000000 - 250);
    expect(scene.ui.getMode()).toBe(UiMode.MODIFIER_SELECT);
    expect(modifierSelectHandler.options.length).toEqual(3);
  });

  it.todo("should generate random modifiers of same tier for reroll with reroll lock", async () => {
    game.override.startingModifier([{ name: "LOCK_CAPSULE" }]);
    await game.classicMode.startBattle(SpeciesId.ABRA, SpeciesId.VOLCARONA);
    scene.money = 1000000;
    // Just use fully random seed for this test
    vi.spyOn(scene, "resetSeed").mockImplementation(() => {
      scene.waveSeed = shiftCharCodes(scene.seed, 5);
      Phaser.Math.RND.sow([scene.waveSeed]);
      console.log("Wave Seed:", scene.waveSeed, 5);
    });

    game.move.select(MoveId.FISSURE);
    await game.phaseInterceptor.to("SelectModifierPhase");

    expect(scene.ui.getMode()).toBe(UiMode.MODIFIER_SELECT);
    const modifierSelectHandler = scene.ui.handlers.find(
      h => h instanceof ModifierSelectUiHandler,
    ) as ModifierSelectUiHandler;
    expect(modifierSelectHandler.options.length).toEqual(3);
    const firstRollTiers: ModifierTier[] = modifierSelectHandler.options.map(o => o.modifierTypeOption.type.tier);

    // TODO: nagivate ui to reroll with lock capsule enabled

    expect(scene.ui.getMode()).toBe(UiMode.MODIFIER_SELECT);
    expect(modifierSelectHandler.options.length).toEqual(3);
    // Reroll with lock can still upgrade
    expect(
      modifierSelectHandler.options[0].modifierTypeOption.type.tier
        - modifierSelectHandler.options[0].modifierTypeOption.upgradeCount,
    ).toEqual(firstRollTiers[0]);
    expect(
      modifierSelectHandler.options[1].modifierTypeOption.type.tier
        - modifierSelectHandler.options[1].modifierTypeOption.upgradeCount,
    ).toEqual(firstRollTiers[1]);
    expect(
      modifierSelectHandler.options[2].modifierTypeOption.type.tier
        - modifierSelectHandler.options[2].modifierTypeOption.upgradeCount,
    ).toEqual(firstRollTiers[2]);
  });

  it("should generate custom modifiers", async () => {
    await game.classicMode.startBattle(SpeciesId.ABRA, SpeciesId.VOLCARONA);
    scene.money = 1000000;
    const customModifiers: CustomModifierSettings = {
      guaranteedModifierTypeFuncs: [
        modifierTypes.MEMORY_MUSHROOM,
        modifierTypes.TM_ULTRA,
        modifierTypes.LEFTOVERS,
        modifierTypes.AMULET_COIN,
        modifierTypes.GOLDEN_PUNCH,
      ],
    };
    const selectModifierPhase = new SelectModifierPhase(0, undefined, customModifiers);
    scene.phaseManager.unshiftPhase(selectModifierPhase);
    game.move.select(MoveId.SPLASH);
    await game.phaseInterceptor.to("SelectModifierPhase");

    expect(scene.ui.getMode()).toBe(UiMode.MODIFIER_SELECT);
    const modifierSelectHandler = scene.ui.handlers.find(
      h => h instanceof ModifierSelectUiHandler,
    ) as ModifierSelectUiHandler;
    expect(modifierSelectHandler.options.length).toEqual(5);
    expect(modifierSelectHandler.options[0].modifierTypeOption.type.id).toEqual("MEMORY_MUSHROOM");
    expect(modifierSelectHandler.options[1].modifierTypeOption.type.id).toEqual("TM_ULTRA");
    expect(modifierSelectHandler.options[2].modifierTypeOption.type.id).toEqual("LEFTOVERS");
    expect(modifierSelectHandler.options[3].modifierTypeOption.type.id).toEqual("AMULET_COIN");
    expect(modifierSelectHandler.options[4].modifierTypeOption.type.id).toEqual("GOLDEN_PUNCH");
  });

  it("ER: rearms Sprint rewards after taking an Upgraded Map as the first free pick", async () => {
    await game.classicMode.startBattle(SpeciesId.ABRA);
    scene.shopCursorTarget = 1;
    const phase = new SelectModifierPhase(
      0,
      undefined,
      {
        guaranteedModifierTypeFuncs: [modifierTypes.ER_UPGRADED_MAP, modifierTypes.POKEBALL],
        fillRemaining: false,
      },
      false,
      { kind: "ambient" },
      undefined,
      0,
      2,
      2,
    );
    scene.phaseManager.unshiftPhase(phase);
    game.move.select(MoveId.SPLASH);
    await game.phaseInterceptor.to("SelectModifierPhase");

    const firstHandler = scene.ui.handlers.find(h => h instanceof ModifierSelectUiHandler) as ModifierSelectUiHandler;
    const mapCursor = firstHandler.options.findIndex(option => option.modifierTypeOption.type.id === "ER_UPGRADED_MAP");
    expect(mapCursor).toBeGreaterThanOrEqual(0);
    await vi.waitFor(() => expect(firstHandler.getCoopMirrorCursorState()).not.toBeNull(), { timeout: 5_000 });
    firstHandler.setRowCursor(1);
    firstHandler.setCursor(mapCursor);
    expect(firstHandler.processInput(Button.ACTION)).toBe(true);

    await vi.waitFor(
      () => {
        expect(scene.ui.getMode()).toBe(UiMode.MODIFIER_SELECT);
        expect(firstHandler.options).toHaveLength(1);
        expect(firstHandler.getCoopMirrorCursorState()).not.toBeNull();
      },
      { timeout: 5_000 },
    );
  });

  it("ER: Sprint rerolls preserve both free reward picks", async () => {
    await game.classicMode.startBattle(SpeciesId.ABRA);
    scene.money = 1_000_000;
    const phase = new SelectModifierPhase(0, undefined, undefined, false, { kind: "ambient" }, undefined, 0, 5, 2);
    scene.phaseManager.unshiftPhase(phase);
    game.move.select(MoveId.SPLASH);
    await game.phaseInterceptor.to("SelectModifierPhase");

    const handler = scene.ui.handlers.find(h => h instanceof ModifierSelectUiHandler) as ModifierSelectUiHandler;
    await vi.waitFor(() => expect(handler.options).toHaveLength(5), { timeout: 5_000 });
    await vi.waitFor(() => expect(handler.getCoopMirrorCursorState()).not.toBeNull(), { timeout: 5_000 });
    handler.setRowCursor(0);
    handler.setCursor(0);
    expect(handler.processInput(Button.ACTION)).toBe(true);

    await vi.waitFor(
      () => {
        const rerolledPhase = scene.phaseManager.getCurrentPhase() as SelectModifierPhase;
        const rerolledState = rerolledPhase as unknown as {
          rerollCount: number;
          baseOptionCount: number;
          freePicksRemaining: number;
        };
        expect(rerolledPhase).not.toBe(phase);
        expect(rerolledPhase.phaseName).toBe("SelectModifierPhase");
        expect(rerolledState.rerollCount).toBe(1);
        expect(rerolledState.baseOptionCount).toBe(5);
        expect(rerolledState.freePicksRemaining).toBe(2);
      },
      { timeout: 5_000 },
    );

    await game.phaseInterceptor.to("SelectModifierPhase");
    const rerolledHandler = scene.ui.handlers.find(
      h => h instanceof ModifierSelectUiHandler,
    ) as ModifierSelectUiHandler;
    await vi.waitFor(() => expect(rerolledHandler.options).toHaveLength(5), { timeout: 5_000 });
    await vi.waitFor(() => expect(rerolledHandler.getCoopMirrorCursorState()).not.toBeNull(), { timeout: 5_000 });

    rerolledHandler.setRowCursor(1);
    rerolledHandler.setCursor(0);
    expect(rerolledHandler.processInput(Button.ACTION)).toBe(true);
    await vi.waitFor(
      () => {
        expect(rerolledHandler.options).toHaveLength(4);
        const state = scene.phaseManager.getCurrentPhase() as unknown as { freePicksRemaining: number };
        expect(state.freePicksRemaining).toBe(1);
        expect(rerolledHandler.getCoopMirrorCursorState()).not.toBeNull();
      },
      { timeout: 5_000 },
    );

    rerolledHandler.setRowCursor(1);
    rerolledHandler.setCursor(0);
    expect(rerolledHandler.processInput(Button.ACTION)).toBe(true);
    await vi.waitFor(() => expect(scene.phaseManager.getCurrentPhase().phaseName).not.toBe("SelectModifierPhase"), {
      timeout: 5_000,
    });
  });

  it("ER: Sprint never repeats immediate rewards across generated batches", async () => {
    await game.classicMode.startBattle(SpeciesId.ABRA);
    const phase = new SelectModifierPhase(0, undefined, undefined, false, { kind: "ambient" }, undefined, 0, 6, 2);
    vi.spyOn(phase, "getModifierTypeOptions").mockReturnValue([
      new ModifierTypeOption(modifierTypes.POKEBALL(), 0),
      new ModifierTypeOption(modifierTypes.VOUCHER(), 0),
    ]);
    scene.phaseManager.unshiftPhase(phase);
    game.move.select(MoveId.SPLASH);
    await game.phaseInterceptor.to("SelectModifierPhase");

    const handler = scene.ui.handlers.find(h => h instanceof ModifierSelectUiHandler) as ModifierSelectUiHandler;
    await vi.waitFor(() => expect(handler.options).toHaveLength(2), { timeout: 5_000 });
    expect(handler.options.map(option => option.modifierTypeOption.type.name)).toEqual([
      modifierTypes.POKEBALL().name,
      modifierTypes.VOUCHER().name,
    ]);
  });

  it("ER: Sprint keeps ordinary Pokemon-targeted rewards in the first-pick pool", async () => {
    await game.classicMode.startBattle(SpeciesId.ABRA);
    const phase = new SelectModifierPhase(0, undefined, undefined, false, { kind: "ambient" }, undefined, 0, 2, 2);
    vi.spyOn(phase, "getModifierTypeOptions").mockReturnValue([
      new ModifierTypeOption(modifierTypes.POTION(), 0),
      new ModifierTypeOption(modifierTypes.POKEBALL(), 0),
    ]);
    scene.phaseManager.unshiftPhase(phase);
    game.move.select(MoveId.SPLASH);
    await game.phaseInterceptor.to("SelectModifierPhase");

    const handler = scene.ui.handlers.find(h => h instanceof ModifierSelectUiHandler) as ModifierSelectUiHandler;
    await vi.waitFor(() => expect(handler.options).toHaveLength(2), { timeout: 5_000 });
    expect(handler.options.map(option => option.modifierTypeOption.type.id)).toEqual(["POTION", "POKEBALL"]);
  });

  it("should generate custom modifier tiers that can upgrade from luck", async () => {
    await game.classicMode.startBattle(SpeciesId.ABRA, SpeciesId.VOLCARONA);
    scene.money = 1000000;
    const customModifiers: CustomModifierSettings = {
      guaranteedModifierTiers: [
        ModifierTier.COMMON,
        ModifierTier.GREAT,
        ModifierTier.ULTRA,
        ModifierTier.ROGUE,
        ModifierTier.MASTER,
      ],
    };
    const pokemon = new PlayerPokemon(getPokemonSpecies(SpeciesId.BULBASAUR), 10, undefined, 0, undefined, true, 2);

    // Fill party with max shinies
    while (scene.getPlayerParty().length > 0) {
      scene.getPlayerParty().pop();
    }
    scene.getPlayerParty().push(pokemon, pokemon, pokemon, pokemon, pokemon, pokemon);

    const selectModifierPhase = new SelectModifierPhase(0, undefined, customModifiers);
    scene.phaseManager.unshiftPhase(selectModifierPhase);
    game.move.select(MoveId.SPLASH);
    await game.phaseInterceptor.to("SelectModifierPhase");

    expect(scene.ui.getMode()).toBe(UiMode.MODIFIER_SELECT);
    const modifierSelectHandler = scene.ui.handlers.find(
      h => h instanceof ModifierSelectUiHandler,
    ) as ModifierSelectUiHandler;
    expect(modifierSelectHandler.options.length).toEqual(5);
    expect(
      modifierSelectHandler.options[0].modifierTypeOption.type.tier
        - modifierSelectHandler.options[0].modifierTypeOption.upgradeCount,
    ).toEqual(ModifierTier.COMMON);
    expect(
      modifierSelectHandler.options[1].modifierTypeOption.type.tier
        - modifierSelectHandler.options[1].modifierTypeOption.upgradeCount,
    ).toEqual(ModifierTier.GREAT);
    expect(
      modifierSelectHandler.options[2].modifierTypeOption.type.tier
        - modifierSelectHandler.options[2].modifierTypeOption.upgradeCount,
    ).toEqual(ModifierTier.ULTRA);
    expect(
      modifierSelectHandler.options[3].modifierTypeOption.type.tier
        - modifierSelectHandler.options[3].modifierTypeOption.upgradeCount,
    ).toEqual(ModifierTier.ROGUE);
    expect(
      modifierSelectHandler.options[4].modifierTypeOption.type.tier
        - modifierSelectHandler.options[4].modifierTypeOption.upgradeCount,
    ).toEqual(ModifierTier.MASTER);
  });

  it("should generate custom modifiers and modifier tiers together", async () => {
    await game.classicMode.startBattle(SpeciesId.ABRA, SpeciesId.VOLCARONA);
    scene.money = 1000000;
    const customModifiers: CustomModifierSettings = {
      guaranteedModifierTypeFuncs: [modifierTypes.MEMORY_MUSHROOM, modifierTypes.TM_COMMON],
      guaranteedModifierTiers: [ModifierTier.MASTER, ModifierTier.MASTER],
    };
    const selectModifierPhase = new SelectModifierPhase(0, undefined, customModifiers);
    scene.phaseManager.unshiftPhase(selectModifierPhase);
    game.move.select(MoveId.SPLASH);
    await game.phaseInterceptor.to("SelectModifierPhase");

    expect(scene.ui.getMode()).toBe(UiMode.MODIFIER_SELECT);
    const modifierSelectHandler = scene.ui.handlers.find(
      h => h instanceof ModifierSelectUiHandler,
    ) as ModifierSelectUiHandler;
    expect(modifierSelectHandler.options.length).toEqual(4);
    expect(modifierSelectHandler.options[0].modifierTypeOption.type.id).toEqual("MEMORY_MUSHROOM");
    expect(modifierSelectHandler.options[1].modifierTypeOption.type.id).toEqual("TM_COMMON");
    expect(modifierSelectHandler.options[2].modifierTypeOption.type.tier).toEqual(ModifierTier.MASTER);
    expect(modifierSelectHandler.options[3].modifierTypeOption.type.tier).toEqual(ModifierTier.MASTER);
  });

  it("should fill remaining modifiers if fillRemaining is true with custom modifiers", async () => {
    await game.classicMode.startBattle(SpeciesId.ABRA, SpeciesId.VOLCARONA);
    scene.money = 1000000;
    const customModifiers: CustomModifierSettings = {
      guaranteedModifierTypeFuncs: [modifierTypes.MEMORY_MUSHROOM],
      guaranteedModifierTiers: [ModifierTier.MASTER],
      fillRemaining: true,
    };
    const selectModifierPhase = new SelectModifierPhase(0, undefined, customModifiers);
    scene.phaseManager.unshiftPhase(selectModifierPhase);
    game.move.select(MoveId.SPLASH);
    await game.phaseInterceptor.to("SelectModifierPhase");

    expect(scene.ui.getMode()).toBe(UiMode.MODIFIER_SELECT);
    const modifierSelectHandler = scene.ui.handlers.find(
      h => h instanceof ModifierSelectUiHandler,
    ) as ModifierSelectUiHandler;
    expect(modifierSelectHandler.options.length).toEqual(3);
    expect(modifierSelectHandler.options[0].modifierTypeOption.type.id).toEqual("MEMORY_MUSHROOM");
    expect(modifierSelectHandler.options[1].modifierTypeOption.type.tier).toEqual(ModifierTier.MASTER);
  });

  // ER (#134): a Greater Golden Ball grants +2 EARNED reward slots that must survive a
  // bundled reward even when fillRemaining is FALSE - previously the count override
  // discarded them, so the ball was a no-op in every customModifierSettings reward. 1
  // guaranteed func + 2 earned = 3 options; before the fix this was 1.
  it("ER: a Greater Golden Ball adds its earned slots to a fillRemaining:false bundle (#134)", async () => {
    await game.classicMode.startBattle(SpeciesId.ABRA, SpeciesId.VOLCARONA);
    scene.money = 1000000;
    await scene.addModifier(modifierTypes.ER_GREATER_GOLDEN_BALL().newModifier());

    const customModifiers: CustomModifierSettings = {
      guaranteedModifierTypeFuncs: [modifierTypes.MEMORY_MUSHROOM],
      fillRemaining: false,
    };
    scene.phaseManager.unshiftPhase(new SelectModifierPhase(0, undefined, customModifiers));
    game.move.select(MoveId.SPLASH);
    await game.phaseInterceptor.to("SelectModifierPhase");

    const modifierSelectHandler = scene.ui.handlers.find(
      h => h instanceof ModifierSelectUiHandler,
    ) as ModifierSelectUiHandler;
    expect(modifierSelectHandler.options.length).toEqual(3); // 1 guaranteed + 2 earned (Greater Golden Ball)
    expect(modifierSelectHandler.options[0].modifierTypeOption.type.id).toEqual("MEMORY_MUSHROOM");
  });

  // ER (#145): backing out of an item (TM Case / Memory / Ability Capsule / ...) re-shows the
  // reward via SelectModifierPhase.copy(). The copy re-shows the CURRENT options, which ALREADY
  // include the player's earned Golden Ball slots. copy() must pass `fillRemaining: true` so the
  // screen is sized to those options (max(naturalCount, theseOptions) = theseOptions). Before the
  // fix it omitted fillRemaining, so getModifierCount's #134 branch added `earnedExtraRewards` ON
  // TOP of an option list that already contained them - every item-use -> back-out grew the slot
  // count by G (the earned-slot count) without bound. The re-shown screen must keep the same size.
  it("ER: backing out of an item does not grow the reward slot count (#145)", async () => {
    await game.classicMode.startBattle(SpeciesId.ABRA, SpeciesId.VOLCARONA);
    scene.money = 1000000;
    // Greater Golden Ball = +2 earned reward slots; the leak grew by exactly this each cycle.
    await scene.addModifier(modifierTypes.ER_GREATER_GOLDEN_BALL().newModifier());

    scene.phaseManager.unshiftPhase(new SelectModifierPhase());
    game.move.select(MoveId.SPLASH);
    await game.phaseInterceptor.to("SelectModifierPhase");

    const handler = scene.ui.handlers.find(h => h instanceof ModifierSelectUiHandler) as ModifierSelectUiHandler;
    const firstCount = handler.options.length;
    expect(firstCount).toBeGreaterThanOrEqual(5); // 3 base + 2 earned (Greater Golden Ball)

    // Simulate use-item -> sub-menu -> back-out: the phase queues a copy of itself and re-shows it.
    const phase = scene.phaseManager.getCurrentPhase() as SelectModifierPhase;
    const copyPhase = phase.copy();
    scene.phaseManager.unshiftPhase(copyPhase);
    // The sub-menu transition routes the UI through MESSAGE first, which CLEARS the
    // MODIFIER_SELECT handler (active -> false) so the copy's show() actually rebuilds the
    // option sprites with its recomputed count - without this the handler early-returns and
    // the grown count is invisible (exactly how it slips past a naive repro).
    await scene.ui.setMode(UiMode.MESSAGE);
    phase.end();
    await game.phaseInterceptor.to("SelectModifierPhase");

    const reHandler = scene.ui.handlers.find(h => h instanceof ModifierSelectUiHandler) as ModifierSelectUiHandler;
    // Same number of slots, NOT firstCount + 2 (the #145 leak).
    expect(reHandler.options.length).toBe(firstCount);
  });
});

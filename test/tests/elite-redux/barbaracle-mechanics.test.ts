/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { allAbilities, allMoves } from "#data/data-lists";
import {
  BRAIN_OVER_BRAWN_POWER_MULTIPLIER,
  BrainOverBrawnPowerAbAttr,
  BrainOverBrawnTypeAbAttr,
  getMultiHeadedHitScale,
  getSwirlyRoomDuration,
  hasMultiHeadedAttr,
  RapierFlagInjectionAbAttr,
  resolveBrainOverBrawnPower,
  resolveBrainOverBrawnType,
  resolveMagicTouchStat,
  resolveSwirlyRoomCategory,
  SwirlifyAbAttr,
  swirlyRoomCategory,
} from "#data/elite-redux/abilities/barbaracle-mechanics";
import {
  ER_BODHISATTVA_ABILITY_ID,
  ER_BRAIN_OVER_BRAWN_ABILITY_ID,
  ER_FAKEMON_PITCH_ABILITIES,
  ER_MAGIC_TOUCH_ABILITY_ID,
  ER_RAPIER_ABILITY_ID,
  ER_SWIRLIFY_ABILITY_ID,
} from "#data/elite-redux/abilities/fakemon-pitch-abilities";
import { AttackStatSubstituteAbAttr } from "#data/elite-redux/archetypes/attack-stat-substitute";
import { FlagDamageBoostAbAttr } from "#data/elite-redux/archetypes/flag-damage-boost";
import { ErMultiHeadedAbAttr } from "#data/elite-redux/archetypes/multi-headed";
import { getErDamagePreview } from "#data/elite-redux/er-damage-preview";
import type { AbilityId } from "#enums/ability-id";
import { ArenaTagType } from "#enums/arena-tag-type";
import { ErAbilityId } from "#enums/er-ability-id";
import { MoveCategory } from "#enums/move-category";
import { MoveFlags } from "#enums/move-flags";
import { MoveId } from "#enums/move-id";
import { PokemonType } from "#enums/pokemon-type";
import { SpeciesId } from "#enums/species-id";
import { Stat } from "#enums/stat";
import { GameManager } from "#test/framework/game-manager";
import { NumberHolder } from "#utils/common";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const contactMove = { hasFlag: (flag: MoveFlags) => flag === MoveFlags.MAKES_CONTACT } as never;
const nonContactMove = { hasFlag: () => false } as never;

describe("Mega Barbaracle Y metadata", () => {
  it("registers stable IDs and real registry attrs", () => {
    expect(allAbilities[ER_SWIRLIFY_ABILITY_ID].id).toBe(ER_SWIRLIFY_ABILITY_ID);
    expect(allAbilities[ER_BODHISATTVA_ABILITY_ID].id).toBe(ER_BODHISATTVA_ABILITY_ID);
    expect(allAbilities[ER_MAGIC_TOUCH_ABILITY_ID].id).toBe(ER_MAGIC_TOUCH_ABILITY_ID);
    expect(allAbilities[ER_RAPIER_ABILITY_ID].id).toBe(ER_RAPIER_ABILITY_ID);
    expect(allAbilities[ER_BRAIN_OVER_BRAWN_ABILITY_ID].id).toBe(ER_BRAIN_OVER_BRAWN_ABILITY_ID);
    expect(allMoves[MoveId.SWIRLY_ROOM].id).toBe(MoveId.SWIRLY_ROOM);
    expect(ER_FAKEMON_PITCH_ABILITIES.map(def => def.pokerogueId)).toEqual(
      expect.arrayContaining([
        ER_SWIRLIFY_ABILITY_ID,
        ER_BODHISATTVA_ABILITY_ID,
        ER_MAGIC_TOUCH_ABILITY_ID,
        ER_RAPIER_ABILITY_ID,
        ER_BRAIN_OVER_BRAWN_ABILITY_ID,
      ]),
    );

    expect(allAbilities[ER_SWIRLIFY_ABILITY_ID].attrs.some(attr => attr instanceof SwirlifyAbAttr)).toBe(true);
    expect(allAbilities[ER_MAGIC_TOUCH_ABILITY_ID].attrs.some(attr => attr instanceof AttackStatSubstituteAbAttr)).toBe(
      true,
    );
    expect(allAbilities[ER_RAPIER_ABILITY_ID].attrs.some(attr => attr instanceof RapierFlagInjectionAbAttr)).toBe(true);
    expect(
      allAbilities[ER_BRAIN_OVER_BRAWN_ABILITY_ID].attrs.some(attr => attr instanceof BrainOverBrawnTypeAbAttr),
    ).toBe(true);
    expect(
      allAbilities[ER_BRAIN_OVER_BRAWN_ABILITY_ID].attrs.some(attr => attr instanceof BrainOverBrawnPowerAbAttr),
    ).toBe(true);
    const handBarnacles = allAbilities[ErAbilityId.HAND_BARNACLES];
    expect(handBarnacles.name).toBe("Hand Barnacles");
    expect(handBarnacles.attrs.some(attr => attr instanceof ErMultiHeadedAbAttr)).toBe(true);
    expect(allAbilities[ER_BODHISATTVA_ABILITY_ID].attrs.some(attr => attr instanceof ErMultiHeadedAbAttr)).toBe(true);
    expect(allAbilities[ER_BODHISATTVA_ABILITY_ID].attrs.some(attr => attr instanceof BrainOverBrawnTypeAbAttr)).toBe(
      true,
    );
  });
});

describe("Rapier", () => {
  it("treats slicing and horn-based moves as each other's semantic flags", () => {
    const rapier = new RapierFlagInjectionAbAttr();
    const slicingMove = { hasFlag: (flag: MoveFlags) => flag === MoveFlags.SLICING_MOVE } as never;
    const hornMove = { hasFlag: (flag: MoveFlags) => flag === MoveFlags.HORN_BASED } as never;
    expect(rapier.injects(MoveFlags.HORN_BASED, slicingMove)).toBe(true);
    expect(rapier.injects(MoveFlags.SLICING_MOVE, hornMove)).toBe(true);
  });
});

describe("Swirly Room lifecycle and category", () => {
  it("keeps independent three-turn entry and five-turn move sources", () => {
    expect(getSwirlyRoomDuration("ability")).toBe(3);
    expect(getSwirlyRoomDuration("move")).toBe(5);
  });

  it("swaps only damaging categories while active and leaves baseline users unchanged", () => {
    expect(resolveSwirlyRoomCategory(MoveCategory.PHYSICAL, true)).toBe(MoveCategory.SPECIAL);
    expect(resolveSwirlyRoomCategory(MoveCategory.SPECIAL, true)).toBe(MoveCategory.PHYSICAL);
    expect(resolveSwirlyRoomCategory(MoveCategory.STATUS, true)).toBe(MoveCategory.STATUS);
    expect(resolveSwirlyRoomCategory(MoveCategory.PHYSICAL, false)).toBe(MoveCategory.PHYSICAL);
    expect(swirlyRoomCategory(MoveCategory.SPECIAL)).toBe(MoveCategory.PHYSICAL);
  });
});

describe("Magic Touch", () => {
  it("selects Special Attack for contact moves without changing their category", () => {
    expect(resolveMagicTouchStat(contactMove, true)).toBe(Stat.SPATK);
    expect(resolveMagicTouchStat(contactMove, false)).toBe(Stat.SPATK);
    expect(resolveMagicTouchStat(nonContactMove, true)).toBeNull();
    expect(MoveCategory.PHYSICAL).not.toBe(MoveCategory.SPECIAL);
  });
});

describe("Brain Over Brawn", () => {
  it("converts Fighting to Psychic before effectiveness and boosts power by 1.2x", () => {
    expect(resolveBrainOverBrawnType(PokemonType.FIGHTING)).toBe(PokemonType.PSYCHIC);
    expect(resolveBrainOverBrawnType(PokemonType.WATER)).toBe(PokemonType.WATER);
    expect(resolveBrainOverBrawnPower(100, PokemonType.FIGHTING)).toBe(120);
    expect(resolveBrainOverBrawnPower(100, PokemonType.PSYCHIC)).toBe(100);
    expect(BRAIN_OVER_BRAWN_POWER_MULTIPLIER).toBe(1.2);
  });
});

describe("Bodhisattva composite hit scaling", () => {
  it("recognizes Multi-Headed by attr presence and scales later heads", () => {
    const multiHeadedAttr = { constructor: { name: "ErMultiHeadedAbAttr" } } as never;
    expect(hasMultiHeadedAttr([multiHeadedAttr])).toBe(true);
    expect(hasMultiHeadedAttr([])).toBe(false);
    expect(getMultiHeadedHitScale([multiHeadedAttr], 0, 3)).toBe(1);
    expect(getMultiHeadedHitScale([multiHeadedAttr], 1, 3)).toBe(0.2);
    expect(getMultiHeadedHitScale([multiHeadedAttr], 2, 3)).toBe(0.15);
    expect(getMultiHeadedHitScale([], 1, 3)).toBe(1);
  });
});
describe("Swirly Room engine hooks", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
    game.override.battleStyle("single").enemySpecies(SpeciesId.MAGIKARP).enemyMoveset(MoveId.SPLASH);
  });

  it("applies the registered Swirlify entry source for three turns", async () => {
    game.override.ability(ER_SWIRLIFY_ABILITY_ID as AbilityId);
    await game.classicMode.startBattle(SpeciesId.FEEBAS);

    const source = game.field.getPlayerPokemon();
    const room = game.scene.arena.getTag(ArenaTagType.SWIRLY_ROOM);
    expect(source.getAllActiveAbilityAttrs().some(attr => attr instanceof SwirlifyAbAttr)).toBe(true);
    expect(room?.maxDuration).toBe(3);
    expect(room?.sourceId).toBe(source.id);
  });

  it("applies the registered Swirly Room move source for five turns", async () => {
    await game.classicMode.startBattle(SpeciesId.FEEBAS);
    const source = game.field.getPlayerPokemon();

    game.move.use(MoveId.SWIRLY_ROOM);
    await game.toNextTurn();

    const room = game.scene.arena.getTag(ArenaTagType.SWIRLY_ROOM);
    expect(room?.maxDuration).toBe(5);
    expect(room?.sourceMove).toBe(MoveId.SWIRLY_ROOM);
    expect(room?.sourceId).toBe(source.id);
  });
  it("uses the registered Rapier attr for both real flag consumers", async () => {
    game.override.ability(ER_RAPIER_ABILITY_ID as AbilityId);
    await game.classicMode.startBattle(SpeciesId.FEEBAS);

    const source = game.field.getPlayerPokemon();
    const target = game.field.getEnemyPokemon();
    const slicingMove = allMoves[MoveId.X_SCISSOR];
    const hornMove = allMoves[MoveId.HORN_ATTACK];
    expect(slicingMove.doesFlagEffectApply({ flag: MoveFlags.HORN_BASED, user: source })).toBe(true);
    expect(hornMove.doesFlagEffectApply({ flag: MoveFlags.SLICING_MOVE, user: source })).toBe(true);

    const hunterHornAttr = allAbilities[ErAbilityId.HUNTER_S_HORN].attrs.find(
      (attr): attr is FlagDamageBoostAbAttr => attr instanceof FlagDamageBoostAbAttr,
    );
    expect(hunterHornAttr).toBeDefined();
    expect(
      hunterHornAttr?.canApply({
        pokemon: source,
        opponent: target,
        move: slicingMove,
        power: new NumberHolder(100),
        simulated: true,
      }),
    ).toBe(true);
  });

  it("swaps real move categories for damage and preview while preserving status", async () => {
    await game.classicMode.startBattle(SpeciesId.FEEBAS);
    const source = game.field.getPlayerPokemon();
    const target = game.field.getEnemyPokemon();
    const physicalMove = allMoves[MoveId.TACKLE];
    const statusMove = allMoves[MoveId.PROTECT];
    const baseDamageSpy = vi.spyOn(target, "getBaseDamage");

    expect(source.getMoveCategory(target, physicalMove)).toBe(MoveCategory.PHYSICAL);
    expect(source.getMoveCategory(target, statusMove)).toBe(MoveCategory.STATUS);
    target.getAttackDamage({ source, move: physicalMove, simulated: true });
    expect(baseDamageSpy.mock.lastCall?.[0].moveCategory).toBe(MoveCategory.PHYSICAL);

    game.scene.arena.addTag(ArenaTagType.SWIRLY_ROOM, 5, MoveId.SWIRLY_ROOM, source.id);
    expect(source.getMoveCategory(target, physicalMove)).toBe(MoveCategory.SPECIAL);
    expect(source.getMoveCategory(target, statusMove)).toBe(MoveCategory.STATUS);
    target.getAttackDamage({ source, move: physicalMove, simulated: true });
    expect(baseDamageSpy.mock.lastCall?.[0].moveCategory).toBe(MoveCategory.SPECIAL);

    baseDamageSpy.mockClear();
    getErDamagePreview(source, target, physicalMove);
    expect(baseDamageSpy.mock.calls.length).toBeGreaterThan(0);
    expect(baseDamageSpy.mock.calls.every(call => call[0].moveCategory === MoveCategory.SPECIAL)).toBe(true);
  });
  it("uses the registered Magic Touch attr for Sp. Atk while preserving category", async () => {
    game.override.ability(ER_MAGIC_TOUCH_ABILITY_ID as AbilityId);
    await game.classicMode.startBattle(SpeciesId.FEEBAS);
    const source = game.field.getPlayerPokemon();
    const target = game.field.getEnemyPokemon();
    const physicalMove = allMoves[MoveId.TACKLE];
    const effectiveStatSpy = vi.spyOn(source, "getEffectiveStat");

    expect(source.getMoveCategory(target, physicalMove)).toBe(MoveCategory.PHYSICAL);
    target.getAttackDamage({ source, move: physicalMove, simulated: true });
    expect(effectiveStatSpy.mock.calls.some(call => call[0] === Stat.SPATK)).toBe(true);
    expect(source.getMoveCategory(target, physicalMove)).toBe(MoveCategory.PHYSICAL);
  });
  it("uses Bodhisattva's registered constituents for type and power transforms", async () => {
    game.override.ability(ER_BODHISATTVA_ABILITY_ID as AbilityId);
    await game.classicMode.startBattle(SpeciesId.FEEBAS);
    const source = game.field.getPlayerPokemon();
    const target = game.field.getEnemyPokemon();
    const fightingMove = allMoves[MoveId.BODY_PRESS];
    const basePower = fightingMove.calculateBattlePower(source, target, true, true);
    const boostedPower = fightingMove.calculateBattlePower(source, target, true);

    expect(source.getAllActiveAbilityAttrs().some(attr => attr instanceof ErMultiHeadedAbAttr)).toBe(true);
    expect(source.getMoveType(fightingMove)).toBe(PokemonType.PSYCHIC);
    expect(boostedPower).toBeCloseTo(basePower * BRAIN_OVER_BRAWN_POWER_MULTIPLIER);
  });
});

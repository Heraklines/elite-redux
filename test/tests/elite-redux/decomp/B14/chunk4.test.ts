/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { AbAttr, AllyStatMultiplierAbAttr, StatMultiplierAbAttr } from "#abilities/ab-attrs";
// B14 chunk 4: what the shared L1 and L2 suites cannot see.
//  - The Tier B splits of the Raichu stat classes, Grit, Subversion's category half and Mudball are pure moves of code. Each test compares
//    the refactored `canApply` / `resolveStat` / `resolveCategory` with a literal copy of the ORIGINAL expression (copied from the commit
//    before the split) over every combination of its clauses.
//  - `gateOverride` replaces only the gate; the guards keep running.
//  - The constructor arguments added for the editable params default to the old fixed values.
//  - The markers (Cranisphere, Sharing is Scaring, Electrodynamics' position) have no dispatch moment the twin can reach, so the
//    real engine readers are driven here, with and without the marker, in real battles.
import { allMoves } from "#data/data-lists";
import {
  type CranisphereSkullBashAbAttr,
  erMudballOnOpponentSummon,
  GritAttackStatAbAttr,
  LowerOffenseMoveCategoryAbAttr,
  MudballReactiveAbAttr,
  type SharingIsScaringAbAttr,
} from "#data/elite-redux/abilities/bernerd-roster-mechanics";
import {
  type ElectrodynamicsPositionAbAttr,
  installElectrodynamicsPosition,
  isElectrodynamicsPosition,
  partnerHasRaichuBoostCondition,
  RaichuAllyStatMultiplierAbAttr,
  RaichuTerrainStatMultiplierAbAttr,
} from "#data/elite-redux/abilities/fakemon-pitch-raichu";
import { recomposeAttr } from "#data/elite-redux/ability-studio/build-attr";
import { declRegistry } from "#data/elite-redux/ability-studio/decl-registry";
import { TerrainType } from "#data/terrain";
import { AbilityId } from "#enums/ability-id";
import { BattlerTagType } from "#enums/battler-tag-type";
import { MoveCategory } from "#enums/move-category";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { Stat } from "#enums/stat";
import { StatusEffect } from "#enums/status-effect";
import { GameManager } from "#test/framework/game-manager";
import { liveAbility } from "#test/tests/elite-redux/decomp/harness/twin";
import { setTerrainOf } from "#test/tests/elite-redux/decomp/harness/world";
import { NumberHolder } from "#utils/common";
import Phaser from "phaser";
import { beforeAll, describe, expect, it, vi } from "vitest";

const DEMODULATOR = 6059;
const MODULATOR = 6060;
const ELECTRODYNAMICS = 6062;
const SUBVERSION = 6081;
const CRANISPHERE = 6096;
const MUDBALL = 6097;
const GRIT = 6110;
const SHARING_IS_SCARING = 6115;

const ALL_STATS = [Stat.ATK, Stat.DEF, Stat.SPATK, Stat.SPDEF, Stat.SPD, Stat.ACC, Stat.EVA] as const;
const ALL_TERRAINS = [
  TerrainType.NONE,
  TerrainType.MISTY,
  TerrainType.ELECTRIC,
  TerrainType.GRASSY,
  TerrainType.PSYCHIC,
] as const;

function newGame(
  phaserGame: Phaser.Game,
  options: { ability: number; double?: boolean; enemy?: SpeciesId; enemyMoves?: MoveId[]; moves?: MoveId[] },
) {
  const game = new GameManager(phaserGame);
  game.override
    .battleStyle(options.double === true ? "double" : "single")
    .moveset(options.moves ?? [MoveId.CELEBRATE, MoveId.TACKLE])
    .ability(options.ability as AbilityId)
    .startingLevel(100)
    .enemySpecies(options.enemy ?? SpeciesId.MAGIKARP)
    .enemyLevel(30)
    .enemyAbility(AbilityId.BALL_FETCH)
    .enemyMoveset(options.enemyMoves ?? [MoveId.SPLASH])
    .criticalHits(false)
    .hasPassiveAbility(false)
    .enemyHasPassiveAbility(false);
  if (options.double === true) {
    // A double battle needs a wave the game allows it on (the wave 1 override stays single).
    game.override.startingWave(5);
  }
  return game;
}

describe("B14 chunk 4: Demodulator and Modulator, holder side", () => {
  let phaserGame: Phaser.Game;
  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  it("canApply equals the original (inherited) expression for every stat and terrain, and the rebuild agrees", async () => {
    const game = newGame(phaserGame, { ability: DEMODULATOR });
    await game.classicMode.startBattle(SpeciesId.BLISSEY);
    const holder = game.field.getPlayerPokemon();
    const module = declRegistry.get("RaichuTerrainStatMultiplierAbAttr")!;
    let accepted = 0;
    let compared = 0;
    for (const [attrIndex, expectedStat] of [
      [0, Stat.ATK],
      [1, Stat.DEF],
    ] as const) {
      const attr = liveAbility(DEMODULATOR).attrs[attrIndex] as RaichuTerrainStatMultiplierAbAttr;
      expect(attr.constructor.name).toBe("RaichuTerrainStatMultiplierAbAttr");
      expect([attr.stat, attr.multiplier, attr.terrain]).toEqual([expectedStat, 1.5, TerrainType.ELECTRIC]);
      const rebuilt = recomposeAttr(module, attr, DEMODULATOR, attrIndex) as RaichuTerrainStatMultiplierAbAttr;
      expect(rebuilt.constructor.name).toBe("RaichuTerrainStatMultiplierAbAttr");
      for (const terrain of ALL_TERRAINS) {
        setTerrainOf(game, terrain);
        for (const stat of ALL_STATS) {
          const params = { pokemon: holder, stat, statVal: new NumberHolder(100), move: allMoves[MoveId.TACKLE] };
          // The original: the parent's canApply with the closure the constructor handed over.
          const original = StatMultiplierAbAttr.prototype.canApply.call(attr, params as never);
          expect(attr.canApply(params as never)).toBe(original);
          expect(rebuilt.canApply(params as never)).toBe(original);
          compared++;
          accepted += original ? 1 : 0;
        }
      }
    }
    expect(accepted).toBe(2);
    expect(compared).toBe(70);
  });

  it("a replaced gate replaces only the gate: the stat guard keeps running", async () => {
    const game = newGame(phaserGame, { ability: DEMODULATOR });
    await game.classicMode.startBattle(SpeciesId.BLISSEY);
    const holder = game.field.getPlayerPokemon();
    setTerrainOf(game, TerrainType.NONE);
    const attr = new RaichuTerrainStatMultiplierAbAttr(Stat.ATK, 1.5, TerrainType.ELECTRIC);
    attr.gateOverride = () => true;
    const frame = (stat: Stat) => ({
      pokemon: holder,
      stat,
      statVal: new NumberHolder(100),
      move: allMoves[MoveId.TACKLE],
    });
    expect(attr.canApply(frame(Stat.ATK) as never)).toBe(true);
    expect(attr.canApply(frame(Stat.DEF) as never)).toBe(false);
    attr.gateOverride = () => false;
    setTerrainOf(game, TerrainType.ELECTRIC);
    expect(attr.canApply(frame(Stat.ATK) as never)).toBe(false);
  });

  it("the terrain param moves the compiled gate, and a custom terrain works the same way", async () => {
    const game = newGame(phaserGame, { ability: MODULATOR });
    await game.classicMode.startBattle(SpeciesId.BLISSEY);
    const holder = game.field.getPlayerPokemon();
    const module = declRegistry.get("RaichuTerrainStatMultiplierAbAttr")!;
    const attr = liveAbility(MODULATOR).attrs[0] as RaichuTerrainStatMultiplierAbAttr;
    expect(attr.stat).toBe(Stat.SPATK);
    const grassy = recomposeAttr(module, attr, MODULATOR, 0, { params: { terrain: "GRASSY", multiplier: 2 } });
    expect((grassy as RaichuTerrainStatMultiplierAbAttr).terrain).toBe(TerrainType.GRASSY);
    const frame = { pokemon: holder, stat: Stat.SPATK, statVal: new NumberHolder(100), move: allMoves[MoveId.TACKLE] };
    setTerrainOf(game, TerrainType.ELECTRIC);
    expect(grassy.canApply(frame as never)).toBe(false);
    setTerrainOf(game, TerrainType.GRASSY);
    expect(grassy.canApply(frame as never)).toBe(true);
    grassy.apply(frame as never);
    expect(frame.statVal.value).toBe(200);
    // The inherited condition the parent keeps is the same terrain test (getCondition and the dispatch are unchanged).
    const custom = new RaichuTerrainStatMultiplierAbAttr(Stat.SPD, 1.2, TerrainType.PSYCHIC);
    setTerrainOf(game, TerrainType.PSYCHIC);
    expect(custom.canApply({ ...frame, stat: Stat.SPD } as never)).toBe(true);
    expect(custom.canApply({ ...frame, stat: Stat.SPATK } as never)).toBe(false);
  });
});

describe("B14 chunk 4: Demodulator and Modulator, partner side", () => {
  let phaserGame: Phaser.Game;
  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  it("the new constructor arguments default to the old literals (1.5 and 2) and read back", () => {
    for (const [id, index, stat] of [
      [DEMODULATOR, 2, Stat.ATK],
      [DEMODULATOR, 3, Stat.DEF],
      [MODULATOR, 2, Stat.SPATK],
      [MODULATOR, 3, Stat.SPDEF],
    ] as const) {
      const attr = liveAbility(id).attrs[index] as RaichuAllyStatMultiplierAbAttr;
      expect(attr.constructor.name).toBe("RaichuAllyStatMultiplierAbAttr");
      expect([attr.terrain, attr.normalMultiplier, attr.boostedMultiplier]).toEqual([TerrainType.ELECTRIC, 1.5, 2]);
      expect((attr as unknown as { stat: number }).stat).toBe(stat);
    }
  });

  it("in a double battle canApply and apply equal the original expressions for every stat, terrain and partner state", async () => {
    const game = newGame(phaserGame, { ability: DEMODULATOR, double: true });
    await game.classicMode.startBattle(SpeciesId.BLISSEY, SpeciesId.CHANSEY);
    const [holder, partner] = game.scene.getPlayerField();
    const module = declRegistry.get("RaichuAllyStatMultiplierAbAttr")!;
    const attr = liveAbility(DEMODULATOR).attrs[2] as RaichuAllyStatMultiplierAbAttr;
    const rebuilt = recomposeAttr(module, attr, DEMODULATOR, 2) as RaichuAllyStatMultiplierAbAttr;
    expect(rebuilt.constructor.name).toBe("RaichuAllyStatMultiplierAbAttr");
    let accepted = 0;
    let doubled = 0;
    for (const magnetized of [false, true]) {
      partner.removeTag(BattlerTagType.FLOATING);
      if (magnetized) {
        partner.addTag(BattlerTagType.FLOATING, 5, MoveId.MAGNET_RISE, partner.id);
      }
      expect(partnerHasRaichuBoostCondition(partner)).toBe(magnetized);
      for (const terrain of ALL_TERRAINS) {
        setTerrainOf(game, terrain);
        for (const stat of ALL_STATS) {
          for (const ignoreAbility of [false, true]) {
            const make = () => ({
              pokemon: holder,
              target: partner,
              stat,
              statVal: new NumberHolder(100),
              move: allMoves[MoveId.TACKLE],
              ignoreAbility,
              simulated: false,
            });
            // The original: super.canApply && terrain && battlers > 1, then the literal 1.5 / 2.
            const originalCan =
              AllyStatMultiplierAbAttr.prototype.canApply.call(attr, make() as never)
              && game.scene.arena.terrainType === TerrainType.ELECTRIC
              && (game.scene.currentBattle?.getBattlerCount() ?? 1) > 1;
            for (const subject of [attr, rebuilt]) {
              expect(subject.canApply(make() as never)).toBe(originalCan);
              if (originalCan) {
                const frame = make();
                subject.apply(frame as never);
                expect(frame.statVal.value).toBe(100 * (partnerHasRaichuBoostCondition(partner) ? 2 : 1.5));
              }
            }
            accepted += originalCan ? 1 : 0;
            doubled += originalCan && magnetized ? 1 : 0;
          }
        }
      }
    }
    // Electric terrain and the stat Attack only, with and without ignoreAbility (the attr is not ignorable), for both partner states.
    expect(accepted).toBe(4);
    expect(doubled).toBe(2);
  });

  it("in a single battle the attr does nothing, and a replaced gate replaces only the gate", async () => {
    const game = newGame(phaserGame, { ability: DEMODULATOR });
    await game.classicMode.startBattle(SpeciesId.BLISSEY);
    const holder = game.field.getPlayerPokemon();
    setTerrainOf(game, TerrainType.ELECTRIC);
    const attr = liveAbility(DEMODULATOR).attrs[2] as RaichuAllyStatMultiplierAbAttr;
    const frame = (stat: Stat) => ({
      pokemon: holder,
      target: holder,
      stat,
      statVal: new NumberHolder(100),
      move: allMoves[MoveId.TACKLE],
      ignoreAbility: false,
      simulated: false,
    });
    expect(attr.canApply(frame(Stat.ATK) as never)).toBe(false);
    const custom = new RaichuAllyStatMultiplierAbAttr(Stat.ATK, TerrainType.ELECTRIC, 1.2, 3);
    expect([custom.normalMultiplier, custom.boostedMultiplier]).toEqual([1.2, 3]);
    custom.gateOverride = () => true;
    // The gate is replaced, but the residual (more than one battler per side) still says no in a single battle.
    expect(custom.canApply(frame(Stat.ATK) as never)).toBe(false);
  });
});

describe("B14 chunk 4: Subversion, the category half", () => {
  const user = (attack: number, specialAttack: number) =>
    ({ getStat: (stat: Stat) => (stat === Stat.ATK ? attack : specialAttack) }) as never;
  const move = (category: MoveCategory) => ({ category }) as never;

  it("resolveCategory equals the original expression for every move category and stat order", () => {
    const attr = liveAbility(SUBVERSION).attrs[1] as LowerOffenseMoveCategoryAbAttr;
    expect(attr.constructor.name).toBe("LowerOffenseMoveCategoryAbAttr");
    expect(attr.useHigherStat).toBe(false);
    let answered = 0;
    for (const category of [MoveCategory.PHYSICAL, MoveCategory.SPECIAL, MoveCategory.STATUS]) {
      for (const [attack, specialAttack] of [
        [80, 120],
        [120, 80],
        [100, 100],
      ]) {
        // The original, copied from the code before the split.
        const original =
          category === MoveCategory.STATUS
            ? null
            : attack <= specialAttack
              ? MoveCategory.PHYSICAL
              : MoveCategory.SPECIAL;
        expect(attr.resolveCategory(move(category), user(attack, specialAttack))).toBe(original);
        answered += original === null ? 0 : 1;
      }
    }
    expect(answered).toBe(6);
  });

  it("the higher-stat setting turns the comparison round (a tie stays physical) and a replaced gate keeps nothing else", () => {
    const higher = new LowerOffenseMoveCategoryAbAttr(true);
    expect(higher.resolveCategory(move(MoveCategory.PHYSICAL), user(80, 120))).toBe(MoveCategory.SPECIAL);
    expect(higher.resolveCategory(move(MoveCategory.PHYSICAL), user(120, 80))).toBe(MoveCategory.PHYSICAL);
    expect(higher.resolveCategory(move(MoveCategory.PHYSICAL), user(100, 100))).toBe(MoveCategory.PHYSICAL);
    const open = new LowerOffenseMoveCategoryAbAttr();
    open.gateOverride = () => true;
    // The only clause was the gate, so a status move is now answered too (that is what removing the condition means).
    expect(open.resolveCategory(move(MoveCategory.STATUS), user(80, 120))).toBe(MoveCategory.PHYSICAL);
  });
});

describe("B14 chunk 4: Grit", () => {
  const source = (effect: StatusEffect | undefined) =>
    ({ status: effect === undefined ? undefined : { effect } }) as never;
  const move = {} as never;

  it("resolveStat equals the original expression for every status and both categories", () => {
    const attr = liveAbility(GRIT).attrs[0] as GritAttackStatAbAttr;
    expect(attr.constructor.name).toBe("GritAttackStatAbAttr");
    expect([attr.physicalStat, attr.specialStat]).toEqual([Stat.DEF, Stat.SPDEF]);
    let answered = 0;
    for (const effect of [
      undefined,
      StatusEffect.NONE,
      StatusEffect.FAINT,
      StatusEffect.BURN,
      StatusEffect.POISON,
      StatusEffect.TOXIC,
      StatusEffect.PARALYSIS,
      StatusEffect.SLEEP,
      StatusEffect.FREEZE,
    ]) {
      for (const isPhysical of [true, false]) {
        // The original, copied from the code before the split.
        const src = source(effect) as { status?: { effect: StatusEffect } };
        const original =
          !src.status || src.status.effect === StatusEffect.NONE || src.status.effect === StatusEffect.FAINT
            ? null
            : isPhysical
              ? Stat.DEF
              : Stat.SPDEF;
        expect(attr.resolveStat(move, isPhysical, src as never)).toBe(original);
        answered += original === null ? 0 : 1;
      }
    }
    expect(answered).toBe(12);
  });

  it("custom stats and a replaced gate", () => {
    const custom = new GritAttackStatAbAttr(Stat.SPD, Stat.SPATK);
    expect(custom.resolveStat(move, true, source(StatusEffect.BURN))).toBe(Stat.SPD);
    expect(custom.resolveStat(move, false, source(StatusEffect.BURN))).toBe(Stat.SPATK);
    expect(custom.resolveStat(move, true, source(undefined))).toBeNull();
    custom.gateOverride = () => true;
    expect(custom.resolveStat(move, true, source(undefined))).toBe(Stat.SPD);
  });
});

describe("B14 chunk 4: Mudball", () => {
  let phaserGame: Phaser.Game;
  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  async function answers(
    enemy: SpeciesId,
    attrOverride?: (attr: MudballReactiveAbAttr) => void,
  ): Promise<{ moveId: number; power: number | undefined }[]> {
    const game = newGame(phaserGame, { ability: MUDBALL, enemy });
    await game.classicMode.startBattle(SpeciesId.BLISSEY);
    const holder = game.field.getPlayerPokemon();
    const reactive = holder.getAllActiveAbilityAttrs().find(a => a.constructor.name === "MudballReactiveAbAttr");
    expect(reactive).toBeDefined();
    attrOverride?.(reactive as MudballReactiveAbAttr);
    const spy = vi.spyOn(game.scene.phaseManager, "unshiftNew").mockImplementation((() => undefined) as never);
    erMudballOnOpponentSummon(game.field.getEnemyPokemon());
    const calls = spy.mock.calls
      .filter(call => call[0] === "MovePhase")
      .map(call => {
        const scripted = call[3] as unknown as { moveId: number; power?: number };
        return { moveId: scripted.moveId, power: scripted.power };
      });
    spy.mockRestore();
    return calls;
  }

  it("the settings default to Mud Bomb at 20 power", () => {
    const attr = liveAbility(MUDBALL).attrs[1] as MudballReactiveAbAttr;
    expect(attr.constructor.name).toBe("MudballReactiveAbAttr");
    expect([attr.moveId, attr.power]).toEqual([MoveId.MUD_BOMB, 20]);
  });

  it("a Flying foe that enters is answered with a 20 power Mud Bomb", async () => {
    expect(await answers(SpeciesId.PIDGEY)).toEqual([{ moveId: MoveId.MUD_BOMB, power: 20 }]);
  });

  it("a non-Flying foe that enters is not answered", async () => {
    expect(await answers(SpeciesId.MAGIKARP)).toEqual([]);
  });

  it("a replaced gate answers a non-Flying foe too, and custom settings are used", async () => {
    const calls = await answers(SpeciesId.MAGIKARP, attr => {
      attr.gateOverride = () => true;
    });
    expect(calls).toEqual([{ moveId: MoveId.MUD_BOMB, power: 20 }]);
    const custom = new MudballReactiveAbAttr(MoveId.EMBER, 80);
    expect([custom.moveId, custom.power]).toEqual([MoveId.EMBER, 80]);
  });
});

describe("B14 chunk 4: Cranisphere", () => {
  let phaserGame: Phaser.Game;
  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  it("the marker is an empty class that the charging phase finds by name", () => {
    const attr = liveAbility(CRANISPHERE).attrs[1] as CranisphereSkullBashAbAttr;
    expect(attr.constructor.name).toBe("CranisphereSkullBashAbAttr");
    expect(attr).toBeInstanceOf(AbAttr);
  });

  for (const [name, ability, firstTurnHits] of [
    ["with the marker the first Skull Bash hits at once", CRANISPHERE, true],
    ["without the marker the first Skull Bash charges", AbilityId.BALL_FETCH, false],
  ] as const) {
    it(`through the engine: ${name}`, async () => {
      const game = newGame(phaserGame, { ability, moves: [MoveId.SKULL_BASH, MoveId.CELEBRATE] });
      game.override.enemySpecies(SpeciesId.BLISSEY).enemyLevel(100);
      await game.classicMode.startBattle(SpeciesId.BLISSEY);
      const foe = game.field.getEnemyPokemon();
      const before = foe.hp;
      game.move.select(MoveId.SKULL_BASH);
      await game.toNextTurn();
      if (firstTurnHits) {
        expect(foe.hp).toBeLessThan(before);
      } else {
        expect(foe.hp).toBe(before);
      }
    });
  }

  it("through the engine: the second Skull Bash after entering charges again (once per entry)", async () => {
    const game = newGame(phaserGame, { ability: CRANISPHERE, moves: [MoveId.SKULL_BASH, MoveId.CELEBRATE] });
    game.override.enemySpecies(SpeciesId.BLISSEY).enemyLevel(100);
    await game.classicMode.startBattle(SpeciesId.BLISSEY);
    const foe = game.field.getEnemyPokemon();
    game.move.select(MoveId.SKULL_BASH);
    await game.toNextTurn();
    const afterFirst = foe.hp;
    expect(afterFirst).toBeLessThan(foe.getMaxHp());
    game.move.select(MoveId.SKULL_BASH);
    await game.toNextTurn();
    // The second use only charges: no new damage this turn.
    expect(foe.hp).toBe(afterFirst);
  });
});

describe("B14 chunk 4: Sharing is Scaring", () => {
  let phaserGame: Phaser.Game;
  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  it("the class is the empty subclass: the setting reads back as every stat and the rebuild keeps the class name", () => {
    const attr = liveAbility(SHARING_IS_SCARING).attrs[0] as SharingIsScaringAbAttr;
    expect(attr.constructor.name).toBe("SharingIsScaringAbAttr");
    expect((attr as unknown as { protectedStat?: number }).protectedStat).toBeUndefined();
    const module = declRegistry.get("SharingIsScaringAbAttr")!;
    const rebuilt = recomposeAttr(module, attr, SHARING_IS_SCARING, 0);
    expect(rebuilt.constructor.name).toBe("SharingIsScaringAbAttr");
    expect((rebuilt as unknown as { protectedStat?: number }).protectedStat).toBeUndefined();
    expect(module.decl.params[0].editable).toBe(false);
  });

  for (const [name, ability, holderDrops] of [
    ["the holder keeps its stats and the foe takes the drops", SHARING_IS_SCARING, false],
    ["without the marker the holder takes its own drops and the foe does not", AbilityId.BALL_FETCH, true],
  ] as const) {
    it(`through the engine: Close Combat, ${name}`, async () => {
      const game = newGame(phaserGame, { ability, moves: [MoveId.CLOSE_COMBAT, MoveId.CELEBRATE] });
      game.override.enemySpecies(SpeciesId.BLISSEY).enemyLevel(100);
      await game.classicMode.startBattle(SpeciesId.BLISSEY);
      const holder = game.field.getPlayerPokemon();
      const foe = game.field.getEnemyPokemon();
      game.move.select(MoveId.CLOSE_COMBAT);
      await game.toNextTurn();
      expect(holder.getStatStage(Stat.DEF)).toBe(holderDrops ? -1 : 0);
      expect(holder.getStatStage(Stat.SPDEF)).toBe(holderDrops ? -1 : 0);
      expect(foe.getStatStage(Stat.DEF)).toBe(holderDrops ? 0 : -1);
      expect(foe.getStatStage(Stat.SPDEF)).toBe(holderDrops ? 0 : -1);
    });
  }
});

describe("B14 chunk 4: Electrodynamics, the slot mark", () => {
  let phaserGame: Phaser.Game;
  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  it("entering with the ability marks the slot; a preview marks nothing; marking twice adds one mark", async () => {
    const game = newGame(phaserGame, { ability: AbilityId.BALL_FETCH });
    await game.classicMode.startBattle(SpeciesId.BLISSEY);
    const holder = game.field.getPlayerPokemon();
    const attr = liveAbility(ELECTRODYNAMICS).attrs[1] as ElectrodynamicsPositionAbAttr;
    expect(attr.constructor.name).toBe("ElectrodynamicsPositionAbAttr");
    const tags = () => game.scene.arena.positionalTagManager.tags;
    expect(isElectrodynamicsPosition(holder)).toBe(false);
    expect(holder.isGrounded()).toBe(true);
    attr.apply({ pokemon: holder, simulated: true } as never);
    expect(isElectrodynamicsPosition(holder)).toBe(false);
    attr.apply({ pokemon: holder, simulated: false } as never);
    expect(isElectrodynamicsPosition(holder)).toBe(true);
    expect(holder.isGrounded()).toBe(false);
    const count = tags().length;
    attr.apply({ pokemon: holder, simulated: false } as never);
    installElectrodynamicsPosition(holder);
    expect(tags().length).toBe(count);
  });

  it("through the engine: a holder that enters with the ability is on a marked slot", async () => {
    const game = newGame(phaserGame, { ability: ELECTRODYNAMICS });
    await game.classicMode.startBattle(SpeciesId.BLISSEY);
    const holder = game.field.getPlayerPokemon();
    expect(isElectrodynamicsPosition(holder)).toBe(true);
  });
});

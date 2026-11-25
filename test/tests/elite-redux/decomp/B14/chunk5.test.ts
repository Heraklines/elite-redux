/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { StatMultiplierAbAttr } from "#abilities/ab-attrs";
// B14 chunk 5: what the shared L1 and L2 suites cannot see.
//  - The conditions of Psionic, Electrodynamics (power rider and Galvanize pair) are constructor closures that stay LEGACY bindings until
//    library atoms exist. Each closure is compared with the tree planned for the library (written out in the declaration and in
//    requests/B14.md) over every state of its clauses, so the librarian can copy the formulas as they stand.
//  - Surges Up is fully bound: the rebuilt attr must agree with the original for every stat and terrain.
//  - Synchronized Current's two Tier B classes are pure moves of code. Each gate is compared with a literal copy of the ORIGINAL
//    canApply over every combination of its clauses; apply is driven in a real double battle; `gateOverride` replaces only the gate.
//  - The marker (a flag with no dispatch moment) is driven through the real engine reader: two allies damaging one foe paralyze it.
import { allMoves } from "#data/data-lists";
import {
  ElectrodynamicsGalvanizeAbAttr,
  ElectrodynamicsGalvanizePowerAbAttr,
  ElectrodynamicsTerrainPowerAbAttr,
  installElectrodynamicsPosition,
  isElectrodynamicsPosition,
  PsionicTerrainPowerAbAttr,
  RaichuAllTerrainSurgeSurferAbAttr,
} from "#data/elite-redux/abilities/fakemon-pitch-raichu";
import {
  ER_SYNCHRONIZED_CURRENT_ABILITY_ID,
  SynchronizedCurrentAbAttr,
  SynchronizedCurrentBothAttackPowerAbAttr,
  SynchronizedCurrentHealAbAttr,
} from "#data/elite-redux/abilities/plusle-minun";
import { resetTurnAttackLedger } from "#data/elite-redux/abilities/turn-attack-ledger";
import { recomposeAttr } from "#data/elite-redux/ability-studio/build-attr";
import { declRegistry } from "#data/elite-redux/ability-studio/decl-registry";
import { TerrainType } from "#data/terrain";
import { AbilityId } from "#enums/ability-id";
import { Command } from "#enums/command";
import { MoveCategory } from "#enums/move-category";
import { MoveId } from "#enums/move-id";
import { PokemonType } from "#enums/pokemon-type";
import { PositionalTagType } from "#enums/positional-tag-type";
import { SpeciesId } from "#enums/species-id";
import { Stat } from "#enums/stat";
import { StatusEffect } from "#enums/status-effect";
import type { Pokemon } from "#field/pokemon";
import { noAbilityTypeOverrideMoves } from "#moves/invalid-moves";
import { GameManager } from "#test/framework/game-manager";
import { liveAbility } from "#test/tests/elite-redux/decomp/harness/twin";
import { setTerrainOf } from "#test/tests/elite-redux/decomp/harness/world";
import { NumberHolder } from "#utils/common";
import Phaser from "phaser";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

const SURGES_UP = 6061;
const ELECTRODYNAMICS = 6062;
const PSIONIC = 6063;
const SYNC = ER_SYNCHRONIZED_CURRENT_ABILITY_ID;

const ALL_TERRAINS = [
  TerrainType.NONE,
  TerrainType.MISTY,
  TerrainType.ELECTRIC,
  TerrainType.GRASSY,
  TerrainType.PSYCHIC,
] as const;
const ALL_STATS = [Stat.ATK, Stat.DEF, Stat.SPATK, Stat.SPDEF, Stat.SPD, Stat.ACC, Stat.EVA] as const;

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

/** The original closure of an attr built with the parent's constructor: the private `condition` field. */
function conditionOf(attr: unknown): (user: Pokemon, target: Pokemon | null, move: unknown) => boolean {
  return (attr as { condition: (user: Pokemon, target: Pokemon | null, move: unknown) => boolean }).condition;
}

/** Marks the holder's battle slot as charged (or clears the mark), through the same code the ability uses. */
function setCharged(game: GameManager, holder: Pokemon, charged: boolean): void {
  isElectrodynamicsPosition(holder); // let the module memory follow the current battle before the marks are touched
  const manager = game.scene.arena.positionalTagManager;
  manager.tags = manager.tags.filter(
    tag =>
      !(tag.tagType === PositionalTagType.ELECTRODYNAMICS_POSITION && tag.targetIndex === holder.getBattlerIndex()),
  );
  if (charged) {
    installElectrodynamicsPosition(holder);
  }
  expect(isElectrodynamicsPosition(holder)).toBe(charged);
}

describe("B14 chunk 5: Psionic and Electrodynamics power riders", () => {
  let phaserGame: Phaser.Game;
  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("the defaults equal the old hard-coded values and the class names are unchanged", () => {
    const psionic = new PsionicTerrainPowerAbAttr();
    const electro = new ElectrodynamicsTerrainPowerAbAttr();
    const power = new ElectrodynamicsGalvanizePowerAbAttr();
    const galvanize = new ElectrodynamicsGalvanizeAbAttr();
    expect([psionic.getPowerMultiplier(), electro.getPowerMultiplier(), power.getPowerMultiplier()]).toEqual([
      1.3, 1.3, 1.2,
    ]);
    expect((galvanize as unknown as { newType: PokemonType }).newType).toBe(PokemonType.ELECTRIC);
    expect([psionic, electro, power, galvanize].map(attr => attr.constructor.name)).toEqual([
      "PsionicTerrainPowerAbAttr",
      "ElectrodynamicsTerrainPowerAbAttr",
      "ElectrodynamicsGalvanizePowerAbAttr",
      "ElectrodynamicsGalvanizeAbAttr",
    ]);
    // The live attrs of the shipped abilities are the same classes in the same places.
    expect(liveAbility(PSIONIC).attrs[0]).toBeInstanceOf(PsionicTerrainPowerAbAttr);
    expect(liveAbility(ELECTRODYNAMICS).attrs[0]).toBeInstanceOf(ElectrodynamicsTerrainPowerAbAttr);
    expect(liveAbility(ELECTRODYNAMICS).attrs[4]).toBeInstanceOf(ElectrodynamicsGalvanizeAbAttr);
    expect(liveAbility(ELECTRODYNAMICS).attrs[5]).toBeInstanceOf(ElectrodynamicsGalvanizePowerAbAttr);
    // The declarations are registered, and the closures of the five shipped attrs are bound (one to the library, four legacy).
    for (const name of [
      "PsionicTerrainPowerAbAttr",
      "ElectrodynamicsTerrainPowerAbAttr",
      "ElectrodynamicsGalvanizeAbAttr",
      "ElectrodynamicsGalvanizePowerAbAttr",
      "RaichuAllTerrainSurgeSurferAbAttr",
      "SynchronizedCurrentBothAttackPowerAbAttr",
      "SynchronizedCurrentHealAbAttr",
    ]) {
      expect(declRegistry.get(name), name).toBeDefined();
    }
  });

  it("Psionic's closure equals the tree planned for the library over every state of its clauses", async () => {
    const game = newGame(phaserGame, { ability: PSIONIC });
    await game.classicMode.startBattle(SpeciesId.BLISSEY);
    const holder = game.field.getPlayerPokemon();
    const foe = game.field.getEnemyPokemon();
    const condition = conditionOf(liveAbility(PSIONIC).attrs[0]);
    const ELECTRIC = PokemonType.ELECTRIC;
    const PSYCHIC = PokemonType.PSYCHIC;
    let owned = new Set<AbilityId>();
    vi.spyOn(holder, "hasAbility").mockImplementation(((id: AbilityId) => owned.has(id)) as never);
    let grounded = true;
    vi.spyOn(holder, "isGrounded").mockImplementation(() => grounded);
    let truths = 0;
    let falsehoods = 0;
    let compared = 0;
    for (const charged of [false, true]) {
      setCharged(game, holder, charged);
      for (const terrain of ALL_TERRAINS) {
        setTerrainOf(game, terrain);
        for (const moveId of [MoveId.TACKLE, MoveId.THUNDERBOLT, MoveId.PSYCHIC, MoveId.EMBER]) {
          const move = allMoves[moveId];
          for (const psionic of [false, true]) {
            for (const electro of [false, true]) {
              owned = new Set<AbilityId>([
                ...(psionic ? [PSIONIC as AbilityId] : []),
                ...(electro ? [ELECTRODYNAMICS as AbilityId] : []),
              ]);
              for (const isGrounded of [false, true]) {
                grounded = isGrounded;
                const type = holder.getMoveType(move);
                // The tree planned for the library (PsionicTerrainPowerAbAttr.decl.ts).
                const tree =
                  ((type === ELECTRIC && terrain !== TerrainType.ELECTRIC)
                    || (type === PSYCHIC && terrain !== TerrainType.PSYCHIC))
                  && (psionic || (type === ELECTRIC && electro && charged))
                  && (isGrounded || (charged && (type === ELECTRIC || psionic)));
                const original = condition(holder, foe, move);
                expect(
                  original,
                  `${MoveId[moveId]} terrain ${terrain} psionic ${psionic} electro ${electro} grounded ${isGrounded} charged ${charged}`,
                ).toBe(tree);
                compared++;
                truths += original ? 1 : 0;
                falsehoods += original ? 0 : 1;
              }
            }
          }
        }
      }
    }
    expect(compared).toBe(2 * 5 * 4 * 2 * 2 * 2);
    expect(truths).toBeGreaterThan(20);
    expect(falsehoods).toBeGreaterThan(20);
  });

  it("Electrodynamics' power closure equals its tree, and never applies to a holder that has Psionic", async () => {
    const game = newGame(phaserGame, { ability: ELECTRODYNAMICS });
    await game.classicMode.startBattle(SpeciesId.BLISSEY);
    const holder = game.field.getPlayerPokemon();
    const foe = game.field.getEnemyPokemon();
    const condition = conditionOf(liveAbility(ELECTRODYNAMICS).attrs[0]);
    let owned = new Set<AbilityId>();
    vi.spyOn(holder, "hasAbility").mockImplementation(((id: AbilityId) => owned.has(id)) as never);
    let grounded = true;
    vi.spyOn(holder, "isGrounded").mockImplementation(() => grounded);
    let truths = 0;
    let withPsionic = 0;
    for (const charged of [false, true]) {
      setCharged(game, holder, charged);
      for (const terrain of ALL_TERRAINS) {
        setTerrainOf(game, terrain);
        for (const moveId of [MoveId.TACKLE, MoveId.THUNDERBOLT, MoveId.PSYCHIC, MoveId.EMBER]) {
          const move = allMoves[moveId];
          for (const psionic of [false, true]) {
            for (const electro of [false, true]) {
              owned = new Set<AbilityId>([
                ...(psionic ? [PSIONIC as AbilityId] : []),
                ...(electro ? [ELECTRODYNAMICS as AbilityId] : []),
              ]);
              for (const isGrounded of [false, true]) {
                grounded = isGrounded;
                const type = holder.getMoveType(move);
                // The tree planned for the library (ElectrodynamicsTerrainPowerAbAttr.decl.ts).
                const tree =
                  !psionic && type === PokemonType.ELECTRIC && terrain !== TerrainType.ELECTRIC && electro && charged;
                const original = condition(holder, foe, move);
                expect(
                  original,
                  `${MoveId[moveId]} terrain ${terrain} psionic ${psionic} electro ${electro} grounded ${isGrounded} charged ${charged}`,
                ).toBe(tree);
                truths += original ? 1 : 0;
                withPsionic += original && psionic ? 1 : 0;
              }
            }
          }
        }
      }
    }
    expect(truths).toBeGreaterThan(0);
    expect(withPsionic).toBe(0);
  });

  it("the Galvanize type change and its power rider share one closure that equals the planned tree", async () => {
    const game = newGame(phaserGame, { ability: ELECTRODYNAMICS });
    await game.classicMode.startBattle(SpeciesId.BLISSEY);
    const holder = game.field.getPlayerPokemon();
    const foe = game.field.getEnemyPokemon();
    const typeAttr = liveAbility(ELECTRODYNAMICS).attrs[4];
    const powerAttr = liveAbility(ELECTRODYNAMICS).attrs[5];
    expect(conditionOf(typeAttr)).toBe(conditionOf(powerAttr));
    const condition = conditionOf(typeAttr);
    const ATE = [AbilityId.AERILATE, AbilityId.PIXILATE, AbilityId.REFRIGERATE];
    let owned = new Set<AbilityId>();
    vi.spyOn(holder, "hasAbility").mockImplementation(((id: AbilityId) => owned.has(id)) as never);
    let teraType = PokemonType.ELECTRIC;
    vi.spyOn(holder, "getTeraType").mockImplementation(() => teraType);
    let terapagos = false;
    vi.spyOn(holder, "hasSpecies").mockImplementation(
      ((species: SpeciesId) => species === SpeciesId.TERAPAGOS && terapagos) as never,
    );
    let truths = 0;
    let falsehoods = 0;
    let compared = 0;
    const moves = [
      MoveId.TACKLE,
      MoveId.WEATHER_BALL,
      MoveId.HIDDEN_POWER,
      MoveId.TERA_BLAST,
      MoveId.TERA_STARSTORM,
      MoveId.THUNDERBOLT,
    ];
    for (const moveId of moves) {
      const move = allMoves[moveId];
      for (const tera of [false, true]) {
        holder.isTerastallized = tera;
        for (const stellar of [false, true]) {
          teraType = stellar ? PokemonType.STELLAR : PokemonType.ELECTRIC;
          for (const isTerapagos of [false, true]) {
            terapagos = isTerapagos;
            for (const ate of [undefined, ...ATE]) {
              owned = new Set<AbilityId>(ate === undefined ? [] : [ate]);
              // The tree planned for the library (ElectrodynamicsGalvanizeAbAttr.decl.ts).
              const tree =
                move.type === PokemonType.NORMAL
                && !noAbilityTypeOverrideMoves.has(moveId)
                && ate === undefined
                && !(
                  tera
                  && (moveId === MoveId.TERA_BLAST || (moveId === MoveId.TERA_STARSTORM && stellar && isTerapagos))
                );
              const original = condition(holder, foe, move);
              expect(
                original,
                `${MoveId[moveId]} tera ${tera} stellar ${stellar} terapagos ${isTerapagos} ate ${ate}`,
              ).toBe(tree);
              compared++;
              truths += original ? 1 : 0;
              falsehoods += original ? 0 : 1;
            }
          }
        }
      }
    }
    holder.isTerastallized = false;
    expect(compared).toBe(6 * 2 * 2 * 2 * 4);
    expect(truths).toBeGreaterThan(5);
    expect(falsehoods).toBeGreaterThan(5);
  });
});

describe("B14 chunk 5: Surges Up (any terrain, Speed x2)", () => {
  let phaserGame: Phaser.Game;
  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  it("the rebuilt attr agrees with the original for every stat and terrain; the settings are editable", async () => {
    const game = newGame(phaserGame, { ability: SURGES_UP });
    await game.classicMode.startBattle(SpeciesId.BLISSEY);
    const holder = game.field.getPlayerPokemon();
    const module = declRegistry.get("RaichuAllTerrainSurgeSurferAbAttr")!;
    const attr = liveAbility(SURGES_UP).attrs[2] as RaichuAllTerrainSurgeSurferAbAttr;
    expect(attr.constructor.name).toBe("RaichuAllTerrainSurgeSurferAbAttr");
    expect([attr.stat, attr.multiplier]).toEqual([Stat.SPD, 2]);
    const rebuilt = recomposeAttr(module, attr, SURGES_UP, 2) as RaichuAllTerrainSurgeSurferAbAttr;
    expect(rebuilt.constructor.name).toBe("RaichuAllTerrainSurgeSurferAbAttr");
    let accepted = 0;
    for (const terrain of ALL_TERRAINS) {
      setTerrainOf(game, terrain);
      for (const stat of ALL_STATS) {
        const params = { pokemon: holder, stat, statVal: new NumberHolder(100), move: allMoves[MoveId.TACKLE] };
        // The original: the parent's canApply with the closure `() => isAnyTerrainActive()`.
        const original = stat === Stat.SPD && terrain !== TerrainType.NONE;
        expect(StatMultiplierAbAttr.prototype.canApply.call(attr, params as never)).toBe(original);
        expect(attr.canApply(params as never)).toBe(original);
        expect(rebuilt.canApply(params as never)).toBe(original);
        accepted += original ? 1 : 0;
      }
    }
    expect(accepted).toBe(4);
    // apply: x2 by default; a changed stat and multiplier are honoured.
    const speed = new NumberHolder(100);
    attr.apply({ pokemon: holder, stat: Stat.SPD, statVal: speed } as never);
    expect(speed.value).toBe(200);
    const custom = new RaichuAllTerrainSurgeSurferAbAttr(Stat.ATK, 3);
    setTerrainOf(game, TerrainType.GRASSY);
    const attack = new NumberHolder(100);
    expect(custom.canApply({ pokemon: holder, stat: Stat.ATK, statVal: attack, move: undefined } as never)).toBe(true);
    custom.apply({ pokemon: holder, stat: Stat.ATK, statVal: attack } as never);
    expect(attack.value).toBe(300);
  });
});

describe("B14 chunk 5: Synchronized Current, the both-attack power boost", () => {
  let phaserGame: Phaser.Game;
  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("canApply equals the original expression for every move category, ally state and ally command", async () => {
    const game = newGame(phaserGame, { ability: SYNC, double: true });
    await game.classicMode.startBattle(SpeciesId.PLUSLE, SpeciesId.MINUN);
    const [holder, ally] = game.scene.getPlayerField();
    const battle = game.scene.currentBattle;
    const attr = liveAbility(SYNC).attrs[1] as SynchronizedCurrentBothAttackPowerAbAttr;
    expect(attr.constructor.name).toBe("SynchronizedCurrentBothAttackPowerAbAttr");
    expect(attr.powerMultiplier).toBe(1.25);
    const original = (move: (typeof allMoves)[MoveId]): boolean => {
      // Copied from the code before the split.
      if (move.category === MoveCategory.STATUS) {
        return false;
      }
      const partner = holder.getAllies().find(a => a?.isActive(true));
      if (partner === undefined) {
        return false;
      }
      const cmd = battle.turnCommands?.[partner.getBattlerIndex()];
      if (!cmd || cmd.command !== Command.FIGHT || cmd.move?.move === undefined) {
        return false;
      }
      const category = allMoves[cmd.move.move]?.category;
      return category !== undefined && category !== MoveCategory.STATUS;
    };
    const commands = [
      null,
      { command: Command.FIGHT, move: { move: MoveId.TACKLE } },
      { command: Command.FIGHT, move: { move: MoveId.CELEBRATE } },
      { command: Command.FIGHT },
      { command: Command.POKEMON },
    ];
    let accepted = 0;
    let compared = 0;
    for (const partnerActive of [true, false]) {
      vi.spyOn(ally, "isActive").mockImplementation(() => partnerActive);
      for (const cmd of commands) {
        battle.turnCommands[ally.getBattlerIndex()] = cmd as never;
        for (const moveId of [MoveId.TACKLE, MoveId.CELEBRATE, MoveId.WATER_GUN]) {
          const move = allMoves[moveId];
          const params = { pokemon: holder, opponent: null, move, power: new NumberHolder(100), simulated: false };
          const expected = original(move);
          expect(
            attr.canApply(params as never),
            `${MoveId[moveId]} active ${partnerActive} command ${JSON.stringify(cmd)}`,
          ).toBe(expected);
          compared++;
          accepted += expected ? 1 : 0;
        }
      }
    }
    expect(compared).toBe(30);
    expect(accepted).toBe(2); // active partner with a damaging command, for the two damaging moves
  });

  it("apply multiplies by 1.25 (or the setting) and a replaced gate replaces the whole condition", async () => {
    const game = newGame(phaserGame, { ability: SYNC, double: true });
    await game.classicMode.startBattle(SpeciesId.PLUSLE, SpeciesId.MINUN);
    const [holder, ally] = game.scene.getPlayerField();
    const attr = liveAbility(SYNC).attrs[1] as SynchronizedCurrentBothAttackPowerAbAttr;
    const power = new NumberHolder(100);
    attr.apply({ pokemon: holder, opponent: null, move: allMoves[MoveId.TACKLE], power, simulated: false } as never);
    expect(power.value).toBe(125);
    const custom = new SynchronizedCurrentBothAttackPowerAbAttr(1.5);
    const stronger = new NumberHolder(100);
    custom.apply({
      pokemon: holder,
      opponent: null,
      move: allMoves[MoveId.TACKLE],
      power: stronger,
      simulated: false,
    } as never);
    expect(stronger.value).toBe(150);
    // With no gate override a status move, or an ally that chose nothing, says no; with one, the gate is all there was to replace.
    game.scene.currentBattle.turnCommands[ally.getBattlerIndex()] = null;
    const frame = {
      pokemon: holder,
      opponent: null,
      move: allMoves[MoveId.CELEBRATE],
      power,
      simulated: false,
    } as never;
    expect(custom.canApply(frame)).toBe(false);
    custom.gateOverride = () => true;
    expect(custom.canApply(frame)).toBe(true);
  });

  it("in a single battle there is no ally, so it does nothing", async () => {
    const game = newGame(phaserGame, { ability: SYNC });
    await game.classicMode.startBattle(SpeciesId.PLUSLE);
    const holder = game.field.getPlayerPokemon();
    const attr = liveAbility(SYNC).attrs[1] as SynchronizedCurrentBothAttackPowerAbAttr;
    const params = { pokemon: holder, opponent: null, move: allMoves[MoveId.TACKLE], power: new NumberHolder(100) };
    expect(attr.canApply(params as never)).toBe(false);
  });
});

describe("B14 chunk 5: Synchronized Current, the pair heal", () => {
  let phaserGame: Phaser.Game;
  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("canApply equals the original expression for every ally state and every 'attacked' state of both", async () => {
    const game = newGame(phaserGame, { ability: SYNC, double: true });
    await game.classicMode.startBattle(SpeciesId.PLUSLE, SpeciesId.MINUN);
    const [holder, ally] = game.scene.getPlayerField();
    const attr = liveAbility(SYNC).attrs[2] as SynchronizedCurrentHealAbAttr;
    expect(attr.constructor.name).toBe("SynchronizedCurrentHealAbAttr");
    expect(attr.healFraction).toBe(0.25);
    // The states one Pokemon can be in at the end of a turn: (acted, last move).
    const states: { acted: boolean; last: MoveId | undefined }[] = [
      { acted: false, last: undefined },
      { acted: false, last: MoveId.TACKLE },
      { acted: true, last: MoveId.TACKLE },
      { acted: true, last: MoveId.CELEBRATE },
      { acted: true, last: MoveId.NONE },
      { acted: true, last: undefined },
    ];
    const attacked = (mon: Pokemon): boolean => {
      // Copied from the code before the split (attackedThisTurn).
      if (!mon.turnData.acted) {
        return false;
      }
      const last = mon.getLastXMoves(1)[0];
      return last !== undefined && last.move !== MoveId.NONE && allMoves[last.move]?.category !== MoveCategory.STATUS;
    };
    const put = (mon: Pokemon, state: { acted: boolean; last: MoveId | undefined }) => {
      mon.turnData.acted = state.acted;
      vi.spyOn(mon, "getLastXMoves").mockImplementation((() =>
        state.last === undefined ? [] : [{ move: state.last }]) as never);
    };
    let accepted = 0;
    let compared = 0;
    for (const partnerActive of [true, false]) {
      vi.spyOn(ally, "isActive").mockImplementation(() => partnerActive);
      for (const mine of states) {
        for (const theirs of states) {
          put(holder, mine);
          put(ally, theirs);
          const partner = holder.getAllies().find(a => a?.isActive(true));
          const expected = partner !== undefined && !attacked(holder) && !attacked(partner);
          expect(attr.canApply({ pokemon: holder, simulated: false } as never)).toBe(expected);
          compared++;
          accepted += expected ? 1 : 0;
        }
      }
    }
    expect(compared).toBe(72);
    expect(accepted).toBe(25); // five "did not attack" states for each of the two Pokemon, with an active partner
  });

  it("apply heals each of the pair a quarter once per turn, skips previews and full-HP mons, and honours the setting", async () => {
    const game = newGame(phaserGame, { ability: SYNC, double: true });
    await game.classicMode.startBattle(SpeciesId.PLUSLE, SpeciesId.MINUN);
    const [holder, ally] = game.scene.getPlayerField();
    const battle = game.scene.currentBattle;
    const attr = liveAbility(SYNC).attrs[2] as SynchronizedCurrentHealAbAttr;
    const quarter = (mon: Pokemon) => Math.max(1, Math.floor(mon.getMaxHp() * 0.25));
    const hurt = () => {
      holder.hp = 1;
      ally.hp = 1;
    };
    battle.turn = 9001;
    hurt();
    // A preview heals nothing.
    attr.apply({ pokemon: holder, simulated: true } as never);
    expect([holder.hp, ally.hp]).toEqual([1, 1]);
    // The real call heals the whole pair.
    attr.apply({ pokemon: holder, simulated: false } as never);
    expect([holder.hp, ally.hp]).toEqual([1 + quarter(holder), 1 + quarter(ally)]);
    // The partner's own copy in the same turn changes nothing (the shared once-per-turn memory), a new turn heals again.
    const afterFirst = [holder.hp, ally.hp];
    attr.apply({ pokemon: ally, simulated: false } as never);
    expect([holder.hp, ally.hp]).toEqual(afterFirst);
    battle.turn = 9002;
    attr.apply({ pokemon: ally, simulated: false } as never);
    expect([holder.hp, ally.hp]).toEqual([afterFirst[0] + quarter(holder), afterFirst[1] + quarter(ally)]);
    // A full-HP holder is skipped, the hurt partner is still healed.
    battle.turn = 9003;
    holder.hp = holder.getMaxHp();
    ally.hp = 1;
    attr.apply({ pokemon: holder, simulated: false } as never);
    expect([holder.hp, ally.hp]).toEqual([holder.getMaxHp(), 1 + quarter(ally)]);
    // A different share of max HP (the editable setting).
    battle.turn = 9004;
    hurt();
    new SynchronizedCurrentHealAbAttr(0.5).apply({ pokemon: holder, simulated: false } as never);
    expect([holder.hp, ally.hp]).toEqual([
      1 + Math.floor(holder.getMaxHp() * 0.5),
      1 + Math.floor(ally.getMaxHp() * 0.5),
    ]);
  });

  it("in a single battle there is no partner; a replaced gate replaces the whole condition", async () => {
    const game = newGame(phaserGame, { ability: SYNC });
    await game.classicMode.startBattle(SpeciesId.PLUSLE);
    const holder = game.field.getPlayerPokemon();
    const attr = liveAbility(SYNC).attrs[2] as SynchronizedCurrentHealAbAttr;
    expect(attr.canApply({ pokemon: holder, simulated: false } as never)).toBe(false);
    const open = new SynchronizedCurrentHealAbAttr();
    open.gateOverride = () => true;
    expect(open.canApply({ pokemon: holder, simulated: false } as never)).toBe(true);
    // apply still finds no partner and heals nothing.
    holder.hp = 1;
    open.apply({ pokemon: holder, simulated: false } as never);
    expect(holder.hp).toBe(1);
  });
});

describe("B14 chunk 5: Synchronized Current, the marker read by the engine", () => {
  let phaserGame: Phaser.Game;
  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  it("the marker is the first attr, has no behaviour of its own and keeps its class name", () => {
    const marker = liveAbility(SYNC).attrs[0];
    expect(marker).toBeInstanceOf(SynchronizedCurrentAbAttr);
    expect(marker.constructor.name).toBe("SynchronizedCurrentAbAttr");
    expect(liveAbility(SYNC).attrs.map(attr => attr.constructor.name)).toEqual([
      "SynchronizedCurrentAbAttr",
      "SynchronizedCurrentBothAttackPowerAbAttr",
      "SynchronizedCurrentHealAbAttr",
    ]);
  });

  /** Both Pokemon of the pair carry the marker; the second one answers with the given move. Returns the status of foe 0. */
  async function paralysisAfter(secondMove: MoveId): Promise<StatusEffect | undefined> {
    resetTurnAttackLedger();
    const game = newGame(phaserGame, {
      ability: SYNC,
      double: true,
      enemy: SpeciesId.WOBBUFFET,
      moves: [MoveId.TACKLE, MoveId.CELEBRATE],
    });
    await game.classicMode.startBattle(SpeciesId.PLUSLE, SpeciesId.MINUN);
    const foe = game.scene.getEnemyField()[0];
    game.move.select(MoveId.TACKLE, 0, 2);
    game.move.select(secondMove, 1, secondMove === MoveId.TACKLE ? 2 : undefined);
    await game.phaseInterceptor.to("BerryPhase", false);
    return foe.status?.effect;
  }

  it("two aligned allies damaging one foe paralyze it", async () => {
    expect(await paralysisAfter(MoveId.TACKLE)).toBe(StatusEffect.PARALYSIS);
  });

  it("one attacker alone does not paralyze the foe", async () => {
    expect(await paralysisAfter(MoveId.CELEBRATE)).toBeUndefined();
  });
});

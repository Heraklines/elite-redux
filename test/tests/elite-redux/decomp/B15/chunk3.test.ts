/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B15 chunk 3 probes: what the shared L1 and L2 suites cannot see.
//   - the six presence markers (Hydrapex, Last Host, Library, Life Preserver, Mycelial Network, Omniform): the constructor arguments added for the
//     typed params keep the old literals as defaults, every param round-trips through the declaration (read from the live attr, rebuilt with a new
//     value), and the engine seam really reads the value from the holder's attr (the seams are driven directly, with stand-ins for a second foe
//     and an ally because the doubles fixtures do not start two player Pokemon on this branch);
//   - Spiteful: the three clauses of canApply in the original order (guard, contact gate, residual), a rebuilt rule with another reduction, the one
//     seeded draw of the PP refund;
//   - the end-of-turn chip damage class: the weather gate (original, rebuilt, a rebuilt rule with another weather), the residual (no valid target).
import { globalScene } from "#app/global-scene";
import { allMoves } from "#data/data-lists";
import { erHydrapexOnHit, HydrapexAbAttr, resetHydrapexGuard } from "#data/elite-redux/abilities/hydrapex";
import { erLastHostUsedWave, erTryLastHost, LastHostAbAttr } from "#data/elite-redux/abilities/last-host";
import {
  erLibraryDamageMultiplier,
  erLibraryRecordFoeMove,
  getLibraryCastPp,
  getRecordedMoves,
  LibraryAbAttr,
  resetLibraryState,
} from "#data/elite-redux/abilities/library";
import {
  erLifePreserverUsedWave,
  erTryLifePreserver,
  LifePreserverAbAttr,
} from "#data/elite-redux/abilities/life-preserver";
import { MycelialNetworkAbAttr } from "#data/elite-redux/abilities/mycelial-network";
import { clearOmniformRegistry, registerOmniformMapping } from "#data/elite-redux/abilities/omniform-registry";
import { ER_OMNIFORM_ABILITY_ID, erOmniformOnMoveStart, OmniformAbAttr } from "#data/elite-redux/abilities/omniform";
import * as omniformMovesets from "#data/elite-redux/omniform-movesets";
import { isErOmniformMon } from "#data/elite-redux/omniform-movesets";
import { PpReductionOnContactAbAttr } from "#data/elite-redux/abilities/pp-reduction-on-contact";
import { PostTurnHurtNonTypedAbAttr } from "#data/elite-redux/abilities/post-turn-hurt-non-typed";
import { readDeclParams, recomposeAttr } from "#data/elite-redux/ability-studio/build-attr";
import { declRegistry } from "#data/elite-redux/ability-studio/decl-registry";
import { PokemonMove } from "#data/moves/pokemon-move";
import { AbilityId } from "#enums/ability-id";
import { BattlerTagLapseType } from "#enums/battler-tag-lapse-type";
import { BattlerTagType } from "#enums/battler-tag-type";
import { HitResult } from "#enums/hit-result";
import { MoveId } from "#enums/move-id";
import { PokemonType } from "#enums/pokemon-type";
import { SpeciesId } from "#enums/species-id";
import { WeatherType } from "#enums/weather-type";
import type { Pokemon } from "#field/pokemon";
import { freshGame, startWorld } from "#test/tests/elite-redux/decomp/harness/game";
import { liveAbility } from "#test/tests/elite-redux/decomp/harness/twin";
import { setWeatherOf } from "#test/tests/elite-redux/decomp/harness/world";
import Phaser from "phaser";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

const MYCELIAL_NETWORK = 5905;
const LAST_HOST = 5906;
const LIFE_PRESERVER = 5916;
const LIBRARY = 5928;
const OMNIFORM = ER_OMNIFORM_ABILITY_ID;
const HYDRAPEX = 5931;
const SPITEFUL = 5247;
const PARASITIC_SPORES = 5314;
const FUNERAL_PYRE = 5367;
const TRASH_HEAP = 5427;
const CHRISTMAS_NIGHTMARE = 5643;

function declared(className: string) {
  const module = declRegistry.get(className);
  expect(module, `${className} must be declared`).toBeDefined();
  return module!;
}

/** Makes `holder` carry `attr` as its only active ability attr (the seams find it by constructor name). */
function carry(holder: Pokemon, attr: unknown): void {
  vi.spyOn(holder, "getAllActiveAbilityAttrs").mockReturnValue([attr] as never);
  vi.spyOn(holder, "isActive").mockReturnValue(true);
}

describe("B15 chunk 3", () => {
  let phaserGame: Phaser.Game;
  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("the markers keep their old numbers by default and the declarations read and rebuild every param", () => {
    it("defaults equal the old literals and the class names are unchanged (the engine seams find them by name)", () => {
      const hydrapex = new HydrapexAbAttr();
      expect([hydrapex.sidePowerShare, hydrapex.maxSideHeads, hydrapex.sideType]).toEqual([0.35, 2, PokemonType.DRAGON]);
      expect(new LastHostAbAttr().hostDamageShare).toBe(0.25);
      expect(new LifePreserverAbAttr().drenchTurns).toBe(2);
      expect(new MycelialNetworkAbAttr().healShare).toBe(0.5);
      const library = new LibraryAbAttr();
      expect([library.maxRecordedMoves, library.castPp, library.damageMultiplier]).toEqual([3, 2, 0.85]);
      expect(new OmniformAbAttr().derivedMoveCount).toBe(3);
      // showAbility keeps its old value (hidden) for every marker.
      for (const attr of [hydrapex, new LastHostAbAttr(), new LifePreserverAbAttr(), new MycelialNetworkAbAttr(), library, new OmniformAbAttr()]) {
        expect(attr.showAbility).toBe(false);
      }
      expect(
        [hydrapex, library, new OmniformAbAttr(), new LastHostAbAttr()].map(attr => attr.constructor.name),
      ).toEqual(["HydrapexAbAttr", "LibraryAbAttr", "OmniformAbAttr", "LastHostAbAttr"]);
    });

    it("every live attr reads back its params and a rebuild with other values carries them", async () => {
      await startWorld(phaserGame);
      const cases: [string, number, number, Record<string, string | number | boolean>, Record<string, unknown>][] = [
        ["HydrapexAbAttr", HYDRAPEX, 0, { sidePowerShare: 0.5, maxSideHeads: 1, sideType: "FIRE" }, { sidePowerShare: 0.5, maxSideHeads: 1, sideType: PokemonType.FIRE }],
        ["LastHostAbAttr", LAST_HOST, 0, { hostDamageShare: 0.5 }, { hostDamageShare: 0.5 }],
        ["LifePreserverAbAttr", LIFE_PRESERVER, 0, { drenchTurns: 4 }, { drenchTurns: 4 }],
        ["MycelialNetworkAbAttr", MYCELIAL_NETWORK, 0, { healShare: 1 }, { healShare: 1 }],
        ["LibraryAbAttr", LIBRARY, 0, { maxRecordedMoves: 5, castPp: 6, damageMultiplier: 0.5 }, { maxRecordedMoves: 5, castPp: 6, damageMultiplier: 0.5 }],
        ["OmniformAbAttr", OMNIFORM, 0, { derivedMoveCount: 1 }, { derivedMoveCount: 1 }],
      ];
      for (const [className, abilityId, index, params, expected] of cases) {
        const original = liveAbility(abilityId).attrs[index];
        expect(original.constructor.name).toBe(className);
        const read = readDeclParams(declared(className), original);
        // The live values are the defaults of the declaration (a param without a default would be a dead slider).
        for (const param of declared(className).decl.params) {
          expect(read[param.id], `${className}.${param.id} is read from the live attr`).toBe(param.default);
        }
        const rebuilt = recomposeAttr(declared(className), original, abilityId, index, { params }) as unknown as Record<string, unknown>;
        expect(rebuilt.constructor.name).toBe(className);
        for (const [field, value] of Object.entries(expected)) {
          expect(rebuilt[field], `${className}.${field}`).toBe(value);
        }
        expect(rebuilt).not.toBe(original);
      }
    });
  });

  describe("Hydrapex", () => {
    it("the seam reads share, count and type from the holder attr; the old defaults still pick Dragon foes at 35 percent", async () => {
      const { holder, foe } = await startWorld(phaserGame);
      const second = Object.create(foe) as typeof foe;
      const third = Object.create(foe) as typeof foe;
      second.getBattlerIndex = () => 2 as never;
      third.getBattlerIndex = () => 3 as never;
      second.isOfType = ((type: PokemonType) => type === PokemonType.DRAGON || type === PokemonType.FIRE) as never;
      third.isOfType = ((type: PokemonType) => type === PokemonType.DRAGON) as never;
      vi.spyOn(holder, "getOpponents").mockReturnValue([foe, second, third]);
      const spy = vi.spyOn(globalScene.phaseManager, "unshiftNew").mockImplementation((() => undefined) as never);

      // Default attr, Bite (biting, Dark, power 60): two Dragon-type foes besides the primary target, each side head 35% of 60 = 21.
      carry(holder, new HydrapexAbAttr());
      resetHydrapexGuard();
      erHydrapexOnHit(holder, foe, allMoves[MoveId.BITE]);
      const bites = spy.mock.calls.filter(call => call[0] === "MovePhase");
      expect(bites.map(call => (call[2] as number[])[0])).toEqual([2, 3]);
      expect(bites.map(call => (call[3] as PokemonMove).getMove().power)).toEqual([21, 21]);
      // Once per move use: the second hit of the same move on the same turn does nothing.
      erHydrapexOnHit(holder, foe, allMoves[MoveId.BITE]);
      expect(spy.mock.calls.filter(call => call[0] === "MovePhase")).toHaveLength(2);

      // Another share, one head, Fire as the type: Ember (Fire) triggers, only the one Fire foe is struck at 50% of its power.
      spy.mockClear();
      carry(holder, new HydrapexAbAttr(0.5, 1, PokemonType.FIRE));
      resetHydrapexGuard();
      erHydrapexOnHit(holder, foe, allMoves[MoveId.EMBER]);
      const fire = spy.mock.calls.filter(call => call[0] === "MovePhase");
      expect(fire.map(call => (call[2] as number[])[0])).toEqual([2]);
      expect(fire.map(call => (call[3] as PokemonMove).getMove().power)).toEqual([
        Math.max(1, Math.round(allMoves[MoveId.EMBER].power * 0.5)),
      ]);

      // The default type does not trigger on Ember (not biting, not Dragon).
      spy.mockClear();
      carry(holder, new HydrapexAbAttr());
      resetHydrapexGuard();
      erHydrapexOnHit(holder, foe, allMoves[MoveId.EMBER]);
      expect(spy.mock.calls.filter(call => call[0] === "MovePhase")).toHaveLength(0);
      resetHydrapexGuard();
    });
  });

  describe("Last Host", () => {
    it("consumes the infested foe with the most HP and hurts it by the attr share, once per battle", async () => {
      const { game, holder, foe } = await startWorld(phaserGame);
      carry(holder, new LastHostAbAttr(0.5));
      const weak = Object.create(foe) as typeof foe;
      Object.defineProperty(weak, "hp", { value: 1 });
      vi.spyOn(holder, "getOpponents").mockReturnValue([weak, foe]);
      for (const mon of [weak, foe]) {
        vi.spyOn(mon, "isActive").mockReturnValue(true);
        vi.spyOn(mon, "getTag").mockReturnValue({} as never);
      }
      const removeTag = vi.spyOn(foe, "removeTag").mockReturnValue(undefined as never);
      const hurt = vi.spyOn(foe, "damageAndUpdate").mockReturnValue(0 as never);
      vi.spyOn(globalScene.phaseManager, "queueMessage").mockImplementation((() => undefined) as never);

      expect(erTryLastHost(holder)).toBe(true);
      expect(removeTag).toHaveBeenCalledWith(BattlerTagType.INFESTATION);
      expect(hurt).toHaveBeenCalledWith(Math.max(1, Math.floor(foe.getMaxHp() * 0.5)), expect.anything());
      expect(erLastHostUsedWave(holder)).toBe(game.scene.currentBattle.waveIndex);
      // Once per battle, even when the foe is still infested.
      expect(erTryLastHost(holder)).toBe(false);
      // A holder that is already down never uses it.
      const fresh = Object.create(holder) as typeof holder;
      Object.defineProperty(fresh, "hp", { value: 0 });
      expect(erTryLastHost(fresh)).toBe(false);
    });
  });

  describe("Life Preserver", () => {
    it("Drenches the attacker for the attr turns, only for the ally of the carrier, once per battle", async () => {
      const { game, holder, foe } = await startWorld(phaserGame);
      const carrier = Object.create(holder) as typeof holder;
      carry(carrier, new LifePreserverAbAttr(4));
      vi.spyOn(holder, "getAllies").mockReturnValue([carrier]);
      vi.spyOn(globalScene.phaseManager, "queueMessage").mockImplementation((() => undefined) as never);
      const addTag = vi.spyOn(foe, "addTag").mockReturnValue(true as never);

      expect(erTryLifePreserver(holder, foe)).toBe(true);
      expect(addTag).toHaveBeenCalledWith(BattlerTagType.ER_DRENCHED, 4, MoveId.NONE, carrier.id);
      expect(erLifePreserverUsedWave(carrier)).toBe(game.scene.currentBattle.waveIndex);
      expect(erTryLifePreserver(holder, foe)).toBe(false);
      // No attacker (indirect damage) never saves.
      expect(erTryLifePreserver(holder, undefined)).toBe(false);
      // The default turns are 2.
      const second = Object.create(holder) as typeof holder;
      carry(second, new LifePreserverAbAttr());
      vi.spyOn(holder, "getAllies").mockReturnValue([second]);
      addTag.mockClear();
      expect(erTryLifePreserver(holder, foe)).toBe(true);
      expect(addTag).toHaveBeenCalledWith(BattlerTagType.ER_DRENCHED, 2, MoveId.NONE, second.id);
    });
  });

  describe("Mycelial Network", () => {
    it("the Infestation tick heals the holder by the attr share of the HP lost and spills the extra to the weakest ally", async () => {
      const { holder, foe } = await startWorld(phaserGame);
      holder.hp = 1;
      foe.hp = foe.getMaxHp();
      expect(foe.addTag(BattlerTagType.INFESTATION, 20, MoveId.INFESTATION, holder.id)).toBe(true);
      const tag = foe.getTag(BattlerTagType.INFESTATION)!;
      const heals: { index: number; amount: number }[] = [];
      vi.spyOn(globalScene.phaseManager, "unshiftNew").mockImplementation(((phase: string, index: number, amount: number) => {
        if (phase === "PokemonHealPhase") {
          heals.push({ index, amount });
        }
      }) as never);
      vi.spyOn(globalScene.phaseManager, "queueMessage").mockImplementation((() => undefined) as never);

      for (const share of [0.5, 1, 0.25]) {
        heals.length = 0;
        carry(holder, new MycelialNetworkAbAttr(share));
        foe.hp = foe.getMaxHp();
        const before = foe.hp;
        tag.lapse(foe, BattlerTagLapseType.TURN_END);
        const dealt = before - foe.hp;
        expect(dealt).toBeGreaterThan(0);
        expect(heals, `share ${share}`).toEqual([{ index: holder.getBattlerIndex(), amount: Math.floor(dealt * share) }]);
      }

      // Overflow: the holder is at full HP, so the whole heal spills to the ally with the lowest HP ratio (none in singles: wasted).
      holder.hp = holder.getMaxHp();
      carry(holder, new MycelialNetworkAbAttr());
      heals.length = 0;
      tag.lapse(foe, BattlerTagLapseType.TURN_END);
      expect(heals).toEqual([]);
      const stand = (ratio: number, index: number) =>
        Object.assign(Object.create(holder), {
          isActive: () => true,
          isFullHp: () => false,
          getHpRatio: () => ratio,
          getBattlerIndex: () => index,
        });
      const ally = stand(0.2, 1);
      const healthy = stand(0.9, 5);
      vi.spyOn(holder, "getAllies").mockReturnValue([healthy, ally] as never);
      foe.hp = foe.getMaxHp();
      const before = foe.hp;
      tag.lapse(foe, BattlerTagLapseType.TURN_END);
      expect(heals).toEqual([{ index: 1, amount: Math.floor((before - foe.hp) / 2) }]);
    });

    it("a holder that is not the Mycelial Network holder (no attr) gets nothing", async () => {
      const { holder, foe } = await startWorld(phaserGame);
      holder.hp = 1;
      foe.addTag(BattlerTagType.INFESTATION, 20, MoveId.INFESTATION, holder.id);
      const spy = vi.spyOn(globalScene.phaseManager, "unshiftNew").mockImplementation((() => undefined) as never);
      vi.spyOn(globalScene.phaseManager, "queueMessage").mockImplementation((() => undefined) as never);
      foe.getTag(BattlerTagType.INFESTATION)!.lapse(foe, BattlerTagLapseType.TURN_END);
      expect(spy.mock.calls.filter(call => call[0] === "PokemonHealPhase")).toHaveLength(0);
    });
  });

  describe("Library", () => {
    it("keeps the attr number of moves, weakens a repeated move by the attr multiplier only on a later turn, and starts with the attr cast PP", async () => {
      const { game, holder, foe } = await startWorld(phaserGame);
      carry(holder, new LibraryAbAttr(2, 5, 0.5));
      resetLibraryState(holder);
      const foeNumber = (id: number) => ({ id, getOpponents: () => [holder] }) as never;
      erLibraryRecordFoeMove(foeNumber(101), allMoves[MoveId.TACKLE]);
      erLibraryRecordFoeMove(foeNumber(102), allMoves[MoveId.BITE]);
      erLibraryRecordFoeMove(foeNumber(103), allMoves[MoveId.EMBER]);
      // A foe is recorded once per battle.
      erLibraryRecordFoeMove(foeNumber(103), allMoves[MoveId.WATER_GUN]);
      expect(getRecordedMoves(holder)).toEqual([MoveId.BITE, MoveId.EMBER]);
      expect(getLibraryCastPp(holder)).toBe(5);
      // The recording turn is exempt; a later turn is weakened by the attr multiplier, and an unrecorded move never is.
      expect(erLibraryDamageMultiplier(holder, allMoves[MoveId.BITE])).toBe(1);
      game.scene.currentBattle.turn += 1;
      expect(erLibraryDamageMultiplier(holder, allMoves[MoveId.BITE])).toBe(0.5);
      expect(erLibraryDamageMultiplier(holder, allMoves[MoveId.TACKLE])).toBe(1);
      game.scene.currentBattle.turn -= 1;
      void foe;

      // The defaults keep the old numbers: three moves, 2 cast PP, x0.85.
      carry(holder, new LibraryAbAttr());
      resetLibraryState(holder);
      for (const [id, move] of [[201, MoveId.TACKLE], [202, MoveId.BITE], [203, MoveId.EMBER], [204, MoveId.WATER_GUN]] as const) {
        erLibraryRecordFoeMove(foeNumber(id), allMoves[move]);
      }
      expect(getRecordedMoves(holder)).toEqual([MoveId.BITE, MoveId.EMBER, MoveId.WATER_GUN]);
      expect(getLibraryCastPp(holder)).toBe(2);
      game.scene.currentBattle.turn += 1;
      expect(erLibraryDamageMultiplier(holder, allMoves[MoveId.EMBER])).toBe(0.85);
      game.scene.currentBattle.turn -= 1;
      resetLibraryState(holder);
    });
  });

  describe("Omniform", () => {
    afterEach(clearOmniformRegistry);

    async function startEevee() {
      clearOmniformRegistry();
      registerOmniformMapping(SpeciesId.EEVEE, 0, PokemonType.WATER, SpeciesId.VAPOREON);
      const game = freshGame(phaserGame);
      game.override
        .battleStyle("single")
        .startingLevel(100)
        .enemyLevel(100)
        .enemySpecies(SpeciesId.SNORLAX)
        .enemyAbility(AbilityId.BALL_FETCH)
        .enemyMoveset(MoveId.SPLASH)
        .ability(OMNIFORM as AbilityId)
        .moveset([MoveId.WATER_GUN, MoveId.EMBER, MoveId.TACKLE, MoveId.SPLASH]);
      await game.classicMode.startBattle(SpeciesId.EEVEE);
      return game.field.getPlayerPokemon();
    }

    it("a form that is only reached through a registered mapping always has its own stored moves, so the learnset pick below is not reached in the game today", async () => {
      const eevee = await startEevee();
      // Every registered holder has a family of more than one form, which is what isErOmniformMon tests.
      expect(isErOmniformMon(eevee)).toBe(true);
      erOmniformOnMoveStart(eevee, allMoves[MoveId.WATER_GUN]);
      expect(eevee.getSpeciesForm().speciesId).toBe(SpeciesId.VAPOREON);
      expect(eevee.getMoveset()[0]?.moveId).toBe(MoveId.WATER_GUN);
    });

    it("the learnset pick (forced by making the holder look like a plain mon) gives as many moves as the attr says, and the used move keeps its slot", async () => {
      const attr = liveAbility(OMNIFORM).attrs[0] as OmniformAbAttr;
      const transformWith = async (count: number) => {
        const eevee = await startEevee();
        const rebuilt = recomposeAttr(declared("OmniformAbAttr"), attr, OMNIFORM, 0, { params: { derivedMoveCount: count } });
        expect((rebuilt as OmniformAbAttr).derivedMoveCount).toBe(count);
        carry(eevee, rebuilt);
        vi.spyOn(omniformMovesets, "isErOmniformMon").mockReturnValue(false);
        vi.spyOn(globalScene.phaseManager, "queueMessage").mockImplementation((() => undefined) as never);
        erOmniformOnMoveStart(eevee, allMoves[MoveId.WATER_GUN]);
        expect(eevee.getSpeciesForm().speciesId).toBe(SpeciesId.VAPOREON);
        return eevee.getMoveset().map(m => m?.moveId);
      };
      const one = await transformWith(1);
      // One derived move: slot 0 is the used move, one other slot is new, the last two slots keep their old moves.
      expect(one[0]).toBe(MoveId.WATER_GUN);
      expect(one.slice(2)).toEqual([MoveId.TACKLE, MoveId.SPLASH]);
      const three = await transformWith(3);
      expect(three[0]).toBe(MoveId.WATER_GUN);
      expect(three[3]).not.toBe(MoveId.SPLASH);
    });
  });

  describe("Spiteful (PP reduction on contact)", () => {
    function hitParams(holder: Pokemon, foe: Pokemon, move: MoveId, hitResult = HitResult.EFFECTIVE, simulated = false) {
      return { pokemon: holder, opponent: foe, move: allMoves[move], hitResult, damage: 10, simulated } as never;
    }

    it("clause order and values: the hit must connect, a contact move is needed, the attacker must know the move; a rebuilt rule follows its reduction", async () => {
      const { game, holder, foe } = await startWorld(phaserGame);
      game.move.changeMoveset(foe, [MoveId.TACKLE, MoveId.WATER_GUN]);
      const original = liveAbility(SPITEFUL).attrs[0] as PpReductionOnContactAbAttr;
      expect(original.getReduction()).toBe(4);
      expect(original.requiresContact()).toBe(true);
      const rebuilt = recomposeAttr(declared("PpReductionOnContactAbAttr"), original, SPITEFUL, 0, {
        params: { reduction: 2 },
      }) as PpReductionOnContactAbAttr;
      expect(rebuilt.getReduction()).toBe(2);
      for (const attr of [original, rebuilt]) {
        // Contact, connected, in the attacker's list: applies.
        expect(attr.canApply(hitParams(holder, foe, MoveId.TACKLE))).toBe(true);
        // Not a contact move.
        expect(attr.canApply(hitParams(holder, foe, MoveId.WATER_GUN))).toBe(false);
        // The hit did not connect.
        expect(attr.canApply(hitParams(holder, foe, MoveId.TACKLE, HitResult.NO_EFFECT))).toBe(false);
        expect(attr.canApply(hitParams(holder, foe, MoveId.TACKLE, HitResult.MISS))).toBe(false);
        // Contact, but the attacker no longer has the move in its list.
        expect(attr.canApply(hitParams(holder, foe, MoveId.SCRATCH))).toBe(false);
      }
      // Without the contact requirement the water move counts too (the gate is always true), the guard and residual still apply.
      const anyHit = new PpReductionOnContactAbAttr({ reduction: 4, contactRequired: false });
      expect(anyHit.canApply(hitParams(holder, foe, MoveId.WATER_GUN))).toBe(true);
      expect(anyHit.canApply(hitParams(holder, foe, MoveId.WATER_GUN, HitResult.NO_EFFECT))).toBe(false);
      expect(anyHit.canApply(hitParams(holder, foe, MoveId.SCRATCH))).toBe(false);
      // A rebuilt rule with the contact gate replaced by "the move is a sound move": a library gate swaps the clause and nothing else.
      const sound = recomposeAttr(declared("PpReductionOnContactAbAttr"), original, SPITEFUL, 0, {
        conds: { gate: { block: "move.flag", params: { flag: "SOUND_BASED" } } },
      }) as PpReductionOnContactAbAttr;
      game.move.changeMoveset(foe, [MoveId.TACKLE, MoveId.HYPER_VOICE]);
      expect(sound.canApply(hitParams(holder, foe, MoveId.HYPER_VOICE))).toBe(true);
      expect(sound.canApply(hitParams(holder, foe, MoveId.TACKLE))).toBe(false);
    });

    it("apply takes the PP (capped by what is left), draws exactly once for the refund and never in a preview", async () => {
      const { game, holder, foe } = await startWorld(phaserGame);
      game.move.changeMoveset(foe, [MoveId.TACKLE]);
      game.move.changeMoveset(holder, [MoveId.SPLASH, MoveId.TACKLE]);
      holder.moveset[1].ppUsed = 3;
      const original = liveAbility(SPITEFUL).attrs[0] as PpReductionOnContactAbAttr;
      const draw = vi.spyOn(holder, "randBattleSeedInt");

      original.apply(hitParams(holder, foe, MoveId.TACKLE, HitResult.EFFECTIVE, true));
      expect(foe.moveset[0].ppUsed).toBe(0);
      expect(draw).not.toHaveBeenCalled();

      original.apply(hitParams(holder, foe, MoveId.TACKLE));
      expect(foe.moveset[0].ppUsed).toBe(4);
      expect(draw).toHaveBeenCalledTimes(1);
      expect(draw).toHaveBeenCalledWith(1);
      // The only used-up move of mine gets the 4 PP back (3 used, so it cannot go below 0).
      expect(holder.moveset[1].ppUsed).toBe(0);

      // Without the refund there is no draw at all.
      draw.mockClear();
      const noRefund = new PpReductionOnContactAbAttr({ reduction: 4, contactRequired: true });
      noRefund.apply(hitParams(holder, foe, MoveId.TACKLE));
      expect(draw).not.toHaveBeenCalled();
    });
  });

  describe("end-of-turn chip damage: the weather gate and the residual", () => {
    const params = (holder: Pokemon) => ({ pokemon: holder, simulated: false }) as never;

    it("Christmas Nightmare: the original and the rebuilt gate agree in Hail, Snow, Rain and clear weather; another weather can be swapped in", async () => {
      const { game, holder } = await startWorld(phaserGame);
      const original = liveAbility(CHRISTMAS_NIGHTMARE).attrs[0] as PostTurnHurtNonTypedAbAttr;
      const rebuilt = recomposeAttr(declared("PostTurnHurtNonTypedAbAttr"), original, CHRISTMAS_NIGHTMARE, 0) as PostTurnHurtNonTypedAbAttr;
      const rain = recomposeAttr(declared("PostTurnHurtNonTypedAbAttr"), original, CHRISTMAS_NIGHTMARE, 0, {
        conds: { gate: { block: "field.weather", params: { weather: "RAIN" } } },
      }) as PostTurnHurtNonTypedAbAttr;
      expect(rebuilt.getRequiredWeathers()).toEqual([WeatherType.HAIL, WeatherType.SNOW]);
      expect(rebuilt.getSafeTypes()).toEqual([]);
      for (const [weather, expected] of [
        [WeatherType.NONE, false],
        [WeatherType.HAIL, true],
        [WeatherType.SNOW, true],
        [WeatherType.RAIN, false],
      ] as const) {
        setWeatherOf(game, weather);
        expect(original.canApply(params(holder)), `original in ${WeatherType[weather]}`).toBe(expected);
        expect(rebuilt.canApply(params(holder)), `rebuilt in ${WeatherType[weather]}`).toBe(expected);
        expect(rain.canApply(params(holder)), `rain rule in ${WeatherType[weather]}`).toBe(weather === WeatherType.RAIN);
      }
    });

    it("the gate is true without weather, the residual still needs a valid target, and fieldWide reaches the ally only", async () => {
      const { holder, foe } = await startWorld(phaserGame);
      const flameCoat = new PostTurnHurtNonTypedAbAttr({ safeTypes: [PokemonType.FIRE], damageFraction: 0.125 });
      expect(flameCoat.gate(params(holder))).toBe(true);
      expect(flameCoat.canApply(params(holder))).toBe(true);
      // A Fire-type foe is spared: no valid target, so the whole rule says no even though the gate is true.
      vi.spyOn(foe, "isOfType").mockImplementation(((type: PokemonType) => type === PokemonType.FIRE) as never);
      expect(flameCoat.gate(params(holder))).toBe(true);
      expect(flameCoat.residual(params(holder))).toBe(false);
      expect(flameCoat.canApply(params(holder))).toBe(false);
      // Removing the gate (an always-true override) cannot make it fire: the residual is still tested.
      flameCoat.gateOverride = () => true;
      expect(flameCoat.canApply(params(holder))).toBe(false);
      // fieldWide: the foe is still spared; add a second non-Fire Pokemon on the field and it becomes valid.
      const wide = new PostTurnHurtNonTypedAbAttr({ safeTypes: [PokemonType.FIRE], damageFraction: 0.125, fieldWide: true });
      const ally = Object.create(foe) as typeof foe;
      ally.isOfType = (() => false) as never;
      vi.spyOn(globalScene, "getField").mockReturnValue([holder, foe, ally] as never);
      expect(wide.canApply(params(holder))).toBe(true);
    });

    it("every user keeps its own list of spared types, share, field switch and Poison Heal switch after a rebuild", async () => {
      await startWorld(phaserGame);
      const module = declared("PostTurnHurtNonTypedAbAttr");
      const expected: Record<number, Record<string, string | number | boolean>> = {
        [PARASITIC_SPORES]: { safeTypes: "GHOST", damageFraction: 0.125, fieldWide: false, poisonHealRecovers: false, requiredWeathers: "" },
        [FUNERAL_PYRE]: { safeTypes: "GHOST,DARK,FIRE", damageFraction: 0.25, fieldWide: false, poisonHealRecovers: false, requiredWeathers: "" },
        [TRASH_HEAP]: { safeTypes: "POISON", damageFraction: 0.125, fieldWide: true, poisonHealRecovers: true, requiredWeathers: "" },
        [CHRISTMAS_NIGHTMARE]: { safeTypes: "", damageFraction: 0.125, fieldWide: false, poisonHealRecovers: false, requiredWeathers: "HAIL,SNOW" },
      };
      for (const [id, values] of Object.entries(expected)) {
        const attrIndex = Number(id) === TRASH_HEAP ? 2 : 0;
        const original = liveAbility(Number(id)).attrs[attrIndex];
        const read = readDeclParams(module, original);
        for (const [key, value] of Object.entries(values)) {
          if (key === "requiredWeathers" && value === "") {
            // null on the live attr is not representable, so the declaration default ("" = any weather) is used.
            expect(read[key] ?? "").toBe("");
          } else {
            expect(read[key], `${id}.${key}`).toBe(value);
          }
        }
        const rebuilt = recomposeAttr(module, original, Number(id), attrIndex) as PostTurnHurtNonTypedAbAttr;
        expect(rebuilt.getDamageFraction()).toBe(values.damageFraction);
        expect(rebuilt.getSafeTypes().length).toBe(String(values.safeTypes).split(",").filter(part => part !== "").length);
      }
    });
  });
});

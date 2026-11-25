/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B15 chunk 1 probes: what the shared L1 and L2 suites cannot see.
//   - the params and conditions that the declarations now expose really drive the class (a rebuilt rule with another value behaves differently);
//   - the state machines (Borrowed Time decay length, Chivalry shares and expiry) and the type graft of Bad Splice with more than one lending teammate;
//   - Rapier's truth table, through the class and through the engine function Move.doesFlagEffectApply.
import { allMoves } from "#data/data-lists";
import {
  type BadSpliceAbAttr,
  ER_BAD_SPLICE_ABILITY_ID,
  erBadSpliceOnLeaveField,
} from "#data/elite-redux/abilities/bad-splice";
import {
  type BrainOverBrawnPowerAbAttr,
  type BrainOverBrawnTypeAbAttr,
  RapierFlagInjectionAbAttr,
  rapierInjectsFlag,
} from "#data/elite-redux/abilities/barbaracle-mechanics";
import { BorrowedTimeSummonAbAttr, erBorrowedTimeState } from "#data/elite-redux/abilities/borrowed-time";
import {
  ChivalryAbAttr,
  erApplyChivalryAllyTransfer,
  erApplyChivalrySwitchRedirect,
  erChivalryRedirectState,
  markChivalryRedirect,
} from "#data/elite-redux/abilities/chivalry";
import { recomposeAttr } from "#data/elite-redux/ability-studio/build-attr";
import { declRegistry } from "#data/elite-redux/ability-studio/decl-registry";
import { AbilityId } from "#enums/ability-id";
import { MoveFlags } from "#enums/move-flags";
import { MoveId } from "#enums/move-id";
import { PokemonType } from "#enums/pokemon-type";
import { SpeciesId } from "#enums/species-id";
import { Stat } from "#enums/stat";
import { GameManager } from "#test/framework/game-manager";
import { startWorld } from "#test/tests/elite-redux/decomp/harness/game";
import { liveAbility } from "#test/tests/elite-redux/decomp/harness/twin";
import { NumberHolder } from "#utils/common";
import Phaser from "phaser";
import { beforeAll, describe, expect, it } from "vitest";

const BODHISATTVA = 6076;
const BRAIN_OVER_BRAWN = 6080;
const RAPIER = 6079;
const BORROWED_TIME = 5910;

function declared(className: string) {
  const module = declRegistry.get(className);
  expect(module, `${className} must be declared`).toBeDefined();
  return module!;
}

const fighting = () => allMoves[MoveId.BRICK_BREAK];
const water = () => allMoves[MoveId.WATER_GUN];
const normal = () => allMoves[MoveId.TACKLE];
type AnyMove = ReturnType<typeof fighting>;

describe("B15 chunk 1", () => {
  let phaserGame: Phaser.Game;
  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  describe("Brain Over Brawn: the condition and the numbers are really editable", () => {
    it("the power rider boosts only native Fighting moves; a rebuilt rule with a Water condition and x1.5 boosts Water moves instead", async () => {
      const { holder, foe } = await startWorld(phaserGame);
      for (const [abilityId, attrIndex] of [
        [BRAIN_OVER_BRAWN, 1],
        [BODHISATTVA, 3],
      ] as const) {
        const original = liveAbility(abilityId).attrs[attrIndex] as BrainOverBrawnPowerAbAttr;
        const power = (move: AnyMove, attr: BrainOverBrawnPowerAbAttr): number => {
          const params = { pokemon: holder, opponent: foe, move, power: new NumberHolder(100), simulated: false };
          if (!attr.canApply(params as never)) {
            return 100;
          }
          attr.apply(params as never);
          return params.power.value;
        };
        expect(power(fighting(), original)).toBe(120);
        expect(power(water(), original)).toBe(100);
        expect(power(normal(), original)).toBe(100);
        const rebuilt = recomposeAttr(declared("BrainOverBrawnPowerAbAttr"), original, abilityId, attrIndex, {
          params: { multiplier: 1.5 },
          conds: { "ctor:0": { block: "move.type", params: { type: "WATER", effective: false } } },
        }) as BrainOverBrawnPowerAbAttr;
        // The old apply override would have kept 100 here (it only boosted native Fighting moves, whatever the condition said).
        expect(power(water(), rebuilt)).toBe(150);
        expect(power(fighting(), rebuilt)).toBe(100);
      }
    });

    it("the type conversion turns Fighting moves into Psychic; a rebuilt rule turns Water moves into Fire", async () => {
      const { holder, foe } = await startWorld(phaserGame);
      const original = liveAbility(BRAIN_OVER_BRAWN).attrs[0] as BrainOverBrawnTypeAbAttr;
      const typeOf = (move: AnyMove, attr: BrainOverBrawnTypeAbAttr): number => {
        const params = {
          pokemon: holder,
          opponent: foe,
          move,
          moveType: new NumberHolder(move.type),
          simulated: false,
        };
        if (!attr.canApply(params as never)) {
          return move.type;
        }
        attr.apply(params as never);
        return params.moveType.value;
      };
      expect(typeOf(fighting(), original)).toBe(PokemonType.PSYCHIC);
      expect(typeOf(water(), original)).toBe(PokemonType.WATER);
      const rebuilt = recomposeAttr(declared("BrainOverBrawnTypeAbAttr"), original, BRAIN_OVER_BRAWN, 0, {
        params: { type: "FIRE" },
        conds: { "ctor:1": { block: "move.type", params: { type: "WATER", effective: false } } },
      }) as BrainOverBrawnTypeAbAttr;
      expect(typeOf(water(), rebuilt)).toBe(PokemonType.FIRE);
      expect(typeOf(fighting(), rebuilt)).toBe(PokemonType.FIGHTING);
    });
  });

  describe("Rapier truth table", () => {
    it("the class equals the free helper for every move and both properties, and its two properties are real settings", () => {
      const rapier = liveAbility(RAPIER).attrs[0] as RapierFlagInjectionAbAttr;
      expect(rapier.firstFlag).toBe(MoveFlags.HORN_BASED);
      expect(rapier.secondFlag).toBe(MoveFlags.SLICING_MOVE);
      let slicingOnly = 0;
      let hornOnly = 0;
      for (const move of allMoves) {
        if (move === undefined) {
          continue;
        }
        for (const flag of [MoveFlags.HORN_BASED, MoveFlags.SLICING_MOVE]) {
          expect(rapier.injects(flag, move)).toBe(rapierInjectsFlag(flag, move));
        }
        // Any other property asked about never gets an injection.
        expect(rapier.injects(MoveFlags.DANCE_MOVE, move)).toBe(false);
        slicingOnly += move.hasFlag(MoveFlags.SLICING_MOVE) && !move.hasFlag(MoveFlags.HORN_BASED) ? 1 : 0;
        hornOnly += move.hasFlag(MoveFlags.HORN_BASED) && !move.hasFlag(MoveFlags.SLICING_MOVE) ? 1 : 0;
      }
      // The probe only means something if both directions have moves to act on.
      expect(slicingOnly).toBeGreaterThan(0);
      expect(hornOnly).toBeGreaterThan(0);
      const other = new RapierFlagInjectionAbAttr(MoveFlags.PUNCHING_MOVE, MoveFlags.SOUND_BASED);
      const punch = allMoves.find(
        move => move?.hasFlag(MoveFlags.PUNCHING_MOVE) && !move.hasFlag(MoveFlags.SOUND_BASED),
      );
      expect(punch).toBeDefined();
      expect(other.injects(MoveFlags.SOUND_BASED, punch!)).toBe(true);
      expect(other.injects(MoveFlags.HORN_BASED, punch!)).toBe(false);
    });

    it("the engine function sees the injected property for a user that carries the attr", async () => {
      const { holder } = await startWorld(phaserGame);
      const rapier = liveAbility(RAPIER).attrs[0] as RapierFlagInjectionAbAttr;
      const slicing = allMoves.find(
        move => move?.hasFlag(MoveFlags.SLICING_MOVE) && !move.hasFlag(MoveFlags.HORN_BASED),
      )!;
      const user = new Proxy(holder, {
        get: (target, key, receiver) =>
          key === "getAllActiveAbilityAttrs" ? () => [rapier] : Reflect.get(target, key, receiver),
      });
      expect(slicing.doesFlagEffectApply({ flag: MoveFlags.HORN_BASED, user })).toBe(true);
      expect(slicing.doesFlagEffectApply({ flag: MoveFlags.HORN_BASED, user: holder })).toBe(false);
    });
  });

  describe("Borrowed Time", () => {
    it("the fade length is a real setting: 5 steps instead of 3, with the exact originals back at the end", async () => {
      const { holder, foe } = await startWorld(phaserGame);
      const decay = liveAbility(BORROWED_TIME).attrs[1];
      const holderBase = holder.getStat(Stat.SPD);
      const foeBase = foe.getStat(Stat.SPD);
      expect(holderBase).not.toBe(foeBase);
      const summon = recomposeAttr(
        declared("BorrowedTimeSummonAbAttr"),
        liveAbility(BORROWED_TIME).attrs[0],
        BORROWED_TIME,
        0,
        { params: { decayTurns: 5 } },
      ) as BorrowedTimeSummonAbAttr;
      expect(summon.decayTurns).toBe(5);
      summon.apply({ pokemon: holder, simulated: false } as never);
      expect(erBorrowedTimeState(holder)?.turns).toBe(5);
      // Full swap right after entering.
      expect(holder.getStat(Stat.SPD)).toBe(Math.max(1, foeBase));
      expect(foe.getStat(Stat.SPD)).toBe(Math.max(1, holderBase));
      for (let step = 1; step <= 4; step++) {
        decay.apply({ pokemon: holder, simulated: false } as never);
        expect(erBorrowedTimeState(holder)?.elapsed).toBe(step);
      }
      decay.apply({ pokemon: holder, simulated: false } as never);
      expect(erBorrowedTimeState(holder)).toBeUndefined();
      expect(holder.getStat(Stat.SPD)).toBe(Math.max(1, holderBase));
      expect(foe.getStat(Stat.SPD)).toBe(Math.max(1, foeBase));
      // A simulated entry changes nothing, and a decay without a swap does not apply.
      new BorrowedTimeSummonAbAttr().apply({ pokemon: holder, simulated: true } as never);
      expect(erBorrowedTimeState(holder)).toBeUndefined();
      expect(decay.canApply({ pokemon: holder, simulated: false } as never)).toBe(false);
    });
  });

  describe("Chivalry", () => {
    function holderStub(attr: ChivalryAbAttr, hp = 200) {
      const stub = {
        id: 7,
        hp,
        onField: true,
        dealt: [] as number[],
        isActive: () => true,
        isFainted: () => stub.hp <= 0,
        isOnField: () => stub.onField,
        getAllActiveAbilityAttrs: () => [attr],
        damageAndUpdate: (amount: number) => {
          stub.dealt.push(amount);
          stub.hp -= amount;
        },
      };
      return stub;
    }

    it("the doubles share is a real setting (default half) and nothing moves for a zero-damage hit", async () => {
      await startWorld(phaserGame);
      for (const [attr, expected] of [
        [new ChivalryAbAttr(), 50],
        [new ChivalryAbAttr(0.3), 30],
      ] as const) {
        const holder = holderStub(attr);
        const victim = { getAllies: () => [holder] } as never;
        expect(erApplyChivalryAllyTransfer(victim, 100)).toBe(expected);
        expect(holder.dealt).toEqual([expected]);
        expect(erApplyChivalryAllyTransfer(victim, 0)).toBe(0);
      }
    });

    it("the switch share and its length are real settings (default a quarter for 1 extra turn), and the mark expires", async () => {
      const { game } = await startWorld(phaserGame);
      const turn = game.scene.currentBattle.turn;
      const switchedHolder = holderStub(new ChivalryAbAttr(), 100);
      const incoming = {} as never;
      markChivalryRedirect(incoming, switchedHolder as never);
      expect(erChivalryRedirectState(incoming)?.expiryTurn).toBe(turn + 1);
      switchedHolder.onField = false;
      expect(erApplyChivalrySwitchRedirect(incoming, 100)).toBe(25);
      expect(switchedHolder.hp).toBe(75);

      const customHolder = holderStub(new ChivalryAbAttr(0.5, 0.4, 3), 100);
      customHolder.onField = false;
      const customIncoming = {} as never;
      markChivalryRedirect(customIncoming, customHolder as never);
      expect(erChivalryRedirectState(customIncoming)?.expiryTurn).toBe(turn + 3);
      expect(erApplyChivalrySwitchRedirect(customIncoming, 100)).toBe(40);
      expect(customHolder.hp).toBe(60);
      // Past the expiry turn the mark is dropped and nothing moves.
      game.scene.currentBattle.turn = turn + 4;
      expect(erApplyChivalrySwitchRedirect(customIncoming, 100)).toBe(0);
      expect(erChivalryRedirectState(customIncoming)).toBeUndefined();
    });
  });

  describe("Bad Splice", () => {
    it("the number of lending teammates is a real setting: 2 teammates give both of their types", async () => {
      const game = new GameManager(phaserGame);
      game.override
        .battleStyle("single")
        .startingLevel(100)
        .enemyLevel(100)
        .enemySpecies(SpeciesId.SNORLAX)
        .enemyAbility(ER_BAD_SPLICE_ABILITY_ID as AbilityId)
        .enemyMoveset(MoveId.SPLASH)
        .ability(AbilityId.BALL_FETCH)
        .moveset(MoveId.SPLASH);
      await game.classicMode.startBattle(SpeciesId.CHARIZARD, SpeciesId.BLASTOISE, SpeciesId.VENUSAUR);
      const active = game.field.getPlayerPokemon();
      const holder = game.field.getEnemyPokemon();
      const live = liveAbility(ER_BAD_SPLICE_ABILITY_ID).attrs[0] as BadSpliceAbAttr;
      expect(live.sourceMemberCount).toBe(1);
      const rebuilt = recomposeAttr(declared("BadSpliceAbAttr"), live, ER_BAD_SPLICE_ABILITY_ID, 0, {
        params: { sourceMemberCount: 2 },
      }) as BadSpliceAbAttr;
      expect(rebuilt.sourceMemberCount).toBe(2);
      // The entry splice (1 teammate) already added Water or Grass and Poison; take it back, then splice with 2 teammates.
      erBadSpliceOnLeaveField(holder);
      expect(active.isOfType(PokemonType.WATER)).toBe(false);
      rebuilt.apply({ pokemon: holder, simulated: true } as never);
      expect(active.isOfType(PokemonType.WATER)).toBe(false);
      rebuilt.apply({ pokemon: holder, simulated: false } as never);
      expect(active.isOfType(PokemonType.WATER)).toBe(true);
      expect(active.isOfType(PokemonType.GRASS)).toBe(true);
      expect(active.isOfType(PokemonType.POISON)).toBe(true);
      expect(active.isOfType(PokemonType.FIRE)).toBe(true);
    });
  });
});

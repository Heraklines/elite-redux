/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B17 chunk 2, part 2 (Phoenix Foliage, Power of Alchemy, Pressure): what the shared L1 grid and the L2 twins cannot see. The grid
// holder never has the Live Current form, never changes its move type, never has a multi-hit move in progress, and the grid foe
// holds no berries and has neutral stat stages. Every test compares the class with a copy of its OLD canApply / apply written
// from the pre-split source, the rebuilt attr (library gate from bindings.ts) where a binding exists, and shows a deliberately
// wrong gate being caught.
import { allMoves, modifierTypes } from "#data/data-lists";
import type {
  PhoenixFoliageHitFormChangeAbAttr,
  PhoenixFoliageUseFormChangeAbAttr,
} from "#data/elite-redux/abilities/fakemon-pitch-mechanics";
import { buildAttr, recomposeAttr } from "#data/elite-redux/ability-studio/build-attr";
import { declRegistry } from "#data/elite-redux/ability-studio/decl-registry";
import { SpeciesFormChangeManualTrigger } from "#data/pokemon-forms/form-change-triggers";
import { BerryType } from "#enums/berry-type";
import { MoveId } from "#enums/move-id";
import { PokemonType } from "#enums/pokemon-type";
import { Stat } from "#enums/stat";
import type { Pokemon } from "#field/pokemon";
import { BerryModifier } from "#modifiers/modifier";
import { startWorld } from "#test/tests/elite-redux/decomp/harness/game";
import { allAttrSites } from "#test/tests/elite-redux/decomp/harness/sites";
import Phaser from "phaser";
import { beforeAll, describe, expect, it, vi } from "vitest";

const PRESSURE = 46;
const POWER_OF_ALCHEMY = 223;
const PHOENIX_FOLIAGE = 6029;
const LIVE_CURRENT = "live-current";

function site(abilityId: number, className: string) {
  const found = allAttrSites().find(s => s.abilityId === abilityId && s.className === className);
  if (found === undefined) {
    throw new Error(`${className} is not an attr of ability ${abilityId}`);
  }
  return found;
}

function rebuildOf(abilityId: number, className: string) {
  const s = site(abilityId, className);
  const module = declRegistry.get(className);
  expect(module, `${className} has a declaration`).toBeDefined();
  return { original: s.attr, rebuilt: recomposeAttr(module!, s.attr, abilityId, s.attrIndex), module: module! };
}

/** What both Phoenix Foliage gates and the library atoms read from a Pokemon. */
function standIn(formKey: string, fainted: boolean, hitsLeft: number, typeOverride?: PokemonType): Pokemon {
  return {
    isFainted: () => fainted,
    getFormKey: () => formKey,
    species: { forms: [{ formKey }] },
    formIndex: 0,
    turnData: { hitsLeft },
    getMoveType: (move: { type: PokemonType }) => typeOverride ?? move.type,
  } as unknown as Pokemon;
}

describe("B17 chunk 2: Phoenix Foliage, Power of Alchemy and Pressure", () => {
  let phaserGame: Phaser.Game;
  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  it("Phoenix Foliage after I attack: old canApply (alive, final hit, not in form, Fire or Electric) for the class, the rebuilt gate and a wrong gate", async () => {
    const { foe } = await startWorld(phaserGame);
    const { original, rebuilt, module } = rebuildOf(PHOENIX_FOLIAGE, "PhoenixFoliageUseFormChangeAbAttr");
    const wrong = buildAttr(
      module,
      {},
      { gate: { block: "mon.in-form", params: { who: "holder", key: LIVE_CURRENT } } },
    );
    const moves = [MoveId.EMBER, MoveId.THUNDER_SHOCK, MoveId.WATER_GUN, MoveId.TACKLE, MoveId.SPLASH];
    let fires = 0;
    let wrongDiffers = false;
    for (const formKey of ["", LIVE_CURRENT]) {
      for (const fainted of [false, true]) {
        for (const hitsLeft of [0, 1, 2, 3]) {
          for (const override of [undefined, PokemonType.FIRE, PokemonType.ELECTRIC, PokemonType.WATER]) {
            for (const move of moves) {
              const mon = standIn(formKey, fainted, hitsLeft, override);
              const type = override ?? allMoves[move].type;
              const params = {
                pokemon: mon,
                opponent: foe,
                move: allMoves[move],
                damage: 5,
                hitResult: 0,
                simulated: false,
              };
              // The OLD canApply.
              const expected =
                !fainted
                && hitsLeft <= 1
                && formKey !== LIVE_CURRENT
                && (type === PokemonType.FIRE || type === PokemonType.ELECTRIC);
              fires += expected ? 1 : 0;
              const label = `form "${formKey}", fainted ${fainted}, hits left ${hitsLeft}, type ${override ?? "own"}, ${MoveId[move]}`;
              expect(original.canApply(params as never), `class, ${label}`).toBe(expected);
              expect(rebuilt.canApply(params as never), `rebuilt from the library gate, ${label}`).toBe(expected);
              wrongDiffers ||= wrong.canApply(params as never) !== expected;
            }
          }
        }
      }
    }
    expect(fires).toBeGreaterThan(0);
    expect(wrongDiffers, "a gate that tests the wrong form rule is caught by this test").toBe(true);
  });

  it("Phoenix Foliage after I am hit: old canApply reads the ATTACKER's move type (class, rebuilt gate, wrong gate)", async () => {
    const { holder } = await startWorld(phaserGame);
    const { original, rebuilt, module } = rebuildOf(PHOENIX_FOLIAGE, "PhoenixFoliageHitFormChangeAbAttr");
    const wrong = buildAttr(module, {}, { gate: { block: "move.type", params: { type: "FIRE", effective: true } } });
    const moves = [MoveId.EMBER, MoveId.THUNDER_SHOCK, MoveId.WATER_GUN, MoveId.TACKLE];
    let fires = 0;
    let wrongDiffers = false;
    for (const formKey of ["", LIVE_CURRENT]) {
      for (const fainted of [false, true]) {
        for (const override of [undefined, PokemonType.FIRE, PokemonType.ELECTRIC, PokemonType.GRASS]) {
          for (const move of moves) {
            // The holder stand-in has a different (neutral) type rule: only the ATTACKER's override must matter.
            const me = standIn(formKey, fainted, 0, PokemonType.GRASS);
            const attacker = standIn("", false, 0, override);
            const type = override ?? allMoves[move].type;
            const params = {
              pokemon: me,
              opponent: attacker,
              move: allMoves[move],
              damage: 5,
              hitResult: 0,
              simulated: false,
            };
            const expected =
              !fainted && formKey !== LIVE_CURRENT && (type === PokemonType.FIRE || type === PokemonType.ELECTRIC);
            fires += expected ? 1 : 0;
            const label = `form "${formKey}", fainted ${fainted}, attacker type ${override ?? "own"}, ${MoveId[move]}`;
            expect(original.canApply(params as never), `class, ${label}`).toBe(expected);
            expect(rebuilt.canApply(params as never), `rebuilt from the library gate, ${label}`).toBe(expected);
            wrongDiffers ||= wrong.canApply(params as never) !== expected;
          }
        }
      }
    }
    expect(fires).toBeGreaterThan(0);
    expect(wrongDiffers, "a gate for Fire only is caught by this test").toBe(true);
    expect(holder).toBeDefined();
  });

  it("Phoenix Foliage: apply asks for the manual form change, once the holder is not in the form, and never for a preview", async () => {
    const { game, holder, foe } = await startWorld(phaserGame);
    const use = site(PHOENIX_FOLIAGE, "PhoenixFoliageUseFormChangeAbAttr").attr as PhoenixFoliageUseFormChangeAbAttr;
    const hit = site(PHOENIX_FOLIAGE, "PhoenixFoliageHitFormChangeAbAttr").attr as PhoenixFoliageHitFormChangeAbAttr;
    const spy = vi.spyOn(game.scene, "triggerPokemonFormChange").mockImplementation((() => true) as never);
    const params = (simulated: boolean) => ({
      pokemon: holder,
      opponent: foe,
      move: allMoves[MoveId.EMBER],
      damage: 5,
      hitResult: 0,
      simulated,
    });
    use.apply(params(true) as never);
    hit.apply(params(true) as never);
    expect(spy).not.toHaveBeenCalled();
    use.apply(params(false) as never);
    hit.apply(params(false) as never);
    expect(spy).toHaveBeenCalledTimes(2);
    expect(spy).toHaveBeenCalledWith(holder, SpeciesFormChangeManualTrigger);
    // Already in the form (stand-in): nothing is asked.
    spy.mockClear();
    use.apply({ ...params(false), pokemon: standIn(LIVE_CURRENT, false, 0) } as never);
    hit.apply({ ...params(false), pokemon: standIn(LIVE_CURRENT, false, 0) } as never);
    expect(spy).not.toHaveBeenCalled();
  });

  it("Power of Alchemy: every berry stack of every adjacent foe is destroyed with one message, nothing for a preview, and a foe without berries is left alone", async () => {
    const { game, holder, foe } = await startWorld(phaserGame);
    const { original, rebuilt } = rebuildOf(POWER_OF_ALCHEMY, "ErTransmuteOpposingBerriesAbAttr");
    const berriesOf = (): BerryModifier[] =>
      game.scene.findModifiers(m => m instanceof BerryModifier && m.pokemonId === foe.id, false) as BerryModifier[];
    const give = (type: BerryType, copies: number): void => {
      for (let i = 0; i < copies; i++) {
        game.scene.addEnemyModifier(
          modifierTypes.BERRY().generateType([], [type])!.newModifier(foe) as BerryModifier,
          true,
          true,
        );
      }
    };
    const messages: string[] = [];
    vi.spyOn(game.scene.phaseManager, "queueMessage").mockImplementation(((text: string) => {
      messages.push(text);
    }) as never);
    for (const attr of [original, rebuilt]) {
      messages.length = 0;
      // A foe with no berries: no message, nothing happens.
      expect(attr.canApply({ pokemon: holder, simulated: false } as never)).toBe(true);
      attr.apply({ pokemon: holder, simulated: false } as never);
      expect(messages).toEqual([]);
      give(BerryType.SITRUS, 3);
      give(BerryType.LIECHI, 1);
      expect(berriesOf().reduce((sum, berry) => sum + berry.stackCount, 0)).toBeGreaterThan(0);
      // A preview keeps everything.
      attr.apply({ pokemon: holder, simulated: true } as never);
      expect(berriesOf().length).toBeGreaterThan(0);
      expect(messages).toEqual([]);
      // The real thing drains every stack and shows one message for the foe.
      attr.apply({ pokemon: holder, simulated: false } as never);
      expect(berriesOf().reduce((sum, berry) => sum + berry.stackCount, 0)).toBe(0);
      expect(messages).toHaveLength(1);
    }
  });

  it("Pressure: every raised stage of every adjacent foe goes to 0, lowered stages stay, nothing for a preview or a fainted foe", async () => {
    const { holder, foe } = await startWorld(phaserGame);
    const { original, rebuilt } = rebuildOf(PRESSURE, "ClearOpponentStatBuffsOnSummonAbAttr");
    const stats = [Stat.ATK, Stat.DEF, Stat.SPATK, Stat.SPDEF, Stat.SPD, Stat.ACC, Stat.EVA] as const;
    const start = [2, -1, 3, -2, 6, 1, 0];
    const end = [0, -1, 0, -2, 0, 0, 0];
    const stagesOf = (): number[] => stats.map(stat => foe.getStatStage(stat));
    for (const attr of [original, rebuilt]) {
      const reset = (): void => stats.forEach((stat, i) => foe.setStatStage(stat, start[i]));
      reset();
      attr.apply({ pokemon: holder, simulated: true } as never);
      expect(stagesOf(), "a preview changes nothing").toEqual(start);
      attr.apply({ pokemon: holder, simulated: false } as never);
      expect(stagesOf()).toEqual(end);
      // A fainted foe is skipped.
      reset();
      vi.spyOn(foe, "isFainted").mockReturnValue(true);
      attr.apply({ pokemon: holder, simulated: false } as never);
      expect(stagesOf(), "a fainted foe keeps its stages").toEqual(start);
      vi.mocked(foe.isFainted).mockRestore();
      expect(attr.canApply({ pokemon: holder, simulated: false } as never)).toBe(true);
    }
  });
});

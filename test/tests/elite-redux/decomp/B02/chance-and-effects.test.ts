/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B02 chunk 2: what the shared L1 and L2 suites cannot see because the harness has no engine-parameter builder (or no
// scenario that reaches the clause) for these triggers (requests B02-9, B02-16). Every test compares the ORIGINAL
// attr of every user with a rebuild made by `recomposeAttr` over a grid of inputs, and reads the draws and mutations.
//  - Serene Grace family and Shield Dust family: `chance` holder over -1, 0, 10, 50, 80, 100 and the two excluded moves.
//  - Ruin family and Eternal Flower: stand-in Pokemon (a Mega, an ordinary foe, the holder, an ally).
//  - Parental Bond and Unrelenting: canApply over real moves, the exact draw order and result table of Unrelenting.
//  - Protean family: the type change of apply, and nothing when simulated.
import type {
  AddSecondStrikeAbAttr,
  AllAttacksMultiHitAbAttr,
  FieldMultiplyStatAbAttr,
  IgnoreMoveEffectsAbAttr,
  MoveEffectChanceMultiplierAbAttr,
  OpposingMegaStatSuppressAbAttr,
  PokemonTypeChangeAbAttr,
} from "#abilities/ab-attrs";
import { allMoves } from "#data/data-lists";
import { recomposeAttr } from "#data/elite-redux/ability-studio/build-attr";
import { declRegistry } from "#data/elite-redux/ability-studio/decl-registry";
import { MoveId } from "#enums/move-id";
import { Stat } from "#enums/stat";
import { startWorld } from "#test/tests/elite-redux/decomp/harness/game";
import { allAttrSites } from "#test/tests/elite-redux/decomp/harness/sites";
import { BooleanHolder, NumberHolder } from "#utils/common";
import Phaser from "phaser";
import { beforeAll, describe, expect, it, vi } from "vitest";

function sitesOf(className: string) {
  return allAttrSites().filter(site => site.className === className);
}

describe("B02 chunk 2: effect chance (Serene Grace, Sheer Force, Shield Dust)", () => {
  let phaserGame: Phaser.Game;
  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  it("every multiplier user agrees with its rebuild on canApply and on the resulting chance", async () => {
    const { holder } = await startWorld(phaserGame);
    const module = declRegistry.get("MoveEffectChanceMultiplierAbAttr")!;
    const sites = sitesOf("MoveEffectChanceMultiplierAbAttr");
    expect(sites.length).toBeGreaterThanOrEqual(4);
    const multipliers = new Set<number>();
    for (const site of sites) {
      const original = site.attr as MoveEffectChanceMultiplierAbAttr;
      const rebuilt = recomposeAttr(
        module,
        original,
        site.abilityId,
        site.attrIndex,
      ) as MoveEffectChanceMultiplierAbAttr;
      expect(rebuilt).not.toBe(original);
      multipliers.add(Reflect.get(original, "chanceMultiplier"));
      for (const move of [MoveId.EMBER, MoveId.ORDER_UP, MoveId.ELECTRO_SHOT, MoveId.THUNDERBOLT]) {
        for (const start of [-1, 0, 0.5, 10, 50, 80, 100]) {
          const a = new NumberHolder(start);
          const b = new NumberHolder(start);
          const pa = { pokemon: holder, move: allMoves[move], chance: a, simulated: true } as never;
          const pb = { pokemon: holder, move: allMoves[move], chance: b, simulated: true } as never;
          const can = original.canApply(pa);
          expect(rebuilt.canApply(pb), `${site.abilityName} ${MoveId[move]} ${start}`).toBe(can);
          if (can) {
            original.apply(pa);
            rebuilt.apply(pb);
          }
          expect(b.value, `${site.abilityName} ${MoveId[move]} ${start}`).toBe(a.value);
          expect(a.value).toBeLessThanOrEqual(Math.max(start, 100));
        }
      }
    }
    expect([...multipliers].sort()).toEqual([0, 2]);
  });

  it("a doubled chance is capped at 100 and Order Up and Electro Shot are never touched", async () => {
    const { holder } = await startWorld(phaserGame);
    const serene = sitesOf("MoveEffectChanceMultiplierAbAttr").find(
      site => Reflect.get(site.attr, "chanceMultiplier") === 2,
    )!;
    const attr = serene.attr as MoveEffectChanceMultiplierAbAttr;
    const chance = new NumberHolder(70);
    attr.apply({ pokemon: holder, move: allMoves[MoveId.EMBER], chance } as never);
    expect(chance.value).toBe(100);
    const can = (move: MoveId, value: number) =>
      attr.canApply({ pokemon: holder, move: allMoves[move], chance: new NumberHolder(value) } as never);
    expect(can(MoveId.ORDER_UP, 30)).toBe(false);
    expect(can(MoveId.ELECTRO_SHOT, 30)).toBe(false);
    expect(can(MoveId.EMBER, -1)).toBe(false);
    expect(can(MoveId.EMBER, 0)).toBe(false);
    expect(can(MoveId.EMBER, 30)).toBe(true);
  });

  it("Shield Dust and its ER twins zero the chance, and only when it is above zero", async () => {
    const { holder } = await startWorld(phaserGame);
    const module = declRegistry.get("IgnoreMoveEffectsAbAttr")!;
    const sites = sitesOf("IgnoreMoveEffectsAbAttr");
    expect(sites.length).toBeGreaterThanOrEqual(3);
    for (const site of sites) {
      const original = site.attr as IgnoreMoveEffectsAbAttr;
      const rebuilt = recomposeAttr(module, original, site.abilityId, site.attrIndex) as IgnoreMoveEffectsAbAttr;
      expect(rebuilt).not.toBe(original);
      for (const start of [-1, 0, 0.5, 10, 100]) {
        const a = new NumberHolder(start);
        const b = new NumberHolder(start);
        const can = original.canApply({ pokemon: holder, move: allMoves[MoveId.EMBER], chance: a } as never);
        expect(rebuilt.canApply({ pokemon: holder, move: allMoves[MoveId.EMBER], chance: b } as never)).toBe(can);
        expect(can).toBe(start > 0);
        if (can) {
          original.apply({ chance: a } as never);
          rebuilt.apply({ chance: b } as never);
          expect(a.value).toBe(0);
          expect(b.value).toBe(0);
        }
      }
    }
  });
});

describe("B02 chunk 2: Ruin auras and Eternal Flower (stand-in Pokemon)", () => {
  /** A Pokemon stand-in with only what the two classes read. */
  function stand(opts: { player: boolean; mega?: boolean; attrs?: unknown[] }) {
    return {
      isPlayer: () => opts.player,
      isMega: () => opts.mega === true,
      getAbilityAttrs: () => opts.attrs ?? [],
    } as never;
  }

  it("every Ruin user agrees with its rebuild over (stat, hasApplied, foe carries a Ruin of the same stat)", () => {
    const module = declRegistry.get("FieldMultiplyStatAbAttr")!;
    const sites = sitesOf("FieldMultiplyStatAbAttr").filter(s => s.attr.constructor.name === "FieldMultiplyStatAbAttr");
    expect(sites.length).toBeGreaterThanOrEqual(4);
    const statsSeen = new Set<unknown>();
    for (const site of sites) {
      const original = site.attr as FieldMultiplyStatAbAttr;
      const rebuilt = recomposeAttr(module, original, site.abilityId, site.attrIndex) as FieldMultiplyStatAbAttr;
      expect(rebuilt).not.toBe(original);
      const own = Reflect.get(original, "stat") as Stat;
      statsSeen.add(own);
      for (const stat of [Stat.ATK, Stat.DEF, Stat.SPATK, Stat.SPDEF, Stat.SPD]) {
        for (const applied of [false, true]) {
          for (const carries of [false, true]) {
            const target = stand({ player: false, attrs: carries ? [{ stat }] : [] });
            const holder = stand({ player: true });
            const mk = () => ({
              pokemon: holder,
              target,
              stat,
              statVal: new NumberHolder(100),
              hasApplied: new BooleanHolder(applied),
            });
            const pa = mk();
            const pb = mk();
            const can = original.canApply(pa as never);
            expect(
              rebuilt.canApply(pb as never),
              `${site.abilityName} ${Stat[stat]} applied=${applied} carries=${carries}`,
            ).toBe(can);
            expect(can).toBe(!applied && stat === own && !carries);
            if (can) {
              original.apply(pa as never);
              rebuilt.apply(pb as never);
              expect(pb.statVal.value).toBe(pa.statVal.value);
              expect(pa.hasApplied.value).toBe(true);
              expect(pb.hasApplied.value).toBe(true);
            }
          }
        }
      }
    }
    expect(statsSeen.size).toBe(4);
  });

  it("Eternal Flower only weakens an opposing Mega, then applies the parent's rules", () => {
    const module = declRegistry.get("OpposingMegaStatSuppressAbAttr")!;
    const sites = sitesOf("OpposingMegaStatSuppressAbAttr");
    expect(sites).toHaveLength(5);
    let applied = 0;
    for (const site of sites) {
      const original = site.attr as OpposingMegaStatSuppressAbAttr;
      const rebuilt = recomposeAttr(module, original, site.abilityId, site.attrIndex) as OpposingMegaStatSuppressAbAttr;
      expect(rebuilt).not.toBe(original);
      expect(rebuilt.constructor).toBe(original.constructor);
      const own = Reflect.get(original, "stat") as Stat;
      const holder = stand({ player: true });
      const cases = [
        { name: "opposing Mega", target: stand({ player: false, mega: true }), expected: true },
        { name: "opposing ordinary form", target: stand({ player: false, mega: false }), expected: false },
        { name: "ally Mega", target: stand({ player: true, mega: true }), expected: false },
        {
          name: "opposing Mega with the same aura",
          target: stand({ player: false, mega: true, attrs: [{ stat: own }] }),
          expected: false,
        },
        { name: "the holder itself", target: holder, expected: false },
      ];
      for (const { name, target, expected } of cases) {
        for (const hasApplied of [false, true]) {
          const mk = () => ({
            pokemon: holder,
            target,
            stat: own,
            statVal: new NumberHolder(200),
            hasApplied: new BooleanHolder(hasApplied),
          });
          const pa = mk();
          const pb = mk();
          const can = original.canApply(pa as never);
          expect(rebuilt.canApply(pb as never), `${Stat[own]} ${name} applied=${hasApplied}`).toBe(can);
          expect(can, `${Stat[own]} ${name} applied=${hasApplied}`).toBe(expected && !hasApplied);
          if (can) {
            original.apply(pa as never);
            rebuilt.apply(pb as never);
            expect(pb.statVal.value).toBe(pa.statVal.value);
            expect(pa.statVal.value).toBeCloseTo(160);
            applied++;
          }
        }
      }
      // a stat the aura is not about is never touched
      const other = own === Stat.ATK ? Stat.DEF : Stat.ATK;
      const p = {
        pokemon: holder,
        target: stand({ player: false, mega: true }),
        stat: other,
        statVal: new NumberHolder(200),
        hasApplied: new BooleanHolder(false),
      };
      expect(original.canApply(p as never)).toBe(false);
      expect(rebuilt.canApply(p as never)).toBe(false);
    }
    expect(applied).toBe(5);
  });
});

describe("B02 chunk 2: extra strikes (Parental Bond, Unrelenting)", () => {
  let phaserGame: Phaser.Game;
  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  it("Parental Bond: canApply is the move helper's verdict and apply adds exactly one strike", async () => {
    const { holder, foe } = await startWorld(phaserGame);
    const module = declRegistry.get("AddSecondStrikeAbAttr")!;
    const sites = sitesOf("AddSecondStrikeAbAttr").filter(
      site => site.attr.constructor.name === "AddSecondStrikeAbAttr",
    );
    expect(sites).toHaveLength(1);
    const original = sites[0].attr as AddSecondStrikeAbAttr;
    const rebuilt = recomposeAttr(module, original, sites[0].abilityId, sites[0].attrIndex) as AddSecondStrikeAbAttr;
    expect(rebuilt).not.toBe(original);
    const verdicts: boolean[] = [];
    for (const move of [
      MoveId.TACKLE,
      MoveId.WATER_GUN,
      MoveId.DOUBLE_SLAP,
      MoveId.SWORDS_DANCE,
      MoveId.FLING,
      MoveId.ENDEAVOR,
      MoveId.SOLAR_BEAM,
    ]) {
      const mk = () => ({ pokemon: holder, opponent: foe, move: allMoves[move], hitCount: new NumberHolder(1) });
      const pa = mk();
      const pb = mk();
      const can = original.canApply(pa as never);
      expect(rebuilt.canApply(pb as never), MoveId[move]).toBe(can);
      expect(can, MoveId[move]).toBe(allMoves[move].canBeMultiStrikeEnhanced(holder, true, foe));
      verdicts.push(can);
      if (can) {
        original.apply(pa as never);
        rebuilt.apply(pb as never);
        expect(pa.hitCount.value).toBe(2);
        expect(pb.hitCount.value).toBe(2);
      }
    }
    expect(verdicts).toContain(true);
    expect(verdicts).toContain(false);
  });

  it("Unrelenting: only a single-hit move, one draw of 20, then 35/35/15/15 over 2, 3, 4, 5", async () => {
    const { holder, foe } = await startWorld(phaserGame);
    const module = declRegistry.get("AllAttacksMultiHitAbAttr")!;
    const sites = sitesOf("AllAttacksMultiHitAbAttr");
    expect(sites).toHaveLength(1);
    const original = sites[0].attr as AllAttacksMultiHitAbAttr;
    const rebuilt = recomposeAttr(module, original, sites[0].abilityId, sites[0].attrIndex) as AllAttacksMultiHitAbAttr;
    expect(rebuilt).not.toBe(original);
    for (const start of [1, 2, 3, 5]) {
      for (const move of [MoveId.TACKLE, MoveId.SWORDS_DANCE, MoveId.DOUBLE_SLAP]) {
        const mk = () => ({ pokemon: holder, opponent: foe, move: allMoves[move], hitCount: new NumberHolder(start) });
        expect(rebuilt.canApply(mk() as never), `${MoveId[move]} from ${start}`).toBe(original.canApply(mk() as never));
        expect(original.canApply(mk() as never)).toBe(
          start === 1 && allMoves[move].canBeMultiStrikeEnhanced(holder, true, foe),
        );
      }
    }
    const table: number[] = [];
    for (let roll = 0; roll < 20; roll++) {
      const results: number[] = [];
      for (const attr of [original, rebuilt]) {
        const spy = vi.spyOn(holder, "randBattleSeedInt").mockReturnValue(roll);
        const hitCount = new NumberHolder(1);
        attr.apply({ pokemon: holder, opponent: foe, move: allMoves[MoveId.TACKLE], hitCount } as never);
        expect(spy).toHaveBeenCalledTimes(1);
        expect(spy).toHaveBeenCalledWith(20);
        spy.mockRestore();
        results.push(hitCount.value);
      }
      expect(results[1], `roll ${roll}`).toBe(results[0]);
      table.push(results[0]);
    }
    const share = (n: number) => table.filter(v => v === n).length / 20;
    expect([share(2), share(3), share(4), share(5)]).toEqual([0.35, 0.35, 0.15, 0.15]);
  });
});

describe("B02 chunk 2: Protean and Libero (become the move's type)", () => {
  let phaserGame: Phaser.Game;
  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  it("canApply and apply agree after a rebuild for every user and several moves, and apply does nothing when simulated", async () => {
    const { holder, foe } = await startWorld(phaserGame);
    const module = declRegistry.get("PokemonTypeChangeAbAttr")!;
    const sites = sitesOf("PokemonTypeChangeAbAttr");
    expect(sites.length).toBeGreaterThanOrEqual(6);
    const results: boolean[] = [];
    for (const site of sites) {
      const original = site.attr as PokemonTypeChangeAbAttr;
      const rebuilt = recomposeAttr(module, original, site.abilityId, site.attrIndex) as PokemonTypeChangeAbAttr;
      expect(rebuilt).not.toBe(original);
      for (const move of [MoveId.TACKLE, MoveId.EMBER, MoveId.STRUGGLE, MoveId.METRONOME, MoveId.WATER_GUN]) {
        const params = { pokemon: holder, opponent: foe, move: allMoves[move], simulated: false } as never;
        const can = original.canApply(params);
        expect(rebuilt.canApply(params), `${site.abilityName} ${MoveId[move]}`).toBe(can);
        results.push(can);
        if (can) {
          const before = holder.summonData.types;
          original.apply({ ...(params as object), simulated: true } as never);
          rebuilt.apply({ ...(params as object), simulated: true } as never);
          expect(holder.summonData.types).toBe(before);
          rebuilt.apply(params);
          expect(holder.summonData.types).toEqual([holder.getMoveType(allMoves[move])]);
          holder.summonData.types = before;
        }
      }
    }
    expect(results).toContain(true);
    expect(results).toContain(false);
  });
});

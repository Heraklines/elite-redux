/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B08 chunk 3, the critical-hit classes (crit-mod.ts, crit-stack-on-ko.ts). What the shared L1 grid and L2 twin cannot show:
//   1. SUSPECTED GAME BUG, not fixed: Pokemon.getCritStage asks BonusCritAbAttr WITHOUT a move, so the move filter of
//      CritStageBonusAbAttr is never evaluated and the six filtered users add their bonus to every move;
//   2. the library atoms WOULD reproduce each filter the day the engine passes the move (for the five filters that can be named);
//   3. CritDamageMultiplierAbAttr and CritStackOnKoAbAttr rebuild to the same numbers, including the cap and the simulated case.
import { allMoves } from "#data/data-lists";
import { normalizeBindingSpec } from "#data/elite-redux/ability-studio/bindings";
import { buildAttr, recomposeAttr } from "#data/elite-redux/ability-studio/build-attr";
import { declRegistry } from "#data/elite-redux/ability-studio/decl-registry";
import { compileCondition } from "#data/elite-redux/ability-studio/vocabulary/evaluate/conditions";
import { type CritDamageMultiplierAbAttr, CritStageBonusAbAttr } from "#data/elite-redux/archetypes/crit-mod";
import { CritStackOnKoAbAttr } from "#data/elite-redux/archetypes/crit-stack-on-ko";
import { AbilityId } from "#enums/ability-id";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { freshGame, startWorld } from "#test/tests/elite-redux/decomp/harness/game";
import { allAttrSites } from "#test/tests/elite-redux/decomp/harness/sites";
import { NumberHolder } from "#utils/common";
import Phaser from "phaser";
import { beforeAll, describe, expect, it, vi } from "vitest";

const PRECISE_FIST = 5112;

describe("B08 chunk 3: critical-hit classes", () => {
  let phaserGame: Phaser.Game;
  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  it("SUSPECTED GAME BUG: getCritStage asks the bonus attr without a move, so Precise Fist adds its stage to a non-punching move too", async () => {
    const game = freshGame(phaserGame);
    game.override
      .battleStyle("single")
      .moveset([MoveId.SPLASH])
      .ability(PRECISE_FIST as AbilityId)
      .startingLevel(100)
      .enemySpecies(SpeciesId.MAGIKARP)
      .enemyLevel(30)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemyMoveset(MoveId.SPLASH)
      .criticalHits(false);
    await game.classicMode.startBattle(SpeciesId.BLISSEY);
    const holder = game.field.getPlayerPokemon();
    const foe = game.field.getEnemyPokemon();
    const attr = holder.getAbility().attrs.find(candidate => candidate instanceof CritStageBonusAbAttr)!;
    expect(attr.getFilter()).toEqual({ flag: 128 });
    const canApply = vi.spyOn(CritStageBonusAbAttr.prototype, "canApply");
    // Tackle is not a punching move, Mach Punch is.
    const stageOfTackle = foe.getCritStage(holder, allMoves[MoveId.TACKLE]);
    const stageOfPunch = foe.getCritStage(holder, allMoves[MoveId.MACH_PUNCH]);
    expect(canApply).toHaveBeenCalled();
    for (const [params] of canApply.mock.calls) {
      expect(Object.keys(params as object)).toContain("critStage");
      expect(Object.keys(params as object)).not.toContain("move");
    }
    // The filter is never reached: the bonus of +1 lands on both moves.
    expect(stageOfTackle).toBe(stageOfPunch);
    expect(stageOfTackle).toBeGreaterThanOrEqual(1);
    canApply.mockRestore();
  });

  it("the filters, written as library atoms, equal the class's own filter for every registered move (five of the six; Five-Star Fury is a custom move the atom cannot name)", async () => {
    const world = await startWorld(phaserGame);
    const { holder } = world;
    const module = declRegistry.get("CritStageBonusAbAttr")!;
    const cases: { user: string; filter: string; spec: unknown }[] = [
      { user: "Hyper Cutter", filter: "Contact moves", spec: { id: "move.inherent-flag", flag: "MAKES_CONTACT" } },
      { user: "Perfectionist", filter: "Moves with 50 power or less", spec: { id: "move.power", cmp: "lte", n: 50 } },
      { user: "Precise Fist", filter: "Punching moves", spec: { id: "move.inherent-flag", flag: "PUNCHING_MOVE" } },
      {
        user: "Giant Shuriken",
        filter: "Only these moves: Water shuriken",
        spec: { id: "move.is-move", moveId: "WATER_SHURIKEN" },
      },
    ];
    for (const { user, filter, spec } of cases) {
      const site = allAttrSites().find(s => s.className === "CritStageBonusAbAttr" && s.abilityName === user)!;
      expect(site, user).toBeDefined();
      const rebuilt = buildAttr(module, { bonus: 1, filter }, { gate: normalizeBindingSpec(spec) });
      let accepted = 0;
      for (const move of allMoves) {
        if (move === undefined) {
          continue;
        }
        // The call a version of the engine that passed the move would make.
        const params = { pokemon: holder, move, critStage: new NumberHolder(0) };
        const original = site.attr.canApply(params as never);
        const library = rebuilt.canApply(params as never);
        if (original !== library) {
          throw new Error(`${user}: ${MoveId[move.id] ?? move.id}: the class says ${original}, the atoms ${library}`);
        }
        accepted += original ? 1 : 0;
      }
      expect(accepted, `${user} accepts nothing`).toBeGreaterThan(0);
    }
    // Five-Star Fury is an Elite Redux custom move: the atom looks a name up in MoveId first and in ErMoveId second
    // (librarian pass B19, request R-B08-33), so the library can now name it.
    const penta = allAttrSites().find(s => s.className === "CritStageBonusAbAttr" && s.abilityName === "Penta-Punch")!;
    expect(CritStageBonusAbAttr.matchesFilter(penta.attr.getFilter(), holder, { id: 5156 } as never)).toBe(true);
    const furyGate = compileCondition({ block: "move.is-move", params: { moveId: "FIVE_STAR_FURY" } });
    expect(furyGate({ holder: holder as never, move: { id: 5156 } as never, simulated: true })).toBe(true);
    expect(furyGate({ holder: holder as never, move: allMoves[MoveId.TACKLE], simulated: true })).toBe(false);
    expect(
      buildAttr(
        module,
        { bonus: 1, filter: "Only these moves: Five star fury" },
        { gate: { block: "move.is-move", params: { moveId: "FIVE_STAR_FURY" } } as never },
      ).canApply({
        pokemon: holder,
        move: allMoves[MoveId.TACKLE],
        critStage: new NumberHolder(0),
      } as never),
    ).toBe(false);
  });

  it("the two unfiltered users rebuild with the always-true gate and add the same stages; the bonus setting reaches the compiled attr", async () => {
    const world = await startWorld(phaserGame);
    const { holder } = world;
    const module = declRegistry.get("CritStageBonusAbAttr")!;
    const stages: Record<string, number> = {};
    for (const name of ["Heaven Asunder", "Strategic Pause"]) {
      const site = allAttrSites().find(s => s.className === "CritStageBonusAbAttr" && s.abilityName === name)!;
      const rebuilt = recomposeAttr(module, site.attr, site.abilityId, site.attrIndex);
      const add = (attr: typeof site.attr): number => {
        const critStage = new NumberHolder(0);
        const params = { pokemon: holder, critStage };
        if (attr.canApply(params as never)) {
          attr.apply(params as never);
        }
        return critStage.value;
      };
      expect(add(rebuilt)).toBe(add(site.attr));
      stages[name] = add(site.attr);
    }
    expect(stages).toEqual({ "Heaven Asunder": 1, "Strategic Pause": 2 });
    const site = allAttrSites().find(
      s => s.className === "CritStageBonusAbAttr" && s.abilityName === "Heaven Asunder",
    )!;
    const three = recomposeAttr(module, site.attr, site.abilityId, site.attrIndex, {
      params: { bonus: 3 },
    }) as CritStageBonusAbAttr;
    expect(three.getBonus()).toBe(3);
  });

  it("CritDamageMultiplierAbAttr: the 4 users rebuild to the same product, and only a critical hit (multiplier above 1) is changed", async () => {
    const world = await startWorld(phaserGame);
    const { holder } = world;
    const module = declRegistry.get("CritDamageMultiplierAbAttr")!;
    const sites = allAttrSites().filter(s => s.className === "CritDamageMultiplierAbAttr");
    expect(sites).toHaveLength(4);
    for (const site of sites) {
      const rebuilt = recomposeAttr(module, site.attr, site.abilityId, site.attrIndex) as CritDamageMultiplierAbAttr;
      expect(rebuilt.getMultiplier()).toBe((site.attr as CritDamageMultiplierAbAttr).getMultiplier());
      for (const start of [1, 1.5]) {
        for (const simulated of [false, true]) {
          const run = (attr: typeof site.attr): { can: boolean; value: number } => {
            const critMult = new NumberHolder(start);
            const params = { pokemon: holder, critMult, simulated };
            const can = attr.canApply(params as never);
            if (can) {
              attr.apply(params as never);
            }
            return { can, value: critMult.value };
          };
          expect(run(rebuilt), `${site.abilityName} from ${start}`).toEqual(run(site.attr));
        }
      }
      // A normal hit (1) is untouched; a critical hit (1.5) is multiplied.
      const normal = new NumberHolder(1);
      expect(site.attr.canApply({ pokemon: holder, critMult: normal } as never)).toBe(false);
      const crit = new NumberHolder(1.5);
      site.attr.apply({ pokemon: holder, critMult: crit } as never);
      expect(crit.value).toBeCloseTo(1.5 * (site.attr as CritDamageMultiplierAbAttr).getMultiplier(), 10);
    }
  });

  it("CritStackOnKoAbAttr: the stacks add up by the per-KO setting, stop at the cap, ignore simulated calls and are read through the class name", async () => {
    const world = await startWorld(phaserGame);
    const { holder, foe } = world;
    const module = declRegistry.get("CritStackOnKoAbAttr")!;
    const sites = allAttrSites().filter(s => s.className === "CritStackOnKoAbAttr");
    expect(sites.map(s => s.abilityName).sort()).toEqual(["Pretentious", "Way of Swiftness"]);
    const read = (attr: CritStackOnKoAbAttr, mon: typeof holder) => attr.currentStacks(mon);
    const original = sites[0].attr as CritStackOnKoAbAttr;
    const rebuilt = recomposeAttr(module, original, sites[0].abilityId, sites[0].attrIndex) as CritStackOnKoAbAttr;
    // The stacks live on the Pokemon, not on the attr: the original and the rebuild share one counter.
    const before = read(original, holder);
    original.apply({ pokemon: holder, simulated: true } as never);
    expect(read(original, holder)).toBe(before);
    rebuilt.apply({ pokemon: holder, simulated: false } as never);
    expect(read(original, holder)).toBe(before + 1);
    // A different Pokemon has its own counter.
    expect(read(original, foe)).toBe(0);
    // The cap: perKo 2, cap 5 gives 2, 4, 5, 5 on a Pokemon that has none yet.
    const capped = buildAttr(module, { perKo: 2, cap: 5 }) as CritStackOnKoAbAttr;
    const seen: number[] = [];
    for (let i = 0; i < 4; i++) {
      capped.apply({ pokemon: foe, simulated: false } as never);
      seen.push(capped.currentStacks(foe));
    }
    expect(seen).toEqual([2, 4, 5, 5]);
    // The engine reads the stacks by class name (field/pokemon.ts getCritStage), so the name must stay.
    expect(CritStackOnKoAbAttr.name).toBe("CritStackOnKoAbAttr");
  });
});

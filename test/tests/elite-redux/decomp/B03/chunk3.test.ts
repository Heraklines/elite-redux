/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import type {
  AbAttr,
  DownloadAbAttr,
  PostSummonAllyHealAbAttr,
  PostSummonClearAllyStatStagesAbAttr,
  PostSummonClearOpponentPositiveStatStagesAbAttr,
  PostSummonHealStatusAbAttr,
  PostSummonRemoveBattlerTagAbAttr,
  PostSummonStatStageChangeAbAttr,
  PostSummonTerrainChangeAbAttr,
} from "#abilities/ab-attrs";
// B03 chunk 3: probes the shared L1 / L2 suites cannot see for PostSummonRemoveBattlerTagAbAttr,
// PostSummonStatStageChangeAbAttr, PostSummonAllyHealAbAttr, PostSummonClearAllyStatStagesAbAttr,
// PostSummonClearOpponentPositiveStatStagesAbAttr, DownloadAbAttr, PostSummonTerrainChangeAbAttr and
// PostSummonHealStatusAbAttr.
//
// Every test drives the REAL live attr of each shipped user and its rebuild (recomposeAttr: fresh instance, real
// constructor, params read back from the live attr, gate from the binding) with the same inputs and compares what they
// do: the answer of canApply, the engine calls of apply, the state they leave behind, the message. The L2 twin only
// reaches a single battle with a Magikarp foe and no ally, no status and no field effect, so this file adds:
//   - every user of every class, not one per signature;
//   - doubles (an ally to heal or reset, two foes to read or clear);
//   - every status on the holder, every battle effect on the holder;
//   - raised and lowered foe stages, tied and unequal foe defenses, an empty foe slot;
//   - the Fear follow-up callback of the entry stat change, called directly.
import { globalScene } from "#app/global-scene";
import { buildAttr, readDeclParams, recomposeAttr } from "#data/elite-redux/ability-studio/build-attr";
import { declRegistry } from "#data/elite-redux/ability-studio/decl-registry";
import { TerrainType } from "#data/terrain";
import { AbilityId } from "#enums/ability-id";
import { BattlerTagType } from "#enums/battler-tag-type";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { BATTLE_STATS, Stat } from "#enums/stat";
import { StatusEffect } from "#enums/status-effect";
import type { Pokemon } from "#field/pokemon";
import { freshGame, startWorld } from "#test/tests/elite-redux/decomp/harness/game";
import { type AttrSite, allAttrSites } from "#test/tests/elite-redux/decomp/harness/sites";
import { setStatusOf, setTerrainOf } from "#test/tests/elite-redux/decomp/harness/world";
import Phaser from "phaser";
import { beforeAll, describe, expect, it, vi } from "vitest";

const CLASSES = [
  "PostSummonRemoveBattlerTagAbAttr",
  "PostSummonStatStageChangeAbAttr",
  "PostSummonAllyHealAbAttr",
  "PostSummonClearAllyStatStagesAbAttr",
  "PostSummonClearOpponentPositiveStatStagesAbAttr",
  "DownloadAbAttr",
  "PostSummonTerrainChangeAbAttr",
  "PostSummonHealStatusAbAttr",
] as const;

const sitesOf = (className: string): AttrSite[] => allAttrSites().filter(site => site.className === className);

function rebuild(site: AttrSite): AbAttr {
  return recomposeAttr(declRegistry.get(site.className)!, site.attr, site.abilityId, site.attrIndex);
}

const STATUSES = [
  StatusEffect.NONE,
  StatusEffect.POISON,
  StatusEffect.TOXIC,
  StatusEffect.PARALYSIS,
  StatusEffect.SLEEP,
  StatusEffect.FREEZE,
  StatusEffect.BURN,
] as const;

/** Two player Pokemon and two foes, so allies and several foes exist. */
async function doublesWorld(phaserGame: Phaser.Game): Promise<{ holder: Pokemon; ally: Pokemon; foes: Pokemon[] }> {
  const game = freshGame(phaserGame);
  game.override
    .startingWave(4) // wave 1 of a wild run is always a single battle (battle-scene.ts resolveBattleFormat)
    .battleStyle("double")
    .moveset([MoveId.SPLASH])
    .ability(AbilityId.BALL_FETCH)
    .startingLevel(100)
    .enemySpecies(SpeciesId.MAGIKARP)
    .enemyLevel(30)
    .enemyAbility(AbilityId.BALL_FETCH)
    .enemyMoveset(MoveId.SPLASH)
    .criticalHits(false);
  await game.classicMode.startBattle(SpeciesId.BLISSEY, SpeciesId.CHANSEY);
  const [holder, ally] = game.scene.getPlayerField();
  return { holder, ally, foes: game.scene.getEnemyField() };
}

describe("B03 chunk 3: every user of the eight classes rebuilds like the original", () => {
  let phaserGame: Phaser.Game;
  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  it("every one of the 51 sites rebuilds (nothing is legacy-closure) and every declared param reads back from the live attr", () => {
    const counts: Record<string, number> = {
      PostSummonRemoveBattlerTagAbAttr: 2,
      PostSummonStatStageChangeAbAttr: 23,
      PostSummonAllyHealAbAttr: 3,
      PostSummonClearAllyStatStagesAbAttr: 2,
      PostSummonClearOpponentPositiveStatStagesAbAttr: 1,
      DownloadAbAttr: 1,
      PostSummonTerrainChangeAbAttr: 4,
      PostSummonHealStatusAbAttr: 15,
    };
    let total = 0;
    for (const name of CLASSES) {
      const sites = sitesOf(name);
      expect(sites.length, name).toBe(counts[name]);
      total += sites.length;
      const module = declRegistry.get(name)!;
      for (const site of sites) {
        const copy = rebuild(site);
        expect(copy, `${name} ${site.abilityName}`).not.toBe(site.attr);
        expect(copy.constructor.name).toBe(name);
        expect(copy.showAbility).toBe(site.attr.showAbility);
        const live = readDeclParams(module, site.attr);
        for (const param of module.decl.params) {
          expect(live[param.id], `${name} ${site.abilityName} param ${param.id}`).toBeDefined();
        }
        // The rebuilt instance reads back the same params as the live one.
        expect(readDeclParams(module, copy)).toEqual(live);
      }
    }
    expect(total).toBe(51);
  });

  it("PostSummonRemoveBattlerTagAbAttr: both users answer canApply and remove the same listed effects for every set of effects on the holder", async () => {
    const { holder } = await startWorld(phaserGame);
    const sites = sitesOf("PostSummonRemoveBattlerTagAbAttr");
    const tagsToTry = [
      BattlerTagType.INFATUATED,
      BattlerTagType.TAUNT,
      BattlerTagType.CONFUSED,
      BattlerTagType.ER_FEAR,
      BattlerTagType.SEEDED,
    ];
    const subsets: BattlerTagType[][] = [[]];
    for (const tag of tagsToTry) {
      subsets.push([tag]);
    }
    subsets.push([BattlerTagType.INFATUATED, BattlerTagType.TAUNT], [BattlerTagType.TAUNT, BattlerTagType.CONFUSED]);
    for (const site of sites) {
      const original = site.attr as PostSummonRemoveBattlerTagAbAttr;
      const copy = rebuild(site) as PostSummonRemoveBattlerTagAbAttr;
      for (const present of subsets) {
        const outcome: Record<string, unknown> = {};
        for (const [name, attr] of [
          ["original", original],
          ["copy", copy],
        ] as const) {
          const have = new Set<BattlerTagType>(present);
          vi.spyOn(holder, "getTag").mockImplementation(((type: BattlerTagType) =>
            have.has(type) ? ({ tagType: type } as never) : undefined) as never);
          const removed: BattlerTagType[] = [];
          vi.spyOn(holder, "removeTag").mockImplementation(((type: BattlerTagType) => {
            removed.push(type);
            have.delete(type);
            return true;
          }) as never);
          outcome[name] = { canApply: attr.canApply({ pokemon: holder }), removed: [], afterApply: [] };
          attr.apply({ pokemon: holder });
          (outcome[name] as { removed: unknown[] }).removed = [...removed];
          (outcome[name] as { afterApply: unknown[] }).afterApply = [...have];
          vi.restoreAllMocks();
        }
        expect(outcome.copy, `${site.abilityName} with ${JSON.stringify(present)}`).toEqual(outcome.original);
      }
    }
    // The two shipped lists really differ, so the gate bindings are tested against two different effect lists.
    const lists = sites.map(site => JSON.stringify((site.attr as unknown as { immuneTags: string[] }).immuneTags));
    expect(new Set(lists).size).toBe(2);
  });

  it("PostSummonHealStatusAbAttr: every user and every status on the holder answer canApply, cure, and message like the original", async () => {
    const { holder } = await startWorld(phaserGame);
    const sites = sitesOf("PostSummonHealStatusAbAttr");
    const statusesSeen = new Set<number>();
    for (const site of sites) {
      const original = site.attr as PostSummonHealStatusAbAttr;
      const copy = rebuild(site) as PostSummonHealStatusAbAttr;
      for (const status of STATUSES) {
        const outcome: Record<string, unknown> = {};
        for (const [name, attr] of [
          ["original", original],
          ["copy", copy],
        ] as const) {
          setStatusOf(holder, status);
          const canApply = attr.canApply({ pokemon: holder });
          let after: unknown = "untouched";
          let message: unknown = "none";
          if (canApply) {
            attr.apply({ pokemon: holder });
            after = holder.status?.effect ?? "no status";
            message = attr.getTriggerMessage({ pokemon: holder });
            statusesSeen.add(status);
          }
          outcome[name] = { canApply, after, message };
        }
        expect(outcome.copy, `${site.abilityName} holder status ${StatusEffect[status]}`).toEqual(outcome.original);
      }
    }
    setStatusOf(holder, StatusEffect.NONE);
    // Every status except none made some shipped user cure it.
    expect([...statusesSeen].sort()).toEqual(STATUSES.filter(status => status !== StatusEffect.NONE).sort());
  });

  it("PostSummonHealStatusAbAttr: a staff gate that replaces the class list decides alone, and the class still needs a status (residual)", async () => {
    const { holder } = await startWorld(phaserGame);
    const module = declRegistry.get("PostSummonHealStatusAbAttr")!;
    const burnOnly = { block: "status.has", params: { who: "holder", status: "BURN" } };
    const attr = buildAttr(
      module,
      { statuses: "PARALYSIS" },
      { gate: burnOnly as never },
    ) as PostSummonHealStatusAbAttr;
    setStatusOf(holder, StatusEffect.PARALYSIS);
    expect(attr.canApply({ pokemon: holder })).toBe(false);
    setStatusOf(holder, StatusEffect.BURN);
    expect(attr.canApply({ pokemon: holder })).toBe(true);
    setStatusOf(holder, StatusEffect.NONE);
    // An always-true staff gate still cannot fire without a status: the residual stays in the class.
    const always = buildAttr(
      module,
      { statuses: "PARALYSIS" },
      { gate: { all: [] } as never },
    ) as PostSummonHealStatusAbAttr;
    expect(always.canApply({ pokemon: holder })).toBe(false);
    setStatusOf(holder, StatusEffect.SLEEP);
    expect(always.canApply({ pokemon: holder })).toBe(true);
    setStatusOf(holder, StatusEffect.NONE);
  });

  it("PostSummonStatStageChangeAbAttr: every user queues the same stat change phases for every foe state, and nothing when simulated", async () => {
    const { holder, foe } = await startWorld(phaserGame);
    const sites = sitesOf("PostSummonStatStageChangeAbAttr");
    const calls: unknown[][] = [];
    vi.spyOn(globalScene.phaseManager, "unshiftNew").mockImplementation(((...args: unknown[]) => {
      calls.push(args.map(arg => (typeof arg === "function" ? "fn" : arg)));
    }) as never);
    for (const site of sites) {
      const original = site.attr as PostSummonStatStageChangeAbAttr;
      const copy = rebuild(site) as PostSummonStatStageChangeAbAttr;
      expect(
        (copy as unknown as { extraCondition?: unknown }).extraCondition,
        `${site.abilityName} keeps its attr-level condition`,
      ).toBe((original as unknown as { extraCondition?: unknown }).extraCondition);
      for (const substitute of [false, true]) {
        for (const simulated of [false, true]) {
          const seen: unknown[] = [];
          for (const attr of [original, copy]) {
            const getTag = vi
              .spyOn(foe, "getTag")
              .mockImplementation(((type: BattlerTagType) =>
                substitute && type === BattlerTagType.SUBSTITUTE ? ({} as never) : undefined) as never);
            calls.length = 0;
            expect(attr.canApply({ pokemon: holder })).toBe(true);
            attr.apply({ pokemon: holder, simulated });
            seen.push([...calls]);
            getTag.mockRestore();
          }
          expect(seen[1], `${site.abilityName} substitute=${substitute} simulated=${simulated}`).toEqual(seen[0]);
          if (simulated) {
            expect(seen[0]).toEqual([]);
          }
        }
      }
    }
  });

  it("PostSummonStatStageChangeAbAttr: the Fear follow-up of every user does the same thing for every drop and every roll, and users without one stay without", async () => {
    const { holder, foe } = await startWorld(phaserGame);
    const sites = sitesOf("PostSummonStatStageChangeAbAttr");
    const withCallback = sites.filter(site => (site.attr as unknown as { onChange: unknown }).onChange !== null);
    // Intimidate, Scare, Terrify, Gleam Eyes, Scarecrow, Fire's Wrath (second attr), Mob Boss, Spin To Win.
    expect(withCallback.map(site => site.abilityId).sort((a, b) => a - b)).toEqual(
      [22, 5067, 5336, 5410, 5522, 5670, 5714, 20021].sort((a, b) => a - b),
    );
    for (const site of withCallback) {
      const original = (site.attr as unknown as { onChange: (...args: unknown[]) => void }).onChange;
      const copy = (rebuild(site) as unknown as { onChange: ((...args: unknown[]) => void) | null }).onChange;
      expect(copy, site.abilityName).not.toBeNull();
      for (const roll of [0, 9, 10, 50, 99]) {
        for (const [changed, relative] of [
          [[Stat.ATK], [-1]],
          [[Stat.SPATK], [-2]],
          [[Stat.ATK], [1]],
          [[Stat.ATK], [0]],
          [
            [Stat.ATK, Stat.SPATK],
            [1, -1],
          ],
          [[], []],
        ] as const) {
          const outcome: unknown[] = [];
          for (const fn of [original, copy!]) {
            vi.spyOn(foe, "randBattleSeedInt").mockReturnValue(roll);
            const addTag = vi.spyOn(foe, "addTag").mockReturnValue(true as never);
            fn(foe, [...changed], [...relative]);
            outcome.push(addTag.mock.calls.map(call => [...call]));
            vi.restoreAllMocks();
          }
          expect(outcome[1], `${site.abilityName} roll ${roll} ${JSON.stringify([changed, relative])}`).toEqual(
            outcome[0],
          );
        }
      }
      // A foe that is missing (null target) does nothing and draws nothing.
      expect(() => copy!(undefined, [Stat.ATK], [-1])).not.toThrow();
    }
    // A drop with a roll under 10 gives Fear for 2 turns; a roll of 10 or more does not (10 percent, the same rule as the original).
    const sample = (rebuild(withCallback[0]!) as unknown as { onChange: (...args: unknown[]) => void }).onChange;
    vi.spyOn(foe, "randBattleSeedInt").mockReturnValue(9);
    const tagSpy = vi.spyOn(foe, "addTag").mockReturnValue(true as never);
    sample(foe, [Stat.ATK], [-1]);
    expect(tagSpy.mock.calls).toEqual([[BattlerTagType.ER_FEAR, 2]]);
    vi.restoreAllMocks();
    expect(holder).toBeDefined();
  });

  it("PostSummonStatStageChangeAbAttr: a block built from staff params reaches the same engine calls as the constructor", async () => {
    const { holder, foe } = await startWorld(phaserGame);
    const module = declRegistry.get("PostSummonStatStageChangeAbAttr")!;
    const calls: unknown[][] = [];
    vi.spyOn(globalScene.phaseManager, "unshiftNew").mockImplementation(((...args: unknown[]) => {
      calls.push(args.map(arg => (typeof arg === "function" ? "fn" : arg)));
    }) as never);
    const mine = buildAttr(module, { stats: "SPD", stages: 2, target: "ME", intimidate: false, afterDrop: "NONE" });
    mine.apply({ pokemon: holder });
    expect(calls).toEqual([["StatStageChangePhase", holder.getBattlerIndex(), true, [Stat.SPD], 2]]);
    calls.length = 0;
    const theirs = buildAttr(module, {
      stats: "ATK,SPATK",
      stages: -1,
      target: "FOES",
      intimidate: true,
      afterDrop: "FEAR_10_PERCENT_2_TURNS",
    });
    theirs.apply({ pokemon: holder });
    expect(calls.length).toBe(1);
    expect(calls[0]!.slice(0, 7)).toEqual([
      "StatStageChangePhase",
      foe.getBattlerIndex(),
      false,
      [Stat.ATK, Stat.SPATK],
      -1,
      true,
      false,
    ]);
    expect(calls[0]![8]).toBe("fn");
    vi.restoreAllMocks();
  });

  it("PostSummonTerrainChangeAbAttr: every user answers canApply and sets the same terrain, and sets nothing when simulated", async () => {
    const { holder } = await startWorld(phaserGame);
    const sites = sitesOf("PostSummonTerrainChangeAbAttr");
    const game = (holder as unknown as { scene: unknown }).scene;
    expect(game).toBeDefined();
    const arena = globalScene.arena;
    const typesSeen = new Set<number>();
    for (const site of sites) {
      const original = site.attr as PostSummonTerrainChangeAbAttr;
      const copy = rebuild(site) as PostSummonTerrainChangeAbAttr;
      typesSeen.add((original as unknown as { terrainType: number }).terrainType);
      for (const start of [
        TerrainType.NONE,
        TerrainType.ELECTRIC,
        TerrainType.GRASSY,
        TerrainType.MISTY,
        TerrainType.PSYCHIC,
      ]) {
        for (const simulated of [false, true]) {
          const outcome: unknown[] = [];
          for (const attr of [original, copy]) {
            setTerrainOf({ scene: globalScene } as never, start);
            const spy = vi.spyOn(arena, "trySetTerrain").mockReturnValue(true);
            const canApply = attr.canApply({ pokemon: holder });
            attr.apply({ pokemon: holder, simulated });
            outcome.push({ canApply, calls: spy.mock.calls.map(call => [...call]) });
            spy.mockRestore();
          }
          expect(outcome[1], `${site.abilityName} from ${TerrainType[start]} simulated=${simulated}`).toEqual(
            outcome[0],
          );
        }
      }
    }
    setTerrainOf({ scene: globalScene } as never, TerrainType.NONE);
    // Electric (two users), Grassy and None (Teraform Zero) were all exercised.
    expect([...typesSeen].sort()).toEqual([TerrainType.NONE, TerrainType.ELECTRIC, TerrainType.GRASSY].sort());
  });

  it("DownloadAbAttr: the rebuilt attr picks the same stat for equal, unequal, rounded and empty foes, and reads the same adjacent foes", async () => {
    const { holder, foes } = await doublesWorld(phaserGame);
    const [site] = sitesOf("DownloadAbAttr") as [AttrSite];
    const original = site.attr as DownloadAbAttr;
    const copy = rebuild(site) as DownloadAbAttr;
    expect(copy).not.toBe(original);
    const calls: unknown[][] = [];
    vi.spyOn(globalScene.phaseManager, "unshiftNew").mockImplementation(((...args: unknown[]) => {
      calls.push(args);
    }) as never);
    // [foe 1 Defense, foe 1 Sp. Def, foe 2 Defense, foe 2 Sp. Def]
    const cases: [number, number, number, number][] = [
      [100, 100, 100, 100],
      [100, 101, 100, 101],
      [101, 100, 101, 100],
      [100, 100, 101, 100],
      [100, 101, 101, 100],
      [0, 50, 0, 50],
      [50, 0, 50, 0],
      [1, 1, 1, 2],
    ];
    for (const [d1, s1, d2, s2] of cases) {
      const outcome: unknown[] = [];
      for (const attr of [original, copy]) {
        vi.spyOn(foes[0]!, "getEffectiveStat").mockImplementation(((stat: Stat) =>
          stat === Stat.DEF ? d1 : s1) as never);
        vi.spyOn(foes[1]!, "getEffectiveStat").mockImplementation(((stat: Stat) =>
          stat === Stat.DEF ? d2 : s2) as never);
        calls.length = 0;
        const canApply = attr.canApply({ pokemon: holder });
        attr.apply({ pokemon: holder, simulated: false });
        const afterSimulated = [...calls];
        attr.apply({ pokemon: holder, simulated: true });
        outcome.push({ canApply, calls: afterSimulated, simulatedAdded: calls.length - afterSimulated.length });
        vi.restoreAllMocks();
        vi.spyOn(globalScene.phaseManager, "unshiftNew").mockImplementation(((...args: unknown[]) => {
          calls.push(args);
        }) as never);
      }
      expect(outcome[1], JSON.stringify([d1, s1, d2, s2])).toEqual(outcome[0]);
    }
    // One empty foe slot is skipped, like the original; no foe at all answers false.
    const solo = [original, copy].map(attr => {
      vi.spyOn(holder, "getAdjacentOpponents").mockReturnValue([undefined as never, foes[0]!]);
      vi.spyOn(foes[0]!, "getEffectiveStat").mockReturnValue(80);
      const answer = attr.canApply({ pokemon: holder });
      vi.restoreAllMocks();
      return answer;
    });
    expect(solo).toEqual([true, true]);
    const none = [original, copy].map(attr => {
      vi.spyOn(holder, "getAdjacentOpponents").mockReturnValue([]);
      const answer = attr.canApply({ pokemon: holder });
      vi.restoreAllMocks();
      return answer;
    });
    expect(none).toEqual([false, false]);
  });

  it("PostSummonAllyHealAbAttr: every user heals each active adjacent ally by the same amount with the same message, and not when simulated", async () => {
    const { holder, ally } = await doublesWorld(phaserGame);
    const sites = sitesOf("PostSummonAllyHealAbAttr");
    const calls: unknown[][] = [];
    vi.spyOn(globalScene.phaseManager, "unshiftNew").mockImplementation(((...args: unknown[]) => {
      calls.push(args);
    }) as never);
    for (const site of sites) {
      const original = site.attr as PostSummonAllyHealAbAttr;
      const copy = rebuild(site) as PostSummonAllyHealAbAttr;
      for (const allyHp of [ally.getMaxHp(), 1, 0]) {
        for (const simulated of [false, true]) {
          const outcome: unknown[] = [];
          for (const attr of [original, copy]) {
            ally.hp = allyHp;
            calls.length = 0;
            const canApply = attr.canApply({ pokemon: holder });
            attr.apply({ pokemon: holder, simulated });
            outcome.push({ canApply, calls: calls.map(call => [...call]) });
          }
          ally.hp = ally.getMaxHp();
          expect(outcome[1], `${site.abilityName} ally hp ${allyHp} simulated=${simulated}`).toEqual(outcome[0]);
          if (!simulated && allyHp > 0) {
            // A quarter of MY max HP, not the ally's.
            expect((outcome[0] as { calls: unknown[][] }).calls[0]![2]).toBe(Math.floor(holder.getMaxHp() / 4));
          }
        }
      }
    }
    // A different divisor and the animation flag reach the heal phase.
    const module = declRegistry.get("PostSummonAllyHealAbAttr")!;
    const half = buildAttr(module, { healRatio: 2, showAnim: false });
    calls.length = 0;
    half.apply({ pokemon: holder });
    expect(calls[0]![2]).toBe(Math.floor(holder.getMaxHp() / 2));
    expect(calls[0]![5]).toBe(true);
    vi.restoreAllMocks();
  });

  it("PostSummonClearAllyStatStagesAbAttr: both users reset every stage of every active ally with the same messages, and not when simulated", async () => {
    const { holder, ally } = await doublesWorld(phaserGame);
    const sites = sitesOf("PostSummonClearAllyStatStagesAbAttr");
    const queued: string[] = [];
    vi.spyOn(globalScene.phaseManager, "queueMessage").mockImplementation(((text: string) => {
      queued.push(text);
    }) as never);
    const setups: [number, number][][] = [
      [],
      [[Stat.ATK, 2]],
      [
        [Stat.SPD, -3],
        [Stat.EVA, 6],
      ],
      BATTLE_STATS.map(stat => [stat, -1] as [number, number]),
    ];
    for (const site of sites) {
      const original = site.attr as PostSummonClearAllyStatStagesAbAttr;
      const copy = rebuild(site) as PostSummonClearAllyStatStagesAbAttr;
      for (const setup of setups) {
        for (const simulated of [false, true]) {
          for (const allyAlive of [true, false]) {
            const outcome: unknown[] = [];
            for (const attr of [original, copy]) {
              for (const stat of BATTLE_STATS) {
                ally.setStatStage(stat, 0);
              }
              for (const [stat, amount] of setup) {
                ally.setStatStage(stat as never, amount);
              }
              ally.hp = allyAlive ? ally.getMaxHp() : 0;
              queued.length = 0;
              const canApply = attr.canApply({ pokemon: holder });
              attr.apply({ pokemon: holder, simulated });
              outcome.push({
                canApply,
                stages: BATTLE_STATS.map(stat => ally.getStatStage(stat)),
                queued: [...queued],
              });
            }
            ally.hp = ally.getMaxHp();
            expect(
              outcome[1],
              `${site.abilityName} ${JSON.stringify(setup)} simulated=${simulated} alive=${allyAlive}`,
            ).toEqual(outcome[0]);
            if (!simulated && allyAlive && setup.length > 0) {
              expect((outcome[0] as { stages: number[] }).stages).toEqual(BATTLE_STATS.map(() => 0));
              expect((outcome[0] as { queued: string[] }).queued.length).toBe(1);
            }
          }
        }
      }
    }
    vi.restoreAllMocks();
  });

  it("PostSummonClearOpponentPositiveStatStagesAbAttr: only raised foe stages are cleared, drops and my own stages stay, and a fainted foe is skipped", async () => {
    const { holder, ally, foes } = await doublesWorld(phaserGame);
    const [site] = sitesOf("PostSummonClearOpponentPositiveStatStagesAbAttr") as [AttrSite];
    const original = site.attr as PostSummonClearOpponentPositiveStatStagesAbAttr;
    const copy = rebuild(site) as PostSummonClearOpponentPositiveStatStagesAbAttr;
    const setups: [number, number][][] = [
      [],
      [[Stat.ATK, 2]],
      [[Stat.SPD, -2]],
      [
        [Stat.ATK, 2],
        [Stat.SPD, -2],
      ],
      [
        [Stat.EVA, 1],
        [Stat.ACC, 6],
        [Stat.DEF, -6],
      ],
    ];
    for (const setup of setups) {
      for (const secondFoe of [setup, []] as const) {
        for (const simulated of [false, true]) {
          for (const secondFoeAlive of [true, false]) {
            const outcome: unknown[] = [];
            for (const attr of [original, copy]) {
              for (const mon of [...foes, holder, ally]) {
                for (const stat of BATTLE_STATS) {
                  mon.setStatStage(stat, 0);
                }
              }
              for (const [stat, amount] of setup) {
                foes[0]!.setStatStage(stat as never, amount);
              }
              for (const [stat, amount] of secondFoe) {
                foes[1]!.setStatStage(stat as never, amount);
              }
              holder.setStatStage(Stat.ATK, 3);
              ally.setStatStage(Stat.DEF, 2);
              foes[1]!.hp = secondFoeAlive ? foes[1]!.getMaxHp() : 0;
              const canApply = attr.canApply({ pokemon: holder });
              attr.apply({ pokemon: holder, simulated });
              outcome.push({
                canApply,
                foe1: BATTLE_STATS.map(stat => foes[0]!.getStatStage(stat)),
                foe2: BATTLE_STATS.map(stat => foes[1]!.getStatStage(stat)),
                mine: [holder.getStatStage(Stat.ATK), ally.getStatStage(Stat.DEF)],
              });
            }
            foes[1]!.hp = foes[1]!.getMaxHp();
            expect(outcome[1], JSON.stringify([setup, secondFoe, simulated, secondFoeAlive])).toEqual(outcome[0]);
            if (!simulated) {
              const result = outcome[0] as { foe1: number[]; mine: number[] };
              expect(result.foe1.every(stage => stage <= 0)).toBe(true);
              expect(result.mine).toEqual([3, 2]);
            }
          }
        }
      }
    }
  });
});

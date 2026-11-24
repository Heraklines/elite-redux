/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import type { AbAttr } from "#abilities/ab-attrs";
import {
  IgnoreOpponentStatStagesAbAttr,
  type IntimidateImmunityAbAttr,
  type PostIntimidateStatStageChangeAbAttr,
  type PostSummonAddArenaTagAbAttr,
  PostSummonAddBattlerTagAbAttr,
  type PostSummonMessageAbAttr,
  type PostSummonRemoveArenaTagAbAttr,
  type PostSummonUnnamedMessageAbAttr,
} from "#abilities/ab-attrs";
// B03 chunk 2: probes the shared L1 / L2 suites cannot see for IgnoreOpponentStatStagesAbAttr, IntimidateImmunityAbAttr,
// PostIntimidateStatStageChangeAbAttr, PostSummonRemoveArenaTagAbAttr, PostSummonAddArenaTagAbAttr,
// PostSummonMessageAbAttr, PostSummonUnnamedMessageAbAttr and PostSummonAddBattlerTagAbAttr.
//
// Every test drives the REAL live attr of a shipped ability and its rebuild (recomposeAttr: fresh instance, real
// constructor, params read back from the live attr) with the same inputs, and compares what they do: return values,
// the arguments of the engine calls they make, the message they queue. The L2 twin only proves the scenarios its
// templates reach (one ability per distinct signature, a Magikarp foe, no field effects), so this file adds:
//   - every user of every class, not one per signature;
//   - the inputs L2 cannot set (a stat the class ignores or not, a foe that is trapped, a stat list that the dispatch
//     carries, both field sides, `simulated`);
//   - Slow Start, which the L2 twin cannot prove (see the last test).
import { globalScene } from "#app/global-scene";
import { allAbilities } from "#data/data-lists";
import { buildAttr, recomposeAttr } from "#data/elite-redux/ability-studio/build-attr";
import { declRegistry } from "#data/elite-redux/ability-studio/decl-registry";
import { ArenaTagSide } from "#enums/arena-tag-side";
import { ArenaTagType } from "#enums/arena-tag-type";
import { BattlerTagType } from "#enums/battler-tag-type";
import { Stat } from "#enums/stat";
import { BattleTrace, diffTraces } from "#test/tests/elite-redux/decomp/harness/battle-trace";
import { freshGame, startWorld } from "#test/tests/elite-redux/decomp/harness/game";
import { runScenario, TEMPLATES } from "#test/tests/elite-redux/decomp/harness/scenarios";
import { type AttrSite, allAttrSites } from "#test/tests/elite-redux/decomp/harness/sites";
import { liveAbility } from "#test/tests/elite-redux/decomp/harness/twin";
import { BooleanHolder } from "#utils/common";
import Phaser from "phaser";
import { beforeAll, describe, expect, it, vi } from "vitest";

const sitesOf = (className: string): AttrSite[] => allAttrSites().filter(site => site.className === className);

function rebuild(site: AttrSite): AbAttr {
  return recomposeAttr(declRegistry.get(site.className)!, site.attr, site.abilityId, site.attrIndex);
}

/** The sites of a class that can be rebuilt, and the ones that cannot (with the reason). */
function split(className: string): { rebuildable: AttrSite[]; blocked: { site: AttrSite; why: string }[] } {
  const rebuildable: AttrSite[] = [];
  const blocked: { site: AttrSite; why: string }[] = [];
  for (const site of sitesOf(className)) {
    try {
      rebuild(site);
      rebuildable.push(site);
    } catch (error) {
      blocked.push({ site, why: (error as Error).message });
    }
  }
  return { rebuildable, blocked };
}

describe("B03 chunk 2: every user of the eight classes rebuilds like the original", () => {
  let phaserGame: Phaser.Game;
  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  it("the sites that cannot be rebuilt are exactly the ones the declarations say (3 of 67)", () => {
    const names = [
      "IgnoreOpponentStatStagesAbAttr",
      "IntimidateImmunityAbAttr",
      "PostIntimidateStatStageChangeAbAttr",
      "PostSummonRemoveArenaTagAbAttr",
      "PostSummonAddArenaTagAbAttr",
      "PostSummonMessageAbAttr",
      "PostSummonUnnamedMessageAbAttr",
      "PostSummonAddBattlerTagAbAttr",
    ];
    const total = names.reduce((sum, name) => sum + sitesOf(name).length, 0);
    expect(total).toBe(67);
    const blocked = names.flatMap(name => split(name).blocked.map(({ site }) => `${site.abilityId}#${site.attrIndex}`));
    // Grip Pincer, Venoblaze Pincers (the 'foe is trapped' closure) and Zero to Hero (its message writes a memory).
    expect(blocked.sort()).toEqual(["278#4", "5110#1", "5354#3"].sort());
  });

  it("IgnoreOpponentStatStagesAbAttr: every user answers canApply and apply like the original for every stat, with and without a foe", async () => {
    const { holder, foe } = await startWorld(phaserGame);
    const { rebuildable } = split("IgnoreOpponentStatStagesAbAttr");
    expect(rebuildable.length).toBe(8);
    for (const site of rebuildable) {
      const original = site.attr as IgnoreOpponentStatStagesAbAttr;
      const copy = rebuild(site) as IgnoreOpponentStatStagesAbAttr;
      expect(copy).not.toBe(original);
      for (const stat of [Stat.ATK, Stat.DEF, Stat.SPATK, Stat.SPDEF, Stat.SPD, Stat.ACC, Stat.EVA] as const) {
        for (const opponent of [foe, undefined]) {
          const a = new BooleanHolder(false);
          const b = new BooleanHolder(false);
          const answerA = original.canApply({ pokemon: holder, stat, ignored: a, opponent });
          const answerB = copy.canApply({ pokemon: holder, stat, ignored: b, opponent });
          expect(answerB, `${site.abilityName} ${Stat[stat]} foe=${opponent !== undefined}`).toBe(answerA);
          original.apply({ pokemon: holder, stat, ignored: a, opponent });
          copy.apply({ pokemon: holder, stat, ignored: b, opponent });
          expect(b.value).toBe(a.value);
        }
      }
    }
    // The six-stat users skip Speed and Mind's Eye only knows Evasion: the stat list really differs between users.
    const lists = new Set(rebuildable.map(site => JSON.stringify((site.attr as unknown as { stats: number[] }).stats)));
    expect(lists.size).toBe(2);
  });

  it("IgnoreOpponentStatStagesAbAttr: a trapped-foe closure bound through the optional slot behaves like the original constructor call", async () => {
    const { holder, foe } = await startWorld(phaserGame);
    const module = declRegistry.get("IgnoreOpponentStatStagesAbAttr")!;
    const trapped = (opponent: typeof foe): boolean => opponent.getTag(BattlerTagType.TRAPPED) !== undefined;
    const original = new IgnoreOpponentStatStagesAbAttr([Stat.DEF, Stat.SPDEF], trapped);
    const built = buildAttr(
      module,
      { stats: "DEF,SPDEF" },
      { "ctor:1": trapped as never },
    ) as IgnoreOpponentStatStagesAbAttr;
    for (const addTag of [false, true]) {
      if (addTag) {
        foe.addTag(BattlerTagType.TRAPPED, 5, undefined, holder.id);
      }
      for (const stat of [Stat.DEF, Stat.SPDEF, Stat.ATK]) {
        const params = { pokemon: holder, stat, ignored: new BooleanHolder(false), opponent: foe };
        expect(built.canApply(params), `trapped=${addTag} ${Stat[stat]}`).toBe(original.canApply(params));
      }
      // No foe: the closure is never called and the answer is false when a closure exists.
      expect(built.canApply({ pokemon: holder, stat: Stat.DEF, ignored: new BooleanHolder(false) })).toBe(false);
    }
  });

  it("IntimidateImmunityAbAttr: every user cancels once, and does not cancel a second time", async () => {
    const { holder } = await startWorld(phaserGame);
    const { rebuildable } = split("IntimidateImmunityAbAttr");
    expect(rebuildable.length).toBe(15);
    for (const site of rebuildable) {
      const original = site.attr as IntimidateImmunityAbAttr;
      const copy = rebuild(site) as IntimidateImmunityAbAttr;
      for (const already of [false, true]) {
        const a = new BooleanHolder(already);
        const b = new BooleanHolder(already);
        const params = (cancelled: BooleanHolder) => ({ pokemon: holder, cancelled, simulated: false });
        expect(copy.canApply(params(b))).toBe(original.canApply(params(a)));
        original.apply(params(a));
        copy.apply(params(b));
        expect(b.value).toBe(a.value);
        expect(b.value).toBe(true);
      }
      expect(copy.showAbility).toBe(original.showAbility);
    }
  });

  it("PostIntimidateStatStageChangeAbAttr: both users queue the same stat phase and write the same `cancelled`, for every incoming drop and `simulated`", async () => {
    const { holder } = await startWorld(phaserGame);
    const { rebuildable } = split("PostIntimidateStatStageChangeAbAttr");
    expect(rebuildable.length).toBe(2);
    const calls: unknown[][] = [];
    vi.spyOn(globalScene.phaseManager, "unshiftNew").mockImplementation(((...args: unknown[]) => {
      calls.push(args);
    }) as never);
    const incoming = [
      { incomingStats: undefined, incomingStages: undefined },
      { incomingStats: [Stat.SPATK], incomingStages: -2 },
      { incomingStats: [Stat.ATK], incomingStages: -1 },
      { incomingStats: [], incomingStages: -1 },
    ];
    for (const site of rebuildable) {
      const copy = rebuild(site) as PostIntimidateStatStageChangeAbAttr;
      const original = site.attr as PostIntimidateStatStageChangeAbAttr;
      for (const simulated of [false, true]) {
        for (const extra of incoming) {
          const seen: unknown[] = [];
          for (const attr of [original, copy]) {
            const cancelled = new BooleanHolder(!(attr as unknown as { overwrites: boolean }).overwrites);
            calls.length = 0;
            attr.apply({ pokemon: holder, simulated, cancelled, ...extra });
            seen.push({ calls: [...calls], cancelled: cancelled.value });
          }
          expect(seen[1], `${site.abilityName} simulated=${simulated} ${JSON.stringify(extra)}`).toEqual(seen[0]);
        }
      }
    }
  });

  it("PostSummonRemoveArenaTagAbAttr: every user and every field state answers canApply and removes from the same side", async () => {
    const { game, holder } = await startWorld(phaserGame);
    const { rebuildable } = split("PostSummonRemoveArenaTagAbAttr");
    expect(rebuildable.length).toBe(3);
    const arena = globalScene.arena;
    const sidesSeen = new Set<string>();
    for (const site of rebuildable) {
      const original = site.attr as PostSummonRemoveArenaTagAbAttr;
      const copy = rebuild(site) as PostSummonRemoveArenaTagAbAttr;
      for (const setup of [
        [],
        [[ArenaTagType.SPIKES, ArenaTagSide.ENEMY]],
        [[ArenaTagType.SPIKES, ArenaTagSide.PLAYER]],
        [[ArenaTagType.REFLECT, ArenaTagSide.ENEMY]],
        [
          [ArenaTagType.LIGHT_SCREEN, ArenaTagSide.PLAYER],
          [ArenaTagType.STICKY_WEB, ArenaTagSide.ENEMY],
        ],
        [[ArenaTagType.TAILWIND, ArenaTagSide.PLAYER]],
      ] as const) {
        const result: Record<string, unknown> = {};
        for (const [name, attr] of [
          ["original", original],
          ["copy", copy],
        ] as const) {
          arena.removeAllTags();
          for (const [tag, side] of setup) {
            arena.addTag(tag, 5, undefined, holder.id, side, true);
          }
          const canApply = attr.canApply({ pokemon: holder });
          const spy = vi.spyOn(arena, "removeTagsOnSide");
          attr.apply({ pokemon: holder, simulated: true });
          const afterSimulated = arena.tags.map(tag => `${tag.tagType}:${tag.side}`);
          attr.apply({ pokemon: holder });
          const after = arena.tags.map(tag => `${tag.tagType}:${tag.side}`);
          const sideArgs = spy.mock.calls.map(call => call[1]);
          sideArgs.forEach(side => sidesSeen.add(String(side)));
          spy.mockRestore();
          result[name] = { canApply, afterSimulated, after, sideArgs };
        }
        expect(result.copy, `${site.abilityName} ${JSON.stringify(setup)}`).toEqual(result.original);
      }
    }
    arena.removeAllTags();
    expect(game).toBeDefined();
    // Own side (Pickup, player holder), the foe's side (Screen Cleaner) and both sides (Demolitionist) were all exercised.
    expect(sidesSeen.size).toBeGreaterThanOrEqual(3);
  });

  it("PostSummonAddArenaTagAbAttr: both users call arena.addTag with the same arguments, and nothing when simulated", async () => {
    const { holder } = await startWorld(phaserGame);
    const { rebuildable } = split("PostSummonAddArenaTagAbAttr");
    expect(rebuildable.length).toBe(2);
    const arena = globalScene.arena;
    const spy = vi.spyOn(arena, "addTag").mockReturnValue(true);
    for (const site of rebuildable) {
      const original = site.attr as PostSummonAddArenaTagAbAttr;
      const copy = rebuild(site) as PostSummonAddArenaTagAbAttr;
      expect(copy.showAbility).toBe(original.showAbility);
      for (const simulated of [false, true]) {
        spy.mockClear();
        original.apply({ pokemon: holder, simulated });
        const fromOriginal = spy.mock.calls.map(call => [...call]);
        spy.mockClear();
        copy.apply({ pokemon: holder, simulated });
        const fromCopy = spy.mock.calls.map(call => [...call]);
        expect(fromCopy, `${site.abilityName} simulated=${simulated}`).toEqual(fromOriginal);
        expect(fromOriginal.length).toBe(simulated ? 0 : 1);
      }
    }
    spy.mockRestore();
  });

  it("PostSummonAddArenaTagAbAttr: a side and the quiet flag set by staff reach arena.addTag (the codecs are not lossy)", async () => {
    const { holder } = await startWorld(phaserGame);
    const module = declRegistry.get("PostSummonAddArenaTagAbAttr")!;
    const spy = vi.spyOn(globalScene.arena, "addTag").mockReturnValue(true);
    const attr = buildAttr(module, {
      showAbility: false,
      arenaTag: "TAILWIND",
      turnCount: 4,
      side: "ENEMY_SIDE",
      quiet: true,
    }) as PostSummonAddArenaTagAbAttr;
    attr.apply({ pokemon: holder });
    expect(spy.mock.calls[0]).toEqual([ArenaTagType.TAILWIND, 4, undefined, holder.id, ArenaTagSide.ENEMY, true]);
    expect(attr.showAbility).toBe(false);
    const player = buildAttr(module, { side: "PLAYER_SIDE" }) as PostSummonAddArenaTagAbAttr;
    spy.mockClear();
    player.apply({ pokemon: holder });
    expect(spy.mock.calls[0]?.[4]).toBe(ArenaTagSide.PLAYER);
    expect(spy.mock.calls[0]?.[5]).toBeUndefined();
    spy.mockRestore();
  });

  it("PostSummonMessageAbAttr: all 22 rebuildable users queue the same text as the original, and every announcement choice has a shipped user", async () => {
    const { holder } = await startWorld(phaserGame);
    const { rebuildable, blocked } = split("PostSummonMessageAbAttr");
    expect(rebuildable.length).toBe(22);
    expect(blocked.map(({ site }) => site.abilityId)).toEqual([278]);
    const queued: string[] = [];
    vi.spyOn(globalScene.phaseManager, "queueMessage").mockImplementation(((text: string) => {
      queued.push(text);
    }) as never);
    const texts = new Set<string>();
    const choices = new Set<string>();
    for (const site of rebuildable) {
      const original = site.attr as PostSummonMessageAbAttr;
      const copy = rebuild(site) as PostSummonMessageAbAttr;
      queued.length = 0;
      original.apply({ pokemon: holder });
      const fromOriginal = [...queued];
      queued.length = 0;
      copy.apply({ pokemon: holder });
      expect(queued, site.abilityName).toEqual(fromOriginal);
      expect(fromOriginal.length).toBe(1);
      expect(fromOriginal[0]).toContain(holder.name);
      texts.add(fromOriginal[0]!);
      choices.add(
        String(
          declRegistry
            .get("PostSummonMessageAbAttr")!
            .decl.params[0]!.codec!.fromInstance((original as unknown as { messageFunc: unknown }).messageFunc),
        ),
      );
      // A simulated call queues nothing.
      queued.length = 0;
      copy.apply({ pokemon: holder, simulated: true });
      expect(queued).toEqual([]);
    }
    // Every option of the choice list is the live message of at least one ability, so no option is untested.
    const options = declRegistry.get("PostSummonMessageAbAttr")!.decl.params[0]!.options!;
    expect([...choices].sort()).toEqual(options.filter(name => name !== "ZERO_TO_HERO_TRANSFORMATION").sort());
    // The four Ruin abilities name four different stats.
    expect([...texts].filter(text => text.includes("of Ruin lowered")).length).toBe(4);
  });

  it("PostSummonMessageAbAttr: Zero to Hero reads back as its own choice, and building that choice is refused with a plain message", async () => {
    await startWorld(phaserGame);
    const zero = sitesOf("PostSummonMessageAbAttr").find(site => site.abilityId === 278)!;
    const codec = declRegistry.get("PostSummonMessageAbAttr")!.decl.params[0]!.codec!;
    expect(codec.fromInstance((zero.attr as unknown as { messageFunc: unknown }).messageFunc)).toBe(
      "ZERO_TO_HERO_TRANSFORMATION",
    );
    expect(() => rebuild(zero)).toThrow(/once-per-battle memory/);
  });

  it("PostSummonUnnamedMessageAbAttr: both users queue the fixed text unchanged, nothing when simulated", async () => {
    const { holder } = await startWorld(phaserGame);
    const all = split("PostSummonUnnamedMessageAbAttr").rebuildable;
    expect(all.length).toBe(2);
    // Malicious Empathy (20006) is a studio carrier: the instance has its OWN apply, canApply and getCondition (a composed
    // rule), so it is not a plain use of the class (see the declaration's notes). Only Air Lock is compared.
    const carrier = all.find(site => site.abilityId === 20006)!;
    expect(Object.hasOwn(carrier.attr, "apply")).toBe(true);
    const rebuildable = all.filter(site => site !== carrier);
    expect(rebuildable.length).toBe(1);
    const queued: string[] = [];
    vi.spyOn(globalScene.phaseManager, "queueMessage").mockImplementation(((text: string) => {
      queued.push(text);
    }) as never);
    for (const site of rebuildable) {
      const original = site.attr as PostSummonUnnamedMessageAbAttr;
      const copy = rebuild(site) as PostSummonUnnamedMessageAbAttr;
      original.apply({ pokemon: holder });
      copy.apply({ pokemon: holder });
      expect(queued).toEqual(["The effects of the weather disappeared.", "The effects of the weather disappeared."]);
      expect(Object.hasOwn(site.attr, "apply")).toBe(false);
      queued.length = 0;
      copy.apply({ pokemon: holder, simulated: true });
      expect(queued).toEqual([]);
    }
  });

  it("PostSummonAddBattlerTagAbAttr: all 10 users ask canAddTag and call addTag with the same arguments, nothing when simulated", async () => {
    const { holder } = await startWorld(phaserGame);
    const { rebuildable } = split("PostSummonAddBattlerTagAbAttr");
    expect(rebuildable.length).toBe(10);
    const canAdd = vi.spyOn(holder, "canAddTag");
    const add = vi.spyOn(holder, "addTag").mockReturnValue(true);
    for (const site of rebuildable) {
      const original = site.attr as PostSummonAddBattlerTagAbAttr;
      const copy = rebuild(site) as PostSummonAddBattlerTagAbAttr;
      expect(copy.showAbility, site.abilityName).toBe(original.showAbility);
      for (const simulated of [false, true]) {
        canAdd.mockClear();
        add.mockClear();
        const a = original.canApply({ pokemon: holder, simulated });
        original.apply({ pokemon: holder, simulated });
        const fromOriginal = { a, canAdd: canAdd.mock.calls.map(c => [...c]), add: add.mock.calls.map(c => [...c]) };
        canAdd.mockClear();
        add.mockClear();
        const b = copy.canApply({ pokemon: holder, simulated });
        copy.apply({ pokemon: holder, simulated });
        const fromCopy = { a: b, canAdd: canAdd.mock.calls.map(c => [...c]), add: add.mock.calls.map(c => [...c]) };
        expect(fromCopy, `${site.abilityName} simulated=${simulated}`).toEqual(fromOriginal);
        expect(fromOriginal.add.length).toBe(simulated ? 0 : 1);
      }
    }
  });

  it("PostSummonAddBattlerTagAbAttr: Slow Start rebuilt IN PLACE (same ability id) behaves identically in battle", async () => {
    // The shared L2 twin runs the rebuild under a shadow ability id. SlowStartTag asks the engine
    // `abilityQueryById(pokemon, SLOW_START)` on every lapse and ends itself when the holder lacks THAT id, so under a
    // shadow id the tag ends at once in the twin although the attr is identical. Here the rebuilt attr is swapped into the
    // real ability 112, which keeps the id the engine looks for, and the same scenario runs twice with the same seed.
    const SLOW_START = 112;
    const ability = liveAbility(SLOW_START);
    const index = ability.attrs.findIndex(attr => attr instanceof PostSummonAddBattlerTagAbAttr);
    expect(index).toBeGreaterThanOrEqual(0);
    const original = ability.attrs[index]!;
    const site = sitesOf("PostSummonAddBattlerTagAbAttr").find(s => s.abilityId === SLOW_START)!;
    const copy = rebuild(site);
    expect(copy).not.toBe(original);
    const run = () =>
      runScenario(freshGame(phaserGame), TEMPLATES.entry!, { abilityId: SLOW_START, axes: {} }, game =>
        BattleTrace.attach(game, { rng: "seeded", seed: "b03c2-slow-start", aliases: {} }),
      );
    const before = await run();
    // Ability.getAttrs caches its filtered list by the array identity and length, which an in-place swap keeps.
    const cache = (ability as unknown as { attrsByType: Map<string, unknown> }).attrsByType;
    ability.attrs[index] = copy;
    cache.clear();
    let after: Awaited<ReturnType<typeof run>>;
    try {
      after = await run();
    } finally {
      ability.attrs[index] = original;
      cache.clear();
    }
    expect(diffTraces(before, after)).toEqual([]);
    // Not vacuous: the original really evaluated its attr and the tag is on the holder in both runs.
    expect(
      before.attrEvents.some(event => event.startsWith(`${SLOW_START}#${index} PostSummonAddBattlerTagAbAttr `)),
    ).toBe(true);
    expect(JSON.stringify(before)).toContain("SLOW_START");
    expect(JSON.stringify(after)).toContain("SLOW_START");
    expect(allAbilities[SLOW_START]).toBe(ability);
  });

  it("the declarations' own claim about unchanged fields: a rebuilt shipped attr has the same private fields as the original", async () => {
    await startWorld(phaserGame);
    for (const className of [
      "IgnoreOpponentStatStagesAbAttr",
      "PostIntimidateStatStageChangeAbAttr",
      "PostSummonRemoveArenaTagAbAttr",
      "PostSummonAddArenaTagAbAttr",
      "PostSummonUnnamedMessageAbAttr",
      "PostSummonAddBattlerTagAbAttr",
    ]) {
      for (const site of split(className).rebuildable) {
        const original = site.attr as unknown as Record<string, unknown>;
        const copy = rebuild(site) as unknown as Record<string, unknown>;
        for (const key of Object.keys(original)) {
          if (typeof original[key] === "function" || key === "extraCondition" || key === "sourceId") {
            continue;
          }
          expect(JSON.stringify(copy[key]), `${site.abilityName} ${className}.${key}`).toBe(
            JSON.stringify(original[key]),
          );
        }
      }
    }
  });
});

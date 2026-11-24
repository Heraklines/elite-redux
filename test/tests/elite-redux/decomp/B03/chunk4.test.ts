/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import type {
  AbAttr,
  PostSummonCopyAllyStatsAbAttr,
  PostSummonFormChangeAbAttr,
  PostSummonTransformAbAttr,
  PostSummonUserFieldRemoveStatusEffectAbAttr,
} from "#abilities/ab-attrs";
import { PostSummonUserFieldRemoveStatusEffectAbAttr as SweetVeilClass } from "#abilities/ab-attrs";
import { globalScene } from "#app/global-scene";
import { getBinding } from "#data/elite-redux/ability-studio/bindings";
import { buildAttr, readDeclParams, recomposeAttr } from "#data/elite-redux/ability-studio/build-attr";
import { declRegistry } from "#data/elite-redux/ability-studio/decl-registry";
import { SpeciesFormChangeAbilityTrigger } from "#data/form-change-triggers";
import { AbilityId } from "#enums/ability-id";
import { BattlerTagType } from "#enums/battler-tag-type";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { BATTLE_STATS } from "#enums/stat";
import { StatusEffect } from "#enums/status-effect";
import { WeatherType } from "#enums/weather-type";
import type { Pokemon } from "#field/pokemon";
import { BattleTrace, diffTraces, type TraceData } from "#test/tests/elite-redux/decomp/harness/battle-trace";
import { freshGame, startWorld } from "#test/tests/elite-redux/decomp/harness/game";
import { unregisterShadows } from "#test/tests/elite-redux/decomp/harness/rebuild";
import { runScenario, TEMPLATES, use } from "#test/tests/elite-redux/decomp/harness/scenarios";
import { type AttrSite, allAttrSites } from "#test/tests/elite-redux/decomp/harness/sites";
import { liveAbility } from "#test/tests/elite-redux/decomp/harness/twin";
import { setStatusOf, setWeatherOf } from "#test/tests/elite-redux/decomp/harness/world";
import Phaser from "phaser";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

// B03 chunk 4: probes the shared L1 / L2 suites cannot see for PostSummonFormChangeAbAttr,
// PostSummonUserFieldRemoveStatusEffectAbAttr, PostSummonCopyAllyStatsAbAttr and PostSummonTransformAbAttr.
//
// Every test drives the REAL live attr of each shipped user (and its rebuild from the declaration where one exists) with the
// same inputs and compares what they do. What this file adds over the shared suites:
//   - doubles (an ally to cure or copy, two foes to pick from), which the single-battle L2 template never has;
//   - Imposter's random pick and draw count, and its own battle twin (the shared entry template cannot select a move after
//     the holder was transformed into a Pokemon that has other moves);
//   - the seven form functions of PostSummonFormChangeAbAttr, which are legacy closures: each one is checked against the
//     yes/no gate it will become, over a grid of HP, level and form number, so the gate written in bindings.ts is proven
//     before the library atoms exist.

const FORM_CHANGE = "PostSummonFormChangeAbAttr";
const sitesOf = (className: string): AttrSite[] => allAttrSites().filter(site => site.className === className);

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

/**
 * `resetStatus` normally queues a phase (asPhase defaults to true), so the status would still be there when the test
 * looks. This makes it immediate and records what the class asked for, for every Pokemon given.
 */
function trackCures(mons: readonly Pokemon[], log: unknown[][]): void {
  for (const mon of mons) {
    vi.spyOn(mon, "resetStatus").mockImplementation(((...args: unknown[]) => {
      log.push([mons.indexOf(mon), mon.status?.effect ?? null, ...args]);
      mon.status = null;
    }) as never);
  }
}

function rebuild(site: AttrSite): AbAttr {
  return recomposeAttr(declRegistry.get(site.className)!, site.attr, site.abilityId, site.attrIndex);
}

describe("B03 chunk 4: every user of the four classes", () => {
  let phaserGame: Phaser.Game;
  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });
  afterEach(() => {
    vi.restoreAllMocks();
    unregisterShadows();
  });

  it("the three rebuildable classes rebuild every site, and the seven form functions are written down as legacy closures with a reason", () => {
    const counts: Record<string, number> = {
      PostSummonUserFieldRemoveStatusEffectAbAttr: 1,
      PostSummonCopyAllyStatsAbAttr: 1,
      PostSummonTransformAbAttr: 1,
      [FORM_CHANGE]: 7,
    };
    for (const [name, count] of Object.entries(counts)) {
      expect(sitesOf(name).length, name).toBe(count);
    }
    for (const name of [
      "PostSummonUserFieldRemoveStatusEffectAbAttr",
      "PostSummonCopyAllyStatsAbAttr",
      "PostSummonTransformAbAttr",
    ]) {
      const module = declRegistry.get(name)!;
      for (const site of sitesOf(name)) {
        const copy = rebuild(site);
        expect(copy).not.toBe(site.attr);
        expect(copy.constructor.name).toBe(name);
        expect(copy.showAbility, `${name} keeps showAbility`).toBe(site.attr.showAbility);
        expect(readDeclParams(module, copy)).toEqual(readDeclParams(module, site.attr));
        // The class-level hooks the dispatcher reads stay the same (Imposter never fires on gain).
        expect((copy as unknown as { shouldActivateOnGain(): boolean }).shouldActivateOnGain()).toBe(
          (site.attr as unknown as { shouldActivateOnGain(): boolean }).shouldActivateOnGain(),
        );
      }
    }
    const legacy = new Map<number, string>();
    for (const site of sitesOf(FORM_CHANGE)) {
      const binding = getBinding(site.abilityId, site.attrIndex, "ctor:0");
      expect(binding?.legacyClosure?.reason.length ?? 0, site.abilityName).toBeGreaterThan(40);
      expect(binding?.spec, site.abilityName).toBeUndefined();
      expect(() => rebuild(site), site.abilityName).toThrow(/no library binding/);
      legacy.set(site.abilityId, site.abilityName);
    }
    // Zen Mode, Shields Down, Schooling, Power Construct, Ice Face, Tera Shift, Revelation.
    expect([...legacy.keys()].sort((a, b) => a - b)).toEqual([161, 197, 208, 211, 248, 307, 5586]);
  });

  it("PostSummonUserFieldRemoveStatusEffectAbAttr: Sweet Veil cures the listed status on me and on my ally with the same messages, and nothing when simulated", async () => {
    const { holder, ally } = await doublesWorld(phaserGame);
    const [site] = sitesOf("PostSummonUserFieldRemoveStatusEffectAbAttr") as [AttrSite];
    const original = site.attr as PostSummonUserFieldRemoveStatusEffectAbAttr;
    const copy = rebuild(site) as PostSummonUserFieldRemoveStatusEffectAbAttr;
    expect(readDeclParams(declRegistry.get(site.className)!, copy)).toEqual({ statuses: "Sleep" });
    const queued: string[] = [];
    const cureLog: unknown[][] = [];
    vi.spyOn(globalScene.phaseManager, "queueMessage").mockImplementation(((text: string) => {
      queued.push(text);
    }) as never);
    trackCures([holder, ally], cureLog);
    const statuses = [
      StatusEffect.NONE,
      StatusEffect.SLEEP,
      StatusEffect.POISON,
      StatusEffect.TOXIC,
      StatusEffect.PARALYSIS,
      StatusEffect.BURN,
      StatusEffect.FREEZE,
    ];
    let cured = 0;
    for (const mine of statuses) {
      for (const theirs of statuses) {
        for (const simulated of [false, true]) {
          const outcome: unknown[] = [];
          for (const attr of [original, copy]) {
            setStatusOf(holder, mine);
            setStatusOf(ally, theirs);
            queued.length = 0;
            cureLog.length = 0;
            const canApply = attr.canApply({ pokemon: holder });
            attr.apply({ pokemon: holder, simulated });
            outcome.push({
              canApply,
              mine: holder.status?.effect ?? "none",
              ally: ally.status?.effect ?? "none",
              queued: [...queued],
              cures: cureLog.map(entry => [...entry]),
            });
          }
          expect(outcome[1], `me ${StatusEffect[mine]} ally ${StatusEffect[theirs]} simulated=${simulated}`).toEqual(
            outcome[0],
          );
          const first = outcome[0] as { mine: unknown; ally: unknown; queued: string[] };
          if (simulated) {
            expect(first.queued).toEqual([]);
          } else {
            // Only sleep is cured, on both of us, one message each.
            expect(first.mine).toBe(mine === StatusEffect.SLEEP ? "none" : mine || "none");
            expect(first.ally).toBe(theirs === StatusEffect.SLEEP ? "none" : theirs || "none");
            const expected = (mine === StatusEffect.SLEEP ? 1 : 0) + (theirs === StatusEffect.SLEEP ? 1 : 0);
            expect(first.queued.length).toBe(expected);
            // The cure is the immediate one the class asks for: revive false, no confusion cure, no reload, asPhase false.
            expect((outcome[0] as { cures: unknown[][] }).cures.length).toBe(expected);
            for (const entry of (outcome[0] as { cures: unknown[][] }).cures) {
              expect(entry.slice(2)).toEqual([false]);
            }
            cured += expected;
          }
        }
      }
    }
    expect(cured).toBeGreaterThan(0);
    setStatusOf(holder, StatusEffect.NONE);
    setStatusOf(ally, StatusEffect.NONE);
  });

  it("PostSummonUserFieldRemoveStatusEffectAbAttr: a staff list and a foe holder behave like the constructor, and only the holder's own side is cured", async () => {
    const { holder, ally, foes } = await doublesWorld(phaserGame);
    const module = declRegistry.get("PostSummonUserFieldRemoveStatusEffectAbAttr")!;
    const built = buildAttr(module, { statuses: "POISON,TOXIC" });
    const direct = new SweetVeilClass(StatusEffect.POISON, StatusEffect.TOXIC);
    const queued: string[] = [];
    const cureLog: unknown[][] = [];
    vi.spyOn(globalScene.phaseManager, "queueMessage").mockImplementation(((text: string) => {
      queued.push(text);
    }) as never);
    trackCures([holder, ally, ...foes], cureLog);
    for (const holderOfAttr of [holder, foes[0]!]) {
      const sideMates = holderOfAttr === holder ? [holder, ally] : [foes[0]!, foes[1]!];
      const others = holderOfAttr === holder ? [foes[0]!, foes[1]!] : [holder, ally];
      const outcome: unknown[] = [];
      for (const attr of [built, direct]) {
        for (const mon of [...sideMates, ...others]) {
          setStatusOf(mon, StatusEffect.POISON);
        }
        setStatusOf(sideMates[1]!, StatusEffect.TOXIC);
        setStatusOf(others[0]!, StatusEffect.SLEEP);
        queued.length = 0;
        const canApply = attr.canApply({ pokemon: holderOfAttr });
        attr.apply({ pokemon: holderOfAttr });
        outcome.push({
          canApply,
          after: [...sideMates, ...others].map(mon => mon.status?.effect ?? "none"),
          queued: queued.length,
        });
      }
      expect(outcome[0]).toEqual(outcome[1]);
      // My side lost its poison and bad poison; the other side kept everything.
      expect((outcome[0] as { after: unknown[] }).after).toEqual([
        "none",
        "none",
        StatusEffect.SLEEP,
        StatusEffect.POISON,
      ]);
      expect((outcome[0] as { queued: number }).queued).toBe(2);
    }
    vi.restoreAllMocks();
    for (const mon of [holder, ally, ...foes]) {
      setStatusOf(mon, StatusEffect.NONE);
    }
  });

  it("PostSummonCopyAllyStatsAbAttr: Costar copies every stage and the three crit tags from the ally like the original, and refuses without an active ally", async () => {
    const { holder, ally } = await doublesWorld(phaserGame);
    const [site] = sitesOf("PostSummonCopyAllyStatsAbAttr") as [AttrSite];
    const original = site.attr as PostSummonCopyAllyStatsAbAttr;
    const copy = rebuild(site) as PostSummonCopyAllyStatsAbAttr;
    const stageSets: number[][] = [
      [0, 0, 0, 0, 0, 0, 0],
      [2, -1, 0, 3, -6, 6, 1],
      [-2, -2, -2, -2, -2, -2, -2],
    ];
    const tagSets: BattlerTagType[][] = [
      [],
      [BattlerTagType.CRIT_BOOST],
      [BattlerTagType.ALWAYS_CRIT],
      [BattlerTagType.DRAGON_CHEER],
      [BattlerTagType.CRIT_BOOST, BattlerTagType.ALWAYS_CRIT],
    ];
    expect(BATTLE_STATS.length).toBe(7);
    for (const stages of stageSets) {
      for (const tags of tagSets) {
        for (const simulated of [false, true]) {
          const outcome: unknown[] = [];
          for (const attr of [original, copy]) {
            const added: unknown[][] = [];
            const have = new Set<BattlerTagType>(tags);
            vi.spyOn(ally, "getStatStage").mockImplementation(
              ((stat: number) => stages[BATTLE_STATS.indexOf(stat as never)]) as never,
            );
            vi.spyOn(ally, "getTag").mockImplementation(((type: BattlerTagType) =>
              have.has(type) ? ({ tagType: type, critStages: 2 } as never) : undefined) as never);
            const set: unknown[][] = [];
            vi.spyOn(holder, "setStatStage").mockImplementation(((stat: unknown, value: unknown) => {
              set.push([stat, value]);
            }) as never);
            vi.spyOn(holder, "addTag").mockImplementation(((type: unknown) => {
              added.push([type]);
              return true;
            }) as never);
            vi.spyOn(holder, "getTag").mockImplementation((() => ({ critStages: 0 })) as never);
            const canApply = attr.canApply({ pokemon: holder });
            attr.apply({ pokemon: holder, simulated });
            outcome.push({
              canApply,
              set,
              added,
              message: attr.getTriggerMessage({ pokemon: holder }, "Costar"),
            });
            vi.restoreAllMocks();
          }
          expect(
            outcome[1],
            `stages ${JSON.stringify(stages)} tags ${JSON.stringify(tags)} simulated=${simulated}`,
          ).toEqual(outcome[0]);
          const first = outcome[0] as { canApply: boolean; set: unknown[]; added: unknown[] };
          expect(first.canApply).toBe(true);
          expect(first.set.length).toBe(simulated ? 0 : 7);
          expect(first.added.length).toBe(simulated ? 0 : tags.length);
        }
      }
    }
    // An ally that cannot fight, or no ally at all, makes canApply false for both.
    ally.hp = 0;
    expect(original.canApply({ pokemon: holder })).toBe(false);
    expect(copy.canApply({ pokemon: holder })).toBe(false);
    ally.hp = ally.getMaxHp();
    vi.spyOn(holder, "getAlly").mockReturnValue(undefined);
    expect(original.canApply({ pokemon: holder })).toBe(false);
    expect(copy.canApply({ pokemon: holder })).toBe(false);
  });

  it("PostSummonCopyAllyStatsAbAttr: in a single battle both refuse, and in a real double battle the stages really end up equal", async () => {
    const { holder: single } = await startWorld(phaserGame);
    const [site] = sitesOf("PostSummonCopyAllyStatsAbAttr") as [AttrSite];
    expect(site.attr.canApply({ pokemon: single })).toBe(false);
    expect(rebuild(site).canApply({ pokemon: single })).toBe(false);
    const { holder, ally } = await doublesWorld(phaserGame);
    const attr = rebuild(site);
    ally.setStatStage(BATTLE_STATS[0]!, 3);
    ally.setStatStage(BATTLE_STATS[4]!, -2);
    holder.setStatStage(BATTLE_STATS[1]!, 4);
    expect(attr.canApply({ pokemon: holder })).toBe(true);
    attr.apply({ pokemon: holder });
    expect(BATTLE_STATS.map(stat => holder.getStatStage(stat))).toEqual(
      BATTLE_STATS.map(stat => ally.getStatStage(stat)),
    );
    expect(holder.getStatStage(BATTLE_STATS[0]!)).toBe(3);
    expect(holder.getStatStage(BATTLE_STATS[1]!)).toBe(0);
  });

  it("PostSummonTransformAbAttr: Imposter picks the same foe with the same draws for every mix of copiable foes, and queues the same phase", async () => {
    const { holder, foes } = await doublesWorld(phaserGame);
    const [site] = sitesOf("PostSummonTransformAbAttr") as [AttrSite];
    const original = site.attr as PostSummonTransformAbAttr;
    const copy = rebuild(site) as PostSummonTransformAbAttr;
    expect(foes.length).toBe(2);
    const phases: unknown[][] = [];
    vi.spyOn(globalScene.phaseManager, "unshiftNew").mockImplementation(((...args: unknown[]) => {
      phases.push(args);
    }) as never);
    const cases: { name: string; copiable: boolean[] }[] = [
      { name: "both foes", copiable: [true, true] },
      { name: "only the first", copiable: [true, false] },
      { name: "only the second", copiable: [false, true] },
      { name: "none", copiable: [false, false] },
    ];
    let picked = 0;
    for (const { name, copiable } of cases) {
      for (const roll of [0, 1]) {
        for (const simulated of [false, true]) {
          const outcome: unknown[] = [];
          for (const attr of [original, copy]) {
            vi.spyOn(holder, "canTransformInto").mockImplementation(
              ((foe: Pokemon) => copiable[foes.indexOf(foe)] === true) as never,
            );
            const draws: number[] = [];
            vi.spyOn(holder, "randBattleSeedInt").mockImplementation(((range: number) => {
              draws.push(range);
              return Math.min(roll, range - 1);
            }) as never);
            phases.length = 0;
            const canApply = attr.canApply({ pokemon: holder, simulated });
            if (canApply) {
              attr.apply({ pokemon: holder, simulated });
            }
            outcome.push({
              canApply,
              draws,
              phases: phases.map(call => call.map(arg => (typeof arg === "function" ? "fn" : arg))),
            });
            vi.restoreAllMocks();
            vi.spyOn(globalScene.phaseManager, "unshiftNew").mockImplementation(((...args: unknown[]) => {
              phases.push(args);
            }) as never);
          }
          expect(outcome[1], `${name} roll ${roll} simulated=${simulated}`).toEqual(outcome[0]);
          const first = outcome[0] as { canApply: boolean; draws: number[]; phases: unknown[][] };
          expect(first.canApply).toBe(copiable.some(Boolean));
          // One draw whenever somebody is copiable, even simulated; the range is the number of copiable foes.
          expect(first.draws).toEqual(copiable.some(Boolean) ? [copiable.filter(Boolean).length] : []);
          if (first.canApply) {
            picked++;
            expect(first.phases.length).toBe(1);
            expect(first.phases[0]![0]).toBe("PokemonTransformPhase");
            expect(first.phases[0]![1]).toBe(holder.getBattlerIndex());
            expect(first.phases[0]![3]).toBe(true);
          }
        }
      }
    }
    expect(picked).toBeGreaterThan(0);
  });

  it("PostSummonTransformAbAttr: the restrictions of Transform (transformed, illusion, substitute, fusion) make the rebuilt attr refuse exactly like the original", async () => {
    const { holder, foes } = await doublesWorld(phaserGame);
    const [site] = sitesOf("PostSummonTransformAbAttr") as [AttrSite];
    const original = site.attr as PostSummonTransformAbAttr;
    const copy = rebuild(site) as PostSummonTransformAbAttr;
    const restrictions: [string, () => void][] = [
      ["the holder is transformed", () => vi.spyOn(holder, "isTransformed").mockReturnValue(true)],
      ["a foe is transformed", () => vi.spyOn(foes[0]!, "isTransformed").mockReturnValue(true)],
      [
        "a foe has a Substitute",
        () =>
          vi
            .spyOn(foes[0]!, "getTag")
            .mockImplementation(((type: unknown) => (type === BattlerTagType.SUBSTITUTE ? {} : undefined)) as never),
      ],
      ["the holder is a fusion", () => vi.spyOn(holder, "isFusion").mockReturnValue(true)],
      ["a foe is a fusion", () => vi.spyOn(foes[1]!, "isFusion").mockReturnValue(true)],
    ];
    const results: Record<string, boolean[]> = {};
    for (const [name, restrict] of restrictions) {
      const outcome: boolean[] = [];
      for (const attr of [original, copy]) {
        restrict();
        vi.spyOn(holder, "randBattleSeedInt").mockReturnValue(0);
        outcome.push(attr.canApply({ pokemon: holder }));
        vi.restoreAllMocks();
      }
      expect(outcome[1], name).toBe(outcome[0]);
      results[name] = outcome;
    }
    // Restricting the holder blocks everything; restricting one foe leaves the other foe.
    expect(results["the holder is transformed"]).toEqual([false, false]);
    expect(results["the holder is a fusion"]).toEqual([false, false]);
    expect(results["a foe is transformed"]).toEqual([true, true]);
    expect(results["a foe has a Substitute"]).toEqual([true, true]);
  });

  it("PostSummonTransformAbAttr: Imposter and its rebuild run the same battle (own twin, because the shared entry template selects Celebrate after the holder became the foe)", async () => {
    // The holder takes the foe's moveset when it transforms, so a scenario that always selects Celebrate fails for
    // Imposter before any comparison. The foe knows Tackle, so this scenario selects Tackle.
    const scenario = {
      template: {
        ...TEMPLATES.entry!,
        id: "entry-imposter",
        label: "Imposter enters and sits through two turns that use the copied Tackle",
        turns: [use(MoveId.TACKLE), use(MoveId.TACKLE)],
      },
      axes: {},
      label: "Imposter enters against a Magikarp (own twin)",
    };
    // The shared twin registers the rebuild under a shadow ability id, and the transform phase checks
    // `getAbility().id === IMPOSTER` (the Attack boost of a copied Imposter), so a shadow id would differ for a reason that
    // is not the attr. This twin swaps the rebuilt attr INTO the live ability, so the id stays the real one.
    const module = declRegistry.get("PostSummonTransformAbAttr")!;
    const ability = liveAbility(AbilityId.IMPOSTER);
    const originalAttrs = ability.attrs;
    const originalAttr = originalAttrs[0]!;
    const rebuiltAttr = recomposeAttr(module, originalAttr, AbilityId.IMPOSTER, 0);
    expect(rebuiltAttr).not.toBe(originalAttr);
    const run = async (attr: AbAttr): Promise<TraceData> => {
      // A NEW array: the ability caches its attrs per dispatch type, keyed on the identity of this array.
      (ability as unknown as { attrs: readonly AbAttr[] }).attrs = [attr];
      try {
        return await runScenario(
          freshGame(phaserGame),
          scenario.template,
          { abilityId: AbilityId.IMPOSTER, axes: {} },
          game => BattleTrace.attach(game, { rng: "seeded", seed: "b03-chunk4-imposter", aliases: {} }),
        );
      } finally {
        (ability as unknown as { attrs: readonly AbAttr[] }).attrs = originalAttrs;
      }
    };
    const original = await run(originalAttr);
    const rebuilt = await run(rebuiltAttr);
    const evaluated = original.attrEvents.some(event => event.startsWith("150#0 PostSummonTransformAbAttr "));
    expect(evaluated, "the original really evaluated the Transform attr").toBe(true);
    expect(diffTraces(original, rebuilt)).toEqual([]);
    expect(ability.attrs).toBe(originalAttrs);
  });

  describe("PostSummonFormChangeAbAttr: the seven form functions against the yes/no gate each one will become", () => {
    const HP = [1, 0.99, 0.51, 0.5, 0.49, 0.26, 0.25, 0.24, 0.01];
    const LEVELS = [5, 19, 20, 21, 100];
    const FORMS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 14];

    /** The gate written next to each binding in bindings.ts, as plain code (same atoms, same numbers). */
    const gates: Record<number, (hp: number, level: number, form: number, key: string, revelation: number) => boolean> =
      {
        // Zen Mode: any[ all[hp <= 50%, form is not 1], all[hp > 50%, form is not 0] ]
        161: (hp, _l, form) => (hp <= 0.5 ? form !== 1 : form !== 0),
        // Shields Down: all[ form number < 7, hp <= 50% ]
        197: (hp, _l, form) => form < 7 && hp <= 0.5,
        // Schooling: any[ all[any[level < 20, hp <= 25%], form is not 0], all[not that, form is not 1] ]
        208: (hp, level, form) => (level < 20 || hp <= 0.25 ? form !== 0 : form !== 1),
        // Power Construct: always true once its attr-level condition holds
        211: () => true,
        // Ice Face: form is not 0
        248: (_h, _l, form) => form !== 0,
        // Tera Shift: any[ all[form key is not empty, form is not 0], all[form key is empty, form is not 1] ]
        307: (_h, _l, form, key) => (key === "" ? form !== 1 : form !== 0),
        // Revelation: any[ all[hp > 25%, form is not Revelation], all[hp <= 25%, form is Revelation] ]
        5586: (hp, _l, form, _k, revelation) => (hp > 0.25 ? form !== revelation : form === revelation),
      };

    it("canApply answers like the gate for every HP line, level, form number and form key", async () => {
      const { holder } = await startWorld(phaserGame);
      let checked = 0;
      let trues = 0;
      for (const site of sitesOf(FORM_CHANGE)) {
        const attr = site.attr as PostSummonFormChangeAbAttr;
        const gate = gates[site.abilityId]!;
        // The Revelation form number is a start-up value inside the closure; read it from the function itself.
        vi.spyOn(holder, "getHpRatio").mockReturnValue(1);
        const revelation =
          site.abilityId === 5586 ? (attr as unknown as { formFunc(p: Pokemon): number }).formFunc(holder) : -1;
        vi.restoreAllMocks();
        for (const hp of HP) {
          for (const level of LEVELS) {
            for (const form of FORMS) {
              for (const key of ["", "tera"]) {
                if (key !== "" && site.abilityId !== 307) {
                  continue;
                }
                vi.spyOn(holder, "getHpRatio").mockReturnValue(hp);
                vi.spyOn(holder, "getFormKey").mockReturnValue(key);
                holder.level = level;
                holder.formIndex = form;
                const actual = attr.canApply({ pokemon: holder });
                vi.restoreAllMocks();
                expect(actual, `${site.abilityName} hp ${hp} level ${level} form ${form} key "${key}"`).toBe(
                  gate(hp, level, form, key, revelation),
                );
                checked++;
                trues += actual ? 1 : 0;
              }
            }
          }
        }
      }
      expect(checked).toBeGreaterThan(2000);
      expect(trues).toBeGreaterThan(500);
      holder.level = 100;
      holder.formIndex = 0;
    });

    it("apply asks the form-change machinery for the ability trigger, and not when simulated", async () => {
      const { holder } = await startWorld(phaserGame);
      for (const site of sitesOf(FORM_CHANGE)) {
        const attr = site.attr as PostSummonFormChangeAbAttr;
        for (const simulated of [false, true]) {
          const spy = vi.spyOn(globalScene, "triggerPokemonFormChange").mockReturnValue(true as never);
          attr.apply({ pokemon: holder, simulated });
          if (simulated) {
            expect(spy, site.abilityName).not.toHaveBeenCalled();
          } else {
            expect(spy.mock.calls, site.abilityName).toEqual([[holder, SpeciesFormChangeAbilityTrigger, false]]);
          }
          spy.mockRestore();
        }
        expect(site.attr.showAbility).toBe(true);
        expect((site.attr as unknown as { shouldActivateOnGain(): boolean }).shouldActivateOnGain()).toBe(true);
      }
    });

    it("the two attr-level conditions that stay carried (Power Construct, Ice Face) follow the rules the notes write down", async () => {
      const { game, holder } = await startWorld(phaserGame);
      const powerConstruct = sitesOf(FORM_CHANGE).find(site => site.abilityId === 211)!.attr;
      const iceFace = sitesOf(FORM_CHANGE).find(site => site.abilityId === 248)!.attr;
      for (const hp of HP) {
        for (const form of FORMS) {
          vi.spyOn(holder, "getHpRatio").mockReturnValue(hp);
          holder.formIndex = form;
          expect(powerConstruct.getCondition()(holder), `hp ${hp} form ${form}`).toBe(
            hp <= 0.5 && (form === 2 || form === 3),
          );
          vi.restoreAllMocks();
        }
      }
      for (const [weather, expected] of [
        [WeatherType.NONE, false],
        [WeatherType.HAIL, true],
        [WeatherType.SNOW, true],
        [WeatherType.RAIN, false],
        [WeatherType.SUNNY, false],
        [WeatherType.FOG, false],
      ] as const) {
        setWeatherOf(game, weather);
        expect(iceFace.getCondition()(holder), WeatherType[weather]).toBe(expected);
      }
      setWeatherOf(game, WeatherType.NONE);
      holder.formIndex = 0;
    });

    it("the HP line of every user is the rounded whole-percent ratio, which the exact HP atom does not equal (why the request asks for a new rounding)", async () => {
      const { holder } = await startWorld(phaserGame);
      const zen = sitesOf(FORM_CHANGE).find(site => site.abilityId === 161)!.attr as PostSummonFormChangeAbAttr;
      const max = holder.getMaxHp();
      holder.formIndex = 0;
      // One HP above exactly half: the exact test `hp * 100 <= max * 50` says no, `getHpRatio()` rounds to 0.50 and says yes.
      holder.hp = Math.floor(max / 2) + 1;
      expect(holder.hp * 100 <= max * 50).toBe(false);
      expect(holder.getHpRatio()).toBe(0.5);
      expect(zen.canApply({ pokemon: holder })).toBe(true);
      holder.hp = max;
      expect(zen.canApply({ pokemon: holder })).toBe(false);
    });
  });
});

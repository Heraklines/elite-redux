/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B04 chunk 3 probes. The shared L1 grid has no engine-parameter builder for the "cancel" triggers, the L2 templates cannot
// reach the battle-effect immunities nor the partner passes, and the Flower Veil closures are legacy closures (so the shared
// twin has nothing to rebuild for them). This file proves them by hand. Every test drives the ORIGINAL attr of a real ability
// and its REBUILD (recomposeAttr / buildAttr: a fresh instance made from the declaration; for a legacy closure the original
// closure is handed in as an override) side by side:
//   1. BattlerTagImmunity / UserFieldBattlerTagImmunity: every user x every battle effect of the game x cancelled yes/no x
//      simulated yes/no, plus the trigger message, and a rebuilt attr with a settings list the live users do not have;
//   2. the three Conditional* classes: every status / stat / battle effect x Grass and non-Grass target (a Stellar Tera Grass
//      Pokemon too, which is WHY the closure is not the library type atom) x status source (none, itself, a foe);
//   3. BlockCrit, EnemyMinDamageRoll, DefensiveStatSubstitute: direct apply, the setting, and real damage calculations;
//   4. real battles, original ability against its rebuilt shadow: Own Tempo and Oblivious against Confuse Ray and Taunt,
//      Aroma Veil in doubles against Heal Block, Flower Veil in doubles against Glare and Growl.
import type { AbAttr } from "#abilities/ab-attrs";
import {
  BattlerTagImmunityAbAttr,
  BlockCritAbAttr,
  ConditionalUserFieldBattlerTagImmunityAbAttr,
  ConditionalUserFieldProtectStatAbAttr,
  ConditionalUserFieldStatusEffectImmunityAbAttr,
  DefensiveStatSubstituteAbAttr,
  EnemyMinDamageRollAbAttr,
  UserFieldBattlerTagImmunityAbAttr,
} from "#abilities/ab-attrs";
import { BattlerTag } from "#data/battler-tags";
import { allMoves } from "#data/data-lists";
import { buildAttr, recomposeAttr } from "#data/elite-redux/ability-studio/build-attr";
import { declRegistry } from "#data/elite-redux/ability-studio/decl-registry";
import { AbilityId } from "#enums/ability-id";
import { BattlerTagType } from "#enums/battler-tag-type";
import { MoveId } from "#enums/move-id";
import { PokemonType } from "#enums/pokemon-type";
import { SpeciesId } from "#enums/species-id";
import { Stat } from "#enums/stat";
import { StatusEffect } from "#enums/status-effect";
import type { Pokemon } from "#field/pokemon";
import type { GameManager } from "#test/framework/game-manager";
import { freshGame } from "#test/tests/elite-redux/decomp/harness/game";
import { rebuildAbility, registerShadow, unregisterShadows } from "#test/tests/elite-redux/decomp/harness/rebuild";
import { allAttrSites } from "#test/tests/elite-redux/decomp/harness/sites";
import { allocateShadowId, liveAbility } from "#test/tests/elite-redux/decomp/harness/twin";
import { BooleanHolder, NumberHolder } from "#utils/common";
import Phaser from "phaser";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

const FLOWER_VEIL = 166;
const JUNGLES_GUARD = 5194;
const AROMA_VEIL = 165;
const OWN_TEMPO = 20;
const OBLIVIOUS = 12;
const TANGLED_FEET = 77;
const CHUNK3_CLASSES: ReadonlySet<string> = new Set([
  "ConditionalUserFieldStatusEffectImmunityAbAttr",
  "ConditionalUserFieldProtectStatAbAttr",
  "BattlerTagImmunityAbAttr",
  "UserFieldBattlerTagImmunityAbAttr",
  "ConditionalUserFieldBattlerTagImmunityAbAttr",
  "BlockCritAbAttr",
  "EnemyMinDamageRollAbAttr",
  "DefensiveStatSubstituteAbAttr",
]);
const BAD_LUCK = 5072;

// The attrs are typed per trigger; the tests feed them plain parameter objects.
// biome-ignore lint/suspicious/noExplicitAny: parameter objects differ per trigger
type Params = any;

function sitesOf(className: string): { abilityId: number; abilityName: string; attrIndex: number }[] {
  return allAttrSites()
    .filter(site => site.className === className)
    .map(({ abilityId, abilityName, attrIndex }) => ({ abilityId, abilityName, attrIndex }));
}

/** The original attr of a live ability and its rebuild from the declaration (a legacy closure is passed in as it is). */
function pair(abilityId: number, attrIndex: number, className: string): { original: AbAttr; rebuilt: AbAttr } {
  const original = liveAbility(abilityId).attrs[attrIndex];
  expect(original.constructor.name).toBe(className);
  const module = declRegistry.get(className);
  expect(module, `${className} has a declaration`).toBeDefined();
  const closure = (original as unknown as { condition?: unknown }).condition;
  const rebuilt = recomposeAttr(
    module!,
    original,
    abilityId,
    attrIndex,
    closure === undefined ? {} : { conds: { "ctor:0": closure as never } },
  );
  expect(rebuilt).not.toBe(original);
  expect(rebuilt.constructor.name).toBe(className);
  return { original, rebuilt };
}

const ALL_TAG_TYPES = Object.values(BattlerTagType) as BattlerTagType[];
const STATS = [Stat.ATK, Stat.DEF, Stat.SPATK, Stat.SPDEF, Stat.SPD, Stat.ACC, Stat.EVA] as const;
const STATUSES = [
  StatusEffect.POISON,
  StatusEffect.TOXIC,
  StatusEffect.PARALYSIS,
  StatusEffect.SLEEP,
  StatusEffect.FREEZE,
  StatusEffect.BURN,
  StatusEffect.FAINT,
] as const;

describe("B04 chunk 3: classes the shared L1 grid and L2 templates cannot fully reach", () => {
  let phaserGame: Phaser.Game;
  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });
  afterEach(unregisterShadows);

  async function start(
    setup: (game: GameManager) => void,
    ...species: SpeciesId[]
  ): Promise<{ game: GameManager; player: Pokemon[]; enemy: Pokemon[] }> {
    const game = freshGame(phaserGame);
    game.override
      .battleStyle(species.length > 1 ? "double" : "single")
      .startingWave(species.length > 1 ? 2 : 1)
      .moveset([MoveId.SPLASH])
      .startingLevel(100)
      .enemyLevel(30)
      .enemyMoveset(MoveId.SPLASH)
      .enemySpecies(SpeciesId.MAGIKARP)
      .enemyAbility(AbilityId.BALL_FETCH)
      .ability(AbilityId.BALL_FETCH)
      .criticalHits(false)
      .hasPassiveAbility(false)
      .enemyHasPassiveAbility(false);
    setup(game);
    await game.classicMode.startBattle(...species);
    return { game, player: game.scene.getPlayerField(), enemy: game.scene.getEnemyField() };
  }

  it("battle-effect immunities: every user, every battle effect, cancelled or not, simulated or not, and the message", async () => {
    const { player, enemy } = await start(() => {}, SpeciesId.BLISSEY);
    const holder = player[0];
    let compared = 0;
    for (const className of ["BattlerTagImmunityAbAttr", "UserFieldBattlerTagImmunityAbAttr"]) {
      const sites = sitesOf(className);
      expect(sites.length, `${className} has users`).toBeGreaterThan(0);
      for (const site of sites) {
        const { original, rebuilt } = pair(site.abilityId, site.attrIndex, className);
        const list = (original as unknown as { immuneTagTypes: BattlerTagType[] }).immuneTagTypes;
        expect(
          [...(rebuilt as unknown as { immuneTagTypes: BattlerTagType[] }).immuneTagTypes],
          site.abilityName,
        ).toEqual([...list]);
        expect(
          (rebuilt as unknown as { immuneTagTypes: BattlerTagType[] }).immuneTagTypes,
          `${site.abilityName}: a fresh list, not the live one`,
        ).not.toBe(list);
        for (const tagType of ALL_TAG_TYPES) {
          for (const cancelledBefore of [false, true]) {
            for (const simulated of [false, true]) {
              const make = (): Params => ({
                pokemon: holder,
                tag: new BattlerTag(tagType, 0, 0),
                simulated,
                cancelled: new BooleanHolder(cancelledBefore),
                target: enemy[0],
              });
              const label = `${site.abilityName} #${site.attrIndex} tag=${tagType} cancelled=${cancelledBefore} simulated=${simulated}`;
              const a = make();
              const b = make();
              const expected = !cancelledBefore && list.includes(tagType);
              expect(original.canApply(a), `${label}: original`).toBe(expected);
              expect(rebuilt.canApply(b), `${label}: rebuilt`).toBe(expected);
              if (expected) {
                original.apply(a);
                rebuilt.apply(b);
                expect(a.cancelled.value, label).toBe(true);
                expect(b.cancelled.value, label).toBe(true);
                expect(rebuilt.getTriggerMessage(b, "Test Ability"), `${label}: message`).toBe(
                  original.getTriggerMessage(a, "Test Ability"),
                );
              } else {
                expect(a.cancelled.value, label).toBe(cancelledBefore);
                expect(b.cancelled.value, label).toBe(cancelledBefore);
              }
              compared++;
            }
          }
        }
      }
    }
    expect(compared).toBeGreaterThan(2000);
  });

  it("settings the live users do not have still build the same attr as the constructor does", async () => {
    const { player } = await start(() => {}, SpeciesId.BLISSEY);
    const holder = player[0];
    const own = declRegistry.get("BattlerTagImmunityAbAttr")!;
    const field = declRegistry.get("UserFieldBattlerTagImmunityAbAttr")!;
    const cond = declRegistry.get("ConditionalUserFieldBattlerTagImmunityAbAttr")!;
    const grass = (t: Pokemon): boolean => t.isOfType(PokemonType.GRASS, true, true);
    const pairs: [string, AbAttr, AbAttr][] = [
      [
        "own list",
        buildAttr(own, { effects: "Flinch, Heal Block, Fear" }),
        new BattlerTagImmunityAbAttr([BattlerTagType.FLINCHED, BattlerTagType.HEAL_BLOCK, BattlerTagType.ER_FEAR]),
      ],
      [
        "partner list",
        buildAttr(field, { effects: "Taunt" }),
        new UserFieldBattlerTagImmunityAbAttr([BattlerTagType.TAUNT]),
      ],
      [
        "conditional partner list",
        buildAttr(cond, { effects: "Confusion, Bleed" }, { "ctor:0": grass }),
        new ConditionalUserFieldBattlerTagImmunityAbAttr(grass, [BattlerTagType.CONFUSED, BattlerTagType.ER_BLEED]),
      ],
    ];
    for (const [label, built, reference] of pairs) {
      for (const tagType of ALL_TAG_TYPES) {
        const make = (): Params => ({
          pokemon: holder,
          tag: new BattlerTag(tagType, 0, 0),
          simulated: false,
          cancelled: new BooleanHolder(false),
          target: holder,
        });
        expect(built.canApply(make()), `${label} ${tagType}`).toBe(reference.canApply(make()));
      }
    }
    expect(() => buildAttr(own, { effects: "" })).toThrow(/at least one battle effect/);
    expect(() => buildAttr(own, { effects: "Not a real effect" })).toThrow(/not a known battle effect/);
  });

  it("Grass-type closures: every status, stat and battle effect x Grass / non-Grass / Stellar Tera x source, original against rebuild", async () => {
    const { player, enemy } = await start(() => {}, SpeciesId.VENUSAUR, SpeciesId.BLISSEY);
    const [grassMon, normalMon] = player;
    const foe = enemy[0];
    expect(grassMon.isOfType(PokemonType.GRASS)).toBe(true);
    expect(normalMon.isOfType(PokemonType.GRASS)).toBe(false);

    // A Stellar Tera Grass Pokemon: the closure keeps its original types, the library atom's call would not.
    const stellar = grassMon;
    stellar.isTerastallized = true;
    const teraType = vi_spy(stellar, PokemonType.STELLAR);
    expect(stellar.isOfType(PokemonType.GRASS), "isOfType(GRASS): Stellar Tera hides the type").toBe(false);
    expect(stellar.isOfType(PokemonType.GRASS, true, true), "isOfType(GRASS, true, true): the closure's call").toBe(
      true,
    );
    teraType.restore();
    stellar.isTerastallized = false;

    const targets: [string, Pokemon, boolean][] = [
      ["grass", grassMon, false],
      ["normal", normalMon, false],
      ["grass with Stellar Tera", grassMon, true],
    ];
    let compared = 0;
    for (const [abilityId, abilityName] of [
      [FLOWER_VEIL, "Flower Veil"],
      [JUNGLES_GUARD, "Jungle's Guard"],
    ] as const) {
      const status = pair(abilityId, 0, "ConditionalUserFieldStatusEffectImmunityAbAttr");
      const effect = pair(abilityId, 1, "ConditionalUserFieldBattlerTagImmunityAbAttr");
      const stat = pair(abilityId, 2, "ConditionalUserFieldProtectStatAbAttr");
      for (const [targetName, target, stellarTera] of targets) {
        const restore = stellarTera ? stellarize(target) : () => {};
        const isGrass = target.isOfType(PokemonType.GRASS, true, true);
        expect(isGrass, `${targetName}: the closure's view`).toBe(target === grassMon);
        // Status: source none / the target itself / a foe.
        for (const [sourceName, source] of [
          ["no source", null],
          ["itself", target],
          ["a foe", foe],
        ] as const) {
          for (const statusEffect of STATUSES) {
            for (const cancelledBefore of [false, true]) {
              const make = (): Params => ({
                pokemon: normalMon === target ? grassMon : normalMon,
                effect: statusEffect,
                simulated: false,
                cancelled: new BooleanHolder(cancelledBefore),
                target,
                source,
              });
              const label = `${abilityName} status=${StatusEffect[statusEffect]} target=${targetName} source=${sourceName} cancelled=${cancelledBefore}`;
              const a = make();
              const b = make();
              const expected =
                !cancelledBefore
                && source !== null
                && target.id !== source.id
                && isGrass
                && statusEffect !== StatusEffect.FAINT;
              expect(status.original.canApply(a), `${label}: original`).toBe(expected);
              expect(status.rebuilt.canApply(b), `${label}: rebuilt`).toBe(expected);
              if (expected) {
                status.original.apply(a);
                status.rebuilt.apply(b);
                expect(a.cancelled.value && b.cancelled.value, label).toBe(true);
              }
              compared++;
            }
          }
        }
        // Battle effect: every effect type; only Drowsiness is on the list.
        for (const tagType of ALL_TAG_TYPES) {
          for (const cancelledBefore of [false, true]) {
            const make = (): Params => ({
              pokemon: normalMon === target ? grassMon : normalMon,
              tag: new BattlerTag(tagType, 0, 0),
              simulated: false,
              cancelled: new BooleanHolder(cancelledBefore),
              target,
            });
            const label = `${abilityName} effect=${tagType} target=${targetName} cancelled=${cancelledBefore}`;
            const expected = !cancelledBefore && tagType === BattlerTagType.DROWSY && isGrass;
            expect(effect.original.canApply(make()), `${label}: original`).toBe(expected);
            expect(effect.rebuilt.canApply(make()), `${label}: rebuilt`).toBe(expected);
            compared++;
          }
        }
        // Stat drops: every stat, with and without a target.
        for (const statId of STATS) {
          for (const cancelledBefore of [false, true]) {
            for (const withTarget of [true, false]) {
              const make = (): Params => ({
                pokemon: target,
                stat: statId,
                stages: -1,
                simulated: false,
                cancelled: new BooleanHolder(cancelledBefore),
                ...(withTarget ? { target } : {}),
              });
              const label = `${abilityName} stat=${Stat[statId]} target=${targetName} withTarget=${withTarget} cancelled=${cancelledBefore}`;
              const expected = withTarget && !cancelledBefore && isGrass;
              expect(stat.original.canApply(make()), `${label}: original`).toBe(expected);
              expect(stat.rebuilt.canApply(make()), `${label}: rebuilt`).toBe(expected);
              compared++;
            }
          }
        }
        restore();
      }
    }
    expect(compared).toBeGreaterThan(1000);
  });

  it("settings of the conditional status block: a Sleep-only list builds the same attr as the constructor", async () => {
    const { player, enemy } = await start(() => {}, SpeciesId.VENUSAUR, SpeciesId.BLISSEY);
    const closure = (target: Pokemon, source: Pokemon | null): boolean => !!source && target.id !== source.id;
    const built = buildAttr(
      declRegistry.get("ConditionalUserFieldStatusEffectImmunityAbAttr")!,
      { statuses: "Sleep, Burn" },
      { "ctor:0": closure },
    );
    const reference = new ConditionalUserFieldStatusEffectImmunityAbAttr(
      closure,
      StatusEffect.SLEEP,
      StatusEffect.BURN,
    );
    for (const effect of STATUSES) {
      for (const cancelledBefore of [false, true]) {
        const make = (): Params => ({
          pokemon: player[1],
          effect,
          simulated: false,
          cancelled: new BooleanHolder(cancelledBefore),
          target: player[0],
          source: enemy[0],
        });
        expect(built.canApply(make()), `${StatusEffect[effect]} cancelled=${cancelledBefore}`).toBe(
          reference.canApply(make()),
        );
      }
    }
    expect(
      new ConditionalUserFieldProtectStatAbAttr(() => true, Stat.ATK).canApply({
        pokemon: player[0],
        stat: Stat.DEF,
        stages: -1,
        cancelled: new BooleanHolder(false),
        target: player[0],
      } as Params),
      "a stat given to the constructor is ignored: the stat clause is dead (suspected game bug, not fixed)",
    ).toBe(true);
  });

  it("crit block, minimum damage roll and defensive stat substitute: apply, setting and real damage", async () => {
    const { player, enemy } = await start(() => {}, SpeciesId.BLISSEY);
    const holder = player[0];
    const foe = enemy[0];

    // BlockCrit: no clause, apply sets the holder value; the rebuild equals the original for every user.
    const crit = sitesOf("BlockCritAbAttr");
    expect(crit.length).toBe(16);
    for (const site of crit) {
      const { original, rebuilt } = pair(site.abilityId, site.attrIndex, "BlockCritAbAttr");
      for (const attr of [original, rebuilt]) {
        const holderValue = new BooleanHolder(false);
        expect(attr.canApply({ pokemon: holder, blockCrit: holderValue } as Params), site.abilityName).toBe(true);
        attr.apply({ pokemon: holder, blockCrit: holderValue } as Params);
        expect(holderValue.value, site.abilityName).toBe(true);
      }
      expect(rebuilt.showAbility, `${site.abilityName}: showAbility`).toBe(original.showAbility);
    }

    // EnemyMinDamageRoll: forces the floor whatever the roll was, no clause.
    for (const site of sitesOf("EnemyMinDamageRollAbAttr")) {
      const { original, rebuilt } = pair(site.abilityId, site.attrIndex, "EnemyMinDamageRollAbAttr");
      for (const attr of [original, rebuilt]) {
        for (const roll of [0.85, 0.93, 1]) {
          const rollMultiplier = new NumberHolder(roll);
          expect(attr.canApply({ pokemon: holder, rollMultiplier, simulated: false } as Params), site.abilityName).toBe(
            true,
          );
          attr.apply({ pokemon: holder, rollMultiplier, simulated: false } as Params);
          expect(rollMultiplier.value, `${site.abilityName} roll ${roll}`).toBe(0.85);
        }
      }
    }

    // DefensiveStatSubstitute: the setting reads back, a different one builds, apply writes it.
    const tangled = pair(TANGLED_FEET, 0, "DefensiveStatSubstituteAbAttr");
    for (const attr of [tangled.original, tangled.rebuilt]) {
      const statHolder = new NumberHolder(Stat.DEF);
      attr.apply({ pokemon: holder, simulated: false, statHolder } as Params);
      expect(statHolder.value).toBe(Stat.SPD);
    }
    expect(
      (tangled.rebuilt as unknown as { extraCondition?: unknown }).extraCondition,
      "the attr-level condition (confused or enraged) is carried over",
    ).toBe((tangled.original as unknown as { extraCondition?: unknown }).extraCondition);
    const module = declRegistry.get("DefensiveStatSubstituteAbAttr")!;
    for (const [name, stat] of [
      ["Attack", Stat.ATK],
      ["Defense", Stat.DEF],
      ["Sp. Atk", Stat.SPATK],
      ["Sp. Def", Stat.SPDEF],
      ["Speed", Stat.SPD],
    ] as const) {
      const built = buildAttr(module, { stat: name });
      expect((built as unknown as { substituteStat: Stat }).substituteStat, name).toBe(stat);
      expect(built).toBeInstanceOf(DefensiveStatSubstituteAbAttr);
    }
    expect(() => buildAttr(module, { stat: "Accuracy" })).toThrow(/must be one of Attack, Defense/);
    expect(buildAttr(declRegistry.get("BlockCritAbAttr")!)).toBeInstanceOf(BlockCritAbAttr);
    expect(buildAttr(declRegistry.get("EnemyMinDamageRollAbAttr")!)).toBeInstanceOf(EnemyMinDamageRollAbAttr);

    // Real damage: the same hit against the same defender with each ability.
    const hit = (defender: Pokemon, source: Pokemon): number =>
      defender.getAttackDamage({
        source,
        move: allMoves[MoveId.TACKLE],
        simulated: false,
        forcedRandomMultiplier: 1,
      }).damage;
    const baseline = hit(holder, foe);
    expect(baseline).toBeGreaterThan(1);
    const original = liveAbility(BAD_LUCK);
    const shadowId = allocateShadowId();
    const rebuilt = rebuildAbility(original, shadowId, { registry: declRegistry });
    expect(rebuilt.rebuilt.length, "the Bad Luck attr was rebuilt").toBeGreaterThan(0);
    registerShadow(shadowId, rebuilt.ability);
    const damages: number[] = [];
    for (const id of [BAD_LUCK, shadowId]) {
      const world = await start(game => game.override.ability(id as AbilityId), SpeciesId.BLISSEY);
      damages.push(hit(world.player[0], world.enemy[0]));
    }
    expect(damages[1], "rebuilt Bad Luck takes the same damage as the original").toBe(damages[0]);
    expect(damages[0], "the 85% floor is applied even to a forced 100% roll").toBeLessThan(baseline);
  });

  describe("real battles: the original ability against its rebuilt shadow", () => {
    interface Outcome {
      readonly stages: number[][];
      readonly statuses: (string | null)[];
      readonly tags: boolean[][];
    }

    /** Overrides for the Grass-closure abilities: the original closure is handed to every rebuilt attr. */
    function legacyOverrides(abilityId: number): Record<number, { conds: Record<string, never> }> {
      const result: Record<number, { conds: Record<string, never> }> = {};
      liveAbility(abilityId).attrs.forEach((attr, index) => {
        const closure = (attr as unknown as { condition?: unknown }).condition;
        if (closure !== undefined) {
          result[index] = { conds: { "ctor:0": closure as never } };
        }
      });
      return result;
    }

    async function twin(
      abilityId: number,
      play: (id: number) => Promise<Outcome>,
    ): Promise<{ original: Outcome; shadow: Outcome }> {
      const original = await play(abilityId);
      const shadowId = allocateShadowId();
      const rebuilt = rebuildAbility(liveAbility(abilityId), shadowId, {
        registry: declRegistry,
        overrides: legacyOverrides(abilityId),
      });
      expect(
        rebuilt.carried.filter(entry => CHUNK3_CLASSES.has(entry.className)),
        "every attr of this chunk is rebuilt",
      ).toEqual([]);
      expect(rebuilt.rebuilt.length, "something was rebuilt").toBeGreaterThan(0);
      registerShadow(shadowId, rebuilt.ability);
      const shadow = await play(shadowId);
      return { original, shadow };
    }

    const WATCHED_TAGS = [
      BattlerTagType.CONFUSED,
      BattlerTagType.TAUNT,
      BattlerTagType.DROWSY,
      BattlerTagType.ER_FEAR,
      BattlerTagType.HEAL_BLOCK,
    ];

    function snapshot(player: Pokemon[]): Outcome {
      return {
        stages: player.map(mon => STATS.map(stat => mon.getStatStage(stat))),
        statuses: player.map(mon =>
          mon.status === null || mon.status === undefined ? null : StatusEffect[mon.status.effect],
        ),
        tags: player.map(mon => WATCHED_TAGS.map(tag => mon.getTag(tag) !== undefined)),
      };
    }

    it("Own Tempo and Oblivious: the foe's Confuse Ray and Taunt do not land, the same in original and rebuild", async () => {
      for (const [abilityId, label, move, tag] of [
        [OWN_TEMPO, "Own Tempo", MoveId.CONFUSE_RAY, BattlerTagType.CONFUSED],
        [OBLIVIOUS, "Oblivious", MoveId.TAUNT, BattlerTagType.TAUNT],
      ] as const) {
        const { original, shadow } = await twin(abilityId, async id => {
          const world = await start(
            game => game.override.ability(id as AbilityId).enemyMoveset(move),
            SpeciesId.BLISSEY,
          );
          world.game.move.select(MoveId.SPLASH);
          await world.game.toNextTurn();
          return snapshot(world.player);
        });
        expect(shadow, label).toEqual(original);
        expect(original.tags[0][WATCHED_TAGS.indexOf(tag)], `${label}: the effect never lands`).toBe(false);
        const control = await start(game => game.override.enemyMoveset(move), SpeciesId.BLISSEY);
        control.game.move.select(MoveId.SPLASH);
        await control.game.toNextTurn();
        expect(
          control.player[0].getTag(tag) !== undefined,
          `${label}: without the ability the foe's move does put the effect on me`,
        ).toBe(true);
      }
    });

    it("Aroma Veil in doubles: my partner cannot be put under Heal Block, the same in original and rebuild", async () => {
      const { original, shadow } = await twin(AROMA_VEIL, async id => {
        const world = await start(
          game =>
            game.override
              .startingWave(2)
              .ability(id as AbilityId)
              .enemyMoveset(MoveId.HEAL_BLOCK),
          SpeciesId.BLISSEY,
          SpeciesId.CHANSEY,
        );
        world.game.move.select(MoveId.SPLASH, 0);
        world.game.move.select(MoveId.SPLASH, 1);
        await world.game.toNextTurn();
        return snapshot(world.player);
      });
      expect(shadow).toEqual(original);
      expect(
        original.tags.map(tags => tags[WATCHED_TAGS.indexOf(BattlerTagType.HEAL_BLOCK)]),
        "nobody on an Aroma Veil side gets Heal Block",
      ).toEqual([false, false]);
      const control = await start(
        game => game.override.startingWave(2).enemyMoveset(MoveId.HEAL_BLOCK),
        SpeciesId.BLISSEY,
        SpeciesId.CHANSEY,
      );
      control.game.move.select(MoveId.SPLASH, 0);
      control.game.move.select(MoveId.SPLASH, 1);
      await control.game.toNextTurn();
      expect(
        control.player.some(mon => mon.getTag(BattlerTagType.HEAL_BLOCK) !== undefined),
        "without Aroma Veil Heal Block lands",
      ).toBe(true);
    });

    it("Flower Veil and Jungle's Guard in doubles: a Grass partner is protected from Glare and Growl, a Normal one is not", async () => {
      for (const [abilityId, label] of [
        [FLOWER_VEIL, "Flower Veil"],
        [JUNGLES_GUARD, "Jungle's Guard"],
      ] as const) {
        for (const move of [MoveId.GLARE, MoveId.GROWL]) {
          const { original, shadow } = await twin(abilityId, async id => {
            const world = await start(
              game =>
                game.override
                  .startingWave(2)
                  .ability(id as AbilityId)
                  .enemyMoveset(move)
                  .enemyLevel(50),
              SpeciesId.VENUSAUR,
              SpeciesId.BLISSEY,
            );
            world.game.move.select(MoveId.SPLASH, 0);
            world.game.move.select(MoveId.SPLASH, 1);
            await world.game.toNextTurn();
            return snapshot(world.player);
          });
          expect(shadow, `${label} ${MoveId[move]}`).toEqual(original);
          // Venusaur (Grass) is index 0: never put to sleep, never lowered.
          expect(original.statuses[0], `${label} ${MoveId[move]}: the Grass Pokemon has no status`).toBeNull();
          if (move === MoveId.GLARE) {
            const control = await start(
              game => game.override.startingWave(2).enemyMoveset(move).enemyLevel(50),
              SpeciesId.VENUSAUR,
              SpeciesId.BLISSEY,
            );
            control.game.move.select(MoveId.SPLASH, 0);
            control.game.move.select(MoveId.SPLASH, 1);
            await control.game.toNextTurn();
            expect(
              control.player.some(mon => mon.status?.effect === StatusEffect.PARALYSIS),
              `${label}: without the ability Glare paralyses someone`,
            ).toBe(true);
          }
          if (move === MoveId.GROWL) {
            expect(original.stages[0][0], `${label}: the Grass Pokemon keeps its Attack`).toBe(0);
            expect(original.stages[1][0], `${label}: the Normal Pokemon is not protected`).toBeLessThan(0);
          }
        }
      }
    });

    it("Tangled Feet: a confused holder defends with Speed, the same damage in original and rebuild; an unconfused one does not", async () => {
      const damages: Record<string, number[]> = {};
      const original = liveAbility(TANGLED_FEET);
      const shadowId = allocateShadowId();
      const rebuilt = rebuildAbility(original, shadowId, { registry: declRegistry });
      expect(rebuilt.rebuilt, "the substitute attr is rebuilt").toContain(0);
      registerShadow(shadowId, rebuilt.ability);
      for (const [name, id] of [
        ["original", TANGLED_FEET],
        ["rebuild", shadowId],
      ] as const) {
        for (const confused of [false, true]) {
          const world = await start(game => game.override.ability(id as AbilityId), SpeciesId.BLISSEY);
          const holder = world.player[0];
          if (confused) {
            holder.addTag(BattlerTagType.CONFUSED, 3, MoveId.NONE, world.enemy[0].id);
            expect(holder.getTag(BattlerTagType.CONFUSED)).toBeDefined();
          }
          const result = [MoveId.TACKLE, MoveId.WATER_GUN].map(
            move => holder.getAttackDamage({ source: world.enemy[0], move: allMoves[move] }).damage,
          );
          (damages[`${name} confused=${confused}`] ??= []).push(...result);
        }
      }
      expect(damages["rebuild confused=false"]).toEqual(damages["original confused=false"]);
      expect(damages["rebuild confused=true"]).toEqual(damages["original confused=true"]);
      expect(
        damages["original confused=true"],
        "Speed replaces Defense and Sp. Def, so a confused holder takes different damage (Blissey's Speed is far above its Defense)",
      ).not.toEqual(damages["original confused=false"]);
    });
  });
});

/** Makes `pokemon` report Stellar as its Tera type for the closure checks; `restore` undoes it. */
function vi_spy(pokemon: Pokemon, teraType: PokemonType): { restore: () => void } {
  const original = pokemon.getTeraType.bind(pokemon);
  pokemon.getTeraType = () => teraType;
  return {
    restore: () => {
      pokemon.getTeraType = original;
    },
  };
}

function stellarize(pokemon: Pokemon): () => void {
  const spy = vi_spy(pokemon, PokemonType.STELLAR);
  pokemon.isTerastallized = true;
  return () => {
    spy.restore();
    pokemon.isTerastallized = false;
  };
}

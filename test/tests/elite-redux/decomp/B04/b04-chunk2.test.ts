/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B04 chunk 2 probes. The shared L1 grid has no engine-parameter builder for the "cancel" triggers and the L2 templates
// cannot reach three of the classes (self drops, the partner pass, a status the holder inflicts), so this file proves them
// by hand. Every test drives the ORIGINAL attr of a real ability and its REBUILD (recomposeAttr: a fresh instance made
// from the declaration) side by side, over the whole input range the class can see:
//   1. ProtectStat / SelfStatDrop / UserFieldSelfStatDrop: every stat x several stage amounts x cancelled yes/no x simulated,
//      for EVERY live user (so every distinct stat setting), and the trigger message;
//   2. StatusEffectImmunity / UserFieldStatusEffectImmunity: every status (including FAINT) x cancelled yes/no, every user;
//   3. Reflect: source known / unknown, the phase it queues (exact arguments), simulated;
//   4. Confusion on status: the three canApply clauses, the one random draw (2 to 5) and `simulated`;
//   5. the gas of Neutralizing Gas: no gas, one source, two sources, simulated;
//   6. real battles, original ability against its rebuilt shadow: a holder using Superpower (self drops), Evaporate under Mist
//      in doubles, Sweet Veil in doubles and Poison Puppeteer poisoning a foe.
import type { AbAttr } from "#abilities/ab-attrs";
import { globalScene } from "#app/global-scene";
import { allMoves } from "#data/data-lists";
import { recomposeAttr } from "#data/elite-redux/ability-studio/build-attr";
import { declRegistry } from "#data/elite-redux/ability-studio/decl-registry";
import { AbilityId } from "#enums/ability-id";
import { ArenaTagSide } from "#enums/arena-tag-side";
import { ArenaTagType } from "#enums/arena-tag-type";
import { BattlerIndex } from "#enums/battler-index";
import { BattlerTagType } from "#enums/battler-tag-type";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { Stat } from "#enums/stat";
import { StatusEffect } from "#enums/status-effect";
import type { Pokemon } from "#field/pokemon";
import type { GameManager } from "#test/framework/game-manager";
import { freshGame } from "#test/tests/elite-redux/decomp/harness/game";
import { rebuildAbility, registerShadow, unregisterShadows } from "#test/tests/elite-redux/decomp/harness/rebuild";
import { allAttrSites } from "#test/tests/elite-redux/decomp/harness/sites";
import { allocateShadowId, liveAbility } from "#test/tests/elite-redux/decomp/harness/twin";
import { BooleanHolder } from "#utils/common";
import Phaser from "phaser";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

const EVAPORATE = 5180;
const POISON_PUPPETEER = 310;

function sitesOf(className: string): { abilityId: number; abilityName: string; attrIndex: number }[] {
  return allAttrSites()
    .filter(site => site.className === className)
    .map(({ abilityId, abilityName, attrIndex }) => ({ abilityId, abilityName, attrIndex }));
}

function pair(abilityId: number, attrIndex: number, className: string): { original: AbAttr; rebuilt: AbAttr } {
  const original = liveAbility(abilityId).attrs[attrIndex];
  expect(original.constructor.name).toBe(className);
  const module = declRegistry.get(className);
  expect(module, `${className} has a declaration`).toBeDefined();
  const rebuilt = recomposeAttr(module!, original, abilityId, attrIndex);
  expect(rebuilt).not.toBe(original);
  expect(rebuilt.constructor.name).toBe(className);
  return { original, rebuilt };
}

// The attrs are typed per trigger; the tests feed them plain parameter objects.
// biome-ignore lint/suspicious/noExplicitAny: parameter objects differ per trigger
type Params = any;

const STATS = [Stat.ATK, Stat.DEF, Stat.SPATK, Stat.SPDEF, Stat.SPD, Stat.ACC, Stat.EVA] as const;
const STAGES = [-2, -1, 1] as const;
const STATUSES = [
  StatusEffect.POISON,
  StatusEffect.TOXIC,
  StatusEffect.PARALYSIS,
  StatusEffect.SLEEP,
  StatusEffect.FREEZE,
  StatusEffect.BURN,
  StatusEffect.FAINT,
] as const;

describe("B04 chunk 2: classes the shared L1 grid and L2 templates cannot fully reach", () => {
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

  it("stat-drop blocks: every user, every stat, every stage amount, cancelled or not, simulated or not", async () => {
    const { player } = await start(() => {}, SpeciesId.BLISSEY);
    const holder = player[0];
    let compared = 0;
    for (const className of [
      "ProtectStatAbAttr",
      "SelfStatDropImmunityAbAttr",
      "UserFieldSelfStatDropImmunityAbAttr",
    ]) {
      const sites = sitesOf(className);
      expect(sites.length, `${className} has users`).toBeGreaterThan(0);
      for (const site of sites) {
        const { original, rebuilt } = pair(site.abilityId, site.attrIndex, className);
        const protectedStat = (original as unknown as { protectedStat?: Stat }).protectedStat;
        expect((rebuilt as unknown as { protectedStat?: Stat }).protectedStat, `${site.abilityName}: setting`).toBe(
          protectedStat,
        );
        for (const stat of STATS) {
          for (const stages of STAGES) {
            for (const cancelledBefore of [false, true]) {
              for (const simulated of [false, true]) {
                const make = (): Params => ({
                  pokemon: holder,
                  stat,
                  stages,
                  simulated,
                  cancelled: new BooleanHolder(cancelledBefore),
                });
                const label = `${site.abilityName} #${site.attrIndex} stat=${Stat[stat]} stages=${stages} cancelled=${cancelledBefore} simulated=${simulated}`;
                const a = make();
                const b = make();
                const expected =
                  !cancelledBefore
                  && (className === "ProtectStatAbAttr" || stages < 0)
                  && (protectedStat == null || stat === protectedStat);
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
                }
                compared++;
              }
            }
          }
        }
      }
    }
    expect(compared).toBeGreaterThan(1000);
  });

  it("status immunity blocks: every user, every status including FAINT, cancelled or not", async () => {
    const { player, enemy } = await start(() => {}, SpeciesId.BLISSEY);
    const holder = player[0];
    let compared = 0;
    for (const className of ["StatusEffectImmunityAbAttr", "UserFieldStatusEffectImmunityAbAttr"]) {
      const sites = sitesOf(className);
      expect(sites.length, `${className} has users`).toBeGreaterThan(0);
      for (const site of sites) {
        const { original, rebuilt } = pair(site.abilityId, site.attrIndex, className);
        const list = (original as unknown as { immuneEffects: readonly StatusEffect[] }).immuneEffects;
        expect([...(rebuilt as unknown as { immuneEffects: readonly StatusEffect[] }).immuneEffects]).toEqual([
          ...list,
        ]);
        for (const effect of STATUSES) {
          for (const cancelledBefore of [false, true]) {
            const make = (): Params => ({
              pokemon: holder,
              effect,
              simulated: false,
              cancelled: new BooleanHolder(cancelledBefore),
              target: enemy[0],
              source: null,
            });
            const label = `${site.abilityName} #${site.attrIndex} status=${StatusEffect[effect]} cancelled=${cancelledBefore}`;
            const a = make();
            const b = make();
            // The own-immunity class: `!cancelled && (all-but-faint || listed)`. The partner class has the precedence
            // slip: `(!cancelled && all-but-faint) || listed` (see its notes).
            const own =
              !cancelledBefore && ((list.length === 0 && effect !== StatusEffect.FAINT) || list.includes(effect));
            const partner =
              (!cancelledBefore && list.length === 0 && effect !== StatusEffect.FAINT) || list.includes(effect);
            const expected = className === "StatusEffectImmunityAbAttr" ? own : partner;
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
            }
            compared++;
          }
        }
      }
    }
    expect(compared).toBeGreaterThan(300);
  });

  it("Mirror Armor: bounces a foe's drop with the exact phase, nothing without a source, simulated queues nothing", async () => {
    const { player, enemy } = await start(() => {}, SpeciesId.BLISSEY);
    const holder = player[0];
    const foe = enemy[0];
    const users = sitesOf("ReflectStatStageChangeAbAttr");
    expect(users.map(site => site.abilityName).sort()).toEqual(["Crystalline Armor", "In the Rough", "Mirror Armor"]);
    for (const site of users) {
      const { original, rebuilt } = pair(site.abilityId, site.attrIndex, "ReflectStatStageChangeAbAttr");
      for (const withSource of [true, false]) {
        for (const cancelledBefore of [false, true]) {
          for (const simulated of [false, true]) {
            const calls: unknown[][][] = [];
            for (const attr of [original, rebuilt]) {
              const spy = vi.spyOn(globalScene.phaseManager, "unshiftNew").mockImplementation(() => {});
              const params: Params = {
                pokemon: holder,
                stat: Stat.DEF,
                stages: -2,
                simulated,
                source: withSource ? foe : undefined,
                cancelled: new BooleanHolder(cancelledBefore),
              };
              const label = `${site.abilityName} source=${withSource} cancelled=${cancelledBefore} simulated=${simulated}`;
              const expected = withSource && !cancelledBefore;
              expect(attr.canApply(params), label).toBe(expected);
              if (expected) {
                attr.apply(params);
                expect(params.cancelled.value, label).toBe(true);
                expect(attr.getTriggerMessage(params, "Test Ability"), label).toContain("Test Ability");
              }
              calls.push([...spy.mock.calls]);
              spy.mockRestore();
            }
            expect(calls[1], `${site.abilityName}: queued phases`).toEqual(calls[0]);
            if (withSource && !cancelledBefore) {
              expect(calls[0]).toHaveLength(simulated ? 0 : 1);
              if (!simulated) {
                // phase name, target index, selfTarget, stats, stages, showMessage, ignoreAbilities (ER), ... , reflected
                expect(calls[0][0].slice(0, 6)).toEqual([
                  "StatStageChangePhase",
                  foe.getBattlerIndex(),
                  false,
                  [Stat.DEF],
                  -2,
                  true,
                ]);
              }
            }
          }
        }
      }
    }
  });

  it("Poison Puppeteer: three clauses, one 2-to-5 draw only when not simulated, same turns in original and rebuild", async () => {
    const { player, enemy } = await start(
      game => game.override.ability(AbilityId.BALL_FETCH).enemyAbility(AbilityId.BALL_FETCH),
      SpeciesId.BLISSEY,
    );
    const holder = player[0];
    const foe = enemy[0];
    const { original, rebuilt } = pair(POISON_PUPPETEER, 0, "ConfusionOnStatusEffectAbAttr");
    const effects = (original as unknown as { effects: ReadonlySet<StatusEffect> }).effects;
    expect([...effects].sort()).toEqual([StatusEffect.POISON, StatusEffect.TOXIC]);
    expect([...(rebuilt as unknown as { effects: ReadonlySet<StatusEffect> }).effects].sort()).toEqual([
      StatusEffect.POISON,
      StatusEffect.TOXIC,
    ]);

    const drive = (attr: AbAttr, effect: StatusEffect): boolean =>
      attr.canApply({ pokemon: holder, opponent: foe, effect, simulated: false } as Params);

    for (const effect of [StatusEffect.POISON, StatusEffect.TOXIC, StatusEffect.BURN, StatusEffect.PARALYSIS]) {
      const expected = effects.has(effect);
      expect(drive(original, effect), `healthy foe, ${StatusEffect[effect]}, original`).toBe(expected);
      expect(drive(rebuilt, effect), `healthy foe, ${StatusEffect[effect]}, rebuilt`).toBe(expected);
    }

    // Already confused: canAddTag(CONFUSED) is false.
    foe.addTag(BattlerTagType.CONFUSED, 3, MoveId.NONE, foe.id);
    expect(foe.getTag(BattlerTagType.CONFUSED)).toBeDefined();
    expect(drive(original, StatusEffect.POISON), "already confused, original").toBe(false);
    expect(drive(rebuilt, StatusEffect.POISON), "already confused, rebuilt").toBe(false);
    foe.removeTag(BattlerTagType.CONFUSED);

    // The draw and the tag, one attr after the other on a fresh foe each time.
    const turns: number[] = [];
    const draws: unknown[][][] = [];
    for (const attr of [original, rebuilt]) {
      const range = vi.spyOn(holder, "randBattleSeedIntRange").mockReturnValue(4);
      attr.apply({ pokemon: holder, opponent: foe, effect: StatusEffect.POISON, simulated: true } as Params);
      expect(foe.getTag(BattlerTagType.CONFUSED), "simulated apply adds nothing").toBeUndefined();
      expect(range, "simulated apply draws nothing").not.toHaveBeenCalled();
      attr.apply({ pokemon: holder, opponent: foe, effect: StatusEffect.POISON, simulated: false } as Params);
      const tag = foe.getTag(BattlerTagType.CONFUSED);
      expect(tag, "apply confuses the foe").toBeDefined();
      turns.push(tag!.turnCount);
      draws.push([...range.mock.calls]);
      range.mockRestore();
      foe.removeTag(BattlerTagType.CONFUSED);
    }
    expect(turns).toEqual([4, 4]);
    expect(draws[0]).toEqual([[2, 5]]);
    expect(draws[1]).toEqual([[2, 5]]);

    // A fainted foe: the guard clause.
    foe.hp = 0;
    expect(foe.isFainted()).toBe(true);
    expect(drive(original, StatusEffect.POISON), "fainted foe, original").toBe(false);
    expect(drive(rebuilt, StatusEffect.POISON), "fainted foe, rebuilt").toBe(false);
  });

  it("Neutralizing Gas: no gas does nothing, one source ends it, two sources leave one, simulated still counts down", async () => {
    const { game, player } = await start(() => {}, SpeciesId.BLISSEY);
    const holder = player[0];
    const arena = game.scene.arena;
    const params = (simulated = false): Params => ({ pokemon: holder, simulated });
    const results: string[][] = [];
    for (const [name, attr] of Object.entries(
      pair(AbilityId.NEUTRALIZING_GAS, 1, "PreLeaveFieldRemoveSuppressAbilitiesSourceAbAttr"),
    )) {
      const log: string[] = [];
      arena.removeTag(ArenaTagType.NEUTRALIZING_GAS);
      log.push(`no gas: canApply=${attr.canApply(params())}`);

      arena.addTag(ArenaTagType.NEUTRALIZING_GAS, 0, undefined, holder.id, ArenaTagSide.BOTH, true);
      log.push(`one source: canApply=${attr.canApply(params())}`);
      attr.apply(params());
      log.push(`one source after apply: gas=${arena.getTag(ArenaTagType.NEUTRALIZING_GAS) !== undefined}`);

      arena.addTag(ArenaTagType.NEUTRALIZING_GAS, 0, undefined, holder.id, ArenaTagSide.BOTH, true);
      arena.addTag(ArenaTagType.NEUTRALIZING_GAS, 0, undefined, holder.id, ArenaTagSide.BOTH, true);
      const tag = arena.getTag(ArenaTagType.NEUTRALIZING_GAS) as unknown as { sourceCount: number };
      log.push(`two sources: count=${tag.sourceCount}`);
      attr.apply(params(true));
      log.push(
        `two sources after a simulated apply: count=${(arena.getTag(ArenaTagType.NEUTRALIZING_GAS) as unknown as { sourceCount: number }).sourceCount}`,
      );
      arena.removeTag(ArenaTagType.NEUTRALIZING_GAS);
      results.push(log);
      expect(log, name).toContain("no gas: canApply=false");
    }
    expect(results[1]).toEqual(results[0]);
    expect(results[0]).toEqual([
      "no gas: canApply=false",
      "one source: canApply=true",
      "one source after apply: gas=false",
      "two sources: count=2",
      "two sources after a simulated apply: count=1",
    ]);
  });

  describe("real battles: the original ability against its rebuilt shadow", () => {
    interface Outcome {
      readonly stages: number[][];
      readonly statuses: (string | null)[];
      readonly foeStatus: string | null;
      readonly foeConfusion: number | null;
      readonly rng: number;
    }

    /** Runs `play` once for the ability itself and once for its rebuild under a shadow id; returns both outcomes. */
    async function twin(
      abilityId: number,
      play: (id: number) => Promise<Outcome>,
    ): Promise<{ original: Outcome; shadow: Outcome }> {
      const original = await play(abilityId);
      const shadowId = allocateShadowId();
      const rebuilt = rebuildAbility(liveAbility(abilityId), shadowId, { registry: declRegistry });
      registerShadow(shadowId, rebuilt.ability);
      const shadow = await play(shadowId);
      return { original, shadow };
    }

    function snapshot(player: Pokemon[], enemy: Pokemon[]): Outcome {
      return {
        stages: player.map(mon => STATS.map(stat => mon.getStatStage(stat))),
        statuses: player.map(mon =>
          mon.status === null || mon.status === undefined ? null : StatusEffect[mon.status.effect],
        ),
        foeStatus: enemy[0].status ? StatusEffect[enemy[0].status.effect] : null,
        foeConfusion: enemy[0].getTag(BattlerTagType.CONFUSED) === undefined ? null : 1,
        rng: 0,
      };
    }

    it("a holder that uses Superpower: Limber and Unburden block their own drops the same way as the rebuilt ability", async () => {
      for (const [abilityId, label] of [
        [AbilityId.LIMBER, "Limber (every stat)"],
        [84, "Unburden (Speed only)"],
      ] as const) {
        const { original, shadow } = await twin(abilityId, async id => {
          const world = await start(
            game =>
              game.override
                .ability(id as AbilityId)
                .moveset([MoveId.SUPERPOWER])
                .enemySpecies(SpeciesId.SNORLAX)
                .enemyLevel(100)
                .enemyMoveset(MoveId.SPLASH),
            SpeciesId.BLISSEY,
          );
          world.game.move.select(MoveId.SUPERPOWER);
          await world.game.toNextTurn();
          return snapshot(world.player, world.enemy);
        });
        expect(shadow, label).toEqual(original);
        if (abilityId === AbilityId.LIMBER) {
          // Superpower lowers Attack and Defense; Limber blocks both. The control below proves the move does drop them.
          expect(original.stages[0].slice(0, 2), label).toEqual([0, 0]);
        }
      }
      const control = await start(
        game =>
          game.override
            .moveset([MoveId.SUPERPOWER])
            .enemySpecies(SpeciesId.SNORLAX)
            .enemyLevel(100)
            .enemyMoveset(MoveId.SPLASH),
        SpeciesId.BLISSEY,
      );
      control.game.move.select(MoveId.SUPERPOWER);
      await control.game.toNextTurn();
      expect(control.player[0].getStatStage(Stat.ATK), "without the ability Superpower drops Attack").toBe(-1);
    });

    it("Evaporate in doubles: Mist protects both of us from our own drops, no Mist means the drops land", async () => {
      for (const mist of [true, false]) {
        const { original, shadow } = await twin(EVAPORATE, async id => {
          const world = await start(
            game =>
              game.override
                .startingWave(2)
                .ability(id as AbilityId)
                .moveset([MoveId.SUPERPOWER, MoveId.SPLASH])
                .enemySpecies(SpeciesId.SNORLAX)
                .enemyLevel(100)
                .enemyMoveset(MoveId.SPLASH),
            SpeciesId.BLISSEY,
            SpeciesId.CHANSEY,
          );
          if (mist) {
            world.game.scene.arena.addTag(
              ArenaTagType.MIST,
              5,
              undefined,
              world.player[0].id,
              ArenaTagSide.PLAYER,
              true,
            );
          }
          world.game.move.select(MoveId.SUPERPOWER, 0, BattlerIndex.ENEMY);
          world.game.move.select(MoveId.SUPERPOWER, 1, BattlerIndex.ENEMY_2);
          await world.game.toNextTurn();
          return snapshot(world.player, world.enemy);
        });
        expect(shadow, `mist=${mist}`).toEqual(original);
        expect(original.stages[0][0], `mist=${mist}: partner 1 Attack`).toBe(mist ? 0 : -1);
        expect(original.stages[1][0], `mist=${mist}: partner 2 Attack`).toBe(mist ? 0 : -1);
      }
    });

    it("Sweet Veil in doubles: my partner cannot fall asleep, the same in original and rebuild", async () => {
      const { original, shadow } = await twin(175, async id => {
        const world = await start(
          game =>
            game.override
              .startingWave(2)
              .ability(id as AbilityId)
              .enemyMoveset(MoveId.SPORE)
              .enemyLevel(50),
          SpeciesId.BLISSEY,
          SpeciesId.CHANSEY,
        );
        world.game.move.select(MoveId.SPLASH, 0);
        world.game.move.select(MoveId.SPLASH, 1);
        await world.game.toNextTurn();
        return snapshot(world.player, world.enemy);
      });
      expect(shadow).toEqual(original);
      expect(original.statuses, "Spore never lands on a Sweet Veil side").toEqual([null, null]);
      const control = await start(
        game => game.override.startingWave(2).enemyMoveset(MoveId.SPORE).enemyLevel(50),
        SpeciesId.BLISSEY,
        SpeciesId.CHANSEY,
      );
      control.game.move.select(MoveId.SPLASH, 0);
      control.game.move.select(MoveId.SPLASH, 1);
      await control.game.toNextTurn();
      expect(
        control.player.some(mon => mon.status?.effect === StatusEffect.SLEEP),
        "without Sweet Veil Spore puts someone to sleep",
      ).toBe(true);
    });

    it("Poison Puppeteer: poisoning a foe also confuses it, the same in original and rebuild", async () => {
      // Toxic has 90% accuracy; a miss would leave the trigger unreached, so it never misses for this test.
      const toxic = allMoves[MoveId.TOXIC];
      const accuracy = toxic.accuracy;
      toxic.accuracy = -1;
      const { original, shadow } = await twin(POISON_PUPPETEER, async id => {
        const world = await start(
          game =>
            game.override
              .ability(id as AbilityId)
              .moveset([MoveId.TOXIC])
              .enemySpecies(SpeciesId.SNORLAX)
              .enemyLevel(100)
              .enemyMoveset(MoveId.SPLASH),
          SpeciesId.BLISSEY,
        );
        world.game.move.select(MoveId.TOXIC);
        await world.game.toNextTurn();
        return snapshot(world.player, world.enemy);
      });
      toxic.accuracy = accuracy;
      expect(original.foeStatus, "Toxic landed").toBe("TOXIC");
      expect(original.foeConfusion, "and the foe is confused").not.toBeNull();
      expect(shadow).toEqual(original);
    });
  });
});

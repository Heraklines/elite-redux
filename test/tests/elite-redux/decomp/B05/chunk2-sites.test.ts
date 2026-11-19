/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B05 chunk 2: what the shared L1 grid and L2 twin cannot see for the crit, block and priority classes.
//   - the L1 grid changes only the HOLDER (status, HP, types); the foe-side facts of Merciless, Depravity and Relentless
//     (status, bleeding, Speed stage) and the turn counter of the first-turn crit abilities are never varied there;
//   - the L2 crit-multiplier template makes the FOE crit the holder, but MultCritAbAttr is asked for the ATTACKER;
//   - no L2 template makes a one-hit KO move reach the holder.
// Every check compares the ORIGINAL attr of each user with its REBUILD (what a staff blueprint compiles to), and each
// "true" side is asserted to occur at least once so that an all-false comparison cannot pass.
import type { AbAttr } from "#abilities/ab-attrs";
import type { Ability } from "#abilities/ability";
import { allAbilities, allMoves } from "#data/data-lists";
import { recomposeAttr } from "#data/elite-redux/ability-studio/build-attr";
import { declRegistry } from "#data/elite-redux/ability-studio/decl-registry";
import { AbilityId } from "#enums/ability-id";
import { BattlerTagType } from "#enums/battler-tag-type";
import { MoveId } from "#enums/move-id";
import { PokemonType } from "#enums/pokemon-type";
import { SpeciesId } from "#enums/species-id";
import { Stat } from "#enums/stat";
import { StatusEffect } from "#enums/status-effect";
import { OneHitKOAttr } from "#moves/move";
import type { GameManager } from "#test/framework/game-manager";
import { freshGame, startWorld } from "#test/tests/elite-redux/decomp/harness/game";
import { rebuildAbility, registerShadow, unregisterShadows } from "#test/tests/elite-redux/decomp/harness/rebuild";
import { type ScenarioSpec, use } from "#test/tests/elite-redux/decomp/harness/scenarios";
import { allocateShadowId, type TwinScenario, twinById } from "#test/tests/elite-redux/decomp/harness/twin";
import { setStatusOf, setTypesOf } from "#test/tests/elite-redux/decomp/harness/world";
import { BooleanHolder, NumberHolder } from "#utils/common";
import Phaser from "phaser";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

const BALL_FETCH = AbilityId.BALL_FETCH as number;

const SNIPER = 97;
const SUPER_LUCK = 105;
const STURDY = 5;
const MAGIC_GUARD = 98;

/** [ability id, attr index, name] of the ConditionalCritAbAttr users that have a library form. */
const CRIT_USERS: readonly (readonly [number, number, string])[] = [
  [196, 0, "Merciless"],
  [5419, 0, "Depravity"],
  [5473, 1, "Relentless"],
  [5171, 0, "Ambush"],
  [5270, 0, "Showdown Mode"],
  [5482, 0, "Hunter's Mark"],
  [20002, 0, "Ultra Recon Hunter"],
  [5230, 1, "Heaven Asunder"],
  [5078, 1, "Fatal Precision (1)"],
  [5078, 3, "Fatal Precision (3)"],
  [5388, 2, "Final Blow"],
  [5622, 2, "Flawless Precision"],
  [20008, 8, "Heartless Style (8)"],
  [20008, 10, "Heartless Style (10)"],
];

/** The ChangeMovePriority users that have a library form: [id, attr index, name, class]. */
const PRIORITY_USERS: readonly (readonly [number, number, string])[] = [
  [158, 0, "Prankster"],
  [177, 0, "Gale Wings"],
  [205, 0, "Triage"],
  [6083, 4, "Monk"],
  [298, 0, "Mycelium Might"],
];

const STATUS_USERS: readonly (readonly [number, number, string])[] = [
  [63, 1, "Marvel Scale"],
  [90, 1, "Poison Heal"],
  [137, 1, "Toxic Boost"],
  [138, 1, "Flare Boost"],
  [5943, 2, "Rainbow Fish"],
  [6051, 2, "Decay"],
];

const ALL_STATUSES = [
  StatusEffect.NONE,
  StatusEffect.POISON,
  StatusEffect.TOXIC,
  StatusEffect.PARALYSIS,
  StatusEffect.SLEEP,
  StatusEffect.FREEZE,
  StatusEffect.BURN,
];

describe("B05 chunk 2: crit, block and priority classes", () => {
  let phaserGame: Phaser.Game;
  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });
  afterEach(unregisterShadows);

  const rebuilt = (className: string, id: number, index: number): AbAttr => {
    const module = declRegistry.get(className);
    expect(module, `${className} is declared`).toBeDefined();
    const original = allAbilities[id]?.attrs[index] as AbAttr;
    expect(original?.constructor.name, `ability ${id} attr ${index}`).toBe(className);
    return recomposeAttr(module!, original, id, index);
  };

  it("ConditionalCritAbAttr: every library form answers like its closure for foe status, bleeding, Speed stage, turn count, move and type", async () => {
    const { holder, foe } = await startWorld(phaserGame);
    const moves = [MoveId.TACKLE, MoveId.SPACIAL_REND, MoveId.EARTHQUAKE, MoveId.SURF, MoveId.EMBER, MoveId.SPLASH];
    const foeTypes = [
      [PokemonType.NORMAL],
      [PokemonType.GRASS],
      [PokemonType.WATER],
      [PokemonType.GHOST],
      [PokemonType.FIRE, PokemonType.FLYING],
    ];
    const trueSeen = new Map<string, number>();
    let compared = 0;
    for (const [id, index, name] of CRIT_USERS) {
      const original = allAbilities[id].attrs[index] as AbAttr;
      const rebuiltAttr = rebuilt("ConditionalCritAbAttr", id, index);
      for (const status of ALL_STATUSES) {
        setStatusOf(foe, status);
        for (const bleeding of [false, true]) {
          if (bleeding) {
            foe.addTag(BattlerTagType.ER_BLEED, 3, MoveId.NONE, holder.id);
          } else {
            foe.removeTag(BattlerTagType.ER_BLEED);
          }
          for (const stage of [-2, -1, 0, 1]) {
            foe.setStatStage(Stat.SPD, stage);
            for (const turns of [0, 1, 2]) {
              holder.tempSummonData.waveTurnCount = turns;
              for (const types of foeTypes) {
                setTypesOf(foe, types);
                for (const moveId of moves) {
                  for (const alreadyCrit of [false, true]) {
                    const make = () => ({
                      pokemon: holder,
                      target: foe,
                      move: allMoves[moveId],
                      isCritical: new BooleanHolder(alreadyCrit),
                    });
                    const a = make();
                    const b = make();
                    const can = original.canApply(a as never);
                    const label = `${name} status ${StatusEffect[status]} bleeding ${bleeding} stage ${stage} turn ${turns} ${types.join("/")} ${MoveId[moveId]} crit ${alreadyCrit}`;
                    expect(rebuiltAttr.canApply(b as never), label).toBe(can);
                    if (can) {
                      original.apply(a as never);
                      rebuiltAttr.apply(b as never);
                      expect(b.isCritical.value, label).toBe(a.isCritical.value);
                      trueSeen.set(name, (trueSeen.get(name) ?? 0) + 1);
                    }
                    compared++;
                  }
                }
              }
            }
          }
        }
      }
    }
    foe.removeTag(BattlerTagType.ER_BLEED);
    foe.setStatStage(Stat.SPD, 0);
    for (const [, , name] of CRIT_USERS) {
      expect(trueSeen.get(name) ?? 0, `${name}: the TRUE side must occur at least once`).toBeGreaterThan(0);
    }
    expect(compared).toBeGreaterThan(10000);
  }, 600000);

  it("ChangeMovePriority(InBracket): every gate answers like its closure and leaves the same priority, over moves and HP", async () => {
    const { holder, foe } = await startWorld(phaserGame);
    const moves = [
      MoveId.TACKLE,
      MoveId.EMBER,
      MoveId.SPLASH,
      MoveId.SWORDS_DANCE,
      MoveId.WILL_O_WISP,
      MoveId.ROOST,
      MoveId.DRAIN_PUNCH,
      MoveId.GIGA_DRAIN,
      MoveId.FOCUS_PUNCH,
      MoveId.WING_ATTACK,
      MoveId.AIR_SLASH,
      MoveId.ACROBATICS,
      MoveId.QUICK_ATTACK,
      MoveId.SPACIAL_REND,
    ];
    const trueSeen = new Map<string, number>();
    for (const [id, index, name] of PRIORITY_USERS) {
      const className = (allAbilities[id].attrs[index] as AbAttr).constructor.name;
      const original = allAbilities[id].attrs[index] as AbAttr;
      const rebuiltAttr = rebuilt(className, id, index);
      for (const hp of [holder.getMaxHp(), holder.getMaxHp() - 1, Math.floor(holder.getMaxHp() / 2), 1]) {
        holder.hp = hp;
        for (const moveId of moves) {
          const make = () => ({
            pokemon: holder,
            move: allMoves[moveId],
            priority: new NumberHolder(allMoves[moveId].priority),
            simulated: false,
          });
          const a = make();
          const b = make();
          const can = original.canApply(a as never);
          const label = `${name} hp ${hp} ${MoveId[moveId]}`;
          expect(rebuiltAttr.canApply(b as never), label).toBe(can);
          if (can) {
            original.apply(a as never);
            rebuiltAttr.apply(b as never);
            expect(b.priority.value, label).toBe(a.priority.value);
            trueSeen.set(name, (trueSeen.get(name) ?? 0) + 1);
          }
        }
      }
    }
    holder.hp = holder.getMaxHp();
    void foe;
    for (const [, , name] of PRIORITY_USERS) {
      expect(trueSeen.get(name) ?? 0, `${name}: the TRUE side must occur at least once`).toBeGreaterThan(0);
    }
  }, 300000);

  it("ChangeMovePriority: the two legacy gates (Opportunist, Penta-Punch) stay the original closure and are not rebuilt", () => {
    for (const [id, index] of [
      [290, 0],
      [6015, 2],
    ] as const) {
      expect(() => rebuilt("ChangeMovePriorityAbAttr", id, index)).toThrow(/no library binding/);
    }
  });

  it("BlockStatusDamageAbAttr: every gate answers like the class for every status of the holder, blocked or not yet", async () => {
    const { holder } = await startWorld(phaserGame);
    const trueSeen = new Map<string, number>();
    for (const [id, index, name] of STATUS_USERS) {
      const original = allAbilities[id].attrs[index] as AbAttr;
      const rebuiltAttr = rebuilt("BlockStatusDamageAbAttr", id, index);
      for (const status of ALL_STATUSES) {
        setStatusOf(holder, status);
        for (const already of [false, true]) {
          const a = { pokemon: holder, cancelled: new BooleanHolder(already) };
          const b = { pokemon: holder, cancelled: new BooleanHolder(already) };
          const can = original.canApply(a as never);
          const label = `${name} status ${StatusEffect[status]} already blocked ${already}`;
          expect(rebuiltAttr.canApply(b as never), label).toBe(can);
          if (can) {
            original.apply(a as never);
            rebuiltAttr.apply(b as never);
            expect(b.cancelled.value, label).toBe(true);
            trueSeen.set(name, (trueSeen.get(name) ?? 0) + 1);
          }
        }
      }
    }
    setStatusOf(holder, StatusEffect.NONE);
    for (const [, , name] of STATUS_USERS) {
      expect(trueSeen.get(name) ?? 0, `${name}: the TRUE side must occur at least once`).toBeGreaterThan(0);
    }
  });

  it("BlockNonDirectDamageAbAttr and BlockOneHitKOAbAttr: the cancel is set once and never twice", async () => {
    const { holder } = await startWorld(phaserGame);
    const pairs: readonly (readonly [string, number, number])[] = [
      ["BlockNonDirectDamageAbAttr", MAGIC_GUARD, 0],
      ["BlockOneHitKOAbAttr", STURDY, 1],
    ];
    for (const [className, id, index] of pairs) {
      const original = allAbilities[id].attrs[index] as AbAttr;
      const rebuiltAttr = rebuilt(className, id, index);
      expect(rebuiltAttr.showAbility, `${className} keeps showAbility`).toBe(original.showAbility);
      for (const already of [false, true]) {
        const a = { pokemon: holder, cancelled: new BooleanHolder(already) };
        const b = { pokemon: holder, cancelled: new BooleanHolder(already) };
        expect(rebuiltAttr.canApply(b as never), `${className} already ${already}`).toBe(original.canApply(a as never));
        if (original.canApply(a as never)) {
          original.apply(a as never);
          rebuiltAttr.apply(b as never);
        }
        expect(b.cancelled.value).toBe(a.cancelled.value);
      }
    }
  });

  it("BonusCritAbAttr: the critical hit stage of the holder's move is one higher (Super Luck), original and rebuilt", async () => {
    const stageOf = async (abilityId: number): Promise<number> => {
      const game = freshGame(phaserGame);
      game.override
        .battleStyle("single")
        .moveset([MoveId.TACKLE])
        .ability(abilityId as AbilityId)
        .startingLevel(100)
        .enemySpecies(SpeciesId.MAGIKARP)
        .enemyLevel(30)
        .enemyAbility(AbilityId.BALL_FETCH)
        .enemyMoveset(MoveId.SPLASH)
        .criticalHits(false)
        .hasPassiveAbility(false)
        .enemyHasPassiveAbility(false);
      await game.classicMode.startBattle(SpeciesId.BLISSEY);
      return game.field.getEnemyPokemon().getCritStage(game.field.getPlayerPokemon(), allMoves[MoveId.TACKLE]);
    };
    const original = await stageOf(SUPER_LUCK);
    const shadow = shadowOf(SUPER_LUCK, [0]);
    const control = await stageOf(BALL_FETCH);
    expect(await stageOf(shadow)).toBe(original);
    expect(original).toBe(control + 1);
  });

  it("MultCritAbAttr: a critical hit does 1.5 times more (Sniper, Super Sniper, Fourth Degree, Kagutsuchi), a plain hit is untouched", async () => {
    const { holder } = await startWorld(phaserGame);
    for (const [id, index, name] of [
      [SNIPER, 0, "Sniper"],
      [5507, 0, "Super Sniper"],
      [6107, 0, "Fourth Degree"],
      [6109, 2, "Kagutsuchi"],
    ] as const) {
      const original = allAbilities[id].attrs[index] as AbAttr;
      const rebuiltAttr = rebuilt("MultCritAbAttr", id, index);
      for (const start of [0.5, 1, 1.5, 2]) {
        const a = { pokemon: holder, critMult: new NumberHolder(start), simulated: false };
        const b = { pokemon: holder, critMult: new NumberHolder(start), simulated: false };
        const can = original.canApply(a as never);
        expect(rebuiltAttr.canApply(b as never), `${name} from ${start}`).toBe(can);
        expect(can, `${name} from ${start}: only a critical hit (more than 1) is multiplied`).toBe(start > 1);
        if (can) {
          original.apply(a as never);
          rebuiltAttr.apply(b as never);
          expect(b.critMult.value, `${name} from ${start}`).toBe(a.critMult.value);
          expect(a.critMult.value).toBe(start * 1.5);
        }
      }
    }
  });

  // ---- whole battles ---------------------------------------------------------------------------------------------

  function shadowOf(abilityId: number, expectedRebuilt: number[]): number {
    const original = allAbilities[abilityId] as Ability;
    const shadowId = allocateShadowId();
    const result = rebuildAbility(original, shadowId, { registry: declRegistry });
    for (const index of expectedRebuilt) {
      expect(result.rebuilt, `${original.name} attr ${index} must be rebuilt`).toContain(index);
    }
    registerShadow(shadowId, result.ability);
    return shadowId;
  }

  const BASE = {
    holder: SpeciesId.BLISSEY,
    party: [] as SpeciesId[],
    foe: SpeciesId.SNORLAX,
    foeLevel: 100,
    foeAbility: AbilityId.BALL_FETCH,
    holderMoves: [MoveId.CELEBRATE, MoveId.TACKLE],
    foeMoves: [MoveId.SPLASH],
  } as const;

  async function threeBattles(
    abilityId: number,
    rebuiltIndex: number,
    className: string,
    template: ScenarioSpec,
  ): Promise<{ rebuiltDiffs: string[]; controlDiffs: string[] }> {
    const shadow = shadowOf(abilityId, [rebuiltIndex]);
    const scenario: TwinScenario = { template, axes: {}, label: template.label };
    // The original must have evaluated the attr under test, otherwise two empty traces would be compared.
    const reach = { attrs: [{ attrIndex: rebuiltIndex, className }] } as const;
    const rebuiltRun = await twinById(phaserGame, abilityId, shadow, scenario, { reach });
    const controlRun = await twinById(phaserGame, abilityId, BALL_FETCH, scenario, {
      reach: { attrs: [], presenceOnly: true },
    });
    return {
      rebuiltDiffs: rebuiltRun.differences.map(d => d.message),
      controlDiffs: controlRun.differences.map(d => d.message),
    };
  }

  it("MultCritAbAttr: whole battle, the holder lands critical hits on a Snorlax (Sniper)", async () => {
    const template: ScenarioSpec = {
      ...BASE,
      id: "b05-holder-crits-foe",
      label: "The holder lands critical Tackles on the enemy",
      crits: true,
      turns: [use(MoveId.TACKLE), use(MoveId.TACKLE)],
    };
    const result = await threeBattles(SNIPER, 0, "MultCritAbAttr", template);
    expect(result.rebuiltDiffs).toEqual([]);
    expect(result.controlDiffs.length, "the control must differ (the critical hit is 1.5 times stronger)").toBeGreaterThan(
      0,
    );
  });

  it("BlockNonDirectDamageAbAttr: whole battle, a poisoned holder takes no poison damage (Magic Guard)", async () => {
    const template: ScenarioSpec = {
      ...BASE,
      id: "b05-poisoned-holder",
      label: "A poisoned holder sits through three turns",
      foe: SpeciesId.MAGIKARP,
      foeLevel: 30,
      foeMoves: [MoveId.SPLASH],
      holderMoves: [MoveId.CELEBRATE],
      turns: [use(MoveId.CELEBRATE), use(MoveId.CELEBRATE), use(MoveId.CELEBRATE)],
      setup: ({ holder }) => {
        setStatusOf(holder, StatusEffect.POISON);
      },
    };
    const result = await threeBattles(MAGIC_GUARD, 0, "BlockNonDirectDamageAbAttr", template);
    expect(result.rebuiltDiffs).toEqual([]);
    expect(result.controlDiffs.length, "the control must differ (poison damage without Magic Guard)").toBeGreaterThan(0);
  });

  it("BlockStatusDamageAbAttr: whole battle, a poisoned holder takes no poison damage (Poison Heal), a burned one with Flare Boost neither", async () => {
    for (const [id, status, name] of [
      [90, StatusEffect.POISON, "Poison Heal"],
      [138, StatusEffect.BURN, "Flare Boost"],
    ] as const) {
      const template: ScenarioSpec = {
        ...BASE,
        id: `b05-status-${name}`,
        label: `${name} holder with its status sits through three turns`,
        foe: SpeciesId.MAGIKARP,
        foeLevel: 30,
        foeMoves: [MoveId.SPLASH],
        holderMoves: [MoveId.CELEBRATE],
        turns: [use(MoveId.CELEBRATE), use(MoveId.CELEBRATE), use(MoveId.CELEBRATE)],
        setup: ({ holder }) => {
          holder.hp = Math.floor(holder.getMaxHp() / 2);
          setStatusOf(holder, status);
        },
      };
      const result = await threeBattles(id, 1, "BlockStatusDamageAbAttr", template);
      expect(result.rebuiltDiffs, name).toEqual([]);
      expect(result.controlDiffs.length, `${name}: the control must differ`).toBeGreaterThan(0);
    }
  });

  // ---- the engine site of one-hit KO moves -----------------------------------------------------------------------

  it("BlockOneHitKOAbAttr: the one-hit KO condition fails against the holder (Sturdy), original and rebuilt", async () => {
    const site = async (abilityId: number): Promise<boolean> => {
      const game: GameManager = freshGame(phaserGame);
      game.override
        .battleStyle("single")
        .moveset([MoveId.SPLASH])
        .ability(abilityId as AbilityId)
        .startingLevel(50)
        .enemySpecies(SpeciesId.MAGIKARP)
        .enemyLevel(50)
        .enemyAbility(AbilityId.BALL_FETCH)
        .enemyMoveset(MoveId.SPLASH)
        .criticalHits(false)
        .hasPassiveAbility(false)
        .enemyHasPassiveAbility(false);
      await game.classicMode.startBattle(SpeciesId.BLISSEY);
      const holder = game.field.getPlayerPokemon();
      const foe = game.field.getEnemyPokemon();
      // Fissure no longer has OneHitKOAttr in Elite Redux (the move patches strip it), so a fresh attr is used.
      const move = allMoves[MoveId.FISSURE];
      const attr = new OneHitKOAttr();
      // OneHitKOAttr.getCondition(): the ability check, then "the user is at least the target's level".
      return attr.getCondition()(foe, holder, move);
    };
    const original = await site(STURDY);
    const shadow = shadowOf(STURDY, [1]);
    expect(original, "Sturdy blocks it").toBe(false);
    expect(await site(shadow)).toBe(original);
    expect(await site(BALL_FETCH), "without the flag the same Fissure works").toBe(true);
  });
});

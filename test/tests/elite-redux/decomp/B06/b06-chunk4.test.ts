/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B06 chunk 4: what the shared L1 and L2 suites cannot see. Every test runs the ORIGINAL ability of a real user and its REBUILD (the ability
// rebuilt from its own declarations, registered under a shadow id) through a real battle or a real attr call, side by side.
// Classes: PostFaintHPDamageAbAttr (the shared faint scenario stops before the faint-time abilities are asked), RedirectTypeMoveAbAttr (all
// nine users with a move of their own type), BlockRedirectAbAttr (a presence flag read by the move phase), ReduceStatusEffectDurationAbAttr
// (the sleep counter) and FlinchStatStageChangeAbAttr (the flinch moment is not in any shared scenario).
import type { FlinchStatStageChangeAbAttr, ReduceStatusEffectDurationAbAttr } from "#abilities/ab-attrs";
import { globalScene } from "#app/global-scene";
import { recomposeAttr } from "#data/elite-redux/ability-studio/build-attr";
import { declRegistry } from "#data/elite-redux/ability-studio/decl-registry";
import { Status } from "#data/status-effect";
import { AbilityId } from "#enums/ability-id";
import { BattlerIndex } from "#enums/battler-index";
import { BattlerTagType } from "#enums/battler-tag-type";
import { MoveId } from "#enums/move-id";
import { MoveResult } from "#enums/move-result";
import { SpeciesId } from "#enums/species-id";
import { Stat } from "#enums/stat";
import { StatusEffect } from "#enums/status-effect";
import { freshGame, startWorld } from "#test/tests/elite-redux/decomp/harness/game";
import { rebuildAbility, registerShadow, unregisterShadows } from "#test/tests/elite-redux/decomp/harness/rebuild";
import { allocateShadowId, liveAbility } from "#test/tests/elite-redux/decomp/harness/twin";
import { NumberHolder } from "#utils/common";
import Phaser from "phaser";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

let phaserGame: Phaser.Game;
beforeAll(() => {
  phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
});
afterEach(() => {
  unregisterShadows();
  vi.restoreAllMocks();
});

function moduleOf(name: string) {
  const module = declRegistry.get(name);
  expect(module, `${name} must be declared`).toBeDefined();
  return module!;
}

/** The ability rebuilt from its own declarations (and any moved settings), registered under a shadow id. */
function shadowOf(
  abilityId: number,
  overrides?: Record<number, { params?: Record<string, string | number | boolean> }>,
): number {
  const shadowId = allocateShadowId();
  const rebuilt = rebuildAbility(liveAbility(abilityId), shadowId, {
    registry: declRegistry,
    ...(overrides === undefined ? {} : { overrides }),
  });
  const MINE = new Set([
    "PostFaintHPDamageAbAttr",
    "RedirectTypeMoveAbAttr",
    "BlockRedirectAbAttr",
    "ReduceStatusEffectDurationAbAttr",
    "FlinchStatStageChangeAbAttr",
  ]);
  expect(
    rebuilt.carried.filter(entry => MINE.has(entry.className)),
    `${abilityId} must rebuild every chunk 4 attr`,
  ).toEqual([]);
  registerShadow(shadowId, rebuilt.ability);
  return shadowId;
}

/** Both forms of a user: the original ability id and its rebuild. */
function forms(abilityId: number): [label: string, id: number][] {
  return [
    ["original", abilityId],
    ["rebuilt", shadowOf(abilityId)],
  ];
}

describe("PostFaintHPDamageAbAttr (Innards Out)", () => {
  async function knockOut(enemyAbility: number, playerAbility = AbilityId.BALL_FETCH) {
    const game = freshGame(phaserGame);
    game.override
      .ability(playerAbility)
      .battleStyle("single")
      .criticalHits(false)
      .enemySpecies(SpeciesId.MAGIKARP)
      .enemyAbility(enemyAbility as AbilityId)
      .enemyMoveset(MoveId.SPLASH)
      .startingLevel(100);
    await game.classicMode.startBattle(SpeciesId.FEEBAS);
    const magikarp = game.field.getEnemyPokemon();
    magikarp.hp = 20;
    game.move.use(MoveId.X_SCISSOR);
    await game.toEndOfTurn();
    return { magikarp, feebas: game.field.getPlayerPokemon() };
  }

  it("hurts the one who knocked the holder out by the damage of that hit, for the original and the rebuild", async () => {
    for (const [label, id] of forms(215)) {
      const { magikarp, feebas } = await knockOut(id);
      expect(magikarp.isFainted(), label).toBe(true);
      expect(feebas.getInverseHp(), `${label} damage`).toBe(20);
    }
  }, 600000);

  it("does nothing to a killer with Magic Guard, for the original and the rebuild", async () => {
    for (const [label, id] of forms(215)) {
      const { magikarp, feebas } = await knockOut(id, AbilityId.MAGIC_GUARD);
      expect(magikarp.isFainted(), label).toBe(true);
      expect(feebas.getInverseHp(), `${label} damage`).toBe(0);
    }
  }, 600000);

  it("does not hurt a teammate that knocks the holder out in a double battle, for the original and the rebuild", async () => {
    for (const [label, id] of forms(215)) {
      const game = freshGame(phaserGame);
      game.override
        .ability(AbilityId.BALL_FETCH)
        .battleStyle("double")
        // The first wave is never a double battle, whatever the override says.
        .startingWave(2)
        .criticalHits(false)
        .enemySpecies(SpeciesId.MAGIKARP)
        .enemyAbility(id as AbilityId)
        .enemyMoveset(MoveId.SPLASH)
        .startingLevel(100);
      await game.classicMode.startBattle(SpeciesId.FEEBAS);
      const [magikarp1, magikarp2] = game.scene.getEnemyField();
      magikarp1.hp = 1;
      game.move.use(MoveId.PROTECT);
      await game.move.forceEnemyMove(MoveId.SPLASH);
      await game.move.forceEnemyMove(MoveId.SURF);
      await game.toEndOfTurn();
      expect(magikarp1.isFainted(), label).toBe(true);
      expect(magikarp2.getInverseHp(), `${label} teammate`).toBe(0);
    }
  }, 600000);

  it("does nothing in a simulated call, with no move and with no attacker, for the original and the rebuild", async () => {
    const { holder, foe } = await startWorld(phaserGame);
    const damage = vi.spyOn(foe, "damageAndUpdate").mockImplementation((() => 0) as never);
    holder.turnData.attacksReceived = [{ move: MoveId.TACKLE, damage: 37, sourceId: foe.id }] as never;
    for (const [label, id] of forms(215)) {
      const attr = liveAbility(id).attrs[0] as unknown as {
        apply(params: unknown): void;
        canApply(params: unknown): boolean;
      };
      expect(attr.constructor.name, label).toBe("PostFaintHPDamageAbAttr");
      const move = { id: MoveId.TACKLE } as never;
      expect(attr.canApply({ pokemon: holder, attacker: foe, move })).toBe(true);
      for (const params of [
        { pokemon: holder, attacker: foe, move, simulated: true },
        { pokemon: holder, attacker: foe },
        { pokemon: holder, move },
      ]) {
        damage.mockClear();
        attr.apply(params);
        expect(damage, `${label} ${JSON.stringify(Object.keys(params))}`).not.toHaveBeenCalled();
      }
      damage.mockClear();
      attr.apply({ pokemon: holder, attacker: foe, move });
      expect(damage, label).toHaveBeenCalledTimes(1);
      expect(damage.mock.calls[0][0], `${label} amount`).toBe(37);
    }
  }, 600000);
});

describe("RedirectTypeMoveAbAttr (nine users)", () => {
  /** [abilityId, a move of its type that aims at one target]. */
  const USERS: readonly (readonly [abilityId: number, name: string, move: MoveId])[] = [
    [31, "Lightning Rod", MoveId.SHOCK_WAVE],
    [114, "Storm Drain", MoveId.WATER_GUN],
    [5082, "Poison Absorb", MoveId.SLUDGE_BOMB],
    [5116, "Ice Dew", MoveId.ICE_BEAM],
    [5450, "Reservoir", MoveId.WATER_GUN],
    [5566, "Heat Sink", MoveId.EMBER],
    [5925, "Capacitor Bank", MoveId.SHOCK_WAVE],
    [5965, "Alluring Skull", MoveId.SHADOW_BALL],
    [6071, "Low Tide", MoveId.WATER_GUN],
  ];

  /**
   * Both of the player's Pokemon (a fast Feebas and a very slow Shuckle) carry `abilityId` (the test environment cannot give just one of them an ability), the enemy Magikarp uses
   * `move` on the first of them. The game asks every Pokemon in speed order and the LAST redirector wins. In this fork Splash is a Water-type move that aims at one other Pokemon, so the filler move is Celebrate. True means the redirect engaged: the attr of the Shuckle applied for a move aimed at the Feebas (a second foe may also use the move, which makes the Feebas redirect back, so the calls are not asserted one by one).
   */
  async function drawnIn(abilityId: number, move: MoveId): Promise<boolean> {
    const game = freshGame(phaserGame);
    game.override
      .moveset([MoveId.CELEBRATE])
      .ability(abilityId as AbilityId)
      .battleStyle("double")
      // The first wave is never a double battle, whatever the override says.
      .startingWave(2)
      .criticalHits(false)
      .startingLevel(100)
      .enemySpecies(SpeciesId.MAGIKARP)
      .enemyLevel(30)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemyMoveset(MoveId.CELEBRATE);
    await game.classicMode.startBattle(SpeciesId.FEEBAS, SpeciesId.SHUCKLE);
    const second = game.scene.getPlayerField()[1];
    const attr = liveAbility(abilityId).attrs.find(a => a.constructor.name === "RedirectTypeMoveAbAttr")!;
    const apply = vi.spyOn(attr, "apply");
    game.move.select(MoveId.CELEBRATE, BattlerIndex.PLAYER);
    game.move.select(MoveId.CELEBRATE, BattlerIndex.PLAYER_2);
    await game.move.forceEnemyMove(move, BattlerIndex.PLAYER);
    await game.move.forceEnemyMove(MoveId.CELEBRATE);
    await game.phaseInterceptor.to("BerryPhase");
    const callers = apply.mock.calls.map(([params]) => (params as { pokemon: unknown }).pokemon);
    return callers.includes(second);
  }

  it("every user draws a single-target move of its own type to the holder, for the original and the rebuild", async () => {
    for (const [abilityId, name, move] of USERS) {
      for (const [label, id] of forms(abilityId)) {
        expect(await drawnIn(id, move), `${name} ${label}`).toBe(true);
      }
    }
  }, 600000);

  it("does not draw a move of another type, for the original and the rebuild", async () => {
    for (const [label, id] of forms(31)) {
      expect(await drawnIn(id, MoveId.AERIAL_ACE), `Lightning Rod ${label}`).toBe(false);
    }
  }, 600000);

  it("a moved type setting moves the redirect with it", async () => {
    const asGhost = shadowOf(31, { 0: { params: { type: "GHOST" } } });
    expect(await drawnIn(asGhost, MoveId.SHOCK_WAVE), "Electric is no longer drawn").toBe(false);
    expect(await drawnIn(asGhost, MoveId.SHADOW_BALL), "Ghost is drawn").toBe(true);
  }, 600000);
  it("reads the same type as the original and the rebuild, whatever the move table says", async () => {
    for (const [abilityId, name] of USERS) {
      const original = liveAbility(abilityId).attrs.find(a => a.constructor.name === "RedirectTypeMoveAbAttr");
      expect(original, name).toBeDefined();
      const index = liveAbility(abilityId).attrs.indexOf(original!);
      const rebuilt = recomposeAttr(moduleOf("RedirectTypeMoveAbAttr"), original!, abilityId, index);
      expect(rebuilt).not.toBe(original);
      expect((rebuilt as unknown as { type: number }).type, name).toBe((original as unknown as { type: number }).type);
      expect(rebuilt.constructor.name).toBe("RedirectTypeMoveAbAttr");
    }
  }, 600000);
});

describe("BlockRedirectAbAttr (Propeller Tail, Stalwart, Old Ocean Relic)", () => {
  it("the engine finds the marker on the original and the rebuild, and not on an ability without it", async () => {
    const { game, foe } = await startWorld(phaserGame);
    game.override.enemyAbility(AbilityId.BALL_FETCH);
    expect(foe.hasAbilityWithAttr("BlockRedirectAbAttr"), "none").toBe(false);
    for (const abilityId of [239, 242, 20009]) {
      for (const [label, id] of forms(abilityId)) {
        game.override.enemyAbility(id as AbilityId);
        expect(foe.hasAbilityWithAttr("BlockRedirectAbAttr"), `${abilityId} ${label}`).toBe(true);
      }
    }
  }, 600000);

  it("keeps the chosen target against Lightning Rod, for the original and the rebuild (and loses it without the flag)", async () => {
    // Both of the player's Pokemon have Lightning Rod. The enemy Magikarp (with `attackerAbility`) uses Shock Wave on the first one. Where the
    // move ends up shows in who absorbed it: the absorber raises its highest attack stat.
    async function whoAbsorbed(attackerAbility: number): Promise<"first" | "second" | "nobody"> {
      const game = freshGame(phaserGame);
      game.override
        .moveset([MoveId.SPLASH])
        .ability(AbilityId.LIGHTNING_ROD)
        .battleStyle("double")
        // The first wave is never a double battle, whatever the override says.
        .startingWave(2)
        .criticalHits(false)
        .startingLevel(100)
        .enemySpecies(SpeciesId.MAGIKARP)
        .enemyLevel(30)
        .enemyAbility(attackerAbility as AbilityId)
        .enemyMoveset(MoveId.SPLASH);
      await game.classicMode.startBattle(SpeciesId.FEEBAS, SpeciesId.SHUCKLE);
      const [first, second] = game.scene.getPlayerField();
      game.move.select(MoveId.SPLASH, BattlerIndex.PLAYER);
      game.move.select(MoveId.SPLASH, BattlerIndex.PLAYER_2);
      await game.move.forceEnemyMove(MoveId.SHOCK_WAVE, BattlerIndex.PLAYER);
      await game.move.forceEnemyMove(MoveId.SPLASH);
      await game.phaseInterceptor.to("BerryPhase");
      const raised = (mon: typeof first) => mon.getStatStage(Stat.ATK) + mon.getStatStage(Stat.SPATK) > 0;
      return raised(first) ? "first" : raised(second) ? "second" : "nobody";
    }
    expect(await whoAbsorbed(AbilityId.BALL_FETCH), "control: the second Pokemon draws it").toBe("second");
    for (const abilityId of [239, 242, 20009]) {
      for (const [label, id] of forms(abilityId)) {
        expect(await whoAbsorbed(id), `${abilityId} ${label}`).toBe("first");
      }
    }
  }, 600000);
});

describe("ReduceStatusEffectDurationAbAttr (Early Bird)", () => {
  it("takes one turn off the sleep counter and ignores other statuses, for the original and the rebuild", async () => {
    const { holder } = await startWorld(phaserGame);
    const original = liveAbility(48).attrs[0] as ReduceStatusEffectDurationAbAttr;
    const rebuilt = recomposeAttr(
      moduleOf("ReduceStatusEffectDurationAbAttr"),
      original,
      48,
      0,
    ) as ReduceStatusEffectDurationAbAttr;
    expect(rebuilt).not.toBe(original);
    for (const [label, attr] of [
      ["original", original],
      ["rebuilt", rebuilt],
    ] as const) {
      const sleep = new NumberHolder(3);
      expect(attr.canApply({ pokemon: holder, statusEffect: StatusEffect.SLEEP, duration: sleep }), label).toBe(true);
      attr.apply({ pokemon: holder, statusEffect: StatusEffect.SLEEP, duration: sleep });
      expect(sleep.value, `${label} sleep`).toBe(2);
      const burn = new NumberHolder(3);
      expect(attr.canApply({ pokemon: holder, statusEffect: StatusEffect.BURN, duration: burn }), label).toBe(false);
    }
  }, 600000);

  async function sleepTurns(abilityId: number, counter: number): Promise<MoveResult[]> {
    const game = freshGame(phaserGame);
    game.override
      .moveset([MoveId.SPLASH])
      .ability(abilityId as AbilityId)
      .battleStyle("single")
      .criticalHits(false)
      .enemySpecies(SpeciesId.MAGIKARP)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemyMoveset(MoveId.SPLASH);
    await game.classicMode.startBattle(SpeciesId.FEEBAS);
    const player = game.field.getPlayerPokemon();
    player.status = new Status(StatusEffect.SLEEP, 0, counter);
    const results: MoveResult[] = [];
    for (let turn = 0; turn < 4; turn++) {
      game.move.select(MoveId.SPLASH);
      await game.toNextTurn();
      results.push(player.getLastXMoves(1)[0]?.result ?? MoveResult.PENDING);
    }
    return results;
  }

  it("takes one extra turn off the sleep counter every turn in a real battle, so a 4 turn sleep ends on the second turn instead of the fourth, for the original and the rebuild", async () => {
    const control = await sleepTurns(AbilityId.BALL_FETCH, 4);
    for (const [label, id] of forms(48)) {
      const turns = await sleepTurns(id, 4);
      const wake = turns.indexOf(MoveResult.SUCCESS);
      expect(wake, `${label} wakes`).toBeGreaterThanOrEqual(0);
      expect([control.indexOf(MoveResult.SUCCESS), wake], `${label}: [without, with]`).toEqual([3, 1]);
    }
  }, 600000);
});

describe("FlinchStatStageChangeAbAttr (Steadfast, Rattled, Superheavy)", () => {
  async function flinchedSpeed(abilityId: number): Promise<number> {
    const game = freshGame(phaserGame);
    game.override
      .moveset([MoveId.SPLASH])
      .ability(abilityId as AbilityId)
      .battleStyle("single")
      .criticalHits(false)
      .enemySpecies(SpeciesId.MAGIKARP)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemyMoveset(MoveId.SPLASH);
    await game.classicMode.startBattle(SpeciesId.FEEBAS);
    const player = game.field.getPlayerPokemon();
    player.addTag(BattlerTagType.FLINCHED);
    game.move.select(MoveId.SPLASH);
    await game.toEndOfTurn();
    return player.getStatStage(Stat.SPD);
  }

  it("raises Speed by one stage when the holder really flinches, for the original and the rebuild", async () => {
    expect(await flinchedSpeed(AbilityId.BALL_FETCH), "control").toBe(0);
    for (const abilityId of [80, 155, 5549]) {
      for (const [label, id] of forms(abilityId)) {
        expect(await flinchedSpeed(id), `${abilityId} ${label}`).toBe(1);
      }
    }
  }, 600000);

  it("queues one stat change with the whole stat list, nothing when simulated, and a moved setting follows", async () => {
    const { holder } = await startWorld(phaserGame);
    const unshift = vi.spyOn(globalScene.phaseManager, "unshiftNew").mockImplementation((() => {}) as never);
    for (const [abilityId, attrIndex] of [
      [80, 0],
      [155, 2],
      [5549, 0],
    ] as const) {
      const original = liveAbility(abilityId).attrs[attrIndex] as FlinchStatStageChangeAbAttr;
      const rebuilt = recomposeAttr(
        moduleOf("FlinchStatStageChangeAbAttr"),
        original,
        abilityId,
        attrIndex,
      ) as FlinchStatStageChangeAbAttr;
      const moved = recomposeAttr(moduleOf("FlinchStatStageChangeAbAttr"), original, abilityId, attrIndex, {
        params: { stats: "ATK,DEF", stages: -2 },
      }) as FlinchStatStageChangeAbAttr;
      const expectations: [FlinchStatStageChangeAbAttr, Stat[], number][] = [
        [original, [Stat.SPD], 1],
        [rebuilt, [Stat.SPD], 1],
        [moved, [Stat.ATK, Stat.DEF], -2],
      ];
      for (const [attr, stats, stages] of expectations) {
        unshift.mockClear();
        attr.apply({ pokemon: holder, simulated: true } as never);
        expect(unshift, "simulated").not.toHaveBeenCalled();
        attr.apply({ pokemon: holder, simulated: false } as never);
        expect(unshift).toHaveBeenCalledTimes(1);
        expect(unshift.mock.calls[0], `${abilityId}`).toEqual([
          "StatStageChangePhase",
          holder.getBattlerIndex(),
          true,
          stats,
          stages,
        ]);
      }
    }
  }, 600000);
});

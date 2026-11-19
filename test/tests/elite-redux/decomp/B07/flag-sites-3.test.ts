/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { MoneyAbAttr } from "#abilities/ab-attrs";
// B07 chunk 3: the engine sites that the shared L1 / L2 suites cannot reach for the eight classes of the chunk.
//
// The shared battle twin has no scenario that ends a battle (event.after-battle), replaces or suppresses the holder's ability, picks a
// chosen move for the turn-order check, or puts a field effect on the holder's side before entry, and the L1 state grid has no field
// effect either. Each class is therefore driven AT its engine site,
//
//   original  the live ability (for example Honey Gather)
//   rebuilt   the same ability rebuilt from its declaration (what a staff blueprint compiles to), where the declaration is live
//   control   Ball Fetch (no such attr)
//
// The rebuilt run must equal the original one and the control must differ. The control is what proves the scenario really reaches the
// site, so equal results are never two empty recordings. The parked class (IllusionBreakAbAttr) and the classes whose only condition is a legacy closure
// (PreventBypassSpeedChanceAbAttr, and the gates of MoneyAbAttr and PostDefendIllusionBreakAbAttr until R-B07-10) have no rebuilt attr, so only original and control are compared for them.
import type { Ability } from "#abilities/ability";
import { applyAbAttrs, applyOnLoseAbAttrs } from "#abilities/apply-ab-attrs";
import { globalScene } from "#app/global-scene";
import { BypassSpeedTag } from "#data/battler-tags";
import { allAbilities, allMoves } from "#data/data-lists";
import { recomposeAttr } from "#data/elite-redux/ability-studio/build-attr";
import { declRegistry } from "#data/elite-redux/ability-studio/decl-registry";
import { AbilityId } from "#enums/ability-id";
import { ArenaTagSide } from "#enums/arena-tag-side";
import { ArenaTagType } from "#enums/arena-tag-type";
import { Command } from "#enums/command";
import { HitResult } from "#enums/hit-result";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import type { GameManager } from "#test/framework/game-manager";
import { freshGame } from "#test/tests/elite-redux/decomp/harness/game";
import { rebuildAbility, registerShadow, unregisterShadows } from "#test/tests/elite-redux/decomp/harness/rebuild";
import { allocateShadowId } from "#test/tests/elite-redux/decomp/harness/twin";
import { NumberHolder } from "#utils/common";
import Phaser from "phaser";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

// Ids from the live game (dump of the live attrs, see the declarations).
const HONEY_GATHER = 118;
const ILLUSION = 149;
const DISGUISE = 209;
const ICE_FACE = 248;
const WIND_RIDER = 274;
const MYCELIUM_MIGHT = 298;
const BALL_FETCH = AbilityId.BALL_FETCH as number;

type Holder = ReturnType<GameManager["field"]["getPlayerPokemon"]>;
interface Ctx {
  readonly game: GameManager;
  readonly holder: Holder;
  readonly foe: ReturnType<GameManager["field"]["getEnemyPokemon"]>;
}
interface Setup {
  readonly party?: readonly SpeciesId[];
  readonly foe?: SpeciesId;
}

describe("B07 chunk 3 at the engine sites", () => {
  let phaserGame: Phaser.Game;
  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });
  afterEach(() => {
    unregisterShadows();
    vi.restoreAllMocks();
  });

  /** Rebuilds a live ability from its declarations and puts it into the ability list under a shadow id. */
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

  /** A one-battle observation: starts a battle whose holder has `abilityId`, then reads something. */
  async function observe<T>(abilityId: number, setup: Setup, read: (ctx: Ctx) => T | Promise<T>): Promise<T> {
    const game = freshGame(phaserGame);
    game.override
      .battleStyle("single")
      .moveset([MoveId.SPLASH])
      .ability(abilityId as AbilityId)
      .startingLevel(100)
      .enemySpecies(setup.foe ?? SpeciesId.MAGIKARP)
      .enemyLevel(30)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemyMoveset(MoveId.SPLASH)
      .criticalHits(false)
      .hasPassiveAbility(false)
      .enemyHasPassiveAbility(false);
    await game.classicMode.startBattle(...((setup.party ?? [SpeciesId.BLISSEY]) as [SpeciesId]));
    const holder = game.field.getPlayerPokemon();
    // The ER innate slots (Mimikyu has Disguise as an innate, Eiscue Ice Face) would add the very attr under test to the control. Only
    // the main ability is asked, which is the one the test puts there.
    const realSources = holder.getActiveAbilitySources.bind(holder);
    vi.spyOn(holder, "getActiveAbilitySources").mockImplementation(((ignoreOverride?: boolean) =>
      realSources(ignoreOverride).filter(source => !source.passive)) as never);
    return await read({ game, holder, foe: game.field.getEnemyPokemon() });
  }

  /** original / rebuilt / control for a direct read. */
  async function threeWays<T>(
    abilityId: number,
    rebuiltIndex: number,
    read: (ctx: Ctx) => T | Promise<T>,
    setup: Setup = {},
  ): Promise<{ original: T; rebuilt: T; control: T }> {
    const shadow = shadowOf(abilityId, [rebuiltIndex]);
    const original = await observe(abilityId, setup, read);
    const rebuilt = await observe(shadow, setup, read);
    const control = await observe(BALL_FETCH, setup, read);
    return { original, rebuilt, control };
  }

  /** original / control for a class whose gate is still a legacy closure (so no rebuilt attr exists yet, like the other legacy classes). */
  async function twoWays<T>(
    abilityId: number,
    read: (ctx: Ctx) => T | Promise<T>,
    setup: Setup = {},
  ): Promise<{ original: T; control: T }> {
    const original = await observe(abilityId, setup, read);
    const control = await observe(BALL_FETCH, setup, read);
    return { original, control };
  }

  /** A disguise that costs nothing to put on or take off (the sprite reload is not part of the rule). */
  function disguise(holder: Holder, foe: Ctx["foe"]): void {
    vi.spyOn(holder, "loadAssets").mockResolvedValue(undefined as never);
    vi.spyOn(holder, "playAnim").mockImplementation(() => undefined as never);
    holder.setIllusion(foe);
  }

  // ---------------------------------------------------------------------------------------------
  // MoneyAbAttr: PostBattleAbAttr as battle-end-phase.ts dispatches it
  // ---------------------------------------------------------------------------------------------
  it("MoneyAbAttr: a won battle adds 20% of the wave's money, a lost or simulated one adds nothing (Honey Gather)", async () => {
    const read = ({ holder }: Ctx) => {
      const pile = (victory: boolean, simulated?: boolean): number => {
        globalScene.currentBattle.moneyScattered = 0;
        applyAbAttrs("PostBattleAbAttr", {
          pokemon: holder,
          victory,
          ...(simulated === undefined ? {} : { simulated }),
        });
        return globalScene.currentBattle.moneyScattered;
      };
      return {
        won: pile(true),
        lost: pile(false),
        preview: pile(true, true),
        expected: globalScene.getWaveMoneyAmount(0.2),
      };
    };
    const result = await twoWays(HONEY_GATHER, read);
    expect(result.original.won).toBe(result.original.expected);
    expect(result.original.won).toBeGreaterThan(0);
    expect(result.original.lost).toBe(0);
    expect(result.original.preview).toBe(0);
    expect(result.control).toEqual({ won: 0, lost: 0, preview: 0, expected: result.original.expected });
  });

  it("MoneyAbAttr: the bonus is a constructor setting that defaults to the shipped 20%, and the split gate can be replaced", async () => {
    const original = (allAbilities[HONEY_GATHER] as Ability).attrs[0] as MoneyAbAttr;
    expect(original.constructor.name).toBe("MoneyAbAttr");
    expect((original as unknown as { bonusFraction: number }).bonusFraction).toBe(0.2);
    const dflt = new MoneyAbAttr();
    const half = new MoneyAbAttr(0.5);
    const everyBattle = new MoneyAbAttr(0.5);
    everyBattle.gateOverride = () => true;
    const read = ({ holder }: Ctx) => {
      const pile = (attr: MoneyAbAttr, victory: boolean, simulated = false): number => {
        globalScene.currentBattle.moneyScattered = 0;
        if (attr.canApply({ pokemon: holder, victory, simulated })) {
          attr.apply({ pokemon: holder, victory, simulated });
        }
        return globalScene.currentBattle.moneyScattered;
      };
      return {
        original: pile(original, true),
        dflt: pile(dflt, true),
        half: pile(half, true),
        halfLost: pile(half, false),
        halfPreview: pile(half, true, true),
        // a replaced gate decides instead of "battle won", the guard (no payout in a preview) still holds
        replacedLost: pile(everyBattle, false),
        replacedPreview: pile(everyBattle, false, true),
        want20: globalScene.getWaveMoneyAmount(0.2),
        want50: globalScene.getWaveMoneyAmount(0.5),
      };
    };
    const result = await observe(BALL_FETCH, {}, read);
    expect(result.original).toBe(result.want20);
    expect(result.dflt).toBe(result.want20);
    expect(result.half).toBe(result.want50);
    expect(result.want50).toBeGreaterThan(result.want20);
    expect(result.halfLost).toBe(0);
    expect(result.halfPreview).toBe(0);
    expect(result.replacedLost).toBe(result.want50);
    expect(result.replacedPreview).toBe(0);
  });

  // ---------------------------------------------------------------------------------------------
  // IllusionPostBattleAbAttr: PostBattleAbAttr; the attr carries the attr-level condition isAllowedInBattle
  // ---------------------------------------------------------------------------------------------
  it("IllusionPostBattleAbAttr: the disguise is dropped after the battle (Illusion)", async () => {
    const read = ({ holder, foe }: Ctx) => {
      disguise(holder, foe);
      const before = holder.summonData.illusion != null;
      applyAbAttrs("PostBattleAbAttr", { pokemon: holder, victory: true });
      return { before, after: holder.summonData.illusion != null };
    };
    const result = await threeWays(ILLUSION, 5, read);
    expect(result.original).toEqual({ before: true, after: false });
    expect(result.rebuilt).toEqual(result.original);
    expect(result.control).toEqual({ before: true, after: true });
  });

  it("IllusionPostBattleAbAttr: the rebuilt attr keeps the attr-level condition of the original", async () => {
    const original = (allAbilities[ILLUSION] as Ability).attrs[5];
    const module = declRegistry.get("IllusionPostBattleAbAttr");
    expect(module).toBeDefined();
    const rebuilt = recomposeAttr(module!, original, ILLUSION, 5);
    expect(rebuilt.constructor.name).toBe("IllusionPostBattleAbAttr");
    expect(rebuilt.getCondition()).not.toBeNull();
    expect(rebuilt.showAbility).toBe(original.showAbility);
  });

  // ---------------------------------------------------------------------------------------------
  // PostDefendIllusionBreakAbAttr: PostDefendAbAttr as move-effect-phase.ts dispatches it
  // ---------------------------------------------------------------------------------------------
  it("PostDefendIllusionBreakAbAttr: only a damaging hit drops the disguise (Illusion)", async () => {
    const read = ({ holder, foe }: Ctx) => {
      const outcome = (hitResult: HitResult, disguised: boolean): boolean => {
        if (holder.summonData.illusion != null) {
          holder.summonData.illusion = null;
        }
        if (disguised) {
          disguise(holder, foe);
        }
        applyAbAttrs("PostDefendAbAttr", {
          pokemon: holder,
          opponent: foe,
          move: allMoves[MoveId.TACKLE],
          damage: 10,
          hitResult,
          simulated: false,
        });
        return holder.summonData.illusion != null;
      };
      return {
        effective: outcome(HitResult.EFFECTIVE, true),
        superEffective: outcome(HitResult.SUPER_EFFECTIVE, true),
        notVeryEffective: outcome(HitResult.NOT_VERY_EFFECTIVE, true),
        oneHitKo: outcome(HitResult.ONE_HIT_KO, true),
        noEffect: outcome(HitResult.NO_EFFECT, true),
        miss: outcome(HitResult.MISS, true),
        status: outcome(HitResult.STATUS, true),
        indirect: outcome(HitResult.INDIRECT, true),
        notDisguised: outcome(HitResult.EFFECTIVE, false),
      };
    };
    const result = await twoWays(ILLUSION, read);
    // true = the disguise is still on afterwards.
    expect(result.original).toEqual({
      effective: false,
      superEffective: false,
      notVeryEffective: false,
      oneHitKo: false,
      noEffect: true,
      miss: true,
      status: true,
      indirect: true,
      notDisguised: false,
    });
    expect(result.control).toEqual({
      effective: true,
      superEffective: true,
      notVeryEffective: true,
      oneHitKo: true,
      noEffect: true,
      miss: true,
      status: true,
      indirect: true,
      notDisguised: false,
    });
  });

  // ---------------------------------------------------------------------------------------------
  // IllusionPreSummonAbAttr: PreSummonAbAttr as summon-phase.ts dispatches it
  // ---------------------------------------------------------------------------------------------
  it("IllusionPreSummonAbAttr: copies the last healthy teammate, and does nothing when there is nobody to copy (Illusion)", async () => {
    const read = ({ holder }: Ctx) => {
      vi.spyOn(holder, "loadAssets").mockResolvedValue(undefined as never);
      vi.spyOn(holder, "playAnim").mockImplementation(() => undefined as never);
      applyAbAttrs("PreSummonAbAttr", { pokemon: holder });
      return holder.summonData.illusion?.name ?? null;
    };
    const alone = await threeWays(ILLUSION, 0, read, { party: [SpeciesId.BLISSEY] });
    expect(alone.original).toBeNull();
    expect(alone.rebuilt).toBeNull();
    expect(alone.control).toBeNull();

    const withTeammate = await threeWays(ILLUSION, 0, read, { party: [SpeciesId.BLISSEY, SpeciesId.SNORLAX] });
    expect(withTeammate.original).not.toBeNull();
    expect(withTeammate.original).toContain("Snorlax");
    expect(withTeammate.rebuilt).toEqual(withTeammate.original);
    expect(withTeammate.control).toBeNull();
  });

  // ---------------------------------------------------------------------------------------------
  // IllusionBreakAbAttr (parked): applyOnLoseAbAttrs, as Pokemon.suppressAbility and setTempAbility call it
  // ---------------------------------------------------------------------------------------------
  it("IllusionBreakAbAttr: the disguise is dropped when the ability is lost (Illusion)", async () => {
    const read = ({ holder, foe }: Ctx) => {
      disguise(holder, foe);
      applyOnLoseAbAttrs({ pokemon: holder });
      return holder.summonData.illusion != null;
    };
    expect(await observe(ILLUSION, {}, read)).toBe(false);
    expect(await observe(BALL_FETCH, {}, read)).toBe(true);
  });

  // ---------------------------------------------------------------------------------------------
  // PostSummonStatStageChangeOnArenaAbAttr (Tier B): the gate is the tag on the holder's own side
  // ---------------------------------------------------------------------------------------------
  describe("PostSummonStatStageChangeOnArenaAbAttr", () => {
    type Queued = { name: string; stats: unknown; stages: unknown; selfTarget: unknown }[];

    /** Enters with the given field effects and returns the stat stage phases that were queued. */
    function enter(
      { holder }: Ctx,
      own: ArenaTagType | null,
      opposing: ArenaTagType | null,
      simulated = false,
    ): Queued {
      const queued: Queued = [];
      // Setting the tag itself queues Wind Rider's own Attack boost (arena-tag.ts), so the field is set up BEFORE the phases are recorded.
      globalScene.arena.removeTagOnSide(ArenaTagType.TAILWIND, ArenaTagSide.PLAYER, true);
      globalScene.arena.removeTagOnSide(ArenaTagType.TAILWIND, ArenaTagSide.ENEMY, true);
      if (own !== null) {
        globalScene.arena.addTag(own, 4, MoveId.TAILWIND, holder.id, ArenaTagSide.PLAYER);
      }
      if (opposing !== null) {
        globalScene.arena.addTag(opposing, 4, MoveId.TAILWIND, holder.id, ArenaTagSide.ENEMY);
      }
      const spy = vi.spyOn(globalScene.phaseManager, "unshiftNew").mockImplementation(((...args: unknown[]) => {
        if (args[0] === "StatStageChangePhase") {
          queued.push({ name: String(args[0]), selfTarget: args[2], stats: args[3], stages: args[4] });
        }
      }) as never);
      applyAbAttrs("PostSummonAbAttr", { pokemon: holder, simulated });
      spy.mockRestore();
      return queued;
    }

    it("raises the higher attacking stat only while Tailwind is up on the holder's own side (Wind Rider)", async () => {
      const read = (ctx: Ctx) => ({
        none: enter(ctx, null, null),
        own: enter(ctx, ArenaTagType.TAILWIND, null),
        opposingOnly: enter(ctx, null, ArenaTagType.TAILWIND),
        both: enter(ctx, ArenaTagType.TAILWIND, ArenaTagType.TAILWIND),
        preview: enter(ctx, ArenaTagType.TAILWIND, null, true),
        // Blissey's Sp. Atk is above its Attack, so the resolver picks Sp. Atk (3).
        spAtk: ctx.holder.getStat(3, false) > ctx.holder.getStat(1, false),
      });
      const result = await threeWays(WIND_RIDER, 1, read);
      const raised = [{ name: "StatStageChangePhase", selfTarget: true, stats: [3], stages: 1 }];
      expect(result.original.spAtk).toBe(true);
      expect(result.original.none).toEqual([]);
      expect(result.original.own).toEqual(raised);
      expect(result.original.opposingOnly).toEqual([]);
      expect(result.original.both).toEqual(raised);
      expect(result.original.preview).toEqual([]);
      expect(result.rebuilt).toEqual(result.original);
      expect(result.control.own).toEqual([]);
    });

    it("the rebuilt gate follows the field effect setting, and the compiled gate replaces the class gate", async () => {
      const module = declRegistry.get("PostSummonStatStageChangeOnArenaAbAttr");
      expect(module).toBeDefined();
      const original = (allAbilities[WIND_RIDER] as Ability).attrs[1];
      expect(original.constructor.name).toBe("PostSummonStatStageChangeOnArenaAbAttr");
      const rebuiltDefault = recomposeAttr(module!, original, WIND_RIDER, 1);
      const rebuiltReflect = recomposeAttr(module!, original, WIND_RIDER, 1, { params: { arenaTag: "REFLECT" } });
      const both = [rebuiltDefault, rebuiltReflect] as unknown as { gateOverride: unknown }[];
      expect(both.every(attr => typeof attr.gateOverride === "function")).toBe(true);
      const read = async (ctx: Ctx) => {
        const params = { pokemon: ctx.holder, simulated: false } as never;
        const ask = (): { dflt: boolean; reflect: boolean; original: boolean } => ({
          dflt: rebuiltDefault.canApply(params),
          reflect: rebuiltReflect.canApply(params),
          original: original.canApply(params),
        });
        globalScene.arena.removeTagOnSide(ArenaTagType.TAILWIND, ArenaTagSide.PLAYER, true);
        const none = ask();
        globalScene.arena.addTag(ArenaTagType.TAILWIND, 4, MoveId.TAILWIND, ctx.holder.id, ArenaTagSide.PLAYER);
        const tailwind = ask();
        globalScene.arena.removeTagOnSide(ArenaTagType.TAILWIND, ArenaTagSide.PLAYER, true);
        globalScene.arena.addTag(ArenaTagType.REFLECT, 4, MoveId.REFLECT, ctx.holder.id, ArenaTagSide.PLAYER);
        const reflect = ask();
        return { none, tailwind, reflect };
      };
      const result = await observe(BALL_FETCH, {}, read);
      expect(result.none).toEqual({ dflt: false, reflect: false, original: false });
      expect(result.tailwind).toEqual({ dflt: true, reflect: false, original: true });
      expect(result.reflect).toEqual({ dflt: false, reflect: true, original: false });
    });
  });

  // ---------------------------------------------------------------------------------------------
  // FormBlockDamageAbAttr: ReceivedMoveDamageMultiplierAbAttr with a real species that has the form change
  // ---------------------------------------------------------------------------------------------
  describe("FormBlockDamageAbAttr", () => {
    /** One hit through the damage hook; reports the damage left, the HP lost to recoil and the form change requests. */
    function hit({ holder, foe }: Ctx, move: MoveId): { damage: number; recoil: number; formChanges: number } {
      const requests: unknown[] = [];
      vi.spyOn(globalScene, "triggerPokemonFormChange").mockImplementation(((...args: unknown[]) => {
        requests.push(args);
        return true;
      }) as never);
      holder.hp = holder.getMaxHp();
      const damage = new NumberHolder(40);
      applyAbAttrs("ReceivedMoveDamageMultiplierAbAttr", {
        pokemon: holder,
        opponent: foe,
        move: allMoves[move],
        damage,
        simulated: false,
      });
      return { damage: damage.value, recoil: holder.getMaxHp() - holder.hp, formChanges: requests.length };
    }

    it("the first hit does no damage, costs 1/8 of max HP and breaks the form (Disguise on Mimikyu)", async () => {
      const read = (ctx: Ctx) => ({
        physical: hit(ctx, MoveId.TACKLE),
        special: hit(ctx, MoveId.WATER_GUN),
        eighth: Math.floor(ctx.holder.getMaxHp() * 0.125),
      });
      const result = await threeWays(DISGUISE, 2, read, { party: [SpeciesId.MIMIKYU] });
      expect(result.original.physical.damage).toBe(0);
      expect(result.original.physical.recoil).toBe(result.original.eighth);
      expect(result.original.physical.formChanges).toBe(1);
      expect(result.original.special.damage).toBe(0);
      expect(result.rebuilt).toEqual(result.original);
      expect(result.control.physical).toEqual({ damage: 40, recoil: 0, formChanges: 0 });
    });

    it("only a physical hit is blocked, with no recoil (Ice Face on Eiscue)", async () => {
      const read = (ctx: Ctx) => ({
        physical: hit(ctx, MoveId.TACKLE),
        special: hit(ctx, MoveId.WATER_GUN),
      });
      const result = await threeWays(ICE_FACE, 4, read, { party: [SpeciesId.EISCUE] });
      expect(result.original.physical).toEqual({ damage: 0, recoil: 0, formChanges: 1 });
      expect(result.original.special).toEqual({ damage: 40, recoil: 0, formChanges: 0 });
      expect(result.rebuilt).toEqual(result.original);
      expect(result.control.physical.damage).toBe(40);
    });

    it("a species without a form to break into is never made invincible (Disguise on Blissey)", async () => {
      const read = (ctx: Ctx) => hit(ctx, MoveId.TACKLE);
      const result = await threeWays(DISGUISE, 2, read, { party: [SpeciesId.BLISSEY] });
      expect(result.original).toEqual({ damage: 40, recoil: 0, formChanges: 0 });
      expect(result.rebuilt).toEqual(result.original);
    });
  });

  // ---------------------------------------------------------------------------------------------
  // PreventBypassSpeedChanceAbAttr (legacy closure): the BYPASS_SPEED tag asks it from BypassSpeedTag.canAdd
  // ---------------------------------------------------------------------------------------------
  it("PreventBypassSpeedChanceAbAttr: a chosen status move may not jump the turn order, a damaging one may (Mycelium Might)", async () => {
    const read = ({ holder }: Ctx) => {
      const index = holder.getBattlerIndex();
      const turnCommands = globalScene.currentBattle.turnCommands as Record<number, unknown>;
      const may = (command: Command, move?: MoveId): boolean => {
        turnCommands[index] = { command, ...(move === undefined ? {} : { move: { move, targets: [] } }) };
        return new BypassSpeedTag().canAdd(holder);
      };
      return {
        status: may(Command.FIGHT, MoveId.TOXIC),
        damaging: may(Command.FIGHT, MoveId.TACKLE),
        switching: may(Command.POKEMON),
      };
    };
    expect(await observe(MYCELIUM_MIGHT, {}, read)).toEqual({ status: false, damaging: true, switching: true });
    expect(await observe(BALL_FETCH, {}, read)).toEqual({ status: true, damaging: true, switching: true });
  });
});

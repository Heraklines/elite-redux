/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// Library completion pass, waves B (guards) and C (effects): every block checked against the class or engine expression
// it was lifted from. Numeric effects get boundary tests; where the class is cheap to build it runs on the same input.
import {
  ArenaTrapAbAttr,
  BypassSpeedChanceAbAttr,
  CritUseLowerDefensiveStatAbAttr,
  ForceSwitchOutHelper,
  IgnoreMoveEffectsAbAttr,
  PostAttackAbilityGiveAbAttr,
  PostAttackRemoveTargetTypeAbAttr,
  PostAttackStealHeldItemAbAttr,
  PostDefendAbilityGiveAbAttr,
  PostDefendStatStageChangeAbAttr,
  PostSummonAllyHealAbAttr,
  PostSummonClearWeatherAbAttr,
  PostSummonFormChangeByWeatherAbAttr,
  PostSummonMessageAbAttr,
  PostSummonRemoveArenaTagAbAttr,
  PostSummonStatStageChangeAbAttr,
  PostSummonUnnamedMessageAbAttr,
  PostSummonUserFieldRemoveStatusEffectAbAttr,
  PreLeaveFieldClearWeatherAbAttr,
  PreSwitchOutHealAbAttr,
  PreSwitchOutResetStatusAbAttr,
  ReflectStatStageChangeAbAttr,
  SetMoveAccuracyAbAttr,
  StatMultiplierAbAttr,
} from "#abilities/ab-attrs";
import { initGlobalScene } from "#app/global-scene";
import { allAbilities, allMoves } from "#data/data-lists";
import { VoidPostTurnStealAbAttr } from "#data/elite-redux/abilities/bernerd-roster-mechanics";
import { addCharge, clearCharge, getCharge } from "#data/elite-redux/abilities/charge-stack";
import { BallasterResetAbAttr } from "#data/elite-redux/abilities/fakemon-pitch-mechanics";
import {
  FanFavoriteAccuracyAbAttr,
  FanFavoritePowerAbAttr,
  FoulHarvestAbAttr,
  HeavyweightPowerAbAttr,
  heavyweightMultiplier,
  livingBenchCount,
  recordSignatureExecutedMove,
} from "#data/elite-redux/abilities/newcomer-signature-mechanics";
import { PostTurnHurtNonTypedAbAttr } from "#data/elite-redux/abilities/post-turn-hurt-non-typed";
import { PpReductionOnContactAbAttr } from "#data/elite-redux/abilities/pp-reduction-on-contact";
import { ANNOUNCEMENTS } from "#data/elite-redux/ability-studio/decl/B03/codecs";
import { getEffect } from "#data/elite-redux/ability-studio/vocabulary/effects";
import { compileEffect } from "#data/elite-redux/ability-studio/vocabulary/evaluate/effects";
import { type Frame, frameFromAttrParams } from "#data/elite-redux/ability-studio/vocabulary/evaluate/frame";
import { evaluateGuard } from "#data/elite-redux/ability-studio/vocabulary/evaluate/guards";
import { getGuard } from "#data/elite-redux/ability-studio/vocabulary/guards";
import { claimSummonAbilityProvenance } from "#data/elite-redux/ability-upgrades/attrs/innate-slot-suppression";
import {
  BreakScreensOnAttackAbAttr,
  FaintedAllyStatMultiplierAbAttr,
} from "#data/elite-redux/ability-upgrades/attrs/requested-combat-riders";
import { EntryTailwindClearWeatherAbAttr } from "#data/elite-redux/archetypes/entry-tailwind-clear-weather";
import { HitMultiplierAbAttr } from "#data/elite-redux/archetypes/hit-multiplier";
import { ScavengerLootAbAttr } from "#data/elite-redux/archetypes/lifesteal";
import { OnFaintEffectAbAttr } from "#data/elite-redux/archetypes/on-faint-effect";
import { PostAttackChangeTargetTypeAbAttr } from "#data/elite-redux/archetypes/post-attack-change-target-type";
import { PostAttackRemoveTargetTypeAbAttr as ArchetypeRemoveTargetTypeAbAttr } from "#data/elite-redux/archetypes/post-attack-remove-target-type";
import { PostDamageForceAttackerOutAbAttr } from "#data/elite-redux/archetypes/post-damage-force-attacker-out";
import { PostSummonScriptedMoveAbAttr } from "#data/elite-redux/archetypes/post-summon-scripted-move";
import { PostTurnDrainAbAttr } from "#data/elite-redux/archetypes/post-turn-drain";
import { PostVictoryClearRechargeAbAttr } from "#data/elite-redux/archetypes/post-victory-clear-recharge";
import { SelfHighestStatBoostOnSummonAbAttr } from "#data/elite-redux/archetypes/self-highest-stat-boost-on-summon";
import { SpeedBonusToStatAbAttr } from "#data/elite-redux/archetypes/speed-bonus-to-stat";
import { TypeImmunityHighestAttackStatStageAbAttr } from "#data/elite-redux/archetypes/type-immunity-highest-attack-stat-stage";
import {
  ClearOpponentStatBuffsOnSummonAbAttr,
  ErMagicianStealAbAttr,
  ErTerrainSummonAbAttr,
  ErWeatherSummonAbAttr,
} from "#data/elite-redux/init-elite-redux-vanilla-rebalance";
import { PokemonMove } from "#data/moves/pokemon-move";
import { pokemonFormChanges } from "#data/pokemon-forms";
import { TerrainType } from "#data/terrain";
import { AbilityId } from "#enums/ability-id";
import { ArenaTagSide } from "#enums/arena-tag-side";
import { ArenaTagType } from "#enums/arena-tag-type";
import { BattlerTagType } from "#enums/battler-tag-type";
import { MoveId } from "#enums/move-id";
import { MoveUseMode } from "#enums/move-use-mode";
import { PokemonType } from "#enums/pokemon-type";
import { Stat } from "#enums/stat";
import { StatusEffect } from "#enums/status-effect";
import { WeatherType } from "#enums/weather-type";
import { PokemonHeldItemModifier } from "#modifiers/modifier";
import { NumberHolder } from "#utils/common";
import { describe, expect, it, type Mock, vi } from "vitest";

// The real ability dispatch and name helper run on the fakes below (no abilities, plain names), so the real class can
// be the oracle for the effects that call them.

type Fake = Record<string, unknown>;

function mon(over: Fake = {}): Fake {
  return {
    id: 1,
    hp: 100,
    status: null,
    isTerastallized: false,
    getMaxHp: () => 100,
    isFainted: () => false,
    isFullHp: () => false,
    isPlayer: () => true,
    isOnField: () => true,
    getOpponents: () => [],
    getBattlerIndex: () => 0,
    hasAbilityWithAttr: () => false,
    isOfType: () => false,
    updateInfo: vi.fn(),
    getNameToRender: () => "mon",
    isEnemy: () => false,
    getActiveAbilitySources: () => [],
    battleData: { erAbilityProvenance: [] as string[] },
    summonData: { erAbilityProvenance: [] as string[], types: [] },
    turnData: { erAbilityProvenance: [] as string[] },
    ...over,
  };
}

const frame = (holder: Fake, extra: Partial<Frame> = {}): Frame => ({
  holder: holder as never,
  simulated: false,
  ...extra,
});

const effect = (block: string, params: Record<string, string | number | boolean> = {}) =>
  compileEffect({ block, params });

interface FakePhases {
  readonly unshiftNew: Mock;
  readonly queueMessage: Mock;
}

function scene(extra: Fake = {}, currentPhase?: unknown): FakePhases {
  const phaseManager = { unshiftNew: vi.fn(), queueMessage: vi.fn(), getCurrentPhase: () => currentPhase };
  initGlobalScene({ phaseManager, ...extra } as never);
  return phaseManager;
}

describe("Wave B guards", () => {
  it("not-simulated is !simulated", () => {
    expect(evaluateGuard("not-simulated", frame(mon()))).toBe(true);
    expect(evaluateGuard("not-simulated", frame(mon(), { simulated: true }))).toBe(false);
  });

  it("another-holder-keeps-weather: blocked only by ANOTHER holder of the current weather", () => {
    const holder = mon({ getAbilityAttrs: () => [{ weatherType: WeatherType.HEAVY_RAIN }] });
    const keeper = mon({ getAbilityAttrs: () => [{ weatherType: WeatherType.HEAVY_RAIN }] });
    const other = mon({ getAbilityAttrs: () => [{ weatherType: WeatherType.HARSH_SUN }] });
    const field: Fake[] = [holder, other];
    scene({ arena: { weatherType: WeatherType.HEAVY_RAIN }, getField: () => field });
    expect(evaluateGuard("another-holder-keeps-weather", frame(holder))).toBe(true);
    field.push(keeper);
    expect(evaluateGuard("another-holder-keeps-weather", frame(holder))).toBe(false);
  });

  it("foe-can-be-trapped matches ArenaTrapAbAttr clauses 2 and 3 (Ghost with tera rules, Run Away)", () => {
    const isOfType = vi.fn((t: PokemonType) => t === PokemonType.GHOST);
    expect(evaluateGuard("foe-can-be-trapped", frame(mon(), { other: mon({ isOfType }) as never }))).toBe(false);
    expect(isOfType).toHaveBeenCalledWith(PokemonType.GHOST, true, true);
    expect(
      evaluateGuard("foe-can-be-trapped", frame(mon(), { other: mon({ hasAbilityWithAttr: () => true }) as never })),
    ).toBe(false);
    expect(evaluateGuard("foe-can-be-trapped", frame(mon(), { other: mon() as never }))).toBe(true);
    expect(evaluateGuard("foe-can-be-trapped", frame(mon()))).toBe(false);
    expect(getGuard("foe-can-be-trapped")?.requires).toEqual(["other"]);
  });
});

describe("Wave C calc effects (compared with the classes)", () => {
  it("multiply-stat equals StatMultiplierAbAttr; 'the stat being calculated' skips the stat check", () => {
    const cls = new StatMultiplierAbAttr(Stat.SPD, 1.5);
    const compiled = effect("effect.multiply-stat", { stat: "SPD", multiplier: 1.5 });
    for (const [stat, value] of [
      [Stat.SPD, 101],
      [Stat.ATK, 99],
    ]) {
      const params = { pokemon: mon(), stat, statVal: new NumberHolder(value) } as never;
      const mine = { pokemon: mon(), stat, statVal: new NumberHolder(value) } as never;
      const ok = cls.canApply(params);
      expect(compiled.feasible?.({ frame: frame(mon(), { stat }), params: mine })).toBe(ok);
      if (ok) {
        cls.apply(params);
        compiled.run({ frame: frame(mon(), { stat }), params: mine });
        expect((mine as { statVal: NumberHolder }).statVal.value).toBe(
          (params as { statVal: NumberHolder }).statVal.value,
        );
      }
    }
    expect(effect("effect.multiply-stat", { stat: "current" }).feasible).toBeUndefined();
  });

  it("add-stat-share equals SpeedBonusToStatAbAttr (floor on the bonus only), add and replace", () => {
    for (const replace of [false, true]) {
      for (const spd of [0, 1, 4, 5, 99, 100, 333]) {
        const holder = mon({ getStat: (s: Stat, b: boolean) => (s === Stat.SPD && b === false ? spd : -1) });
        const cls = new SpeedBonusToStatAbAttr({ bonusStat: Stat.ATK, speedFraction: 0.2, replace } as never);
        const theirs = new NumberHolder(57);
        cls.apply({ pokemon: holder, statVal: theirs } as never);
        const mine = new NumberHolder(57);
        effect("effect.add-stat-share", { sourceStat: "SPD", share: 0.2, replace }).run({
          frame: frame(holder),
          params: { statVal: mine },
        });
        expect(mine.value, `spd ${spd} replace ${replace}`).toBe(theirs.value);
      }
    }
    const gated = effect("effect.add-stat-share", { stat: "ATK" });
    expect(gated.feasible?.({ frame: frame(mon(), { stat: Stat.ATK }), params: {} })).toBe(true);
    expect(gated.feasible?.({ frame: frame(mon(), { stat: Stat.DEF }), params: {} })).toBe(false);
  });

  it("multiply-stat-per-fainted-ally equals FaintedAllyStatMultiplierAbAttr and never counts the holder", () => {
    const holder = mon({ id: 7, isFainted: () => true });
    const party = [
      holder,
      mon({ id: 2, isFainted: () => true }),
      mon({ id: 3, isFainted: () => true }),
      mon({ id: 4 }),
    ];
    scene({ getPlayerParty: () => party, getEnemyParty: () => [] });
    const cls = new FaintedAllyStatMultiplierAbAttr(Stat.ATK, 0.05);
    const theirs = new NumberHolder(100);
    cls.apply({ pokemon: holder, statVal: theirs } as never);
    const mine = new NumberHolder(100);
    effect("effect.multiply-stat-per-fainted-ally", { share: 0.05 }).run({
      frame: frame(holder),
      params: { statVal: mine },
    });
    expect(mine.value).toBe(theirs.value);
    expect(mine.value).toBeCloseTo(110);
  });

  it("set-accuracy equals SetMoveAccuracyAbAttr residual and apply at the boundaries (-1, N-1, N)", () => {
    const cls = new SetMoveAccuracyAbAttr([MoveId.HYPNOSIS], 90);
    const compiled = effect("effect.set-accuracy", { accuracy: 90 });
    for (const value of [-1, 0, 60, 89, 90, 100]) {
      const theirs = { accuracy: new NumberHolder(value) };
      const mine = { accuracy: new NumberHolder(value) };
      const ok = cls.residual(theirs as never);
      expect(compiled.feasible?.({ frame: frame(mon()), params: mine }), `accuracy ${value}`).toBe(ok);
      if (ok) {
        cls.apply(theirs as never);
        compiled.run({ frame: frame(mon()), params: mine });
        expect(mine.accuracy.value).toBe(theirs.accuracy.value);
      }
    }
  });

  it("ignore-secondary-effects equals IgnoreMoveEffectsAbAttr at 0 and 1", () => {
    const cls = new IgnoreMoveEffectsAbAttr();
    const compiled = effect("effect.ignore-secondary-effects");
    for (const value of [0, 1, 30]) {
      const theirs = { chance: new NumberHolder(value) };
      const mine = { chance: new NumberHolder(value) };
      expect(compiled.feasible?.({ frame: frame(mon()), params: mine })).toBe(cls.canApply(theirs as never));
      cls.apply(theirs as never);
      compiled.run({ frame: frame(mon()), params: mine });
      expect(mine.chance.value).toBe(theirs.chance.value);
    }
  });

  it("multiply-power-per-count uses the class helpers: bench count capped, weight classes floored at 0", () => {
    const holder = mon();
    const benched = (n: number) => Array.from({ length: n }, () => mon({ isOnField: () => false }));
    for (const n of [0, 1, 5, 6]) {
      scene({ getPlayerParty: () => [holder, ...benched(n)], getEnemyParty: () => [] });
      const power = new NumberHolder(80);
      const compiled = effect("effect.multiply-power-per-count", { counter: "benched-teammates", percent: 5, max: 5 });
      expect(compiled.feasible?.({ frame: frame(holder), params: { power } })).toBe(n > 0);
      compiled.run({ frame: frame(holder), params: { power } });
      expect(power.value).toBe(80 * (1 + livingBenchCount(holder as never, 5) * (5 / 100)));
    }
    for (const [mine, theirs] of [
      [200, 10],
      [10, 200],
      [25, 24.9],
    ]) {
      const user = mon({ getWeight: () => mine });
      const target = mon({ getWeight: () => theirs });
      const power = new NumberHolder(100);
      effect("effect.multiply-power-per-count", { counter: "weight-classes", percent: 10, max: 5 }).run({
        frame: frame(user, { other: target as never }),
        params: { power },
      });
      expect(power.value).toBe(100 * heavyweightMultiplier(user as never, target as never, 10, 5));
    }
  });

  it("multiply-accuracy-per-count keeps the class guard accuracy > 0 and the bench arithmetic", () => {
    const holder = mon();
    scene({ getPlayerParty: () => [holder, mon({ isOnField: () => false }), mon({ isOnField: () => false })] });
    const accuracy = new NumberHolder(80);
    effect("effect.multiply-accuracy-per-count").run({ frame: frame(holder), params: { accuracy } });
    expect(accuracy.value).toBe(80 * (1 + livingBenchCount(holder as never, 5) * (5 / 100)));
    const compiled = effect("effect.multiply-accuracy-per-count");
    expect(compiled.feasible?.({ frame: frame(mon()), params: { accuracy: new NumberHolder(0) } })).toBe(false);
    expect(compiled.feasible?.({ frame: frame(mon()), params: { accuracy: new NumberHolder(1) } })).toBe(true);
    expect(compiled.feasible?.({ frame: frame(mon()), params: { accuracy: new NumberHolder(-1) } })).toBe(false);
  });

  it("use-weaker-defense equals CritUseLowerDefensiveStatAbAttr, tie goes to Defense", () => {
    const cls = new CritUseLowerDefensiveStatAbAttr();
    for (const [def, spdef] of [
      [100, 60],
      [60, 100],
      [80, 80],
    ]) {
      const defender = mon({ getEffectiveStat: (s: Stat) => (s === Stat.DEF ? def : spdef) });
      const theirs = { defender, statHolder: new NumberHolder(-1) };
      const mine = { defender, statHolder: new NumberHolder(-1) };
      cls.apply(theirs as never);
      effect("effect.use-weaker-defense").run({ frame: frame(mon()), params: mine });
      expect(mine.statHolder.value).toBe(theirs.statHolder.value);
    }
    const untouched = { statHolder: new NumberHolder(-1) };
    effect("effect.use-weaker-defense").run({ frame: frame(mon()), params: untouched });
    expect(untouched.statHolder.value).toBe(-1);
  });

  it("trap-foe sets trapped and bundles the foe-can-be-trapped rule", () => {
    const compiled = effect("effect.trap-foe");
    const trapped = { value: false };
    compiled.run({ frame: frame(mon()), params: { trapped } });
    expect(trapped.value).toBe(true);
    expect(compiled.guards).toEqual(["foe-can-be-trapped"]);
  });

  it("jump-turn-order: no preview, canAddTag check, the tag, then the optional turn reminder", () => {
    expect(
      effect("effect.jump-turn-order").feasible?.({
        frame: frame(mon({ canAddTag: () => true }), { simulated: true }),
        params: {},
      }),
    ).toBe(false);
    const addTag = vi.fn();
    const holder = mon({ addTag, canAddTag: (t: BattlerTagType) => t === BattlerTagType.BYPASS_SPEED });
    const compiled = effect("effect.jump-turn-order", { memoName: "quick-draw" });
    expect(compiled.feasible?.({ frame: frame(holder), params: {} })).toBe(true);
    compiled.run({ frame: frame(holder), params: {} });
    compiled.run({ frame: frame(holder), params: {} });
    expect(addTag).toHaveBeenCalledWith(BattlerTagType.BYPASS_SPEED);
    expect((holder.turnData as { erAbilityProvenance: string[] }).erAbilityProvenance).toEqual(["quick-draw"]);
  });

  it("reflect-stat-drop equals ReflectStatStageChangeAbAttr on the real dispatch parameters (cancel.stat-reflect)", () => {
    expect(getEffect("effect.reflect-stat-drop")?.requires).toEqual(["other", "stat", "stages"]);
    for (const simulated of [false, true]) {
      const holder = mon({ getBattlerIndex: () => 0 });
      const source = mon({ getBattlerIndex: () => 2 });
      // stat-stage-change-phase.ts:211-218.
      const dispatch = () => ({
        pokemon: holder,
        stat: Stat.ATK,
        cancelled: { value: false },
        simulated,
        source,
        stages: -1,
      });
      const theirsPhases = scene();
      const cls = new ReflectStatStageChangeAbAttr();
      const theirs = dispatch();
      expect(cls.canApply(theirs as never)).toBe(true);
      cls.apply(theirs as never);
      const minePhases = scene();
      const mine = dispatch();
      const f = frameFromAttrParams("cancel.stat-reflect", mine);
      expect(f.other).toBe(source);
      const compiled = effect("effect.reflect-stat-drop");
      expect(compiled.feasible?.({ frame: f, params: mine })).toBe(true);
      compiled.run({ frame: f, params: mine });
      expect(mine.cancelled.value).toBe(theirs.cancelled.value);
      expect(minePhases.unshiftNew.mock.calls).toEqual(theirsPhases.unshiftNew.mock.calls);
    }
    const noSource = { pokemon: mon(), stat: Stat.ATK, cancelled: { value: false }, simulated: false, stages: -1 };
    expect(
      effect("effect.reflect-stat-drop").feasible?.({
        frame: frameFromAttrParams("cancel.stat-reflect", noSource),
        params: noSource,
      }),
    ).toBe(false);
  });

  it("hit-n-times adds the extra strikes (hit-multiplier.ts:190)", () => {
    const hitCount = new NumberHolder(1);
    effect("effect.hit-n-times", { extraStrikes: 2 }).run({ frame: frame(mon()), params: { hitCount } });
    expect(hitCount.value).toBe(3);
  });
});

describe("Wave C event effects", () => {
  it("live entries keep today's V1 payload and context with default settings", () => {
    const expected: Record<string, object> = {
      "effect.cure-status": { kind: "cure-status", target: "holder", status: "ANY" },
      "effect.heal-percent": { kind: "heal-percent", target: "holder", percent: 25 },
      "effect.set-weather": { kind: "set-weather", weather: "RAIN" },
      "effect.set-terrain": { kind: "set-terrain", terrain: "ELECTRIC" },
    };
    for (const [block, payload] of Object.entries(expected)) {
      const compiled = effect(block);
      expect(compiled.feasible, block).toBeUndefined();
      const phases = scene();
      const holder = mon();
      compiled.run({ frame: frame(holder), params: {} });
      expect(phases.unshiftNew.mock.calls, block).toEqual([
        [
          "AbilityStudioRuleEffectPhase",
          [payload],
          { holder, other: undefined, move: undefined, moveSource: undefined, simulated: false },
        ],
      ]);
    }
  });

  it("heal-percent instant equals PreSwitchOutHealAbAttr (33% of max HP, at least 1)", () => {
    for (const maxHp of [1, 2, 3, 100, 101, 301]) {
      const theirsHeal = vi.fn();
      const mineHeal = vi.fn();
      new PreSwitchOutHealAbAttr().apply({
        pokemon: mon({ getMaxHp: () => maxHp, heal: theirsHeal }),
        simulated: false,
      } as never);
      effect("effect.heal-percent", { percent: 33, instant: true }).run({
        frame: frame(mon({ getMaxHp: () => maxHp, heal: mineHeal })),
        params: {},
      });
      expect(mineHeal.mock.calls, `max ${maxHp}`).toEqual(theirsHeal.mock.calls);
    }
  });

  it("set-weather with turns equals ErWeatherSummonAbAttr (canApply then apply), including an active weather", () => {
    const makeArena = (initial?: WeatherType) => {
      const arena = {
        weather:
          initial === undefined
            ? undefined
            : { weatherType: initial, turnsLeft: 2, maxDuration: 5, isImmutable: () => false },
        canSetWeather: (w: WeatherType) => arena.weather?.weatherType !== w,
        trySetWeather: (w: WeatherType) => {
          if (!arena.canSetWeather(w)) {
            return false;
          }
          arena.weather = { weatherType: w, turnsLeft: 5, maxDuration: 5, isImmutable: () => false };
          return true;
        },
      };
      return arena;
    };
    for (const initial of [undefined, WeatherType.RAIN, WeatherType.SUNNY]) {
      const theirs = makeArena(initial);
      scene({ arena: theirs, applyModifier: vi.fn() });
      const cls = new ErWeatherSummonAbAttr(WeatherType.RAIN, 8);
      const params = { pokemon: mon(), simulated: false } as never;
      if (cls.canApply(params)) {
        cls.apply(params);
      }
      const mine = makeArena(initial);
      scene({ arena: mine, applyModifier: vi.fn() });
      const compiled = effect("effect.set-weather", { weather: "RAIN", turns: 8 });
      if (compiled.feasible?.({ frame: frame(mon()), params: {} })) {
        compiled.run({ frame: frame(mon()), params: {} });
      }
      expect(JSON.stringify(mine.weather), `initial ${initial}`).toBe(JSON.stringify(theirs.weather));
    }
  });

  it("set-terrain with turns equals ErTerrainSummonAbAttr (canApply then apply), including an active terrain", () => {
    const makeArena = (initial?: TerrainType) => {
      const arena = {
        terrain: initial === undefined ? undefined : { terrainType: initial, turnsLeft: 2 },
        canSetTerrain: (t: TerrainType) => arena.terrain?.terrainType !== t,
        trySetTerrain: (t: TerrainType) => {
          if (!arena.canSetTerrain(t)) {
            return false;
          }
          arena.terrain = { terrainType: t, turnsLeft: 5 };
          return true;
        },
      };
      return arena;
    };
    for (const initial of [undefined, TerrainType.ELECTRIC, TerrainType.GRASSY]) {
      const theirs = makeArena(initial);
      scene({ arena: theirs, applyModifier: vi.fn() });
      const cls = new ErTerrainSummonAbAttr(TerrainType.ELECTRIC, 8);
      const params = { pokemon: mon(), simulated: false } as never;
      if (cls.canApply(params)) {
        cls.apply(params);
      }
      const mine = makeArena(initial);
      scene({ arena: mine, applyModifier: vi.fn() });
      const compiled = effect("effect.set-terrain", { terrain: "ELECTRIC", turns: 8 });
      if (compiled.feasible?.({ frame: frame(mon()), params: {} })) {
        compiled.run({ frame: frame(mon()), params: {} });
      }
      expect(mine.terrain, `initial ${initial}`).toEqual(theirs.terrain);
    }
  });

  it("clear-weather: keepExtreme keeps an immutable weather, off clears it", () => {
    const trySetWeather = vi.fn();
    scene({ arena: { weather: { isImmutable: () => true }, trySetWeather } });
    effect("effect.clear-weather").run({ frame: frame(mon()), params: {} });
    expect(trySetWeather).not.toHaveBeenCalled();
    effect("effect.clear-weather", { keepExtreme: false }).run({ frame: frame(mon()), params: {} });
    expect(trySetWeather).toHaveBeenCalledWith(WeatherType.NONE);
  });

  it("cancel-recharge removes the tag and the NONE placeholder only", () => {
    const removeTag = vi.fn();
    const queue = [{ move: MoveId.NONE }, { move: MoveId.TACKLE }];
    effect("effect.cancel-recharge").run({ frame: frame(mon({ removeTag, getMoveQueue: () => queue })), params: {} });
    expect(removeTag).toHaveBeenCalledWith(BattlerTagType.RECHARGING);
    expect(queue).toEqual([{ move: MoveId.TACKLE }]);
  });

  it("remove-type: fallback setting and the Tera rule", () => {
    const target = mon({ getTypes: () => [PokemonType.GHOST], getTeraType: () => PokemonType.GHOST });
    effect("effect.remove-type", { who: "other", type: "GHOST", fallback: "NORMAL", teraRules: false }).run({
      frame: frame(mon(), { other: target as never }),
      params: {},
    });
    expect((target.summonData as { types: PokemonType[] }).types).toEqual([PokemonType.NORMAL]);
    const tera = effect("effect.remove-type", { who: "other", type: "GHOST" });
    expect(
      tera.feasible?.({ frame: frame(mon(), { other: { ...target, isTerastallized: true } as never }), params: {} }),
    ).toBe(false);
    expect(tera.feasible?.({ frame: frame(mon(), { other: target as never }), params: {} })).toBe(true);
  });

  it("stat-stage-on-highest: strict scan keeps the first on a tie, >= keeps the last", () => {
    const holder = mon({ getStat: () => 100 });
    let phases = scene();
    effect("effect.stat-stage-on-highest", { stats: "Attack, Sp. Atk" }).run({ frame: frame(holder), params: {} });
    expect(phases.unshiftNew.mock.calls[0]).toEqual(["StatStageChangePhase", 0, true, [Stat.ATK], 1]);
    phases = scene();
    effect("effect.stat-stage-on-highest", { stats: "Attack, Sp. Atk", tie: "last" }).run({
      frame: frame(holder),
      params: {},
    });
    expect(phases.unshiftNew.mock.calls[0]).toEqual(["StatStageChangePhase", 0, true, [Stat.SPATK], 1]);
  });

  it("set-marker / clear-marker: unique skips a duplicate, previews write nothing", () => {
    const holder = mon();
    const list = () => (holder.summonData as { erAbilityProvenance: string[] }).erAbilityProvenance;
    const at = { scope: "switch-in", key: "trap" };
    effect("effect.set-marker", at).run({ frame: frame(holder), params: {} });
    effect("effect.set-marker", at).run({ frame: frame(holder), params: {} });
    effect("effect.set-marker", { ...at, unique: true }).run({ frame: frame(holder), params: {} });
    effect("effect.set-marker", { ...at, key: "x" }).run({ frame: frame(holder, { simulated: true }), params: {} });
    expect(list()).toEqual(["trap", "trap"]);
    effect("effect.clear-marker", at).run({ frame: frame(holder), params: {} });
    expect(list()).toEqual([]);
  });

  it("marker defaults pair with the time.marker-set defaults (battle, marker)", () => {
    const holder = mon();
    effect("effect.set-marker").run({ frame: frame(holder), params: {} });
    expect((holder.battleData as { erAbilityProvenance: string[] }).erAbilityProvenance).toEqual(["marker"]);
  });

  it("change-charge-stacks uses the shared store (clamped at 4)", () => {
    const holder = mon();
    effect("effect.change-charge-stacks", { mode: "add", amount: 3 }).run({ frame: frame(holder), params: {} });
    effect("effect.change-charge-stacks", { mode: "add", amount: 3 }).run({ frame: frame(holder), params: {} });
    expect(getCharge(holder as never)).toBe(4);
    effect("effect.change-charge-stacks", { mode: "spend", amount: 1 }).run({ frame: frame(holder), params: {} });
    expect(getCharge(holder as never)).toBe(3);
    effect("effect.change-charge-stacks", { mode: "spend-all" }).run({ frame: frame(holder), params: {} });
    expect(getCharge(holder as never)).toBe(0);
    addCharge(holder as never, 1);
    clearCharge(holder as never);
  });

  it("drain-pp used-move is usePp (capped at max PP)", () => {
    const pokemonMove = {
      moveId: MoveId.TACKLE,
      ppUsed: 33,
      usePp(n: number) {
        this.ppUsed = Math.min(this.ppUsed + n, 35);
      },
    };
    const attacker = mon({ moveset: [pokemonMove] });
    const compiled = effect("effect.drain-pp", { amount: 4 });
    const f = frame(mon(), { other: attacker as never, move: { id: MoveId.TACKLE } as never });
    expect(compiled.feasible?.({ frame: f, params: {} })).toBe(true);
    compiled.run({ frame: f, params: {} });
    expect(pokemonMove.ppUsed).toBe(35);
  });

  it("scripted-move-at: first standing foe, power 0 = own power, nothing while previewing", () => {
    const foe = mon({ getBattlerIndex: () => 2 });
    const holder = mon({ getOpponents: () => [mon({ isFainted: () => true }), foe] });
    const phases = scene();
    const compiled = effect("effect.scripted-move-at", { moveId: "Spikes" });
    expect(compiled.feasible?.({ frame: frame(holder), params: {} })).toBe(true);
    compiled.run({ frame: frame(holder, { simulated: true }), params: {} });
    expect(phases.unshiftNew).not.toHaveBeenCalled();
    compiled.run({ frame: frame(holder), params: {} });
    expect(phases.unshiftNew.mock.calls[0][2]).toEqual([2]);
    expect(phases.unshiftNew.mock.calls[0][4]).toBe(MoveUseMode.INDIRECT);
  });

  it("remove-arena-tags: vetted names only, side of the other Pokemon", () => {
    const removeTagsOnSide = vi.fn();
    scene({ arena: { removeTagsOnSide, hasTag: () => true } });
    effect("effect.remove-arena-tags", { tags: "Reflect, Smokescreen", side: "target-side" }).run({
      frame: frame(mon(), { other: mon({ isPlayer: () => false }) as never }),
      params: {},
    });
    expect(removeTagsOnSide).toHaveBeenCalledWith(
      [ArenaTagType.REFLECT, ArenaTagType.ER_SMOKESCREEN],
      ArenaTagSide.ENEMY,
    );
    expect(() => effect("effect.remove-arena-tags", { tags: "Trick Room" })).toThrow(/may remove/);
  });

  it("every wave C effect compiles with its default settings", () => {
    const ids = [
      "effect.add-stat-share",
      "effect.multiply-stat",
      "effect.multiply-stat-per-fainted-ally",
      "effect.set-accuracy",
      "effect.ignore-secondary-effects",
      "effect.multiply-power-per-count",
      "effect.multiply-accuracy-per-count",
      "effect.use-weaker-defense",
      "effect.trap-foe",
      "effect.jump-turn-order",
      "effect.reflect-stat-drop",
      "effect.hit-n-times",
      "effect.scripted-move-at",
      "effect.cancel-recharge",
      "effect.remove-type",
      "effect.change-own-type",
      "effect.stat-stage-on-highest",
      "effect.drain-adjacent-foes",
      "effect.force-other-out",
      "effect.set-marker",
      "effect.clear-marker",
      "effect.change-charge-stacks",
      "effect.drain-pp",
      "effect.match-weather-form",
      "effect.give-ability",
      "effect.remove-arena-tags",
      "effect.clear-weather",
      "effect.reset-stat-stages",
      "effect.hurt-percent-of-max-hp",
      "effect.heal-fraction-of-max-hp",
      "effect.stat-stages",
      "effect.steal-item",
      "effect.message",
    ];
    for (const id of ids) {
      expect(getEffect(id)?.implemented, id).toBe(true);
      expect(() => effect(id), id).not.toThrow();
      // The default label as staff see it (choices in their player words) stays within the 60-character limit.
      const def = getEffect(id);
      const shown = (def?.label ?? "").replace(/\{([A-Za-z0-9_]+)\}/g, (_whole, key: string) => {
        const param = def?.params.find(p => p.id === key);
        const value = String(param?.default ?? "");
        return param?.optionLabels?.[value] ?? value;
      });
      expect(shown.length, `${id}: "${shown}"`).toBeLessThanOrEqual(60);
    }
  });
});

describe("Wave C review fixes (the real class as oracle where it can be)", () => {
  const hit = (holder: Fake, foe: Fake, useMode: MoveUseMode) =>
    frameFromAttrParams("event.after-my-hit", {
      pokemon: holder,
      opponent: foe,
      move: { id: MoveId.EMBER, power: 40 },
      useMode,
      simulated: false,
      damage: 10,
      hitResult: 1,
    });

  it("scripted-move-at never answers its own follow-up hit, for every aim", () => {
    const foe = mon({ getBattlerIndex: () => 2, getAdjacentAllies: () => [] });
    const holder = mon({ getOpponents: () => [foe] });
    for (const aim of ["first-living-foe", "every-living-foe", "holder", "move-targets", "neighbour-ally", "other"]) {
      const compiled = effect("effect.scripted-move-at", { moveId: "Ember", aim });
      for (const useMode of [MoveUseMode.INDIRECT, MoveUseMode.FOLLOW_UP]) {
        const f = hit(holder, foe, useMode);
        expect(compiled.feasible?.({ frame: f, params: { useMode } }), `${aim} from ${useMode}`).toBe(false);
      }
      const normal = hit(holder, foe, MoveUseMode.NORMAL);
      expect(compiled.feasible?.({ frame: normal, params: { useMode: MoveUseMode.NORMAL } }), aim).toBe(true);
    }
  });

  it("cure-status on my side equals PostSummonUserFieldRemoveStatusEffectAbAttr", () => {
    const run = (useClass: boolean) => {
      const asleep = mon({ id: 2, status: { effect: StatusEffect.SLEEP }, resetStatus: vi.fn() });
      const burned = mon({ id: 3, status: { effect: StatusEffect.BURN }, resetStatus: vi.fn() });
      const holder = mon({
        *getAlliesGenerator() {
          yield asleep;
          yield burned;
        },
      });
      const phases = scene({ getPlayerField: () => [{ isAllowedInBattle: () => true }] });
      if (useClass) {
        const cls = new PostSummonUserFieldRemoveStatusEffectAbAttr(StatusEffect.SLEEP, StatusEffect.POISON);
        const params = { pokemon: holder, simulated: false } as never;
        expect(cls.canApply(params)).toBe(true);
        cls.apply(params);
      } else {
        const compiled = effect("effect.cure-status", { scope: "my-side", statuses: "Sleep, Poison" });
        expect(compiled.feasible?.({ frame: frame(holder), params: {} })).toBe(true);
        compiled.run({ frame: frame(holder), params: {} });
      }
      return [
        phases.queueMessage.mock.calls,
        (asleep.resetStatus as Mock).mock.calls,
        (burned.resetStatus as Mock).mock.calls,
      ];
    };
    expect(run(false)).toEqual(run(true));
  });

  it("cure-status with ER ailments equals PreSwitchOutResetStatusAbAttr", () => {
    const run = (useClass: boolean) => {
      const holder = mon({
        resetStatus: vi.fn(),
        removeTag: vi.fn(),
        getTag: (t: BattlerTagType) => (t === BattlerTagType.ER_BLEED ? {} : undefined),
      });
      if (useClass) {
        const cls = new PreSwitchOutResetStatusAbAttr();
        const params = { pokemon: holder, simulated: false } as never;
        expect(cls.canApply(params)).toBe(true);
        cls.apply(params);
      } else {
        const compiled = effect("effect.cure-status", { alsoErAilments: true });
        expect(compiled.feasible?.({ frame: frame(holder), params: {} })).toBe(true);
        compiled.run({ frame: frame(holder), params: {} });
      }
      return [(holder.resetStatus as Mock).mock.calls, (holder.removeTag as Mock).mock.calls];
    };
    expect(run(false)).toEqual(run(true));
  });

  /** A held item the steal effects can find (`instanceof PokemonHeldItemModifier`). */
  function item(pokemonId: number, transferable: boolean, canTake: boolean): PokemonHeldItemModifier {
    const modifier = Object.create(PokemonHeldItemModifier.prototype) as PokemonHeldItemModifier;
    Object.defineProperty(modifier, "pokemonId", { value: pokemonId });
    Object.defineProperty(modifier, "isTransferable", { value: transferable });
    Object.defineProperty(modifier, "type", { value: { name: `item of ${pokemonId}` } });
    Object.defineProperty(modifier, "canTake", { value: canTake });
    return modifier;
  }

  function stealScene(items: PokemonHeldItemModifier[]) {
    const tryTransferHeldItemModifier = vi.fn(() => true);
    const phases = scene({
      findModifiers: (pred: (m: PokemonHeldItemModifier) => boolean) => items.filter(pred),
      canTransferHeldItemModifier: (m: { canTake: boolean }) => m.canTake,
      tryTransferHeldItemModifier,
    });
    return { tryTransferHeldItemModifier, phases };
  }

  it("steal-item from any foe equals VoidPostTurnStealAbAttr (one draw only when something can be taken)", () => {
    for (const items of [[item(2, true, true), item(3, true, false), item(3, true, true)], [item(2, false, true)]]) {
      const run = (useClass: boolean) => {
        const draws: number[] = [];
        const holder = mon({
          getOpponents: () => [mon({ id: 2 }), mon({ id: 3 })],
          randBattleSeedInt: (n: number) => {
            draws.push(n);
            return n - 1;
          },
        });
        const { tryTransferHeldItemModifier } = stealScene(items);
        if (useClass) {
          const cls = new VoidPostTurnStealAbAttr();
          const params = { pokemon: holder, simulated: false } as never;
          if (cls.canApply(params)) {
            cls.apply(params);
          }
        } else {
          const compiled = effect("effect.steal-item", { from: "any-foe" });
          if (compiled.feasible?.({ frame: frame(holder), params: {} })) {
            compiled.run({ frame: frame(holder), params: {} });
          }
        }
        return [draws, tryTransferHeldItemModifier.mock.calls.map(call => (call as unknown[])[0])];
      };
      expect(run(false)).toEqual(run(true));
    }
  });

  it("steal-item from the other Pokemon equals PostAttackStealHeldItemAbAttr (the check's draw is reused)", () => {
    for (const items of [[item(2, true, true), item(2, true, false)], [item(2, true, false)], []]) {
      const run = (useClass: boolean) => {
        const draws: number[] = [];
        const holder = mon({
          randBattleSeedInt: (n: number) => {
            draws.push(n);
            return 0;
          },
        });
        const foe = mon({ id: 2 });
        const { tryTransferHeldItemModifier, phases } = stealScene(items);
        const params = {
          pokemon: holder,
          opponent: foe,
          move: { category: 0 },
          hitResult: 1,
          simulated: false,
        } as never;
        if (useClass) {
          const cls = new PostAttackStealHeldItemAbAttr();
          if (cls.canApply(params)) {
            cls.apply(params);
          }
        } else {
          const compiled = effect("effect.steal-item", { from: "other" });
          const f = frame(holder, { other: foe as never });
          if (compiled.feasible?.({ frame: f, params: {} })) {
            compiled.run({ frame: f, params: {} });
          }
        }
        // The holder is a fresh fake per run, so compare the stolen item and the flag of each transfer.
        const transfers = tryTransferHeldItemModifier.mock.calls.map(call => [
          (call as unknown[])[0],
          (call as unknown[])[2],
        ]);
        return [draws, transfers, phases.queueMessage.mock.calls];
      };
      expect(run(false)).toEqual(run(true));
    }
  });

  it("hurt-percent-of-max-hp equals PostTurnHurtNonTypedAbAttr (spared types, fainted foes, the indirect-damage check)", () => {
    const run = (useClass: boolean) => {
      const foes = [
        mon({
          id: 2,
          isOfType: (t: PokemonType) => t === PokemonType.POISON,
          damageAndUpdate: vi.fn(),
          getMaxHp: () => 160,
          getActiveAbilitySources: vi.fn(() => []),
        }),
        mon({ id: 3, damageAndUpdate: vi.fn(), getMaxHp: () => 161, getActiveAbilitySources: vi.fn(() => []) }),
        mon({ id: 4, damageAndUpdate: vi.fn(), getMaxHp: () => 7, getActiveAbilitySources: vi.fn(() => []) }),
        mon({ id: 5, isFainted: () => true, damageAndUpdate: vi.fn(), getActiveAbilitySources: vi.fn(() => []) }),
      ];
      const holder = mon({ getOpponents: () => foes });
      const phases = scene();
      if (useClass) {
        const cls = new PostTurnHurtNonTypedAbAttr({ safeTypes: [PokemonType.POISON], damageFraction: 0.125 });
        const params = { pokemon: holder, simulated: false } as never;
        expect(cls.canApply(params)).toBe(true);
        cls.apply(params);
      } else {
        const compiled = effect("effect.hurt-percent-of-max-hp", { fraction: 0.125, sparedTypes: "Poison" });
        expect(compiled.feasible?.({ frame: frame(holder), params: {} })).toBe(true);
        compiled.run({ frame: frame(holder), params: {} });
      }
      return [
        foes.map(f => (f.damageAndUpdate as Mock).mock.calls),
        phases.queueMessage.mock.calls,
        foes.map(f => (f.getActiveAbilitySources as Mock).mock.calls.length),
      ];
    };
    const mine = run(false);
    expect(mine).toEqual(run(true));
    expect(mine[0]).toEqual([[], [[20, { result: expect.anything() }]], [[1, { result: expect.anything() }]], []]);
  });

  it("hurt-percent-of-max-hp does not start again from inside its own damage", () => {
    const compiled = effect("effect.hurt-percent-of-max-hp", { fraction: 0.125 });
    const inner = vi.fn();
    const foe = mon({
      damageAndUpdate: () => {
        // A PostDamage dispatch inside the damage re-enters the same block (two holders on "after taking damage").
        expect(compiled.feasible?.({ frame: frame(holder), params: {} })).toBe(false);
        compiled.run({ frame: frame(mon({ getOpponents: () => [mon({ damageAndUpdate: inner })] })), params: {} });
      },
    });
    const holder = mon({ getOpponents: () => [foe] });
    scene();
    compiled.run({ frame: frame(holder), params: {} });
    expect(inner).not.toHaveBeenCalled();
  });

  it("stat-stages on every adjacent foe with Intimidate rules equals PostSummonStatStageChangeAbAttr", () => {
    const run = (useClass: boolean) => {
      const foes = [
        mon({ id: 2, getBattlerIndex: () => 2, getTag: () => undefined, getActiveAbilitySources: vi.fn(() => []) }),
        mon({
          id: 4,
          getBattlerIndex: () => 4,
          getTag: (t: BattlerTagType) => (t === BattlerTagType.SUBSTITUTE ? {} : undefined),
          getActiveAbilitySources: vi.fn(() => []),
        }),
      ];
      const holder = mon({
        *getOpponentsGenerator() {
          yield* foes;
        },
      });
      const phases = scene();
      if (useClass) {
        new PostSummonStatStageChangeAbAttr([Stat.ATK], -1, false, true).apply({
          pokemon: holder,
          simulated: false,
        } as never);
      } else {
        effect("effect.stat-stages", {
          target: "every adjacent foe",
          stats: "Attack",
          stages: -1,
          intimidateRules: true,
        }).run({ frame: frame(holder), params: {} });
      }
      // Each foe's abilities are asked twice (IntimidateImmunity, then PostIntimidateStatStageChange), the Substitute
      // foe too; only the stat change of the Substitute foe is skipped.
      return [phases.unshiftNew.mock.calls, foes.map(f => (f.getActiveAbilitySources as Mock).mock.calls.length)];
    };
    const mine = run(false);
    expect(mine).toEqual(run(true));
    expect(mine[1]).toEqual([2, 2]);
  });

  it("force-other-out refuses a fainted other Pokemon", () => {
    const compiled = effect("effect.force-other-out");
    expect(
      compiled.feasible?.({ frame: frame(mon(), { other: mon({ isFainted: () => true }) as never }), params: {} }),
    ).toBe(false);
  });

  // The Unpack gates of Magician (170:0) and Scavenger (5083:1) in editor/data/gates.json carry exactly this `do`.
  const gateDo = [{ block: "effect.steal-item" }] as const;

  it("the steal-item gates resolve to `from: other` (Magician 170:0, Scavenger 5083:1)", () => {
    expect(getEffect(gateDo[0].block)?.params.find(p => p.id === "from")?.default).toBe("other");
  });

  it("Magician's unpacked do steals what ErMagicianStealAbAttr steals (the Pokemon it hit)", () => {
    for (const items of [[item(2, true, true), item(3, true, true)], [item(3, true, true)], [item(2, true, false)]]) {
      const run = (useClass: boolean) => {
        const draws: number[] = [];
        const foe = mon({ id: 2 });
        const holder = mon({
          getOpponents: () => [foe, mon({ id: 3 })],
          randBattleSeedInt: (n: number) => {
            draws.push(n);
            return 0;
          },
        });
        const { tryTransferHeldItemModifier, phases } = stealScene(items);
        const params = { pokemon: holder, opponent: foe, move: { category: 0 }, hitResult: 1, simulated: false };
        if (useClass) {
          const cls = new ErMagicianStealAbAttr();
          if (cls.residual(params as never)) {
            cls.apply(params as never);
          }
        } else {
          const compiled = compileEffect(gateDo[0]);
          const f = frameFromAttrParams("event.after-my-hit", params);
          if (compiled.feasible?.({ frame: f, params }) !== false) {
            compiled.run({ frame: f, params });
          }
        }
        const transfers = tryTransferHeldItemModifier.mock.calls.map(call => (call as unknown[])[0]);
        return [draws, transfers, phases.queueMessage.mock.calls];
      };
      expect(run(false)).toEqual(run(true));
    }
  });

  it("Scavenger's unpacked do loots what ScavengerLootAbAttr loots (the fainted victim)", () => {
    for (const items of [[item(2, true, true), item(3, true, true)], [item(3, true, true)], []]) {
      const run = (useClass: boolean) => {
        const draws: number[] = [];
        const victim = mon({ id: 2, isFainted: () => true });
        const holder = mon({
          getOpponents: () => [mon({ id: 3 })],
          randBattleSeedInt: (n: number) => {
            draws.push(n);
            return 0;
          },
        });
        const { tryTransferHeldItemModifier, phases } = stealScene(items);
        const params = { pokemon: holder, victim, simulated: false };
        if (useClass) {
          // The class's gate (the loot chance) is the rule's rng.chance IF; its residual and apply are the block.
          const cls = new ScavengerLootAbAttr({ chance: 1 });
          if (cls.residual(params as never)) {
            cls.apply(params as never);
          }
        } else {
          const compiled = compileEffect(gateDo[0]);
          const f = frameFromAttrParams("event.on-ko", params);
          expect(f.other).toBe(victim);
          if (compiled.feasible?.({ frame: f, params }) !== false) {
            compiled.run({ frame: f, params });
          }
        }
        const transfers = tryTransferHeldItemModifier.mock.calls.map(call => (call as unknown[])[0]);
        return [draws, transfers, phases.queueMessage.mock.calls];
      };
      expect(run(false)).toEqual(run(true));
    }
  });

  it("scripted-move-at on after-taking-damage refuses while the holder's own follow-up move is resolving", () => {
    const holder = mon({ getOpponents: () => [mon({ getBattlerIndex: () => 2 })] });
    const resolving = (user: Fake, useMode: MoveUseMode) => ({
      is: (name: string) => name === "MoveEffectPhase",
      getUserPokemon: () => user,
      useMode,
    });
    // PostDamageAbAttr passes no useMode (recoil, Rough Skin chip).
    const ask = (aim: string) =>
      effect("effect.scripted-move-at", { moveId: "Double-Edge", aim }).feasible?.({
        frame: frame(holder),
        params: {},
      });
    for (const aim of ["first-living-foe", "holder", "move-targets"]) {
      scene({}, resolving(holder, MoveUseMode.INDIRECT));
      expect(ask(aim), `${aim} own indirect`).toBe(false);
      scene({}, resolving(holder, MoveUseMode.FOLLOW_UP));
      expect(ask(aim), `${aim} own follow-up`).toBe(false);
      scene({}, resolving(holder, MoveUseMode.NORMAL));
      expect(ask(aim), `${aim} own normal move`).toBe(true);
      scene({}, resolving(mon(), MoveUseMode.INDIRECT));
      expect(ask(aim), `${aim} someone else's follow-up`).toBe(true);
      scene({}, { is: () => false });
      expect(ask(aim), `${aim} outside a move`).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// Twins: the same inputs go to the real class (its checks, then its apply) and to the compiled block (its safety checks,
// then its run), and the observable result is compared: state, queued phases and messages, random draws.

/** Battle objects in a recorded call, reduced to something two separate fake battles can compare. */
function plain(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(plain);
  }
  if (typeof value === "object" && value !== null && "getBattlerIndex" in value && "id" in value) {
    return `mon#${(value as { id: number }).id}`;
  }
  if (typeof value === "object" && value !== null && "moveId" in value) {
    return `move#${(value as { moveId: number }).moveId}`;
  }
  return value;
}

const calls = (fn: unknown): unknown => plain((fn as Mock).mock.calls);

describe("Twins: the real class and the compiled block on the same battle", () => {
  it("change-own-type twins PostAttackChangeTargetTypeAbAttr (a fixed type, the move's type, a preview)", () => {
    for (const [setting, classType] of [
      ["WATER", PokemonType.WATER],
      ["move-type", "moveType"],
    ] as const) {
      for (const simulated of [false, true]) {
        const run = (useClass: boolean) => {
          const target = mon({ id: 2 });
          const holder = mon({ getMoveType: () => PokemonType.FIRE });
          const params = { pokemon: holder, opponent: target, move: { id: MoveId.EMBER }, simulated, hitResult: 1 };
          if (useClass) {
            new PostAttackChangeTargetTypeAbAttr({ type: classType, contactOnly: false }).apply(params as never);
          } else {
            effect("effect.change-own-type", { who: "other", type: setting }).run({
              frame: frameFromAttrParams("event.after-my-hit", params),
              params,
            });
          }
          return [(target.summonData as { types: unknown }).types, calls(target.updateInfo)];
        };
        expect(run(false), `${setting} simulated ${simulated}`).toEqual(run(true));
      }
    }
  });

  it("remove-type twins both PostAttackRemoveTargetTypeAbAttr classes (Tera rules / UNKNOWN, plain / NORMAL)", () => {
    const targets = () => [
      mon({ id: 2, getTypes: () => [PokemonType.WATER, PokemonType.GHOST] }),
      mon({ id: 3, getTypes: () => [PokemonType.GHOST] }),
      mon({ id: 4, getTypes: () => [PokemonType.GHOST], isTerastallized: true, getTeraType: () => PokemonType.GHOST }),
    ];
    for (const index of [0, 1, 2]) {
      for (const simulated of [false, true]) {
        const abAttrs = (useClass: boolean) => {
          const target = targets()[index];
          const params = { pokemon: mon(), opponent: target, move: { category: 0 }, simulated };
          if (useClass) {
            const cls = new PostAttackRemoveTargetTypeAbAttr(PokemonType.GHOST);
            if (cls.residual(params as never)) {
              cls.apply(params as never);
            }
          } else {
            const compiled = effect("effect.remove-type", { who: "other", type: "GHOST" });
            const f = frameFromAttrParams("event.after-my-hit", params);
            if (compiled.feasible?.({ frame: f, params }) !== false) {
              compiled.run({ frame: f, params });
            }
          }
          return (target.summonData as { types: unknown }).types;
        };
        expect(abAttrs(false), `ab-attrs target ${index}`).toEqual(abAttrs(true));
        const archetype = (useClass: boolean) => {
          const target = targets()[index];
          const params = { pokemon: mon(), opponent: target, move: { category: 0 }, simulated };
          if (useClass) {
            new ArchetypeRemoveTargetTypeAbAttr({ type: PokemonType.GHOST }).apply(params as never);
          } else {
            effect("effect.remove-type", { who: "other", type: "GHOST", fallback: "NORMAL", teraRules: false }).run({
              frame: frameFromAttrParams("event.after-my-hit", params),
              params,
            });
          }
          return (target.summonData as { types: unknown }).types;
        };
        expect(archetype(false), `archetype target ${index}`).toEqual(archetype(true));
      }
    }
  });

  it("stat-stage-on-highest twins SelfHighestStatBoostOnSummonAbAttr and TypeImmunityHighestAttackStatStageAbAttr", () => {
    for (const [atk, spatk] of [
      [120, 90],
      [90, 120],
      [100, 100],
    ]) {
      for (const simulated of [false, true]) {
        const holder = mon({ getStat: (s: Stat, live: boolean) => (live ? -1 : s === Stat.ATK ? atk : spatk) });
        const summon = (useClass: boolean) => {
          const phases = scene();
          if (useClass) {
            new SelfHighestStatBoostOnSummonAbAttr({ candidates: [Stat.ATK, Stat.SPATK], stages: 1 }).apply({
              pokemon: holder,
              simulated,
            } as never);
          } else {
            effect("effect.stat-stage-on-highest", { stats: "Attack, Sp. Atk" }).run({
              frame: frame(holder, { simulated }),
              params: {},
            });
          }
          return calls(phases.unshiftNew);
        };
        expect(summon(false), `${atk}/${spatk}`).toEqual(summon(true));
        const immunity = (useClass: boolean) => {
          const phases = scene();
          if (useClass) {
            new TypeImmunityHighestAttackStatStageAbAttr({ immuneType: PokemonType.GROUND, stages: 1 }).apply({
              pokemon: holder,
              simulated,
              cancelled: { value: false },
              typeMultiplier: new NumberHolder(1),
            } as never);
          } else {
            effect("effect.stat-stage-on-highest", { stats: "Attack, Sp. Atk" }).run({
              frame: frame(holder, { simulated }),
              params: {},
            });
          }
          return calls(phases.unshiftNew);
        };
        expect(immunity(false), `immunity ${atk}/${spatk}`).toEqual(immunity(true));
      }
    }
  });

  it("drain-adjacent-foes twins PostTurnDrainAbAttr (fainted, trapped-only, previews)", () => {
    for (const onlyTrapped of [false, true]) {
      for (const simulated of [false, true]) {
        const run = (useClass: boolean) => {
          const foe = (id: number, maxHp: number, trapped: boolean, fainted = false) => {
            const f = mon({
              id,
              hp: fainted ? 0 : 50,
              getMaxHp: () => maxHp,
              isFainted: () => fainted,
              isTrapped: () => trapped,
              getBattlerIndex: () => id,
              getPostBattleAbilitySources: () => [],
            });
            f.damageAndUpdate = vi.fn((d: number) => {
              f.hp = Math.max(0, (f.hp as number) - d);
            });
            return f;
          };
          const foes = [foe(2, 160, true), foe(3, 9, false), foe(4, 100, true, true)];
          const holder = mon({
            getAdjacentOpponents: () => foes,
            getOpponents: () => foes,
            getAbility: () => ({ name: "Life Steal" }),
          });
          const phases = scene();
          const params = { pokemon: holder, simulated };
          if (useClass) {
            const cls = new PostTurnDrainAbAttr({ fraction: 0.125, onlyIfTrapped: onlyTrapped });
            if (cls.residual(params as never)) {
              cls.apply(params as never);
            }
          } else {
            const compiled = effect("effect.drain-adjacent-foes", { fraction: 0.125, onlyTrapped });
            if (compiled.feasible?.({ frame: frame(holder, { simulated }), params })) {
              compiled.run({ frame: frame(holder, { simulated }), params });
            }
          }
          return [foes.map(f => calls(f.damageAndUpdate)), calls(phases.unshiftNew)];
        };
        expect(run(false), `trapped ${onlyTrapped} simulated ${simulated}`).toEqual(run(true));
      }
    }
  });

  it("force-other-out twins PostDamageForceAttackerOutAbAttr (switch possible or not, preview)", () => {
    const condition = vi.spyOn(ForceSwitchOutHelper.prototype, "getSwitchOutCondition");
    const switchOut = vi.spyOn(ForceSwitchOutHelper.prototype, "switchOutLogic").mockReturnValue(true);
    try {
      for (const canSwitch of [true, false]) {
        for (const simulated of [false, true]) {
          condition.mockReturnValue(canSwitch);
          const run = (useClass: boolean) => {
            switchOut.mockClear();
            const holder = mon();
            const source = mon({ id: 2 });
            const params = { pokemon: holder, source, simulated, damage: 10 };
            if (useClass) {
              const cls = new PostDamageForceAttackerOutAbAttr();
              if (cls.residual(params as never)) {
                cls.apply(params as never);
              }
            } else {
              const compiled = effect("effect.force-other-out");
              const f = frame(holder, { other: source as never, simulated });
              if (compiled.feasible?.({ frame: f, params })) {
                compiled.run({ frame: f, params });
              }
            }
            return calls(switchOut);
          };
          expect(run(false), `switch ${canSwitch} simulated ${simulated}`).toEqual(run(true));
        }
      }
    } finally {
      condition.mockRestore();
      switchOut.mockRestore();
    }
  });

  it("match-weather-form twins PostSummonFormChangeByWeatherAbAttr (a form it can take, one it cannot, a preview)", () => {
    const species = 99_001;
    const forms = pokemonFormChanges as unknown as Record<number, unknown>;
    try {
      for (const canChange of [true, false]) {
        forms[species] = [{ findTrigger: () => true, canChange: () => canChange }];
        for (const simulated of [false, true]) {
          const run = (useClass: boolean) => {
            const trigger = vi.fn();
            scene({ triggerPokemonFormChange: trigger });
            const holder = mon({ species: { speciesId: species } });
            const params = { pokemon: holder, simulated };
            if (useClass) {
              const cls = new PostSummonFormChangeByWeatherAbAttr();
              if (cls.canApply(params as never)) {
                cls.apply(params as never);
              }
            } else {
              const compiled = effect("effect.match-weather-form");
              if (compiled.feasible?.({ frame: frame(holder, { simulated }), params })) {
                compiled.run({ frame: frame(holder, { simulated }), params });
              }
            }
            return calls(trigger);
          };
          expect(run(false), `change ${canChange} simulated ${simulated}`).toEqual(run(true));
        }
      }
    } finally {
      delete forms[species];
    }
  });

  it("give-ability twins PostAttackAbilityGiveAbAttr and PostDefendAbilityGiveAbAttr (residuals, Mummy rules, preview)", () => {
    const targets = () => [
      mon({ id: 2, getAbility: () => ({ suppressable: true, hasAttr: () => false }), hasAbility: () => false }),
      mon({ id: 3, getAbility: () => ({ suppressable: false, hasAttr: () => false }), hasAbility: () => false }),
      mon({
        id: 4,
        getAbility: () => ({ suppressable: true, hasAttr: (n: string) => n === "PostAttackAbilityGiveAbAttr" }),
        hasAbility: () => false,
      }),
      mon({
        id: 5,
        getAbility: () => ({ suppressable: true, hasAttr: (n: string) => n === "PostDefendAbilityGiveAbAttr" }),
        hasAbility: () => false,
      }),
      mon({
        id: 6,
        getAbility: () => ({ suppressable: true, hasAttr: () => false }),
        hasAbility: (id: AbilityId) => id === AbilityId.LINGERING_AROMA,
      }),
    ];
    for (const [giver, Cls] of [
      ["after-my-attack", PostAttackAbilityGiveAbAttr],
      ["when-hit", PostDefendAbilityGiveAbAttr],
    ] as const) {
      for (const index of [0, 1, 2, 3, 4]) {
        for (const simulated of [false, true]) {
          const run = (useClass: boolean) => {
            const target = targets()[index];
            target.setTempAbility = vi.fn();
            const params = { pokemon: mon(), opponent: target, simulated };
            if (useClass) {
              const cls = new Cls(AbilityId.MUMMY);
              if (cls.residual(params as never)) {
                cls.apply(params as never);
              }
            } else {
              const compiled = effect("effect.give-ability", { ability: "Mummy", giver });
              const f = frame(mon(), { other: target as never, simulated });
              if (compiled.feasible?.({ frame: f, params })) {
                compiled.run({ frame: f, params });
              }
            }
            return (target.setTempAbility as Mock).mock.calls.map(c => c[0] === allAbilities[AbilityId.MUMMY]);
          };
          expect(run(false), `${giver} target ${index} simulated ${simulated}`).toEqual(run(true));
        }
      }
    }
  });

  it("reset-stat-stages twins ClearOpponentStatBuffsOnSummonAbAttr (raised stats only, fainted foes, no foes)", () => {
    for (const foeCount of [0, 2]) {
      for (const simulated of [false, true]) {
        const run = (useClass: boolean) => {
          const foe = (id: number, fainted: boolean) => {
            const stages: number[] = [2, -1, 0, 1, -3, 0, 4];
            return mon({
              id,
              stages,
              isFainted: () => fainted,
              getStatStage: (s: Stat) => stages[s - 1],
              setStatStage: (s: Stat, v: number) => {
                stages[s - 1] = v;
              },
            });
          };
          const foes = [foe(2, false), foe(3, true)].slice(0, foeCount);
          const holder = mon({ getAdjacentOpponents: () => foes, getOpponents: () => foes });
          const params = { pokemon: holder, simulated };
          if (useClass) {
            const cls = new ClearOpponentStatBuffsOnSummonAbAttr();
            if (cls.canApply(params as never)) {
              cls.apply(params as never);
            }
          } else {
            const compiled = effect("effect.reset-stat-stages", { target: "adjacent-foes", onlyRaised: true });
            if (compiled.feasible?.({ frame: frame(holder, { simulated }), params })) {
              compiled.run({ frame: frame(holder, { simulated }), params });
            }
          }
          return foes.map(f => [f.stages, calls(f.updateInfo)]);
        };
        expect(run(false), `foes ${foeCount} simulated ${simulated}`).toEqual(run(true));
      }
    }
  });

  it("heal-fraction-of-max-hp twins PostSummonAllyHealAbAttr (active and inactive allies, animation, preview)", () => {
    for (const showAnimation of [false, true]) {
      for (const simulated of [false, true]) {
        const run = (useClass: boolean) => {
          const allies = [
            mon({ id: 2, getBattlerIndex: () => 2, isActive: () => true }),
            mon({ id: 3, getBattlerIndex: () => 3, isActive: () => false }),
          ];
          const holder = mon({ name: "Butter", getMaxHp: () => 203, getAdjacentAllies: () => allies });
          const phases = scene();
          const params = { pokemon: holder, simulated };
          if (useClass) {
            const cls = new PostSummonAllyHealAbAttr(4, showAnimation);
            if (cls.canApply(params as never)) {
              cls.apply(params as never);
            }
          } else {
            const compiled = effect("effect.heal-fraction-of-max-hp", {
              target: "adjacent-allies",
              denominator: 4,
              basedOn: "holder",
              showAnimation,
            });
            if (compiled.feasible?.({ frame: frame(holder, { simulated }), params })) {
              compiled.run({ frame: frame(holder, { simulated }), params });
            }
          }
          return calls(phases.unshiftNew);
        };
        expect(run(false), `animation ${showAnimation} simulated ${simulated}`).toEqual(run(true));
      }
    }
  });

  it("stat-stages twins PostSummonStatStageChangeAbAttr (me) and PostDefendStatStageChangeAbAttr (the other, every other adjacent)", () => {
    for (const simulated of [false, true]) {
      const holder = () =>
        mon({
          getAdjacentOpponents: () => [mon({ id: 2, getBattlerIndex: () => 2 })],
          getAdjacentAllies: () => [mon({ id: 3, getBattlerIndex: () => 1 })],
        });
      const cases: [Record<string, string | number | boolean>, (p: object) => void][] = [
        [
          { target: "me", stats: "Attack, Sp. Atk", stages: 1 },
          p => new PostSummonStatStageChangeAbAttr([Stat.ATK, Stat.SPATK], 1, true).apply(p as never),
        ],
        [
          { target: "the other Pokemon", stats: "Speed", stages: -1 },
          p => new PostDefendStatStageChangeAbAttr(() => true, Stat.SPD, -1, false).apply(p as never),
        ],
        [
          { target: "every other adjacent Pokemon", stats: "Speed", stages: -1 },
          p => new PostDefendStatStageChangeAbAttr(() => true, Stat.SPD, -1, false, true).apply(p as never),
        ],
      ];
      for (const [settings, classRun] of cases) {
        const run = (useClass: boolean) => {
          const phases = scene();
          const attacker = mon({ id: 9, getBattlerIndex: () => 3 });
          const params = { pokemon: holder(), opponent: attacker, simulated };
          if (useClass) {
            classRun(params);
          } else {
            effect("effect.stat-stages", settings).run({
              frame: frame(params.pokemon, { other: attacker as never, simulated }),
              params,
            });
          }
          return calls(phases.unshiftNew);
        };
        expect(run(false), `${settings.target} simulated ${simulated}`).toEqual(run(true));
      }
    }
  });

  it("message twins PostSummonMessageAbAttr (a built-in announcement) and PostSummonUnnamedMessageAbAttr (text)", () => {
    for (const simulated of [false, true]) {
      const run = (useClass: boolean, announced: boolean) => {
        const phases = scene();
        const params = { pokemon: mon(), simulated };
        if (useClass) {
          (announced
            ? new PostSummonMessageAbAttr(ANNOUNCEMENTS.PRESSURE.build())
            : new PostSummonUnnamedMessageAbAttr("Hello there")
          ).apply(params as never);
        } else {
          effect("effect.message", announced ? { announcement: "PRESSURE" } : { text: "Hello there" }).run({
            frame: frame(params.pokemon, { simulated }),
            params,
          });
        }
        return phases.queueMessage.mock.calls;
      };
      expect(run(false, true)).toEqual(run(true, true));
      expect(run(false, false)).toEqual(run(true, false));
    }
  });

  it("hit-n-times twins HitMultiplierAbAttr.apply", () => {
    for (const extraStrikes of [1, 2, 4]) {
      const theirs = new NumberHolder(1);
      new HitMultiplierAbAttr({ extraStrikes }).apply({ hitCount: theirs } as never);
      const mine = new NumberHolder(1);
      effect("effect.hit-n-times", { extraStrikes }).run({ frame: frame(mon()), params: { hitCount: mine } });
      expect(mine.value).toBe(theirs.value);
    }
  });

  it("trap-foe twins ArenaTrapAbAttr.apply", () => {
    const theirs = { value: false };
    new ArenaTrapAbAttr(() => true).apply({ trapped: theirs } as never);
    const mine = { value: false };
    effect("effect.trap-foe").run({ frame: frame(mon()), params: { trapped: mine } });
    expect(mine).toEqual(theirs);
  });

  it("jump-turn-order twins BypassSpeedChanceAbAttr (the chance roll is the rule's rng.chance IF)", () => {
    for (const canAdd of [true, false]) {
      for (const simulated of [false, true]) {
        const run = (useClass: boolean) => {
          const holder = mon({ addTag: vi.fn(), canAddTag: () => canAdd, randBattleSeedInt: () => 0 });
          scene({ currentBattle: { turnCommands: [{ move: { move: MoveId.TACKLE } }] } });
          const params = { pokemon: holder, simulated };
          if (useClass) {
            const cls = new BypassSpeedChanceAbAttr(100);
            if (cls.canApply(params as never)) {
              cls.apply(params as never);
            }
          } else {
            const compiled = effect("effect.jump-turn-order");
            if (compiled.feasible?.({ frame: frame(holder, { simulated }), params })) {
              compiled.run({ frame: frame(holder, { simulated }), params });
            }
          }
          return calls(holder.addTag);
        };
        expect(run(false), `can add ${canAdd} simulated ${simulated}`).toEqual(run(true));
      }
    }
  });

  it("clear-weather twins EntryTailwindClearWeatherAbAttr (keep extreme) and PostSummonClearWeatherAbAttr (any)", () => {
    const weathers = [
      undefined,
      { weatherType: WeatherType.NONE, isImmutable: () => false },
      { weatherType: WeatherType.RAIN, isImmutable: () => false },
      { weatherType: WeatherType.HEAVY_RAIN, isImmutable: () => true },
    ];
    for (const [index, weather] of weathers.entries()) {
      for (const simulated of [false, true]) {
        for (const keepExtreme of [true, false]) {
          const run = (useClass: boolean) => {
            const trySetWeather = vi.fn();
            scene({ arena: { weather, trySetWeather, addTag: vi.fn() } });
            const params = { pokemon: mon(), simulated };
            if (useClass) {
              const cls = keepExtreme ? new EntryTailwindClearWeatherAbAttr() : new PostSummonClearWeatherAbAttr();
              if (cls.canApply(params as never)) {
                cls.apply(params as never);
              }
            } else {
              const compiled = effect("effect.clear-weather", { keepExtreme });
              if (compiled.feasible?.({ frame: frame(params.pokemon, { simulated }), params }) !== false) {
                compiled.run({ frame: frame(params.pokemon, { simulated }), params });
              }
            }
            return trySetWeather.mock.calls;
          };
          expect(run(false), `weather ${index} keep ${keepExtreme} simulated ${simulated}`).toEqual(run(true));
        }
      }
    }
  });

  it("cancel-recharge twins PostVictoryClearRechargeAbAttr.apply", () => {
    for (const simulated of [false, true]) {
      const run = (useClass: boolean) => {
        const queue = [{ move: MoveId.NONE }, { move: MoveId.TACKLE }];
        const holder = mon({ removeTag: vi.fn(), getMoveQueue: () => queue });
        const params = { pokemon: holder, simulated };
        if (useClass) {
          new PostVictoryClearRechargeAbAttr().apply(params as never);
        } else {
          effect("effect.cancel-recharge").run({ frame: frame(holder, { simulated }), params });
        }
        return [calls(holder.removeTag), queue];
      };
      expect(run(false)).toEqual(run(true));
    }
  });

  it("clear-marker twins BallasterResetAbAttr; set-marker `unique` twins claimSummonAbilityProvenance", () => {
    const reset = (useClass: boolean) => {
      const holder = mon();
      (holder.summonData as { erAbilityProvenance: string[] }).erAbilityProvenance = [
        "ballaster:1",
        "x",
        "ballaster:1",
      ];
      if (useClass) {
        new BallasterResetAbAttr().apply({ pokemon: holder, simulated: false } as never);
      } else {
        effect("effect.clear-marker", { scope: "switch-in", key: "ballaster:1" }).run({
          frame: frame(holder),
          params: {},
        });
      }
      return (holder.summonData as { erAbilityProvenance: string[] }).erAbilityProvenance;
    };
    expect(reset(false)).toEqual(reset(true));
    const claim = (useClass: boolean) => {
      const holder = mon();
      for (let i = 0; i < 2; i++) {
        if (useClass) {
          claimSummonAbilityProvenance(holder as never, "booby-trap:entry");
        } else {
          effect("effect.set-marker", { scope: "switch-in", key: "booby-trap:entry", unique: true }).run({
            frame: frame(holder),
            params: {},
          });
        }
      }
      return (holder.summonData as { erAbilityProvenance: string[] }).erAbilityProvenance;
    };
    expect(claim(false)).toEqual(claim(true));
  });

  it("remove-arena-tags twins PostSummonRemoveArenaTagAbAttr (each side mode) and BreakScreensOnAttackAbAttr", () => {
    for (const present of [true, false]) {
      for (const simulated of [false, true]) {
        for (const [sideMode, side] of [
          ["own", "holder-side"],
          ["opponent", "opposing-side"],
          ["both", "both"],
        ] as const) {
          const run = (useClass: boolean) => {
            const arena = { hasTag: vi.fn(() => present), removeTagsOnSide: vi.fn() };
            scene({ arena });
            const params = { pokemon: mon(), simulated };
            if (useClass) {
              const cls = new PostSummonRemoveArenaTagAbAttr(
                [ArenaTagType.REFLECT, ArenaTagType.LIGHT_SCREEN],
                sideMode,
              );
              if (cls.canApply(params as never)) {
                cls.apply(params as never);
              }
            } else {
              const compiled = effect("effect.remove-arena-tags", { tags: "Reflect, Light Screen", side });
              if (compiled.feasible?.({ frame: frame(params.pokemon, { simulated }), params })) {
                compiled.run({ frame: frame(params.pokemon, { simulated }), params });
              }
            }
            return arena.removeTagsOnSide.mock.calls;
          };
          expect(run(false), `${sideMode} present ${present} simulated ${simulated}`).toEqual(run(true));
        }
      }
      const screens = (useClass: boolean) => {
        const arena = { hasTag: vi.fn(() => present), removeTagsOnSide: vi.fn() };
        scene({ arena });
        const opponent = mon({ id: 2, isPlayer: () => false });
        const params = { pokemon: mon(), opponent, simulated: false };
        if (useClass) {
          new BreakScreensOnAttackAbAttr().apply(params as never);
        } else {
          effect("effect.remove-arena-tags", { side: "target-side", onlyWhenPresent: false }).run({
            frame: frame(params.pokemon, { other: opponent as never }),
            params,
          });
        }
        return arena.removeTagsOnSide.mock.calls;
      };
      expect(screens(false)).toEqual(screens(true));
    }
  });

  it("another-holder-keeps-weather (with 'the weather is X') twins PreLeaveFieldClearWeatherAbAttr.canApply", () => {
    for (const weatherType of [WeatherType.HEAVY_RAIN, WeatherType.SUNNY]) {
      for (const otherKeeps of [WeatherType.HEAVY_RAIN, WeatherType.HARSH_SUN, undefined] as const) {
        const cls = new PreLeaveFieldClearWeatherAbAttr(WeatherType.HEAVY_RAIN);
        const holder = mon({ getAbilityAttrs: () => [cls] });
        const other = mon({
          id: 2,
          getAbilityAttrs: () => (otherKeeps === undefined ? [] : [new PreLeaveFieldClearWeatherAbAttr(otherKeeps)]),
        });
        scene({ arena: { weatherType }, getField: () => [holder, other] });
        const theirs = cls.canApply({ pokemon: holder, simulated: false } as never);
        const mine =
          weatherType === WeatherType.HEAVY_RAIN && evaluateGuard("another-holder-keeps-weather", frame(holder));
        expect(mine, `${weatherType} other ${otherKeeps}`).toBe(theirs);
      }
    }
  });

  it("drain-pp twins PpReductionOnContactAbAttr, OnFaintEffectAbAttr (attacker PP drain) and FoulHarvestAbAttr", () => {
    for (const ppUsed of [0, 33, 35]) {
      for (const simulated of [false, true]) {
        const spite = (useClass: boolean) => {
          const moveset = [new PokemonMove(MoveId.TACKLE, ppUsed)];
          const attacker = mon({ id: 2, moveset, getMoveset: () => moveset });
          const params = { pokemon: mon(), opponent: attacker, move: allMoves[MoveId.TACKLE], simulated, hitResult: 1 };
          if (useClass) {
            const cls = new PpReductionOnContactAbAttr({ reduction: 4 });
            if (cls.residual(params as never)) {
              cls.apply(params as never);
            }
          } else {
            const compiled = effect("effect.drain-pp", { which: "used-move", amount: 4 });
            const f = frameFromAttrParams("event.after-hit", params);
            if (compiled.feasible?.({ frame: f, params })) {
              compiled.run({ frame: f, params });
            }
          }
          return moveset.map(m => m.ppUsed);
        };
        expect(spite(false), `spite ${ppUsed} ${simulated}`).toEqual(spite(true));
        const illWill = (useClass: boolean) => {
          const moveset = [new PokemonMove(MoveId.TACKLE, ppUsed)];
          const attacker = mon({ id: 2, moveset, getMoveset: () => moveset });
          const dispatchEvent = vi.fn();
          const phases = scene({ eventTarget: { dispatchEvent } });
          const params = { pokemon: mon(), attacker, move: allMoves[MoveId.TACKLE], simulated };
          if (useClass) {
            const cls = new OnFaintEffectAbAttr({ effect: { kind: "attacker-pp-drain" } } as never);
            if (cls.residual(params as never)) {
              cls.apply(params as never);
            }
          } else {
            const compiled = effect("effect.drain-pp", { which: "used-move-all" });
            const f = frameFromAttrParams("event.faint", params);
            if (compiled.feasible?.({ frame: f, params })) {
              compiled.run({ frame: f, params });
            }
          }
          return [moveset.map(m => m.ppUsed), dispatchEvent.mock.calls.length, phases.queueMessage.mock.calls];
        };
        expect(illWill(false), `ill will ${ppUsed} ${simulated}`).toEqual(illWill(true));
      }
    }
    for (const recorded of [true, false]) {
      const foul = (useClass: boolean) => {
        const draws: number[] = [];
        const moveset = [new PokemonMove(MoveId.TACKLE, 0), new PokemonMove(MoveId.EMBER, 0)];
        const opponent = mon({ id: 2, moveset, getMoveset: () => moveset, getNameToRender: () => "Foe" });
        if (recorded) {
          recordSignatureExecutedMove(opponent as never, allMoves[MoveId.EMBER]);
        }
        const holder = mon({
          getNameToRender: () => "Me",
          getLastXMoves: () => [{}],
          randBattleSeedInt: (n: number) => {
            draws.push(n);
            return 0;
          },
        });
        const phases = scene();
        const params = { pokemon: holder, opponent, simulated: false };
        if (useClass) {
          new FoulHarvestAbAttr(undefined, undefined, 3).apply(params as never);
        } else {
          effect("effect.drain-pp", { which: "last-used-else-random", amount: 3 }).run({
            frame: frame(holder, { other: opponent as never }),
            params,
          });
        }
        // The class also stores a Foul Harvest charge and says so; that second message is the class's own memory.
        return [draws, moveset.map(m => m.ppUsed), phases.queueMessage.mock.calls[0]];
      };
      expect(foul(false), `recorded ${recorded}`).toEqual(foul(true));
    }
  });

  it("multiply-accuracy-per-count twins FanFavoriteAccuracyAbAttr (guard, bench counts 0 to 6)", () => {
    for (const benched of [0, 1, 5, 6]) {
      for (const start of [0, 80]) {
        const run = (useClass: boolean) => {
          const holder = mon();
          const bench = Array.from({ length: benched }, (_, i) => mon({ id: 10 + i, isOnField: () => false }));
          scene({ getPlayerParty: () => [holder, ...bench] });
          const accuracy = new NumberHolder(start);
          const params = { pokemon: holder, accuracy, move: { id: MoveId.TACKLE } };
          if (useClass) {
            const cls = new FanFavoriteAccuracyAbAttr(5, 5);
            // guards, then the gate (at least one benched teammate: the rule's IF), then apply.
            if (cls.guards(params as never) && cls.gate(params as never)) {
              cls.apply(params as never);
            }
          } else {
            const compiled = effect("effect.multiply-accuracy-per-count");
            if (compiled.feasible?.({ frame: frame(holder), params }) && livingBenchCount(holder as never, 5) > 0) {
              compiled.run({ frame: frame(holder), params });
            }
          }
          return accuracy.value;
        };
        expect(run(false), `bench ${benched} accuracy ${start}`).toBe(run(true));
      }
    }
  });

  it("scripted-move-at twins PostSummonScriptedMoveAbAttr (first foe, every foe, myself; no foe standing)", () => {
    for (const [opts, aim] of [
      [{}, "first-living-foe"],
      [{ allOpponents: true }, "every-living-foe"],
      [{ targetsSelf: true }, "holder"],
    ] as const) {
      for (const standing of [true, false]) {
        const run = (useClass: boolean) => {
          const foes = [
            mon({ id: 2, getBattlerIndex: () => 2, isFainted: () => true }),
            mon({ id: 3, getBattlerIndex: () => 3, isFainted: () => !standing }),
          ];
          const holder = mon({ getOpponents: () => foes });
          const phases = scene();
          const params = { pokemon: holder, simulated: false };
          if (useClass) {
            const cls = new PostSummonScriptedMoveAbAttr({ moveId: MoveId.SPIKES, power: 20, ...opts });
            if (cls.residual(params as never)) {
              cls.apply(params as never);
            }
          } else {
            const compiled = effect("effect.scripted-move-at", { moveId: "Spikes", power: 20, aim });
            if (compiled.feasible?.({ frame: frame(holder), params })) {
              compiled.run({ frame: frame(holder), params });
            }
          }
          return calls(phases.unshiftNew);
        };
        expect(run(false), `${aim} standing ${standing}`).toEqual(run(true));
      }
    }
  });

  it("multiply-power-per-count twins FanFavoritePowerAbAttr (bench) and HeavyweightPowerAbAttr (weight classes)", () => {
    for (const benched of [0, 1, 5, 6]) {
      const run = (useClass: boolean) => {
        const holder = mon();
        const bench = Array.from({ length: benched }, (_, i) => mon({ id: 10 + i, isOnField: () => false }));
        scene({ getPlayerParty: () => [holder, ...bench] });
        const power = new NumberHolder(80);
        const params = { pokemon: holder, power };
        if (useClass) {
          const cls = new FanFavoritePowerAbAttr(5, 5);
          if (cls.residual(params as never)) {
            cls.apply(params as never);
          }
        } else {
          const compiled = effect("effect.multiply-power-per-count", {
            counter: "benched-teammates",
            percent: 5,
            max: 5,
          });
          if (compiled.feasible?.({ frame: frame(holder), params })) {
            compiled.run({ frame: frame(holder), params });
          }
        }
        return power.value;
      };
      expect(run(false), `bench ${benched}`).toBe(run(true));
    }
    for (const [mine, theirs] of [
      [200, 10],
      [10, 200],
      [25, 24.9],
      [1000, 1],
    ]) {
      const run = (useClass: boolean) => {
        const user = mon({ getWeight: () => mine });
        const target = mon({ id: 2, getWeight: () => theirs });
        const power = new NumberHolder(100);
        const params = { pokemon: user, opponent: target, power };
        if (useClass) {
          new HeavyweightPowerAbAttr(10, 5).apply(params as never);
        } else {
          effect("effect.multiply-power-per-count", { counter: "weight-classes", percent: 10, max: 5 }).run({
            frame: frame(user, { other: target as never }),
            params,
          });
        }
        return power.value;
      };
      expect(run(false), `${mine} vs ${theirs}`).toBe(run(true));
    }
  });
});

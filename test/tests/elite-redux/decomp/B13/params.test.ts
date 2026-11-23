/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B13 chunk 1, review fix: the numbers that used to be literals inside the classes (quash turns, fog weather and turns,
// power and damage multipliers, PP drained, charge caps, power per charge) are now trailing constructor arguments.
// Two things are proven here through the live attrs and real battle state:
//   1. the DEFAULTS reproduce the old literals exactly (the shipped abilities build the attrs with no arguments), and
//   2. a different argument really changes the effect (so a recomposed rule can edit it).
import { globalScene } from "#app/global-scene";
import { allMoves } from "#data/data-lists";
import {
  FinalSeasonEntryAbAttr,
  FinalSeasonFogAbAttr,
  FinalSeasonPowerAbAttr,
  FoulHarvestAbAttr,
  foulHarvestCharges,
  markGenuineVoluntaryEntry,
  PorousChargeAbAttr,
  PorousPowerAbAttr,
  type PorousResetAbAttr,
  PorousSoundReductionAbAttr,
  porousCharges,
} from "#data/elite-redux/abilities/newcomer-signature-mechanics";
import { buildAttr } from "#data/elite-redux/ability-studio/build-attr";
import { declRegistry } from "#data/elite-redux/ability-studio/decl-registry";
import { BattlerIndex } from "#enums/battler-index";
import { BattlerTagType } from "#enums/battler-tag-type";
import { HitResult } from "#enums/hit-result";
import { MoveId } from "#enums/move-id";
import { MoveResult } from "#enums/move-result";
import { MoveUseMode } from "#enums/move-use-mode";
import { WeatherType } from "#enums/weather-type";
import type { Pokemon } from "#field/pokemon";
import { startWorld } from "#test/tests/elite-redux/decomp/harness/game";
import { liveAbility } from "#test/tests/elite-redux/decomp/harness/twin";
import { NumberHolder } from "#utils/common";
import Phaser from "phaser";
import { beforeAll, describe, expect, it } from "vitest";

const FINAL_SEASON = 5972;
const FOUL_HARVEST = 5973;
const POROUS = 5974;

const base = (holder: Pokemon, simulated = false) => ({ pokemon: holder, simulated }) as never;

describe("B13 chunk 1 review fix: constructor params keep the old values as defaults", () => {
  let phaserGame: Phaser.Game;
  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  it("the shipped instances carry the old literals", () => {
    const fs = liveAbility(FINAL_SEASON).attrs as [
      FinalSeasonEntryAbAttr,
      FinalSeasonFogAbAttr,
      FinalSeasonPowerAbAttr,
    ];
    expect(fs[0].quashTag).toBe(BattlerTagType.ER_QUASHED);
    expect(fs[0].quashTurns).toBe(2);
    expect(fs[1].fogWeather).toBe(WeatherType.EERIE_FOG);
    expect(fs[1].fogTurns).toBe(5);
    expect((fs[2] as unknown as { powerMultiplier: number }).powerMultiplier).toBe(1.3);
    const foul = liveAbility(FOUL_HARVEST).attrs[0] as FoulHarvestAbAttr;
    expect(foul.ppDrain).toBe(1);
    expect(foul.maxCharges).toBe(3);
    const porous = liveAbility(POROUS).attrs;
    expect((porous[1] as unknown as { damageMultiplier: number }).damageMultiplier).toBe(0.5);
    expect((porous[2] as PorousChargeAbAttr).maxCharges).toBe(3);
    expect((porous[3] as PorousPowerAbAttr).percentPerCharge).toBe(25);
  });

  it("Final Season: the entry effect follows its tag and turns (default: 2 turns of quash on every foe)", async () => {
    const { holder, foe } = await startWorld(phaserGame);
    const original = liveAbility(FINAL_SEASON).attrs[0] as FinalSeasonEntryAbAttr;
    markGenuineVoluntaryEntry(holder);
    original.apply(base(holder));
    expect(foe.getTag(BattlerTagType.ER_QUASHED)?.turnCount).toBe(2);
    foe.removeTag(BattlerTagType.ER_QUASHED);

    const longer = new FinalSeasonEntryAbAttr(BattlerTagType.ER_QUASHED, 4);
    markGenuineVoluntaryEntry(holder);
    expect(longer.canApply(base(holder))).toBe(true);
    longer.apply(base(holder));
    expect(foe.getTag(BattlerTagType.ER_QUASHED)?.turnCount).toBe(4);
  });

  it("Final Season: the fog attr follows its weather and turns, and the power attr follows its multiplier", async () => {
    const { game, holder } = await startWorld(phaserGame);
    const { attrs } = liveAbility(FINAL_SEASON);
    const [entry, fog, power] = attrs as [FinalSeasonEntryAbAttr, FinalSeasonFogAbAttr, FinalSeasonPowerAbAttr];
    markGenuineVoluntaryEntry(holder);
    entry.apply(base(holder));
    fog.apply(base(holder));
    expect(game.scene.arena.weatherType).toBe(WeatherType.EERIE_FOG);
    expect(game.scene.arena.weather?.turnsLeft).toBe(5);

    const foe = holder.getOpponents()[0];
    const powerParams = (): never =>
      ({
        pokemon: holder,
        opponent: foe,
        move: allMoves[MoveId.BITE],
        power: new NumberHolder(100),
        simulated: false,
      }) as never;
    const defaultCall = powerParams();
    expect(power.canApply(defaultCall)).toBe(true);
    power.apply(defaultCall);
    expect((defaultCall as { power: NumberHolder }).power.value).toBeCloseTo(130);

    const stronger = new FinalSeasonPowerAbAttr(2);
    const strongCall = powerParams();
    expect(stronger.canApply(strongCall)).toBe(true);
    stronger.apply(strongCall);
    expect((strongCall as { power: NumberHolder }).power.value).toBeCloseTo(200);

    // A different weather and length: the same gate (armed by the entry effect), another weather.
    globalScene.arena.trySetWeather(WeatherType.NONE);
    const rainy = new FinalSeasonFogAbAttr(WeatherType.RAIN, 3);
    markGenuineVoluntaryEntry(holder);
    entry.apply(base(holder));
    expect(rainy.canApply(base(holder))).toBe(true);
    rainy.apply(base(holder));
    expect(game.scene.arena.weatherType).toBe(WeatherType.RAIN);
    expect(game.scene.arena.weather?.turnsLeft).toBe(3);
  });

  it("Foul Harvest: drains 1 PP and caps at 3 by default; a different drain and cap are followed", async () => {
    const { game, holder, foe } = await startWorld(phaserGame);
    foe.getMoveset();
    game.override.enemyMoveset([]);
    const splash = foe.getMoveset()[0];
    const holderUses = (): void =>
      holder.pushMoveHistory({
        move: MoveId.TACKLE,
        targets: [BattlerIndex.ENEMY],
        useMode: MoveUseMode.NORMAL,
        result: MoveResult.SUCCESS,
      });
    const hit = (): never =>
      ({
        pokemon: holder,
        opponent: foe,
        move: allMoves[MoveId.TACKLE],
        damage: 10,
        hitResult: HitResult.EFFECTIVE,
        simulated: false,
      }) as never;

    const original = liveAbility(FOUL_HARVEST).attrs[0] as FoulHarvestAbAttr;
    const before = splash.ppUsed;
    holderUses();
    original.apply(hit());
    expect(splash.ppUsed).toBe(before + 1);
    expect(foulHarvestCharges(holder)).toBe(1);

    // A fresh holder state is not available, so the new attr is judged by the counter it adds to: cap 1 stops at 1.
    const capped = new FoulHarvestAbAttr(undefined, undefined, 2, 1);
    holderUses();
    capped.apply(hit());
    expect(splash.ppUsed).toBe(before + 1 + 2);
    expect(foulHarvestCharges(holder)).toBe(1);

    // And the default constructor still takes the base class's default attack condition (damaging moves only).
    const status = { ...(hit() as object), move: allMoves[MoveId.SWORDS_DANCE] } as never;
    holderUses();
    expect(original.canApply(status)).toBe(false);
    expect(original.canApply(hit())).toBe(true);
  });

  it("Porous: the multipliers, the per-charge percent and the cap follow their arguments", async () => {
    const { holder, foe } = await startWorld(phaserGame);
    const [reset, sound, charge, power] = liveAbility(POROUS).attrs as [
      PorousResetAbAttr,
      PorousSoundReductionAbAttr,
      PorousChargeAbAttr,
      PorousPowerAbAttr,
    ];
    const foeUses = (): void =>
      foe.pushMoveHistory({
        move: MoveId.TACKLE,
        targets: [BattlerIndex.PLAYER],
        useMode: MoveUseMode.NORMAL,
        result: MoveResult.SUCCESS,
      });
    const hit = (): never =>
      ({
        pokemon: holder,
        opponent: foe,
        move: allMoves[MoveId.TACKLE],
        damage: 10,
        hitResult: HitResult.EFFECTIVE,
        simulated: false,
      }) as never;
    const powerParams = (): never =>
      ({
        pokemon: holder,
        opponent: foe,
        move: allMoves[MoveId.EARTHQUAKE],
        power: new NumberHolder(100),
        simulated: false,
      }) as never;
    const soundParams = (): never =>
      ({
        pokemon: holder,
        opponent: foe,
        move: allMoves[MoveId.HYPER_VOICE],
        damage: new NumberHolder(100),
        simulated: false,
      }) as never;

    // Sound reduction: 0.5 by default, 0.25 with another argument.
    const quarter = new PorousSoundReductionAbAttr(0.25);
    const a = soundParams();
    const b = soundParams();
    sound.apply(a);
    quarter.apply(b);
    expect((a as { damage: NumberHolder }).damage.value).toBe(50);
    expect((b as { damage: NumberHolder }).damage.value).toBe(25);

    // Cap: the shipped charge attr stops at 3, a cap-2 attr stops at 2.
    reset.apply(base(holder));
    for (let i = 0; i < 5; i++) {
      foeUses();
      charge.apply(hit());
    }
    expect(porousCharges(holder)).toBe(3);
    reset.apply(base(holder));
    const capTwo = new PorousChargeAbAttr(2);
    for (let i = 0; i < 5; i++) {
      foeUses();
      capTwo.apply(hit());
    }
    expect(porousCharges(holder)).toBe(2);

    // Power: 25% per charge by default (2 charges -> 150), 50% per charge with another argument (2 charges -> 200).
    const fifty = new PorousPowerAbAttr(50);
    const c = powerParams();
    fifty.apply(c);
    expect((c as { power: NumberHolder }).power.value).toBeCloseTo(200);
    expect(porousCharges(holder)).toBe(0);
    reset.apply(base(holder));
    for (let i = 0; i < 2; i++) {
      foeUses();
      charge.apply(hit());
    }
    const d = powerParams();
    expect(power.canApply(d)).toBe(true);
    power.apply(d);
    expect((d as { power: NumberHolder }).power.value).toBeCloseTo(150);
  });

  it("the declarations expose these values as params that read back from a live instance and can be rebuilt", () => {
    const cases: [string, Record<string, number | string>][] = [
      ["FinalSeasonEntryAbAttr", { tag: "ER_QUASHED", turns: 2 }],
      ["FinalSeasonFogAbAttr", { weather: "EERIE_FOG", turns: 5 }],
      ["FinalSeasonPowerAbAttr", { multiplier: 1.3 }],
      ["FoulHarvestAbAttr", { ppDrain: 1, maxCharges: 3 }],
      ["PorousSoundReductionAbAttr", { multiplier: 0.5 }],
      ["PorousChargeAbAttr", { maxCharges: 3 }],
      ["PorousPowerAbAttr", { percentPerCharge: 25 }],
    ];
    for (const [name, defaults] of cases) {
      const module = declRegistry.get(name)!;
      expect(Object.fromEntries(module.decl.params.map(p => [p.id, p.default])), name).toEqual(defaults);
      // Built with the defaults, the attr is the same class and a live instance reads the defaults back through each
      // param's path (through its codec where the constructor argument is an enum).
      const attr = buildAttr(module, {}, {
        gate: () => true,
        "ctor:0": { block: "move.damaging", params: {} },
      } as never) as unknown as Record<string, unknown>;
      expect(attr.constructor.name, name).toBe(name);
      for (const param of module.decl.params) {
        const raw = attr[param.path as string];
        expect(param.codec?.fromInstance(raw) ?? raw, `${name}.${param.id}`).toBe(param.default);
      }
    }
  });
});

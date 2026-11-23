/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B13 chunk 1: Final Season (5972). The L1 grid and the L2 twin start a plain battle, where nothing is armed and no
// fog exists, so they can only prove the NEGATIVE side of these three attrs. These probes drive the real state flow
// (deliberate switch-in flag -> quash -> armed fog -> end-of-turn fog -> own-fog power boost) and compare each attr
// with its rebuild from the declaration.
import type { AbAttr } from "#abilities/ab-attrs";
import { globalScene } from "#app/global-scene";
import { allMoves } from "#data/data-lists";
import {
  type FinalSeasonEntryAbAttr,
  type FinalSeasonFogAbAttr,
  type FinalSeasonPowerAbAttr,
  markGenuineVoluntaryEntry,
} from "#data/elite-redux/abilities/newcomer-signature-mechanics";
import { buildAttr, recomposeAttr } from "#data/elite-redux/ability-studio/build-attr";
import { declRegistry } from "#data/elite-redux/ability-studio/decl-registry";
import { BattlerTagType } from "#enums/battler-tag-type";
import { MoveId } from "#enums/move-id";
import { WeatherType } from "#enums/weather-type";
import type { Pokemon } from "#field/pokemon";
import { startWorld } from "#test/tests/elite-redux/decomp/harness/game";
import { liveAbility } from "#test/tests/elite-redux/decomp/harness/twin";
import { NumberHolder } from "#utils/common";
import Phaser from "phaser";
import { beforeAll, describe, expect, it } from "vitest";

const FINAL_SEASON = 5972;

function module(name: string) {
  const found = declRegistry.get(name);
  expect(found, `${name} must be declared`).toBeDefined();
  return found!;
}

describe("B13 Final Season", () => {
  let phaserGame: Phaser.Game;
  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  const attrs = (): { entry: FinalSeasonEntryAbAttr; fog: FinalSeasonFogAbAttr; power: FinalSeasonPowerAbAttr } => {
    const list = liveAbility(FINAL_SEASON).attrs;
    return {
      entry: list[0] as FinalSeasonEntryAbAttr,
      fog: list[1] as FinalSeasonFogAbAttr,
      power: list[2] as FinalSeasonPowerAbAttr,
    };
  };

  const base = (holder: Pokemon, simulated = false) => ({ pokemon: holder, simulated }) as never;

  it("the entry attr fires only after a deliberate switch; a replaced gate replaces exactly that clause", async () => {
    const { holder, foe } = await startWorld(phaserGame);
    const { entry } = attrs();
    expect(entry.canApply(base(holder))).toBe(false);
    markGenuineVoluntaryEntry(holder);
    expect(entry.canApply(base(holder))).toBe(true);

    // The gate slot is the only clause: always-true opens it, always-false closes it, whatever the flag says.
    const open = buildAttr(module("FinalSeasonEntryAbAttr"), {}, { gate: () => true });
    const shut = buildAttr(module("FinalSeasonEntryAbAttr"), {}, { gate: () => false });
    expect(open.canApply(base(holder))).toBe(true);
    expect(shut.canApply(base(holder))).toBe(false);

    // A simulated call does nothing to the foes (and, an oddity recorded in the notes, still spends the flag).
    entry.apply(base(holder, true));
    expect(foe.getTag(BattlerTagType.ER_QUASHED)).toBeUndefined();
    expect(entry.canApply(base(holder))).toBe(false);

    markGenuineVoluntaryEntry(holder);
    entry.apply(base(holder));
    expect(foe.getTag(BattlerTagType.ER_QUASHED)).toBeDefined();
    expect(entry.canApply(base(holder))).toBe(false);
  });

  it("the fog attr fires only once armed, sets Eerie Fog and spends the arming", async () => {
    const { game, holder } = await startWorld(phaserGame);
    const { entry, fog } = attrs();
    expect(fog.canApply(base(holder))).toBe(false);
    markGenuineVoluntaryEntry(holder);
    entry.apply(base(holder));
    expect(fog.canApply(base(holder))).toBe(true);
    fog.apply(base(holder));
    expect(game.scene.arena.weatherType).toBe(WeatherType.EERIE_FOG);
    expect(fog.canApply(base(holder))).toBe(false);
  });

  it("the power attr equals its rebuild with a fog of its own, in other weather, and against a fog it did not set", async () => {
    const { holder } = await startWorld(phaserGame);
    const { entry, fog, power } = attrs();
    const rebuilt = recomposeAttr(module("FinalSeasonPowerAbAttr"), power, FINAL_SEASON, 2) as AbAttr;
    expect(rebuilt).not.toBe(power);
    const foeOf = holder.getOpponents()[0];
    const params = (moveId: MoveId, value = 100): never =>
      ({
        pokemon: holder,
        opponent: foeOf,
        move: allMoves[moveId],
        power: new NumberHolder(value),
        simulated: false,
      }) as never;
    const both = (moveId: MoveId): [boolean, boolean] => [
      power.canApply(params(moveId)),
      rebuilt.canApply(params(moveId)),
    ];

    // No fog yet: nothing is boosted.
    for (const move of [MoveId.BITE, MoveId.WING_ATTACK, MoveId.TACKLE, MoveId.EARTHQUAKE]) {
      expect(both(move)).toEqual([false, false]);
    }

    // The holder's own fog: Dark and Flying moves only.
    markGenuineVoluntaryEntry(holder);
    entry.apply(base(holder));
    fog.apply(base(holder));
    expect(globalScene.arena.weatherType).toBe(WeatherType.EERIE_FOG);
    expect(both(MoveId.BITE)).toEqual([true, true]);
    expect(both(MoveId.WING_ATTACK)).toEqual([true, true]);
    expect(both(MoveId.TACKLE)).toEqual([false, false]);
    expect(both(MoveId.EARTHQUAKE)).toEqual([false, false]);

    // The multiplier is the base class's 1.3 and is the same for the rebuild.
    const a = params(MoveId.BITE, 100);
    const b = params(MoveId.BITE, 100);
    power.apply(a);
    rebuilt.apply(b);
    expect((a as { power: NumberHolder }).power.value).toBeCloseTo(130);
    expect((b as { power: NumberHolder }).power.value).toBeCloseTo(130);

    // The gate (weather and move types) can be replaced; the "my own fog" guard stays in front of it.
    const anyMove = buildAttr(module("FinalSeasonPowerAbAttr"), {}, { gate: () => true });
    expect(anyMove.canApply(params(MoveId.TACKLE))).toBe(true);

    // Another weather replaces the fog: the owner clause no longer holds, so even an always-true gate fails.
    globalScene.arena.trySetWeather(WeatherType.NONE);
    globalScene.arena.trySetWeather(WeatherType.RAIN);
    for (const move of [MoveId.BITE, MoveId.WING_ATTACK]) {
      expect(both(move)).toEqual([false, false]);
    }
    expect(anyMove.canApply(params(MoveId.BITE))).toBe(false);
    // A second Eerie Fog that the holder did not set (no owner call) is a different weather instance: still false.
    globalScene.arena.trySetWeather(WeatherType.EERIE_FOG);
    expect(globalScene.arena.weatherType).toBe(WeatherType.EERIE_FOG);
    expect(both(MoveId.BITE)).toEqual([false, false]);
    expect(anyMove.canApply(params(MoveId.BITE))).toBe(false);
  });
});

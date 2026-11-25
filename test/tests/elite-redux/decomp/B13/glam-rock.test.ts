/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B13 chunk 2: Glam Rock (5975) and Sediment Bloom (5976). The grid has no hazards on the field, so these probes put
// real hazards on the holder's side and compare the gate with its rebuild, then follow the layer-eating effect and the
// Bloom's end-of-turn drain with the marker's divisor.
import type { AbAttr } from "#abilities/ab-attrs";
import { globalScene } from "#app/global-scene";
import {
  type GlamRockAbAttr,
  processSedimentBlooms,
  type SedimentBloomMarkerAbAttr,
} from "#data/elite-redux/abilities/newcomer-signature-mechanics";
import { buildAttr, recomposeAttr } from "#data/elite-redux/ability-studio/build-attr";
import { declRegistry } from "#data/elite-redux/ability-studio/decl-registry";
import { ArenaTagSide } from "#enums/arena-tag-side";
import { ArenaTagType } from "#enums/arena-tag-type";
import { Stat } from "#enums/stat";
import type { Pokemon } from "#field/pokemon";
import { startWorld } from "#test/tests/elite-redux/decomp/harness/game";
import { liveAbility } from "#test/tests/elite-redux/decomp/harness/twin";
import Phaser from "phaser";
import { beforeAll, describe, expect, it, vi } from "vitest";

const GLAM_ROCK = 5975;
const SEDIMENT_BLOOM = 5976;

function module(name: string) {
  const found = declRegistry.get(name);
  expect(found, `${name} must be declared`).toBeDefined();
  return found!;
}

const HAZARD_TYPES = [
  ArenaTagType.SPIKES,
  ArenaTagType.TOXIC_SPIKES,
  ArenaTagType.STEALTH_ROCK,
  ArenaTagType.STICKY_WEB,
  ArenaTagType.HOT_COALS,
  ArenaTagType.FOAMY_WEB,
  ArenaTagType.CREEPING_THORNS,
  ArenaTagType.ER_INFESTATION_TRAP,
];

describe("B13 Glam Rock and Sediment Bloom", () => {
  let phaserGame: Phaser.Game;
  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  const base = (holder: Pokemon, simulated = false) => ({ pokemon: holder, simulated }) as never;
  const layers = (type: ArenaTagType, side = ArenaTagSide.PLAYER): number | undefined =>
    (globalScene.arena.getTagOnSide(type, side) as { layers?: number } | undefined)?.layers;
  const addHazard = (type: ArenaTagType, holder: Pokemon, side = ArenaTagSide.PLAYER): void => {
    globalScene.arena.addTag(type, 0, undefined, holder.id, side, true);
  };

  it("the gate is 'any entry hazard on MY side' (all eight, not the foes' side), and the rebuild agrees", async () => {
    const { holder } = await startWorld(phaserGame);
    const original = liveAbility(GLAM_ROCK).attrs[1] as GlamRockAbAttr;
    const rebuilt = recomposeAttr(module("GlamRockAbAttr"), original, GLAM_ROCK, 1) as AbAttr;
    expect(rebuilt).not.toBe(original);
    const both = (): [boolean, boolean] => [original.canApply(base(holder)), rebuilt.canApply(base(holder))];
    expect(both()).toEqual([false, false]);
    // A hazard on the foes' side does not count.
    addHazard(ArenaTagType.SPIKES, holder, ArenaTagSide.ENEMY);
    expect(both()).toEqual([false, false]);
    for (const type of HAZARD_TYPES) {
      addHazard(type, holder);
      expect([type, both()]).toEqual([type, [true, true]]);
      globalScene.arena.removeTagOnSide(type, ArenaTagSide.PLAYER, true);
      expect([type, "removed", both()]).toEqual([type, "removed", [false, false]]);
    }
    // The gate is replaceable (here: always open).
    const open = buildAttr(module("GlamRockAbAttr"), {}, { gate: () => true });
    expect(open.canApply(base(holder))).toBe(true);
  });

  it("eats one layer of the first hazard in the class's order and raises Defense and Sp. Def; params change both", async () => {
    const { game, holder } = await startWorld(phaserGame);
    const original = liveAbility(GLAM_ROCK).attrs[1] as GlamRockAbAttr;
    const queued = vi.spyOn(game.scene.phaseManager, "unshiftNew").mockImplementation((() => {}) as never);
    for (let i = 0; i < 3; i++) {
      addHazard(ArenaTagType.SPIKES, holder);
    }
    addHazard(ArenaTagType.STEALTH_ROCK, holder);
    expect(layers(ArenaTagType.SPIKES)).toBe(3);

    original.apply(base(holder, true));
    expect(layers(ArenaTagType.SPIKES)).toBe(3);
    expect(queued).not.toHaveBeenCalled();

    original.apply(base(holder));
    expect(layers(ArenaTagType.SPIKES)).toBe(2);
    expect(queued).toHaveBeenLastCalledWith(
      "StatStageChangePhase",
      holder.getBattlerIndex(),
      true,
      [Stat.DEF, Stat.SPDEF],
      1,
    );
    original.apply(base(holder));
    original.apply(base(holder));
    // Spikes are gone, Stealth Rock is still there and is the next one eaten.
    expect(globalScene.arena.getTagOnSide(ArenaTagType.SPIKES, ArenaTagSide.PLAYER)).toBeUndefined();
    expect(globalScene.arena.getTagOnSide(ArenaTagType.STEALTH_ROCK, ArenaTagSide.PLAYER)).toBeDefined();
    original.apply(base(holder));
    expect(globalScene.arena.getTagOnSide(ArenaTagType.STEALTH_ROCK, ArenaTagSide.PLAYER)).toBeUndefined();

    // Params: 2 layers per turn and 2 stages.
    for (let i = 0; i < 3; i++) {
      addHazard(ArenaTagType.SPIKES, holder);
    }
    const custom = buildAttr(module("GlamRockAbAttr"), { layersRemoved: 2, stages: 2 }, { gate: () => true });
    custom.apply(base(holder));
    expect(layers(ArenaTagType.SPIKES)).toBe(1);
    expect(queued).toHaveBeenLastCalledWith(
      "StatStageChangePhase",
      holder.getBattlerIndex(),
      true,
      [Stat.DEF, Stat.SPDEF],
      2,
    );
    custom.apply(base(holder));
    expect(globalScene.arena.getTagOnSide(ArenaTagType.SPIKES, ArenaTagSide.PLAYER)).toBeUndefined();
    queued.mockRestore();
  });

  it("the Bloom drains max(1, floor(maxHp / divisor)) from each foe; the planter's marker sets the divisor (default 16)", async () => {
    const { holder, foe } = await startWorld(phaserGame);
    expect((liveAbility(SEDIMENT_BLOOM).attrs[0] as SedimentBloomMarkerAbAttr).drainDivisor).toBe(16);
    const custom = buildAttr(module("SedimentBloomMarkerAbAttr"), { drainDivisor: 8 }) as SedimentBloomMarkerAbAttr;
    expect(custom.drainDivisor).toBe(8);
    // The planter is the player's holder; the Bloom sits on the enemy side and drains the enemy field.
    globalScene.arena.addTag(ArenaTagType.SEDIMENT_BLOOM, 0, undefined, holder.id, ArenaTagSide.ENEMY, true);
    const lostWith = (attrs: SedimentBloomMarkerAbAttr[]): number => {
      const spy = vi.spyOn(holder, "getAllActiveAbilityAttrs").mockReturnValue(attrs as never);
      const before = foe.hp;
      processSedimentBlooms();
      spy.mockRestore();
      return before - foe.hp;
    };
    const maxHp = foe.getMaxHp();
    expect(lostWith([])).toBe(Math.max(1, Math.floor(maxHp / 16)));
    expect(lostWith([custom])).toBe(Math.max(1, Math.floor(maxHp / 8)));
  });
});

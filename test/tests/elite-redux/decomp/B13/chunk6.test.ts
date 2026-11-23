/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B13 chunk 6: the three marker classes Living Chrome (5980, attr 0), Cracked Vessel (5992, attr 0) and Superego (5994, attr 0). Each
// one is a flag that the engine finds by name, so the shared L1/L2 suites cannot reach its rule. These tests call the real rule
// functions (recordLivingChromeTransformation, tryCrackedVessel, applySuperegoAfterBoost) with and without the marker, prove the old
// literals are the defaults of the new constructor arguments, and prove that a different argument changes the effect.
import type { AbAttr } from "#abilities/ab-attrs";
import { globalScene } from "#app/global-scene";
import {
  applySuperegoAfterBoost,
  type CrackedVesselMarkerAbAttr,
  type LivingChromeMarkerAbAttr,
  recordLivingChromeTransformation,
  tryCrackedVessel,
} from "#data/elite-redux/abilities/newcomer-signature-mechanics";
import { buildAttr } from "#data/elite-redux/ability-studio/build-attr";
import { declRegistry } from "#data/elite-redux/ability-studio/decl-registry";
import { PokemonType } from "#enums/pokemon-type";
import { Stat } from "#enums/stat";
import { StatusEffect } from "#enums/status-effect";
import { WeatherType } from "#enums/weather-type";
import { startWorld } from "#test/tests/elite-redux/decomp/harness/game";
import { liveAbility } from "#test/tests/elite-redux/decomp/harness/twin";
import Phaser from "phaser";
import { beforeAll, describe, expect, it, vi } from "vitest";

const LIVING_CHROME = 5980;
const CRACKED_VESSEL = 5992;
const SUPEREGO = 5994;

function module(name: string) {
  const found = declRegistry.get(name);
  expect(found, `${name} must be declared`).toBeDefined();
  return found!;
}

describe("B13 chunk 6", () => {
  let phaserGame: Phaser.Game;
  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  it("the shipped instances carry the old literals, which are the defaults of the new constructor arguments", () => {
    expect((liveAbility(LIVING_CHROME).attrs[0] as LivingChromeMarkerAbAttr).maxMemoriesPerWave).toBe(3);
    const cracked = liveAbility(CRACKED_VESSEL).attrs[0] as CrackedVesselMarkerAbAttr;
    expect([cracked.typesLost, cracked.fogWeather, cracked.fogTurns, cracked.adjacentStatus]).toEqual([
      1,
      WeatherType.EERIE_FOG,
      4,
      StatusEffect.TOXIC,
    ]);
    expect(liveAbility(SUPEREGO).attrs).toHaveLength(1);
  });

  describe("Living Chrome marker", () => {
    it("remembers the types I leave, only with the marker and at most three times a wave", async () => {
      const { holder } = await startWorld(phaserGame);
      const messages = vi.spyOn(globalScene.phaseManager, "queueMessage").mockImplementation(() => undefined);
      const marker = liveAbility(LIVING_CHROME).attrs[0];
      const attrs = vi.spyOn(holder, "getAllActiveAbilityAttrs").mockReturnValue([] as never);
      recordLivingChromeTransformation(holder, [PokemonType.FIRE], 0);
      expect(messages).not.toHaveBeenCalled(); // no marker: nothing
      attrs.mockReturnValue([marker] as never);
      for (let i = 0; i < 3; i++) {
        recordLivingChromeTransformation(holder, [PokemonType.FIRE, PokemonType.FIRE, PokemonType.WATER], 1);
      }
      expect(messages).toHaveBeenCalledTimes(3);
      recordLivingChromeTransformation(holder, [PokemonType.FIRE], 1);
      expect(messages).toHaveBeenCalledTimes(3); // the fourth in the same wave is refused
      vi.restoreAllMocks();
    });

    it("a different limit changes how many memories a wave allows (and the shipped default is 3)", async () => {
      const { holder, foe } = await startWorld(phaserGame);
      const messages = vi.spyOn(globalScene.phaseManager, "queueMessage").mockImplementation(() => undefined);
      const one = buildAttr(module("LivingChromeMarkerAbAttr"), { maxMemoriesPerWave: 1 }, {}) as LivingChromeMarkerAbAttr;
      const five = buildAttr(module("LivingChromeMarkerAbAttr"), { maxMemoriesPerWave: 5 }, {}) as LivingChromeMarkerAbAttr;
      expect([one.maxMemoriesPerWave, five.maxMemoriesPerWave]).toEqual([1, 5]);
      vi.spyOn(holder, "getAllActiveAbilityAttrs").mockReturnValue([one] as never);
      vi.spyOn(foe, "getAllActiveAbilityAttrs").mockReturnValue([five] as never);
      for (let i = 0; i < 6; i++) {
        recordLivingChromeTransformation(holder, [PokemonType.FIRE], 0);
        recordLivingChromeTransformation(foe, [PokemonType.FIRE], 0);
      }
      expect(messages).toHaveBeenCalledTimes(1 + 5);
      vi.restoreAllMocks();
    });

    it("the limit starts again in the next wave", async () => {
      const { holder } = await startWorld(phaserGame);
      const messages = vi.spyOn(globalScene.phaseManager, "queueMessage").mockImplementation(() => undefined);
      vi.spyOn(holder, "getAllActiveAbilityAttrs").mockReturnValue([liveAbility(LIVING_CHROME).attrs[0]] as never);
      for (let i = 0; i < 4; i++) {
        recordLivingChromeTransformation(holder, [PokemonType.FIRE], 0);
      }
      expect(messages).toHaveBeenCalledTimes(3);
      const battle = globalScene.currentBattle;
      const wave = battle.waveIndex;
      battle.waveIndex = wave + 1;
      recordLivingChromeTransformation(holder, [PokemonType.FIRE], 0);
      expect(messages).toHaveBeenCalledTimes(4);
      battle.waveIndex = wave;
      vi.restoreAllMocks();
    });
  });

  describe("Cracked Vessel marker", () => {
    function setup(holder: any, foe: any, ally: any, marker: AbAttr) {
      vi.spyOn(globalScene.phaseManager, "queueMessage").mockImplementation(() => undefined);
      const weather = vi.spyOn(globalScene.arena, "trySetWeather").mockReturnValue(true);
      vi.spyOn(holder, "updateInfo").mockImplementation(() => undefined as never);
      vi.spyOn(holder, "getAllActiveAbilityAttrs").mockReturnValue([marker] as never);
      vi.spyOn(holder, "getAdjacentAllies").mockReturnValue([ally]);
      vi.spyOn(holder, "getAdjacentOpponents").mockReturnValue([foe]);
      const foeStatus = vi.spyOn(foe, "trySetStatus").mockReturnValue(true as never);
      return { weather, foeStatus };
    }

    it("with the shipped values: loses the last type, sets Eerie Fog for 4 turns and badly poisons the neighbours", async () => {
      const { holder, foe } = await startWorld(phaserGame);
      const allyStatus = vi.fn().mockReturnValue(true);
      const { weather, foeStatus } = setup(holder, foe, { trySetStatus: allyStatus }, liveAbility(CRACKED_VESSEL).attrs[0]);
      vi.spyOn(holder, "getTypes").mockReturnValue([PokemonType.NORMAL, PokemonType.FAIRY]);
      expect(tryCrackedVessel(holder, undefined)).toBe(false); // no attacker
      expect(weather).not.toHaveBeenCalled();
      expect(tryCrackedVessel(holder, foe)).toBe(true);
      expect(holder.summonData.types).toEqual([PokemonType.NORMAL]);
      expect(weather).toHaveBeenCalledWith(WeatherType.EERIE_FOG, holder, 4);
      expect(allyStatus).toHaveBeenCalledWith(StatusEffect.TOXIC, holder, undefined, null, false, false);
      expect(foeStatus).toHaveBeenCalledWith(StatusEffect.TOXIC, holder, undefined, null, false, false);
      expect(tryCrackedVessel(holder, foe)).toBe(false); // once per wave
      vi.restoreAllMocks();
    });

    it("a single type leaves the Unknown type, and without the marker nothing happens", async () => {
      const { holder, foe } = await startWorld(phaserGame);
      const { weather } = setup(holder, foe, { trySetStatus: vi.fn() }, liveAbility(CRACKED_VESSEL).attrs[0]);
      vi.spyOn(holder, "getTypes").mockReturnValue([PokemonType.GHOST]);
      vi.spyOn(holder, "getAllActiveAbilityAttrs").mockReturnValue([] as never);
      expect(tryCrackedVessel(holder, foe)).toBe(false);
      expect(weather).not.toHaveBeenCalled();
      vi.spyOn(holder, "getAllActiveAbilityAttrs").mockReturnValue([liveAbility(CRACKED_VESSEL).attrs[0]] as never);
      expect(tryCrackedVessel(holder, foe)).toBe(true);
      expect(holder.summonData.types).toEqual([PokemonType.UNKNOWN]);
      vi.restoreAllMocks();
    });

    it("different arguments change the lost types, the weather, its length and the status", async () => {
      const { holder, foe } = await startWorld(phaserGame);
      const custom = buildAttr(
        module("CrackedVesselMarkerAbAttr"),
        { typesLost: 2, fogWeather: "Rain", fogTurns: 7, adjacentStatus: "Burned" },
        {},
      ) as CrackedVesselMarkerAbAttr;
      expect([custom.typesLost, custom.fogWeather, custom.fogTurns, custom.adjacentStatus]).toEqual([
        2,
        WeatherType.RAIN,
        7,
        StatusEffect.BURN,
      ]);
      const allyStatus = vi.fn().mockReturnValue(true);
      const { weather, foeStatus } = setup(holder, foe, { trySetStatus: allyStatus }, custom);
      vi.spyOn(holder, "getTypes").mockReturnValue([PokemonType.NORMAL, PokemonType.FAIRY, PokemonType.GHOST]);
      expect(tryCrackedVessel(holder, foe)).toBe(true);
      expect(holder.summonData.types).toEqual([PokemonType.NORMAL]);
      expect(weather).toHaveBeenCalledWith(WeatherType.RAIN, holder, 7);
      expect(allyStatus).toHaveBeenCalledWith(StatusEffect.BURN, holder, undefined, null, false, false);
      expect(foeStatus).toHaveBeenCalledWith(StatusEffect.BURN, holder, undefined, null, false, false);
      vi.restoreAllMocks();
    });
  });

  describe("Superego marker", () => {
    it("takes a foe's raise once per stat per turn, only with the marker and only for a copyable boost", async () => {
      const { holder, foe } = await startWorld(phaserGame);
      const messages = vi.spyOn(globalScene.phaseManager, "queueMessage").mockImplementation(() => undefined);
      vi.spyOn(foe, "getOpponents").mockReturnValue([holder]);
      const attrs = vi.spyOn(holder, "getAllActiveAbilityAttrs").mockReturnValue([] as never);
      holder.setStatStage(Stat.ATK, 0);
      foe.setStatStage(Stat.ATK, 2);
      applySuperegoAfterBoost(foe, Stat.ATK, true);
      expect([holder.getStatStage(Stat.ATK), foe.getStatStage(Stat.ATK)]).toEqual([0, 2]); // no marker
      attrs.mockReturnValue([liveAbility(SUPEREGO).attrs[0]] as never);
      applySuperegoAfterBoost(foe, Stat.ATK, false);
      expect([holder.getStatStage(Stat.ATK), foe.getStatStage(Stat.ATK)]).toEqual([0, 2]); // a copied boost
      applySuperegoAfterBoost(foe, Stat.ATK, true);
      expect([holder.getStatStage(Stat.ATK), foe.getStatStage(Stat.ATK)]).toEqual([2, 0]); // seized
      expect(messages).toHaveBeenCalledTimes(1);
      foe.setStatStage(Stat.ATK, 4);
      applySuperegoAfterBoost(foe, Stat.ATK, true);
      expect([holder.getStatStage(Stat.ATK), foe.getStatStage(Stat.ATK)]).toEqual([2, 4]); // same stat, same turn
      foe.setStatStage(Stat.DEF, 1);
      applySuperegoAfterBoost(foe, Stat.DEF, true);
      expect([holder.getStatStage(Stat.DEF), foe.getStatStage(Stat.DEF)]).toEqual([1, 0]); // another stat is fine
      vi.restoreAllMocks();
    });

    it("does nothing when the foe does not end above me, and works again on the next turn", async () => {
      const { holder, foe } = await startWorld(phaserGame);
      vi.spyOn(globalScene.phaseManager, "queueMessage").mockImplementation(() => undefined);
      vi.spyOn(foe, "getOpponents").mockReturnValue([holder]);
      vi.spyOn(holder, "getAllActiveAbilityAttrs").mockReturnValue([liveAbility(SUPEREGO).attrs[0]] as never);
      holder.setStatStage(Stat.SPD, 3);
      foe.setStatStage(Stat.SPD, 3);
      applySuperegoAfterBoost(foe, Stat.SPD, true);
      expect([holder.getStatStage(Stat.SPD), foe.getStatStage(Stat.SPD)]).toEqual([3, 3]); // equal: not above me
      foe.setStatStage(Stat.SPD, 5);
      applySuperegoAfterBoost(foe, Stat.SPD, true);
      expect([holder.getStatStage(Stat.SPD), foe.getStatStage(Stat.SPD)]).toEqual([5, 3]);
      foe.setStatStage(Stat.SPD, 6);
      applySuperegoAfterBoost(foe, Stat.SPD, true);
      expect([holder.getStatStage(Stat.SPD), foe.getStatStage(Stat.SPD)]).toEqual([5, 6]); // used this turn
      const battle = globalScene.currentBattle;
      const turn = battle.turn;
      battle.turn = turn + 1;
      applySuperegoAfterBoost(foe, Stat.SPD, true);
      expect([holder.getStatStage(Stat.SPD), foe.getStatStage(Stat.SPD)]).toEqual([6, 5]); // next turn
      battle.turn = turn;
      vi.restoreAllMocks();
    });
  });

  it("the declarations are engine-query markers of the always-on moment with the expected parameters", () => {
    expect(module("LivingChromeMarkerAbAttr").decl.params.map(p => p.id)).toEqual(["maxMemoriesPerWave"]);
    expect(module("CrackedVesselMarkerAbAttr").decl.params.map(p => p.id)).toEqual([
      "typesLost",
      "fogWeather",
      "fogTurns",
      "adjacentStatus",
    ]);
    expect(module("SuperegoMarkerAbAttr").decl.params).toEqual([]);
    for (const name of ["LivingChromeMarkerAbAttr", "CrackedVesselMarkerAbAttr", "SuperegoMarkerAbAttr"]) {
      expect(module(name).decl.kind).toBe("engine-query");
      expect(module(name).decl.when).toBe("while.active");
    }
  });
});

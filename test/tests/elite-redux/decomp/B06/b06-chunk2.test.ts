/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B06 chunk 2: what the shared L1 and L2 suites cannot see. Every test drives the ORIGINAL attr of a real ability and its REBUILD
// (recomposeAttr from the declaration and the bindings) side by side. Classes: PostBiomeChangeWeatherChangeAbAttr,
// PostBiomeChangeTerrainChangeAbAttr (the engine only asks them after a biome change, which no shared scenario reaches),
// PostDancingMoveAbAttr (the residual clauses and a swapped gate), PreventBerryUseAbAttr (the engine asks it when a FOE eats a
// berry, which no shared scenario has), FullBurnDamageImmunityAbAttr, BypassBurnDamageReductionAbAttr, StatStageChangeMultiplierAbAttr
// and DoubleBerryEffectAbAttr (their real call sites).
import type {
  BypassBurnDamageReductionAbAttr,
  DoubleBerryEffectAbAttr,
  FullBurnDamageImmunityAbAttr,
  PostBiomeChangeTerrainChangeAbAttr,
  PostBiomeChangeWeatherChangeAbAttr,
  PostDancingMoveAbAttr,
  PreventBerryUseAbAttr,
  StatStageChangeMultiplierAbAttr,
} from "#abilities/ab-attrs";
import { globalScene } from "#app/global-scene";
import { recomposeAttr } from "#data/elite-redux/ability-studio/build-attr";
import { declRegistry } from "#data/elite-redux/ability-studio/decl-registry";
import { TerrainType } from "#data/terrain";
import { BattlerTagType } from "#enums/battler-tag-type";
import { MoveId } from "#enums/move-id";
import { WeatherType } from "#enums/weather-type";
import { PokemonMove } from "#moves/pokemon-move";
import { startWorld } from "#test/tests/elite-redux/decomp/harness/game";
import { liveAbility } from "#test/tests/elite-redux/decomp/harness/twin";
import { setTerrainOf, setWeatherOf } from "#test/tests/elite-redux/decomp/harness/world";
import { BooleanHolder, NumberHolder } from "#utils/common";
import Phaser from "phaser";
import { beforeAll, describe, expect, it, vi } from "vitest";

const DESOLATE_LAND = 190;
const PRIMORDIAL_SEA = 189;
const ELECTRIC_SURGE = 226;
const DANCER = 216;
const SAMBA = 5469;
const UNNERVE = 127;
const KLUTZ = 103;
const HEATPROOF = 85;
const GUTS = 62;
const SIMPLE = 86;
const CONTRARY = 126;
const RIPEN = 247;

let phaserGame: Phaser.Game;
beforeAll(() => {
  phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
});

const base = (pokemon: unknown, simulated = false) => ({ pokemon, simulated }) as never;

function moduleOf(name: string) {
  const module = declRegistry.get(name);
  expect(module, `${name} must be declared`).toBeDefined();
  return module!;
}

describe("PostBiomeChangeWeatherChangeAbAttr (the primal weather abilities)", () => {
  it("only refreshes a lasting weather that differs from its own, and the rebuild agrees in every state", async () => {
    const { game, holder } = await startWorld(phaserGame);
    const original = liveAbility(DESOLATE_LAND).attrs[1] as PostBiomeChangeWeatherChangeAbAttr;
    const rebuilt = recomposeAttr(
      moduleOf("PostBiomeChangeWeatherChangeAbAttr"),
      original,
      DESOLATE_LAND,
      1,
    ) as PostBiomeChangeWeatherChangeAbAttr;
    expect(rebuilt).not.toBe(original);
    // Desolate Land sets Harsh Sun. A lasting (primal) weather other than Harsh Sun is replaced; Harsh Sun itself, an ordinary weather
    // and clear skies are not.
    const cases: [WeatherType, boolean][] = [
      [WeatherType.NONE, false],
      [WeatherType.RAIN, false],
      [WeatherType.SUNNY, false],
      [WeatherType.HARSH_SUN, false],
      [WeatherType.HEAVY_RAIN, true],
      [WeatherType.STRONG_WINDS, true],
    ];
    for (const [weather, expected] of cases) {
      setWeatherOf(game, weather);
      expect(original.canApply(base(holder)), `original, ${WeatherType[weather]}`).toBe(expected);
      expect(rebuilt.canApply(base(holder)), `rebuild, ${WeatherType[weather]}`).toBe(expected);
    }
  });

  it("apply sets the weather for both, and does nothing when simulated", async () => {
    const { game, holder } = await startWorld(phaserGame);
    const original = liveAbility(PRIMORDIAL_SEA).attrs[1] as PostBiomeChangeWeatherChangeAbAttr;
    const rebuilt = recomposeAttr(
      moduleOf("PostBiomeChangeWeatherChangeAbAttr"),
      original,
      PRIMORDIAL_SEA,
      1,
    ) as PostBiomeChangeWeatherChangeAbAttr;
    for (const attr of [original, rebuilt]) {
      setWeatherOf(game, WeatherType.HARSH_SUN);
      attr.apply(base(holder, true));
      expect(globalScene.arena.weather?.weatherType).toBe(WeatherType.HARSH_SUN);
      attr.apply(base(holder));
      expect(globalScene.arena.weather?.weatherType).toBe(WeatherType.HEAVY_RAIN);
    }
  });
});

describe("PostBiomeChangeTerrainChangeAbAttr (the surges)", () => {
  it("is possible only when the terrain differs, apply sets it, and the rebuild agrees", async () => {
    const { game, holder } = await startWorld(phaserGame);
    const original = liveAbility(ELECTRIC_SURGE).attrs[1] as PostBiomeChangeTerrainChangeAbAttr;
    const rebuilt = recomposeAttr(
      moduleOf("PostBiomeChangeTerrainChangeAbAttr"),
      original,
      ELECTRIC_SURGE,
      1,
    ) as PostBiomeChangeTerrainChangeAbAttr;
    expect(rebuilt).not.toBe(original);
    const cases: [TerrainType, boolean][] = [
      [TerrainType.NONE, true],
      [TerrainType.ELECTRIC, false],
      [TerrainType.GRASSY, true],
      [TerrainType.MISTY, true],
    ];
    for (const [terrain, expected] of cases) {
      setTerrainOf(game, terrain);
      expect(original.canApply(base(holder)), `original, ${TerrainType[terrain]}`).toBe(expected);
      expect(rebuilt.canApply(base(holder)), `rebuild, ${TerrainType[terrain]}`).toBe(expected);
    }
    for (const attr of [original, rebuilt]) {
      setTerrainOf(game, TerrainType.GRASSY);
      attr.apply(base(holder, true));
      expect(globalScene.arena.terrain?.terrainType).toBe(TerrainType.GRASSY);
      attr.apply(base(holder));
      expect(globalScene.arena.terrain?.terrainType).toBe(TerrainType.ELECTRIC);
    }
  });
});

describe("PostDancingMoveAbAttr (Dancer, Samba)", () => {
  const pokemonMove = (id: MoveId) => new PokemonMove(id);

  it("copies a dance move only from someone else and not while semi-invulnerable, and the rebuild agrees", async () => {
    const { holder, foe } = await startWorld(phaserGame);
    for (const [abilityId, attrIndex] of [
      [DANCER, 0],
      [SAMBA, 1],
    ] as const) {
      const original = liveAbility(abilityId).attrs[attrIndex] as PostDancingMoveAbAttr;
      const rebuilt = recomposeAttr(
        moduleOf("PostDancingMoveAbAttr"),
        original,
        abilityId,
        attrIndex,
      ) as PostDancingMoveAbAttr;
      expect(rebuilt).not.toBe(original);
      const savedTags = holder.summonData.tags;
      for (const attr of [original, rebuilt]) {
        const params = (source: unknown, move: MoveId) =>
          ({ pokemon: holder, source, move: pokemonMove(move), targets: [], simulated: false }) as never;
        // A dance move by the foe: yes. A plain move: no. My own dance move: no.
        expect(attr.canApply(params(foe, MoveId.SWORDS_DANCE))).toBe(true);
        expect(attr.canApply(params(foe, MoveId.TACKLE))).toBe(false);
        expect(attr.canApply(params(holder, MoveId.SWORDS_DANCE))).toBe(false);
        // While flying, diving, underground or hidden: no.
        for (const tagType of [
          BattlerTagType.FLYING,
          BattlerTagType.UNDERWATER,
          BattlerTagType.UNDERGROUND,
          BattlerTagType.HIDDEN,
        ]) {
          holder.summonData.tags = [{ tagType }] as never;
          expect(attr.canApply(params(foe, MoveId.SWORDS_DANCE)), `tag ${BattlerTagType[tagType]}`).toBe(false);
        }
        holder.summonData.tags = savedTags;
      }
    }
  });

  it("a swapped gate replaces only the dance test: sound moves are copied, the own-move and semi-invulnerable rules stay", async () => {
    const { holder, foe } = await startWorld(phaserGame);
    const original = liveAbility(DANCER).attrs[0] as PostDancingMoveAbAttr;
    const sound = recomposeAttr(moduleOf("PostDancingMoveAbAttr"), original, DANCER, 0, {
      conds: { gate: { block: "move.flag", params: { flag: "SOUND_BASED" } } },
    }) as PostDancingMoveAbAttr;
    const params = (source: unknown, move: MoveId) =>
      ({ pokemon: holder, source, move: new PokemonMove(move), targets: [], simulated: false }) as never;
    expect(sound.canApply(params(foe, MoveId.HYPER_VOICE))).toBe(true);
    expect(sound.canApply(params(foe, MoveId.SWORDS_DANCE))).toBe(false);
    expect(sound.canApply(params(holder, MoveId.HYPER_VOICE))).toBe(false);
    // The class itself still answers the dance question for the original.
    expect(original.canApply(params(foe, MoveId.HYPER_VOICE))).toBe(false);
  });

  it("apply queues nothing when simulated and a move phase for a copied move", async () => {
    const { holder, foe } = await startWorld(phaserGame);
    const original = liveAbility(DANCER).attrs[0] as PostDancingMoveAbAttr;
    const rebuilt = recomposeAttr(moduleOf("PostDancingMoveAbAttr"), original, DANCER, 0) as PostDancingMoveAbAttr;
    const spy = vi.spyOn(globalScene.phaseManager, "unshiftNew").mockImplementation(() => undefined as never);
    for (const attr of [original, rebuilt]) {
      spy.mockClear();
      const move = new PokemonMove(MoveId.SWORDS_DANCE);
      attr.apply({ pokemon: holder, source: foe, move, targets: [], simulated: true } as never);
      expect(spy).not.toHaveBeenCalled();
      attr.apply({ pokemon: holder, source: foe, move, targets: [], simulated: false } as never);
      expect(spy).toHaveBeenCalledTimes(1);
      expect((spy.mock.calls[0] as unknown[])[0]).toBe("MovePhase");
    }
  });
});

describe("PreventBerryUseAbAttr (Unnerve, Klutz, As One ...)", () => {
  it("cancels a berry meal once, shows nothing new when already cancelled, and the rebuild agrees", async () => {
    const { holder } = await startWorld(phaserGame);
    for (const [abilityId, attrIndex] of [
      [UNNERVE, 0],
      [KLUTZ, 0],
    ] as const) {
      const original = liveAbility(abilityId).attrs[attrIndex] as PreventBerryUseAbAttr;
      const rebuilt = recomposeAttr(
        moduleOf("PreventBerryUseAbAttr"),
        original,
        abilityId,
        attrIndex,
      ) as PreventBerryUseAbAttr;
      expect(rebuilt).not.toBe(original);
      for (const attr of [original, rebuilt]) {
        const open = new BooleanHolder(false);
        expect(attr.canApply({ pokemon: holder, cancelled: open } as never)).toBe(true);
        attr.apply({ pokemon: holder, cancelled: open } as never);
        expect(open.value).toBe(true);
        const already = new BooleanHolder(true);
        expect(attr.canApply({ pokemon: holder, cancelled: already } as never)).toBe(false);
        expect(attr.showAbility).toBe(true);
      }
    }
  });
});

describe("The burn classes (Heatproof, Guts)", () => {
  it("full burn immunity sets the burn damage to 0, whatever it was", async () => {
    const { holder } = await startWorld(phaserGame);
    const original = liveAbility(HEATPROOF).attrs[1] as FullBurnDamageImmunityAbAttr;
    const rebuilt = recomposeAttr(
      moduleOf("FullBurnDamageImmunityAbAttr"),
      original,
      HEATPROOF,
      1,
    ) as FullBurnDamageImmunityAbAttr;
    expect(rebuilt).not.toBe(original);
    for (const attr of [original, rebuilt]) {
      for (const damage of [1, 10, 12345]) {
        const holderValue = new NumberHolder(damage);
        attr.apply({ pokemon: holder, burnDamage: holderValue } as never);
        expect(holderValue.value).toBe(0);
      }
    }
  });

  it("bypass cancels the burn cut once and the rebuild agrees", async () => {
    const { holder } = await startWorld(phaserGame);
    for (const [abilityId, attrIndex] of [
      [GUTS, 0],
      [HEATPROOF, 2],
    ] as const) {
      const original = liveAbility(abilityId).attrs[attrIndex] as BypassBurnDamageReductionAbAttr;
      const rebuilt = recomposeAttr(
        moduleOf("BypassBurnDamageReductionAbAttr"),
        original,
        abilityId,
        attrIndex,
      ) as BypassBurnDamageReductionAbAttr;
      for (const attr of [original, rebuilt]) {
        const cancelled = new BooleanHolder(false);
        expect(attr.canApply({ pokemon: holder, cancelled } as never)).toBe(true);
        attr.apply({ pokemon: holder, cancelled } as never);
        expect(cancelled.value).toBe(true);
        expect(attr.canApply({ pokemon: holder, cancelled } as never)).toBe(false);
      }
    }
  });
});

describe("StatStageChangeMultiplierAbAttr and DoubleBerryEffectAbAttr", () => {
  it("multiplies the stages by the setting (Simple x2, Contrary x-1) and a rebuilt copy keeps it", async () => {
    const { holder } = await startWorld(phaserGame);
    for (const [abilityId, multiplier] of [
      [SIMPLE, 2],
      [CONTRARY, -1],
    ] as const) {
      const original = liveAbility(abilityId).attrs[0] as StatStageChangeMultiplierAbAttr;
      const rebuilt = recomposeAttr(
        moduleOf("StatStageChangeMultiplierAbAttr"),
        original,
        abilityId,
        0,
      ) as StatStageChangeMultiplierAbAttr;
      expect(rebuilt).not.toBe(original);
      for (const attr of [original, rebuilt]) {
        for (const stages of [1, -1, 2, -3]) {
          const holderValue = new NumberHolder(stages);
          attr.apply({ pokemon: holder, numStages: holderValue } as never);
          expect(holderValue.value).toBe(stages * multiplier);
        }
      }
    }
  });

  it("doubles the effect value, for the original and the rebuild", async () => {
    const { holder } = await startWorld(phaserGame);
    const original = liveAbility(RIPEN).attrs[0] as DoubleBerryEffectAbAttr;
    const rebuilt = recomposeAttr(moduleOf("DoubleBerryEffectAbAttr"), original, RIPEN, 0) as DoubleBerryEffectAbAttr;
    for (const attr of [original, rebuilt]) {
      const heal = new NumberHolder(30);
      attr.apply({ pokemon: holder, effectValue: heal } as never);
      expect(heal.value).toBe(60);
    }
  });
});

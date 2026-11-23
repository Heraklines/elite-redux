/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B12 chunk 3 probes. What the shared L1 grid and L2 twin cannot see, driven on the ORIGINAL attr and on its REBUILD side by side:
//   * ToxicTerrainSelfPoison (entry and terrain change): the gate, the Clueless difference, the status setting, the preview flag, the banner rule,
//   * TrapDurationModifier: every move of the game against the old formula, the trap the target ends with, the subset (Wildfire),
//   * TurnDecayDamageMultiplier: the power for every turn count against the old formula,
//   * TypeConversion and TypeConversionPowerBoost: every move of the game against `matchesSource`, the rebuilt users and the legacy ones,
//   * TypeDamageBoost: every move and the HP boundary around one third (exactly one third counts), the weather option,
//   * TypeRecoil: the type gate, the clamp that never knocks the holder out, Rock Head and Magic Guard, the preview flag,
//   * the codecs.
import type { AbAttr } from "#abilities/ab-attrs";
import { globalScene } from "#app/global-scene";
import { allMoves } from "#data/data-lists";
import { getBinding } from "#data/elite-redux/ability-studio/bindings";
import { buildAttr, recomposeAttr } from "#data/elite-redux/ability-studio/build-attr";
import {
  conversionSourceCodec,
  formatConversionSource,
  formatMoveList,
  formatWeatherList,
  hpLineCodec,
  moveListCodec,
  optionalMultiplierCodec,
  parseConversionSource,
  parseMoveList,
  parseWeatherList,
  percentOfFractionCodec,
  trapDamageDenominatorCodec,
  weatherListCodec,
} from "#data/elite-redux/ability-studio/decl/B12/b12-chunk3-codecs";
import { declRegistry } from "#data/elite-redux/ability-studio/decl-registry";
import {
  ToxicTerrainSelfPoisonOnSummonAbAttr,
  ToxicTerrainSelfPoisonOnTerrainChangeAbAttr,
} from "#data/elite-redux/archetypes/toxic-terrain-self-poison";
import { TrapDurationModifierAbAttr } from "#data/elite-redux/archetypes/trap-duration-modifier";
import { TypeConversionAbAttr, TypeConversionPowerBoostAbAttr } from "#data/elite-redux/archetypes/type-conversion";
import { TypeDamageBoostAbAttr, TypeRecoilAbAttr } from "#data/elite-redux/archetypes/type-damage-boost";
import { TerrainType } from "#data/terrain";
import { AbilityId } from "#enums/ability-id";
import { BattlerTagType } from "#enums/battler-tag-type";
import { MoveFlags } from "#enums/move-flags";
import { MoveId } from "#enums/move-id";
import { PokemonType } from "#enums/pokemon-type";
import { StatusEffect } from "#enums/status-effect";
import { WeatherType } from "#enums/weather-type";
import { startWorld } from "#test/tests/elite-redux/decomp/harness/game";
import { type AttrSite, allAttrSites } from "#test/tests/elite-redux/decomp/harness/sites";
import { NumberHolder } from "#utils/common";
import Phaser from "phaser";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

type AnyAttr = AbAttr & {
  canApply(params: never): boolean;
  apply(params: never): void;
};

function sitesOf(className: string): AttrSite[] {
  return allAttrSites().filter(site => site.className === className);
}

/** The attr rebuilt from its declaration, or undefined when its gate is a legacy-closure. */
function rebuild(site: AttrSite): AnyAttr | undefined {
  const module = declRegistry.get(site.className)!;
  const gate = getBinding(site.abilityId, site.attrIndex, "gate");
  if (gate !== undefined && gate.spec === undefined) {
    return;
  }
  return recomposeAttr(module, site.attr, site.abilityId, site.attrIndex) as AnyAttr;
}

const realMoves = () => allMoves.filter(move => move !== undefined && move.id !== MoveId.NONE);

describe("B12 chunk 3: type, trap, recoil, decay and toxic terrain classes", () => {
  let phaserGame: Phaser.Game;
  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("every bound user rebuilds as a fresh equal attr and the legacy users are exactly the ones the notes list", () => {
    const legacy: string[] = [];
    const rebuilt: Record<string, number> = {};
    for (const className of [
      "ToxicTerrainSelfPoisonOnSummonAbAttr",
      "ToxicTerrainSelfPoisonOnTerrainChangeAbAttr",
      "TrapDurationModifierAbAttr",
      "TurnDecayDamageMultiplierAbAttr",
      "TypeConversionAbAttr",
      "TypeConversionPowerBoostAbAttr",
      "TypeDamageBoostAbAttr",
      "TypeRecoilAbAttr",
    ]) {
      for (const site of sitesOf(className)) {
        const attr = rebuild(site);
        if (attr === undefined) {
          legacy.push(`${site.abilityName}:${site.attrIndex}:${className}`);
        } else {
          expect(attr).not.toBe(site.attr);
          expect(attr.constructor).toBe(site.attr.constructor);
          expect(attr.showAbility).toBe(site.attr.showAbility);
          rebuilt[className] = (rebuilt[className] ?? 0) + 1;
        }
      }
    }
    expect(rebuilt).toEqual({
      TrapDurationModifierAbAttr: 3,
      TurnDecayDamageMultiplierAbAttr: 1,
      TypeConversionAbAttr: 33,
      TypeConversionPowerBoostAbAttr: 4,
      TypeDamageBoostAbAttr: 63,
      TypeRecoilAbAttr: 5,
    });
    expect(legacy.sort()).toEqual(
      [
        "Toxic Boost:2:ToxicTerrainSelfPoisonOnSummonAbAttr",
        "Toxic Boost:3:ToxicTerrainSelfPoisonOnTerrainChangeAbAttr",
        ...["Sand Song", "Banshee", "Snow Song", "Power Metal", "Grievous Spear", "Grim Jab"].flatMap(name => [
          `${name}:0:TypeConversionAbAttr`,
          `${name}:1:TypeConversionPowerBoostAbAttr`,
        ]),
      ].sort(),
    );
  });

  // -------------------------------------------------------------------------------------------
  // Toxic Terrain
  it("ToxicTerrainSelfPoison (entry): banner on every entry, poison only in Toxic Terrain, never when simulated, never over a status", async () => {
    const { holder } = await startWorld(phaserGame);
    const attr = sitesOf("ToxicTerrainSelfPoisonOnSummonAbAttr")[0].attr as AnyAttr;
    expect(attr.showAbility).toBe(true);
    const params = { pokemon: holder, simulated: false } as never;
    // The game queues the status in a phase, so the call to trySetStatus is what is watched.
    const status = vi.spyOn(holder, "trySetStatus").mockReturnValue(true);
    holder.status = null;
    // The old class had no canApply of its own: the banner is queued for every entry, toxic or not.
    for (const terrain of [TerrainType.NONE, TerrainType.TOXIC, TerrainType.GRASSY]) {
      globalScene.arena.trySetTerrain(terrain, true);
      expect(attr.canApply(params)).toBe(true);
    }
    // No Toxic Terrain: nothing.
    for (const terrain of [TerrainType.NONE, TerrainType.GRASSY, TerrainType.ELECTRIC]) {
      globalScene.arena.trySetTerrain(terrain, true);
      attr.apply(params);
      expect(status, TerrainType[terrain]).not.toHaveBeenCalled();
    }
    globalScene.arena.trySetTerrain(TerrainType.TOXIC, true);
    // Simulated: nothing.
    attr.apply({ pokemon: holder, simulated: true } as never);
    expect(status).not.toHaveBeenCalled();
    // Real: poison, on the holder, by the holder.
    attr.apply(params);
    expect(status).toHaveBeenCalledTimes(1);
    expect(status).toHaveBeenLastCalledWith(StatusEffect.POISON, holder);
    // Already has a status: it is not replaced.
    status.mockClear();
    holder.status = { effect: StatusEffect.BURN } as never;
    attr.apply(params);
    expect(status).not.toHaveBeenCalled();
    // A fainted holder: nothing.
    holder.status = null;
    vi.spyOn(holder, "isFainted").mockReturnValue(true);
    attr.apply(params);
    expect(status).not.toHaveBeenCalled();
    vi.spyOn(holder, "isFainted").mockReturnValue(false);
    // The status setting.
    const burn = new ToxicTerrainSelfPoisonOnSummonAbAttr(StatusEffect.BURN) as AnyAttr;
    burn.apply(params);
    expect(status).toHaveBeenLastCalledWith(StatusEffect.BURN, holder);
    // A replaced gate decides: one that is always true poisons without terrain.
    status.mockClear();
    globalScene.arena.trySetTerrain(TerrainType.NONE, true);
    const always = new ToxicTerrainSelfPoisonOnSummonAbAttr() as unknown as AnyAttr & { gateOverride?: () => boolean };
    always.gateOverride = () => true;
    always.apply(params);
    expect(status).toHaveBeenLastCalledWith(StatusEffect.POISON, holder);
  });

  it("ToxicTerrainSelfPoison (entry): the gate reads the terrain object, so Clueless does not hide Toxic Terrain", async () => {
    const { holder } = await startWorld(phaserGame);
    const attr = sitesOf("ToxicTerrainSelfPoisonOnSummonAbAttr")[0].attr as unknown as { gate(p: never): boolean };
    globalScene.arena.trySetTerrain(TerrainType.TOXIC, true);
    expect(attr.gate({ pokemon: holder, simulated: false } as never)).toBe(true);
    vi.spyOn(globalScene.arena, "isFieldEffectSuppressed").mockReturnValue(true);
    // The library atom field.terrain reads arena.terrainType, which Clueless turns into NONE: that is why request R-B12-20 exists.
    expect(globalScene.arena.terrainType).toBe(TerrainType.NONE);
    expect(attr.gate({ pokemon: holder, simulated: false } as never)).toBe(true);
    globalScene.arena.trySetTerrain(TerrainType.NONE, true);
  });

  it("ToxicTerrainSelfPoison (terrain change): the gate and the poison equal the old formula for every terrain", async () => {
    const { holder } = await startWorld(phaserGame);
    const attr = sitesOf("ToxicTerrainSelfPoisonOnTerrainChangeAbAttr")[0].attr as AnyAttr;
    const status = vi.spyOn(holder, "trySetStatus").mockReturnValue(true);
    for (const terrain of [
      TerrainType.NONE,
      TerrainType.MISTY,
      TerrainType.ELECTRIC,
      TerrainType.GRASSY,
      TerrainType.PSYCHIC,
      TerrainType.TOXIC,
    ]) {
      globalScene.arena.trySetTerrain(terrain, true);
      for (const simulated of [false, true]) {
        for (const startStatus of [StatusEffect.NONE, StatusEffect.BURN]) {
          status.mockClear();
          holder.status = startStatus === StatusEffect.NONE ? null : ({ effect: startStatus } as never);
          const params = { pokemon: holder, terrain, simulated } as never;
          // Old formula: canApply = terrain === TOXIC; apply = !simulated && toxic on the field && no status -> poison.
          const expectedCan = terrain === TerrainType.TOXIC;
          expect(attr.canApply(params)).toBe(expectedCan);
          if (expectedCan) {
            attr.apply(params);
          }
          const expectedCalls = !simulated && expectedCan && startStatus === StatusEffect.NONE ? 1 : 0;
          expect(status, `${TerrainType[terrain]} sim ${simulated} status ${startStatus}`).toHaveBeenCalledTimes(
            expectedCalls,
          );
          if (expectedCalls === 1) {
            expect(status).toHaveBeenCalledWith(StatusEffect.POISON, holder);
          }
        }
      }
    }
    // The status setting reaches the effect.
    holder.status = null;
    status.mockClear();
    const paralysis = new ToxicTerrainSelfPoisonOnTerrainChangeAbAttr(StatusEffect.PARALYSIS) as AnyAttr;
    paralysis.apply({ pokemon: holder, terrain: TerrainType.TOXIC, simulated: false } as never);
    expect(status).toHaveBeenCalledWith(StatusEffect.PARALYSIS, holder);
    globalScene.arena.trySetTerrain(TerrainType.NONE, true);
  });

  // -------------------------------------------------------------------------------------------
  // Trap
  const TRAPPING = [
    MoveId.BIND,
    MoveId.WRAP,
    MoveId.FIRE_SPIN,
    MoveId.WHIRLPOOL,
    MoveId.SAND_TOMB,
    MoveId.MAGMA_STORM,
    MoveId.INFESTATION,
    MoveId.CLAMP,
    MoveId.THUNDER_CAGE,
    MoveId.SNAP_TRAP,
  ];

  it("TrapDuration: canApply equals the old formula for every move, a missing target and a fainted target, original and rebuild", async () => {
    const { holder, foe } = await startWorld(phaserGame);
    const sites = sitesOf("TrapDurationModifierAbAttr");
    expect(sites.map(site => site.abilityName).sort()).toEqual(["Tangled Tails", "Tentalock", "Wildfire"]);
    let trueCount = 0;
    for (const site of sites) {
      const subset = (site.attr as unknown as { opts: { moveIds?: readonly MoveId[] } }).opts.moveIds;
      const copy = rebuild(site)!;
      for (const move of realMoves()) {
        for (const opponent of [foe, undefined]) {
          for (const fainted of [false, true]) {
            vi.spyOn(foe, "isFainted").mockReturnValue(fainted);
            const params = { pokemon: holder, opponent, move, damage: 10, hitResult: 1, simulated: false } as never;
            const expected =
              !(!opponent || fainted)
              && TRAPPING.includes(move.id)
              && (subset === undefined || subset.includes(move.id));
            expect((site.attr as AnyAttr).canApply(params), `${site.abilityName} ${MoveId[move.id]}`).toBe(expected);
            expect(copy.canApply(params), `${site.abilityName} rebuilt ${MoveId[move.id]}`).toBe(expected);
            trueCount += expected ? 1 : 0;
          }
        }
      }
      vi.restoreAllMocks();
    }
    // Tentalock and Tangled Tails: 10 trapping moves each; Wildfire: Fire Spin only.
    expect(trueCount).toBe(10 + 10 + 1);
  });

  it("TrapDuration: the target ends with the generic trap for the set turns and damage share, from the original and the rebuild", async () => {
    const { holder, foe } = await startWorld(phaserGame);
    for (const site of sitesOf("TrapDurationModifierAbAttr")) {
      for (const attr of [site.attr as AnyAttr, rebuild(site)!]) {
        // Simulated: nothing.
        foe.removeTag(BattlerTagType.WRAP);
        attr.apply({
          pokemon: holder,
          opponent: foe,
          move: allMoves[MoveId.WRAP],
          damage: 10,
          hitResult: 1,
          simulated: true,
        } as never);
        expect(foe.getTag(BattlerTagType.WRAP)).toBeUndefined();
        // A Fire Spin victim carries the generic trap afterwards.
        foe.addTag(BattlerTagType.FIRE_SPIN, 4, MoveId.FIRE_SPIN, holder.id);
        attr.apply({
          pokemon: holder,
          opponent: foe,
          move: allMoves[MoveId.FIRE_SPIN],
          damage: 10,
          hitResult: 1,
          simulated: false,
        } as never);
        expect(foe.getTag(BattlerTagType.FIRE_SPIN)).toBeUndefined();
        const tag = foe.getTag(BattlerTagType.WRAP) as unknown as {
          turnCount: number;
          damageDenominatorOverride?: number;
        };
        expect(tag, site.abilityName).toBeDefined();
        const opts = (site.attr as unknown as { opts: { turns: number } }).opts;
        expect(tag.turnCount).toBe(opts.turns);
        expect(tag.damageDenominatorOverride).toBe(6);
        foe.removeTag(BattlerTagType.WRAP);
      }
    }
  });

  it("TrapDuration: the codecs read the options back exactly and a rebuild has no moveIds key when there is no subset", async () => {
    for (const site of sitesOf("TrapDurationModifierAbAttr")) {
      const copy = rebuild(site)!;
      const opts = (site.attr as unknown as { opts: Record<string, unknown> }).opts;
      const rebuiltOpts = (copy as unknown as { opts: Record<string, unknown> }).opts;
      expect(JSON.stringify(rebuiltOpts)).toBe(JSON.stringify(opts));
      expect(Object.keys(rebuiltOpts).sort()).toEqual(Object.keys(opts).sort());
    }
    expect(trapDamageDenominatorCodec.toCtor(6)).toBe(1 / 6);
    expect(trapDamageDenominatorCodec.fromInstance({ damageFraction: 1 / 6, turns: 6 })).toBe(6);
    for (let n = 1; n <= 16; n++) {
      expect(trapDamageDenominatorCodec.fromInstance({ damageFraction: trapDamageDenominatorCodec.toCtor(n) })).toBe(n);
      expect(Math.round(1 / (trapDamageDenominatorCodec.toCtor(n) as number))).toBe(n);
    }
    expect(parseMoveList("Fire Spin, wrap")).toEqual([MoveId.FIRE_SPIN, MoveId.WRAP]);
    expect(formatMoveList([MoveId.FIRE_SPIN])).toBe("Fire Spin");
    expect(parseMoveList(formatMoveList(TRAPPING) as string)).toEqual(TRAPPING);
    expect(moveListCodec.toCtor("")).toBeUndefined();
    expect(() => parseMoveList("Not a move")).toThrow();
  });

  // -------------------------------------------------------------------------------------------
  // Turn decay
  it("TurnDecayDamageMultiplier: the power for every turn count equals the old formula, original and rebuild", async () => {
    const { holder, foe } = await startWorld(phaserGame);
    const site = sitesOf("TurnDecayDamageMultiplierAbAttr")[0];
    const copy = rebuild(site)!;
    const { startMul, dropMul, floorMul } = site.attr as unknown as {
      startMul: number;
      dropMul: number;
      floorMul: number;
    };
    expect([startMul, dropMul, floorMul]).toEqual([1, 0.2, 0.2]);
    const seen = new Set<number>();
    for (const turnCount of [0, 1, 2, 3, 4, 5, 8, 12]) {
      holder.tempSummonData.turnCount = turnCount;
      for (const attr of [site.attr as AnyAttr, copy]) {
        const power = new NumberHolder(100);
        const params = {
          pokemon: holder,
          opponent: foe,
          move: allMoves[MoveId.TACKLE],
          power,
          simulated: false,
        } as never;
        expect(attr.canApply(params)).toBe(true);
        attr.apply(params);
        expect(power.value).toBe(100 * Math.max(floorMul, startMul - turnCount * dropMul));
        seen.add(power.value);
      }
    }
    // The entry turn already has one drop (turnCount starts at 1); the floor is reached on turn 4.
    expect(seen.size).toBeGreaterThan(4);
    holder.tempSummonData.turnCount = 1;
    // A different setting reaches the effect.
    const slow = buildAttr(declRegistry.get("TurnDecayDamageMultiplierAbAttr")!, {
      start: 2,
      drop: 0.5,
      floor: 1,
    }) as AnyAttr;
    holder.tempSummonData.turnCount = 1;
    const power = new NumberHolder(100);
    slow.apply({ pokemon: holder, opponent: foe, move: allMoves[MoveId.TACKLE], power, simulated: false } as never);
    expect(power.value).toBe(150);
    holder.tempSummonData.turnCount = 1;
  });

  // -------------------------------------------------------------------------------------------
  // Type conversion
  /** The old source filter, written out. */
  type Source = { kind: "type"; type: PokemonType } | { kind: "flag"; flag: MoveFlags; requireType?: PokemonType };
  const matches = (source: Source, move: (typeof allMoves)[number]): boolean => {
    if (source.kind === "type") {
      return move.type === source.type;
    }
    return move.hasFlag(source.flag) && (source.requireType === undefined || move.type === source.requireType);
  };

  it("TypeConversion: canApply equals the source filter for every move (original, rebuild); apply writes the new type", async () => {
    const { holder, foe } = await startWorld(phaserGame);
    const moves = realMoves();
    const signatures = new Map<string, number>();
    let hits = 0;
    for (const site of sitesOf("TypeConversionAbAttr")) {
      const attr = site.attr as unknown as { source: Source; configuredNewType: PokemonType };
      const copy = rebuild(site);
      signatures.set(JSON.stringify(attr.source), (signatures.get(JSON.stringify(attr.source)) ?? 0) + 1);
      for (const move of moves) {
        const moveType = new NumberHolder(move.type);
        const params = { pokemon: holder, opponent: foe, move, moveType, simulated: false } as never;
        const expected = matches(attr.source, move);
        expect((site.attr as AnyAttr).canApply(params), `${site.abilityName} ${MoveId[move.id]}`).toBe(expected);
        if (copy !== undefined) {
          expect(copy.canApply(params), `${site.abilityName} rebuilt ${MoveId[move.id]}`).toBe(expected);
        }
        if (expected) {
          hits++;
          for (const target of copy === undefined ? [site.attr as AnyAttr] : [site.attr as AnyAttr, copy]) {
            const holderType = new NumberHolder(move.type);
            target.apply({ ...(params as object), moveType: holderType } as never);
            expect(holderType.value).toBe(attr.configuredNewType);
          }
        }
      }
    }
    expect(hits).toBeGreaterThan(1000);
    // The users cover type sources (Normal, Rock, Steel, Flying) and property sources (Sound, Drill).
    expect([...signatures.keys()].length).toBeGreaterThanOrEqual(6);
  });

  it("TypeConversion: the property users really read the plain flag bit (why they stay legacy until R-B12-04)", async () => {
    const { holder, foe } = await startWorld(phaserGame);
    const sandSong = sitesOf("TypeConversionAbAttr").find(site => site.abilityName === "Sand Song")!;
    // A move that has the sound bit but whose user has an ability that stops the flag from counting still converts: the class asks hasFlag.
    const move = allMoves[MoveId.HYPER_VOICE];
    expect(move.hasFlag(MoveFlags.SOUND_BASED)).toBe(true);
    const flagSpy = vi.spyOn(move, "doesFlagEffectApply").mockReturnValue(false);
    expect(
      (sandSong.attr as AnyAttr).canApply({
        pokemon: holder,
        opponent: foe,
        move,
        moveType: new NumberHolder(move.type),
        simulated: false,
      } as never),
    ).toBe(true);
    expect(flagSpy).not.toHaveBeenCalled();
  });

  it("TypeConversionPowerBoost: canApply equals the source filter for every move (original, rebuild); apply multiplies", async () => {
    const { holder, foe } = await startWorld(phaserGame);
    const moves = realMoves();
    let hits = 0;
    for (const site of sitesOf("TypeConversionPowerBoostAbAttr")) {
      const attr = site.attr as unknown as { source: Source; multiplier: number };
      const copy = rebuild(site);
      for (const move of moves) {
        const params = {
          pokemon: holder,
          opponent: foe,
          move,
          power: new NumberHolder(100),
          simulated: false,
        } as never;
        const expected = matches(attr.source, move);
        expect((site.attr as AnyAttr).canApply(params), `${site.abilityName} ${MoveId[move.id]}`).toBe(expected);
        if (copy !== undefined) {
          expect(copy.canApply(params), `${site.abilityName} rebuilt ${MoveId[move.id]}`).toBe(expected);
        }
        if (expected) {
          hits++;
          for (const target of copy === undefined ? [site.attr as AnyAttr] : [site.attr as AnyAttr, copy]) {
            const power = new NumberHolder(100);
            target.apply({ ...(params as object), power } as never);
            expect(power.value).toBeCloseTo(100 * attr.multiplier);
          }
        }
      }
    }
    expect(hits).toBeGreaterThan(400);
  });

  it("TypeConversion: the old loop cannot come back (the gate reads the move's own type, never getMoveType)", async () => {
    const { holder, foe } = await startWorld(phaserGame);
    const spy = vi.spyOn(holder, "getMoveType");
    const attr = sitesOf("TypeConversionAbAttr")[0].attr as AnyAttr;
    const move = allMoves[MoveId.TACKLE];
    attr.canApply({
      pokemon: holder,
      opponent: foe,
      move,
      moveType: new NumberHolder(move.type),
      simulated: false,
    } as never);
    expect(spy).not.toHaveBeenCalled();
  });

  it("conversion source codec: every user's source reads back as words and parses to the same filter", async () => {
    await startWorld(phaserGame);
    const words = new Set<string>();
    for (const className of ["TypeConversionAbAttr", "TypeConversionPowerBoostAbAttr"]) {
      for (const site of sitesOf(className)) {
        const source = (site.attr as unknown as { source: unknown }).source;
        const text = formatConversionSource(source)!;
        expect(text, site.abilityName).toBeDefined();
        expect(JSON.stringify(parseConversionSource(text))).toBe(JSON.stringify(source));
        expect(conversionSourceCodec.toCtor(text)).toEqual(source);
        words.add(text);
      }
    }
    expect([...words].sort()).toEqual(
      [
        "Drill moves that are Normal",
        "Flying",
        "Normal",
        "Rock",
        "Sound moves",
        "Sound moves that are Normal",
        "Steel",
      ].sort(),
    );
    expect(() => parseConversionSource("Banana")).toThrow();
    expect(() => parseConversionSource("Banana moves")).toThrow();
  });

  // -------------------------------------------------------------------------------------------
  // Type damage boost
  it("TypeDamageBoost: the gate equals the old closure for every move of every user (original, rebuild); the HP choice includes exactly one third", async () => {
    const { holder, foe } = await startWorld(phaserGame);
    const sites = sitesOf("TypeDamageBoostAbAttr");
    expect(sites.length).toBe(63);
    const moves = realMoves();
    const maxHp = holder.getMaxHp();
    let gateTrue = 0;
    for (const site of sites) {
      const attr = site.attr as unknown as {
        type: PokemonType;
        highHpMultiplier: number;
        lowHpMultiplier: number | null;
        lowHpThreshold: number;
        weathers: unknown;
      };
      expect(attr.weathers).toBeNull();
      const copy = rebuild(site)!;
      for (const move of moves) {
        const params = {
          pokemon: holder,
          opponent: foe,
          move,
          power: new NumberHolder(100),
          simulated: false,
        } as never;
        const expected = holder.getMoveType(move) === attr.type;
        expect((site.attr as AnyAttr).canApply(params), `${site.abilityName} ${MoveId[move.id]}`).toBe(expected);
        expect(copy.canApply(params), `${site.abilityName} rebuilt ${MoveId[move.id]}`).toBe(expected);
        gateTrue += expected ? 1 : 0;
      }
      // The HP choice: every HP around one third, with the old formula `hp / maxHp <= threshold`.
      const move = moves.find(m => holder.getMoveType(m) === attr.type && m.power > 0) ?? allMoves[MoveId.TACKLE];
      for (const hp of [maxHp, Math.ceil(maxHp / 3) + 1, Math.ceil(maxHp / 3), Math.floor(maxHp / 3), 1]) {
        holder.hp = hp;
        const ratio = holder.getHpRatio(true);
        const multiplier =
          attr.lowHpMultiplier !== null && ratio <= attr.lowHpThreshold ? attr.lowHpMultiplier : attr.highHpMultiplier;
        for (const target of [site.attr as AnyAttr, copy]) {
          const power = new NumberHolder(100);
          target.apply({ pokemon: holder, opponent: foe, move, power, simulated: false } as never);
          expect(power.value, `${site.abilityName} hp ${hp}`).toBeCloseTo(100 * multiplier);
        }
      }
      holder.hp = maxHp;
    }
    expect(gateTrue).toBeGreaterThan(300);
  });

  it("TypeDamageBoost: exactly one third counts as low (the line is exactly 1/3 through the codec and the rebuild)", async () => {
    const { holder, foe } = await startWorld(phaserGame);
    const site = sitesOf("TypeDamageBoostAbAttr").find(s => s.abilityName === "Hellblaze")!;
    const copy = rebuild(site)!;
    expect((copy as unknown as { lowHpThreshold: number }).lowHpThreshold).toBe(1 / 3);
    expect(hpLineCodec.toCtor(33.3333333333)).toBe(1 / 3);
    expect(hpLineCodec.toCtor(100 / 3)).toBe(1 / 3);
    expect(hpLineCodec.toCtor(25)).toBe(0.25);
    expect(hpLineCodec.toCtor(40)).toBeCloseTo(0.4);
    expect(hpLineCodec.fromInstance(1 / 3)).toBe(33.3333333333);
    // A holder whose HP is exactly one third (maxHp 3 * n).
    holder.hp = holder.getMaxHp();
    const maxHp = holder.getMaxHp();
    const exactThird = maxHp % 3 === 0 ? maxHp / 3 : undefined;
    const move = allMoves[MoveId.EMBER];
    for (const hp of exactThird === undefined ? [] : [exactThird - 1, exactThird, exactThird + 1]) {
      holder.hp = hp;
      for (const target of [site.attr as AnyAttr, copy]) {
        const power = new NumberHolder(100);
        target.apply({ pokemon: holder, opponent: foe, move, power, simulated: false } as never);
        expect(power.value).toBeCloseTo(hp <= exactThird! ? 180 : 130);
      }
    }
    holder.hp = maxHp;
    // The setting alone, with no battle HP: the resolver at the boundary values.
    const attr = site.attr as unknown as { resolveMultiplier(ratio: number): number };
    expect(attr.resolveMultiplier(1 / 3)).toBe(1.8);
    expect(attr.resolveMultiplier(1 / 3 + 1e-9)).toBe(1.3);
    expect(optionalMultiplierCodec.toCtor(0)).toBeUndefined();
    expect(optionalMultiplierCodec.fromInstance(null)).toBe(0);
    expect(optionalMultiplierCodec.fromInstance(1.8)).toBe(1.8);
  });

  it("TypeDamageBoost: the weather option (no user sets it) holds the old gate: the weather must be on and not suppressed", async () => {
    const { holder, foe } = await startWorld(phaserGame);
    const module = declRegistry.get("TypeDamageBoostAbAttr")!;
    const attr = buildAttr(
      module,
      { type: "ICE", multiplier: 1.5, weathers: "Snow, Hail" },
      { gate: { block: "move.type", params: { type: "ICE", effective: true } } as never },
    ) as AnyAttr;
    // The compiled gate is the type test only (the weather part is not editable), so check the class itself with the same options.
    const plain = new TypeDamageBoostAbAttr({
      type: PokemonType.ICE,
      multiplier: 1.5,
      weathers: [WeatherType.SNOW, WeatherType.HAIL],
    }) as AnyAttr;
    expect(attr).toBeDefined();
    const move = allMoves[MoveId.ICE_BEAM];
    const params = { pokemon: holder, opponent: foe, move, power: new NumberHolder(90), simulated: false } as never;
    const arena = globalScene.arena as unknown as { weather: unknown };
    const saved = arena.weather;
    const weatherSpy = vi.spyOn(globalScene.arena, "weatherType", "get");
    for (const [weather, suppressed, expected] of [
      [WeatherType.SNOW, false, true],
      [WeatherType.HAIL, false, true],
      [WeatherType.RAIN, false, false],
      [WeatherType.NONE, false, false],
      [WeatherType.SNOW, true, false],
    ] as const) {
      weatherSpy.mockReturnValue(weather);
      arena.weather = { isEffectSuppressed: () => suppressed };
      expect(plain.canApply(params), `${WeatherType[weather]} ${suppressed}`).toBe(expected);
    }
    arena.weather = saved;
    expect(weatherListCodec.toCtor("")).toBeUndefined();
    expect(parseWeatherList("Snow, hail")).toEqual([WeatherType.SNOW, WeatherType.HAIL]);
    expect(formatWeatherList(null)).toBe("");
    expect(formatWeatherList([WeatherType.HEAVY_RAIN])).toBe("Heavy rain");
    expect(() => parseWeatherList("Meteors")).toThrow();
  });

  // -------------------------------------------------------------------------------------------
  // Type recoil
  it("TypeRecoil: canApply equals the old formula (damaging and the move's type) for every move, original and rebuild", async () => {
    const { holder, foe } = await startWorld(phaserGame);
    const sites = sitesOf("TypeRecoilAbAttr");
    expect(sites.length).toBe(5);
    let trueCount = 0;
    for (const site of sites) {
      const attr = site.attr as unknown as { type: PokemonType };
      const copy = rebuild(site)!;
      for (const move of realMoves()) {
        const params = { pokemon: holder, opponent: foe, move, damage: 20, hitResult: 1, simulated: false } as never;
        const expected = move.category !== 2 && holder.getMoveType(move) === attr.type;
        expect((site.attr as AnyAttr).canApply(params), `${site.abilityName} ${MoveId[move.id]}`).toBe(expected);
        expect(copy.canApply(params), `${site.abilityName} rebuilt ${MoveId[move.id]}`).toBe(expected);
        trueCount += expected ? 1 : 0;
      }
    }
    expect(trueCount).toBeGreaterThan(100);
  });

  it("TypeRecoil: the recoil is a share of the damage, never knocks the holder out, and is skipped when simulated or blocked", async () => {
    const { holder, foe } = await startWorld(phaserGame);
    const site = sitesOf("TypeRecoilAbAttr").find(s => s.abilityName === "Doom Blast")!;
    const copy = rebuild(site)!;
    const maxHp = holder.getMaxHp();
    const move = allMoves[MoveId.BITE];
    const run = (attr: AnyAttr, hp: number, damage: number | undefined, simulated = false): number => {
      holder.hp = hp;
      holder.turnData.damageTaken = 0;
      attr.apply({ pokemon: holder, opponent: foe, move, damage, hitResult: 1, simulated } as never);
      return hp - holder.hp;
    };
    for (const attr of [site.attr as AnyAttr, copy]) {
      // 10% of 200 = 20.
      expect(run(attr, maxHp, 200)).toBe(20);
      expect(holder.turnData.damageTaken).toBe(20);
      // At least 1 for a tiny hit.
      expect(run(attr, maxHp, 3)).toBe(1);
      // Never below 1 HP: 20 recoil against 5 HP leaves 1 HP.
      expect(run(attr, 5, 200)).toBe(4);
      expect(holder.hp).toBe(1);
      // At 1 HP: nothing.
      expect(run(attr, 1, 200)).toBe(0);
      // No damage, simulated: nothing.
      expect(run(attr, maxHp, 0)).toBe(0);
      expect(run(attr, maxHp, undefined)).toBe(0);
      expect(run(attr, maxHp, 200, true)).toBe(0);
    }
    // Rock Head and Magic Guard stop it.
    for (const ability of [AbilityId.ROCK_HEAD, AbilityId.MAGIC_GUARD]) {
      holder.summonData.ability = ability;
      expect(run(site.attr as AnyAttr, maxHp, 200), AbilityId[ability]).toBe(0);
      expect(run(copy, maxHp, 200), AbilityId[ability]).toBe(0);
    }
    holder.summonData.ability = 0 as never;
    holder.hp = maxHp;
    // The share setting reaches the effect.
    const big = new TypeRecoilAbAttr({ type: PokemonType.DARK, recoilPct: 0.5 }) as AnyAttr;
    expect(run(big, maxHp, 100)).toBe(50);
    expect(percentOfFractionCodec.toCtor(5)).toBe(0.05);
    expect(percentOfFractionCodec.fromInstance(0.05)).toBe(5);
    expect(percentOfFractionCodec.fromInstance(0.1)).toBe(10);
    expect(percentOfFractionCodec.fromInstance(0.125)).toBe(12.5);
  });

  // -------------------------------------------------------------------------------------------
  // The classes still expose what the rest of the game reads
  it("the refactored classes keep their name, their banner setting and their constructor arity", async () => {
    await startWorld(phaserGame);
    const expected: Record<string, boolean> = {
      ToxicTerrainSelfPoisonOnSummonAbAttr: true,
      ToxicTerrainSelfPoisonOnTerrainChangeAbAttr: true,
      TrapDurationModifierAbAttr: false,
      TurnDecayDamageMultiplierAbAttr: false,
      TypeConversionAbAttr: false,
      TypeConversionPowerBoostAbAttr: false,
      TypeDamageBoostAbAttr: false,
      TypeRecoilAbAttr: true,
    };
    for (const [className, banner] of Object.entries(expected)) {
      for (const site of sitesOf(className)) {
        expect(site.attr.constructor.name).toBe(className);
        expect(site.attr.showAbility, `${site.abilityName} ${className}`).toBe(banner);
      }
    }
    expect(
      new TypeConversionAbAttr({ source: { kind: "type", type: PokemonType.NORMAL }, newType: PokemonType.FIRE })
        .showAbility,
    ).toBe(false);
    expect(
      new TypeConversionPowerBoostAbAttr({ source: { kind: "type", type: PokemonType.NORMAL }, multiplier: 1.1 })
        .showAbility,
    ).toBe(false);
    expect(new TrapDurationModifierAbAttr({ turns: 4, damageFraction: 0.25 })).toBeDefined();
  });
});

/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import type { PostTurnHealAbAttr } from "#abilities/ab-attrs";
// B10 chunk 2, the three Tier B classes: OncePerEntryContactDamageReductionAbAttr (Chuckster), PassiveRecoveryAbAttr (17 abilities)
// and PoisonedFoePurgeAbAttr (Hemolysis). The shared L1 grid has one max HP family, no fog, no Toxic or Misty terrain, no Ice holder
// and no poisoned foe, so this test drives canApply of
//   (a) the FROZEN original rule, written here from the source as it was before the split,
//   (b) the refactored class (guards && gate),
//   (c) the REBUILD whose gate is the library tree of the binding,
// over the states the grid cannot reach, and compares all three. It also checks the memory of Chuckster's charge, that a preview
// spends nothing, the heal amount of PassiveRecovery, the purge of Hemolysis and the two legacy users.
import { globalScene } from "#app/global-scene";
import { allMoves } from "#data/data-lists";
import { getBinding } from "#data/elite-redux/ability-studio/bindings";
import { readDeclParams, recomposeAttr } from "#data/elite-redux/ability-studio/build-attr";
import { passiveRecoveryWhenCodec } from "#data/elite-redux/ability-studio/decl/B10/b10-codecs";
import { declRegistry } from "#data/elite-redux/ability-studio/decl-registry";
import type { DeclModule } from "#data/elite-redux/ability-studio/define-decl";
import { PassiveRecoveryAbAttr } from "#data/elite-redux/archetypes/passive-recovery";
import { TerrainType } from "#data/terrain";
import { BattlerTagType } from "#enums/battler-tag-type";
import { MoveFlags } from "#enums/move-flags";
import { MoveId } from "#enums/move-id";
import { PokemonType } from "#enums/pokemon-type";
import { Stat } from "#enums/stat";
import { StatusEffect } from "#enums/status-effect";
import { WeatherType } from "#enums/weather-type";
import type { Pokemon } from "#field/pokemon";
import { startWorld } from "#test/tests/elite-redux/decomp/harness/game";
import { allAttrSites } from "#test/tests/elite-redux/decomp/harness/sites";
import {
  resolveHp,
  setStatusOf,
  setTerrainOf,
  setTypesOf,
  setWeatherOf,
} from "#test/tests/elite-redux/decomp/harness/world";
import { NumberHolder } from "#utils/common";
import Phaser from "phaser";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

const moduleOf = (name: string): DeclModule => declRegistry.get(name) as DeclModule;
const sitesOf = (name: string) => allAttrSites().filter(site => site.className === name);

describe("B10: PassiveRecoveryAbAttr (Tier B: not at full HP, then the situation)", () => {
  let phaserGame: Phaser.Game;
  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("17 attrs of 16 abilities; every situation text round-trips to the exact condition object the class holds", async () => {
    await startWorld(phaserGame);
    const sites = sitesOf("PassiveRecoveryAbAttr");
    expect(sites).toHaveLength(17);
    expect(new Set(sites.map(site => site.abilityId)).size).toBe(16);
    const module = moduleOf("PassiveRecoveryAbAttr");
    for (const site of sites) {
      const params = readDeclParams(module, site.attr);
      expect(typeof params.when, `${site.abilityName} situation`).toBe("string");
      const original = site.attr as unknown as PassiveRecoveryAbAttr;
      expect(passiveRecoveryWhenCodec.toCtor(params.when), `${site.abilityName} ${String(params.when)}`).toEqual(
        original.getRecoveryCondition(),
      );
      expect(Number(params.percent) / 100, `${site.abilityName} heal share`).toBe(original.getHealFraction());
    }
  });

  it("the codec also writes situations no user has (a different weather list, a status, an HP limit, a type) and refuses nonsense", () => {
    expect(passiveRecoveryWhenCodec.toCtor("While the weather is Rain or Heavy rain")).toEqual({
      kind: "weather",
      weathers: [WeatherType.RAIN, WeatherType.HEAVY_RAIN],
    });
    expect(passiveRecoveryWhenCodec.toCtor("While my status is Burn")).toEqual({
      kind: "status",
      status: StatusEffect.BURN,
    });
    expect(passiveRecoveryWhenCodec.toCtor("While my HP is at most 33% of my max HP")).toEqual({
      kind: "hp-below-fraction",
      fraction: 0.33,
    });
    expect(passiveRecoveryWhenCodec.toCtor("While I have the Water type")).toEqual({
      kind: "self-type",
      type: PokemonType.WATER,
    });
    expect(() => passiveRecoveryWhenCodec.toCtor("Whenever it feels right")).toThrow(/not a situation/);
    expect(() => passiveRecoveryWhenCodec.toCtor("While the weather is Gloom")).toThrow(/not a known weather/);
  });

  it("frozen original, refactored class and rebuild agree over HP, weather, terrain, status and type states; the two sleep users stay legacy", async () => {
    const { game, holder } = await startWorld(phaserGame);
    const module = moduleOf("PassiveRecoveryAbAttr");
    const sites = sitesOf("PassiveRecoveryAbAttr");
    const legacy = new Set([
      "5071:0",
      "5220:0", // Sweet Dreams and Peaceful Slumber (first part): asleep OR comatose-like
    ]);
    const hpValues = ["max", "max-1", "50%+1", "50%", "50%-1", 1] as const;
    const weathers = [WeatherType.NONE, WeatherType.FOG, WeatherType.EERIE_FOG, WeatherType.RAIN, WeatherType.SUNNY];
    const terrains = [TerrainType.NONE, TerrainType.MISTY, TerrainType.GRASSY, TerrainType.TOXIC, TerrainType.ELECTRIC];
    const typeSets: PokemonType[][] = [[PokemonType.NORMAL], [PokemonType.ICE], [PokemonType.ICE, PokemonType.FLYING]];
    const statuses = [StatusEffect.NONE, StatusEffect.SLEEP, StatusEffect.BURN];
    let compared = 0;
    for (const site of sites) {
      const original = site.attr as unknown as PassiveRecoveryAbAttr;
      const key = `${site.abilityId}:${site.attrIndex}`;
      if (legacy.has(key)) {
        expect(
          getBinding(site.abilityId, site.attrIndex, "gate")?.legacyClosure,
          `${site.abilityName} is legacy`,
        ).toBeDefined();
        expect(
          () => recomposeAttr(module, site.attr, site.abilityId, site.attrIndex),
          `${site.abilityName} cannot rebuild`,
        ).toThrow(/no library binding/);
        continue;
      }
      const rebuilt = recomposeAttr(
        module,
        site.attr,
        site.abilityId,
        site.attrIndex,
      ) as unknown as PassiveRecoveryAbAttr;
      expect(rebuilt, `${site.abilityName} is a fresh instance`).not.toBe(original);
      expect(rebuilt.getHealFraction()).toBe(original.getHealFraction());
      expect(rebuilt.getRecoveryCondition()).toEqual(original.getRecoveryCondition());
      const spec = original.getRecoveryCondition();
      // The frozen rule, as canApply read before the split: the parent's test first, then the situation.
      const frozen = (mon: Pokemon): boolean => !mon.isFullHp() && PassiveRecoveryAbAttr.matchesCondition(spec, mon);
      for (const maxHp of [100, 101]) {
        for (const hp of hpValues) {
          for (const weather of weathers) {
            for (const terrain of terrains) {
              for (const types of typeSets) {
                for (const status of statuses) {
                  holder.stats[Stat.HP] = maxHp;
                  holder.hp = resolveHp(hp, holder.getMaxHp());
                  setWeatherOf(game, weather);
                  setTerrainOf(game, terrain);
                  setTypesOf(holder, types);
                  setStatusOf(holder, status);
                  const params = { pokemon: holder, simulated: false } as never;
                  const want = frozen(holder);
                  const label = `${site.abilityName}: max ${maxHp} hp ${holder.hp} weather ${WeatherType[weather]} terrain ${TerrainType[terrain]} types ${types.join("/")} status ${StatusEffect[status]}`;
                  expect(original.canApply(params), `class, ${label}`).toBe(want);
                  expect(rebuilt.canApply(params), `rebuild, ${label}`).toBe(want);
                  compared++;
                }
              }
            }
          }
        }
      }
    }
    // 15 rebuildable attrs x 2 max HP x 6 HP x 5 weathers x 5 terrains x 3 types x 3 statuses
    expect(compared).toBe(15 * 2 * 6 * 5 * 5 * 3 * 3);
  });

  it("the heal is the share of max HP the setting says, for the original and the rebuild; a preview and full HP heal nothing", async () => {
    const { holder } = await startWorld(phaserGame);
    const module = moduleOf("PassiveRecoveryAbAttr");
    const queued: unknown[][] = [];
    vi.spyOn(globalScene.phaseManager, "unshiftNew").mockImplementation(((...args: unknown[]) => {
      queued.push(args);
    }) as never);
    for (const site of sitesOf("PassiveRecoveryAbAttr")) {
      if (site.abilityId === 5071 || (site.abilityId === 5220 && site.attrIndex === 0)) {
        continue;
      }
      const original = site.attr as unknown as PostTurnHealAbAttr;
      const rebuilt = recomposeAttr(module, site.attr, site.abilityId, site.attrIndex) as unknown as PostTurnHealAbAttr;
      for (const [name, attr] of [
        ["class", original],
        ["rebuild", rebuilt],
      ] as const) {
        queued.length = 0;
        holder.hp = Math.max(1, holder.getMaxHp() - 10);
        attr.apply({ pokemon: holder, simulated: true } as never);
        expect(queued, `${site.abilityName} ${name}: preview`).toEqual([]);
        attr.apply({ pokemon: holder, simulated: false } as never);
        expect(queued, `${site.abilityName} ${name}: one heal`).toHaveLength(1);
        const [phase, index, amount] = queued[0] as [string, number, number];
        expect(phase).toBe("PokemonHealPhase");
        expect(index).toBe(holder.getBattlerIndex());
        const fraction = (site.attr as unknown as PassiveRecoveryAbAttr).getHealFraction();
        expect(amount, `${site.abilityName} ${name}: amount`).toBe(
          Math.max(Math.floor(holder.getMaxHp() * fraction), 1),
        );
      }
      // full HP: the guard (the parent's rule) stops both, whatever the situation says
      holder.hp = holder.getMaxHp();
      expect(
        original.canApply({ pokemon: holder, simulated: false } as never),
        `${site.abilityName}: full HP, class`,
      ).toBe(false);
      expect(
        rebuilt.canApply({ pokemon: holder, simulated: false } as never),
        `${site.abilityName}: full HP, rebuild`,
      ).toBe(false);
    }
  });

  it("a staff-changed share moves only the heal; the gate stays the user's", async () => {
    const { holder } = await startWorld(phaserGame);
    const module = moduleOf("PassiveRecoveryAbAttr");
    const site = sitesOf("PassiveRecoveryAbAttr").find(candidate => candidate.abilityName === "Resilience")!;
    const rebuilt = recomposeAttr(module, site.attr, site.abilityId, site.attrIndex, {
      params: { percent: 40 },
    }) as unknown as PassiveRecoveryAbAttr;
    expect(rebuilt.getHealFraction()).toBe(0.4);
    expect(rebuilt.getRecoveryCondition()).toEqual({ kind: "hp-below-fraction", fraction: 0.5 });
    const queued: unknown[][] = [];
    vi.spyOn(globalScene.phaseManager, "unshiftNew").mockImplementation(((...args: unknown[]) => {
      queued.push(args);
    }) as never);
    holder.hp = Math.floor(holder.getMaxHp() / 2);
    expect(rebuilt.canApply({ pokemon: holder, simulated: false } as never)).toBe(true);
    rebuilt.apply({ pokemon: holder, simulated: false } as never);
    expect(queued[0][2]).toBe(Math.floor(holder.getMaxHp() * 0.4));
    holder.hp = Math.floor(holder.getMaxHp() / 2) + 1;
    expect(rebuilt.canApply({ pokemon: holder, simulated: false } as never)).toBe(false);
  });
});

describe("B10: OncePerEntryContactDamageReductionAbAttr (Tier B: charge unspent, then contact)", () => {
  let phaserGame: Phaser.Game;
  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("frozen original, refactored class and rebuild agree for contact and non-contact moves with the charge unspent and spent", async () => {
    const { holder, foe } = await startWorld(phaserGame);
    const module = moduleOf("OncePerEntryContactDamageReductionAbAttr");
    const sites = sitesOf("OncePerEntryContactDamageReductionAbAttr");
    expect(sites.map(site => site.abilityName)).toEqual(["Chuckster"]);
    const original = sites[0].attr;
    const rebuilt = recomposeAttr(module, original, sites[0].abilityId, sites[0].attrIndex);
    expect(rebuilt).not.toBe(original);
    for (const moveId of [MoveId.TACKLE, MoveId.WATER_GUN, MoveId.BITE, MoveId.SHADOW_BALL, MoveId.SPLASH]) {
      const move = allMoves[moveId];
      for (const used of [false, true]) {
        holder.summonData.chuckusterReductionUsed = used;
        const params = {
          pokemon: holder,
          opponent: foe,
          move,
          damage: new NumberHolder(100),
          simulated: false,
        } as never;
        // The frozen closure of the original class: unspent AND contact, in that order.
        const want =
          holder.summonData.chuckusterReductionUsed !== true
          && move.doesFlagEffectApply({ flag: MoveFlags.MAKES_CONTACT, user: foe, target: holder });
        expect(original.canApply(params), `class, ${MoveId[moveId]}, used ${used}`).toBe(want);
        expect(rebuilt.canApply(params), `rebuild, ${MoveId[moveId]}, used ${used}`).toBe(want);
      }
    }
  });

  it("a preview halves the damage without spending the charge; the first real hit spends it; the next contact hit is full damage", async () => {
    const { holder, foe } = await startWorld(phaserGame);
    const module = moduleOf("OncePerEntryContactDamageReductionAbAttr");
    const site = sitesOf("OncePerEntryContactDamageReductionAbAttr")[0];
    const rebuilt = recomposeAttr(module, site.attr, site.abilityId, site.attrIndex);
    const tackle = allMoves[MoveId.TACKLE];
    for (const [name, attr] of [
      ["class", site.attr],
      ["rebuild", rebuilt],
    ] as const) {
      holder.summonData.chuckusterReductionUsed = false;
      const preview = new NumberHolder(100);
      attr.apply({ pokemon: holder, opponent: foe, move: tackle, damage: preview, simulated: true } as never);
      expect(preview.value, `${name}: preview damage`).toBe(50);
      expect(holder.summonData.chuckusterReductionUsed, `${name}: preview keeps the charge`).toBe(false);
      const real = new NumberHolder(100);
      expect(
        attr.canApply({ pokemon: holder, opponent: foe, move: tackle, damage: real, simulated: false } as never),
      ).toBe(true);
      attr.apply({ pokemon: holder, opponent: foe, move: tackle, damage: real, simulated: false } as never);
      expect(real.value, `${name}: real damage`).toBe(50);
      expect(holder.summonData.chuckusterReductionUsed, `${name}: charge spent`).toBe(true);
      expect(
        attr.canApply({
          pokemon: holder,
          opponent: foe,
          move: tackle,
          damage: new NumberHolder(100),
          simulated: false,
        } as never),
        `${name}: second contact hit`,
      ).toBe(false);
    }
  });

  it("a staff-changed gate (any move) and multiplier change only those; the charge guard stays in the class", async () => {
    const { holder, foe } = await startWorld(phaserGame);
    const module = moduleOf("OncePerEntryContactDamageReductionAbAttr");
    const site = sitesOf("OncePerEntryContactDamageReductionAbAttr")[0];
    const anyMove = recomposeAttr(module, site.attr, site.abilityId, site.attrIndex, {
      params: { multiplier: 0.25 },
      conds: { gate: { all: [] } },
    });
    const waterGun = allMoves[MoveId.WATER_GUN];
    holder.summonData.chuckusterReductionUsed = false;
    const damage = new NumberHolder(100);
    const params = { pokemon: holder, opponent: foe, move: waterGun, damage, simulated: false } as never;
    expect(anyMove.canApply(params), "a non-contact move now passes").toBe(true);
    anyMove.apply(params);
    expect(damage.value).toBe(25);
    expect(
      anyMove.canApply({ ...(params as object), damage: new NumberHolder(100) } as never),
      "spent charge still blocks",
    ).toBe(false);
  });
});

describe("B10: PoisonedFoePurgeAbAttr (Tier B: the target is poisoned)", () => {
  let phaserGame: Phaser.Game;
  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("frozen original, refactored class and rebuild agree for every status of the target and for no target at all", async () => {
    const { holder, foe } = await startWorld(phaserGame);
    const module = moduleOf("PoisonedFoePurgeAbAttr");
    const sites = sitesOf("PoisonedFoePurgeAbAttr");
    expect(sites.map(site => site.abilityName)).toEqual(["Hemolysis"]);
    const original = sites[0].attr;
    const rebuilt = recomposeAttr(module, original, sites[0].abilityId, sites[0].attrIndex);
    expect(rebuilt).not.toBe(original);
    const tackle = allMoves[MoveId.TACKLE];
    const growl = allMoves[MoveId.GROWL];
    for (const status of [
      StatusEffect.NONE,
      StatusEffect.POISON,
      StatusEffect.TOXIC,
      StatusEffect.PARALYSIS,
      StatusEffect.SLEEP,
      StatusEffect.FREEZE,
      StatusEffect.BURN,
    ]) {
      setStatusOf(foe, status);
      for (const move of [tackle, growl]) {
        const params = { pokemon: holder, opponent: foe, move, hitResult: 0, simulated: false } as never;
        const want = status === StatusEffect.POISON || status === StatusEffect.TOXIC;
        expect(original.canApply(params), `class, ${StatusEffect[status]}, ${move.name}`).toBe(want);
        expect(rebuilt.canApply(params), `rebuild, ${StatusEffect[status]}, ${move.name}`).toBe(want);
      }
    }
    const noTarget = { pokemon: holder, opponent: undefined, move: tackle, hitResult: 0, simulated: false } as never;
    expect(original.canApply(noTarget), "class, no target").toBe(false);
    expect(rebuilt.canApply(noTarget), "rebuild, no target").toBe(false);
  });

  it("apply resets only raised stages, blocks healing once, and does nothing in a preview or without a target", async () => {
    const { holder, foe } = await startWorld(phaserGame);
    const module = moduleOf("PoisonedFoePurgeAbAttr");
    const site = sitesOf("PoisonedFoePurgeAbAttr")[0];
    const rebuilt = recomposeAttr(module, site.attr, site.abilityId, site.attrIndex);
    const tackle = allMoves[MoveId.TACKLE];
    for (const [name, attr] of [
      ["class", site.attr],
      ["rebuild", rebuilt],
    ] as const) {
      setStatusOf(foe, StatusEffect.TOXIC);
      foe.removeTag(BattlerTagType.HEAL_BLOCK);
      foe.setStatStage(Stat.ATK, 3);
      foe.setStatStage(Stat.DEF, -2);
      foe.setStatStage(Stat.SPD, 6);
      attr.apply({ pokemon: holder, opponent: foe, move: tackle, hitResult: 0, simulated: true } as never);
      expect(foe.getStatStage(Stat.ATK), `${name}: preview keeps boosts`).toBe(3);
      expect(foe.getTag(BattlerTagType.HEAL_BLOCK), `${name}: preview adds no block`).toBeUndefined();
      attr.apply({ pokemon: holder, opponent: undefined, move: tackle, hitResult: 0, simulated: false } as never);
      expect(foe.getStatStage(Stat.ATK), `${name}: no target`).toBe(3);
      attr.apply({ pokemon: holder, opponent: foe, move: tackle, hitResult: 0, simulated: false } as never);
      expect(foe.getStatStage(Stat.ATK), `${name}: boost cleared`).toBe(0);
      expect(foe.getStatStage(Stat.SPD), `${name}: boost cleared`).toBe(0);
      expect(foe.getStatStage(Stat.DEF), `${name}: lowered stage stays`).toBe(-2);
      const tag = foe.getTag(BattlerTagType.HEAL_BLOCK);
      expect(tag, `${name}: healing blocked`).toBeDefined();
      attr.apply({ pokemon: holder, opponent: foe, move: tackle, hitResult: 0, simulated: false } as never);
      expect(foe.getTag(BattlerTagType.HEAL_BLOCK), `${name}: the same block is kept`).toBe(tag);
    }
  });
});

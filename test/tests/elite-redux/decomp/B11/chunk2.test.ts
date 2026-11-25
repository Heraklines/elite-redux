/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { globalScene } from "#app/global-scene";
// B11 chunk 2: PreFaintReviveAbAttr, PostSummonRetrieverSnapshotAbAttr, PreSwitchOutItemRestoreAbAttr, PreemptivePriorityCounterAbAttr,
// PriorityModifierAbAttr, RechargeChargedOnElectricTerrainAbAttr, RechargeChargedOnElectricKoAbAttr and RecoilDamageMultiplierAbAttr.
// The shared L1 grid and the L2 twin cannot reach what these classes read (a lethal hit with a given hit count, an item that was knocked
// off, a foe's chosen command, a recharge turn, the by-name scans of recoil), so each rule is driven here on the ORIGINAL attr and on its
// REBUILD with real state. Where a gate is bound as a legacy closure (no library atom yet) the rebuild gets the SHIPPED gate handed in,
// which is what a staff rule that keeps the built-in condition does. Three things can go wrong in a rebuild: the codecs (the settings it
// reads back and feeds the constructor), the bound condition (an atom that is not the same predicate) and the pieces that stay in the
// class. The characterisation tests also pin the Tier B refactors against the formulas of the code they replaced.
import { allMoves } from "#data/data-lists";
import { getBinding } from "#data/elite-redux/ability-studio/bindings";
import { type CondInput, readDeclParams, recomposeAttr } from "#data/elite-redux/ability-studio/build-attr";
import { declRegistry } from "#data/elite-redux/ability-studio/decl-registry";
import type { DeclModule } from "#data/elite-redux/ability-studio/define-decl";
import { PreFaintReviveAbAttr } from "#data/elite-redux/archetypes/pre-faint-revive";
import { erRetrieverOriginalHeldItems } from "#data/elite-redux/archetypes/pre-switch-out-item-restore";
import { PriorityModifierAbAttr } from "#data/elite-redux/archetypes/priority-modifier";
import { TerrainType } from "#data/terrain";
import { AbilityId } from "#enums/ability-id";
import { BattlerTagType } from "#enums/battler-tag-type";
import { BerryType } from "#enums/berry-type";
import { Command } from "#enums/command";
import { MoveId } from "#enums/move-id";
import { MoveResult } from "#enums/move-result";
import { MoveUseMode } from "#enums/move-use-mode";
import { PokemonType } from "#enums/pokemon-type";
import { SpeciesId } from "#enums/species-id";
import { Stat } from "#enums/stat";
import { WeatherType } from "#enums/weather-type";
import { attrFingerprint } from "#test/tests/elite-redux/decomp/fingerprint";
import { freshGame, startWorld } from "#test/tests/elite-redux/decomp/harness/game";
import { type AttrSite, allAttrSites } from "#test/tests/elite-redux/decomp/harness/sites";
import { gridMoves, setWeatherOf } from "#test/tests/elite-redux/decomp/harness/world";
import { NumberHolder } from "#utils/common";
import Phaser from "phaser";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

const CLASSES = [
  "PreFaintReviveAbAttr",
  "PostSummonRetrieverSnapshotAbAttr",
  "PreSwitchOutItemRestoreAbAttr",
  "PreemptivePriorityCounterAbAttr",
  "PriorityModifierAbAttr",
  "RechargeChargedOnElectricTerrainAbAttr",
  "RechargeChargedOnElectricKoAbAttr",
  "RecoilDamageMultiplierAbAttr",
] as const;

/** Classes whose declaration is parked in requests/parked-decls-b11/ until the librarian adds the trigger they need. */
const PARKED: readonly string[] = ["PreemptivePriorityCounterAbAttr", "RecoilDamageMultiplierAbAttr"];

const sitesOf = (className: string): AttrSite[] => allAttrSites().filter(site => site.className === className);
const moduleOf = (className: string): DeclModule => declRegistry.get(className) as DeclModule;

/**
 * The rebuild of one shipped attr. A condition slot with a legacy-closure binding cannot come from the library, so the shipped
 * gate (the class's own `gate` method) is handed in.
 */
function rebuildSite(
  site: AttrSite,
  overrides: { params?: Record<string, string | number | boolean>; conds?: Record<string, CondInput> } = {},
): any {
  const module = moduleOf(site.className);
  const conds: Record<string, CondInput> = {};
  for (const slot of module.decl.conditions) {
    if (getBinding(site.abilityId, site.attrIndex, slot.slot)?.legacyClosure !== undefined) {
      const attr = site.attr as any;
      conds[slot.slot] = slot.slot === "gate" ? (params: never) => attr.gate(params) : attr[slot.path ?? "condition"];
    }
  }
  return recomposeAttr(module, site.attr, site.abilityId, site.attrIndex, {
    ...(overrides.params === undefined ? {} : { params: overrides.params }),
    conds: { ...conds, ...overrides.conds },
  });
}

const siteOf = (className: string, abilityName: string): AttrSite => {
  const site = sitesOf(className).find(candidate => candidate.abilityName === abilityName);
  if (site === undefined) {
    throw new Error(`${abilityName} has no ${className}`);
  }
  return site;
};

describe("B11 chunk 2: the eight classes", () => {
  let phaserGame: Phaser.Game;
  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("every user rebuilds to an identical attr and reads back the shipped settings", async () => {
    await startWorld(phaserGame);
    for (const className of CLASSES) {
      expect(sitesOf(className).length, className).toBeGreaterThan(0);
      if (!declRegistry.has(className)) {
        // Parked: its declaration waits for a trigger the library does not have yet (requests/B11.md R-B11-C2-08, R-B11-C2-13).
        expect(PARKED, className).toContain(className);
        continue;
      }
      for (const site of sitesOf(className)) {
        const rebuilt = rebuildSite(site);
        expect(attrFingerprint(rebuilt as never), `${site.abilityName} ${className}`).toEqual(
          attrFingerprint(site.attr as never),
        );
        expect(rebuilt.constructor.name).toBe(className);
      }
    }
    const read = (className: string, abilityName: string) =>
      readDeclParams(moduleOf(className), siteOf(className, abilityName).attr);
    expect(read("PreFaintReviveAbAttr", "Lucky Halo")).toEqual({ hpNeeded: 0, firstHitsOnly: 1 });
    expect(read("PriorityModifierAbAttr", "Galeforce Wings")).toEqual({
      priority: 1,
      movesBuiltFor: "Flying-type moves",
      whenBuiltFor: "Always",
    });
    expect(read("PriorityModifierAbAttr", "Flaming Soul")).toEqual({
      priority: 1,
      movesBuiltFor: "Fire-type moves",
      whenBuiltFor: "Only while I am at full HP",
    });
    expect(read("PriorityModifierAbAttr", "Blitz Boxer")).toMatchObject({ movesBuiltFor: "Punching moves" });
    expect(read("PriorityModifierAbAttr", "Presto")).toMatchObject({ movesBuiltFor: "Sound moves" });
    expect(read("PriorityModifierAbAttr", "Perfectionist")).toMatchObject({
      movesBuiltFor: "Moves with 25 base power or less",
      whenBuiltFor: "Always",
    });
    expect(read("PriorityModifierAbAttr", "Sighting System")).toEqual({
      priority: -3,
      movesBuiltFor: "Moves with less than 80% accuracy",
      whenBuiltFor: "Always",
    });
    if (declRegistry.has("RecoilDamageMultiplierAbAttr")) {
      for (const name of ["Limber", "Steadfast", "Daredevil", "Superheavy"]) {
        expect(read("RecoilDamageMultiplierAbAttr", name), name).toEqual({ factor: 0.5 });
      }
    }
  });

  it("the codecs refuse what the classes would refuse, in plain words", () => {
    const param = (className: string, id: string) => moduleOf(className).decl.params.find(p => p.id === id)!;
    expect(() => param("PriorityModifierAbAttr", "priority").codec!.toCtor(0)).toThrow(/other than 0/);
    expect(() => param("PreFaintReviveAbAttr", "hpNeeded").codec!.toCtor(101)).toThrow(/between 0 and 100/);
    expect(() => param("PreFaintReviveAbAttr", "firstHitsOnly").codec!.toCtor(-1)).toThrow(/whole number/);
    expect(() => param("PriorityModifierAbAttr", "movesBuiltFor").codec!.toCtor("Every move")).toThrow(
      /not one of the move choices/,
    );
    // 100 percent is "only at full HP"; any other value is a threshold; 0 and 1 hit the same boundary as the class does.
    expect(param("PreFaintReviveAbAttr", "hpNeeded").codec!.toCtor(100)).toEqual({ kind: "full-hp" });
    expect(param("PreFaintReviveAbAttr", "hpNeeded").codec!.toCtor(35)).toEqual({
      kind: "hp-threshold",
      threshold: 0.35,
    });
    expect(param("PreFaintReviveAbAttr", "firstHitsOnly").codec!.toCtor(0)).toEqual({ kind: "per-hit" });
    expect(param("PreFaintReviveAbAttr", "firstHitsOnly").codec!.toCtor(2)).toEqual({ kind: "first-n-hits", n: 2 });
    if (declRegistry.has("RecoilDamageMultiplierAbAttr")) {
      expect(() => param("RecoilDamageMultiplierAbAttr", "factor").codec!.toCtor(1)).toThrow(/above 0 and below 1/);
    }
  });

  // -------------------------------------------------------------------------------------------------------------
  it("PreFaintRevive: the Tier B split answers like the old canApply, and Lucky Halo and its rebuild agree", async () => {
    const { holder } = await startWorld(phaserGame);
    const lucky = siteOf("PreFaintReviveAbAttr", "Lucky Halo");
    const original = lucky.attr as any;
    const rebuilt = rebuildSite(lucky);
    // The same attr built with other settings: Sturdy (full HP, every turn) and "at least half HP, first 2 hits".
    const sturdy = new PreFaintReviveAbAttr();
    const halfHp = new PreFaintReviveAbAttr({
      gate: { kind: "hp-threshold", threshold: 0.5 },
      usage: { kind: "first-n-hits", n: 2 },
    });
    const rebuiltSturdy = recomposeAttr(moduleOf("PreFaintReviveAbAttr"), sturdy, 0, 0, {
      params: { hpNeeded: 100, firstHitsOnly: 0 },
      conds: { gate: { block: "hp.full", params: { who: "holder" } } },
    }) as any;

    // The formulas of the code the split replaced, clause by clause, in the old order.
    const oldCanApply = (attr: any, pokemon: any, damage: number): boolean => {
      if (!attr.matchesGate(pokemon.getHpRatio(true), pokemon.isFullHp())) {
        return false;
      }
      if (pokemon.getMaxHp() <= 1) {
        return false;
      }
      if (damage < pokemon.hp) {
        return false;
      }
      return attr.matchesUsage(pokemon);
    };

    const naturalMax = holder.stats[Stat.HP];
    let sawTrue = 0;
    let sawFalse = 0;
    for (const maxHp of [naturalMax, 100, 1, 2]) {
      holder.stats[Stat.HP] = maxHp;
      for (const hp of new Set([maxHp, Math.max(1, maxHp - 1), Math.ceil(maxHp / 2), Math.ceil(maxHp / 2) + 1, 1])) {
        holder.hp = hp;
        for (const damage of [hp - 1, hp, hp + 10]) {
          for (const hits of [0, 1, 2]) {
            for (const tag of [false, true]) {
              holder.battleData.hitCount = hits;
              if (tag) {
                holder.addTag(BattlerTagType.STURDY, 1);
              }
              const params = { pokemon: holder, damage: new NumberHolder(damage), simulated: false } as any;
              for (const [name, attr] of [
                ["Lucky Halo", original],
                ["Lucky Halo rebuilt", rebuilt],
                ["Sturdy", sturdy],
                ["Sturdy rebuilt", rebuiltSturdy],
                ["half HP", halfHp],
              ] as const) {
                const expected = oldCanApply(attr, holder, damage);
                const got = attr.canApply(params);
                expect(got, `${name}: hp ${hp}/${maxHp}, damage ${damage}, hits ${hits}, marker ${tag}`).toBe(expected);
                if (got) {
                  sawTrue++;
                } else {
                  sawFalse++;
                }
              }
              if (tag) {
                holder.removeTag(BattlerTagType.STURDY);
              }
            }
          }
        }
      }
    }
    holder.battleData.hitCount = 0;
    holder.stats[Stat.HP] = naturalMax;
    holder.hp = naturalMax;
    expect(sawTrue).toBeGreaterThan(20);
    expect(sawFalse).toBeGreaterThan(20);

    // Plain readings of the shipped rule: Lucky Halo saves a lethal hit at any HP while fewer than 1 hit has landed, once.
    holder.hp = 40;
    const lethal = { pokemon: holder, damage: new NumberHolder(40), simulated: false } as any;
    holder.battleData.hitCount = 0;
    expect(original.canApply(lethal)).toBe(true);
    holder.battleData.hitCount = 1;
    expect(original.canApply(lethal)).toBe(false);
    holder.battleData.hitCount = 0;
    expect(original.canApply({ ...lethal, damage: new NumberHolder(39) })).toBe(false);
    // Sturdy (every turn): only at full HP and without the one-turn marker.
    holder.hp = holder.getMaxHp();
    const fullLethal = { pokemon: holder, damage: new NumberHolder(holder.hp), simulated: false } as any;
    expect(sturdy.canApply(fullLethal)).toBe(true);
    holder.addTag(BattlerTagType.STURDY, 1);
    expect(sturdy.canApply(fullLethal)).toBe(false);
    holder.removeTag(BattlerTagType.STURDY);
    // apply: the marker is added for real and not in a preview.
    rebuilt.apply({ ...fullLethal, simulated: true });
    expect(holder.getTag(BattlerTagType.STURDY)).toBeUndefined();
    rebuilt.apply(fullLethal);
    expect(holder.getTag(BattlerTagType.STURDY)).toBeDefined();
    holder.removeTag(BattlerTagType.STURDY);
    // The setting that is the rule's "how often" survives a rebuild with another value.
    const everyTurn = recomposeAttr(moduleOf("PreFaintReviveAbAttr"), original, lucky.abilityId, lucky.attrIndex, {
      params: { firstHitsOnly: 0 },
    }) as any;
    holder.hp = 40;
    holder.battleData.hitCount = 5;
    expect(everyTurn.canApply(lethal), "every-turn mode ignores the hit count").toBe(true);
    holder.battleData.hitCount = 0;
  });

  // -------------------------------------------------------------------------------------------------------------
  it("PriorityModifier: the gate answers like the predicate the class used to hand its parent, for every option", async () => {
    const { holder } = await startWorld(phaserGame);
    const options: any[] = [
      { priority: 1, filter: { type: PokemonType.FLYING } },
      { priority: 1, filter: { type: PokemonType.FIRE }, condition: { kind: "full-hp" } },
      { priority: -3, filter: { maxAccuracy: 80 } },
      { priority: 1, filter: { maxBasePower: 25 } },
      { priority: 1, filter: { flag: 128 }, condition: { kind: "full-hp" } },
      { priority: 2, condition: { kind: "low-hp" } },
      { priority: 2, condition: { kind: "low-hp", threshold: 0.3 } },
      { priority: 1, filter: { type: PokemonType.WATER, maxBasePower: 90 }, condition: { kind: "first-turn" } },
    ];
    const attrs = options.map(opts => new PriorityModifierAbAttr(opts) as any);
    const maxHp = holder.getMaxHp();
    let checks = 0;
    for (const hp of [
      maxHp,
      maxHp - 1,
      Math.ceil(maxHp / 2),
      Math.floor(maxHp * 0.3),
      Math.floor(maxHp * 0.3) + 1,
      1,
    ]) {
      holder.hp = Math.max(1, hp);
      for (const turn of [0, 1, 2]) {
        holder.tempSummonData.waveTurnCount = turn;
        for (const move of gridMoves()) {
          for (const attr of attrs) {
            // `moveFunc` is the private predicate of the parent, built in the constructor exactly as before the split.
            const expected = attr.moveFunc(holder, move);
            const got = attr.canApply({ pokemon: holder, move, priority: new NumberHolder(0) });
            expect(
              got,
              `${JSON.stringify(attr.getFilter())} ${JSON.stringify(attr.getPriorityCondition())} hp ${holder.hp} turn ${turn} ${move.name}`,
            ).toBe(expected);
            checks++;
          }
        }
      }
    }
    expect(checks).toBeGreaterThan(1000);
    holder.hp = maxHp;
    holder.tempSummonData.waveTurnCount = 1;

    // The five gates that stay legacy closures, read plainly: the shipped gate gives the answers the abilities promise.
    const answer = (abilityName: string, moveId: MoveId, hp = holder.getMaxHp()): boolean => {
      holder.hp = hp;
      const site = siteOf("PriorityModifierAbAttr", abilityName);
      return (site.attr as any).canApply({ pokemon: holder, move: allMovesOf(moveId), priority: new NumberHolder(0) });
    };
    // A real move with an accuracy below 80, one at 100 and an always-hit move (accuracy -1) are looked up, not assumed.
    const inaccurate = allMoves.find(move => move.accuracy > 0 && move.accuracy < 80 && move.power > 0);
    expect(inaccurate, "the game has a damaging move below 80% accuracy").toBeDefined();
    expect(answer("Sighting System", inaccurate!.id), `${inaccurate!.name} is ${inaccurate!.accuracy}% accurate`).toBe(
      true,
    );
    const neverMisses = allMoves.find(move => move.accuracy < 0 && move.power > 0);
    expect(neverMisses, "the game has a damaging move that never misses").toBeDefined();
    expect(answer("Sighting System", MoveId.TACKLE), "Tackle is 100% accurate").toBe(false);
    expect(answer("Sighting System", neverMisses!.id), `${neverMisses!.name} never misses, so it never qualifies`).toBe(
      false,
    );
    expect(answer("Blitz Boxer", MoveId.MACH_PUNCH)).toBe(true);
    expect(answer("Blitz Boxer", MoveId.MACH_PUNCH, 50)).toBe(false);
    expect(answer("Blitz Boxer", MoveId.TACKLE)).toBe(false);
    expect(answer("Presto", MoveId.HYPER_VOICE)).toBe(true);
    expect(answer("Presto", MoveId.HYPER_VOICE, 50)).toBe(false);
    expect(answer("Perfectionist", MoveId.SPLASH), "a status move has power -1").toBe(true);
    expect(answer("Perfectionist", MoveId.TACKLE), "Tackle has 40 power").toBe(false);
    holder.hp = maxHp;

    // The rebuilds of the bound users carry the amount: a staff rule that changes it changes `apply`.
    const galeforce = siteOf("PriorityModifierAbAttr", "Galeforce Wings");
    const stronger = rebuildSite(galeforce, { params: { priority: 2 } });
    const holderPriority = new NumberHolder(0);
    stronger.apply({ pokemon: holder, move: allMovesOf(MoveId.GUST), priority: holderPriority });
    expect(holderPriority.value).toBe(2);
  });

  // -------------------------------------------------------------------------------------------------------------
  it("Retriever: the snapshot, the gate, the guard and the restore, original against rebuild", async () => {
    const game = freshGame(phaserGame);
    game.override
      .battleStyle("single")
      .moveset([MoveId.SPLASH])
      .ability(AbilityId.BALL_FETCH)
      .startingHeldItems([{ name: "LEFTOVERS" }])
      .startingLevel(100)
      .enemySpecies(SpeciesId.MAGIKARP)
      .enemyLevel(30)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemyMoveset(MoveId.SPLASH)
      .criticalHits(false);
    await game.classicMode.startBattle(SpeciesId.BLISSEY);
    const holder = game.field.getPlayerPokemon();
    expect(holder.getHeldItems().length).toBe(1);

    const snapshotSite = siteOf("PostSummonRetrieverSnapshotAbAttr", "Retriever");
    const restoreSite = siteOf("PreSwitchOutItemRestoreAbAttr", "Retriever");
    const snapshotRebuilt = rebuildSite(snapshotSite);
    const restoreRebuilt = rebuildSite(restoreSite);
    const pair = [restoreSite.attr as any, restoreRebuilt] as const;
    const both = (params: any): boolean[] => pair.map(attr => attr.canApply(params));
    const params = { pokemon: holder, simulated: false } as any;

    // 1. Nothing remembered, an item in hand, no berry: nothing to give back.
    expect(erRetrieverOriginalHeldItems(holder).length).toBe(0);
    expect(both(params)).toEqual([false, false]);
    // 2. The snapshot (rebuilt) remembers the item; still nothing to give back while it is held.
    snapshotRebuilt.apply(params);
    expect(erRetrieverOriginalHeldItems(holder).length).toBe(1);
    expect(both(params)).toEqual([false, false]);
    // 3. A recorded berry is enough on its own.
    holder.summonData.berriesEatenLast = [BerryType.SITRUS];
    expect(both(params)).toEqual([true, true]);
    holder.summonData.berriesEatenLast = [];
    // 4. Empty-handed with a memory: something to give back. A fainted holder gets nothing (the guard comes first).
    holder.loseHeldItem(holder.getHeldItems()[0]);
    globalScene.updateModifiers(true);
    expect(holder.getHeldItems().length).toBe(0);
    expect(both(params)).toEqual([true, true]);
    const hp = holder.hp;
    holder.hp = 0;
    expect(holder.isFainted()).toBe(true);
    expect(both(params)).toEqual([false, false]);
    holder.hp = hp;
    // 5. A preview changes nothing; the real apply gives the item back and forgets the berries.
    holder.summonData.berriesEatenLast = [BerryType.SITRUS];
    restoreRebuilt.apply({ pokemon: holder, simulated: true });
    expect(holder.getHeldItems().length).toBe(0);
    expect(holder.summonData.berriesEatenLast.length).toBe(1);
    restoreRebuilt.apply(params);
    expect(holder.getHeldItems().length).toBe(1);
    expect(holder.summonData.berriesEatenLast.length).toBe(0);
    expect(both(params)).toEqual([false, false]);
    // 6. The memory is replaced on a new entry, and forgotten when the holder carries nothing.
    holder.loseHeldItem(holder.getHeldItems()[0]);
    globalScene.updateModifiers(true);
    (snapshotSite.attr as any).apply(params);
    expect(erRetrieverOriginalHeldItems(holder).length).toBe(0);
    expect(both(params)).toEqual([false, false]);
  });

  // -------------------------------------------------------------------------------------------------------------
  it("Energized and Generator: the two recharge gates and their feasibility, original against rebuild", async () => {
    const { holder } = await startWorld(phaserGame);
    const terrainSite = siteOf("RechargeChargedOnElectricTerrainAbAttr", "Energized");
    const koSite = siteOf("RechargeChargedOnElectricKoAbAttr", "Energized");
    const terrain = [terrainSite.attr as any, rebuildSite(terrainSite)] as const;
    const ko = [koSite.attr as any, rebuildSite(koSite)] as const;

    for (const type of [TerrainType.ELECTRIC, TerrainType.GRASSY, TerrainType.NONE]) {
      const answers = terrain.map(attr => attr.canApply({ pokemon: holder, terrain: type, simulated: false }));
      expect(answers, `terrain ${type}`).toEqual(type === TerrainType.ELECTRIC ? [true, true] : [false, false]);
    }
    // Feasibility: a holder that is already charged cannot take the state again, the new terrain is Electric.
    terrain[1].apply({ pokemon: holder, terrain: TerrainType.ELECTRIC, simulated: true });
    expect(holder.getTag(BattlerTagType.CHARGED)).toBeUndefined();
    terrain[1].apply({ pokemon: holder, terrain: TerrainType.ELECTRIC, simulated: false });
    expect(holder.getTag(BattlerTagType.CHARGED)).toBeDefined();
    expect(
      terrain.map(attr => attr.canApply({ pokemon: holder, terrain: TerrainType.ELECTRIC, simulated: false })),
    ).toEqual([false, false]);
    holder.removeTag(BattlerTagType.CHARGED);

    const last = (move: MoveId | undefined): void => {
      holder.summonData.moveHistory = [];
      if (move !== undefined) {
        holder.pushMoveHistory({ move, targets: [], useMode: MoveUseMode.NORMAL, result: MoveResult.SUCCESS });
      }
    };
    const koParams = { pokemon: holder, simulated: false } as any;
    last(undefined);
    expect(
      ko.map(attr => attr.canApply(koParams)),
      "no move yet",
    ).toEqual([false, false]);
    last(MoveId.THUNDERBOLT);
    expect(
      ko.map(attr => attr.canApply(koParams)),
      "Thunderbolt",
    ).toEqual([true, true]);
    last(MoveId.TACKLE);
    expect(
      ko.map(attr => attr.canApply(koParams)),
      "Tackle",
    ).toEqual([false, false]);
    // The test reads the move's own printed type, so even a status move of that type counts.
    last(MoveId.THUNDER_WAVE);
    expect(
      ko.map(attr => attr.canApply(koParams)),
      "Thunder Wave",
    ).toEqual([true, true]);
    ko[1].apply({ pokemon: holder, simulated: true });
    expect(holder.getTag(BattlerTagType.CHARGED)).toBeUndefined();
    ko[1].apply(koParams);
    expect(holder.getTag(BattlerTagType.CHARGED)).toBeDefined();
    expect(
      ko.map(attr => attr.canApply(koParams)),
      "already charged",
    ).toEqual([false, false]);
    holder.removeTag(BattlerTagType.CHARGED);
    last(undefined);
  });

  // -------------------------------------------------------------------------------------------------------------
  it("Surprise!: queueCounters answers the same on the rebuild, and the fog test is carried over", async () => {
    const { game, holder, foe } = await startWorld(phaserGame);
    const site = siteOf("PreemptivePriorityCounterAbAttr", "Surprise!");
    const original = site.attr as any;
    // The rebuild half runs once the declaration is active (it is parked until the turn-start trigger exists).
    const rebuilt = declRegistry.has("PreemptivePriorityCounterAbAttr") ? rebuildSite(site) : original;
    expect(rebuilt.getCondition()).toBeTypeOf("function");

    const unshift = vi.spyOn(globalScene.phaseManager, "unshiftNew").mockImplementation((() => undefined) as any);
    const foeIndex = foe.getBattlerIndex();
    const calls = (attr: any): unknown[][] => {
      unshift.mockClear();
      attr.queueCounters(holder);
      return unshift.mock.calls.map(call => [
        call[0],
        call[1] === holder,
        call[2],
        (call[3] as any)?.moveId,
        call[4],
        call[5],
      ]);
    };
    const choose = (command: any): void => {
      (globalScene.currentBattle.turnCommands as any)[foeIndex] = command;
    };

    // The foe chose a priority move: one free Astonish, first in line, aimed at it.
    choose({ command: Command.FIGHT, move: { move: MoveId.QUICK_ATTACK, targets: [], useMode: MoveUseMode.NORMAL } });
    const priorityCalls = calls(original);
    expect(priorityCalls).toHaveLength(1);
    expect(priorityCalls[0][0]).toBe("MovePhase");
    expect(priorityCalls[0][1], "cast by the holder").toBe(true);
    expect(priorityCalls[0][2], "aimed at the foe").toEqual([foeIndex]);
    expect(priorityCalls[0][3]).toBe(MoveId.ASTONISH);
    expect(calls(rebuilt)).toEqual(priorityCalls);
    // A move without priority, a skipped command, a switch and no command at all: nothing is queued.
    choose({ command: Command.FIGHT, move: { move: MoveId.TACKLE, targets: [], useMode: MoveUseMode.NORMAL } });
    expect([calls(original), calls(rebuilt)]).toEqual([[], []]);
    choose({
      command: Command.FIGHT,
      skip: true,
      move: { move: MoveId.QUICK_ATTACK, targets: [], useMode: MoveUseMode.NORMAL },
    });
    expect([calls(original), calls(rebuilt)]).toEqual([[], []]);
    choose({ command: Command.POKEMON, args: [0, false] });
    expect([calls(original), calls(rebuilt)]).toEqual([[], []]);
    choose(null);
    expect([calls(original), calls(rebuilt)]).toEqual([[], []]);

    // The attr-level fog test (not a constructor argument) is the same closure on the rebuild.
    for (const weather of [WeatherType.NONE, WeatherType.FOG, WeatherType.EERIE_FOG, WeatherType.RAIN]) {
      setWeatherOf(game, weather);
      expect(rebuilt.getCondition()(holder), `weather ${weather}`).toBe(original.getCondition()(holder));
    }
    setWeatherOf(game, WeatherType.FOG);
    expect(original.getCondition()(holder)).toBe(true);
    setWeatherOf(game, WeatherType.NONE);
    expect(original.getCondition()(holder)).toBe(false);
  });

  // -------------------------------------------------------------------------------------------------------------
  it("recoil: every user multiplies by its factor, a rebuilt rule by the new one, and the engine still finds it by name", async () => {
    await startWorld(phaserGame);
    const active = declRegistry.has("RecoilDamageMultiplierAbAttr");
    for (const site of sitesOf("RecoilDamageMultiplierAbAttr")) {
      // The rebuild half runs once the declaration is active (it is parked until the recoil trigger exists).
      for (const attr of active ? [site.attr as any, rebuildSite(site)] : [site.attr as any]) {
        const holder = new NumberHolder(1);
        attr.fire(holder);
        expect(holder.value, site.abilityName).toBe(0.5);
        expect(attr.constructor.name).toBe("RecoilDamageMultiplierAbAttr");
      }
    }
    if (active) {
      const quarter = rebuildSite(siteOf("RecoilDamageMultiplierAbAttr", "Daredevil"), { params: { factor: 0.25 } });
      const holder = new NumberHolder(8);
      quarter.fire(holder);
      expect(holder.value).toBe(2);
    }
  });
});

function allMovesOf(id: MoveId): any {
  return allMoves[id];
}

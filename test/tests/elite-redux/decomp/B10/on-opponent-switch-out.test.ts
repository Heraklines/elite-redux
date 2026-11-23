/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { globalScene } from "#app/global-scene";
// B10 chunk 1, the scripted-move classes that react to a foe: OnOpponentSwitchOutAbAttr (Tag, Super Sniper; found by name in the
// switch phase) and OnOpponentStatRaiseScriptedMoveAbAttr (Retribution Blow; the Opportunist hook), plus the marker class
// OnOpponentStatRaiseAbAttr (Egoist). None of them can be shown evaluated by the L2 twin with the attr on the holder, so each user
// is rebuilt from its declaration and driven next to the original: the queued MovePhase (user, target, move id, real power,
// use mode) must be identical, and so must every guard (fainted foe, no foe, simulated).
import { allMoves } from "#data/data-lists";
import { buildAttr, readDeclParams, recomposeAttr } from "#data/elite-redux/ability-studio/build-attr";
import { declRegistry } from "#data/elite-redux/ability-studio/decl-registry";
import type { DeclModule } from "#data/elite-redux/ability-studio/define-decl";
import type { OnOpponentStatRaiseScriptedMoveAbAttr } from "#data/elite-redux/archetypes/on-opponent-stat-raise";
import type { OnOpponentSwitchOutAbAttr } from "#data/elite-redux/archetypes/on-opponent-switch-out";
import { MoveId } from "#enums/move-id";
import { Stat } from "#enums/stat";
import type { Pokemon } from "#field/pokemon";
import { attrFingerprint } from "#test/tests/elite-redux/decomp/fingerprint";
import { startWorld } from "#test/tests/elite-redux/decomp/harness/game";
import { allAttrSites } from "#test/tests/elite-redux/decomp/harness/sites";
import Phaser from "phaser";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

const switchModule = declRegistry.get("OnOpponentSwitchOutAbAttr") as DeclModule;
const strikeModule = declRegistry.get("OnOpponentStatRaiseScriptedMoveAbAttr") as DeclModule;
const copyModule = declRegistry.get("OnOpponentStatRaiseAbAttr") as DeclModule;

/** What a queued phase looks like once the move object is reduced to what it will do. */
function describeCall(args: unknown[]): unknown[] {
  const move = args[3] as { moveId: number; getMove(): { power: number } } | undefined;
  if (args[0] === "MovePhase") {
    return ["MovePhase", (args[1] as Pokemon).id, args[2], move?.moveId, move?.getMove().power, args[4]];
  }
  return args.map(arg => (typeof arg === "object" ? JSON.stringify(arg) : arg));
}

describe("B10: strike a foe as it switches out (OnOpponentSwitchOutAbAttr)", () => {
  let phaserGame: Phaser.Game;
  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });
  const sitesOf = (className: string) => allAttrSites().filter(site => site.className === className);

  it("has Tag and Super Sniper as users and the rebuilds are identical", async () => {
    await startWorld(phaserGame);
    const sites = sitesOf("OnOpponentSwitchOutAbAttr");
    expect(sites.map(site => site.abilityName).sort()).toEqual(["Super Sniper", "Tag"]);
    for (const site of sites) {
      const rebuilt = recomposeAttr(switchModule, site.attr, site.abilityId, site.attrIndex);
      expect(rebuilt).not.toBe(site.attr);
      expect(attrFingerprint(rebuilt as never), site.abilityName).toEqual(attrFingerprint(site.attr as never));
    }
  });

  it("the original and the rebuild queue the same move at the leaving foe, and skip a fainted or missing foe", async () => {
    const { holder, foe } = await startWorld(phaserGame);
    const calls: unknown[][] = [];
    vi.spyOn(globalScene.phaseManager, "unshiftNew").mockImplementation(((...args: unknown[]) => {
      calls.push(describeCall(args));
    }) as never);
    const powers: Record<string, number | undefined> = {};
    for (const site of sitesOf("OnOpponentSwitchOutAbAttr")) {
      const original = site.attr as unknown as OnOpponentSwitchOutAbAttr;
      const rebuilt = recomposeAttr(
        switchModule,
        site.attr,
        site.abilityId,
        site.attrIndex,
      ) as unknown as OnOpponentSwitchOutAbAttr;
      for (const [label, leaving, fainted] of [
        ["leaving foe", foe, false],
        ["fainted foe", foe, true],
        ["no foe", undefined, false],
      ] as const) {
        vi.spyOn(foe, "isFainted").mockImplementation((() => fainted) as never);
        calls.length = 0;
        original.fire(holder, leaving as never);
        const fromOriginal = [...calls];
        calls.length = 0;
        rebuilt.fire(holder, leaving as never);
        expect(calls, `${site.abilityName}: ${label}`).toEqual(fromOriginal);
        expect(fromOriginal.length, `${site.abilityName}: ${label}`).toBe(label === "leaving foe" ? 1 : 0);
        if (label === "leaving foe") {
          expect(fromOriginal[0][3]).toBe(MoveId.PURSUIT);
          powers[site.abilityName] = fromOriginal[0][4] as number | undefined;
        }
      }
    }
    // Tag keeps Pursuit's own power, Super Sniper strikes at 20
    expect(powers["Super Sniper"]).toBe(20);
    expect(powers.Tag).toBe(allMoves[MoveId.PURSUIT].power);
  });

  it("the move and its power are two separate settings, and a missing power has no power key at all", async () => {
    await startWorld(phaserGame);
    for (const module of [switchModule, strikeModule]) {
      expect(module.decl.params.map(param => param.id)).toEqual(["moveId", "power"]);
      expect(module.decl.params.find(param => param.id === "power")?.control).toBe("number");
    }
    const sniper = allAttrSites().find(
      site => site.abilityName === "Super Sniper" && site.className === "OnOpponentSwitchOutAbAttr",
    )!;
    const tag = allAttrSites().find(
      site => site.abilityName === "Tag" && site.className === "OnOpponentSwitchOutAbAttr",
    )!;
    const blow = allAttrSites().find(site => site.className === "OnOpponentStatRaiseScriptedMoveAbAttr")!;
    expect(readDeclParams(switchModule, sniper.attr)).toEqual({ moveId: "PURSUIT", power: 20 });
    expect(readDeclParams(switchModule, tag.attr)).toEqual({ moveId: "PURSUIT", power: 0 });
    expect(readDeclParams(strikeModule, blow.attr)).toEqual({ moveId: "HYPER_BEAM", power: 150 });
    const opts = (attr: unknown): unknown => (attr as { opts: unknown }).opts;
    expect(opts(buildAttr(switchModule, { moveId: "PURSUIT", power: 0 }))).toEqual({ moveId: MoveId.PURSUIT });
    expect(opts(buildAttr(switchModule, { moveId: "pursuit", power: 20 }))).toEqual({
      moveId: MoveId.PURSUIT,
      power: 20,
    });
    expect(opts(buildAttr(strikeModule, { moveId: "Hyper Beam", power: 150 }))).toEqual({
      moveId: MoveId.HYPER_BEAM,
      power: 150,
    });
    expect(() => buildAttr(switchModule, { moveId: "Not a move", power: 0 })).toThrow();
    expect(() => buildAttr(switchModule, { moveId: "PURSUIT", power: 999 })).toThrow();
  });
});

describe("B10: react to a foe's stat boost (OnOpponentStatRaiseScriptedMoveAbAttr and OnOpponentStatRaiseAbAttr)", () => {
  let phaserGame: Phaser.Game;
  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("Retribution Blow: original and rebuild queue the same Hyper Beam at the first living foe, never when simulated or with no foe", async () => {
    const { holder, foe } = await startWorld(phaserGame);
    const site = allAttrSites().find(candidate => candidate.className === "OnOpponentStatRaiseScriptedMoveAbAttr")!;
    expect(site.abilityName).toBe("Retribution Blow");
    const original = site.attr as unknown as OnOpponentStatRaiseScriptedMoveAbAttr;
    const rebuilt = recomposeAttr(
      strikeModule,
      site.attr,
      site.abilityId,
      site.attrIndex,
    ) as unknown as OnOpponentStatRaiseScriptedMoveAbAttr;
    expect(attrFingerprint(rebuilt as never)).toEqual(attrFingerprint(original as never));
    const calls: unknown[][] = [];
    vi.spyOn(globalScene.phaseManager, "unshiftNew").mockImplementation(((...args: unknown[]) => {
      calls.push(describeCall(args));
    }) as never);
    for (const [label, simulated, foes] of [
      ["a living foe", false, [foe]],
      ["a preview", true, [foe]],
      ["no living foe", false, []],
    ] as const) {
      vi.spyOn(holder, "getOpponents").mockReturnValue([...foes] as never);
      const params = { pokemon: holder, stats: [Stat.ATK], numStages: 2, simulated } as never;
      calls.length = 0;
      original.apply(params);
      const fromOriginal = [...calls];
      calls.length = 0;
      rebuilt.apply(params);
      expect(calls, label).toEqual(fromOriginal);
      expect(fromOriginal.length, label).toBe(label === "a living foe" ? 1 : 0);
      if (label === "a living foe") {
        expect(fromOriginal[0][3]).toBe(MoveId.HYPER_BEAM);
        expect(fromOriginal[0][4]).toBe(150);
      }
    }
  });

  it("Egoist: original and rebuild copy the same stat for the same number of stages, as an uncopyable self change", async () => {
    const { holder } = await startWorld(phaserGame);
    const site = allAttrSites().find(candidate => candidate.className === "OnOpponentStatRaiseAbAttr")!;
    expect(site.abilityName).toBe("Egoist");
    const rebuilt = recomposeAttr(copyModule, site.attr, site.abilityId, site.attrIndex);
    expect(attrFingerprint(rebuilt as never)).toEqual(attrFingerprint(site.attr as never));
    const calls: unknown[][] = [];
    vi.spyOn(globalScene.phaseManager, "unshiftNew").mockImplementation(((...args: unknown[]) => {
      calls.push(describeCall(args));
    }) as never);
    for (const attr of [site.attr, rebuilt]) {
      calls.length = 0;
      (attr as unknown as { apply(p: never): void }).apply({
        pokemon: holder,
        stats: [Stat.DEF, Stat.SPDEF],
        numStages: 2,
        simulated: false,
      } as never);
      expect(calls).toEqual([
        [
          "StatStageChangePhase",
          holder.getBattlerIndex(),
          true,
          JSON.stringify([Stat.DEF, Stat.SPDEF]),
          2,
          true,
          false,
          false,
        ],
      ]);
      calls.length = 0;
      (attr as unknown as { apply(p: never): void }).apply({
        pokemon: holder,
        stats: [Stat.DEF],
        numStages: 1,
        simulated: true,
      } as never);
      expect(calls).toEqual([]);
    }
  });
});

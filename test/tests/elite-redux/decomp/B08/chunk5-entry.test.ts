/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { globalScene } from "#app/global-scene";
import { buildAttr, readDeclParams, recomposeAttr } from "#data/elite-redux/ability-studio/build-attr";
import { NOT_USED } from "#data/elite-redux/ability-studio/decl/B08/chunk5-choices";
import { declRegistry } from "#data/elite-redux/ability-studio/decl-registry";
import { FOREWARN_FUTURE_SIGHT_ID } from "#data/elite-redux/init-elite-redux-vanilla-rebalance";
import { startWorld } from "#test/tests/elite-redux/decomp/harness/game";
import { allAttrSites } from "#test/tests/elite-redux/decomp/harness/sites";
import Phaser from "phaser";
import { beforeAll, describe, expect, it, vi } from "vitest";

type Any = any;

// B08 chunk 5: the two entry-effect classes. The shared L1 proves that the rebuilt attr has the same live configuration for every user; this
// file proves, for all 71 users, that the rebuilt attr DOES the same thing: it is applied next to the original with the arena and phase
// queue spied (same calls, same arguments, same order), the once-memory is compared, and the options object of every kind is checked for
// leftover keys (the once-key and the configuration read them).
describe("B08 chunk 5: entry-effect classes", () => {
  let phaserGame: Phaser.Game;
  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  const sitesOf = () =>
    allAttrSites().filter(
      site => site.className === "EntryEffectAbAttr" || site.className === "EntryArenaTagOnFoeSideAbAttr",
    );

  const configOf = (attr: Any): unknown => attr.effect ?? { tag: attr.tag, turns: attr.turns, side: attr.side };

  it("every kind renders plain player words even when its own settings are still 'Not used'", () => {
    const decl: Any = declRegistry.get("EntryEffectAbAttr")!.decl;
    const kinds = [
      "Set the weather",
      "Set a terrain",
      "Set one terrain picked at random",
      "Lay a trap on the field",
      "Set a screen, room or other field effect",
      "Add a type to myself",
      "Change one of my own stats",
      "Use a move",
    ];
    for (const kind of kinds) {
      for (const once of [false, true]) {
        const text = String(
          decl.summary({
            kind,
            weather: NOT_USED,
            terrain: NOT_USED,
            terrains: NOT_USED,
            hazard: NOT_USED,
            hazardSide: NOT_USED,
            tag: NOT_USED,
            type: NOT_USED,
            stat: NOT_USED,
            move: NOT_USED,
            turns: 8,
            layers: 1,
            stages: 1,
            once,
          }),
        );
        expect(text.toLowerCase(), kind).not.toContain("not used");
        expect(text, kind).not.toContain("undefined");
      }
    }
  });

  it("the choice list names the Forewarn-only Future Sight copy by its real id", () => {
    expect(FOREWARN_FUTURE_SIGHT_ID).toBe(9500);
  });

  it("all 71 users: original and rebuilt attr make the same calls, in the same order, and leave the same memory", async () => {
    const { holder } = await startWorld(phaserGame);
    const sites = sitesOf();
    expect(sites).toHaveLength(71);
    const arena = globalScene.arena as Any;
    const phases = globalScene.phaseManager as Any;
    const record: string[] = [];
    const show = (value: unknown): string => JSON.stringify(value, (_k, v) => (v === holder ? "holder" : v));
    vi.spyOn(arena, "addTag").mockImplementation((...args: unknown[]) => {
      record.push(`addTag ${show(args)}`);
      return true;
    });
    vi.spyOn(arena, "trySetWeather").mockImplementation((...args: unknown[]) => {
      record.push(`weather ${show(args)}`);
      return true;
    });
    vi.spyOn(arena, "trySetTerrain").mockImplementation((...args: unknown[]) => {
      record.push(`terrain ${show(args)}`);
      return true;
    });
    vi.spyOn(arena, "getTagOnSide").mockImplementation(() => undefined);
    vi.spyOn(phases, "unshiftNew").mockImplementation((...args: unknown[]) => {
      record.push(`phase ${show(args)}`);
    });
    // The random terrain pick must not depend on the test's seed.
    vi.spyOn(holder as Any, "randBattleSeedInt").mockImplementation((max: number) => max - 1);
    const run = (attr: Any): { calls: string[]; memory: string[]; types: unknown } => {
      holder.waveData.entryEffectsFired.clear();
      (holder.summonData as Any).types = [];
      record.length = 0;
      attr.apply({ pokemon: holder, simulated: false });
      return {
        calls: [...record],
        memory: [...holder.waveData.entryEffectsFired],
        types: (holder.summonData as Any).types,
      };
    };
    let checked = 0;
    for (const site of sites) {
      const module = declRegistry.get(site.className)!;
      const rebuilt = recomposeAttr(module, site.attr, site.abilityId, site.attrIndex) as Any;
      const original = run(site.attr);
      const twin = run(rebuilt);
      expect(twin, `${site.abilityName} attr ${site.attrIndex}`).toEqual(original);
      expect(configOf(rebuilt), site.abilityName).toEqual(configOf(site.attr));
      // A preview must change nothing for the rebuilt one either.
      record.length = 0;
      holder.waveData.entryEffectsFired.clear();
      rebuilt.apply({ pokemon: holder, simulated: true });
      expect(record).toEqual([]);
      expect([...holder.waveData.entryEffectsFired]).toEqual([]);
      checked++;
    }
    expect(checked).toBe(71);
    vi.restoreAllMocks();
  });

  it("each kind built from scratch keeps only its own keys in the options object", () => {
    const module = declRegistry.get("EntryEffectAbAttr")!;
    const effectOf = (params: Record<string, string | number | boolean>): unknown =>
      (buildAttr(module, params) as Any).effect;
    const unused = {
      weather: NOT_USED,
      terrain: NOT_USED,
      terrains: "",
      turns: 0,
      hazard: NOT_USED,
      layers: 0,
      hazardSide: NOT_USED,
      tag: NOT_USED,
      type: NOT_USED,
      stat: NOT_USED,
      stages: 0,
      move: NOT_USED,
    };
    expect(effectOf({ ...unused, kind: "Set the weather", weather: "Heavy rain", turns: 8 })).toEqual({
      kind: "set-weather",
      weather: 7,
      turns: 8,
    });
    expect(effectOf({ ...unused, kind: "Set a terrain", terrain: "Toxic", turns: 8 })).toEqual({
      kind: "set-terrain",
      terrain: 5,
      turns: 8,
    });
    expect(
      effectOf({ ...unused, kind: "Set one terrain picked at random", terrains: "Grassy, Psychic", turns: 8 }),
    ).toEqual({ kind: "set-terrain-random", terrains: [3, 4], turns: 8 });
    expect(
      effectOf({
        ...unused,
        kind: "Lay a trap on the field",
        hazard: "Spikes",
        layers: 2,
        hazardSide: "The foes' side",
      }),
    ).toEqual({ kind: "set-hazard", hazard: "SPIKES", layers: 2, side: "foe" });
    expect(effectOf({ ...unused, kind: "Lay a trap on the field", hazard: "Hot Coals" })).toEqual({
      kind: "set-hazard",
      hazard: "HOT_COALS",
    });
    expect(
      effectOf({ ...unused, kind: "Set a screen, room or other field effect", tag: "Tailwind", turns: 3 }),
    ).toEqual({ kind: "set-screen-or-room", tag: "TAILWIND", turns: 3 });
    expect(effectOf({ ...unused, kind: "Add a type to myself", type: "Normal" })).toEqual({
      kind: "add-self-type",
      type: 0,
    });
    expect(effectOf({ ...unused, kind: "Change one of my own stats", stat: "Sp. Def", stages: -1 })).toEqual({
      kind: "self-stat-boost",
      stat: 4,
      stages: -1,
    });
    expect(effectOf({ ...unused, kind: "Use a move", move: "Future Sight (80 power, never misses)" })).toEqual({
      kind: "scripted-move",
      move: 9500,
    });
  });

  it("every setting of every user reads back from the live attr (nothing falls back to a default)", async () => {
    await startWorld(phaserGame);
    for (const site of sitesOf()) {
      const module = declRegistry.get(site.className)!;
      const read = readDeclParams(module, site.attr);
      expect(Object.keys(read).sort(), `${site.abilityName} attr ${site.attrIndex}`).toEqual(
        module.decl.params.map(param => param.id).sort(),
      );
    }
    const decree = sitesOf().find(site => site.abilityName === "Royal Decree")!;
    expect(readDeclParams(declRegistry.get("EntryEffectAbAttr")!, decree.attr).once).toBe(true);
  });
});

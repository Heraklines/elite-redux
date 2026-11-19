/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B10 chunk 2, PersistentFieldAuraAbAttr (Fire Aspect, Polarity, Rat King). The class is found BY NAME inside Pokemon.getStat
// (PersistentFieldAuraAbAttr.applyAuras), so the shared L2 twin cannot show it evaluated. The REAL engine function is called here
// for the original attr and for the rebuild of each live user, over a holder, an ally and a foe, several stats and several base stat
// totals, and the results must be identical. The `allies` setting is the only way the ally filter (a function) survives a rebuild,
// so its read-back and its writing are checked on their own.
import { globalScene } from "#app/global-scene";
import { readDeclParams, recomposeAttr } from "#data/elite-redux/ability-studio/build-attr";
import { AURA_ALL_ALLIES, auraAlliesCodec, auraStatsCodec } from "#data/elite-redux/ability-studio/decl/B10/b10-codecs";
import { declRegistry } from "#data/elite-redux/ability-studio/decl-registry";
import type { DeclModule } from "#data/elite-redux/ability-studio/define-decl";
import { PersistentFieldAuraAbAttr } from "#data/elite-redux/archetypes/persistent-field-aura";
import { Stat } from "#enums/stat";
import { attrFingerprint } from "#test/tests/elite-redux/decomp/fingerprint";
import { startWorld } from "#test/tests/elite-redux/decomp/harness/game";
import { allAttrSites } from "#test/tests/elite-redux/decomp/harness/sites";
import { NumberHolder } from "#utils/common";
import Phaser from "phaser";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

const MODULE = declRegistry.get("PersistentFieldAuraAbAttr") as DeclModule;

interface Stub {
  readonly name: string;
  readonly side: "player" | "enemy";
  readonly total: number;
  attrs: unknown[];
  isFainted: () => boolean;
  isPlayer: () => boolean;
  species: { baseStats: number[] };
  getAllActiveAbilityAttrs: () => unknown[];
}

function stub(name: string, side: "player" | "enemy", total: number): Stub {
  const mon: Stub = {
    name,
    side,
    total,
    attrs: [],
    isFainted: () => false,
    isPlayer: () => side === "player",
    species: { baseStats: [total, 0, 0, 0, 0, 0] },
    getAllActiveAbilityAttrs: () => mon.attrs,
  };
  return mon;
}

describe("B10: PersistentFieldAuraAbAttr (side aura read by name)", () => {
  let phaserGame: Phaser.Game;
  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("three users; their settings read back as sentences; the rebuilds have the same fields", async () => {
    await startWorld(phaserGame);
    const sites = allAttrSites().filter(site => site.className === "PersistentFieldAuraAbAttr");
    expect(sites.map(site => site.abilityName).sort()).toEqual(["Fire Aspect", "Polarity", "Rat King"]);
    const byName = Object.fromEntries(sites.map(site => [site.abilityName, readDeclParams(MODULE, site.attr)]));
    expect(byName["Fire Aspect"]).toEqual({
      stats: "Speed",
      multiplier: 2,
      includeSelf: false,
      allies: AURA_ALL_ALLIES,
    });
    expect(byName.Polarity).toEqual({
      stats: "Attack, Sp. Atk, Defense, Sp. Def, Speed",
      multiplier: 1.3,
      includeSelf: true,
      allies: AURA_ALL_ALLIES,
    });
    expect(byName["Rat King"]).toEqual({
      stats: "Attack, Defense, Sp. Atk, Sp. Def, Speed",
      multiplier: 1.5,
      includeSelf: false,
      allies: "Only Pokemon whose base stat total is below 400",
    });
    for (const site of sites) {
      const rebuilt = recomposeAttr(MODULE, site.attr, site.abilityId, site.attrIndex);
      expect(rebuilt).not.toBe(site.attr);
      expect(attrFingerprint(rebuilt as never)).toEqual(attrFingerprint(site.attr as never));
    }
  });

  it("the engine's own applyAuras gives the same stat for the original and the rebuild of every user", async () => {
    await startWorld(phaserGame);
    const sites = allAttrSites().filter(site => site.className === "PersistentFieldAuraAbAttr");
    let compared = 0;
    for (const site of sites) {
      const original = site.attr;
      const rebuilt = recomposeAttr(MODULE, original, site.abilityId, site.attrIndex);
      for (const [name, attr] of [
        ["class", original],
        ["rebuild", rebuilt],
      ] as const) {
        const holder = stub("holder", "player", 500);
        const subjects = [
          holder,
          stub("light ally", "player", 399),
          stub("borderline ally", "player", 400),
          stub("heavy ally", "player", 600),
          stub("foe", "enemy", 100),
        ];
        holder.attrs = [attr];
        vi.spyOn(globalScene, "getField").mockReturnValue([...subjects] as never);
        const seen: Record<string, number> = {};
        for (const subject of subjects) {
          for (const stat of [Stat.ATK, Stat.DEF, Stat.SPATK, Stat.SPDEF, Stat.SPD]) {
            const value = new NumberHolder(100);
            PersistentFieldAuraAbAttr.applyAuras(subject as never, stat as never, value);
            seen[`${subject.name}/${Stat[stat]}`] = value.value;
          }
        }
        // expected, written from the users' rules
        const rule = site.abilityName;
        const boost = rule === "Fire Aspect" ? 2 : rule === "Polarity" ? 1.3 : 1.5;
        const stats = rule === "Fire Aspect" ? [Stat.SPD] : [Stat.ATK, Stat.DEF, Stat.SPATK, Stat.SPDEF, Stat.SPD];
        for (const subject of subjects) {
          for (const stat of [Stat.ATK, Stat.DEF, Stat.SPATK, Stat.SPDEF, Stat.SPD]) {
            const sameSide = subject.side === "player";
            const self = subject === holder;
            const includeSelf = rule === "Polarity";
            const filtered = rule === "Rat King" ? subject.total < 400 : true;
            const gets = stats.includes(stat) && sameSide && (!self || includeSelf) && filtered;
            expect(seen[`${subject.name}/${Stat[stat]}`], `${name} ${rule}: ${subject.name} ${Stat[stat]}`).toBe(
              gets ? 100 * boost : 100,
            );
            compared++;
          }
        }
        vi.restoreAllMocks();
      }
    }
    expect(compared).toBe(3 * 2 * 5 * 5);
  });

  it("two aura holders compound, and an aura holder that has fainted gives nothing", async () => {
    await startWorld(phaserGame);
    const site = allAttrSites().find(
      candidate => candidate.abilityName === "Fire Aspect" && candidate.className === "PersistentFieldAuraAbAttr",
    )!;
    const rebuilt = recomposeAttr(MODULE, site.attr, site.abilityId, site.attrIndex);
    const first = stub("first", "player", 500);
    const second = stub("second", "player", 500);
    const ally = stub("ally", "player", 300);
    first.attrs = [site.attr];
    second.attrs = [rebuilt];
    vi.spyOn(globalScene, "getField").mockReturnValue([first, second, ally] as never);
    const both = new NumberHolder(100);
    PersistentFieldAuraAbAttr.applyAuras(ally as never, Stat.SPD as never, both);
    expect(both.value).toBe(400);
    second.isFainted = () => true;
    const one = new NumberHolder(100);
    PersistentFieldAuraAbAttr.applyAuras(ally as never, Stat.SPD as never, one);
    expect(one.value).toBe(200);
  });

  it("the stat list and the ally filter are written and read back both ways, and nonsense is refused", () => {
    expect(auraStatsCodec.toCtor("Speed, Sp. Atk")).toEqual([Stat.SPD, Stat.SPATK]);
    expect(auraStatsCodec.fromInstance([Stat.SPD, Stat.SPATK])).toBe("Speed, Sp. Atk");
    expect(() => auraStatsCodec.toCtor("Luck")).toThrow(/not a known stat/);
    expect(() => auraStatsCodec.toCtor("")).toThrow(/at least one stat/);
    const below = auraAlliesCodec.toCtor("Only Pokemon whose base stat total is below 450") as (
      ally: unknown,
    ) => boolean;
    const ask = (total: number): boolean => below({ species: { baseStats: [total, 0, 0, 0, 0, 0] } });
    expect([ask(449), ask(450)]).toEqual([true, false]);
    expect(auraAlliesCodec.fromInstance(below)).toBe("Only Pokemon whose base stat total is below 450");
    expect(auraAlliesCodec.toCtor(AURA_ALL_ALLIES)).toBeUndefined();
    expect(auraAlliesCodec.fromInstance(() => true)).toBe(AURA_ALL_ALLIES);
    expect(auraAlliesCodec.fromInstance(() => false)).toBeUndefined();
    expect(
      auraAlliesCodec.fromInstance((ally: { species: { baseStats: number[] } }) => ally.species.baseStats[0] % 2 === 0),
    ).toBeUndefined();
    expect(() => auraAlliesCodec.toCtor("whoever")).toThrow(/Write/);
  });
});

/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { globalScene } from "#app/global-scene";
// B10 chunk 1, OnFaintEffectAbAttr (a package of seven "when I faint" effects).
// The L2 faint scenario never makes the engine evaluate a PostFaint attr of the holder, so this file is the behavioural proof:
//  1. the sentence codec round-trips all seven payload kinds (built directly, because only three kinds are used by a live ability)
//     and every rebuilt attr has the original's fingerprint;
//  2. every live user (the rebuild of Haunted Spirit, Vengeful Spirit, Guilt Trip, Ill Will and the Cursed Spirit part) gives the
//     same canApply answer and the same side effects as the original for an attacker that is normal, a Ghost, fainted, or absent;
//  3. the codec refuses text that is not one of the seven forms.
import { allMoves } from "#data/data-lists";
import { buildAttr, readDeclParams } from "#data/elite-redux/ability-studio/build-attr";
import { declRegistry } from "#data/elite-redux/ability-studio/decl-registry";
import type { DeclModule } from "#data/elite-redux/ability-studio/define-decl";
import { OnFaintEffectAbAttr } from "#data/elite-redux/archetypes/on-faint-effect";
import { TerrainType } from "#data/terrain";
import { ArenaTagType } from "#enums/arena-tag-type";
import { BattlerTagType } from "#enums/battler-tag-type";
import { MoveId } from "#enums/move-id";
import { PokemonType } from "#enums/pokemon-type";
import { Stat } from "#enums/stat";
import { WeatherType } from "#enums/weather-type";
import type { Pokemon } from "#field/pokemon";
import { attrFingerprint } from "#test/tests/elite-redux/decomp/fingerprint";
import { startWorld } from "#test/tests/elite-redux/decomp/harness/game";
import { allAttrSites } from "#test/tests/elite-redux/decomp/harness/sites";
import Phaser from "phaser";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { rebuildWithClassGate } from "./rebuild-with-class-gate";

const module = declRegistry.get("OnFaintEffectAbAttr") as DeclModule;

const PAYLOADS: readonly { label: string; effect: object }[] = [
  { label: "weather", effect: { kind: "set-weather", weather: WeatherType.SANDSTORM } },
  { label: "terrain", effect: { kind: "set-terrain", terrain: TerrainType.GRASSY } },
  { label: "damage", effect: { kind: "attacker-damage-flat", maxHpFraction: 0.25 } },
  { label: "hazard with layers", effect: { kind: "set-hazard", hazard: ArenaTagType.SPIKES, layers: 2 } },
  { label: "hazard without layers", effect: { kind: "set-hazard", hazard: ArenaTagType.STEALTH_ROCK } },
  { label: "tag, bare", effect: { kind: "attacker-battler-tag", tagType: BattlerTagType.CURSED } },
  {
    label: "tag with turns and exclusions",
    effect: {
      kind: "attacker-battler-tag",
      tagType: BattlerTagType.CURSED,
      turns: 3,
      excludeAttackerTypes: [PokemonType.DARK],
    },
  },
  {
    label: "stats",
    effect: {
      kind: "attacker-stat-change",
      stats: [
        { stat: Stat.ATK, stages: -2 },
        { stat: Stat.SPATK, stages: -2 },
      ],
      allyStats: [
        { stat: Stat.ATK, stages: -1 },
        { stat: Stat.SPATK, stages: -1 },
      ],
    },
  },
  { label: "stats without allies", effect: { kind: "attacker-stat-change", stats: [{ stat: Stat.SPD, stages: 1 }] } },
  { label: "drain PP", effect: { kind: "attacker-pp-drain" } },
];

describe("B10: do something when I faint (OnFaintEffectAbAttr)", () => {
  let phaserGame: Phaser.Game;
  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });
  const sitesOf = () => allAttrSites().filter(site => site.className === "OnFaintEffectAbAttr");

  it("every payload kind is read back as separate settings, and the rebuild equals the original", async () => {
    await startWorld(phaserGame);
    for (const { label, effect } of PAYLOADS) {
      const original = new OnFaintEffectAbAttr({ effect: effect as never });
      const params = readDeclParams(module, original as never);
      expect(typeof params.kind, `${label}: the kind is a setting`).toBe("string");
      const rebuilt: OnFaintEffectAbAttr = buildAttr(module, params, {
        gate: ((p: unknown) => rebuilt.gate(p as never)) as never,
      }) as unknown as OnFaintEffectAbAttr;
      expect(rebuilt.getEffect(), label).toEqual(effect);
      expect(attrFingerprint(rebuilt as never), label).toEqual(attrFingerprint(original as never));
    }
  });

  it("the settings are real numbers, types, stats and lists, not a sentence", async () => {
    await startWorld(phaserGame);
    const ids = module.decl.params.map(param => param.id);
    for (const id of [
      "kind",
      "weather",
      "terrain",
      "hurtPercent",
      "hazard",
      "layers",
      "tag",
      "turns",
      "skipType",
      "stat",
      "stages",
      "allyStages",
    ]) {
      expect(ids, id).toContain(id);
    }
    expect(module.decl.params.some(param => param.control === "text")).toBe(false);
    const guilt = sitesOf().find(site => site.abilityName === "Guilt Trip") as never as { attr: never };
    expect(readDeclParams(module, guilt.attr)).toMatchObject({
      kind: "Change the stats of the Pokemon that knocked me out",
      stat: "ATK",
      stages: -2,
      stat2: "SPATK",
      stages2: -2,
      allyStages: -1,
      allyStages2: -1,
    });
  });

  it("refuses settings that are not valid", async () => {
    await startWorld(phaserGame);
    const bad: Record<string, string | number>[] = [
      { kind: "Sing a song" },
      { kind: "Set the weather", weather: "Cloudy with meatballs" },
      { kind: "Set the weather", weather: "NONE" },
      { kind: "Hurt the Pokemon that knocked me out", hurtPercent: 0 },
      { kind: "Hurt the Pokemon that knocked me out", hurtPercent: 400 },
      { kind: "Change the stats of the Pokemon that knocked me out", stages: 0 },
      { kind: "Put a lasting effect on the Pokemon that knocked me out", tag: "BANANA" },
    ];
    for (const params of bad) {
      expect(() => buildAttr(module, params, { gate: (() => true) as never }), JSON.stringify(params)).toThrow();
    }
  });

  it("has the five live users and each rebuild is identical", async () => {
    await startWorld(phaserGame);
    const names = sitesOf().map(site => site.abilityName);
    for (const name of ["Haunted Spirit", "Vengeful Spirit", "Guilt Trip", "Ill Will"]) {
      expect(names, name).toContain(name);
    }
    for (const site of sitesOf()) {
      const rebuilt = rebuildWithClassGate(module, site.attr, site.abilityId, site.attrIndex);
      expect(rebuilt).not.toBe(site.attr);
      expect(attrFingerprint(rebuilt as never), site.abilityName).toEqual(attrFingerprint(site.attr as never));
    }
  });

  it("original and rebuild answer canApply the same and cause the same effects, for a normal, a Ghost, a fainted and a missing attacker", async () => {
    const { holder, foe, game } = await startWorld(phaserGame);
    game.move.changeMoveset(foe, MoveId.TACKLE);
    const log: unknown[] = [];
    vi.spyOn(globalScene.phaseManager, "unshiftNew").mockImplementation(((...args: unknown[]) => {
      log.push(["phase", args[0], args[1], args[2], args[3], args[4]]);
    }) as never);
    vi.spyOn(globalScene.phaseManager, "queueMessage").mockImplementation(((message: string) => {
      log.push(["message", message]);
    }) as never);
    vi.spyOn(foe, "addTag").mockImplementation(((...args: unknown[]) => {
      log.push(["tag", args[0], args[1]]);
      return true;
    }) as never);
    vi.spyOn(foe, "damageAndUpdate").mockImplementation(((amount: number) => {
      log.push(["damage", amount]);
      return amount;
    }) as never);

    const attackers: { name: string; attacker: Pokemon | undefined; ghost: boolean; fainted: boolean }[] = [
      { name: "normal attacker", attacker: foe, ghost: false, fainted: false },
      { name: "ghost attacker", attacker: foe, ghost: true, fainted: false },
      { name: "fainted attacker", attacker: foe, ghost: false, fainted: true },
      { name: "no attacker", attacker: undefined, ghost: false, fainted: false },
    ];
    for (const site of sitesOf()) {
      const original = site.attr as unknown as OnFaintEffectAbAttr;
      const rebuilt = rebuildWithClassGate(
        module,
        site.attr,
        site.abilityId,
        site.attrIndex,
      ) as unknown as OnFaintEffectAbAttr;
      for (const { name, attacker, ghost, fainted } of attackers) {
        const run = (attr: OnFaintEffectAbAttr): unknown[] => {
          log.length = 0;
          foe.getMoveset().forEach(move => {
            move.ppUsed = 0;
          });
          vi.spyOn(foe, "isOfType").mockImplementation(
            ((type: PokemonType) => ghost && type === PokemonType.GHOST) as never,
          );
          vi.spyOn(foe, "isFainted").mockImplementation((() => fainted) as never);
          const params = { pokemon: holder, attacker, move: allMoves[MoveId.TACKLE], simulated: false } as never;
          const can = attr.canApply(params);
          if (can) {
            attr.apply(params);
          }
          return [can, ...log, foe.getMoveset()[0]?.ppUsed];
        };
        const a = run(original);
        const b = run(rebuilt);
        expect(b, `${site.abilityName}: ${name}`).toEqual(a);
      }
    }
  });
});

/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B08 chunk 2, ConditionalAlwaysHitAbAttr (live declaration, trigger calc.always-hit-check).
// The class is read by a duck-typed scan in the accuracy check (MoveEffectPhase), so the shared L1 and L2 tests cannot see
// its answer. Here every one of its 38 live users is rebuilt from the live declaration (`buildAttr` with the params read
// back from the live instance) and compared with the original: the read-back values, the structural fingerprint and the
// answer of `matches(move, user, target)` over moves, weathers, the target's types (super effective or not), the target's
// lasting effect and whether it is trapped.
import { TrappedTag } from "#data/battler-tags";
import { allMoves } from "#data/data-lists";
import { buildAttr, readDeclParams } from "#data/elite-redux/ability-studio/build-attr";
import { declRegistry } from "#data/elite-redux/ability-studio/decl-registry";
import type { DeclModule } from "#data/elite-redux/ability-studio/define-decl";
import type { ConditionalAlwaysHitAbAttr } from "#data/elite-redux/archetypes/conditional-always-hit";
import { BattlerTagType } from "#enums/battler-tag-type";
import { MoveId } from "#enums/move-id";
import { PokemonType } from "#enums/pokemon-type";
import { WeatherType } from "#enums/weather-type";
import { attrFingerprint } from "#test/tests/elite-redux/decomp/fingerprint";
import { startWorld } from "#test/tests/elite-redux/decomp/harness/game";
import { allAttrSites } from "#test/tests/elite-redux/decomp/harness/sites";
import { setTypesOf, setWeatherOf } from "#test/tests/elite-redux/decomp/harness/world";
import Phaser from "phaser";
import { beforeAll, describe, expect, it } from "vitest";

const module = declRegistry.get("ConditionalAlwaysHitAbAttr") as DeclModule;

describe("B08 chunk 2: never miss with the moves I choose (ConditionalAlwaysHitAbAttr)", () => {
  let phaserGame: Phaser.Game;
  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  const sitesOf = () => allAttrSites().filter(site => site.className === "ConditionalAlwaysHitAbAttr");

  it("covers the 38 live users", async () => {
    await startWorld(phaserGame);
    expect(sitesOf()).toHaveLength(38);
  });

  it("every user reads back, rebuilds to an identical attr, and answers matches() like the original", async () => {
    const world = await startWorld(phaserGame);
    const { game, holder, foe } = world;
    const sites = sitesOf();
    const probeMoves = new Set<MoveId>([
      MoveId.TACKLE,
      MoveId.WATER_GUN,
      MoveId.EMBER,
      MoveId.BITE,
      MoveId.SLASH,
      MoveId.HYPER_VOICE,
      MoveId.MACH_PUNCH,
      MoveId.MEGAHORN,
      MoveId.GROWL,
      MoveId.SWORDS_DANCE,
      MoveId.HYPNOSIS,
      MoveId.BLIZZARD,
      MoveId.THUNDER,
      MoveId.FOCUS_BLAST,
      MoveId.EERIE_SPELL,
    ]);
    for (const site of sites) {
      const opts = (site.attr as unknown as { opts: { moveIds?: readonly MoveId[]; flag?: number } }).opts;
      for (const id of opts.moveIds ?? []) {
        probeMoves.add(id);
      }
      if (opts.flag !== undefined) {
        const withFlag = allMoves.filter(move => move !== undefined && move.hasFlag(opts.flag as number));
        for (const move of withFlag.slice(0, 3)) {
          probeMoves.add(move.id);
        }
      }
    }
    const weathers = [WeatherType.NONE, WeatherType.FOG, WeatherType.EERIE_FOG, WeatherType.RAIN, WeatherType.SUNNY];
    const targetTypes: readonly (readonly PokemonType[] | undefined)[] = [
      undefined,
      [PokemonType.GRASS],
      [PokemonType.WATER],
      [PokemonType.FLYING, PokemonType.BUG],
    ];
    const foeAny = foe as any;
    const realGetTag = foeAny.getTag.bind(foe);
    let hits = 0;
    let misses = 0;
    try {
      for (const site of sites) {
        const params = readDeclParams(module, site.attr);
        // Every declared param must be readable from the live instance, or the rebuild would silently use a default.
        expect(Object.keys(params).sort(), `${site.abilityName}: params read back`).toEqual(
          module.decl.params.map(param => param.id).sort(),
        );
        const rebuilt = buildAttr(module, params) as unknown as ConditionalAlwaysHitAbAttr;
        expect(attrFingerprint(rebuilt as never), `${site.abilityName}: fingerprint`).toEqual(
          attrFingerprint(site.attr),
        );
        expect(readDeclParams(module, rebuilt as never), `${site.abilityName}: read back after the rebuild`).toEqual(
          params,
        );
        const original = site.attr as unknown as ConditionalAlwaysHitAbAttr;
        for (const weather of weathers) {
          setWeatherOf(game, weather);
          for (const types of targetTypes) {
            setTypesOf(foe, types);
            for (const trapped of [false, true]) {
              for (const tag of [undefined, BattlerTagType.CONFUSED, BattlerTagType.ER_BLEED]) {
                foeAny.getTag = ((t: unknown) =>
                  (trapped && t === TrappedTag) || (tag !== undefined && t === tag)
                    ? { tagType: t }
                    : realGetTag(t)) as never;
                for (const id of probeMoves) {
                  const a = original.matches(allMoves[id], holder, foe);
                  const b = rebuilt.matches(allMoves[id], holder, foe);
                  expect(
                    b,
                    `${site.abilityName}: ${MoveId[id]}, weather ${WeatherType[weather]}, target ${types?.map(t => PokemonType[t]).join("/") ?? "natural"}, trapped ${trapped}, tag ${tag ?? "none"}`,
                  ).toBe(a);
                  if (a) {
                    hits++;
                  } else {
                    misses++;
                  }
                }
              }
            }
          }
        }
      }
    } finally {
      foeAny.getTag = realGetTag;
      setWeatherOf(game, WeatherType.NONE);
      setTypesOf(foe, undefined);
    }
    // Both answers (never misses and no promise) must have been seen, or the comparison would be vacuous.
    expect(hits).toBeGreaterThan(0);
    expect(misses).toBeGreaterThan(0);
  }, 600_000);

  it("the settings reach the compiled attr", () => {
    const flagged = buildAttr(module, {
      flag: "SOUND_BASED",
      category: "Status",
    }) as unknown as ConditionalAlwaysHitAbAttr;
    expect(flagged.opts.flag).toBeDefined();
    expect(flagged.opts.categories).toEqual([2]);
    expect(Object.hasOwn(flagged.opts, "weather")).toBe(false);
    expect(() => buildAttr(module, { flag: "NOT_A_FLAG" })).toThrow();
  });
});

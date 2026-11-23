/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B08 chunk 2, review round 3. What the shared L0/L1/L2 suites cannot see:
//   1. player words: no choice list of the chunk 2 declarations (and of the status-on-hit sibling) shows an enum constant, and the
//      word codecs (statuses, moves, weather, move property) read back exactly what they write;
//   2. the two atoms added for this round (tag.trapped, time.once-per-unused) call the same predicate as the class they replace;
//   3. Drakelp Head: the multiplier, the stat, the number of stages and the target are real params that reach the class, and the
//      one-time shield is the library memory, read by one half and spent by the other.
import { TrappedTag } from "#data/battler-tags";
import { allMoves } from "#data/data-lists";
import { buildAttr, readDeclParams, recomposeAttr } from "#data/elite-redux/ability-studio/build-attr";
import {
  FLAG_WORDS,
  MOVE_NAMES,
  moveNamesCodec,
  propertyCodec,
  STATUS_CHOICES,
  statusNamesCodec,
  WEATHER_NAMES,
  weatherNamesCodec,
} from "#data/elite-redux/ability-studio/decl/B08/tag-choices";
import { declRegistry } from "#data/elite-redux/ability-studio/decl-registry";
import type { DeclModule } from "#data/elite-redux/ability-studio/define-decl";
import { MOVE_FLAG_OPTIONS } from "#data/elite-redux/ability-studio/vocabulary/enums";
import { compileConditionBlock } from "#data/elite-redux/ability-studio/vocabulary/evaluate/conditions";
import type { Frame } from "#data/elite-redux/ability-studio/vocabulary/evaluate/frame";
import { FIRST_DEFEND_SPENT_KEY } from "#data/elite-redux/archetypes/consume-on-first-defend";
import { BattlerTagType } from "#enums/battler-tag-type";
import { MoveFlags } from "#enums/move-flags";
import { MoveId } from "#enums/move-id";
import { Stat } from "#enums/stat";
import { StatusEffect } from "#enums/status-effect";
import { WeatherType } from "#enums/weather-type";
import { startWorld } from "#test/tests/elite-redux/decomp/harness/game";
import { allAttrSites } from "#test/tests/elite-redux/decomp/harness/sites";
import Phaser from "phaser";
import { beforeAll, describe, expect, it } from "vitest";

const CHUNK_2 = [
  "ChanceBattlerTagOnHitAbAttr",
  "ChanceStatusOnAttackAbAttr",
  "ChanceBattlerTagOnAttackAbAttr",
  "ConditionalAlwaysHitAbAttr",
  "ConditionalDamageAbAttr",
  "FirstDefendDamageReductionAbAttr",
  "FirstDefendAttackerAtkDropAbAttr",
  "ContactQuashAbAttr",
  "ChanceStatusOnHitAbAttr",
];

/** A single enum constant such as POISON, SLICING_MOVE or FOCUS_BLAST (the words a player never types). */
const ENUM_CONSTANT = /^[A-Z][A-Z0-9]*(_[A-Z0-9]+)*$/;

describe("B08 chunk 2 review: player words", () => {
  it("no choice list of the chunk 2 declarations shows an enum constant", () => {
    const shown: string[] = [];
    for (const className of CHUNK_2) {
      const module = declRegistry.get(className) as DeclModule;
      expect(module, className).toBeDefined();
      for (const param of module.decl.params) {
        for (const option of param.options ?? []) {
          if (ENUM_CONSTANT.test(option) && option !== "HP") {
            shown.push(`${className}.${param.id}: ${option}`);
          }
        }
        // The default is what a new block starts with, so it must be a word too.
        if (typeof param.default === "string" && ENUM_CONSTANT.test(param.default)) {
          shown.push(`${className}.${param.id} default: ${param.default}`);
        }
      }
    }
    expect(shown).toEqual([]);
  });

  it("statuses are named like a player names them and read back unchanged", () => {
    expect(STATUS_CHOICES.map(([name]) => name)).toEqual([
      "Poisoned",
      "Badly poisoned",
      "Paralyzed",
      "Asleep",
      "Frozen",
      "Burned",
    ]);
    expect(statusNamesCodec.toCtor("Poisoned, Burned")).toEqual([StatusEffect.POISON, StatusEffect.BURN]);
    expect(statusNamesCodec.toCtor("badly poisoned")).toEqual([StatusEffect.TOXIC]);
    expect(statusNamesCodec.fromInstance([StatusEffect.TOXIC, StatusEffect.PARALYSIS])).toBe(
      "Badly poisoned, Paralyzed",
    );
    expect(() => statusNamesCodec.toCtor("POISON")).toThrow();
  });

  it("every move and weather has its own player name that reads back to it", () => {
    expect(new Set(MOVE_NAMES).size).toBe(MOVE_NAMES.length);
    expect(MOVE_NAMES).toContain("Focus blast");
    expect(WEATHER_NAMES).toContain("Heavy rain");
    for (const name of MOVE_NAMES) {
      const [id] = moveNamesCodec.toCtor(name) as number[];
      expect(moveNamesCodec.fromInstance([id]), name).toBe(name);
    }
    for (const name of WEATHER_NAMES) {
      const [id] = weatherNamesCodec.toCtor(name) as number[];
      expect(weatherNamesCodec.fromInstance([id]), name).toBe(name);
    }
    expect(moveNamesCodec.toCtor("Focus blast, Hypnosis")).toEqual([MoveId.FOCUS_BLAST, MoveId.HYPNOSIS]);
    // The old constant spelling still loads (saved rules), it is only never shown.
    expect(moveNamesCodec.toCtor("FOCUS_BLAST")).toEqual([MoveId.FOCUS_BLAST]);
    expect(weatherNamesCodec.toCtor("Fog, Eerie fog")).toEqual([WeatherType.FOG, WeatherType.EERIE_FOG]);
    expect(() => moveNamesCodec.toCtor("Not a move")).toThrow();
  });

  it("every move property has words and reads back", () => {
    for (const flag of MOVE_FLAG_OPTIONS) {
      expect(FLAG_WORDS[flag], flag).toBeDefined();
      const value = (MoveFlags as unknown as Record<string, number>)[flag];
      expect(propertyCodec.toCtor(FLAG_WORDS[flag])).toBe(value);
      expect(propertyCodec.fromInstance(value)).toBe(FLAG_WORDS[flag]);
    }
    expect(propertyCodec.toCtor("None")).toBeUndefined();
    expect(propertyCodec.fromInstance(undefined)).toBe("None");
  });
});

describe("B08 chunk 2 review: atoms and Drakelp Head", () => {
  let phaserGame: Phaser.Game;
  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  const frameOf = (parts: Partial<Frame> & Pick<Frame, "holder">): Frame => ({ simulated: false, ...parts });

  it("tag.trapped asks the class's own question (getTag(TrappedTag)), not the plain Trapped tag", async () => {
    const { holder, foe } = await startWorld(phaserGame);
    const trapped = compileConditionBlock({ block: "tag.trapped", params: { who: "other" } });
    const foeAny = foe as any;
    const realGetTag = foeAny.getTag.bind(foe);
    try {
      foeAny.getTag = ((tag: unknown) => (tag === TrappedTag ? { tagType: "any trapping tag" } : undefined)) as never;
      expect(trapped(frameOf({ holder, other: foe }))).toBe(true);
      // Only the plain Trapped enum entry: the class does not look for it (it looks for the class and its subclasses).
      foeAny.getTag = ((tag: unknown) => (tag === BattlerTagType.TRAPPED ? { tagType: tag } : undefined)) as never;
      expect(trapped(frameOf({ holder, other: foe }))).toBe(false);
      foeAny.getTag = (() => undefined) as never;
      expect(trapped(frameOf({ holder, other: foe }))).toBe(false);
      expect(trapped(frameOf({ holder }))).toBe(false);
    } finally {
      foeAny.getTag = realGetTag;
    }
  });

  it("time.once-per-unused only reads the memory that time.once-per spends", async () => {
    const { holder } = await startWorld(phaserGame);
    const memory = holder.waveData.entryEffectsFired;
    memory.delete("review-key");
    const unused = compileConditionBlock({
      block: "time.once-per-unused",
      params: { scope: "wave", key: "review-key" },
    });
    const spend = compileConditionBlock({ block: "time.once-per", params: { scope: "wave", key: "review-key" } });
    expect(unused(frameOf({ holder }))).toBe(true);
    expect(unused(frameOf({ holder }))).toBe(true);
    expect(memory.has("review-key")).toBe(false); // reading never spends
    expect(spend(frameOf({ holder }))).toBe(true); // no commit list: it writes at once
    expect(memory.has("review-key")).toBe(true);
    expect(unused(frameOf({ holder }))).toBe(false);
    expect(spend(frameOf({ holder }))).toBe(false);
    memory.delete("review-key");
  });

  it("Drakelp Head: the numbers and the stat are real params, the shield is the library memory", async () => {
    const { holder, foe } = await startWorld(phaserGame);
    const damageModule = declRegistry.get("FirstDefendDamageReductionAbAttr") as DeclModule;
    const dropModule = declRegistry.get("FirstDefendAttackerAtkDropAbAttr") as DeclModule;
    const damageSite = allAttrSites().find(site => site.className === "FirstDefendDamageReductionAbAttr")!;
    const dropSite = allAttrSites().find(site => site.className === "FirstDefendAttackerAtkDropAbAttr")!;
    expect(readDeclParams(damageModule, damageSite.attr)).toEqual({ multiplier: 0.5 });
    expect(readDeclParams(dropModule, dropSite.attr)).toEqual({ stat: "Attack", stages: -1, target: "The attacker" });

    // A different number, stat and target reach the class through the real constructor.
    const gate = { all: [] };
    const quarter = buildAttr(damageModule, { multiplier: 0.25 }, { gate }) as any;
    expect(quarter.damageMultiplier).toBe(0.25);
    const speed = buildAttr(dropModule, { stat: "Speed", stages: -2, target: "Me" }, { gate }) as any;
    expect([speed.stat, speed.stages, speed.selfTarget]).toEqual([Stat.SPD, -2, true]);
    expect(() => buildAttr(dropModule, { stat: "ATK" }, { gate })).toThrow();

    // The shield: the damage half reads it, the Attack-drop half spends it, in the same memory the library atoms use.
    const damageHalf = damageSite.attr as any;
    const dropHalf = dropSite.attr as any;
    const damageRebuilt = recomposeAttr(
      damageModule,
      damageSite.attr,
      damageSite.abilityId,
      damageSite.attrIndex,
    ) as any;
    const dropRebuilt = recomposeAttr(dropModule, dropSite.attr, dropSite.abilityId, dropSite.attrIndex) as any;
    const tackle = allMoves[MoveId.TACKLE];
    const statusMove = allMoves[MoveId.SWORDS_DANCE];
    const hit = (move: typeof tackle) => ({
      pokemon: holder,
      opponent: foe,
      move,
      simulated: false,
      damage: { value: 10 },
    });
    holder.waveData.entryEffectsFired.delete(FIRST_DEFEND_SPENT_KEY);
    try {
      for (const [name, half] of [
        ["original", [damageHalf, dropHalf]],
        ["rebuilt", [damageRebuilt, dropRebuilt]],
      ] as const) {
        holder.waveData.entryEffectsFired.delete(FIRST_DEFEND_SPENT_KEY);
        expect(half[0].canApply(hit(tackle)), `${name}: damage half, first damaging hit`).toBe(true);
        expect(half[0].canApply(hit(statusMove)), `${name}: damage half, status move`).toBe(false);
        // The damage half never spends the shield, however often it is asked.
        expect(half[0].canApply(hit(tackle)), `${name}: damage half again`).toBe(true);
        expect(
          holder.waveData.entryEffectsFired.has(FIRST_DEFEND_SPENT_KEY),
          `${name}: not spent by the damage half`,
        ).toBe(false);
        expect(half[1].canApply(hit(tackle)), `${name}: drop half, first damaging hit`).toBe(true);
        // The drop half spends it when it applies (the stat change itself is the parent's phase; only the memory is checked here).
        holder.waveData.entryEffectsFired.add(FIRST_DEFEND_SPENT_KEY);
        expect(half[0].canApply(hit(tackle)), `${name}: damage half after the shield is spent`).toBe(false);
        expect(half[1].canApply(hit(tackle)), `${name}: drop half after the shield is spent`).toBe(false);
      }
    } finally {
      holder.waveData.entryEffectsFired.delete(FIRST_DEFEND_SPENT_KEY);
    }
  });
});

/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B01 chunk 3 proof for the attrs whose closure or gate is still a legacy-closure (requests R-B01-10, 21, 23): the shared
// L2 cannot rebuild them, so nothing there checks the declaration's settings, codecs and constructor wiring for them.
// Here every such attr is rebuilt from its declaration with its OWN original closure (or gate) handed over as the override,
// run through a real battle twin, and compared with the original. A mutation (the rebuild without the attr) must differ,
// which proves the scenario really makes the attr act. A second test reads every setting back from the live attrs and
// compares it with the value written by hand from the source, and proves the "Higher attack" codec equals erHigherAttackStat.
import type { AbAttr } from "#abilities/ab-attrs";
import { allAbilities } from "#data/data-lists";
import { readDeclParams } from "#data/elite-redux/ability-studio/build-attr";
import { declRegistry } from "#data/elite-redux/ability-studio/decl-registry";
import { MoveId } from "#enums/move-id";
import { Stat } from "#enums/stat";
import { twinRebuild } from "#test/tests/elite-redux/decomp/B01/twin-helpers";
import { startWorld } from "#test/tests/elite-redux/decomp/harness/game";
import type { AttrOverride } from "#test/tests/elite-redux/decomp/harness/rebuild";
import type { ScenarioSpec } from "#test/tests/elite-redux/decomp/harness/scenarios";
import { TEMPLATES } from "#test/tests/elite-redux/decomp/harness/scenarios";
import Phaser from "phaser";
import { beforeAll, describe, expect, it } from "vitest";

const hit = (move: MoveId, id: string): ScenarioSpec => ({
  ...TEMPLATES["foe-hits-holder"],
  id,
  label: `The enemy uses ${MoveId[move]} on the holder on two turns`,
  foeMoves: [move],
});

interface LegacyCase {
  readonly name: string;
  readonly abilityId: number;
  readonly className: string;
  /** attr indices of the class inside the ability. */
  readonly attrIndices: readonly number[];
  readonly slot: "ctor:0" | "gate";
  /** The field that holds the original closure (ctor slots only). */
  readonly closureField?: string;
  readonly move: MoveId;
  readonly axes?: Record<string, readonly string[]>;
}

const CASES: readonly LegacyCase[] = [
  {
    name: "Wind Rider",
    abilityId: 274,
    className: "MoveImmunityStatStageChangeAbAttr",
    attrIndices: [0],
    slot: "ctor:0",
    closureField: "immuneCondition",
    move: MoveId.AIR_CUTTER,
  },
  {
    name: "Gooey",
    abilityId: 183,
    className: "PostDefendStatStageChangeAbAttr",
    attrIndices: [0],
    slot: "ctor:0",
    closureField: "condition",
    move: MoveId.TACKLE,
  },
  {
    name: "Mucus Membrane",
    abilityId: 5685,
    className: "PostDefendStatStageChangeAbAttr",
    attrIndices: [0],
    slot: "ctor:0",
    closureField: "condition",
    move: MoveId.TACKLE,
  },
  {
    name: "Slime Mold",
    abilityId: 5734,
    className: "PostDefendStatStageChangeAbAttr",
    attrIndices: [1],
    slot: "ctor:0",
    closureField: "condition",
    move: MoveId.TACKLE,
  },
  {
    name: "Toxic Debris",
    abilityId: 295,
    className: "PostDefendApplyArenaTrapTagAbAttr",
    attrIndices: [0],
    slot: "ctor:0",
    closureField: "condition",
    move: MoveId.TACKLE,
  },
  {
    name: "Wind Power",
    abilityId: 277,
    className: "PostDefendApplyBattlerTagAbAttr",
    attrIndices: [0],
    slot: "ctor:0",
    closureField: "condition",
    move: MoveId.AIR_CUTTER,
  },
  {
    name: "Anger Shell",
    abilityId: 271,
    className: "PostDefendHpGatedStatStageChangeAbAttr",
    attrIndices: [0, 1],
    slot: "gate",
    move: MoveId.TACKLE,
    axes: { hp: ["50%+1"] },
  },
  {
    name: "No Turning Back",
    abilityId: 5372,
    className: "PostDefendHpGatedStatStageChangeAbAttr",
    attrIndices: [0],
    slot: "gate",
    move: MoveId.TACKLE,
    axes: { hp: ["50%+1"] },
  },
  {
    name: "Seed Sower",
    abilityId: 269,
    className: "PostDefendTerrainChangeAbAttr",
    attrIndices: [0],
    slot: "gate",
    move: MoveId.TACKLE,
  },
];

describe("B01 chunk 3: legacy-bound attrs rebuilt from their declaration with their own closure", () => {
  let phaserGame: Phaser.Game;
  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  for (const testCase of CASES) {
    it(`${testCase.name}: the rebuild acts exactly like the original, and without the attr the battle differs`, async () => {
      const ability = allAbilities[testCase.abilityId];
      const overrides: Record<number, AttrOverride> = {};
      for (const index of testCase.attrIndices) {
        const attr = ability.attrs[index] as AbAttr & Record<string, unknown>;
        expect(attr.constructor.name, `${testCase.name} attr ${index}`).toBe(testCase.className);
        const closure =
          testCase.slot === "gate"
            ? (attr as unknown as { gate: (p: never) => boolean }).gate.bind(attr)
            : (attr[testCase.closureField as string] as (...args: never[]) => boolean);
        expect(typeof closure).toBe("function");
        overrides[index] = { conds: { [testCase.slot]: closure } };
      }
      const attrs = testCase.attrIndices.map(attrIndex => ({ attrIndex, className: testCase.className }));
      const template = hit(testCase.move, `b01-c3-${testCase.abilityId}`);
      const axes = testCase.axes === undefined ? {} : testCase.axes;
      const same = await twinRebuild(phaserGame, testCase.abilityId, template, {
        attrs,
        overrides,
        axes: axes as never,
      });
      for (const index of testCase.attrIndices) {
        expect(same.rebuiltAttrs).toContain(index);
      }
      expect(same.report).toBe("");
      const mutated = await twinRebuild(phaserGame, testCase.abilityId, template, {
        attrs: [],
        overrides,
        drop: testCase.attrIndices,
        axes: axes as never,
      });
      expect(mutated.outcome.differences.length, `${testCase.name} without the attr`).toBeGreaterThan(0);
    });
  }
});

describe("B01 chunk 3: settings read back from the live attrs equal the values written from the source", () => {
  let phaserGame: Phaser.Game;
  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  const EXPECTED: readonly {
    readonly name: string;
    readonly abilityId: number;
    readonly attrIndex: number;
    readonly className: string;
    readonly params: Record<string, string | number | boolean>;
  }[] = [
    {
      name: "Wind Rider",
      abilityId: 274,
      attrIndex: 0,
      className: "MoveImmunityStatStageChangeAbAttr",
      params: { stat: "HIGHER_ATTACK", stages: 1 },
    },
    {
      name: "Gooey",
      abilityId: 183,
      attrIndex: 0,
      className: "PostDefendStatStageChangeAbAttr",
      params: { stat: "SPD", stages: -1, selfTarget: false, allOthers: false, opponentsOnly: false },
    },
    {
      name: "Cotton Down",
      abilityId: 238,
      attrIndex: 0,
      className: "PostDefendStatStageChangeAbAttr",
      params: { stat: "SPD", stages: -1, selfTarget: false, allOthers: false, opponentsOnly: true },
    },
    {
      name: "Steam Engine",
      abilityId: 243,
      attrIndex: 0,
      className: "PostDefendStatStageChangeAbAttr",
      params: { stat: "SPD", stages: 6, selfTarget: true, allOthers: false, opponentsOnly: false },
    },
    {
      name: "Water Compaction",
      abilityId: 195,
      attrIndex: 0,
      className: "PostDefendStatStageChangeAbAttr",
      params: { stat: "DEF", stages: 2, selfTarget: true, allOthers: false, opponentsOnly: false },
    },
    {
      name: "Weak Armor (first)",
      abilityId: 133,
      attrIndex: 0,
      className: "PostDefendStatStageChangeAbAttr",
      params: { stat: "DEF", stages: -1, selfTarget: true, allOthers: false, opponentsOnly: false },
    },
    {
      name: "Weak Armor (second)",
      abilityId: 133,
      attrIndex: 1,
      className: "PostDefendStatStageChangeAbAttr",
      params: { stat: "SPD", stages: 2, selfTarget: true, allOthers: false, opponentsOnly: false },
    },
    {
      name: "Thermal Exchange",
      abilityId: 270,
      attrIndex: 0,
      className: "PostDefendStatStageChangeAbAttr",
      params: { stat: "ATK", stages: 1, selfTarget: true, allOthers: false, opponentsOnly: false },
    },
    {
      name: "Anger Shell (first)",
      abilityId: 271,
      attrIndex: 0,
      className: "PostDefendHpGatedStatStageChangeAbAttr",
      params: { hpGate: 0.5, stats: "Attack, Sp. Atk, Speed", stages: 2, selfTarget: true, guardTag: "NONE" },
    },
    {
      name: "Anger Shell (second)",
      abilityId: 271,
      attrIndex: 1,
      className: "PostDefendHpGatedStatStageChangeAbAttr",
      params: { hpGate: 0.5, stats: "Defense, Sp. Def", stages: -1, selfTarget: true, guardTag: "NONE" },
    },
    {
      name: "No Turning Back",
      abilityId: 5372,
      attrIndex: 0,
      className: "PostDefendHpGatedStatStageChangeAbAttr",
      params: {
        hpGate: 0.5,
        stats: "Attack, Defense, Sp. Atk, Sp. Def, Speed",
        stages: 1,
        selfTarget: true,
        guardTag: "NO_RETREAT",
      },
    },
    {
      name: "Toxic Debris",
      abilityId: 295,
      attrIndex: 0,
      className: "PostDefendApplyArenaTrapTagAbAttr",
      params: { tag: "TOXIC_SPIKES" },
    },
    {
      name: "Wind Power",
      abilityId: 277,
      attrIndex: 0,
      className: "PostDefendApplyBattlerTagAbAttr",
      params: { tag: "CHARGED" },
    },
    {
      name: "Electromorphosis",
      abilityId: 280,
      attrIndex: 0,
      className: "PostDefendApplyBattlerTagAbAttr",
      params: { tag: "CHARGED" },
    },
    {
      name: "Seed Sower",
      abilityId: 269,
      attrIndex: 0,
      className: "PostDefendTerrainChangeAbAttr",
      params: { terrain: "GRASSY" },
    },
  ];

  it("every declared setting of every user equals the hand-written value", () => {
    for (const expected of EXPECTED) {
      const attr = allAbilities[expected.abilityId].attrs[expected.attrIndex];
      expect(attr.constructor.name, expected.name).toBe(expected.className);
      const module = declRegistry.get(expected.className);
      expect(module, expected.className).toBeDefined();
      expect(readDeclParams(module!, attr), expected.name).toEqual(expected.params);
    }
  });

  it("the Higher attack choice picks the same stat as Wind Rider's own function for every Attack and Sp. Atk pair", async () => {
    const world = await startWorld(phaserGame);
    const windRider = allAbilities[274].attrs[0] as unknown as { stat: (pokemon: unknown) => Stat };
    const module = declRegistry.get("MoveImmunityStatStageChangeAbAttr")!;
    const stat = module.decl.params.find(param => param.id === "stat")!;
    const built = stat.codec!.toCtor("HIGHER_ATTACK") as (pokemon: unknown) => Stat;
    expect(typeof windRider.stat).toBe("function");
    expect(stat.codec!.fromInstance(windRider.stat)).toBe("HIGHER_ATTACK");
    expect(stat.codec!.fromInstance(Stat.SPD)).toBe("SPD");
    const holder = world.holder;
    const saved = [holder.stats[Stat.ATK], holder.stats[Stat.SPATK]];
    for (const [atk, spatk] of [
      [100, 100],
      [100, 101],
      [101, 100],
      [1, 500],
      [500, 1],
      [0, 0],
    ]) {
      holder.stats[Stat.ATK] = atk;
      holder.stats[Stat.SPATK] = spatk;
      expect(built(holder), `Atk ${atk} Sp. Atk ${spatk}`).toBe(windRider.stat(holder));
    }
    [holder.stats[Stat.ATK], holder.stats[Stat.SPATK]] = saved;
  });
});

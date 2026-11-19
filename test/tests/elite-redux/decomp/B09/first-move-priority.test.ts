/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { allMoves } from "#data/data-lists";
import { buildAttr, readDeclParams, recomposeAttr } from "#data/elite-redux/ability-studio/build-attr";
import { declRegistry } from "#data/elite-redux/ability-studio/decl-registry";
import type {
  ConsumeFirstFlaggedMoveOnUseAbAttr,
  ConsumeFirstFlaggedMovePriorityAbAttr,
  FirstFlaggedMovePriorityAbAttr,
  FirstTurnPriorityClampAbAttr,
  RearmFirstFlaggedMoveOnMoveAbAttr,
} from "#data/elite-redux/archetypes/first-move-priority";
import type { FirstTurnStatMultiplierAbAttr } from "#data/elite-redux/archetypes/first-turn-stat-multiplier";
// B09 chunk 2 probes for what the shared L1 and L2 cannot see: the memory of the first-move bonus (a fresh battle has none),
// a move history (the state grid has none), the first-turn counter and the low-HP pair of the flag booster. Every test drives
// the LIVE attr of a real ability, and its rebuild where the class can be rebuilt.
//
//   1. FirstFlagged / Consume / ConsumeOnUse / Rearm share one memory: spend, blocked, give back, regain on a knock-out.
//   2. Rearm and the clamp rebuild from their bindings and agree with the original for every history / turn counter.
//   3. The legacy-closure classes cannot be rebuilt (they are carried), so a staff rule cannot silently drop the memory.
//   4. FirstTurnStatMultiplier: the gate is "no move used since I came in", NOT "turn one".
//   5. FlagDamageBoost: every user rebuilds identically; the low-HP pair reads back and rebuilds exactly.
import { FlagDamageBoostAbAttr } from "#data/elite-redux/archetypes/flag-damage-boost";
import { HitResult } from "#enums/hit-result";
import { MoveCategory } from "#enums/move-category";
import { MoveFlags } from "#enums/move-flags";
import { MoveId } from "#enums/move-id";
import { MoveResult } from "#enums/move-result";
import { MoveUseMode } from "#enums/move-use-mode";
import { Stat } from "#enums/stat";
import type { Pokemon } from "#field/pokemon";
import { startWorld } from "#test/tests/elite-redux/decomp/harness/game";
import { allAttrSites } from "#test/tests/elite-redux/decomp/harness/sites";
import { liveAbility } from "#test/tests/elite-redux/decomp/harness/twin";
import { NumberHolder } from "#utils/common";
import Phaser from "phaser";
import { beforeAll, describe, expect, it } from "vitest";

const COIL_UP = 5040;
const CUTTHROAT = 5444;
const EDGELORD = 5583;
const ON_THE_PROWL = 5352;
const VIOLENT_RUSH = 5088;

function moveWith(flag: MoveFlags, damaging = true) {
  const move = allMoves.find(
    m => m != null && m.hasFlag(flag) && (!damaging || m.category !== MoveCategory.STATUS) && m.id !== MoveId.NONE,
  );
  expect(move, `a ${MoveFlags[flag]} move exists`).toBeDefined();
  return move!;
}

function pushHistory(pokemon: Pokemon, ...ids: MoveId[]): void {
  for (const move of ids) {
    pokemon.summonData.moveHistory.push({
      move,
      targets: [],
      useMode: MoveUseMode.NORMAL,
      result: MoveResult.SUCCESS,
    } as never);
  }
}

describe("B09 first-move priority family (memory, history, first turn)", () => {
  let phaserGame: Phaser.Game;
  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  const priorityParams = (holder: Pokemon, move: ReturnType<typeof moveWith>) => ({
    pokemon: holder,
    move,
    priority: new NumberHolder(move.priority),
    simulated: false,
  });
  const hitParams = (
    holder: Pokemon,
    foe: Pokemon,
    move: ReturnType<typeof moveWith>,
    hitResult: HitResult = HitResult.EFFECTIVE,
  ) => ({ pokemon: holder, opponent: foe, move, damage: 10, hitResult, simulated: false });

  it("Cutthroat: the bonus goes to a slicing move, is spent by a landed hit, blocked after, and given back by Sharpen", async () => {
    const { holder, foe } = await startWorld(phaserGame);
    const [first, consume, rearm] = liveAbility(CUTTHROAT).attrs as [
      FirstFlaggedMovePriorityAbAttr,
      ConsumeFirstFlaggedMovePriorityAbAttr,
      RearmFirstFlaggedMoveOnMoveAbAttr,
    ];
    const slice = moveWith(MoveFlags.SLICING_MOVE);
    const plain = allMoves[MoveId.TACKLE];
    expect(plain.hasFlag(MoveFlags.SLICING_MOVE)).toBe(false);

    expect(first.canApply(priorityParams(holder, slice))).toBe(true);
    expect(first.canApply(priorityParams(holder, plain))).toBe(false);
    const priority = priorityParams(holder, slice);
    first.apply(priority);
    expect(priority.priority.value).toBe(slice.priority + 1);

    // A miss, an immunity or a failure does not spend it; a non-slicing hit does not either.
    expect(consume.canApply(hitParams(holder, foe, slice, HitResult.MISS))).toBe(false);
    expect(consume.canApply(hitParams(holder, foe, slice, HitResult.NO_EFFECT))).toBe(false);
    expect(consume.canApply(hitParams(holder, foe, plain))).toBe(false);
    // Cutthroat does not regain on a knock-out.
    foe.hp = 0;
    expect(consume.canApply(hitParams(holder, foe, plain))).toBe(false);
    foe.hp = foe.getMaxHp();
    // Every landed result of a slicing move spends it.
    for (const result of [
      HitResult.EFFECTIVE,
      HitResult.SUPER_EFFECTIVE,
      HitResult.NOT_VERY_EFFECTIVE,
      HitResult.ONE_HIT_KO,
    ]) {
      expect(consume.canApply(hitParams(holder, foe, slice, result))).toBe(true);
    }
    consume.apply(hitParams(holder, foe, slice));
    expect(first.canApply(priorityParams(holder, slice))).toBe(false);

    // Sharpen as the most recent move gives it back; another move does not; an older Sharpen does not.
    expect(rearm.canApply({ pokemon: holder })).toBe(false);
    pushHistory(holder, MoveId.TACKLE);
    expect(rearm.canApply({ pokemon: holder })).toBe(false);
    pushHistory(holder, MoveId.SHARPEN);
    expect(rearm.canApply({ pokemon: holder })).toBe(true);
    rearm.apply({ pokemon: holder });
    expect(first.canApply(priorityParams(holder, slice))).toBe(true);
    pushHistory(holder, MoveId.TACKLE);
    expect(rearm.canApply({ pokemon: holder })).toBe(false);
  });

  it("the Rearm gate rebuilt from time.last-move agrees with the original for every history, and follows its setting", async () => {
    const { holder } = await startWorld(phaserGame);
    const original = liveAbility(CUTTHROAT).attrs[2] as RearmFirstFlaggedMoveOnMoveAbAttr;
    const module = declRegistry.get("RearmFirstFlaggedMoveOnMoveAbAttr")!;
    const rebuilt = recomposeAttr(module, original, CUTTHROAT, 2) as RearmFirstFlaggedMoveOnMoveAbAttr;
    expect(rebuilt).not.toBe(original);
    expect(readDeclParams(module, original)).toEqual({ moveId: "SHARPEN" });
    const histories: MoveId[][] = [
      [],
      [MoveId.SHARPEN],
      [MoveId.TACKLE],
      [MoveId.SHARPEN, MoveId.TACKLE],
      [MoveId.TACKLE, MoveId.SHARPEN],
    ];
    for (const history of histories) {
      holder.summonData.moveHistory.length = 0;
      pushHistory(holder, ...history);
      expect(rebuilt.canApply({ pokemon: holder }), history.map(id => MoveId[id]).join(",")).toBe(
        original.canApply({ pokemon: holder }),
      );
    }
    // The rebuild with another move id follows the setting (gateParams writes it into the bound time.last-move atom).
    const tackle = recomposeAttr(module, original, CUTTHROAT, 2, {
      params: { moveId: "TACKLE" },
    }) as RearmFirstFlaggedMoveOnMoveAbAttr;
    holder.summonData.moveHistory.length = 0;
    pushHistory(holder, MoveId.TACKLE);
    expect(tackle.canApply({ pokemon: holder })).toBe(true);
    expect(original.canApply({ pokemon: holder })).toBe(false);
    // The rebuilt apply gives the bonus back exactly like the original (the same memory key).
    const first = liveAbility(CUTTHROAT).attrs[0] as FirstFlaggedMovePriorityAbAttr;
    const consume = liveAbility(CUTTHROAT).attrs[1] as ConsumeFirstFlaggedMovePriorityAbAttr;
    const slice = moveWith(MoveFlags.SLICING_MOVE);
    consume.apply(hitParams(holder, holder, slice));
    expect(first.canApply(priorityParams(holder, slice))).toBe(false);
    rebuilt.apply({ pokemon: holder });
    expect(first.canApply(priorityParams(holder, slice))).toBe(true);
  });

  it("Edgelord regains the bonus on a knock-out (a flagged knock-out spends then restores it), even with a plain move", async () => {
    const { holder, foe } = await startWorld(phaserGame);
    const [first, consume] = liveAbility(EDGELORD).attrs as [
      FirstFlaggedMovePriorityAbAttr,
      ConsumeFirstFlaggedMovePriorityAbAttr,
    ];
    const slice = moveWith(MoveFlags.SLICING_MOVE);
    const plain = allMoves[MoveId.TACKLE];
    // Spend it with a slicing hit that does not knock out.
    consume.apply(hitParams(holder, foe, slice));
    expect(first.canApply(priorityParams(holder, slice))).toBe(false);
    // A plain move that does not knock out changes nothing and cannot even apply.
    expect(consume.canApply(hitParams(holder, foe, plain))).toBe(false);
    // A plain move that knocks out gives it back.
    foe.hp = 0;
    expect(consume.canApply(hitParams(holder, foe, plain))).toBe(true);
    consume.apply(hitParams(holder, foe, plain));
    expect(first.canApply(priorityParams(holder, slice))).toBe(true);
    // A slicing knock-out: the same apply spends and then restores, so the bonus is still there.
    expect(consume.canApply(hitParams(holder, foe, slice))).toBe(true);
    consume.apply(hitParams(holder, foe, slice));
    expect(first.canApply(priorityParams(holder, slice))).toBe(true);
  });

  it("Coil Up: using a biting move spends the bonus even without a hit; another move does not", async () => {
    const { holder } = await startWorld(phaserGame);
    const [first, onUse] = liveAbility(COIL_UP).attrs as [
      FirstFlaggedMovePriorityAbAttr,
      ConsumeFirstFlaggedMoveOnUseAbAttr,
    ];
    const bite = moveWith(MoveFlags.BITING_MOVE);
    expect(first.canApply(priorityParams(holder, bite))).toBe(true);
    expect(onUse.canApply({ pokemon: holder })).toBe(false);
    pushHistory(holder, MoveId.TACKLE);
    expect(onUse.canApply({ pokemon: holder })).toBe(false);
    pushHistory(holder, bite.id);
    expect(onUse.canApply({ pokemon: holder })).toBe(true);
    onUse.apply({ pokemon: holder });
    expect(first.canApply(priorityParams(holder, bite))).toBe(false);
    // Once spent, the guard stops it from applying again.
    expect(onUse.canApply({ pokemon: holder })).toBe(false);
  });

  it("the legacy-closure classes are carried, not rebuilt, so a rebuild can never drop the memory", async () => {
    await startWorld(phaserGame);
    const cases: [number, number, string][] = [
      [CUTTHROAT, 0, "FirstFlaggedMovePriorityAbAttr"],
      [CUTTHROAT, 1, "ConsumeFirstFlaggedMovePriorityAbAttr"],
      [COIL_UP, 1, "ConsumeFirstFlaggedMoveOnUseAbAttr"],
      [VIOLENT_RUSH, 0, "FirstTurnStatMultiplierAbAttr"],
    ];
    for (const [abilityId, index, className] of cases) {
      const module = declRegistry.get(className)!;
      expect(module, className).toBeDefined();
      const attr = liveAbility(abilityId).attrs[index];
      expect(attr.constructor.name).toBe(className);
      expect(() => recomposeAttr(module, attr, abilityId, index), className).toThrow(/no library binding for gate/);
    }
  });

  it("First turn clamp: the gate is waveTurnCount === 1 (original and rebuild agree); negative priority becomes 0, others get +1", async () => {
    const { holder } = await startWorld(phaserGame);
    const original = liveAbility(ON_THE_PROWL).attrs[0] as FirstTurnPriorityClampAbAttr;
    const module = declRegistry.get("FirstTurnPriorityClampAbAttr")!;
    const rebuilt = recomposeAttr(module, original, ON_THE_PROWL, 0) as FirstTurnPriorityClampAbAttr;
    const move = allMoves[MoveId.TACKLE];
    for (const turn of [0, 1, 2, 3]) {
      holder.tempSummonData.waveTurnCount = turn;
      expect(rebuilt.canApply(priorityParams(holder, move)), `turn ${turn}`).toBe(
        original.canApply(priorityParams(holder, move)),
      );
      expect(original.canApply(priorityParams(holder, move)), `turn ${turn}`).toBe(turn === 1);
    }
    for (const [start, expected] of [
      [-3, 0],
      [-1, 0],
      [0, 1],
      [1, 2],
      [2, 3],
    ] as const) {
      for (const attr of [original, rebuilt]) {
        const holderValue = new NumberHolder(start);
        attr.apply({ pokemon: holder, move, priority: holderValue, simulated: false });
        expect(holderValue.value, `${start}`).toBe(expected);
      }
    }
  });

  it("First turn stat multiplier: 'no move used since I came in', not 'turn one'; only the boosted stat", async () => {
    const { holder } = await startWorld(phaserGame);
    const [speed, attack] = [0, 1].map(i => liveAbility(VIOLENT_RUSH).attrs[i]) as FirstTurnStatMultiplierAbAttr[];
    const move = allMoves[MoveId.TACKLE];
    const statParams = (stat: Stat) => ({
      pokemon: holder,
      move,
      stat,
      statVal: new NumberHolder(100),
      simulated: false,
    });
    holder.summonData.moveHistory.length = 0;
    holder.tempSummonData.waveTurnCount = 1;
    expect(speed.canApply(statParams(Stat.SPD))).toBe(true);
    expect(speed.canApply(statParams(Stat.ATK))).toBe(false);
    expect(attack.canApply(statParams(Stat.ATK))).toBe(true);
    // Turn 2 but nothing used yet (asleep, flinched ...): still boosted.
    holder.tempSummonData.waveTurnCount = 2;
    expect(speed.canApply(statParams(Stat.SPD))).toBe(true);
    // Turn 1 but a move was already used: no longer boosted.
    holder.tempSummonData.waveTurnCount = 1;
    pushHistory(holder, MoveId.TACKLE);
    expect(speed.canApply(statParams(Stat.SPD))).toBe(false);
    // The boost multiplies the stat value.
    const value = statParams(Stat.SPD);
    holder.summonData.moveHistory.length = 0;
    speed.apply(value);
    expect(value.statVal.value).toBe(150);
  });

  it("Flag damage boost: every user rebuilds identically for every flag; the low-HP pair reads back and rebuilds exactly", async () => {
    const { holder, foe } = await startWorld(phaserGame);
    const module = declRegistry.get("FlagDamageBoostAbAttr")!;
    const sites = allAttrSites().filter(site => site.className === "FlagDamageBoostAbAttr");
    expect(sites).toHaveLength(59);
    const flags = new Set<string>();
    for (const site of sites) {
      const original = site.attr as FlagDamageBoostAbAttr;
      const rebuilt = recomposeAttr(module, original, site.abilityId, site.attrIndex) as FlagDamageBoostAbAttr;
      flags.add(MoveFlags[original.getBoostFlag()]);
      expect(rebuilt.getBoostFlag()).toBe(original.getBoostFlag());
      expect(rebuilt.getHighHpMultiplier()).toBe(original.getHighHpMultiplier());
      expect(rebuilt.getLowHpMultiplier()).toBe(original.getLowHpMultiplier());
      expect(rebuilt.getLowHpThreshold()).toBe(original.getLowHpThreshold());
      const withFlag = moveWith(original.getBoostFlag());
      for (const move of [withFlag, allMoves[MoveId.SPLASH]]) {
        const a = { pokemon: holder, opponent: foe, move, power: new NumberHolder(move.power), simulated: false };
        const b = { pokemon: holder, opponent: foe, move, power: new NumberHolder(move.power), simulated: false };
        expect(rebuilt.canApply(b)).toBe(original.canApply(a));
        if (original.canApply(a)) {
          original.apply(a);
          rebuilt.apply(b);
          expect(b.power.value).toBe(a.power.value);
        }
      }
    }
    // 13 different properties are boosted by the 59 live attrs.
    expect(flags.size).toBe(13);

    // The low-HP pair: read back from a live instance, and rebuilt exactly (strictly below the line is low).
    const live = new FlagDamageBoostAbAttr({
      flag: MoveFlags.PUNCHING_MOVE,
      multiplier: 1.2,
      lowHpMultiplier: 2,
      lowHpThreshold: 0.5,
    });
    const params = readDeclParams(module, live);
    expect(params).toEqual({ flag: "PUNCHING_MOVE", multiplier: 1.2, lowHpMultiplier: 2, lowHpThreshold: 0.5 });
    const rebuilt = buildAttr(module, params) as FlagDamageBoostAbAttr;
    for (const ratio of [1, 0.51, 0.5, 0.49, 0.01]) {
      expect(rebuilt.resolveMultiplier(ratio), `${ratio}`).toBe(live.resolveMultiplier(ratio));
    }
    expect(rebuilt.resolveMultiplier(0.5)).toBe(1.2);
    expect(rebuilt.resolveMultiplier(0.49)).toBe(2);
    // Setting the low-HP multiplier to 0 means no low-HP change at all.
    const none = buildAttr(module, { ...params, lowHpMultiplier: 0 }) as FlagDamageBoostAbAttr;
    expect(none.getLowHpMultiplier()).toBeNull();
    expect(none.resolveMultiplier(0.01)).toBe(1.2);
  });
});

/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B10 chunk 2, the two Tier C classes whose rule the shared L1 grid and L2 twin cannot show:
//  - OutgoingStatDropMultiplierAbAttr (Subdue): which of the move's own stat attrs count, the extra phases it queues, and the
//    cases that do nothing (a preview, no target, a fainted target, a drop aimed at the user, a raise);
//  - PartyCountMultiHitAbAttr (Minion Control): the hit count for parties of different shapes and a changed cap.
// Each is run on the ORIGINAL attr and on its REBUILD and the two must leave the same queue / hit count.
import { globalScene } from "#app/global-scene";
import { allMoves } from "#data/data-lists";
import { readDeclParams, recomposeAttr } from "#data/elite-redux/ability-studio/build-attr";
import { declRegistry } from "#data/elite-redux/ability-studio/decl-registry";
import type { DeclModule } from "#data/elite-redux/ability-studio/define-decl";
import { PartyCountMultiHitAbAttr } from "#data/elite-redux/archetypes/party-count-multi-hit";
import { MoveId } from "#enums/move-id";
import { StatusEffect } from "#enums/status-effect";
import { attrFingerprint } from "#test/tests/elite-redux/decomp/fingerprint";
import { startWorld } from "#test/tests/elite-redux/decomp/harness/game";
import { allAttrSites } from "#test/tests/elite-redux/decomp/harness/sites";
import { NumberHolder } from "#utils/common";
import Phaser from "phaser";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

const OUTGOING = declRegistry.get("OutgoingStatDropMultiplierAbAttr") as DeclModule;
const PARTY = declRegistry.get("PartyCountMultiHitAbAttr") as DeclModule;

describe("B10: OutgoingStatDropMultiplierAbAttr (Subdue)", () => {
  let phaserGame: Phaser.Game;
  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });
  const site = () => allAttrSites().find(candidate => candidate.className === "OutgoingStatDropMultiplierAbAttr")!;

  it("Subdue is the only user (factor 2) and its rebuild is identical", async () => {
    await startWorld(phaserGame);
    expect(
      allAttrSites()
        .filter(s => s.className === "OutgoingStatDropMultiplierAbAttr")
        .map(s => s.abilityName),
    ).toEqual(["Subdue"]);
    expect(readDeclParams(OUTGOING, site().attr)).toEqual({ factor: 2 });
    const rebuilt = recomposeAttr(OUTGOING, site().attr, site().abilityId, site().attrIndex);
    expect(rebuilt).not.toBe(site().attr);
    expect(attrFingerprint(rebuilt as never)).toEqual(attrFingerprint(site().attr as never));
  });

  it("original and rebuild trigger and queue the same extra drops for lowering, raising, self-aimed and plain moves", async () => {
    const { holder, foe } = await startWorld(phaserGame);
    const original = site().attr;
    const rebuilt = recomposeAttr(OUTGOING, original, site().abilityId, site().attrIndex);
    const queued: unknown[][] = [];
    vi.spyOn(globalScene.phaseManager, "unshiftNew").mockImplementation(((...args: unknown[]) => {
      queued.push(args);
    }) as never);
    const cases: [MoveId, boolean, number[]][] = [
      [MoveId.GROWL, true, [-1]], // Attack -1 on the target: one extra stage
      [MoveId.SCREECH, true, [-2]], // Defense -2 on the target: two extra stages
      [MoveId.ICY_WIND, true, [-1]], // damaging move with a Speed -1 secondary drop
      [MoveId.SWORDS_DANCE, false, []], // a raise
      [MoveId.SUPERPOWER, false, []], // drops aimed at the user
      [MoveId.TACKLE, false, []], // no stat attr at all
    ];
    for (const [moveId, triggers, extras] of cases) {
      const move = allMoves[moveId];
      for (const [name, attr] of [
        ["class", original],
        ["rebuild", rebuilt],
      ] as const) {
        queued.length = 0;
        const params = { pokemon: holder, opponent: foe, move, hitResult: 0, simulated: false } as never;
        expect(attr.canApply(params), `${name} ${MoveId[moveId]}: canApply`).toBe(triggers);
        if (!triggers) {
          continue;
        }
        attr.apply({ pokemon: holder, opponent: foe, move, hitResult: 0, simulated: true } as never);
        expect(queued, `${name} ${MoveId[moveId]}: preview`).toEqual([]);
        attr.apply(params);
        expect(
          queued.map(call => [call[0], call[1], call[2], call[4]]),
          `${name} ${MoveId[moveId]}: queued drops`,
        ).toEqual(extras.map(extra => ["StatStageChangePhase", foe.getBattlerIndex(), false, extra]));
      }
    }
  });

  it("nothing is queued for a fainted or missing target, and a factor of 1.5 still adds a whole stage (it rounds away from zero)", async () => {
    const { holder, foe } = await startWorld(phaserGame);
    const queued: unknown[][] = [];
    vi.spyOn(globalScene.phaseManager, "unshiftNew").mockImplementation(((...args: unknown[]) => {
      queued.push(args);
    }) as never);
    const original = site().attr;
    const rebuilt = recomposeAttr(OUTGOING, original, site().abilityId, site().attrIndex);
    const gentle = recomposeAttr(OUTGOING, original, site().abilityId, site().attrIndex, { params: { factor: 1.5 } });
    const growl = allMoves[MoveId.GROWL];
    vi.spyOn(foe, "isFainted").mockReturnValue(true);
    for (const attr of [original, rebuilt]) {
      attr.apply({ pokemon: holder, opponent: foe, move: growl, hitResult: 0, simulated: false } as never);
      attr.apply({ pokemon: holder, opponent: undefined, move: growl, hitResult: 0, simulated: false } as never);
    }
    expect(queued, "fainted or missing target").toEqual([]);
    vi.restoreAllMocks();
    vi.spyOn(globalScene.phaseManager, "unshiftNew").mockImplementation(((...args: unknown[]) => {
      queued.push(args);
    }) as never);
    gentle.apply({ pokemon: holder, opponent: foe, move: growl, hitResult: 0, simulated: false } as never);
    expect(queued.map(call => call[4])).toEqual([-1]);
  });
});

describe("B10: PartyCountMultiHitAbAttr (Minion Control)", () => {
  let phaserGame: Phaser.Game;
  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });
  const site = () => allAttrSites().find(candidate => candidate.className === "PartyCountMultiHitAbAttr")!;

  it("Minion Control is the only user (cap 6) and its rebuild is identical", async () => {
    await startWorld(phaserGame);
    expect(
      allAttrSites()
        .filter(s => s.className === "PartyCountMultiHitAbAttr")
        .map(s => s.abilityName),
    ).toEqual(["Minion Control"]);
    expect(readDeclParams(PARTY, site().attr)).toEqual({ maxHits: 6 });
    const rebuilt = recomposeAttr(PARTY, site().attr, site().abilityId, site().attrIndex);
    expect(rebuilt).not.toBe(site().attr);
    expect(attrFingerprint(rebuilt as never)).toEqual(attrFingerprint(site().attr as never));
  });

  it("one extra hit per OTHER healthy member (not fainted, no status), capped; the original, the rebuild and a changed cap agree with a direct count", async () => {
    const { holder, foe } = await startWorld(phaserGame);
    const original = site().attr;
    const rebuilt = recomposeAttr(PARTY, original, site().abilityId, site().attrIndex);
    const capped = recomposeAttr(PARTY, original, site().abilityId, site().attrIndex, { params: { maxHits: 3 } });
    const direct = new PartyCountMultiHitAbAttr(3);
    const mate = (fainted: boolean, status: StatusEffect) => ({
      isFainted: () => fainted,
      status: status === StatusEffect.NONE ? null : { effect: status },
    });
    const healthy = () => mate(false, StatusEffect.NONE);
    const parties: [string, unknown[], number][] = [
      ["alone", [holder], 0],
      ["one healthy partner", [holder, healthy()], 1],
      ["a fainted partner does not count", [holder, mate(true, StatusEffect.NONE), healthy()], 1],
      ["a statused partner does not count", [holder, mate(false, StatusEffect.BURN), healthy()], 1],
      ["a hole in the party list does not count", [holder, undefined, healthy()], 1],
      ["five healthy partners", [holder, healthy(), healthy(), healthy(), healthy(), healthy()], 5],
      [
        "six healthy partners are capped",
        [holder, healthy(), healthy(), healthy(), healthy(), healthy(), healthy()],
        6,
      ],
    ];
    for (const [label, party, healthyOthers] of parties) {
      vi.spyOn(globalScene, "getPlayerParty").mockReturnValue(party as never);
      for (const startHits of [1, 2]) {
        const expectHits = (cap: number) => Math.min(startHits + healthyOthers, cap);
        const run = (attr: typeof original): number => {
          const hitCount = new NumberHolder(startHits);
          attr.apply({ pokemon: holder, opponent: foe, move: allMoves[MoveId.TACKLE], hitCount } as never);
          return hitCount.value;
        };
        expect(run(original), `class: ${label}, start ${startHits}`).toBe(expectHits(6));
        expect(run(rebuilt), `rebuild: ${label}, start ${startHits}`).toBe(expectHits(6));
        expect(run(capped), `cap 3: ${label}, start ${startHits}`).toBe(expectHits(3));
        expect(run(direct), `direct cap 3: ${label}, start ${startHits}`).toBe(run(capped));
      }
    }
  });

  it("the eligibility test stays the parent's: a move that cannot be turned into several strikes does not trigger", async () => {
    const { holder, foe } = await startWorld(phaserGame);
    const original = site().attr;
    const rebuilt = recomposeAttr(PARTY, original, site().abilityId, site().attrIndex);
    for (const moveId of [MoveId.TACKLE, MoveId.SPLASH, MoveId.FISSURE, MoveId.DOUBLE_SLAP]) {
      const params = { pokemon: holder, opponent: foe, move: allMoves[moveId], hitCount: new NumberHolder(1) } as never;
      const want = allMoves[moveId].canBeMultiStrikeEnhanced(holder, true, foe);
      expect(original.canApply(params), `class ${MoveId[moveId]}`).toBe(want);
      expect(rebuilt.canApply(params), `rebuild ${MoveId[moveId]}`).toBe(want);
    }
  });
});

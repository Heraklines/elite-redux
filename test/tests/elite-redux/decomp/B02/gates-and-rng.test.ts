/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B02 chunk 1: what the shared L1 and L2 suites cannot see for the Tier B contact classes.
//  - PostDefendMoveDisableAbAttr draws ONE random number, in the gate, AFTER the not-disabled and contact checks. The
//    ranges are recorded (not just counted) for the original and for a library-built gate.
//  - The `chance` setting moves the rng.chance atom of the gate (gateParams), so a 50% rule really rolls against 50.
//  - Proof of the proof: a gate whose clauses are in the wrong order draws a number the original never draws.
//  - The simulated guard of PostDefendContactDamageAbAttr, and the residual of the Perish Song / contact-damage classes.
import {
  type PostDefendAbilityGiveAbAttr,
  type PostDefendAbilitySwapAbAttr,
  type PostDefendContactDamageAbAttr,
  PostDefendMoveDisableAbAttr,
  type PostDefendPerishSongAbAttr,
} from "#abilities/ab-attrs";
import { allAbilities, allMoves } from "#data/data-lists";
import { buildAttr, recomposeAttr } from "#data/elite-redux/ability-studio/build-attr";
import { declRegistry } from "#data/elite-redux/ability-studio/decl-registry";
import { AbilityId } from "#enums/ability-id";
import { BattlerTagType } from "#enums/battler-tag-type";
import { HitResult } from "#enums/hit-result";
import { MoveId } from "#enums/move-id";
import type { Pokemon } from "#field/pokemon";
import { startWorld } from "#test/tests/elite-redux/decomp/harness/game";
import { allAttrSites } from "#test/tests/elite-redux/decomp/harness/sites";
import type { PostMoveInteractionAbAttrParams } from "#types/ability-types";
import { toDmgValue } from "#utils/common";
import Phaser from "phaser";
import { beforeAll, describe, expect, it, vi } from "vitest";

const CONTACT = { block: "move.flag", params: { flag: "MAKES_CONTACT" } } as const;
const NOT_DISABLED = { not: { block: "tag.has", params: { who: "other", tag: "DISABLED" } } } as const;

function hitParams(holder: Pokemon, foe: Pokemon, move: MoveId, simulated = false): PostMoveInteractionAbAttrParams {
  return {
    pokemon: holder,
    opponent: foe,
    move: allMoves[move],
    damage: 5,
    hitResult: HitResult.EFFECTIVE,
    simulated,
  } as PostMoveInteractionAbAttrParams;
}

function siteOf(abilityId: number, className: string) {
  const site = allAttrSites().find(s => s.abilityId === abilityId && s.className === className);
  if (site === undefined) {
    throw new Error(`ability ${abilityId} has no ${className}`);
  }
  return site;
}

describe("B02 chunk 1: Cursed Body (RNG in the gate)", () => {
  let phaserGame: Phaser.Game;
  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  it("the live Cursed Body, its recomposed twin and a hand-built gate draw the same ranges in the same order", async () => {
    const { game, holder, foe } = await startWorld(phaserGame);
    const site = siteOf(130, "PostDefendMoveDisableAbAttr");
    const module = declRegistry.get("PostDefendMoveDisableAbAttr")!;
    const recomposed = recomposeAttr(module, site.attr, 130, site.attrIndex) as PostDefendMoveDisableAbAttr;
    const handBuilt = buildAttr(
      module,
      { chance: 30 },
      { gate: { all: [NOT_DISABLED, CONTACT, { block: "rng.chance", params: { pct: 30 } }] } },
    );
    let log: number[] = [];
    let roll = 99;
    vi.spyOn(game.scene, "randBattleSeedInt").mockImplementation((range: number, min = 0) => {
      log.push(range);
      return min + Math.min(roll, range - 1);
    });
    const run = (attr: unknown, move: MoveId): [boolean, number[]] => {
      log = [];
      const result = (attr as PostDefendMoveDisableAbAttr).canApply(hitParams(holder, foe, move));
      return [result, [...log]];
    };
    const disabledTag = { tagType: BattlerTagType.DISABLED } as never;
    const cases: {
      label: string;
      move: MoveId;
      alreadyDisabled: boolean;
      roll: number;
      expected: [boolean, number[]];
    }[] = [
      {
        label: "contact, roll 99 (fails)",
        move: MoveId.TACKLE,
        alreadyDisabled: false,
        roll: 99,
        expected: [false, [100]],
      },
      {
        label: "contact, roll 29 (passes)",
        move: MoveId.TACKLE,
        alreadyDisabled: false,
        roll: 29,
        expected: [true, [100]],
      },
      {
        label: "contact, roll 30 (fails, the test is < 30)",
        move: MoveId.TACKLE,
        alreadyDisabled: false,
        roll: 30,
        expected: [false, [100]],
      },
      { label: "no contact: no draw", move: MoveId.WATER_GUN, alreadyDisabled: false, roll: 0, expected: [false, []] },
      {
        label: "already disabled: no draw",
        move: MoveId.TACKLE,
        alreadyDisabled: true,
        roll: 0,
        expected: [false, []],
      },
    ];
    for (const testCase of cases) {
      roll = testCase.roll;
      foe.summonData.tags = testCase.alreadyDisabled ? [disabledTag] : [];
      const original = run(site.attr, testCase.move);
      expect(original, `${testCase.label}: the live original`).toEqual(testCase.expected);
      expect(run(recomposed, testCase.move), `${testCase.label}: the recomposed twin`).toEqual(original);
      expect(run(handBuilt, testCase.move), `${testCase.label}: a hand-built gate`).toEqual(original);
    }
    foe.summonData.tags = [];
  });

  it("the chance setting moves the gate: a 50% rule rolls against 50, and the draw is still the last clause", async () => {
    const { game, holder, foe } = await startWorld(phaserGame);
    const site = siteOf(130, "PostDefendMoveDisableAbAttr");
    const module = declRegistry.get("PostDefendMoveDisableAbAttr")!;
    const half = recomposeAttr(module, site.attr, 130, site.attrIndex, {
      params: { chance: 50 },
    }) as PostDefendMoveDisableAbAttr;
    let roll = 0;
    vi.spyOn(game.scene, "randBattleSeedInt").mockImplementation(
      (range: number, min = 0) => min + Math.min(roll, range - 1),
    );
    foe.summonData.tags = [];
    roll = 49;
    expect(half.canApply(hitParams(holder, foe, MoveId.TACKLE))).toBe(true);
    roll = 50;
    expect(half.canApply(hitParams(holder, foe, MoveId.TACKLE))).toBe(false);
    // The live original keeps its own 30
    roll = 40;
    expect(site.attr.canApply(hitParams(holder, foe, MoveId.TACKLE))).toBe(false);
    expect(half.canApply(hitParams(holder, foe, MoveId.TACKLE))).toBe(true);
  });

  it("proof of the proof: a gate with the roll BEFORE the cheap checks draws a number the original never draws", async () => {
    const { game, holder, foe } = await startWorld(phaserGame);
    const module = declRegistry.get("PostDefendMoveDisableAbAttr")!;
    const wrongOrder = buildAttr(
      module,
      { chance: 30 },
      { gate: { all: [{ block: "rng.chance", params: { pct: 30 } }, NOT_DISABLED, CONTACT] } },
    );
    const original = new PostDefendMoveDisableAbAttr(30);
    let log: number[] = [];
    vi.spyOn(game.scene, "randBattleSeedInt").mockImplementation((range: number, min = 0) => {
      log.push(range);
      return min;
    });
    foe.summonData.tags = [];
    original.canApply(hitParams(holder, foe, MoveId.WATER_GUN));
    const originalDraws = [...log];
    log = [];
    (wrongOrder as PostDefendMoveDisableAbAttr).canApply(hitParams(holder, foe, MoveId.WATER_GUN));
    expect(originalDraws).toEqual([]);
    expect(log).toEqual([100]);
  });
});

describe("B02 chunk 1: the contact classes keep their guards and residuals in the class", () => {
  let phaserGame: Phaser.Game;
  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  it("Rough Skin: simulated calls and Magic Guard attackers never qualify, a non-contact hit never qualifies", async () => {
    const { holder, foe } = await startWorld(phaserGame);
    const site = siteOf(24, "PostDefendContactDamageAbAttr");
    const module = declRegistry.get("PostDefendContactDamageAbAttr")!;
    const recomposed = recomposeAttr(module, site.attr, 24, site.attrIndex) as PostDefendContactDamageAbAttr;
    for (const attr of [site.attr, recomposed]) {
      expect(attr.canApply(hitParams(holder, foe, MoveId.TACKLE))).toBe(true);
      expect(attr.canApply(hitParams(holder, foe, MoveId.WATER_GUN))).toBe(false);
      expect(attr.canApply(hitParams(holder, foe, MoveId.TACKLE, true))).toBe(false);
    }
    const spy = vi.spyOn(foe, "hasAbilityWithAttr").mockImplementation(name => name === "BlockNonDirectDamageAbAttr");
    for (const attr of [site.attr, recomposed]) {
      expect(attr.canApply(hitParams(holder, foe, MoveId.TACKLE))).toBe(false);
    }
    spy.mockRestore();
  });

  it("Rough Skin: the damage ratio setting changes only the effect, the gate is unchanged", async () => {
    const { holder, foe } = await startWorld(phaserGame);
    const site = siteOf(24, "PostDefendContactDamageAbAttr");
    const module = declRegistry.get("PostDefendContactDamageAbAttr")!;
    const sixth = recomposeAttr(module, site.attr, 24, site.attrIndex, {
      params: { damageRatio: 6 },
    }) as PostDefendContactDamageAbAttr;
    const damage = vi.spyOn(foe, "damageAndUpdate").mockImplementation(() => 0);
    const params = hitParams(holder, foe, MoveId.TACKLE);
    sixth.apply(params);
    const sixthDamage = damage.mock.calls[0][0];
    damage.mockClear();
    site.attr.apply(params);
    const eighthDamage = damage.mock.calls[0][0];
    expect(eighthDamage).toBe(toDmgValue(foe.getMaxHp() * (1 / 8)));
    expect(sixthDamage).toBe(toDmgValue(foe.getMaxHp() * (1 / 6)));
    expect(sixthDamage).toBeGreaterThan(eighthDamage);
    damage.mockRestore();
  });

  it("Perish Body: contact only, and never when the attacker already counts down", async () => {
    const { holder, foe } = await startWorld(phaserGame);
    const site = siteOf(253, "PostDefendPerishSongAbAttr");
    const module = declRegistry.get("PostDefendPerishSongAbAttr")!;
    const recomposed = recomposeAttr(module, site.attr, 253, site.attrIndex) as PostDefendPerishSongAbAttr;
    foe.summonData.tags = [];
    for (const attr of [site.attr, recomposed]) {
      expect(attr.canApply(hitParams(holder, foe, MoveId.TACKLE))).toBe(true);
      expect(attr.canApply(hitParams(holder, foe, MoveId.WATER_GUN))).toBe(false);
    }
    foe.summonData.tags = [{ tagType: BattlerTagType.PERISH_SONG } as never];
    for (const attr of [site.attr, recomposed]) {
      expect(attr.canApply(hitParams(holder, foe, MoveId.TACKLE))).toBe(false);
    }
    foe.summonData.tags = [];
  });

  it("Mummy and Lingering Aroma: residual clauses (suppressable, not a giver, Mummy family) behave like the original", async () => {
    const { holder, foe } = await startWorld(phaserGame);
    const mummy = siteOf(152, "PostDefendAbilityGiveAbAttr");
    const aroma = siteOf(268, "PostDefendAbilityGiveAbAttr");
    const module = declRegistry.get("PostDefendAbilityGiveAbAttr")!;
    const sites = [mummy, aroma];
    const original = sites.map(s => s.attr as PostDefendAbilityGiveAbAttr);
    const rebuilt = sites.map(
      s => recomposeAttr(module, s.attr, s.abilityId, s.attrIndex) as PostDefendAbilityGiveAbAttr,
    );
    // Attackers: a plain one, an unsuppressable one, a Mummy, a Lingering Aroma, a Wandering Spirit.
    const abilities: (AbilityId | "unsuppressable")[] = [
      AbilityId.BALL_FETCH,
      "unsuppressable",
      AbilityId.MUMMY,
      AbilityId.LINGERING_AROMA,
      AbilityId.WANDERING_SPIRIT,
    ];
    const results: boolean[][] = [];
    for (const ability of abilities) {
      // A REAL ability that cannot be suppressed (and gives nothing), so the engine helpers keep working.
      const attackerAbility =
        ability === "unsuppressable"
          ? allAbilities.find(
              a => a !== undefined && a.id !== 0 && !a.suppressable && !a.hasAttr("PostDefendAbilityGiveAbAttr"),
            )
          : undefined;
      const spyAbility =
        attackerAbility === undefined
          ? undefined
          : vi.spyOn(foe, "getAbility").mockReturnValue(attackerAbility as never);
      const spyHas =
        ability === "unsuppressable" || ability === AbilityId.BALL_FETCH
          ? undefined
          : vi.spyOn(foe, "hasAbility").mockImplementation(id => id === ability);
      for (const move of [MoveId.TACKLE, MoveId.WATER_GUN]) {
        const before = original.map(attr => attr.canApply(hitParams(holder, foe, move)));
        const after = rebuilt.map(attr => attr.canApply(hitParams(holder, foe, move)));
        expect(after, `${String(ability)} ${MoveId[move]}`).toEqual(before);
        results.push(before);
      }
      spyAbility?.mockRestore();
      spyHas?.mockRestore();
    }
    // The scenarios must really reach both outcomes, otherwise the comparison proves nothing.
    expect(results.some(row => row.includes(true))).toBe(true);
    expect(results.some(row => row.includes(false))).toBe(true);
  });

  it("Wandering Spirit: swappable and the contact test agree between original and rebuild", async () => {
    const { holder, foe } = await startWorld(phaserGame);
    const site = siteOf(254, "PostDefendAbilitySwapAbAttr");
    const module = declRegistry.get("PostDefendAbilitySwapAbAttr")!;
    const rebuilt = recomposeAttr(module, site.attr, 254, site.attrIndex) as PostDefendAbilitySwapAbAttr;
    const outcomes: boolean[] = [];
    for (const swappable of [true, false]) {
      // A REAL ability that is (or is not) swappable, so the engine helpers keep working.
      const real = allAbilities.find(
        a => a !== undefined && a.id !== 0 && a.swappable === swappable && !a.hasAttr("PostDefendAbilityGiveAbAttr"),
      );
      expect(real, `a real ability with swappable=${swappable}`).toBeDefined();
      const spy = vi.spyOn(foe, "getAbility").mockReturnValue(real as never);
      for (const move of [MoveId.TACKLE, MoveId.WATER_GUN]) {
        const a = site.attr.canApply(hitParams(holder, foe, move));
        const b = rebuilt.canApply(hitParams(holder, foe, move));
        expect(b).toBe(a);
        outcomes.push(a);
      }
      spy.mockRestore();
    }
    expect(outcomes).toContain(true);
    expect(outcomes).toContain(false);
  });
});

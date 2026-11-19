/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B01 chunk 4 proof that the two Tier B splits (PostDefendPartyStatusHealAbAttr, PostDefendContactApplyTagChanceAbAttr) are
// the OLD canApply formulas clause for clause, INCLUDING the random draws (how many, with which bound, in which order),
// that EffectSporeAbAttr's powder clause still comes before every random draw, and that the settings of every live user
// read back as the values written by hand from the source. The old formulas are copied from the base commit (965d6d45f).
import {
  type AbAttr,
  type EffectSporeAbAttr,
  type PostDefendContactApplyTagChanceAbAttr,
  type PostDefendPartyStatusHealAbAttr,
  type PostMoveInteractionAbAttrParams,
  PostDefendContactApplyTagChanceAbAttr as TagChanceClass,
} from "#abilities/ab-attrs";
import { globalScene } from "#app/global-scene";
import { allAbilities, allMoves } from "#data/data-lists";
import { readDeclParams, recomposeAttr } from "#data/elite-redux/ability-studio/build-attr";
import { declRegistry } from "#data/elite-redux/ability-studio/decl-registry";
import { BattlerTagType } from "#enums/battler-tag-type";
import { HitResult } from "#enums/hit-result";
import { MoveFlags } from "#enums/move-flags";
import { MoveId } from "#enums/move-id";
import { PokemonType } from "#enums/pokemon-type";
import type { Pokemon } from "#field/pokemon";
import type { Move } from "#moves/move";
import { startWorld } from "#test/tests/elite-redux/decomp/harness/game";
import Phaser from "phaser";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

// ---- the OLD formulas, verbatim from the base commit --------------------------------------------------------------
const oldPartyHeal = (hitResult: HitResult, party: readonly { status: unknown }[]): boolean => {
  if (hitResult >= HitResult.NO_EFFECT) {
    return false;
  }
  return party.some(p => p.status != null);
};

const HIT_RESULTS = [
  HitResult.EFFECTIVE,
  HitResult.SUPER_EFFECTIVE,
  HitResult.NOT_VERY_EFFECTIVE,
  HitResult.ONE_HIT_KO,
  HitResult.NO_EFFECT,
  HitResult.STATUS,
  HitResult.FAIL,
  HitResult.MISS,
  HitResult.IMMUNE,
];

function liveAttrs<T>(className: string, abilities: readonly number[]): { name: string; id: number; attr: T }[] {
  const found: { name: string; id: number; attr: T }[] = [];
  for (const id of abilities) {
    const ability = allAbilities[id];
    for (const attr of ability?.attrs ?? []) {
      if (attr.constructor.name === className) {
        found.push({ name: ability.name, id, attr: attr as T });
      }
    }
  }
  return found;
}

// The OLD canApply of PostDefendContactApplyTagChanceAbAttr, verbatim from the base commit.
function oldTagChance(
  attr: { chance: number; tagType: BattlerTagType },
  { move, pokemon, opponent }: { move: Move; pokemon: Pokemon; opponent: Pokemon },
): boolean {
  return (
    move.doesFlagEffectApply({ flag: MoveFlags.MAKES_CONTACT, user: opponent, target: pokemon })
    && pokemon.randBattleSeedInt(100) < attr.chance
    && opponent.canAddTag(attr.tagType)
  );
}

const TAG_USERS = [56, 115, 221, 5216, 5238, 5527, 5602, 5632, 5647, 5953];

describe("B01 chunk 4: Tier B splits equal the old canApply formulas", () => {
  let phaserGame: Phaser.Game;
  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("Seed Sower party heal (PostDefendPartyStatusHealAbAttr): the hit result, then whether anyone has a status", async () => {
    const world = await startWorld(phaserGame);
    const users = liveAttrs<PostDefendPartyStatusHealAbAttr>("PostDefendPartyStatusHealAbAttr", [269]);
    expect(users.length).toBe(1);
    const fresh = new (users[0].attr.constructor as new () => PostDefendPartyStatusHealAbAttr)();
    const parties: { status: unknown }[][] = [
      [],
      [{ status: null }],
      [{ status: undefined }, { status: null }],
      [{ status: null }, { status: { effect: 1 } }],
      [{ status: { effect: 4 } }],
      [{ status: null }, { status: null }, { status: { effect: 2 } }],
    ];
    let compared = 0;
    let trueCount = 0;
    for (const holder of [world.holder, world.foe]) {
      for (const party of parties) {
        // The team of a player Pokemon is the player party, the team of an enemy is the enemy party.
        vi.spyOn(globalScene, "getPlayerParty").mockReturnValue(party as never);
        vi.spyOn(globalScene, "getEnemyParty").mockReturnValue(party as never);
        for (const hitResult of HIT_RESULTS) {
          for (const { name, attr } of [...users, { name: "fresh", id: 0, attr: fresh }]) {
            const params = {
              pokemon: holder,
              opponent: holder === world.holder ? world.foe : world.holder,
              move: allMoves[MoveId.TACKLE],
              damage: 5,
              hitResult,
              simulated: false,
            } as PostMoveInteractionAbAttrParams;
            const expected = oldPartyHeal(hitResult, party);
            expect(attr.canApply(params), `${name} hit ${HitResult[hitResult]} party ${JSON.stringify(party)}`).toBe(
              expected,
            );
            compared++;
            trueCount += expected ? 1 : 0;
          }
        }
        vi.restoreAllMocks();
      }
    }
    expect(compared).toBeGreaterThan(200);
    expect(trueCount).toBeGreaterThan(20);
    // An undefined hit result is not "at least NO_EFFECT" in the old code either, so the old early return did not stop it.
    vi.spyOn(globalScene, "getPlayerParty").mockReturnValue([{ status: { effect: 1 } }] as never);
    const noResult = { pokemon: world.holder, opponent: world.foe, move: allMoves[MoveId.TACKLE], damage: 1 };
    expect(users[0].attr.canApply(noResult as never)).toBe(
      oldPartyHeal(undefined as unknown as HitResult, [{ status: { effect: 1 } }]),
    );
  });

  it("the tag chance class (Cute Charm and its family): contact, then ONE draw below the chance, then canAddTag, with the old draw count", async () => {
    const world = await startWorld(phaserGame);
    const users = liveAttrs<PostDefendContactApplyTagChanceAbAttr>("PostDefendContactApplyTagChanceAbAttr", TAG_USERS);
    expect(users.length).toBe(10);
    const targets = [
      ...users,
      { name: "fresh 30 infatuated", id: 0, attr: new TagChanceClass(30, BattlerTagType.INFATUATED) },
      { name: "fresh 99 trapped", id: 0, attr: new TagChanceClass(99, BattlerTagType.TRAPPED, 3) },
    ];
    const holder = world.holder;
    const foe = world.foe;
    const MOVES = [
      MoveId.TACKLE,
      MoveId.WATER_GUN,
      MoveId.EMBER,
      MoveId.SPLASH,
      MoveId.QUICK_ATTACK,
      MoveId.EARTHQUAKE,
    ];
    let compared = 0;
    let trueCount = 0;
    let drawn = 0;
    for (const roll of [0, 9, 10, 29, 30, 49, 50, 98, 99]) {
      for (const canAdd of [true, false]) {
        for (const id of MOVES) {
          const move = allMoves[id];
          for (const { name, attr } of targets) {
            const own = attr as unknown as { chance: number; tagType: BattlerTagType };
            const oldCalls: number[] = [];
            const newCalls: number[] = [];
            vi.spyOn(foe, "canAddTag").mockReturnValue(canAdd);
            vi.spyOn(holder, "randBattleSeedInt").mockImplementation(((bound: number) => {
              oldCalls.push(bound);
              return roll;
            }) as never);
            const params = {
              pokemon: holder,
              opponent: foe,
              move,
              damage: 5,
              hitResult: HitResult.EFFECTIVE,
              simulated: false,
            };
            const expected = oldTagChance(own, params);
            vi.restoreAllMocks();
            vi.spyOn(foe, "canAddTag").mockReturnValue(canAdd);
            vi.spyOn(holder, "randBattleSeedInt").mockImplementation(((bound: number) => {
              newCalls.push(bound);
              return roll;
            }) as never);
            const actual = attr.canApply(params as PostMoveInteractionAbAttrParams);
            vi.restoreAllMocks();
            expect(actual, `${name} roll ${roll} canAdd ${canAdd} ${move.name}`).toBe(expected);
            expect(newCalls, `${name} draws ${move.name}`).toEqual(oldCalls);
            compared++;
            trueCount += expected ? 1 : 0;
            drawn += oldCalls.length;
          }
        }
      }
    }
    expect(compared).toBeGreaterThan(1000);
    expect(trueCount).toBeGreaterThan(50);
    // A non-contact move draws nothing at all, a contact move draws exactly once with the bound 100.
    expect(drawn).toBeGreaterThan(100);
    expect(drawn).toBeLessThan(compared);
  });

  it("Effect Spore: a Grass or powder-proof attacker costs no random number; others draw the status pick, then the chance", async () => {
    const world = await startWorld(phaserGame);
    const users = liveAttrs<EffectSporeAbAttr>("EffectSporeAbAttr", [27]);
    expect(users.length).toBe(1);
    const attr = users[0].attr;
    const holder = world.holder;
    const foe = world.foe;
    const contact = allMoves[MoveId.TACKLE];
    const noContact = allMoves[MoveId.WATER_GUN];
    const run = (move: Move, setup: () => void): { result: boolean; calls: number[] } => {
      const calls: number[] = [];
      vi.spyOn(holder, "randBattleSeedInt").mockImplementation(((bound: number) => {
        calls.push(bound);
        return 0; // pick the first status, and a roll of 0 is always below the chance of 10
      }) as never);
      vi.spyOn(foe, "canSetStatus").mockReturnValue(true);
      setup();
      const result = attr.canApply({
        pokemon: holder,
        opponent: foe,
        move,
        damage: 5,
        hitResult: HitResult.EFFECTIVE,
        simulated: false,
      } as PostMoveInteractionAbAttrParams);
      vi.restoreAllMocks();
      return { result, calls };
    };
    const plain = (): void => {
      vi.spyOn(foe, "isOfType").mockReturnValue(false);
    };
    // A contact move against an ordinary attacker: pick one of 3 statuses (draw 1), then the 10 percent roll (draw 2).
    expect(run(contact, plain)).toEqual({ result: true, calls: [3, 100] });
    // A move without contact: the status pick is still drawn (it comes first), the chance roll is not.
    expect(run(noContact, plain)).toEqual({ result: false, calls: [3] });
    // A Grass type attacker: the powder clause stops before ANY draw.
    expect(
      run(contact, () => {
        vi.spyOn(foe, "isOfType").mockImplementation(((type: PokemonType) => type === PokemonType.GRASS) as never);
      }),
    ).toEqual({ result: false, calls: [] });
    // An attacker that already has a status: the pick is drawn, the chance roll is not.
    expect(
      run(contact, () => {
        plain();
        (foe as unknown as { status: unknown }).status = { effect: 1 };
      }),
    ).toEqual({ result: false, calls: [3] });
    (foe as unknown as { status: unknown }).status = null;
  });

  it("the library gate of every user (recomposed from its binding) answers like the live attr for EVERY roll from 0 to 99", async () => {
    // L1 and L2 only see a few roll values, so a chance written one off in a binding (49 for 50) passes them. Here every
    // roll value, the contact and non-contact moves and both feasibility answers are compared, draws included.
    const world = await startWorld(phaserGame);
    const holder = world.holder;
    const foe = world.foe;
    const cases: { className: string; ids: readonly number[] }[] = [
      { className: "PostDefendContactApplyTagChanceAbAttr", ids: TAG_USERS },
      { className: "EffectSporeAbAttr", ids: [27] },
    ];
    let compared = 0;
    for (const { className, ids } of cases) {
      const module = declRegistry.get(className)!;
      for (const { name, id, attr } of liveAttrs<AbAttr>(className, ids)) {
        const attrIndex = allAbilities[id].attrs.indexOf(attr);
        const rebuilt = recomposeAttr(module, attr, id, attrIndex);
        expect(rebuilt, name).not.toBe(attr);
        for (const roll of Array.from({ length: 100 }, (_, i) => i)) {
          for (const moveId of [MoveId.TACKLE, MoveId.WATER_GUN]) {
            for (const allowed of [true, false]) {
              const outcome = (target: AbAttr): { result: boolean; calls: number[] } => {
                const calls: number[] = [];
                vi.spyOn(holder, "randBattleSeedInt").mockImplementation(((bound: number) => {
                  calls.push(bound);
                  // Effect Spore asks for the status pick first (bound 3): answer 0 for it, the roll for the chance.
                  return bound === 100 ? roll : 0;
                }) as never);
                vi.spyOn(foe, "canAddTag").mockReturnValue(allowed);
                vi.spyOn(foe, "canSetStatus").mockReturnValue(allowed);
                vi.spyOn(foe, "isOfType").mockReturnValue(false);
                const result = (target as unknown as { canApply: (p: unknown) => boolean }).canApply({
                  pokemon: holder,
                  opponent: foe,
                  move: allMoves[moveId],
                  damage: 5,
                  hitResult: HitResult.EFFECTIVE,
                  simulated: false,
                });
                vi.restoreAllMocks();
                return { result, calls };
              };
              expect(outcome(rebuilt), `${name} roll ${roll} ${MoveId[moveId]} allowed ${allowed}`).toEqual(
                outcome(attr),
              );
              compared++;
            }
          }
        }
      }
    }
    expect(compared).toBe(11 * 100 * 2 * 2);
  });

  it("every live user reads back as the settings written by hand from the source", async () => {
    await startWorld(phaserGame);
    const expected: Record<number, { chance: number; effect: string; turns: number }> = {
      56: { chance: 50, effect: "Infatuated", turns: 0 }, // Cute Charm, rewritten from 30 to 50 by the ER patcher
      115: { chance: 10, effect: "Frostbite", turns: 0 }, // Ice Body
      221: { chance: 50, effect: "Trapped", turns: 0 }, // Tangling Hair
      5216: { chance: 50, effect: "Infatuated", turns: 0 }, // Prim and Proper
      5238: { chance: 50, effect: "Infatuated", turns: 0 }, // Pure Love
      5527: { chance: 50, effect: "Infatuated", turns: 0 }, // Tender Affection
      5602: { chance: 50, effect: "Trapped", turns: 0 }, // Moustache
      5632: { chance: 10, effect: "Frostbite", turns: 0 }, // Sundae
      5647: { chance: 50, effect: "Trapped", turns: 0 }, // Massive Pelt
      5953: { chance: 10, effect: "Frostbite", turns: 0 }, // Ice Body (second id)
    };
    const module = declRegistry.get("PostDefendContactApplyTagChanceAbAttr");
    expect(module).toBeDefined();
    const users = liveAttrs<PostDefendContactApplyTagChanceAbAttr>("PostDefendContactApplyTagChanceAbAttr", TAG_USERS);
    for (const { name, id, attr } of users) {
      expect(readDeclParams(module!, attr), `${name} (${id})`).toEqual(expected[id]);
    }
    expect(users.length).toBe(10);
    // The two codecs round trip every choice and refuse an unknown name.
    const effect = module!.decl.params.find(param => param.id === "effect")!;
    for (const name of effect.options ?? []) {
      expect(effect.codec!.fromInstance(effect.codec!.toCtor(name))).toBe(name);
    }
    expect(effect.codec!.toCtor("infatuated")).toBe(BattlerTagType.INFATUATED);
    expect(() => effect.codec!.toCtor("Poisoned")).toThrow();
    const turns = module!.decl.params.find(param => param.id === "turns")!;
    expect(turns.codec!.toCtor(0)).toBeUndefined();
    expect(turns.codec!.toCtor(3)).toBe(3);
    expect(turns.codec!.fromInstance(undefined)).toBe(0);
    expect(turns.codec!.fromInstance(3)).toBe(3);
  });
});

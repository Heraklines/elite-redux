/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B01 chunk 2 proof that the Tier B canApply splits (gatedCanApply: guards, gate, residual) are the OLD canApply
// formulas, clause for clause. The old formulas are copied here from the base commit (51fd0a3de, ab-attrs.ts) and
// compared with the live attrs (Wonder Guard, Tera Shell, Teraform Zero, every Field Priority user) and with fresh
// instances, over the grid moves, both attackers, HP states and a sweep of matchup values. This covers the three
// splits that the L2 twin cannot reach because their gate bindings are still legacy closures.
import {
  FieldPriorityMoveImmunityAbAttr,
  FullHpResistTypeAbAttr,
  NonSuperEffectiveImmunityAbAttr,
  TypeImmunityHealAbAttr,
  type TypeMultiplierAbAttrParams,
} from "#abilities/ab-attrs";
import { allAbilities, allMoves } from "#data/data-lists";
import { AbilityId } from "#enums/ability-id";
import { MoveId } from "#enums/move-id";
import { PokemonType } from "#enums/pokemon-type";
import type { Pokemon } from "#field/pokemon";
import type { Move } from "#moves/move";
import { startWorld } from "#test/tests/elite-redux/decomp/harness/game";
import { GRID_MOVES } from "#test/tests/elite-redux/decomp/harness/world";
import { BooleanHolder, NumberHolder, toDmgValue } from "#utils/common";
import Phaser from "phaser";
import { beforeAll, describe, expect, it } from "vitest";

const MATCHUPS = [0, 0.125, 0.25, 0.5, 0.75, 1, 1.5, 2, 4, 8];
/** The grid moves plus moves aimed at the user's side or an ally, so `isAllyTarget` is both true and false. */
const MOVES: MoveId[] = [...GRID_MOVES, MoveId.HELPING_HAND, MoveId.PROTECT, MoveId.SAFEGUARD, MoveId.FAKE_OUT];

// ---- the OLD formulas, verbatim from the base commit --------------------------------------------------------------
const oldNonSuper = (move: Move, typeMultiplier: NumberHolder): boolean =>
  move.is("AttackMove") && typeMultiplier.value < 2;
const oldFullHp = (typeMultiplier: unknown, move: Move | undefined, pokemon: Pokemon, ceiling: number): boolean =>
  typeMultiplier instanceof NumberHolder
  && !move?.hasAttr("FixedDamageAttr")
  && pokemon.isFullHp()
  && typeMultiplier.value > ceiling;
const oldFieldPriority = (move: Move, attacker: Pokemon, cancelled: BooleanHolder, pokemon: Pokemon): boolean =>
  !cancelled.value && move.getPriority(attacker) > 0 && !move.isAllyTarget() && attacker.isOpponent(pokemon);

function liveAttrs<T>(className: string, abilities?: AbilityId[]): { name: string; attr: T }[] {
  const found: { name: string; attr: T }[] = [];
  for (const ability of allAbilities) {
    if (ability === undefined || (abilities !== undefined && !abilities.includes(ability.id))) {
      continue;
    }
    for (const attr of ability.attrs) {
      if (attr.constructor.name === className) {
        found.push({ name: ability.name, attr: attr as T });
      }
    }
  }
  return found;
}

describe("B01 Tier B splits equal the old canApply formulas", () => {
  let phaserGame: Phaser.Game;
  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  it("Wonder Guard (NonSuperEffectiveImmunityAbAttr): the gate is the whole old formula", async () => {
    const world = await startWorld(phaserGame);
    const users = liveAttrs<NonSuperEffectiveImmunityAbAttr>("NonSuperEffectiveImmunityAbAttr");
    expect(users.length).toBeGreaterThan(0);
    users.push({ name: "fresh", attr: new NonSuperEffectiveImmunityAbAttr() });
    let compared = 0;
    for (const { name, attr } of users) {
      for (const id of MOVES) {
        const move = allMoves[id];
        for (const value of MATCHUPS) {
          for (const attacker of [world.foe, world.holder]) {
            const typeMultiplier = new NumberHolder(value);
            const params: TypeMultiplierAbAttrParams = {
              pokemon: world.holder,
              opponent: attacker,
              move,
              typeMultiplier,
              cancelled: new BooleanHolder(false),
              simulated: false,
            };
            expect(attr.canApply(params), `${name} ${move.name} x${value}`).toBe(oldNonSuper(move, typeMultiplier));
            compared++;
          }
        }
      }
    }
    expect(compared).toBeGreaterThan(500);
  });

  it("Tera Shell and Teraform Zero (FullHpResistTypeAbAttr): guards, then full HP, then the ceiling", async () => {
    const world = await startWorld(phaserGame);
    const users = liveAttrs<FullHpResistTypeAbAttr>("FullHpResistTypeAbAttr", [
      AbilityId.TERA_SHELL,
      AbilityId.TERAFORM_ZERO,
    ]);
    expect(users.length).toBe(2);
    const custom = new FullHpResistTypeAbAttr(0.25);
    const targets: { name: string; attr: FullHpResistTypeAbAttr; ceiling: number }[] = [
      ...users.map(user => ({ ...user, ceiling: 0.5 })),
      { name: "fresh default", attr: new FullHpResistTypeAbAttr(), ceiling: 0.5 },
      { name: "fresh 0.25", attr: custom, ceiling: 0.25 },
    ];
    let compared = 0;
    for (const { name, attr, ceiling } of targets) {
      for (const hp of [world.holder.getMaxHp(), world.holder.getMaxHp() - 1, 1]) {
        world.holder.hp = hp;
        for (const id of [...MOVES, undefined]) {
          const move = id === undefined ? undefined : allMoves[id];
          for (const value of MATCHUPS) {
            for (const holderKind of ["number holder", "plain object"] as const) {
              const typeMultiplier =
                holderKind === "number holder" ? new NumberHolder(value) : ({ value } as unknown as NumberHolder);
              const params = {
                pokemon: world.holder,
                opponent: world.foe,
                move,
                typeMultiplier,
                cancelled: new BooleanHolder(false),
                simulated: false,
              } as unknown as TypeMultiplierAbAttrParams;
              const expected = oldFullHp(typeMultiplier, move, world.holder, ceiling);
              expect(attr.canApply(params), `${name} ${move?.name} hp ${hp} x${value} ${holderKind}`).toBe(expected);
              compared++;
              if (expected) {
                attr.apply(params);
                expect(typeMultiplier.value).toBe(ceiling);
                expect(world.holder.turnData.moveEffectiveness).toBe(ceiling);
              }
            }
          }
        }
      }
    }
    world.holder.hp = world.holder.getMaxHp();
    expect(compared).toBeGreaterThan(1000);
  });

  it("Field Priority users: not cancelled, then priority above 0, then not an ally move and a foe attacker", async () => {
    const world = await startWorld(phaserGame);
    const users = liveAttrs<FieldPriorityMoveImmunityAbAttr>("FieldPriorityMoveImmunityAbAttr");
    expect(users.length).toBe(15);
    users.push({ name: "fresh", attr: new FieldPriorityMoveImmunityAbAttr() });
    let compared = 0;
    let trueCases = 0;
    for (const { name, attr } of users) {
      for (const id of MOVES) {
        const move = allMoves[id];
        for (const attacker of [world.foe, world.holder]) {
          for (const cancelledValue of [false, true]) {
            const make = () => ({
              pokemon: world.holder,
              opponent: attacker,
              move,
              cancelled: new BooleanHolder(cancelledValue),
              simulated: false,
            });
            const expected = oldFieldPriority(move, attacker, make().cancelled, world.holder);
            expect(attr.canApply(make()), `${name} ${move.name} cancelled ${cancelledValue}`).toBe(expected);
            compared++;
            trueCases += expected ? 1 : 0;
          }
        }
      }
    }
    expect(compared).toBeGreaterThan(500);
    // The test must reach the true branch (QUICK_ATTACK, SUCKER_PUNCH, FAKE_OUT are positive priority foe moves).
    expect(trueCases).toBeGreaterThan(0);
  });

  it("the old gate and the old residual are never both skipped: dropping the gate keeps the residual", async () => {
    const world = await startWorld(phaserGame);
    const attr = new FieldPriorityMoveImmunityAbAttr();
    attr.gateOverride = () => true;
    // With the gate forced true, an ordinary move from a foe passes; a move from the holder itself still fails the
    // residual (attacker.isOpponent), and a cancelled hit still fails the guard.
    const tackle = allMoves[MoveId.TACKLE];
    const base = { pokemon: world.holder, move: tackle, simulated: false };
    expect(attr.canApply({ ...base, opponent: world.foe, cancelled: new BooleanHolder(false) })).toBe(true);
    expect(attr.canApply({ ...base, opponent: world.holder, cancelled: new BooleanHolder(false) })).toBe(false);
    expect(attr.canApply({ ...base, opponent: world.foe, cancelled: new BooleanHolder(true) })).toBe(false);
  });

  it("Heal share: the default quarter is exactly maxHp / 4 for every max HP", () => {
    expect(new TypeImmunityHealAbAttr(PokemonType.WATER)).toHaveProperty("healShare", 0.25);
    for (let max = 1; max <= 2000; max++) {
      expect(toDmgValue(max * 0.25)).toBe(toDmgValue(max / 4));
    }
  });
});

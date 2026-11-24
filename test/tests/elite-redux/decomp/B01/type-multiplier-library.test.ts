/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B01 proof that "Take less (or more) damage from one type of move" is the same rule as the library's
// "damage taken is calculated + the move is <type> + multiply damage": every live ReceivedTypeDamageMultiplierAbAttr is
// compared with a ReceivedMoveDamageMultiplierAbAttr that gets the library atom `move.type` as its closure, over every
// grid move. This is what lets staff build "half damage from Fire" from the plain blocks without the shortcut block.
import { ReceivedMoveDamageMultiplierAbAttr, type ReceivedTypeDamageMultiplierAbAttr } from "#abilities/ab-attrs";
import { allAbilities, allMoves } from "#data/data-lists";
import { asDefendCondition, compileCondition } from "#data/elite-redux/ability-studio/vocabulary/evaluate/conditions";
import type { PokemonType } from "#enums/pokemon-type";
import { PokemonType as PokemonTypeEnum } from "#enums/pokemon-type";
import { startWorld } from "#test/tests/elite-redux/decomp/harness/game";
import { GRID_MOVES } from "#test/tests/elite-redux/decomp/harness/world";
import { NumberHolder } from "#utils/common";
import Phaser from "phaser";
import { beforeAll, describe, expect, it } from "vitest";

describe("B01 type damage multiplier equals the library form", () => {
  let phaserGame: Phaser.Game;
  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  it("every live user takes exactly the damage of move.type plus the plain damage multiplier", async () => {
    const world = await startWorld(phaserGame);
    const users: { name: string; attr: ReceivedTypeDamageMultiplierAbAttr }[] = [];
    for (const ability of allAbilities) {
      for (const attr of ability?.attrs ?? []) {
        if (attr.constructor.name === "ReceivedTypeDamageMultiplierAbAttr") {
          users.push({ name: ability.name, attr: attr as ReceivedTypeDamageMultiplierAbAttr });
        }
      }
    }
    expect(users.length).toBe(42);
    let compared = 0;
    for (const { name, attr } of users) {
      const live = attr as unknown as { moveType: PokemonType; damageMultiplier: number };
      const typeName = PokemonTypeEnum[live.moveType];
      const library = new ReceivedMoveDamageMultiplierAbAttr(
        asDefendCondition(compileCondition({ block: "move.type", params: { type: typeName, effective: true } })),
        live.damageMultiplier,
        false,
      );
      for (const id of GRID_MOVES) {
        const move = allMoves[id];
        const base = { pokemon: world.holder, opponent: world.foe, move, simulated: true } as const;
        const a = new NumberHolder(1001);
        const b = new NumberHolder(1001);
        const appliesA = attr.canApply({ ...base, damage: a });
        const appliesB = library.canApply({ ...base, damage: b });
        expect(appliesB, `${name} ${typeName} ${move.name}`).toBe(appliesA);
        if (appliesA) {
          attr.apply({ ...base, damage: a });
          library.apply({ ...base, damage: b });
        }
        expect(b.value, `${name} ${typeName} ${move.name}`).toBe(a.value);
        compared++;
      }
    }
    expect(compared).toBe(42 * GRID_MOVES.length);
  });
});

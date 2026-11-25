/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B14 chunk 7: Overloaded's priority and chip halves. Charge stacks cannot be set by a shared scenario axis, so the proof is here.
//  - Priority (Tier A): the constructor closure is compared with a literal copy of the ORIGINAL inline closure and with the tree
//    planned for the library, over every state of its clauses; the amount is a constructor argument (default 1).
//  - Chip (Tier B, clauses kept in apply): the effect is driven directly over every stack count, a fainted holder and a preview,
//    and in a real battle through the end-of-turn dispatch. The ability flyout still shows at every end of turn.
import { allMoves } from "#data/data-lists";
import { CHARGE_STACK_MAX, getCharge, setCharge } from "#data/elite-redux/abilities/charge-stack";
import {
  ER_OVERLOADED_ABILITY_ID,
  OverloadedChipAbAttr,
  OverloadedPriorityAbAttr,
} from "#data/elite-redux/abilities/electivire";
import { AbilityId } from "#enums/ability-id";
import { HitResult } from "#enums/hit-result";
import { MoveId } from "#enums/move-id";
import { PokemonType } from "#enums/pokemon-type";
import { SpeciesId } from "#enums/species-id";
import { GameManager } from "#test/framework/game-manager";
import { liveAbility } from "#test/tests/elite-redux/decomp/harness/twin";
import { NumberHolder } from "#utils/common";
import Phaser from "phaser";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

const OVERLOADED = ER_OVERLOADED_ABILITY_ID;

function newGame(phaserGame: Phaser.Game) {
  const game = new GameManager(phaserGame);
  game.override
    .battleStyle("single")
    .moveset([MoveId.CELEBRATE, MoveId.TACKLE])
    .ability(OVERLOADED as AbilityId)
    .startingLevel(100)
    .enemySpecies(SpeciesId.SNORLAX)
    .enemyLevel(100)
    .enemyAbility(AbilityId.BALL_FETCH)
    .enemyMoveset([MoveId.SPLASH])
    .criticalHits(false)
    .hasPassiveAbility(false)
    .enemyHasPassiveAbility(false);
  return game;
}

describe("B14 chunk 7: Overloaded, the priority half", () => {
  let phaserGame: Phaser.Game;
  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("stays attr 1 of Overloaded and the closure equals the original and the planned tree over every state of its clauses", async () => {
    const game = newGame(phaserGame);
    await game.classicMode.startBattle(SpeciesId.ELECTIVIRE);
    const holder = game.field.getPlayerPokemon();
    expect(liveAbility(OVERLOADED).attrs.map(attr => attr.constructor.name)).toEqual([
      "OverloadedPowerAbAttr",
      "OverloadedPriorityAbAttr",
      "OverloadedChipAbAttr",
    ]);
    const attr = liveAbility(OVERLOADED).attrs[1] as OverloadedPriorityAbAttr;
    const chip = holder.getAllActiveAbilityAttrs().filter(a => a?.constructor?.name === "OverloadedChipAbAttr");
    expect(chip).toHaveLength(1);
    let carries = true;
    vi.spyOn(holder, "getAllActiveAbilityAttrs").mockImplementation((() => (carries ? chip : [])) as never);
    let compared = 0;
    let accepted = 0;
    for (const charge of [0, 1, 3, 4]) {
      setCharge(holder, charge);
      for (const marker of [true, false]) {
        carries = marker;
        for (const moveId of [
          MoveId.THUNDERBOLT,
          MoveId.THUNDER_SHOCK,
          MoveId.TACKLE,
          MoveId.CELEBRATE,
          MoveId.WATER_GUN,
        ]) {
          const move = allMoves[moveId];
          // Copied from the code before the edit: the inline closure passed to super().
          const original =
            charge === CHARGE_STACK_MAX
            && holder.getAllActiveAbilityAttrs().some(a => a?.constructor?.name === "OverloadedChipAbAttr")
            && holder.getMoveType(move) === PokemonType.ELECTRIC;
          // The tree planned for the library: all[charge = 4, carries the marker, move is Electric].
          const planned = getCharge(holder) === 4 && marker && holder.getMoveType(move) === PokemonType.ELECTRIC;
          const params = { pokemon: holder, move, priority: new NumberHolder(0), simulated: false };
          expect(attr.canApply(params as never), `charge ${charge} marker ${marker} ${MoveId[moveId]}`).toBe(original);
          expect(original).toBe(planned);
          compared++;
          accepted += original ? 1 : 0;
        }
      }
    }
    expect(compared).toBe(40);
    expect(accepted).toBe(2); // full charge, with the marker, for the two Electric moves
  });

  it("apply adds 1 (or the setting) and a replaced closure replaces the whole condition", async () => {
    const game = newGame(phaserGame);
    await game.classicMode.startBattle(SpeciesId.ELECTIVIRE);
    const holder = game.field.getPlayerPokemon();
    const attr = liveAbility(OVERLOADED).attrs[1] as OverloadedPriorityAbAttr;
    const priority = new NumberHolder(0);
    attr.apply({ pokemon: holder, move: allMoves[MoveId.THUNDERBOLT], priority } as never);
    expect(priority.value).toBe(1);
    const custom = new OverloadedPriorityAbAttr(undefined, 3);
    const raised = new NumberHolder(2);
    custom.apply({ pokemon: holder, move: allMoves[MoveId.THUNDERBOLT], priority: raised } as never);
    expect(raised.value).toBe(5);
    setCharge(holder, 0);
    const frame = { pokemon: holder, move: allMoves[MoveId.TACKLE], priority, simulated: false } as never;
    expect(custom.canApply(frame)).toBe(false);
    const always = new OverloadedPriorityAbAttr(() => true, -1);
    expect(always.canApply(frame)).toBe(true);
    const lowered = new NumberHolder(0);
    always.apply({ pokemon: holder, move: allMoves[MoveId.TACKLE], priority: lowered } as never);
    expect(lowered.value).toBe(-1);
  });
});

describe("B14 chunk 7: Overloaded, the chip half", () => {
  let phaserGame: Phaser.Game;
  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("apply loses an eighth (at least 1) only at exactly full charge, never for a preview or a fainted holder", async () => {
    const game = newGame(phaserGame);
    await game.classicMode.startBattle(SpeciesId.ELECTIVIRE);
    const holder = game.field.getPlayerPokemon();
    const attr = liveAbility(OVERLOADED).attrs[2] as OverloadedChipAbAttr;
    const damage = vi.spyOn(holder, "damageAndUpdate").mockImplementation((() => 0) as never);
    expect(attr.canApply({ pokemon: holder, simulated: false } as never)).toBe(true);
    const expected = Math.max(1, Math.floor(holder.getMaxHp() / 8));
    for (const charge of [0, 1, 3, 4]) {
      setCharge(holder, charge);
      damage.mockClear();
      attr.apply({ pokemon: holder, simulated: false } as never);
      if (charge === CHARGE_STACK_MAX) {
        expect(damage).toHaveBeenCalledTimes(1);
        expect(damage).toHaveBeenCalledWith(expected, { result: HitResult.INDIRECT });
      } else {
        expect(damage, `charge ${charge}`).not.toHaveBeenCalled();
      }
    }
    setCharge(holder, 4);
    damage.mockClear();
    attr.apply({ pokemon: holder, simulated: true } as never);
    expect(damage).not.toHaveBeenCalled();
    vi.spyOn(holder, "isFainted").mockReturnValue(true);
    attr.apply({ pokemon: holder, simulated: false } as never);
    expect(damage).not.toHaveBeenCalled();
  });

  it("the share is a setting, a tiny max HP still loses 1, and a replaced gate replaces the stack test", async () => {
    const game = newGame(phaserGame);
    await game.classicMode.startBattle(SpeciesId.ELECTIVIRE);
    const holder = game.field.getPlayerPokemon();
    const damage = vi.spyOn(holder, "damageAndUpdate").mockImplementation((() => 0) as never);
    const quarter = new OverloadedChipAbAttr(0.25);
    setCharge(holder, 4);
    quarter.apply({ pokemon: holder, simulated: false } as never);
    expect(damage).toHaveBeenLastCalledWith(Math.floor(holder.getMaxHp() * 0.25), { result: HitResult.INDIRECT });
    vi.spyOn(holder, "getMaxHp").mockReturnValue(3);
    quarter.apply({ pokemon: holder, simulated: false } as never);
    expect(damage).toHaveBeenLastCalledWith(1, { result: HitResult.INDIRECT });
    setCharge(holder, 0);
    damage.mockClear();
    quarter.apply({ pokemon: holder, simulated: false } as never);
    expect(damage).not.toHaveBeenCalled();
    quarter.gateOverride = () => true;
    quarter.apply({ pokemon: holder, simulated: false } as never);
    expect(damage).toHaveBeenCalledTimes(1);
    // The guard is not replaceable: a fainted holder still takes nothing.
    vi.spyOn(holder, "isFainted").mockReturnValue(true);
    damage.mockClear();
    quarter.apply({ pokemon: holder, simulated: false } as never);
    expect(damage).not.toHaveBeenCalled();
  });

  it("in a real battle the holder loses an eighth at the end of a turn at 4 stacks and nothing at 3", async () => {
    const game = newGame(phaserGame);
    await game.classicMode.startBattle(SpeciesId.ELECTIVIRE);
    const holder = game.field.getPlayerPokemon();
    const maxHp = holder.getMaxHp();
    // Only the chip counts: indirect damage with no source (the foe may deal its own damage in the test world).
    const chips = () =>
      damage.mock.calls.filter(([, options]) => options?.result === HitResult.INDIRECT && options.source === undefined);
    const damage = vi.spyOn(holder, "damageAndUpdate");
    setCharge(holder, 3);
    game.move.select(MoveId.CELEBRATE);
    await game.phaseInterceptor.to("TurnEndPhase");
    expect(chips()).toHaveLength(0);
    setCharge(holder, 4);
    await game.toNextTurn();
    damage.mockClear();
    setCharge(holder, 4);
    game.move.select(MoveId.CELEBRATE);
    await game.phaseInterceptor.to("TurnEndPhase");
    expect(chips()).toHaveLength(1);
    expect(chips()[0][0]).toBe(Math.max(1, Math.floor(maxHp / 8)));
  });
});

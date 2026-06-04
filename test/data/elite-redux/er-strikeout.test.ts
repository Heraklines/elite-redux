import { ForceSwitchOutHelper } from "#abilities/ab-attrs";
import { allMoves } from "#data/data-lists";
import { ForceFoeOutOnInactivityAbAttr } from "#data/elite-redux/archetypes/force-foe-out-on-inactivity";
import { MoveCategory } from "#enums/move-category";
import { MoveUseMode } from "#enums/move-use-mode";
import type { TurnMove } from "#types/turn-move";
import { describe, expect, it, vi } from "vitest";

/**
 * Strikeout — "Forces the foe out if they don't attack for 3 turns."
 * Unit-level: drive PostTurn apply() against a stub foe whose move history we
 * control, asserting the idle counter accumulates only on idle turns and that
 * the foe is force-switched at the 3rd consecutive idle turn.
 *
 * Move ids are resolved by category at runtime (ER remaps several vanilla move
 * ids), so the tests stay correct regardless of the ER id mapping.
 */
describe("ER ability - Strikeout (force foe out on inactivity)", () => {
  const damagingMove = () => allMoves.find(m => m && m.category !== MoveCategory.STATUS)!.id;
  const statusMove = () => allMoves.find(m => m && m.category === MoveCategory.STATUS)!.id;

  const makeFoe = () => {
    const history: TurnMove[] = [];
    const foe = {
      isFainted: () => false,
      getMoveHistory: () => history,
      getBattlerIndex: () => 0,
    } as any;
    const pushMove = (move: number) => history.push({ move, targets: [], useMode: MoveUseMode.NORMAL });
    return { foe, pushMove };
  };

  const runTurn = (attr: ForceFoeOutOnInactivityAbAttr, foe: any) => {
    const pokemon = { getOpponents: () => [foe] } as any;
    attr.apply({ pokemon, simulated: false } as any);
  };

  it("forces the foe out after 3 idle turns, then resets", () => {
    const spy = vi.spyOn(ForceSwitchOutHelper.prototype, "switchOutLogic").mockReturnValue(true);
    const attr = new ForceFoeOutOnInactivityAbAttr(3);
    const { foe } = makeFoe();

    runTurn(attr, foe); // idle 1
    expect(attr.idleTurns(foe)).toBe(1);
    expect(spy).not.toHaveBeenCalled();

    runTurn(attr, foe); // idle 2
    expect(attr.idleTurns(foe)).toBe(2);
    expect(spy).not.toHaveBeenCalled();

    runTurn(attr, foe); // idle 3 -> switch + reset
    expect(spy).toHaveBeenCalledTimes(1);
    expect(attr.idleTurns(foe)).toBe(0);
    spy.mockRestore();
  });

  it("resets the idle counter when the foe uses a damaging move", () => {
    const spy = vi.spyOn(ForceSwitchOutHelper.prototype, "switchOutLogic").mockReturnValue(true);
    const attr = new ForceFoeOutOnInactivityAbAttr(3);
    const { foe, pushMove } = makeFoe();

    runTurn(attr, foe); // idle 1
    runTurn(attr, foe); // idle 2
    pushMove(damagingMove()); // foe attacked
    runTurn(attr, foe); // attack seen -> reset to 0
    expect(attr.idleTurns(foe)).toBe(0);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("treats a status move as NOT attacking (idle keeps climbing)", () => {
    const attr = new ForceFoeOutOnInactivityAbAttr(3);
    const { foe, pushMove } = makeFoe();

    pushMove(statusMove());
    runTurn(attr, foe); // status move -> still idle
    expect(attr.idleTurns(foe)).toBe(1);
  });
});

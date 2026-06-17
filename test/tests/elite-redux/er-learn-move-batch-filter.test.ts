import { MoveId } from "#enums/move-id";
import { filterLearnableMoves } from "#phases/learn-move-batch-phase";
import { describe, expect, it } from "vitest";

/**
 * Unit tests for the level-up Move Learn panel's offer list (ER QoL). The panel
 * must never offer a move the mon already knows or list the same move twice -
 * otherwise a move could be "learned" twice - and an all-filtered result must be
 * empty so the panel skips itself on a level that teaches nothing new.
 */
describe("filterLearnableMoves (level-up Move Learn panel)", () => {
  it("drops moves the mon already knows", () => {
    const out = filterLearnableMoves([MoveId.EMBER, MoveId.TACKLE, MoveId.GROWL], [MoveId.TACKLE]);
    expect(out).toEqual([MoveId.EMBER, MoveId.GROWL]);
  });

  it("de-duplicates so a move can't be offered (and learned) twice", () => {
    const out = filterLearnableMoves([MoveId.EMBER, MoveId.EMBER, MoveId.GROWL], []);
    expect(out).toEqual([MoveId.EMBER, MoveId.GROWL]);
  });

  it("drops MoveId.NONE", () => {
    const out = filterLearnableMoves([MoveId.NONE, MoveId.EMBER, MoveId.NONE], []);
    expect(out).toEqual([MoveId.EMBER]);
  });

  it("preserves order of the surviving moves", () => {
    const out = filterLearnableMoves([MoveId.GROWL, MoveId.EMBER, MoveId.TACKLE], []);
    expect(out).toEqual([MoveId.GROWL, MoveId.EMBER, MoveId.TACKLE]);
  });

  it("returns empty when everything is already known (panel skips itself)", () => {
    const out = filterLearnableMoves([MoveId.TACKLE, MoveId.GROWL], [MoveId.TACKLE, MoveId.GROWL]);
    expect(out).toEqual([]);
  });

  it("handles an empty input", () => {
    expect(filterLearnableMoves([], [MoveId.TACKLE])).toEqual([]);
  });
});

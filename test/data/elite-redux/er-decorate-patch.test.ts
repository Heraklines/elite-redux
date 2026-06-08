import { allMoves } from "#data/data-lists";
import { MoveCategory } from "#enums/move-category";
import { MoveId } from "#enums/move-id";
import { MoveTarget } from "#enums/move-target";
import { PokemonType } from "#enums/pokemon-type";
import { describe, expect, it } from "vitest";

// ER Decorate: vanilla ally-buff status → Special Fairy damaging (80 BP) aimed
// at the FOE, that raises the USER's Atk/SpAtk. Regression for "Decorate chip-
// damaged my own ally and buffed the opponent".
describe("ER Decorate patch", () => {
  it("is a Special Fairy 80-BP move that targets the foe", () => {
    const m = allMoves[MoveId.DECORATE];
    expect(m.category).toBe(MoveCategory.SPECIAL);
    expect(m.power).toBe(80);
    expect(m.type).toBe(PokemonType.FAIRY);
    expect(m.moveTarget).toBe(MoveTarget.NEAR_OTHER);
  });

  it("carries a SELF-targeted Atk/SpAtk +2 boost (not aimed at the foe)", () => {
    const m = allMoves[MoveId.DECORATE];
    const attrs = m.getAttrs("StatStageChangeAttr");
    expect(attrs.length).toBe(1);
    const ss = attrs[0] as unknown as { stages: number; selfTarget: boolean };
    expect(ss.stages).toBe(2);
    expect(ss.selfTarget).toBe(true);
  });
});

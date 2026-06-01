import { BoneMoveTypeChartAbAttr } from "#data/elite-redux/archetypes/bone-move-type-chart";
import { MoveFlags } from "#enums/move-flags";
import { describe, expect, it } from "vitest";

/**
 * Bone Zone — "Bone moves ignore immunities and deal 2x on not very effective."
 * BONE_BASED moves: 0x→1x (bypass immunity), <1x→×2 (resisted doubled),
 * neutral/SE unchanged; non-bone moves untouched.
 */
describe("ER ability - Bone Zone (bone-move type chart)", () => {
  const attr = new BoneMoveTypeChartAbAttr();
  const boneMove = { hasFlag: (f: MoveFlags) => f === MoveFlags.BONE_BASED } as any;
  const normalMove = { hasFlag: () => false } as any;

  const fire = (move: any, eff: number) => {
    const multi = { value: eff };
    attr.fire(move, multi as any);
    return multi.value;
  };

  it("bypasses immunity (0x → 1x) for bone moves", () => {
    expect(fire(boneMove, 0)).toBe(1);
  });

  it("doubles resisted damage for bone moves", () => {
    expect(fire(boneMove, 0.5)).toBe(1); // 0.5 * 2
    expect(fire(boneMove, 0.25)).toBe(0.5); // 0.25 * 2
  });

  it("leaves neutral and super-effective unchanged", () => {
    expect(fire(boneMove, 1)).toBe(1);
    expect(fire(boneMove, 2)).toBe(2);
    expect(fire(boneMove, 4)).toBe(4);
  });

  it("does nothing for non-bone moves", () => {
    expect(fire(normalMove, 0)).toBe(0);
    expect(fire(normalMove, 0.5)).toBe(0.5);
  });
});

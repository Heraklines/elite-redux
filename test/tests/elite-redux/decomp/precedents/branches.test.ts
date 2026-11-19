/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// PRECEDENT probes for the branches class (HpThresholdFormChangeAbAttr). The L1 grid and the L2 twin run a holder that
// has no "transformed" form, so the half of the gate that needs "I am in the form" is proven here with a stand-in
// Pokemon (only the members the class and the library read). The sweep also proves the claim that the class's float
// test `hp / maxHp <= threshold` equals the library's integer test `hp * 100 <= maxHp * pct` for whole-number
// percent thresholds, over every HP of several max-HP values.
import { recomposeAttr } from "#data/elite-redux/ability-studio/build-attr";
import { declRegistry } from "#data/elite-redux/ability-studio/decl-registry";
import type { HpThresholdFormChangeAbAttr } from "#data/elite-redux/archetypes/hp-threshold-form-change";
import { allAttrSites } from "#test/tests/elite-redux/decomp/harness/sites";
import { liveAbility } from "#test/tests/elite-redux/decomp/harness/twin";
import type { PostMoveInteractionAbAttrParams } from "#types/ability-types";
import { beforeAll, describe, expect, it } from "vitest";

const APE_SHIFT = 5436;
const LOCUST_SWARM = 5585;

interface FakeMon {
  hp: number;
  formIndex: number;
  fainted: boolean;
  readonly species: { forms: { formKey: string }[] };
  getMaxHp(): number;
  getFormKey(): string;
  isFainted(): boolean;
}

function fakeMon(formKey: string, maxHp: number): FakeMon {
  const forms = [{ formKey: "" }, { formKey }];
  const mon: FakeMon = {
    hp: maxHp,
    formIndex: 0,
    fainted: false,
    species: { forms },
    getMaxHp: () => maxHp,
    getFormKey: () => (forms.length <= mon.formIndex ? "" : forms[mon.formIndex].formKey),
    isFainted: () => mon.fainted,
  };
  return mon;
}

describe("precedent: branches (HpThresholdFormChangeAbAttr)", () => {
  beforeAll(() => {
    expect(allAttrSites().length).toBeGreaterThan(2800);
  });

  for (const [id, name, formKey] of [
    [APE_SHIFT, "Ape Shift (low-HP form, 50%)", "transformed"],
    [LOCUST_SWARM, "Locust Swarm (high-HP form, 25%)", "hivemind"],
  ] as const) {
    it(`${name}: the rebuilt gate agrees with the original XOR for every HP, in and out of the form, fainted or not`, () => {
      const original = liveAbility(id).attrs[0] as HpThresholdFormChangeAbAttr;
      const module = declRegistry.get("HpThresholdFormChangeAbAttr");
      expect(module).toBeDefined();
      const rebuilt = recomposeAttr(module!, original, id, 0);
      let compared = 0;
      let trueCount = 0;
      for (const maxHp of [4, 99, 100, 101, 357, 714, 999]) {
        const mon = fakeMon(formKey, maxHp);
        for (const formIndex of [0, 1]) {
          for (const fainted of [false, true]) {
            for (let hp = fainted ? 0 : 1; hp <= maxHp; hp++) {
              mon.hp = hp;
              mon.formIndex = formIndex;
              mon.fainted = fainted;
              const params = { pokemon: mon, simulated: false } as unknown as PostMoveInteractionAbAttrParams;
              const expected = original.canApply(params);
              expect(rebuilt.canApply(params), `${name}: hp ${hp}/${maxHp} form ${formIndex} fainted ${fainted}`).toBe(
                expected,
              );
              compared++;
              trueCount += expected ? 1 : 0;
            }
          }
        }
      }
      // Both outcomes were exercised, so a gate that is always true or always false could not pass.
      expect(trueCount).toBeGreaterThan(100);
      expect(compared - trueCount).toBeGreaterThan(100);
    });
  }

  it("a fainted holder is stopped by the guard even when the gate would say yes", () => {
    const original = liveAbility(APE_SHIFT).attrs[0] as HpThresholdFormChangeAbAttr;
    const module = declRegistry.get("HpThresholdFormChangeAbAttr")!;
    const rebuilt = recomposeAttr(module, original, APE_SHIFT, 0);
    const mon = fakeMon("transformed", 100);
    mon.hp = 10;
    mon.fainted = true;
    const params = { pokemon: mon, simulated: false } as unknown as PostMoveInteractionAbAttrParams;
    expect(original.canApply(params)).toBe(false);
    expect(rebuilt.canApply(params)).toBe(false);
    expect(module.decl.guards).toEqual(["not-fainted"]);
  });
});

/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// PRECEDENT probe for editable params of a Tier B class. The gate binding repeats the param as a literal (ratio 0.5,
// pct 30, pct 50 ...). `gateParams` in the declaration makes `recomposeAttr` write the LIVE param into that literal,
// so a slider moved by staff moves the compiled gate too. Without it the slider would silently do nothing.
import { PostDamageForceSwitchAbAttr } from "#abilities/ab-attrs";
import { allAbilities } from "#data/data-lists";
import { getBinding } from "#data/elite-redux/ability-studio/bindings";
import { recomposeAttr } from "#data/elite-redux/ability-studio/build-attr";
import { lintDecl } from "#data/elite-redux/ability-studio/decl-lint";
import { declRegistry } from "#data/elite-redux/ability-studio/decl-registry";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";
import { AbilityId } from "#enums/ability-id";
import { describe, expect, it } from "vitest";

const MAX = 651;
// A hit that takes the holder from 326 to 325: it crosses the 50% line (325.5) but not the 35% line (227.85).
const fakeHolder = (hp: number) =>
  ({ hp, getMaxHp: () => MAX, isFullHp: () => hp >= MAX, getHeldItems: () => [] }) as never;

describe("precedent: editable params of a Tier B class drive the compiled gate", () => {
  const module = declRegistry.get("PostDamageForceSwitchAbAttr")!;

  const gateOf = (hpRatio: number | undefined) => {
    const wimpOut = allAbilities[AbilityId.WIMP_OUT].attrs[0] as PostDamageForceSwitchAbAttr;
    const rebuilt = recomposeAttr(
      module,
      wimpOut,
      AbilityId.WIMP_OUT,
      0,
      hpRatio === undefined ? {} : { params: { hpRatio } },
    ) as PostDamageForceSwitchAbAttr;
    return { rebuilt, gate: rebuilt.gateOverride! };
  };

  it("hpRatio 0.35 moves the switch-out line: a hit crossing 50% but not 35% no longer passes", () => {
    const hit = { pokemon: fakeHolder(325), damage: 1 } as never;
    expect(gateOf(undefined).gate(hit)).toBe(true);
    expect(gateOf(0.5).gate(hit)).toBe(true);
    expect(gateOf(0.35).gate(hit)).toBe(false);
    // a hit that does cross 35% passes with the 0.35 line and agrees with an original built with that ratio
    const deep = { pokemon: fakeHolder(227), damage: 2 } as never;
    expect(gateOf(0.35).gate(deep)).toBe(true);
    expect(new PostDamageForceSwitchAbAttr(0.35).gate(deep)).toBe(true);
    expect(new PostDamageForceSwitchAbAttr(0.35).gate(hit)).toBe(false);
  });

  it("the binding itself is not mutated by an override", () => {
    gateOf(0.35);
    expect(getBinding(AbilityId.WIMP_OUT, 0, "gate")?.spec).toMatchObject({ params: { ratio: 0.5 } });
  });

  it("the form-change line follows threshold (Ape Shift 50 -> 80)", () => {
    const module = declRegistry.get("HpThresholdFormChangeAbAttr")!;
    const apeShift = allAbilities[5436 as AbilityId].attrs[0];
    const rebuilt = recomposeAttr(module, apeShift, 5436, 0, { params: { threshold: 80 } });
    const target = { pokemon: { hp: 70, getMaxHp: () => 100, isFullHp: () => false, getFormKey: () => "" } } as never;
    const gate = (rebuilt as unknown as { gateOverride: (p: never) => boolean }).gateOverride;
    // at 70% HP and not in the form: only an 80% line puts the holder "low", so the XOR is true (change form)
    expect(gate(target)).toBe(true);
    const unchanged = recomposeAttr(module, apeShift, 5436, 0);
    expect((unchanged as unknown as { gateOverride: (p: never) => boolean }).gateOverride(target)).toBe(false);
  });

  it("the contact-status chance follows chance (30 -> 100 always rolls true, 1 almost never)", () => {
    const module = declRegistry.get("PostDefendContactApplyStatusEffectAbAttr")!;
    const static_ = allAbilities[AbilityId.STATIC].attrs[0];
    const move = { doesFlagEffectApply: () => true } as never;
    const params = {
      pokemon: { randBattleSeedInt: () => 49 },
      opponent: { status: null },
      move,
      simulated: false,
    } as never;
    const gateAt = (chance: number) =>
      (
        recomposeAttr(module, static_, AbilityId.STATIC, 0, { params: { chance } }) as unknown as {
          gateOverride: (p: never) => boolean;
        }
      ).gateOverride;
    expect(gateAt(30)(params)).toBe(false);
    expect(gateAt(50)(params)).toBe(true);
    expect(gateAt(30)(params)).toBe(false);
  });

  it("L0 refuses an editable param of a gated class that the gate binding could silently ignore", () => {
    const { gateParams: _dropped, ...withoutGateParams } = module.decl;
    const problems = lintDecl(defineDecl(module.ctor, withoutGateParams));
    expect(problems.join(" ")).toContain('param "hpRatio" is editable but the gate binding may repeat it');
    expect(lintDecl(module)).toEqual([]);
  });
});

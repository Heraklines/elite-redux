/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// #207: ER custom mega stones — verify the enum/bridge/item wiring so the
// reward pool can offer them and holding one triggers the base mon's mega form.

import { erMegaStoneIconFrame, isErMegaStone, resolveErStoneFormChangeItem } from "#data/elite-redux/er-mega-stones";
import { ER_FORM_CHANGE_KIND, ER_FORM_CHANGES_BY_SOURCE } from "#data/elite-redux/init-elite-redux-form-changes";
import { pokemonFormChanges } from "#data/pokemon-forms";
import { SpeciesFormChangeItemTrigger } from "#data/pokemon-forms/form-change-triggers";
import { FormChangeItem } from "#enums/form-change-item";
import { SpeciesId } from "#enums/species-id";
import { FormChangeItemModifierType } from "#modifiers/modifier-type";
import { describe, expect, it } from "vitest";

describe("ER custom mega stones (#207)", () => {
  it("resolves an ER-custom stone const to a real FormChangeItem", () => {
    const stone = resolveErStoneFormChangeItem("ITEM_BUTTERFRENITE");
    expect(stone).toBeDefined();
    expect(isErMegaStone(stone!)).toBe(true);
    // reuses an existing icon frame (generic or base stone), not its own name
    expect(erMegaStoneIconFrame(stone!)).toBeTruthy();
  });

  it("reuses the base vanilla stone icon for a vanilla-mega variant", () => {
    const stone = resolveErStoneFormChangeItem("ITEM_AGGRONITE_R");
    expect(stone).toBeDefined();
    expect(erMegaStoneIconFrame(stone!)).toBe("aggronite");
  });

  it("still resolves vanilla stones to the vanilla enum value (not ER-custom)", () => {
    const venu = resolveErStoneFormChangeItem("ITEM_VENUSAURITE");
    expect(venu).toBe(FormChangeItem.VENUSAURITE);
    expect(isErMegaStone(venu!)).toBe(false);
  });

  it("Butterfree's bridged mega form-change carries the real Butterfrenite trigger", () => {
    const stone = resolveErStoneFormChangeItem("ITEM_BUTTERFRENITE")!;
    const fcs = pokemonFormChanges[SpeciesId.BUTTERFREE] ?? [];
    const items = fcs
      .filter(fc => fc.trigger.hasTriggerType(SpeciesFormChangeItemTrigger))
      .map(fc => (fc.findTrigger(SpeciesFormChangeItemTrigger) as SpeciesFormChangeItemTrigger).item);
    expect(items).toContain(stone);
  });

  it("an ER stone modifier type has a title-cased name + reuses an existing atlas icon", () => {
    const stone = resolveErStoneFormChangeItem("ITEM_CROBATITE")!;
    const type = new FormChangeItemModifierType(stone);
    expect(type.name).toBe("Crobatite");
    // ER-exclusive stones reuse the generic existing atlas frame (their own
    // decomp art isn't in pokerogue's packed items atlas).
    expect(type.iconImage).toBe("lucarionite");
  });

  it("every ER mega/primal entry resolves to a known FormChangeItem", () => {
    const all = [...ER_FORM_CHANGES_BY_SOURCE.values()]
      .flat()
      .filter(e => e.kind === ER_FORM_CHANGE_KIND.MEGA || e.kind === ER_FORM_CHANGE_KIND.PRIMAL);
    const unresolved = all
      .map(e => (e as { requirement?: string }).requirement)
      .filter((r): r is string => typeof r === "string" && r.startsWith("ITEM_"))
      .filter(r => resolveErStoneFormChangeItem(r) === undefined);
    expect(unresolved).toEqual([]);
  });
});

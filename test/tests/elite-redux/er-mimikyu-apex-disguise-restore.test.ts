/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — APEX Mimikyu's busted Disguise must RESTORE.
//
// Report: APEX Mimikyu's busted Disguise never heals (unlike vanilla Mimikyu,
// which restores between battles / on faint). The Apex / Rayquaza tiers are
// SEPARATE ER species (not forms on base Mimikyu), so they need their OWN
// disguise <-> busted edges. Vanilla Disguise resets to form 0 via PostBattleInit
// / PostFaint form-change attrs that fire a SpeciesFormChangeAbilityTrigger; that
// no-ops unless a `busted -> ""` ABILITY edge exists (the restore edge). This
// locks BOTH directions for the APEX species (the #259 Mimikyu-Rayquaza
// registration class).
//
// Gated behind ER_SCENARIO=1 (needs the ER form-change init to have run).
// =============================================================================

import { pokemonFormChanges, type SpeciesFormChange } from "#data/pokemon-forms";
import { SpeciesFormChangeAbilityTrigger } from "#data/pokemon-forms/form-change-triggers";
import type { SpeciesId } from "#enums/species-id";
import { describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

/** Pokerogue species id of Mimikyu Apex (ER draft 2638). */
const MIMIKYU_APEX_ID = 10821 as SpeciesId;

describe.skipIf(!RUN)("ER — APEX Mimikyu disguise restore edges", () => {
  const edges = (): SpeciesFormChange[] =>
    (pokemonFormChanges[MIMIKYU_APEX_ID] as SpeciesFormChange[] | undefined) ?? [];

  it("registers the break edge (base -> busted) via an ability trigger", () => {
    const list = edges();
    expect(list.length, "Apex Mimikyu should have form-change edges registered").toBeGreaterThan(0);
    const breakEdge = list.find(fc => fc.preFormKey === "" && fc.formKey === "busted");
    expect(breakEdge, "Apex Mimikyu needs a base -> busted edge").toBeDefined();
    expect(
      breakEdge?.findTrigger(SpeciesFormChangeAbilityTrigger),
      "the break edge must use an ability trigger (Disguise)",
    ).toBeTruthy();
  });

  it("registers the RESTORE edge (busted -> base) so the disguise heals", () => {
    const restore = edges().find(fc => fc.preFormKey === "busted" && fc.formKey === "");
    expect(restore, "Apex Mimikyu needs a busted -> base restore edge (else the disguise never heals)").toBeDefined();
    expect(
      restore?.findTrigger(SpeciesFormChangeAbilityTrigger),
      "the restore edge must use an ability trigger (PostBattleInit / PostFaint fire it)",
    ).toBeTruthy();
  });
});

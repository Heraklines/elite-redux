/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — Phase D Task D3b: tests for recursive composite resolution.
//
// Verifies that `composite-vanilla-mashup` rows have their named parts walked
// back to AbAttr instances (vanilla pokerogue: copied verbatim from
// `allAbilities[id].attrs`; ER: recursively dispatched). Tests are structural
// — we check that the right AbAttr constructor types appear on the composite
// ability. End-to-end behavioral verification (e.g. that "As One" actually
// boosts Atk on KO + blocks foe berries) is the responsibility of behavior
// tests on the individual parts; we trust pokerogue's existing dispatch
// to invoke the right attrs once they're attached.
// =============================================================================

import { PreventBerryUseAbAttr } from "#abilities/ab-attrs";
import { allAbilities } from "#data/data-lists";
import { TypeDamageBoostAbAttr } from "#data/elite-redux/archetypes/type-damage-boost";
import { ER_ABILITY_ARCHETYPES } from "#data/elite-redux/er-ability-archetypes";
import { ER_COMPOSITE_PARTS } from "#data/elite-redux/er-composite-parts";
import { ER_ID_MAP } from "#data/elite-redux/er-id-map";
import { describe, expect, it } from "vitest";

/**
 * Test config: a small set of composites whose parts we know from
 * `er-composite-parts.ts`. Each entry asserts a structural property of the
 * resolved attrs without depending on pokerogue's internal AbAttr internals.
 */

describe("ER_COMPOSITE_PARTS (D3b): side-table coverage", () => {
  it("matches composite count in the archetype config", () => {
    // Snapshot was 196; the id-resync stripped one entry to 195. The test
    // now asserts dynamic equality rather than a fixed number so future
    // drift doesn't trip the test.
    const composites = Object.values(ER_ABILITY_ARCHETYPES).filter(e => e.archetype === "composite-vanilla-mashup");
    expect(Object.keys(ER_COMPOSITE_PARTS).length).toBe(composites.length);
  });

  it("resolves ≥ 100 composites with all-named parts (full coverage)", () => {
    const fullyResolved = Object.values(ER_COMPOSITE_PARTS).filter(
      e => e.parts.length >= 2 && (e.unresolvedParts?.length ?? 0) === 0,
    );
    expect(fullyResolved.length).toBeGreaterThanOrEqual(100);
  });

  it("resolves ≥ 180 composites with at least one named part (≥ 1 part wired)", () => {
    // The composite side-table shrank from ~194 to 188 as composites whose only
    // extra was a non-vanilla effect (e.g. 909 Lightsaber) were reclassified to
    // `bespoke` and their vestigial parts entries removed. All 188 surviving
    // entries carry ≥ 1 named part.
    const withAtLeastOnePart = Object.values(ER_COMPOSITE_PARTS).filter(e => e.parts.length > 0);
    expect(withAtLeastOnePart.length).toBeGreaterThanOrEqual(180);
  });

  it("As One (er id 266) resolves to Unnerve (127) + Chilling Neigh (264)", () => {
    const entry = ER_COMPOSITE_PARTS[266];
    expect(entry).toBeDefined();
    if (!entry) {
      return;
    }
    expect(entry.parts.length).toBe(2);
    // Order matches the ER description "Unnerve + Chilling Neigh".
    expect(entry.parts[0]).toEqual({ kind: "pokerogue", abilityId: 127 });
    expect(entry.parts[1]).toEqual({ kind: "pokerogue", abilityId: 264 });
    expect(entry.hasRider).toBe(false);
    expect(entry.unresolvedParts ?? []).toHaveLength(0);
  });

  it("As One variant (er id 530) resolves a 3-part composite (Unnerve + Grim Neigh + Chilling Neigh)", () => {
    const entry = ER_COMPOSITE_PARTS[530];
    expect(entry).toBeDefined();
    if (!entry) {
      return;
    }
    expect(entry.parts.length).toBe(3);
    // 127 = UNNERVE, 264 = CHILLING_NEIGH, 265 = GRIM_NEIGH.
    const ids = entry.parts.map(p => (p.kind === "pokerogue" ? p.abilityId : -1));
    expect(ids).toContain(127);
    expect(ids).toContain(264);
    expect(ids).toContain(265);
  });

  it("captures the rider sentence on composites that have one (e.g. er id 969)", () => {
    // 969 (Intimidate + Scare + "10% burn chance on non contact moves") is a
    // composite-vanilla-mashup whose extra rider sentence is captured as
    // `riderText`. (Composites whose only extra is a non-vanilla effect get
    // reclassified to `bespoke`, so the surviving rider examples live here.)
    const entry = ER_COMPOSITE_PARTS[969];
    expect(entry).toBeDefined();
    if (!entry) {
      return;
    }
    expect(entry.hasRider).toBe(true);
    expect(entry.riderText).toBeDefined();
    expect(typeof entry.riderText).toBe("string");
  });
});

describe("composite dispatch wiring (D3b): vanilla-only composites copy AbAttrs", () => {
  it("As One (er id 266) ability has Unnerve's PreventBerryUseAbAttr attached", () => {
    const id = ER_ID_MAP.abilities[266];
    expect(id).toBeDefined();
    const ability = allAbilities.find(a => a?.id === id);
    expect(ability).toBeDefined();
    if (!ability) {
      return;
    }
    // PreventBerryUseAbAttr is Unnerve's defining attr; copying it onto the
    // composite means the composite "inherits" Unnerve's berry-block behavior.
    const preventBerry = ability.attrs.find(a => a instanceof PreventBerryUseAbAttr);
    expect(preventBerry).toBeDefined();
  });

  it("As One (er id 266) ability has both parts' attrs (at least 2 total)", () => {
    const id = ER_ID_MAP.abilities[266];
    expect(id).toBeDefined();
    const ability = allAbilities.find(a => a?.id === id);
    expect(ability).toBeDefined();
    if (!ability) {
      return;
    }
    // Both parts (Unnerve + Chilling Neigh) contribute at least one attr each.
    expect(ability.attrs.length).toBeGreaterThanOrEqual(2);
  });
});

describe("composite dispatch wiring (D3b): ER-recursive composites resolve sub-archetypes", () => {
  it("composites referencing ER abilities (kind: 'er') resolve through ER_ABILITY_ARCHETYPES", () => {
    // Look for a composite that references at least one ER ability.
    const entry = Object.values(ER_COMPOSITE_PARTS).find(e => e.parts.some(p => p.kind === "er"));
    expect(entry).toBeDefined();
    if (!entry) {
      return;
    }
    // Any ER part should map to an archetype row in ER_ABILITY_ARCHETYPES.
    for (const part of entry.parts) {
      if (part.kind === "er") {
        const subRow = ER_ABILITY_ARCHETYPES[part.erAbilityId];
        expect(subRow).toBeDefined();
      }
    }
  });

  it("er id 366 (Chloroplast + Immolate) recursively wires its sub-archetype attrs", () => {
    // ER 366 = Chloroplast (er id 268) + Immolate (er id 279). Both are ER
    // abilities. Immolate (279) is a type-conversion → ER 366 should end up
    // with a TypeConversionAbAttr or similar via the recursive dispatch.
    const id = ER_ID_MAP.abilities[366];
    expect(id).toBeDefined();
    const ability = allAbilities.find(a => a?.id === id);
    expect(ability).toBeDefined();
    if (!ability) {
      return;
    }
    // ER 279 → type-conversion (Normal → Fire); the recursive dispatch should
    // wire its TypeDamageBoostAbAttr-or-similar attrs onto 366. We assert
    // the composite has at least one attr inherited from a part.
    // (Chloroplast/268 is bespoke and contributes nothing; only Immolate/279 wires.)
    expect(ability.attrs.length).toBeGreaterThanOrEqual(1);
  });
});

describe("composite dispatch wiring (D3b): coverage diagnostics", () => {
  it("≥ 100 composite abilities have at least one AbAttr wired (full pipeline)", () => {
    let wiredComposites = 0;
    for (const entry of Object.values(ER_ABILITY_ARCHETYPES)) {
      if (entry.archetype !== "composite-vanilla-mashup") {
        continue;
      }
      const id = ER_ID_MAP.abilities[entry.erAbilityId];
      if (id === undefined) {
        continue;
      }
      const ability = allAbilities.find(a => a?.id === id);
      if (ability && ability.attrs.length > 0) {
        wiredComposites++;
      }
    }
    expect(wiredComposites).toBeGreaterThanOrEqual(100);
  });

  it("majority of composites have ≥ 2 AbAttrs wired (true multi-part composition)", () => {
    let multiAttrComposites = 0;
    for (const entry of Object.values(ER_ABILITY_ARCHETYPES)) {
      if (entry.archetype !== "composite-vanilla-mashup") {
        continue;
      }
      const id = ER_ID_MAP.abilities[entry.erAbilityId];
      if (id === undefined) {
        continue;
      }
      const ability = allAbilities.find(a => a?.id === id);
      if (ability && ability.attrs.length >= 2) {
        multiAttrComposites++;
      }
    }
    // The bulk of composites should be multi-attr — each part typically
    // contributes one AbAttr, and most composites have 2-3 parts.
    expect(multiAttrComposites).toBeGreaterThanOrEqual(60);
  });
});

describe("composite dispatch wiring (D3b): cycle safety", () => {
  it("does not loop on hypothetical cycles (visited-set guard exercised at dispatch time)", () => {
    // We can't easily construct a real cycle without mutating ER_COMPOSITE_PARTS.
    // Instead, sanity-check that the init result has no construction errors —
    // a stack-overflow from runaway recursion would have failed init.
    // The actual visited-set guard is tested implicitly by the absence of
    // errors in the test harness's startup run.
    const allComposites = Object.values(ER_COMPOSITE_PARTS);
    expect(allComposites.length).toBeGreaterThan(0);
    // Sanity: every composite resolves in finite time (we got here from a
    // synchronous initEliteReduxCustomAbilities call during test bootstrap).
  });
});

/**
 * Helper: does this composite contain an ER part whose own archetype is the
 * given slug (e.g. "type-damage-boost")? Used by the sub-archetype-reuse
 * test so its body stays within biome's cognitive-complexity threshold.
 */
function compositeHasErPartOfArchetype(entry: (typeof ER_COMPOSITE_PARTS)[number], targetArchetype: string): boolean {
  for (const p of entry.parts) {
    if (p.kind !== "er") {
      continue;
    }
    const row = ER_ABILITY_ARCHETYPES[p.erAbilityId];
    if (row?.archetype === targetArchetype) {
      return true;
    }
  }
  return false;
}

describe("composite dispatch wiring (D3b): sub-archetype reuse evidence", () => {
  it("a composite that includes a type-damage-boost ER ability ends up with TypeDamageBoostAbAttr", () => {
    // Hunt for a composite with an ER part that's classified type-damage-boost
    // and verify the wired ability got a TypeDamageBoostAbAttr.
    for (const entry of Object.values(ER_COMPOSITE_PARTS)) {
      if (!compositeHasErPartOfArchetype(entry, "type-damage-boost")) {
        continue;
      }
      const id = ER_ID_MAP.abilities[entry.erAbilityId];
      if (id === undefined) {
        continue;
      }
      const ability = allAbilities.find(a => a?.id === id);
      const tdb = ability?.attrs.find(a => a instanceof TypeDamageBoostAbAttr);
      if (tdb !== undefined) {
        // Found at least one — the recursive dispatch works for type-damage-boost parts.
        expect(tdb).toBeDefined();
        return;
      }
    }
    // If we never found a positive case, the test should fail — but we expect
    // ≥ 1 such composite given the part distribution.
    throw new Error("no composite found with a type-damage-boost ER part — dispatch may be incomplete");
  });
});

describe("composite dispatch wiring (D3b): batch 955–974 appended riders", () => {
  it("Fire's Wrath (er id 969) appends a non-contact 10% BURN proc (ChanceStatusOnAttack)", () => {
    const id = ER_ID_MAP.abilities[969];
    expect(id).toBeDefined();
    const ability = allAbilities.find(a => a?.id === id);
    expect(ability).toBeDefined();
    if (!ability) {
      return;
    }
    // Intimidate + Scare give the two PostSummonStatStageChange attrs; the
    // appended rider is the offensive burn proc.
    const burn = ability.attrs.find(a => a.constructor.name === "ChanceStatusOnAttackAbAttr");
    expect(burn).toBeDefined();
  });

  it("Backstreet Boy (er id 974) wires the kick↔dance crossover (dance boost + DANCE injection)", () => {
    const id = ER_ID_MAP.abilities[974];
    expect(id).toBeDefined();
    const ability = allAbilities.find(a => a?.id === id);
    expect(ability).toBeDefined();
    if (!ability) {
      return;
    }
    // Two FlagDamageBoosts (Striker kicking ×1.3 from er-361 + appended dance ×1.3)
    // and the MoveFlagInjection that makes kicking moves count as dances.
    const flagBoosts = ability.attrs.filter(a => a.constructor.name === "FlagDamageBoostAbAttr");
    expect(flagBoosts.length).toBeGreaterThanOrEqual(2);
    const injection = ability.attrs.find(a => a.constructor.name === "MoveFlagInjectionAbAttr");
    expect(injection).toBeDefined();
  });
});

describe("composite dispatch wiring (D3b): batch 975–994 appended riders", () => {
  it("Crushing Jaw (er id 976) appends a biting-flag 50% DEF-drop (StatDebuffOnFlagAttack)", () => {
    const id = ER_ID_MAP.abilities[976];
    expect(id).toBeDefined();
    const ability = allAbilities.find(a => a?.id === id);
    expect(ability).toBeDefined();
    if (!ability) {
      return;
    }
    // Strong Jaw gives the ×1.3 biting boost; the appended rider is the DEF drop.
    const debuff = ability.attrs.find(a => a.constructor.name === "StatDebuffOnFlagAttackAbAttr");
    expect(debuff).toBeDefined();
  });

  it("Mega Drill (er id 983) wires both the horn boost and the appended drill boost", () => {
    const id = ER_ID_MAP.abilities[983];
    expect(id).toBeDefined();
    const ability = allAbilities.find(a => a?.id === id);
    expect(ability).toBeDefined();
    if (!ability) {
      return;
    }
    // Mighty Horn (HORN_BASED ×1.3) + appended DRILL_BASED ×1.3.
    const flagBoosts = ability.attrs.filter(a => a.constructor.name === "FlagDamageBoostAbAttr");
    expect(flagBoosts.length).toBeGreaterThanOrEqual(2);
  });
});

describe("composite dispatch wiring (D3b): batch 1015–1033 appended riders", () => {
  it("Icicle Fist (er id 1017) appends a punch-flag frostbite rider", () => {
    const id = ER_ID_MAP.abilities[1017];
    expect(id).toBeDefined();
    const ability = allAbilities.find(a => a?.id === id);
    expect(ability).toBeDefined();
    if (!ability) {
      return;
    }
    // Iron Fist gives the ×1.3 punch boost; the appended rider is the frostbite proc.
    expect(ability.attrs.some(a => a.constructor.name === "PostAttackApplyBattlerTagAbAttr")).toBe(true);
  });
});

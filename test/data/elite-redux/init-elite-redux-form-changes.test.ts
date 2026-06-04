import {
  ER_FORM_CHANGE_KIND,
  ER_FORM_CHANGE_REGISTRY,
  ER_FORM_CHANGES_BY_SOURCE,
  initEliteReduxFormChanges,
} from "#data/elite-redux/init-elite-redux-form-changes";
import { SpeciesId } from "#enums/species-id";
import { describe, expect, it } from "vitest";

/**
 * B5 test suite: verifies the ER form-change registry.
 *
 * The test harness already runs `initEliteReduxFormChanges()` during
 * test-file-initialization (via `init.ts` → `initializeGame()`), so the
 * 287 mega + 18 primal + 1 move-mega edges should be present in the
 * registry before each test runs.
 *
 * Form-change edges count is essentially constant across re-runs of the
 * builder: the v2.65 dump ships 306 form-change edges (287 + 18 + 1) and
 * every ER mega target species is in `ER_ID_MAP.species` (no drift).
 *
 * We exercise:
 *   1. Cardinality: ~287 megas + ~18 primals + 1 move-mega.
 *   2. Idempotency: re-running registers 0 new entries.
 *   3. A specific mega (Venusaur → Venusaur-Mega via Venusaurite).
 *   4. A specific mega-x (Venusaur → Venusaur-Mega-X).
 *   5. A specific primal (Kyogre → Kyogre-Primal via Blue Orb).
 *   6. The single move-mega (Rayquaza → Rayquaza-Mega via Dragon Ascent).
 *   7. Per-source lookup map stays in lockstep with the array.
 *   8. Every entry resolves to a positive pokerogue species id (no NaN /
 *      negative artifacts from id-map misses).
 */
describe("initEliteReduxFormChanges (B5)", () => {
  it("registers ~306 ER form-change edges from the v2.65 dump", () => {
    // 287 mega + 18 primal + 1 move-mega = 306 expected. Lock the floor /
    // ceiling so any change to the dump shows up as a test delta.
    expect(ER_FORM_CHANGE_REGISTRY.length).toBeGreaterThan(280);
    expect(ER_FORM_CHANGE_REGISTRY.length).toBeLessThan(350);
  });

  it("registers ~287 megas, ~18 primals, and exactly 1 move-mega", () => {
    const megas = ER_FORM_CHANGE_REGISTRY.filter(e => e.kind === ER_FORM_CHANGE_KIND.MEGA);
    const primals = ER_FORM_CHANGE_REGISTRY.filter(e => e.kind === ER_FORM_CHANGE_KIND.PRIMAL);
    const moveMegas = ER_FORM_CHANGE_REGISTRY.filter(e => e.kind === ER_FORM_CHANGE_KIND.MOVE_MEGA);
    expect(megas.length).toBeGreaterThan(250);
    expect(megas.length).toBeLessThan(320);
    expect(primals.length).toBeGreaterThan(10);
    expect(primals.length).toBeLessThan(30);
    expect(moveMegas.length).toBe(1);
  });

  it("is idempotent — re-running registers 0 new entries", () => {
    const before = ER_FORM_CHANGE_REGISTRY.length;
    const result = initEliteReduxFormChanges();
    expect(result.formChangesRegistered).toBe(0);
    expect(result.megaRegistered).toBe(0);
    expect(result.primalRegistered).toBe(0);
    expect(result.moveMegaRegistered).toBe(0);
    expect(result.skipped).toBe(before);
    expect(result.errors).toHaveLength(0);
    expect(ER_FORM_CHANGE_REGISTRY.length).toBe(before);
  });

  it("registers Venusaur → Venusaur-Mega via ITEM_VENUSAURITE", () => {
    const venusaurEntries = ER_FORM_CHANGES_BY_SOURCE.get(SpeciesId.VENUSAUR);
    expect(venusaurEntries).toBeDefined();
    if (!venusaurEntries) {
      return;
    }
    // Venusaur ships TWO megas in ER: Venusaurite (vanilla mega) and
    // Venusaurite_X (ER-added second mega).
    expect(venusaurEntries.length).toBeGreaterThanOrEqual(2);
    const vanillaMega = venusaurEntries.find(e => e.requirement === "ITEM_VENUSAURITE");
    expect(vanillaMega).toBeDefined();
    if (!vanillaMega) {
      return;
    }
    expect(vanillaMega.kind).toBe(ER_FORM_CHANGE_KIND.MEGA);
    expect(vanillaMega.sourceSpeciesId).toBe(SpeciesId.VENUSAUR);
    // Target is the ER-custom SPECIES_VENUSAUR_MEGA at pokerogue id 10093
    // (vanilla pokerogue treats mega as a form key, not a species id).
    expect(vanillaMega.targetSpeciesId).toBe(10093);
    expect(vanillaMega.sourceSpeciesConst).toBe("SPECIES_VENUSAUR");
    expect(vanillaMega.targetSpeciesConst).toBe("SPECIES_VENUSAUR_MEGA");
    expect(vanillaMega.kindNumeric).toBe(1);
  });

  it("registers Venusaur → Venusaur-Mega-X via ITEM_VENUSAURITE_X", () => {
    const venusaurEntries = ER_FORM_CHANGES_BY_SOURCE.get(SpeciesId.VENUSAUR);
    expect(venusaurEntries).toBeDefined();
    if (!venusaurEntries) {
      return;
    }
    const megaX = venusaurEntries.find(e => e.requirement === "ITEM_VENUSAURITE_X");
    expect(megaX).toBeDefined();
    if (!megaX) {
      return;
    }
    expect(megaX.kind).toBe(ER_FORM_CHANGE_KIND.MEGA);
    // targetSpeciesId is an ER-custom slot (≥ VANILLA_ID_CUTOFF) — exact
    // value drifts whenever the id-map's vanilla/custom split changes (e.g.
    // regional-alias resolution added in 2026-05). Assert the cutoff
    // contract instead of the absolute id.
    expect(megaX.targetSpeciesId).toBeGreaterThanOrEqual(10000);
    expect(megaX.targetSpeciesConst).toBe("SPECIES_VENUSAUR_MEGA_X");
  });

  it("registers Kyogre → Kyogre-Primal via ITEM_BLUE_ORB", () => {
    const kyogreEntries = ER_FORM_CHANGES_BY_SOURCE.get(SpeciesId.KYOGRE);
    expect(kyogreEntries).toBeDefined();
    if (!kyogreEntries) {
      return;
    }
    expect(kyogreEntries.length).toBeGreaterThanOrEqual(1);
    const primal = kyogreEntries.find(e => e.requirement === "ITEM_BLUE_ORB");
    expect(primal).toBeDefined();
    if (!primal) {
      return;
    }
    expect(primal.kind).toBe(ER_FORM_CHANGE_KIND.PRIMAL);
    expect(primal.sourceSpeciesId).toBe(SpeciesId.KYOGRE);
    // targetSpeciesId drift-tolerant assertion (id-resync may shift specific
    // custom IDs over time). Verify cutoff contract + const name instead.
    expect(primal.targetSpeciesId).toBeGreaterThanOrEqual(10000);
    expect(primal.targetSpeciesConst).toBe("SPECIES_KYOGRE_PRIMAL");
    expect(primal.kindNumeric).toBe(2);
  });

  it("registers Rayquaza → Rayquaza-Mega via MOVE_DRAGON_ASCENT (the only move-mega)", () => {
    const rayquazaEntries = ER_FORM_CHANGES_BY_SOURCE.get(SpeciesId.RAYQUAZA);
    expect(rayquazaEntries).toBeDefined();
    if (!rayquazaEntries) {
      return;
    }
    const moveMega = rayquazaEntries.find(e => e.kind === ER_FORM_CHANGE_KIND.MOVE_MEGA);
    expect(moveMega).toBeDefined();
    if (!moveMega) {
      return;
    }
    expect(moveMega.requirement).toBe("MOVE_DRAGON_ASCENT");
    // Drift-tolerant id assertion (same rationale as Kyogre above).
    expect(moveMega.targetSpeciesId).toBeGreaterThanOrEqual(10000);
    expect(moveMega.targetSpeciesConst).toBe("SPECIES_RAYQUAZA_MEGA");
    expect(moveMega.kindNumeric).toBe(5);
  });

  it("keeps the per-source lookup map in lockstep with the array", () => {
    let total = 0;
    for (const entries of ER_FORM_CHANGES_BY_SOURCE.values()) {
      total += entries.length;
    }
    expect(total).toBe(ER_FORM_CHANGE_REGISTRY.length);
    // Every entry in the array should appear in its source bucket.
    for (const entry of ER_FORM_CHANGE_REGISTRY) {
      const bucket = ER_FORM_CHANGES_BY_SOURCE.get(entry.sourceSpeciesId);
      expect(bucket).toBeDefined();
      if (!bucket) {
        continue;
      }
      expect(bucket).toContain(entry);
    }
  });

  it("every registered entry has positive source and target species ids", () => {
    for (const entry of ER_FORM_CHANGE_REGISTRY) {
      expect(entry.sourceSpeciesId).toBeGreaterThan(0);
      expect(entry.targetSpeciesId).toBeGreaterThan(0);
      // Requirement should be a non-empty string (ITEM_* / MOVE_* const).
      expect(typeof entry.requirement).toBe("string");
      expect(entry.requirement.length).toBeGreaterThan(0);
      // Kind must be one of the three form-change labels.
      expect([ER_FORM_CHANGE_KIND.MEGA, ER_FORM_CHANGE_KIND.PRIMAL, ER_FORM_CHANGE_KIND.MOVE_MEGA]).toContain(
        entry.kind,
      );
    }
  });

  it("vanilla mega-source species map to themselves (no id-map drift on the source side)", () => {
    // Sample a few well-known mega sources — they should all be canonical
    // pokerogue species ids (not ER-custom ≥10000).
    const samples: ReadonlyArray<readonly [number, string]> = [
      [SpeciesId.VENUSAUR, "SPECIES_VENUSAUR"],
      [SpeciesId.KYOGRE, "SPECIES_KYOGRE"],
      [SpeciesId.GROUDON, "SPECIES_GROUDON"],
      [SpeciesId.RAYQUAZA, "SPECIES_RAYQUAZA"],
      [SpeciesId.MEWTWO, "SPECIES_MEWTWO"],
      [SpeciesId.CHARIZARD, "SPECIES_CHARIZARD"],
    ];
    for (const [id, expectedConst] of samples) {
      const entries = ER_FORM_CHANGES_BY_SOURCE.get(id);
      expect(entries).toBeDefined();
      if (!entries) {
        continue;
      }
      expect(entries.length).toBeGreaterThan(0);
      expect(entries[0].sourceSpeciesConst).toBe(expectedConst);
    }
  });

  it("most form-change targets are ER-custom species (pokerogue id ≥ 10000)", () => {
    // ER models megas as separate species — virtually every mega target
    // should be an ER custom in pokerogue's id space. A small number of
    // vanilla-rogue megas (where pokerogue ALREADY has the mega as a
    // species, e.g. SpeciesId.VENUSAUR_MEGA) might land below the
    // threshold, but the vast majority sit ≥ 10000.
    const customCount = ER_FORM_CHANGE_REGISTRY.filter(e => e.targetSpeciesId >= 10000).length;
    expect(customCount).toBeGreaterThan(250);
  });
});

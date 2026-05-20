import { allAbilities } from "#data/data-lists";
import { initEliteReduxCustomAbilities } from "#data/elite-redux/init-elite-redux-custom-abilities";
import { ErAbilityId } from "#enums/er-ability-id";
import { describe, expect, it } from "vitest";

const VANILLA_ID_CUTOFF = 5000;

/**
 * B2 test suite: verifies ER-custom ability registration.
 *
 * The test harness already runs initEliteReduxCustomAbilities() during
 * test-file-initialization (via init.ts → initializeGame()), so the customs
 * are present in allAbilities before each test. We exercise:
 *   1. Idempotency: re-running adds 0 new entries.
 *   2. Custom IDs are all ≥ VANILLA_ID_CUTOFF.
 *   3. A known custom (e.g. SCRAPYARD) is registered with valid construction.
 *   4. ErAbilityId enum cardinality (~735 entries).
 *   5. No construction errors on re-init path.
 */
describe("initEliteReduxCustomAbilities (B2)", () => {
  it("is idempotent — re-running adds 0 customs (all already present)", () => {
    const result = initEliteReduxCustomAbilities();
    expect(result.customsAdded).toBe(0);
    expect(result.customsAlreadyPresent).toBeGreaterThan(700);
  });

  it("ErAbilityId enum has ~735 entries (one per ER-custom ability)", () => {
    const entries = Object.entries(ErAbilityId);
    expect(entries.length).toBeGreaterThan(700);
    expect(entries.length).toBeLessThan(800);
    // Every value should be ≥ VANILLA_ID_CUTOFF.
    for (const [, value] of entries) {
      expect(value).toBeGreaterThanOrEqual(VANILLA_ID_CUTOFF);
    }
  });

  it("all ER-custom abilities are in allAbilities with id ≥ 5000", () => {
    const customsInAllAbilities = allAbilities.filter(a => a.id >= VANILLA_ID_CUTOFF);
    expect(customsInAllAbilities.length).toBeGreaterThan(700);
    expect(customsInAllAbilities.length).toBeLessThan(800);
  });

  it("SCRAPYARD custom is registered with sane construction (id, name, description)", () => {
    // Widen via `as number` — ErAbilityId values (e.g. 5137) are not in the
    // declared AbilityId enum range, so TS would otherwise flag the
    // comparison as having no overlap.
    const scrapyardId = ErAbilityId.SCRAPYARD as number;
    expect(scrapyardId).toBeGreaterThanOrEqual(VANILLA_ID_CUTOFF);
    const scrapyard = allAbilities.find(a => a.id === scrapyardId);
    expect(scrapyard).toBeDefined();
    if (!scrapyard) {
      return;
    }
    expect(scrapyard.id).toBe(scrapyardId);
    // Per-instance override of the `name` getter — should return the verbatim
    // ER draft name, not the i18next missing-key placeholder.
    expect(typeof scrapyard.name).toBe("string");
    expect(scrapyard.name.length).toBeGreaterThan(0);
    expect(scrapyard.name).not.toMatch(/^ability:/);
    expect(typeof scrapyard.description).toBe("string");
    expect(scrapyard.description.length).toBeGreaterThan(0);
    // Phase B doesn't attach AbAttrs — Phase C will.
    expect(scrapyard.attrs).toHaveLength(0);
  });

  it("no construction errors on the test harness's startup run", () => {
    // If initEliteReduxCustomAbilities failed to construct any ability, the
    // re-run would also fail for the same reason. We verify the re-run's
    // errors list is empty (idempotent path; the actual startup error count
    // isn't directly observable from here).
    const result = initEliteReduxCustomAbilities();
    expect(result.errors).toHaveLength(0);
  });
});

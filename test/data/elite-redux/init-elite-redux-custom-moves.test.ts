import { allMoves } from "#data/data-lists";
import { initEliteReduxCustomMoves } from "#data/elite-redux/init-elite-redux-custom-moves";
import { ErMoveId } from "#enums/er-move-id";
import { MoveCategory } from "#enums/move-category";
import { PokemonType } from "#enums/pokemon-type";
import { describe, expect, it } from "vitest";

const VANILLA_ID_CUTOFF = 5000;

/**
 * B2 test suite: verifies ER-custom move registration.
 *
 * The test harness already runs initEliteReduxCustomMoves() during
 * test-file-initialization (via init.ts → initializeGame()), so the customs
 * are present in allMoves before each test. We exercise:
 *   1. Idempotency: re-running adds 0 new entries.
 *   2. Custom IDs are all ≥ VANILLA_ID_CUTOFF.
 *   3. A known custom (e.g. EERIE_FOG) is registered with valid construction.
 *   4. ErMoveId enum cardinality (~187 entries).
 *   5. No construction errors on re-init path.
 */
describe("initEliteReduxCustomMoves (B2)", () => {
  it("is idempotent — re-running adds 0 customs (all already present)", () => {
    const result = initEliteReduxCustomMoves();
    expect(result.customsAdded).toBe(0);
    expect(result.customsAlreadyPresent).toBeGreaterThan(150);
  });

  it("ErMoveId enum has ~187 entries (one per ER-custom move)", () => {
    const entries = Object.entries(ErMoveId);
    expect(entries.length).toBeGreaterThan(150);
    expect(entries.length).toBeLessThan(250);
    // Every value should be ≥ VANILLA_ID_CUTOFF.
    for (const [, value] of entries) {
      expect(value).toBeGreaterThanOrEqual(VANILLA_ID_CUTOFF);
    }
  });

  it("all ER-custom moves are in allMoves with id ≥ 5000", () => {
    const customsInAllMoves = allMoves.filter(m => m.id >= VANILLA_ID_CUTOFF);
    expect(customsInAllMoves.length).toBeGreaterThan(150);
    expect(customsInAllMoves.length).toBeLessThan(250);
  });

  it("EERIE_FOG custom is registered with sane construction (id, name, type, category, pp)", () => {
    // Widen via `as number` — ErMoveId values (e.g. 5109) are not in the
    // declared MoveId enum range, so TS would otherwise flag the comparison
    // as having no overlap.
    const eerieFogId = ErMoveId.EERIE_FOG as number;
    expect(eerieFogId).toBeGreaterThanOrEqual(VANILLA_ID_CUTOFF);
    const eerieFog = allMoves.find(m => m.id === eerieFogId);
    expect(eerieFog).toBeDefined();
    if (!eerieFog) {
      return;
    }
    expect(eerieFog.id).toBe(eerieFogId);
    expect(typeof eerieFog.name).toBe("string");
    expect(eerieFog.name.length).toBeGreaterThan(0);
    expect(eerieFog.name).not.toMatch(/^move:/);
    // Has a valid PokemonType.
    const allTypes = Object.values(PokemonType).filter(v => typeof v === "number");
    expect(allTypes).toContain(eerieFog.type);
    // Has a valid MoveCategory.
    expect([MoveCategory.PHYSICAL, MoveCategory.SPECIAL, MoveCategory.STATUS]).toContain(eerieFog.category);
    // PP coerced to ≥ 1 by the constructor.
    expect(eerieFog.pp).toBeGreaterThan(0);
  });

  it("no construction errors on the test harness's startup run", () => {
    // If initEliteReduxCustomMoves failed to construct any move, the re-run
    // would also fail for the same reason. We verify the re-run's errors
    // list is empty (idempotent path; the actual startup error count isn't
    // directly observable from here).
    const result = initEliteReduxCustomMoves();
    expect(result.errors).toHaveLength(0);
  });
});

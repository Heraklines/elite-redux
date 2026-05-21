import { allMoves } from "#data/data-lists";
import { initEliteReduxCustomMoves } from "#data/elite-redux/init-elite-redux-custom-moves";
import {
  HitHealAttr,
  MovePowerMultiplierAttr,
  RecoilAttr,
  StatusEffectAttr,
  VariableMoveTypeAttr,
} from "#data/moves/move";
import { ErMoveId } from "#enums/er-move-id";
import { MoveCategory } from "#enums/move-category";
import { MoveFlags } from "#enums/move-flags";
import { PokemonType } from "#enums/pokemon-type";
import { describe, expect, it } from "vitest";

const VANILLA_ID_CUTOFF = 5000;

/**
 * B2/D4 test suite: verifies ER-custom move registration AND
 * archetype-classified wire-up.
 *
 * The test harness already runs initEliteReduxCustomMoves() during
 * test-file-initialization (via init.ts → initializeGame()), so the customs
 * are present in allMoves before each test. We exercise:
 *
 * B2 coverage:
 *   1. Idempotency: re-running adds 0 new entries.
 *   2. Custom IDs are all ≥ VANILLA_ID_CUTOFF.
 *   3. A known custom (e.g. EERIE_FOG) is registered with valid construction.
 *   4. ErMoveId enum cardinality (~187 entries).
 *   5. No construction errors on re-init path.
 *
 * D4 coverage:
 *   6. flag-tagged-move: AQUA_FANG (Strong Jaw boost → BITING_MOVE flag)
 *      and SQUEAKY_HAMMER (HAMMER_BASED flag).
 *   7. chance-status-on-hit: SMITE has StatusEffectAttr attached.
 *   8. recoil-or-drain (recoil): STAR_CRASH has RecoilAttr + RECKLESS_MOVE flag.
 *   9. recoil-or-drain (drain): SOIL_DRAIN has HitHealAttr + TRIAGE_MOVE flag.
 *  10. conditional-damage: BRAVADO has a MovePowerMultiplierAttr.
 *  11. type-conversion: SABER_SLASHES has a VariableMoveTypeAttr subclass.
 */
describe("initEliteReduxCustomMoves (B2 + D4)", () => {
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

  // -------------------------------------------------------------------------
  // D4 — archetype wire-up assertions
  // -------------------------------------------------------------------------

  it("flag-tagged-move: AQUA_FANG (Strong Jaw boost) has the BITING_MOVE flag set", () => {
    const id = ErMoveId.AQUA_FANG as number;
    const move = allMoves.find(m => m.id === id);
    expect(move, `AQUA_FANG (id ${id}) should be in allMoves`).toBeDefined();
    if (!move) {
      return;
    }
    // BITING_MOVE flag should be set (STRONG_JAW → BITING_MOVE in C4 mapping).
    expect(move.hasFlag(MoveFlags.BITING_MOVE)).toBe(true);
  });

  it("flag-tagged-move: SQUEAKY_HAMMER has the HAMMER_BASED flag set", () => {
    const id = ErMoveId.SQUEAKY_HAMMER as number;
    const move = allMoves.find(m => m.id === id);
    expect(move, `SQUEAKY_HAMMER (id ${id}) should be in allMoves`).toBeDefined();
    if (!move) {
      return;
    }
    expect(move.hasFlag(MoveFlags.HAMMER_BASED)).toBe(true);
  });

  it("chance-status-on-hit: SMITE has a StatusEffectAttr (paralysis)", () => {
    const id = ErMoveId.SMITE as number;
    const move = allMoves.find(m => m.id === id);
    expect(move, `SMITE (id ${id}) should be in allMoves`).toBeDefined();
    if (!move) {
      return;
    }
    const statusAttrs = move.attrs.filter(a => a instanceof StatusEffectAttr);
    expect(statusAttrs.length).toBeGreaterThanOrEqual(1);
  });

  it("recoil-or-drain (recoil): STAR_CRASH has RecoilAttr + RECKLESS_MOVE flag", () => {
    const id = ErMoveId.STAR_CRASH as number;
    const move = allMoves.find(m => m.id === id);
    expect(move, `STAR_CRASH (id ${id}) should be in allMoves`).toBeDefined();
    if (!move) {
      return;
    }
    expect(move.attrs.some(a => a instanceof RecoilAttr)).toBe(true);
    expect(move.hasFlag(MoveFlags.RECKLESS_MOVE)).toBe(true);
  });

  it("recoil-or-drain (drain): SOIL_DRAIN has HitHealAttr + TRIAGE_MOVE flag", () => {
    const id = ErMoveId.SOIL_DRAIN as number;
    const move = allMoves.find(m => m.id === id);
    expect(move, `SOIL_DRAIN (id ${id}) should be in allMoves`).toBeDefined();
    if (!move) {
      return;
    }
    expect(move.attrs.some(a => a instanceof HitHealAttr)).toBe(true);
    expect(move.hasFlag(MoveFlags.TRIAGE_MOVE)).toBe(true);
  });

  it("conditional-damage: BRAVADO has a MovePowerMultiplierAttr", () => {
    const id = ErMoveId.BRAVADO as number;
    const move = allMoves.find(m => m.id === id);
    expect(move, `BRAVADO (id ${id}) should be in allMoves`).toBeDefined();
    if (!move) {
      return;
    }
    expect(move.attrs.some(a => a instanceof MovePowerMultiplierAttr)).toBe(true);
  });

  it("type-conversion: SABER_SLASHES has a VariableMoveTypeAttr", () => {
    const id = ErMoveId.SABER_SLASHES as number;
    const move = allMoves.find(m => m.id === id);
    expect(move, `SABER_SLASHES (id ${id}) should be in allMoves`).toBeDefined();
    if (!move) {
      return;
    }
    expect(move.attrs.some(a => a instanceof VariableMoveTypeAttr)).toBe(true);
  });

  it("D4 wire-up rollup: a fresh init pass reports per-archetype counts via the rerun path", () => {
    // Re-running init returns customsAdded=0 (idempotent), so we can't inspect
    // the rollup directly from a rerun — but the idempotency assertion above
    // covers no-error reruns. Here we sanity-check that the most-populated
    // archetypes have wired several moves by spot-checking a handful.
    // Specifically, verify that at least ~80 ER-custom AttackMoves have at
    // least one of the ER-specific flag bits set — confirms the
    // flag-tagged-move wiring ran across the customs population.
    const ER_MOVE_FLAG_MASK =
      MoveFlags.BITING_MOVE
      | MoveFlags.SLICING_MOVE
      | MoveFlags.PULSE_MOVE
      | MoveFlags.PUNCHING_MOVE
      | MoveFlags.HAMMER_BASED
      | MoveFlags.HORN_BASED
      | MoveFlags.ARROW_BASED
      | MoveFlags.BONE_BASED
      | MoveFlags.AIR_BASED
      | MoveFlags.KICKING_MOVE
      | MoveFlags.SOUND_BASED
      | MoveFlags.DANCE_MOVE;
    const tagged = allMoves.filter(
      m => m.id >= VANILLA_ID_CUTOFF && ((m as unknown as { flags: number }).flags & ER_MOVE_FLAG_MASK) !== 0,
    );
    // 100 flag-tagged-move entries, minus any whose CAPS flag name didn't
    // resolve. Conservative lower bound of 80 leaves room for unresolved
    // niche flags without making the test brittle.
    expect(tagged.length).toBeGreaterThan(80);
  });
});

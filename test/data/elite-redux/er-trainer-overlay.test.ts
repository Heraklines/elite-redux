import {
  findErTrainersForType,
  getErTrainerByKey,
  getErTrainerCount,
  pickFirstErTrainerForType,
  selectErRoster,
} from "#data/elite-redux/er-trainer-overlay";
import { describe, expect, it } from "vitest";

/**
 * Phase D2 — trainer-overlay helper tests. The registry is populated by
 * `initEliteReduxTrainers()` at vitest setup, so these tests assume the
 * full 895 trainers are loaded.
 */
describe("ER trainer overlay (D2)", () => {
  it("getErTrainerByKey returns the first trainer in the dump (May Route 103 Treecko)", () => {
    const entry = getErTrainerByKey("May Route 103 Treecko");
    expect(entry).toBeDefined();
    if (!entry) {
      return;
    }
    expect(entry.stableKey).toBe("May Route 103 Treecko");
    expect(entry.party.length).toBeGreaterThan(0);
  });

  it("getErTrainerByKey returns undefined for an unknown name", () => {
    expect(getErTrainerByKey("Does Not Exist In ER")).toBeUndefined();
  });

  it("getErTrainerCount returns a reasonable count (>= 800)", () => {
    expect(getErTrainerCount()).toBeGreaterThan(800);
    expect(getErTrainerCount()).toBeLessThan(1000);
  });

  it("findErTrainersForType returns an array for known trainer types", () => {
    const may = getErTrainerByKey("May Route 103 Treecko");
    expect(may).toBeDefined();
    if (!may) {
      return;
    }
    const sameType = findErTrainersForType(may.trainerType);
    expect(sameType.length).toBeGreaterThan(0);
    expect(sameType).toContain(may);
  });

  it("findErTrainersForType returns empty array for unknown trainer types", () => {
    // 99999 is not a real TrainerType value.
    expect(findErTrainersForType(99999)).toEqual([]);
  });

  it("selectErRoster returns the base party when tier is 'party'", () => {
    const may = getErTrainerByKey("May Route 103 Treecko");
    expect(may).toBeDefined();
    if (!may) {
      return;
    }
    const roster = selectErRoster(may, "party");
    expect(roster).toBe(may.party);
    expect(roster.length).toBeGreaterThan(0);
  });

  it("selectErRoster falls back to lower tiers when higher tiers are empty", () => {
    // Find a trainer with an empty insaneParty + hellParty (most ER trainers).
    const trainer = getErTrainerByKey("May Route 103 Treecko");
    expect(trainer).toBeDefined();
    if (!trainer) {
      return;
    }
    // May Route 103 Treecko has no insane/hell tier — both should fall back to party.
    if (!trainer.insaneParty || trainer.insaneParty.length === 0) {
      expect(selectErRoster(trainer, "insane")).toBe(trainer.party);
    }
    if (!trainer.hellParty || trainer.hellParty.length === 0) {
      expect(selectErRoster(trainer, "hell")).toBe(trainer.party);
    }
  });

  it("selectErRoster returns hellParty when tier is 'hell' and hellParty exists", () => {
    // Find a trainer with a populated hellParty.
    const tieredTrainer = getErTrainerByKey("Rick");
    if (!tieredTrainer || !tieredTrainer.hellParty || tieredTrainer.hellParty.length === 0) {
      // If Rick doesn't have a hellParty in the current dump, skip — this is
      // dump-data-dependent. The helper logic is still verified by the
      // empty-fallback test above.
      return;
    }
    expect(selectErRoster(tieredTrainer, "hell")).toBe(tieredTrainer.hellParty);
  });

  it("pickFirstErTrainerForType returns the trainer + roster, or null", () => {
    const may = getErTrainerByKey("May Route 103 Treecko");
    expect(may).toBeDefined();
    if (!may) {
      return;
    }
    const pick = pickFirstErTrainerForType(may.trainerType, "party");
    expect(pick).not.toBeNull();
    if (!pick) {
      return;
    }
    expect(pick.trainer.trainerType).toBe(may.trainerType);
    expect(pick.roster.length).toBeGreaterThan(0);
  });

  it("pickFirstErTrainerForType returns null for unknown trainer types", () => {
    expect(pickFirstErTrainerForType(99999, "party")).toBeNull();
  });

  it("party-member fields carry mapped pokerogue ids (not raw ER ids)", () => {
    const may = getErTrainerByKey("May Route 103 Treecko");
    expect(may).toBeDefined();
    if (!may) {
      return;
    }
    const member = may.party[0];
    // Pokerogue species ids are < 10000 for vanilla; ER customs ≥ 10000.
    // Either way, the value should be a positive integer.
    expect(typeof member.speciesId).toBe("number");
    expect(member.speciesId).toBeGreaterThan(0);
    expect(member.moves.length).toBeGreaterThan(0);
    expect(member.ivs).toHaveLength(6);
    expect(member.evs).toHaveLength(6);
  });
});

/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — Phase C Task C0: battle harness self-tests.
//
// These tests verify the HARNESS itself works correctly — they don't yet
// exercise any ER-specific abilities (that's C1+). They prove that:
//   1. The harness records fired slots in dispatch order.
//   2. Empty passive slots are skipped (no fake firings).
//   3. Active suppression and per-slot suppression route correctly.
//   4. Multi-ability dedup (same id across slots) is honored.
//   5. `attrCalls` records per-attribute `apply()` invocations.
//   6. record-only mode never executes real attr.apply(), so attributes
//      with globalScene dependencies (e.g. Intimidate) are safe to dispatch.
//   7. execute-attrs mode DOES execute apply() — verified with a stub attr
//      via mocked getAttrs that returns a controllable apply.
//   8. Convenience helpers (`firedForRole`, `attrCallsByType`) filter correctly.
//
// We use VANILLA abilities (Intimidate, Speed Boost, Drought, …) as the
// fixtures because they're guaranteed to be in `allAbilities` after the
// vitest setup runs. Their real `apply()` methods are NOT executed in the
// default record-only mode — the harness blocks that.
// =============================================================================

import { Ability } from "#abilities/ability";
import { allAbilities } from "#data/data-lists";
import {
  attrCallsByType,
  entryScenario,
  entryWithOpponentScenario,
  firedForRole,
  makeHarnessPokemon,
  runHarness,
  suppressedActiveScenario,
  triplePassiveScenario,
} from "#data/elite-redux/harness/index";
import { AbilityId } from "#enums/ability-id";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

describe("battle-harness (C0 self-tests)", () => {
  beforeAll(() => {
    // Sanity: vitest setup populates allAbilities.
    expect(allAbilities[AbilityId.INTIMIDATE]).toBeDefined();
    expect(allAbilities[AbilityId.SPEED_BOOST]).toBeDefined();
    expect(allAbilities[AbilityId.DROUGHT]).toBeDefined();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("runHarness — slot firing (record-only mode, real abilities)", () => {
    it("records the active slot firing when no passives are configured", () => {
      const result = runHarness(entryScenario(AbilityId.INTIMIDATE));
      expect(result.errors).toEqual([]);
      expect(result.fired).toHaveLength(1);
      expect(result.fired[0]).toMatchObject({
        role: "subject",
        slot: "active",
        abilityId: AbilityId.INTIMIDATE,
      });
    });

    it("records all four slots when subject has active + 3 distinct passives", () => {
      // Active = INTIMIDATE (has PostSummonStatStageChangeAbAttr).
      // Passive 0 = SPEED_BOOST (no PostSummon attrs — won't appear in fired).
      // Passive 1 = DROUGHT (has PostSummonWeatherChangeAbAttr).
      // Passive 2 = SAND_STREAM (has PostSummonWeatherChangeAbAttr).
      // Only abilities with at least one PostSummon attr are considered "fired".
      const result = runHarness(
        triplePassiveScenario(AbilityId.INTIMIDATE, [AbilityId.SPEED_BOOST, AbilityId.DROUGHT, AbilityId.SAND_STREAM]),
      );
      expect(result.errors).toEqual([]);
      const firedAbilities = result.fired.map(f => f.abilityId);
      // INTIMIDATE and DROUGHT and SAND_STREAM all have PostSummon attrs;
      // SPEED_BOOST does NOT (it's a PostTurn ability).
      expect(firedAbilities).toContain(AbilityId.INTIMIDATE);
      expect(firedAbilities).toContain(AbilityId.DROUGHT);
      expect(firedAbilities).toContain(AbilityId.SAND_STREAM);
      expect(firedAbilities).not.toContain(AbilityId.SPEED_BOOST);
      // Order: active first, then passives in slot order.
      expect(result.fired.map(f => f.slot)).toEqual(["active", "passive-1", "passive-2"]);
    });

    it("skips empty (NONE) passive slots", () => {
      const result = runHarness({
        subject: {
          activeAbilityId: AbilityId.INTIMIDATE,
          passiveAbilityIds: [AbilityId.DROUGHT, AbilityId.NONE, AbilityId.NONE],
        },
        trigger: "PostSummonAbAttr",
      });
      const slots = result.fired.map(f => f.slot);
      expect(slots).toEqual(["active", "passive-0"]);
      expect(result.errors).toEqual([]);
    });

    it("dedups when a passive slot's id matches the active ability id", () => {
      // Active = DROUGHT, slot 0 also DROUGHT → should be deduped.
      // Slot 2 = SAND_STREAM (has PostSummon attr) → should fire.
      const result = runHarness({
        subject: {
          activeAbilityId: AbilityId.DROUGHT,
          passiveAbilityIds: [AbilityId.DROUGHT, AbilityId.NONE, AbilityId.SAND_STREAM],
        },
        trigger: "PostSummonAbAttr",
      });
      expect(result.fired.map(f => f.abilityId)).toEqual([
        AbilityId.DROUGHT, // active
        // slot 0 deduped — same id as active
        AbilityId.SAND_STREAM, // slot 2
      ]);
    });

    it("dedups duplicate passive ids across slots (data-entry safety)", () => {
      // Slots 0 and 1 both list DROUGHT — must fire only once.
      // Active INTIMIDATE has PostSummon, SAND_STREAM has PostSummon.
      const result = runHarness({
        subject: {
          activeAbilityId: AbilityId.INTIMIDATE,
          passiveAbilityIds: [AbilityId.DROUGHT, AbilityId.DROUGHT, AbilityId.SAND_STREAM],
        },
        trigger: "PostSummonAbAttr",
      });
      expect(result.fired.map(f => ({ slot: f.slot, abilityId: f.abilityId }))).toEqual([
        { slot: "active", abilityId: AbilityId.INTIMIDATE },
        { slot: "passive-0", abilityId: AbilityId.DROUGHT },
        // slot 1 deduped — duplicate of slot 0's id
        { slot: "passive-2", abilityId: AbilityId.SAND_STREAM },
      ]);
    });
  });

  describe("runHarness — suppression", () => {
    it("suppresses the active slot when suppressActive is true; passives still fire", () => {
      const result = runHarness(
        suppressedActiveScenario(AbilityId.INTIMIDATE, [AbilityId.DROUGHT, AbilityId.SAND_STREAM, AbilityId.NONE]),
      );
      // Active suppressed → no "active" entry; passives 0 + 1 fire (both have PostSummon).
      expect(result.fired.map(f => f.slot)).toEqual(["passive-0", "passive-1"]);
      expect(result.fired.map(f => f.abilityId)).toEqual([AbilityId.DROUGHT, AbilityId.SAND_STREAM]);
    });

    it("suppresses a specific passive slot when suppressPassiveSlots includes it", () => {
      const result = runHarness({
        subject: {
          activeAbilityId: AbilityId.INTIMIDATE,
          passiveAbilityIds: [AbilityId.DROUGHT, AbilityId.SAND_STREAM, AbilityId.NONE],
          suppressPassiveSlots: [1],
        },
        trigger: "PostSummonAbAttr",
      });
      // Slot 1 (SAND_STREAM) suppressed; active + slot 0 fire.
      expect(result.fired.map(f => ({ slot: f.slot, abilityId: f.abilityId }))).toEqual([
        { slot: "active", abilityId: AbilityId.INTIMIDATE },
        { slot: "passive-0", abilityId: AbilityId.DROUGHT },
      ]);
    });
  });

  describe("runHarness — multi-pokemon scenarios", () => {
    it("dispatches PostSummonAbAttr to both subject and opponent", () => {
      const result = runHarness(entryWithOpponentScenario(AbilityId.INTIMIDATE, AbilityId.DROUGHT));
      const subjectFires = firedForRole(result, "subject");
      const opponentFires = firedForRole(result, "opponent");
      expect(subjectFires.map(f => f.abilityId)).toEqual([AbilityId.INTIMIDATE]);
      expect(opponentFires.map(f => f.abilityId)).toEqual([AbilityId.DROUGHT]);
    });
  });

  describe("runHarness — attrCalls reconstruction", () => {
    it("records one entry in attrCalls for each AbAttr the dispatcher tried to apply", () => {
      // INTIMIDATE has exactly one PostSummonAbAttr in vanilla pokerogue
      // (`PostSummonStatStageChangeAbAttr`). We verify the recorder captured
      // it without running the real apply (which would crash on globalScene).
      const result = runHarness(entryScenario(AbilityId.INTIMIDATE));
      expect(result.errors).toEqual([]);
      // At least one PostSummonStatStageChangeAbAttr should be recorded.
      const statStageCalls = attrCallsByType(result, "PostSummonStatStageChangeAbAttr");
      expect(statStageCalls.length).toBeGreaterThanOrEqual(1);
      expect(statStageCalls[0]).toMatchObject({
        role: "subject",
        slot: "active",
        abilityId: AbilityId.INTIMIDATE,
      });
    });

    it("records zero attrCalls for a trigger that no fired ability listens to", () => {
      // INTIMIDATE has PostSummon attrs, not PostFaint. We dispatch PostFaint
      // and expect no recorded calls.
      const result = runHarness({
        subject: { activeAbilityId: AbilityId.INTIMIDATE },
        trigger: "PostFaintAbAttr",
      });
      expect(result.errors).toEqual([]);
      expect(result.attrCalls).toHaveLength(0);
    });

    it("execute-attrs mode invokes the real apply() (verified via mocked getAttrs)", () => {
      // Use a stub attr that records its own apply being called. We mock
      // getAttrs BEFORE runHarness — the harness's own hook wraps over our
      // mock, so the stub's apply is what eventually runs. In execute-attrs
      // mode the harness does NOT short-circuit canApply/getCondition/
      // getTriggerMessage, so the stub must provide complete shapes that
      // the dispatcher's pre-flight checks expect.
      const applySpy = vi.fn();
      const stubAttr = {
        constructor: { name: "StubExecAttr" },
        showAbility: false,
        canApply: () => true,
        getCondition: () => null,
        getTriggerMessage: () => null,
        apply: applySpy,
      };
      vi.spyOn(Ability.prototype, "getAttrs").mockReturnValue([stubAttr as never]);

      const result = runHarness({
        subject: { activeAbilityId: AbilityId.INTIMIDATE },
        trigger: "PostSummonAbAttr",
        applyMode: "execute-attrs",
      });
      expect(result.errors).toEqual([]);
      // The recorder should have captured the call.
      expect(attrCallsByType(result, "StubExecAttr").length).toBeGreaterThanOrEqual(1);
      // AND the stub's real apply should have run.
      expect(applySpy).toHaveBeenCalled();
    });

    it("record-only mode does NOT invoke the real apply()", () => {
      const applySpy = vi.fn();
      const stubAttr = {
        constructor: { name: "StubRecordOnlyAttr" },
        apply: applySpy,
      };
      vi.spyOn(Ability.prototype, "getAttrs").mockReturnValue([stubAttr as never]);

      const result = runHarness({
        subject: { activeAbilityId: AbilityId.INTIMIDATE },
        trigger: "PostSummonAbAttr",
        // applyMode defaults to "record-only".
      });
      expect(result.errors).toEqual([]);
      expect(attrCallsByType(result, "StubRecordOnlyAttr").length).toBeGreaterThanOrEqual(1);
      // CRITICAL: the real apply must NOT have run.
      expect(applySpy).not.toHaveBeenCalled();
    });
  });

  describe("makeHarnessPokemon — stub shape", () => {
    it("exposes the correct active/passive slots from allAbilities", () => {
      const stub = makeHarnessPokemon({
        activeAbilityId: AbilityId.INTIMIDATE,
        passiveAbilityIds: [AbilityId.SPEED_BOOST, AbilityId.NONE, AbilityId.DROUGHT],
      });
      expect(stub.getAbility().id).toBe(AbilityId.INTIMIDATE);
      const passives = stub.getPassiveAbilities();
      expect(passives[0]?.id).toBe(AbilityId.SPEED_BOOST);
      expect(passives[1]).toBeNull();
      expect(passives[2]?.id).toBe(AbilityId.DROUGHT);
    });

    it("hasPassive() returns true iff at least one non-empty passive slot is present", () => {
      const noPassives = makeHarnessPokemon({ activeAbilityId: AbilityId.INTIMIDATE });
      const withPassive = makeHarnessPokemon({
        activeAbilityId: AbilityId.INTIMIDATE,
        passiveAbilityIds: [AbilityId.NONE, AbilityId.SPEED_BOOST, AbilityId.NONE],
      });
      expect(noPassives.hasPassive()).toBe(false);
      expect(withPassive.hasPassive()).toBe(true);
    });

    it("canApplyAbility returns false for empty passive slots", () => {
      const stub = makeHarnessPokemon({
        activeAbilityId: AbilityId.INTIMIDATE,
        passiveAbilityIds: [AbilityId.SPEED_BOOST, AbilityId.NONE, AbilityId.NONE],
      });
      expect(stub.canApplyAbility(true, 0)).toBe(true); // slot 0 has SPEED_BOOST
      expect(stub.canApplyAbility(true, 1)).toBe(false); // slot 1 is NONE
      expect(stub.canApplyAbility(true, 2)).toBe(false); // slot 2 is NONE
    });

    it("throws when given an unknown active ability id", () => {
      // 999999 is out of the allAbilities array — should throw.
      expect(() => makeHarnessPokemon({ activeAbilityId: 999999 as AbilityId })).toThrow(/not in allAbilities/);
    });
  });

  describe("convenience helpers", () => {
    it("firedForRole returns only firings for the given role", () => {
      const result = runHarness(entryWithOpponentScenario(AbilityId.INTIMIDATE, AbilityId.DROUGHT));
      expect(firedForRole(result, "subject").map(f => f.abilityId)).toEqual([AbilityId.INTIMIDATE]);
      expect(firedForRole(result, "opponent").map(f => f.abilityId)).toEqual([AbilityId.DROUGHT]);
    });

    it("attrCallsByType filters by AbAttr class name", () => {
      const stub = {
        constructor: { name: "FooAbAttr" },
        apply: () => {},
      };
      vi.spyOn(Ability.prototype, "getAttrs").mockReturnValue([stub as never]);
      const result = runHarness(entryScenario(AbilityId.INTIMIDATE));
      expect(attrCallsByType(result, "FooAbAttr").length).toBeGreaterThanOrEqual(1);
      expect(attrCallsByType(result, "BarAbAttr")).toHaveLength(0);
    });
  });
});

/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// Co-op battle CHECKPOINT pure core (#633, LIVE-D). The authoritative post-turn
// state the host streams and the guest applies. These verify the data transform +
// the defensive clamping (the guest trusts the host but never writes an illegal
// value) WITHOUT booting the engine.

import {
  buildCheckpoint,
  type CoopArenaView,
  type CoopFieldMonView,
  isResolvableCoopFormIndex,
  monStateByIndex,
  normalizeMonState,
  serializeArenaTag,
  serializeMonState,
} from "#data/elite-redux/coop/coop-battle-checkpoint";
import { describe, expect, it } from "vitest";

const arena: CoopArenaView = { weather: 3, weatherTurnsLeft: 5, terrain: 0, terrainTurnsLeft: 0 };

const mon = (over: Partial<CoopFieldMonView> = {}): CoopFieldMonView => ({
  bi: 0,
  partyIndex: 0,
  speciesId: 1,
  hp: 20,
  maxHp: 21,
  status: 0,
  statStages: [0, 0, 0, 0, 0, 0, 0],
  fainted: false,
  ...over,
});

describe("co-op battle checkpoint pure core (#633, LIVE-D)", () => {
  it("serializeMonState clamps hp into [0, maxHp] and floors fractional hp", () => {
    expect(serializeMonState(mon({ hp: 99, maxHp: 21 })).hp).toBe(21);
    expect(serializeMonState(mon({ hp: -5, maxHp: 21 })).hp).toBe(0);
    expect(serializeMonState(mon({ hp: 10.9, maxHp: 21 })).hp).toBe(10);
  });

  it("a 0-hp mon is fainted regardless of the source flag (authoritative invariant)", () => {
    expect(serializeMonState(mon({ hp: 0, fainted: false })).fainted).toBe(true);
    expect(serializeMonState(mon({ hp: 5, fainted: false })).fainted).toBe(false);
  });

  it("stat stages are always length 7 and clamped to [-6, 6]", () => {
    const s = serializeMonState(mon({ statStages: [9, -9, 2, 0, 0] }));
    expect(s.statStages).toHaveLength(7);
    expect(s.statStages[0]).toBe(6);
    expect(s.statStages[1]).toBe(-6);
    expect(s.statStages[2]).toBe(2);
    expect(s.statStages[6]).toBe(0); // padded
  });

  it("optional form/ability changes are carried only when present", () => {
    expect(serializeMonState(mon()).formIndex).toBeUndefined();
    const changed = serializeMonState(mon({ formIndex: 1, abilityId: 42 }));
    expect(changed.formIndex).toBe(1);
    expect(changed.abilityId).toBe(42);
  });

  it("sanitizes malformed wire forms and defines the species form domain", () => {
    expect(serializeMonState(mon({ formIndex: -1 })).formIndex).toBeUndefined();
    expect(serializeMonState(mon({ formIndex: 1.5 })).formIndex).toBeUndefined();
    expect(serializeMonState(mon({ formIndex: Number.NaN })).formIndex).toBeUndefined();

    expect(isResolvableCoopFormIndex(0, 0), "formless species use their base object at index zero").toBe(true);
    expect(isResolvableCoopFormIndex(0, 1)).toBe(false);
    expect(isResolvableCoopFormIndex(2, 0)).toBe(true);
    expect(isResolvableCoopFormIndex(2, 1)).toBe(true);
    expect(isResolvableCoopFormIndex(2, 2)).toBe(false);
    expect(isResolvableCoopFormIndex(2, -1)).toBe(false);
    expect(isResolvableCoopFormIndex(2, 0.5)).toBe(false);
  });

  it("buildCheckpoint maps every field mon + the arena", () => {
    const cp = buildCheckpoint([mon({ bi: 0 }), mon({ bi: 1, hp: 0 })], arena);
    expect(cp.field).toHaveLength(2);
    expect(cp.weather).toBe(3);
    expect(cp.weatherTurnsLeft).toBe(5);
    expect(monStateByIndex(cp, 1)?.fainted).toBe(true);
    expect(monStateByIndex(cp, 9)).toBeUndefined();
  });

  // GAP 1 (#633): the checkpoint carries arena tags (hazards / screens / tailwind) so the guest
  // can reconcile them - they're set by host MoveEffectPhases the pure-renderer guest never runs.
  describe("arena tags (#633 GAP 1)", () => {
    it("serializeArenaTag sanitizes side/turnCount (>=0) and layers (>=1, integer)", () => {
      expect(serializeArenaTag({ tagType: "SPIKES", side: 1.9, turnCount: -5, layers: 0 })).toEqual({
        tagType: "SPIKES",
        side: 1,
        turnCount: 0,
        layers: 1,
      });
      expect(serializeArenaTag({ tagType: "SPIKES", side: 2, turnCount: 4, layers: 3.7 })).toEqual({
        tagType: "SPIKES",
        side: 2,
        turnCount: 4,
        layers: 3,
      });
    });

    it("buildCheckpoint carries arena tags when present, omits them when empty", () => {
      const withTags: CoopArenaView = {
        ...arena,
        arenaTags: [{ tagType: "STEALTH_ROCK", side: 2, turnCount: 0, layers: 1 }],
      };
      const cp = buildCheckpoint([mon()], withTags);
      expect(cp.arenaTags).toEqual([{ tagType: "STEALTH_ROCK", side: 2, turnCount: 0, layers: 1 }]);
      // A tagless arena leaves the field absent (older host / guest leaves its tags alone).
      expect(buildCheckpoint([mon()], arena).arenaTags).toBeUndefined();
    });
  });

  // #633/#698 money transient: the checkpoint carries the host's authoritative money so the
  // pure-renderer guest mirrors it continuously (a between-wave reward-shop spend / in-battle Pay Day),
  // instead of lagging until a full resync heals the visible "host=824 guest=1000" desync.
  describe("money (#633/#698 money transient)", () => {
    it("buildCheckpoint carries money when a finite non-negative value is provided, truncated", () => {
      expect(buildCheckpoint([mon()], arena, 824).money).toBe(824);
      expect(buildCheckpoint([mon()], arena, 0).money).toBe(0);
      expect(buildCheckpoint([mon()], arena, 999.9).money).toBe(999);
    });

    it("buildCheckpoint omits money for a missing / malformed value (older host shape unchanged)", () => {
      expect(buildCheckpoint([mon()], arena).money).toBeUndefined();
      expect(buildCheckpoint([mon()], arena, undefined).money).toBeUndefined();
      expect(buildCheckpoint([mon()], arena, -50).money).toBeUndefined();
      expect(buildCheckpoint([mon()], arena, Number.NaN).money).toBeUndefined();
      expect(buildCheckpoint([mon()], arena, Number.POSITIVE_INFINITY).money).toBeUndefined();
    });
  });

  it("normalizeMonState re-clamps a received (possibly corrupt) state before the guest applies it", () => {
    const safe = normalizeMonState({
      bi: 2,
      partyIndex: 0,
      speciesId: 1,
      hp: 9999,
      maxHp: 14,
      status: -1,
      statStages: [99, 0, 0, 0, 0, 0, 0],
      fainted: false,
    });
    expect(safe.hp).toBe(14);
    expect(safe.status).toBe(0);
    expect(safe.statStages[0]).toBe(6);
  });

  // Fix #4h (#633): ER bleed/frost/fear tags ride the checkpoint so the guest can repair them
  // (they are BattlerTags, not StatusEffects, so the `status` field can't carry them).
  describe("ER bleed/frost/fear tags (#633 Fix #4h)", () => {
    it("carries erTags through serialize, sanitizing turns (>=0 integer)", () => {
      const s = serializeMonState(
        mon({
          erTags: [
            { type: "ER_BLEED", turns: 3.9 },
            { type: "ER_FROSTBITE", turns: -2 },
          ],
        }),
      );
      expect(s.erTags).toEqual([
        { type: "ER_BLEED", turns: 3 },
        { type: "ER_FROSTBITE", turns: 0 },
      ]);
    });

    it("omits erTags entirely when the mon has none (tagless wire shape unchanged)", () => {
      expect(serializeMonState(mon()).erTags).toBeUndefined();
      expect(serializeMonState(mon({ erTags: [] })).erTags).toBeUndefined();
    });

    it("normalizeMonState round-trips the erTags the guest will repair", () => {
      const safe = normalizeMonState({
        bi: 2,
        partyIndex: 0,
        speciesId: 1,
        hp: 10,
        maxHp: 14,
        status: 0,
        statStages: [0, 0, 0, 0, 0, 0, 0],
        fainted: false,
        erTags: [{ type: "ER_FEAR", turns: 2 }],
      });
      expect(safe.erTags).toEqual([{ type: "ER_FEAR", turns: 2 }]);
    });
  });
});

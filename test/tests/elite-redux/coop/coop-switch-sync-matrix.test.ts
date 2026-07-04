/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// SWITCH SYNC MATRIX regression tests (#838). Engine-free coverage of the WIRE that
// carries every switch pathway's post-switch state from the host to the guest.
//
// The co-op netcode is host-authoritative: the guest is a pure renderer that draws NO
// RNG and resolves nothing. EVERY switch pathway (voluntary pre-turn, faint replacement,
// mid-turn pivot, Baton Pass, opponent-forced, ability/item-triggered, enemy AI switch,
// revival) results in a host-authoritative field-composition change that the guest
// converges through the per-turn CHECKPOINT: a SPECIES-keyed field reconcile
// (reconcileCoopPlayerField / reconcileCoopEnemyField in coop-battle-engine.ts) followed
// by a per-mon NUMERIC apply. The two matrix cells with the highest desync risk but no
// dedicated test are (a) BATON PASS state carry (the transferred stat stages must ride the
// checkpoint onto the incoming mon) and (b) FORCED-SWITCH RNG (the guest must converge the
// host's randomly-picked incoming mon by species, never rolling locally).
//
// These tests pin the PURE checkpoint transform (coop-battle-checkpoint.ts) that both cells
// depend on, so the seat/serialize contract can never silently regress. The integration
// side (two real engines over the loopback) is covered by coop-duo-faint-switch.test.ts
// (Row 2) and coop-battle-events.test.ts; here we lock the data contract those rely on.
// =============================================================================

import {
  buildCheckpoint,
  type CoopArenaView,
  type CoopFieldMonView,
  monStateByIndex,
  normalizeMonState,
  serializeMonState,
} from "#data/elite-redux/coop/coop-battle-checkpoint";
import { describe, expect, it } from "vitest";

const arena: CoopArenaView = { weather: 0, weatherTurnsLeft: 0, terrain: 0, terrainTurnsLeft: 0 };

/** Battler indices (mirrors BattlerIndex without importing the enum into this pure test). */
const PLAYER = 0;
const PLAYER_2 = 1;
const ENEMY = 2;

const mon = (over: Partial<CoopFieldMonView> = {}): CoopFieldMonView => ({
  bi: PLAYER,
  partyIndex: 0,
  speciesId: 1,
  hp: 20,
  maxHp: 21,
  status: 0,
  statStages: [0, 0, 0, 0, 0, 0, 0],
  fainted: false,
  ...over,
});

describe("switch sync matrix wire contract (#838)", () => {
  // ---- Row 4: BATON PASS state carry (the CRITICAL cell) -------------------
  describe("Baton Pass: the incoming mon's transferred stat stages ride the checkpoint", () => {
    it("carries the passed +6/+6 stat stages onto the incoming mon's slot, clamped and length-7", () => {
      // transferSummon (field/pokemon.ts) moves the outgoing mon's stat stages onto the incoming
      // mon at the SAME battler index. The host serializes the incoming mon (new species at bi=0)
      // WITH those stages; the guest applies them in applyCoopCheckpoint after the species reconcile.
      const passed = serializeMonState(
        mon({ bi: PLAYER, speciesId: 200, partyIndex: 3, statStages: [6, 6, 3, -2, 0, 4, 1] }),
      );
      expect(passed.speciesId).toBe(200); // the switched-IN mon, not the passer
      expect(passed.statStages).toEqual([6, 6, 3, -2, 0, 4, 1]);
      expect(passed.statStages).toHaveLength(7);
    });

    it("survives the guest-side re-clamp (normalizeMonState) so a passed boost is never dropped", () => {
      // The guest re-clamps every received state before writing it onto its engine mon; the passed
      // stages (and the switched-in identity) must survive that clamp intact.
      const wire = serializeMonState(
        mon({ bi: PLAYER, speciesId: 200, partyIndex: 3, statStages: [6, 6, 0, 0, 0, 0, 0] }),
      );
      const applied = normalizeMonState(wire);
      expect(applied.statStages[0]).toBe(6);
      expect(applied.statStages[1]).toBe(6);
      expect(applied.speciesId).toBe(200);
      expect(applied.partyIndex).toBe(3);
    });

    it("an out-of-range passed stage (a corrupt packet) is clamped, never poisoning engine state", () => {
      const wire = serializeMonState(mon({ statStages: [99, -99, 0, 0, 0, 0, 0] }));
      expect(wire.statStages[0]).toBe(6);
      expect(wire.statStages[1]).toBe(-6);
    });
  });

  // ---- Row 5: FORCED-SWITCH convergence is species-keyed + RNG-free on the guest ----
  describe("Forced switch (Roar/Whirlwind/Dragon Tail): the guest converges by species, not by a local roll", () => {
    it("a switched-in mon at a fixed bi carries a DIFFERENT species than the outgoing (the reconcile trigger)", () => {
      // The host rolls randBattleSeedInt for the incoming pick (move.ts:7871/7958); the guest never
      // rolls. It DETECTS the switch purely from the wire: the same bi now reports a different
      // speciesId, which drives reconcileCoopEnemyField/PlayerField PASS 2 to summon the match.
      const before = serializeMonState(mon({ bi: ENEMY, speciesId: 19, partyIndex: 0, fainted: false }));
      const after = serializeMonState(mon({ bi: ENEMY, speciesId: 77, partyIndex: 0, fainted: false }));
      expect(before.bi).toBe(after.bi);
      expect(before.speciesId).not.toBe(after.speciesId);
      // Neither is fainted: a forced switch replaces a LIVE mon, so the reconcile must swap (PASS 2),
      // not remove (PASS 1) - the fainted flag distinguishes the two.
      expect(after.fainted).toBe(false);
    });

    it("duplicate same-species mons are disambiguated by partyIndex so the wrong mon is never crossed (#799)", () => {
      // Two same-species mons at different party slots: the checkpoint carries a distinct partyIndex
      // for each, which reconcileCoopPlayerField uses to pick the host's EXACT member (not first-wins).
      const a = serializeMonState(mon({ bi: PLAYER, speciesId: 25, partyIndex: 2 }));
      const b = serializeMonState(mon({ bi: PLAYER_2, speciesId: 25, partyIndex: 4 }));
      expect(a.speciesId).toBe(b.speciesId);
      expect(a.partyIndex).not.toBe(b.partyIndex);
    });

    it("the switched-in mon's coopOwner tag follows the swapped slot so ownership resolves after the switch", () => {
      // #811 keeps a forced switch on the roared player's OWN bench; the incoming mon carries its
      // coopOwner so the guest resolves the refilled slot to the right half after the swap.
      const guestOwned = serializeMonState(mon({ bi: PLAYER_2, speciesId: 6, partyIndex: 3, coopOwner: "guest" }));
      expect(guestOwned.coopOwner).toBe("guest");
      expect(normalizeMonState(guestOwned).coopOwner).toBe("guest");
    });
  });

  // ---- Row 2/9: faint replacement + enemy KO removal signal --------------------
  describe("Faint replacement + enemy KO: the fainted mon rides the checkpoint so the guest removes it", () => {
    it("a just-fainted mon is serialized present-with-fainted:true (PASS 1 removal signal), not omitted", () => {
      const koed = serializeMonState(mon({ bi: ENEMY, speciesId: 19, hp: 0, fainted: false }));
      // hp 0 forces fainted regardless of the source flag (the authoritative invariant), so the
      // guest's reconcile PASS 1 removes it even if the host's fainted flag lagged.
      expect(koed.fainted).toBe(true);
      expect(koed.hp).toBe(0);
    });

    it("the checkpoint indexes field mons by bi so the guest applies each mon's state to the right slot", () => {
      const cp = buildCheckpoint(
        [
          mon({ bi: PLAYER, speciesId: 143 }),
          mon({ bi: PLAYER_2, speciesId: 94, coopOwner: "guest" }),
          mon({ bi: ENEMY, speciesId: 19 }),
        ],
        arena,
      );
      expect(monStateByIndex(cp, PLAYER)?.speciesId).toBe(143);
      expect(monStateByIndex(cp, PLAYER_2)?.speciesId).toBe(94);
      expect(monStateByIndex(cp, PLAYER_2)?.coopOwner).toBe("guest");
      expect(monStateByIndex(cp, ENEMY)?.speciesId).toBe(19);
      expect(monStateByIndex(cp, 3)).toBeUndefined();
    });
  });
});

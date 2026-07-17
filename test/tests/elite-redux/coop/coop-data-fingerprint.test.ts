/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// Co-op ER DATA-TABLE FINGERPRINT (#633, diagnostics). The root-cause catcher for the
// "two browsers booted the same build but built DIFFERENT move tables" desync: each client
// hashes its ER data tables, exchanges the fingerprint, and diffs section-by-section. These
// lock in the two properties the diagnostic relies on - the hash is DETERMINISTIC (stable
// across calls, so a real difference is a real data drift, never hash noise) and the diff +
// the canonical leaf-diff pinpoint exactly WHICH table / field diverged. Engine-FREE (it
// reads the data registries + pure helpers, never boots the game).

import {
  computeErDataFingerprint,
  diffErDataFingerprint,
  type ErDataFingerprint,
  logCanonicalDiff,
  logErDataFingerprint,
} from "#data/elite-redux/coop/coop-data-fingerprint";
import { ER_ID_MAP } from "#data/elite-redux/er-id-map";
import {
  getEliteReduxMoveRemapBootEvidence,
  remapEliteReduxMoveIdsByName,
} from "#data/elite-redux/init-elite-redux-c-source-corrections";
import { MoveId } from "#enums/move-id";
import { afterEach, describe, expect, it, vi } from "vitest";

/** Structured-clone a fingerprint so a hand-mutation can't alias the original. */
const clone = (fp: ErDataFingerprint): ErDataFingerprint => JSON.parse(JSON.stringify(fp));

describe("co-op ER data-table fingerprint (#633, diagnostics)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("computeErDataFingerprint", () => {
    it("is DETERMINISTIC: two calls produce the identical fingerprint", () => {
      const a = computeErDataFingerprint();
      const b = computeErDataFingerprint();
      // Every section's count + hash matches across the two calls (no Math.random / Date).
      expect(b).toEqual(a);
      expect(diffErDataFingerprint(a, b)).toEqual([]);
    });

    it("returns a 16-char hex hash + a numeric count for every section", () => {
      const fp = computeErDataFingerprint();
      for (const section of [fp.moveMap, fp.movesData, fp.movesName, fp.movesets, fp.abilitiesData, fp.abilitiesName]) {
        expect(section.hash).toMatch(/^[0-9a-f]{16}$/);
        expect(typeof section.n).toBe("number");
        expect(section.n).toBeGreaterThanOrEqual(0);
      }
      // The ER move id-map is a STATIC table (always populated), so its section is non-empty
      // even headlessly - proving the fingerprint reads the real registry, not just zeros.
      expect(fp.moveMap.n).toBeGreaterThan(0);
    });

    it("the DATA / NAME split sections cover the SAME table: equal entry counts", () => {
      const fp = computeErDataFingerprint();
      // movesData + movesName are two views of `allMoves`; abilitiesData + abilitiesName of
      // `allAbilities`. The split must not drop rows - each pair counts the same table.
      expect(fp.movesData.n).toBe(fp.movesName.n);
      expect(fp.abilitiesData.n).toBe(fp.abilitiesName.n);
    });

    it("boots the real ER move map through all 67 locale-invariant repairs", () => {
      // The original #633 regression mocked only the English-name helper, so it stayed green while
      // the production remap still walked locale-sensitive live Move instances. Read the evidence
      // captured by the actual initializeGame boot call; do not reset modules in shared Lane A.
      expect(getEliteReduxMoveRemapBootEvidence()?.changed).toBe(67);
      expect(ER_ID_MAP.moves[868]).toBe(MoveId.KOWTOW_CLEAVE);
      expect(ER_ID_MAP.moves[894]).toBe(MoveId.AXE_KICK);
      expect(remapEliteReduxMoveIdsByName()).toBe(0);
    });
  });

  describe("diffErDataFingerprint", () => {
    it("returns [] for two identical fingerprints", () => {
      const fp = computeErDataFingerprint();
      expect(diffErDataFingerprint(fp, clone(fp))).toEqual([]);
    });

    it("names the ONE section whose hash a client mutated", () => {
      const fp = computeErDataFingerprint();
      const drifted = clone(fp);
      drifted.moveMap.hash = "ffffffffffffffff";
      expect(diffErDataFingerprint(fp, drifted)).toEqual(["moveMap"]);
    });

    it("names a section whose entry COUNT differs (n drift, hash unchanged)", () => {
      const fp = computeErDataFingerprint();
      const drifted = clone(fp);
      drifted.movesData.n = fp.movesData.n + 598; // the guest's "598 dropped" class
      expect(diffErDataFingerprint(fp, drifted)).toEqual(["movesData"]);
    });

    it("names EVERY differing section (multi-table drift), in the stable section order", () => {
      const fp = computeErDataFingerprint();
      const drifted = clone(fp);
      drifted.moveMap.hash = "0000000000000001";
      drifted.movesData.hash = "0000000000000002";
      drifted.movesets.hash = "0000000000000003";
      expect(diffErDataFingerprint(fp, drifted)).toEqual(["moveMap", "movesData", "movesets"]);
    });

    it("SPLIT diagnostic: a NAME-only drift names movesName but NOT movesData (cosmetic vs real)", () => {
      const fp = computeErDataFingerprint();
      const drifted = clone(fp);
      // Localized move name differs but the data fields are byte-identical: the split must
      // pinpoint movesName ALONE so the diagnostic reads "cosmetic, not a mechanic drift".
      drifted.movesName.hash = "0000000000000abc";
      const diff = diffErDataFingerprint(fp, drifted);
      expect(diff).toEqual(["movesName"]);
      expect(diff).not.toContain("movesData");
    });
  });

  describe("logErDataFingerprint", () => {
    it("logs one grep-able [coop-fp] line with each section's hash(count)", () => {
      const info = vi.spyOn(console, "info").mockImplementation(() => {});
      const fp = computeErDataFingerprint();
      logErDataFingerprint("local", fp);
      expect(info).toHaveBeenCalledTimes(1);
      const line = info.mock.calls[0][0] as string;
      expect(line).toContain("[coop-fp] local");
      expect(line).toContain(`moveMap=${fp.moveMap.hash}(${fp.moveMap.n})`);
      // The split sections are logged separately (the #633 cosmetic-vs-real diagnostic).
      expect(line).toContain(`movesData=${fp.movesData.hash}(${fp.movesData.n})`);
      expect(line).toContain(`movesName=${fp.movesName.hash}(${fp.movesName.n})`);
      expect(line).toContain(`abilitiesData=${fp.abilitiesData.hash}(${fp.abilitiesData.n})`);
      expect(line).toContain(`abilitiesName=${fp.abilitiesName.hash}(${fp.abilitiesName.n})`);
    });
  });

  describe("logCanonicalDiff", () => {
    it("finds a known LEAF difference between two parsed canonical objects (field keyed by bi)", () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const host = { field: [{ bi: 0, hp: 20, abilityId: 65 }], money: 1000 };
      const guest = { field: [{ bi: 0, hp: 17, abilityId: 65 }], money: 1000 };
      logCanonicalDiff("[coop-cs] turn=3", host, guest);

      const lines = warn.mock.calls.map(c => String(c[0]));
      // The header names the tag + a non-zero field count.
      expect(lines.some(l => l.startsWith("[coop-cs] turn=3") && /differing field/.test(l))).toBe(true);
      // The exact divergent leaf path is reported with both sides' values. The `field` array is now
      // re-keyed by battler index (#633, FIX c), so a per-mon leaf is `field.bi#<n>.<leaf>` - a single
      // composition gap then shows the real missing bi instead of renumbering every array slot.
      const hpLine = lines.find(l => l.includes("field.bi#0.hp"));
      expect(hpLine).toBeDefined();
      expect(hpLine).toContain("host=20");
      expect(hpLine).toContain("guest=17");
      // A leaf that MATCHES is never reported.
      expect(lines.some(l => l.includes("abilityId"))).toBe(false);
      expect(lines.some(l => l.includes("money"))).toBe(false);
    });

    it("keys a composition gap by battler index: a present-on-one-side bi shows a single <absent> leaf (#633, FIX c)", () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      // The host has bi 0 AND 1 on field; the guest dropped bi 0 (a dropped switch/faint), so its
      // field array shifts - position-indexed this would renumber EVERY entry. Keyed by bi, the gap is
      // a single `field.bi#0` <absent> leaf and bi#1 (same on both) is NOT reported.
      const host = {
        field: [
          { bi: 0, hp: 20 },
          { bi: 1, hp: 30 },
        ],
        money: 5,
      };
      const guest = { field: [{ bi: 1, hp: 30 }], money: 5 };
      logCanonicalDiff("[coop-cs] turn=4", host, guest);

      const lines = warn.mock.calls.map(c => String(c[0]));
      // The missing bi#0 is reported (guest=<absent>) ...
      const absentLine = lines.find(l => l.includes("field.bi#0") && l.includes("<absent>"));
      expect(absentLine, "the dropped bi is keyed by battler index, not array position").toBeDefined();
      // ... and the bi present + identical on BOTH sides (bi#1) is NOT a difference.
      expect(
        lines.some(l => l.includes("field.bi#1")),
        "the matching bi is not renumbered into a false diff",
      ).toBe(false);
    });

    it("reports 'no leaf differences' when the two objects are identical", () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const same = { a: 1, b: { c: 2 } };
      logCanonicalDiff("[coop-cs] turn=9", same, clone(same as unknown as ErDataFingerprint));
      expect(warn).toHaveBeenCalledTimes(1);
      expect(String(warn.mock.calls[0][0])).toContain("no leaf differences");
    });

    it("never throws on malformed / mismatched-shape input", () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      expect(() => logCanonicalDiff("[coop-cs] turn=1", { a: [1, 2] }, { a: 3 })).not.toThrow();
      // A leaf-vs-array shape mismatch is still reported as a difference.
      expect(warn.mock.calls.some(c => String(c[0]).includes("differing field"))).toBe(true);
    });
  });
});

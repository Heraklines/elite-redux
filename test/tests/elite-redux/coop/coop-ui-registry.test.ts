/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// #840 UNMIRRORED-SCREEN TRIPWIRE guard. The compile-time exhaustiveness of
// `Record<UiMode, CoopUiClass>` already makes an UNCLASSIFIED UiMode a build
// error; this test double-checks it at RUNTIME (iterate the live enum) and
// SNAPSHOTS the "mirrored" set so an accidental reclassification (a screen that
// silently flips mirrored<->local-only) shows up as a visible diff in review.
// =============================================================================

import {
  COOP_UI_MIRRORED_MODES,
  COOP_UI_REGISTRY,
  COOP_UI_TRIPWIRE_EXEMPT,
  coopUiClassOf,
  coopUnmirroredTripwireReason,
} from "#data/elite-redux/coop/coop-ui-registry";
import { UiMode } from "#enums/ui-mode";
import { describe, expect, it } from "vitest";

/** Every numeric UiMode member, as `[name, value]`. */
const ALL_UI_MODES: [string, UiMode][] = Object.entries(UiMode)
  .filter(([, v]) => typeof v === "number")
  .map(([k, v]) => [k, v as UiMode]);

describe("#840 co-op UI classification registry (unmirrored-screen tripwire)", () => {
  it("classifies EVERY UiMode (the table is total over the live enum)", () => {
    const unclassified = ALL_UI_MODES.filter(([, mode]) => coopUiClassOf(mode) === undefined).map(([name]) => name);
    expect(
      unclassified,
      `every UiMode must be classified "mirrored" or "local-only" in coop-ui-registry.ts: ${unclassified.join(", ")}`,
    ).toEqual([]);
  });

  it("has no EXTRA registry keys beyond the enum (no stale entries)", () => {
    const validValues = new Set(ALL_UI_MODES.map(([, v]) => v));
    const extra = Object.keys(COOP_UI_REGISTRY)
      .map(Number)
      .filter(v => !validValues.has(v as UiMode));
    expect(extra, `registry keys not present in UiMode: ${extra.join(", ")}`).toEqual([]);
  });

  it("every classification is a valid CoopUiClass", () => {
    for (const [name, mode] of ALL_UI_MODES) {
      expect(["mirrored", "local-only"], `${name} has an invalid class`).toContain(COOP_UI_REGISTRY[mode]);
    }
  });

  // SNAPSHOT of the mirrored set. If you intentionally change what is mirrored, update this list in
  // the SAME change - the diff is the review signal that a screen's co-op class moved.
  it("the MIRRORED set matches the reviewed snapshot", () => {
    const mirrored = [...COOP_UI_MIRRORED_MODES].map(m => UiMode[m]).sort((a, b) => a.localeCompare(b));
    expect(mirrored).toEqual([
      "BALL",
      "BIOME_SHOP",
      "COLOSSEUM",
      "COMMAND",
      "ER_BARGAIN",
      "ER_QUIZ",
      "FIGHT",
      "LEARN_MOVE_BATCH",
      "MODIFIER_SELECT",
      "MYSTERY_ENCOUNTER",
      "PARTY",
      "SUMMARY",
      "TARGET_SELECT",
    ]);
  });

  it("the exempt allowlist is small and only holds local-only chrome modes", () => {
    expect(COOP_UI_TRIPWIRE_EXEMPT.size, "keep the exempt allowlist small").toBeLessThanOrEqual(6);
    for (const mode of COOP_UI_TRIPWIRE_EXEMPT) {
      expect(COOP_UI_REGISTRY[mode], `${UiMode[mode]} is exempt so it must be local-only`).toBe("local-only");
    }
  });

  describe("coopUnmirroredTripwireReason (the pure decision half of the ui.ts tripwire)", () => {
    it("is silent when the partner owns NO live interaction (idle co-op)", () => {
      // POKEDEX is a non-exempt local-only interactive mode - still no warn without a partner interaction.
      expect(coopUnmirroredTripwireReason(UiMode.POKEDEX, false)).toBeNull();
    });

    it("is silent for MIRRORED modes even during a partner-owned interaction (wired paths handle themselves)", () => {
      expect(coopUnmirroredTripwireReason(UiMode.MYSTERY_ENCOUNTER, true)).toBeNull();
      expect(coopUnmirroredTripwireReason(UiMode.MODIFIER_SELECT, true)).toBeNull();
      expect(coopUnmirroredTripwireReason(UiMode.ER_QUIZ, true)).toBeNull();
    });

    it("is silent for EXEMPT chrome (MESSAGE / CONFIRM / menus) during a partner-owned interaction", () => {
      expect(coopUnmirroredTripwireReason(UiMode.MESSAGE, true)).toBeNull();
      expect(coopUnmirroredTripwireReason(UiMode.CONFIRM, true)).toBeNull();
      expect(coopUnmirroredTripwireReason(UiMode.OPTION_SELECT, true)).toBeNull();
    });

    it("WARNS for a non-mirrored, non-exempt interactive screen during a partner-owned interaction", () => {
      // This is the fingerprint of a new host-only screen (e.g. a future bespoke shop) leaking in.
      const reason = coopUnmirroredTripwireReason(UiMode.POKEDEX, true);
      expect(reason).not.toBeNull();
      expect(reason).toContain("possible unmirrored interactive screen");
      expect(reason).toContain("POKEDEX");
    });

    it("is SILENT for LEARN_MOVE_BATCH (it is now the mirrored shared co-op level-up panel, #848)", () => {
      // #848: the batch Move Learn panel is the SHARED co-op level-up path (owner drives / watcher
      // mirrors, both close on the relayed terminal), so it is classified "mirrored" and the tripwire
      // no longer flags it - it legitimately opens on both clients during the move-learn interaction.
      expect(coopUnmirroredTripwireReason(UiMode.LEARN_MOVE_BATCH, true)).toBeNull();
    });
  });
});

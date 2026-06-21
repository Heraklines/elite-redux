/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Bug repro (tester): a gym leader's Wispywaspy spawned in its "Hivemind" form
// with NO moves and only Struggled. ER ships Hivemind as a SEPARATE dump species
// (pkrg 10638) with no usable learnset; the trainer roster fielded it directly.
// erBattleFormDumpToBaseSpeciesId redirects such battle-form dump species to their
// BASE (10638 -> 10065), so the trainer spawns base Wispywaspy - which has a real
// moveset + the Locust Swarm innate that schools it into the (injected) Hivemind
// form. Covers every entry in ER_CUSTOM_FORM_SPECS (Darmanitan Blunder, Mimikyu
// Busted, ...), not just Wispywaspy.
// =============================================================================

import { erBattleFormDumpToBaseSpeciesId } from "#data/elite-redux/init-elite-redux-er-custom-form-changes";
import { ErSpeciesId } from "#enums/er-species-id";
import { SpeciesId } from "#enums/species-id";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, describe, expect, it } from "vitest";

describe("ER battle-form dump species -> base redirect (Wispywaspy Hivemind etc.)", () => {
  beforeAll(() => {
    // Boots init (ER_ID_MAP + ER_CUSTOM_FORM_SPECS). No battle.
    void new GameManager(new Phaser.Game({ type: Phaser.HEADLESS }));
  });

  it("redirects Wispywaspy Hivemind (the dump species) to base Wispywaspy", () => {
    expect(erBattleFormDumpToBaseSpeciesId(ErSpeciesId.WISPYWASPY_HIVEMIND)).toBe(ErSpeciesId.WISPYWASPY);
  });

  it("never redirects a base / normal species", () => {
    // The base itself is not a dump species.
    expect(erBattleFormDumpToBaseSpeciesId(ErSpeciesId.WISPYWASPY)).toBeUndefined();
    // Vanilla species are untouched.
    expect(erBattleFormDumpToBaseSpeciesId(SpeciesId.PIKACHU)).toBeUndefined();
    expect(erBattleFormDumpToBaseSpeciesId(SpeciesId.WOBBUFFET)).toBeUndefined();
  });

  it("also covers the other ER battle-form dumps", () => {
    // Darmanitan Redux Blunder -> Bond; Mimikyu Apex Busted -> Apex.
    expect(erBattleFormDumpToBaseSpeciesId(ErSpeciesId.DARMANITAN_REDUX_BLUNDER)).toBe(
      ErSpeciesId.DARMANITAN_REDUX_BOND,
    );
    expect(erBattleFormDumpToBaseSpeciesId(ErSpeciesId.MIMIKYU_APEX_BUSTED)).toBe(ErSpeciesId.MIMIKYU_APEX);
  });
});

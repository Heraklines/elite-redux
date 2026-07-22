/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// In-battle "Pokémon Stats" overlay — Acc / Eva / Crit rows (maintainer request).
//
// The stat-stage arrow grid used to render only the 5 main stats. It now also
// renders Accuracy, Evasion and Crit. Crit has no Stat-enum stage, so it MUST read
// the true source, `Pokemon.getCritStage` (folds Focus Energy / Dragon Cheer, Scope
// Lens, Super Luck, the ER Battle Aura, biome, …) and update LIVE when a boost lands
// — the maintainer's "crit arrows don't update" repro. `computeBattleInfoStatRows`
// is the pure row model the overlay draws; asserting on it verifies the wiring
// without rasterizing (the render golden covers the pixels).
//
// Gated behind ER_SCENARIO=1.
// =============================================================================

import { allMoves } from "#data/data-lists";
import { AbilityId } from "#enums/ability-id";
import { BattlerTagType } from "#enums/battler-tag-type";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { Stat } from "#enums/stat";
import type { Pokemon } from "#field/pokemon";
import { GameManager } from "#test/framework/game-manager";
import { computeBattleInfoStatRows } from "#ui/battle-info-overlay";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

describe.skipIf(!RUN)("BattleInfoOverlay stats rows — Acc/Eva/Crit wiring", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
  });

  const critRow = (mon: Pokemon) => computeBattleInfoStatRows(mon).find(r => r.label === "Crit")!;

  it("exposes all eight rows in ROM-panel order (5 main stats + Acc / Eva / Crit)", async () => {
    game.override.battleStyle("single").enemySpecies(SpeciesId.SNORLAX).enemyAbility(AbilityId.BALL_FETCH);
    await game.classicMode.startBattle(SpeciesId.GARCHOMP);
    const mon = game.field.getPlayerPokemon();
    const labels = computeBattleInfoStatRows(mon).map(r => r.label);
    expect(labels).toEqual(["Atk", "Def", "SpA", "SpD", "Spe", "Acc", "Eva", "Crit"]);
  });

  it("Acc / Eva rows mirror the live accuracy / evasion stat stages", async () => {
    game.override.battleStyle("single").enemySpecies(SpeciesId.SNORLAX).enemyAbility(AbilityId.BALL_FETCH);
    await game.classicMode.startBattle(SpeciesId.GARCHOMP);
    const mon = game.field.getPlayerPokemon();
    mon.setStatStage(Stat.ACC, -2);
    mon.setStatStage(Stat.EVA, 3);
    const rows = computeBattleInfoStatRows(mon);
    expect(rows.find(r => r.label === "Acc")!.stage).toBe(mon.getStatStage(Stat.ACC));
    expect(rows.find(r => r.label === "Acc")!.stage).toBe(-2);
    expect(rows.find(r => r.label === "Eva")!.stage).toBe(mon.getStatStage(Stat.EVA));
    expect(rows.find(r => r.label === "Eva")!.stage).toBe(3);
  });

  it("Crit row reads getCritStage and moves LIVE when a crit boost lands (Dragon Cheer)", async () => {
    game.override.battleStyle("single").enemySpecies(SpeciesId.SNORLAX).enemyAbility(AbilityId.BALL_FETCH);
    await game.classicMode.startBattle(SpeciesId.GARCHOMP);
    const mon = game.field.getPlayerPokemon();
    const neutral = allMoves[MoveId.TACKLE];

    // Baseline: no crit sources → the Crit row is 0 and equals getCritStage.
    const before = critRow(mon).stage;
    expect(before).toBe(mon.getCritStage(mon, neutral));
    expect(before).toBe(0);

    // Dragon Cheer lands. Garchomp is a Dragon type → +2 crit stages.
    mon.addTag(BattlerTagType.DRAGON_CHEER);
    const after = critRow(mon).stage;

    // The DISPLAYED crit stage equals getCritStage exactly (the row reuses it, does
    // not re-derive) AND it actually MOVED — the live-update the maintainer wanted.
    // Red-proof: the pre-fix overlay had NO Crit row (and getStatStage has no crit
    // stat), so `after` could never rise here.
    expect(after).toBe(mon.getCritStage(mon, neutral));
    expect(after).toBeGreaterThan(before);
    expect(after).toBe(2);
  });
});

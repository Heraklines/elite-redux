/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// Walks every vanilla-range ER move (id < 760), compares ER spec vs
// pokerogue's runtime Move stats, and reports diffs. Used to discover
// which moves need additional vanilla-move patches.

import { allMoves } from "#data/data-lists";
import { AbilityId } from "#enums/ability-id";
import { SpeciesId } from "#enums/species-id";
import { GameManager } from "#test/framework/game-manager";
import * as fs from "node:fs";
import * as path from "node:path";
import Phaser from "phaser";
import { beforeAll, describe, expect, it } from "vitest";

const RUN_SCENARIOS = process.env.ER_SCENARIO === "1";

describe.skipIf(!RUN_SCENARIOS)("ER move diff audit", () => {
  let phaserGame: Phaser.Game;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  it("emits diff report of ER vs pokerogue move stats", async () => {
    // Bootstrap pokerogue state.
    const game = new GameManager(phaserGame);
    game.override.battleStyle("single").enemyAbility(AbilityId.BALL_FETCH).enemySpecies(SpeciesId.RATTATA);
    await game.classicMode.startBattle(SpeciesId.PIKACHU);

    const erIdMap = (await import("#data/elite-redux/er-id-map")).ER_ID_MAP;
    const erMoves = (await import("#data/elite-redux/er-moves")).ER_MOVES;
    // Use ER C source (battle_moves.h) as the authoritative spec — not the
    // JSON dump (which is from v2.65beta, older than the v2.65.3b C source).
    const cSrcPath = path.resolve(process.cwd(), "vendor/elite-redux/rom-extracted/er-battle-moves.json");
    const cMoves = JSON.parse(fs.readFileSync(cSrcPath, "utf-8")) as {
      name: string;
      power: number | null;
      accuracy: number | null;
      pp: number | null;
      chance: number | null;
    }[];
    // ER C source uses MOVE_XXX names. Map them to pokerogue MoveIds via the
    // ER_MOVES draft list which has moveConst names.
    const constToErId = new Map<string, number>();
    for (const drf of erMoves) {
      // moveConst comes as "MOVE_XXX"; strip prefix for matching against C parse.
      const c = drf.moveConst.replace(/^MOVE_/, "");
      constToErId.set(c, drf.id);
    }

    const diffs: Array<{
      erId: number;
      name: string;
      pkrgId: number;
      diffs: string[];
    }> = [];
    const norm = (v: number | null | undefined) => {
      if (v === undefined || v === null || v === -1 || v === 0) {
        return null;
      }
      return v;
    };
    for (const cm of cMoves) {
      const erId = constToErId.get(cm.name);
      if (erId === undefined) {
        continue;
      }
      if (erId < 1 || erId > 759) {
        continue;
      }
      const pkrgId = erIdMap.moves[erId];
      if (pkrgId === undefined) {
        continue;
      }
      const move = allMoves.find(x => x?.id === pkrgId);
      if (!move) {
        continue;
      }
      const localDiffs: string[] = [];
      if (norm(cm.power) !== norm(move.power)) {
        localDiffs.push(`power ${move.power}→${cm.power}`);
      }
      if (norm(cm.accuracy) !== norm(move.accuracy)) {
        localDiffs.push(`acc ${move.accuracy}→${cm.accuracy}`);
      }
      if (norm(cm.pp) !== norm(move.pp)) {
        localDiffs.push(`pp ${move.pp}→${cm.pp}`);
      }
      if (norm(cm.chance) !== norm(move.chance)) {
        localDiffs.push(`chance ${move.chance}→${cm.chance}`);
      }
      if (localDiffs.length > 0) {
        diffs.push({ erId, name: cm.name, pkrgId, diffs: localDiffs });
      }
    }
    // Write report.
    const reportPath = path.resolve(process.cwd(), "docs/plans/er-move-diff-report.txt");
    const lines: string[] = [
      `ER move-stats vs pokerogue diff — generated ${new Date().toISOString()}`,
      `Total diffs found: ${diffs.length}`,
      "",
    ];
    for (const d of diffs) {
      lines.push(
        `  ER${d.erId.toString().padStart(3)} → ${d.pkrgId.toString().padStart(3)} ${d.name.padEnd(25)} : ${d.diffs.join(", ")}`,
      );
    }
    fs.writeFileSync(reportPath, lines.join("\n"), "utf-8");
    console.log(`Wrote ${reportPath} with ${diffs.length} diffs`);

    expect(diffs.length).toBeGreaterThanOrEqual(0); // always passes — just generates the report
  }, 60_000);
});
